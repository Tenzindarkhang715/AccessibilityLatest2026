import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import process from "node:process";

import {
  LinuxBoundary,
  scannerErrorWire,
} from "./linux-boundary.mjs";

const DEFAULT_SOCKET_PATH =
  "/run/accessibility-scanner/supervisor.sock";

const MAX_REQUEST_BYTES = 64 * 1024;

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);

  return (
    actual.length === keys.length &&
    keys.every(key =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function validateSocketPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.includes("\0")
  ) {
    fail("Invalid supervisor socket path");
  }

  return value;
}

function validateScanRequest(value) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "url",
      "testType",
      "browsers",
      "wcagStandard",
    ])
  ) {
    return null;
  }

  if (
    typeof value.url !== "string" ||
    value.url.length === 0 ||
    value.url.length > 8_192
  ) {
    return null;
  }

  if (
    value.testType !== "page" &&
    value.testType !== "site"
  ) {
    return null;
  }

  if (
    !Array.isArray(value.browsers) ||
    value.browsers.length === 0 ||
    value.browsers.length > 16 ||
    !value.browsers.every(
      browser =>
        typeof browser === "string" &&
        browser.length > 0 &&
        browser.length <= 128,
    )
  ) {
    return null;
  }

  if (
    typeof value.wcagStandard !== "string" ||
    value.wcagStandard.length > 64 ||
    !/^wcag_2_[012]_[a]{1,3}$/i.test(
      value.wcagStandard,
    )
  ) {
    return null;
  }

  return {
    url: value.url,
    testType: value.testType,
    browsers: [...value.browsers],
    wcagStandard: value.wcagStandard,
  };
}

function validateMessage(value) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "id",
      "op",
      "request",
    ]) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    value.op !== "scan"
  ) {
    return null;
  }

  const request = validateScanRequest(
    value.request,
  );

  if (!request) {
    return null;
  }

  return {
    id: value.id,
    op: "scan",
    request,
  };
}

function scannerCode(error) {
  return scannerErrorWire(error?.code)?.code ??
    "ENGINE_FAILURE";
}

function responseLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function safeWrite(socket, value) {
  if (
    socket.destroyed ||
    !socket.writable
  ) {
    return;
  }

  socket.end(responseLine(value));
}

async function removeStaleSocket(path) {
  let info;

  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }

    throw error;
  }

  if (!info.isSocket()) {
    fail(
      "Supervisor socket path exists and is not a socket",
    );
  }

  if (
    typeof process.getuid === "function" &&
    info.uid !== process.getuid()
  ) {
    fail(
      "Refusing to remove socket owned by another user",
    );
  }

  await rm(path);
}

async function prepareSocket(path) {
  const slash = path.lastIndexOf("/");
  const directory =
    slash === 0 ? "/" : path.slice(0, slash);

  await mkdir(directory, {
    recursive: true,
    mode: 0o750,
  });

  await removeStaleSocket(path);
}

async function handleScan(
  socket,
  message,
  createBoundary,
) {
  const controller = new AbortController();
  let disconnected = false;
  let boundary = null;
  let outcome = null;
  let failureCode = null;

  const disconnect = () => {
    disconnected = true;
    controller.abort();
  };

  socket.once("close", disconnect);

  try {
    boundary = createBoundary();

    await boundary.start();

    if (disconnected) {
      controller.abort();
    }

    outcome = await boundary.scan(
      message.request,
      {
        signal: controller.signal,
      },
    );
  } catch (error) {
    failureCode = scannerCode(error);
  } finally {
    controller.abort();

    if (boundary) {
      try {
        await boundary.close();
      } catch {
        failureCode = "ENGINE_FAILURE";
        outcome = null;
      }
    }

    socket.removeListener(
      "close",
      disconnect,
    );
  }

  if (disconnected) {
    return;
  }

  if (failureCode) {
    safeWrite(socket, {
      id: message.id,
      ok: false,
      error: failureCode,
    });

    return;
  }

  safeWrite(socket, {
    id: message.id,
    ok: true,
    outcome,
  });
}

function handleConnection(socket, createBoundary) {
  let bytes = 0;
  let buffer = Buffer.alloc(0);
  let handled = false;

  const rejectProtocol = () => {
    if (handled) {
      return;
    }

    handled = true;
    socket.destroy();
  };

  socket.on("data", chunk => {
    if (handled) {
      return;
    }

    bytes += chunk.length;

    if (bytes > MAX_REQUEST_BYTES) {
      rejectProtocol();
      return;
    }

    buffer = Buffer.concat([
      buffer,
      chunk,
    ]);

    const newline = buffer.indexOf(0x0a);

    if (newline === -1) {
      return;
    }

    const frame = buffer.subarray(
      0,
      newline,
    );

    const trailing = buffer.subarray(
      newline + 1,
    );

    if (
      frame.length === 0 ||
      trailing.length !== 0
    ) {
      rejectProtocol();
      return;
    }

    let parsed;

    try {
      parsed = JSON.parse(
        frame.toString("utf8"),
      );
    } catch {
      rejectProtocol();
      return;
    }

    const message =
      validateMessage(parsed);

    if (!message) {
      rejectProtocol();
      return;
    }

    handled = true;

    socket.pause();

    void handleScan(
  socket,
  message,
  createBoundary,
).catch(() => {
      socket.destroy();
    });
  });

  socket.once("error", () => {
    socket.destroy();
  });

  socket.once("end", () => {
    if (!handled) {
      socket.destroy();
    }
  });
}

export async function startSupervisor({
  socketPath =
    process.env.SCANNER_SOCKET_PATH ??
    DEFAULT_SOCKET_PATH,
  createBoundary =
    () => new LinuxBoundary(),
} = {}) {
  const path =
    validateSocketPath(socketPath);

  await prepareSocket(path);

  const server = createServer(
  socket =>
    handleConnection(
      socket,
      createBoundary,
    ),
);

  await new Promise(
    (resolve, reject) => {
      const startupError = error => {
        server.removeListener(
          "listening",
          listening,
        );

        reject(error);
      };

      const listening = () => {
        server.removeListener(
          "error",
          startupError,
        );

        resolve();
      };

      server.once(
        "error",
        startupError,
      );

      server.once(
        "listening",
        listening,
      );

      server.listen(path);
    },
  );

  await chmod(path, 0o660);

  let closing = null;

  const close = () => {
    if (closing) {
      return closing;
    }

    closing = new Promise(
      (resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      },
    ).finally(async () => {
      try {
        const info = await lstat(path);

        if (info.isSocket()) {
          await rm(path);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    });

    return closing;
  };

  return Object.freeze({
    path,
    server,
    close,
  });
}

async function main() {
  const supervisor =
    await startSupervisor();

  const shutdown = () => {
    void supervisor
      .close()
      .then(
        () => process.exit(0),
        () => process.exit(1),
      );
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url ===
    new URL(
      `file://${process.argv[1]}`,
    ).href;

if (invokedDirectly) {
  main().catch(() => {
    process.exitCode = 1;
  });
}