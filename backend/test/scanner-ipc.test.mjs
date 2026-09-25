import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScannerIpcClient } from "../dist/scanner-ipc.js";

const request = {
  url: "https://example.com",
  testType: "page",
  browsers: ["chromium"],
  wcagStandard: "wcag_2_1_aa",
};

const outcome = {
  findings: [],
  execution: {
    browser: "chromium",
    browserVersion: "153.0.0.0",
    engine: "axe-core",
    engineVersion: "4.13.0",
    tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    evaluatedRuleIds: ["button-name"],
    incompleteRuleIds: [],
    mode: "live",
  },
};

async function withSocketServer(handler, run) {
  const directory = await mkdtemp(
    join(tmpdir(), "scanner-ipc-"),
  );
  const socketPath = join(directory, "scanner.sock");
  const server = createServer(handler);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  try {
    return await run(socketPath);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
}

function scan(
  client,
  signal = new AbortController().signal,
) {
  return client.scan(request, { signal });
}

function readRequest(socket, respond) {
  let input = "";

  socket.setEncoding("utf8");

  socket.on("data", chunk => {
    input += chunk;

    const newline = input.indexOf("\n");

    if (newline === -1) {
      return;
    }

    const message = JSON.parse(
      input.slice(0, newline),
    );

    respond(message);
  });
}

test(
  "IPC client sends a scan request and accepts a valid outcome",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, message => {
          assert.equal(message.op, "scan");
          assert.equal(typeof message.id, "string");
          assert.ok(message.id.length > 0);
          assert.deepEqual(message.request, request);

          socket.end(
            `${JSON.stringify({
              id: message.id,
              ok: true,
              outcome,
            })}\n`,
          );
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        assert.deepEqual(
          await scan(client),
          outcome,
        );
      },
    );
  },
);

test(
  "IPC client preserves allow-listed scanner failures",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, message => {
          socket.end(
            `${JSON.stringify({
              id: message.id,
              ok: false,
              error: "TARGET_NOT_ALLOWED",
            })}\n`,
          );
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        await assert.rejects(
          scan(client),
          {
            code: "TARGET_NOT_ALLOWED",
            message:
              "Scanner failed: TARGET_NOT_ALLOWED.",
          },
        );
      },
    );
  },
);

test(
  "IPC client preserves scan timeout failures",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, message => {
          socket.end(
            `${JSON.stringify({
              id: message.id,
              ok: false,
              error: "SCAN_TIMEOUT",
            })}\n`,
          );
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        await assert.rejects(
          scan(client),
          {
            code: "SCAN_TIMEOUT",
            message:
              "Scanner failed: SCAN_TIMEOUT.",
          },
        );
      },
    );
  },
);

test(
  "IPC client rejects unknown scanner failure codes",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, message => {
          socket.end(
            `${JSON.stringify({
              id: message.id,
              ok: false,
              error: "PRIVATE_INTERNAL_FAILURE",
            })}\n`,
          );
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        await assert.rejects(
          scan(client),
          {
            code: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "IPC client rejects a response with the wrong request id",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, () => {
          socket.end(
            `${JSON.stringify({
              id: "wrong-id",
              ok: true,
              outcome,
            })}\n`,
          );
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        await assert.rejects(
          scan(client),
          {
            code: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "IPC client rejects malformed JSON",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, () => {
          socket.end("{not-json}\n");
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        await assert.rejects(
          scan(client),
          {
            code: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "IPC client rejects unexpected response fields",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, message => {
          socket.end(
            `${JSON.stringify({
              id: message.id,
              ok: true,
              outcome,
              secret:
                "must-not-be-accepted",
            })}\n`,
          );
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        await assert.rejects(
          scan(client),
          {
            code: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "IPC client rejects malformed success outcomes",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, message => {
          socket.end(
            `${JSON.stringify({
              id: message.id,
              ok: true,
              outcome: {
                findings: [],
                execution: {
                  ...outcome.execution,
                  browser: "firefox",
                },
              },
            })}\n`,
          );
        });
      },
      async socketPath => {
        const client = createScannerIpcClient({
          socketPath,
        });

        await assert.rejects(
          scan(client),
          {
            code: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "IPC client fails safely when the socket is unavailable",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "scanner-ipc-missing-"),
    );

    try {
      const client =
        createScannerIpcClient({
          socketPath: join(
            directory,
            "missing.sock",
          ),
          connectTimeoutMs: 500,
        });

      await assert.rejects(
        scan(client),
        {
          code: "ENGINE_FAILURE",
        },
      );
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  },
);

test(
  "IPC client rejects invalid socket paths",
  () => {
    for (const socketPath of [
      "",
      "relative.sock",
      " /tmp/scanner.sock",
      "/tmp/scanner.sock ",
      "/tmp/scanner\0.sock",
    ]) {
      assert.throws(() =>
        createScannerIpcClient({
          socketPath,
        }),
      );
    }
  },
);

test(
  "IPC client cancels before opening a connection",
  async () => {
    const controller =
      new AbortController();

    controller.abort();

    const client =
      createScannerIpcClient({
        socketPath:
          "/tmp/scanner-that-must-not-be-opened.sock",
      });

    await assert.rejects(
      scan(client, controller.signal),
      {
        code: "CANCELLED",
      },
    );
  },
);

test(
  "IPC client cancels an in-flight request",
  async () => {
    let connectionObserved;

    const connected = new Promise(
      resolve => {
        connectionObserved = resolve;
      },
    );

    await withSocketServer(
      socket => {
        readRequest(socket, () => {
          connectionObserved();
        });
      },
      async socketPath => {
        const controller =
          new AbortController();

        const client =
          createScannerIpcClient({
            socketPath,
            responseTimeoutMs: 5_000,
          });

        const pending = scan(
          client,
          controller.signal,
        );

        await connected;
        controller.abort();

        await assert.rejects(
          pending,
          {
            code: "CANCELLED",
          },
        );
      },
    );
  },
);

test(
  "IPC client times out a stalled response",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, () => {
          // Deliberately leave the
          // connection open.
        });
      },
      async socketPath => {
        const client =
          createScannerIpcClient({
            socketPath,
            responseTimeoutMs: 100,
          });

        await assert.rejects(
          scan(client),
          {
            code: "SCAN_TIMEOUT",
          },
        );
      },
    );
  },
);

test(
  "IPC client rejects multiple response frames",
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, message => {
          const response =
            JSON.stringify({
              id: message.id,
              ok: true,
              outcome,
            });

          socket.end(
            `${response}\n${response}\n`,
          );
        });
      },
      async socketPath => {
        const client =
          createScannerIpcClient({
            socketPath,
          });

        await assert.rejects(
          scan(client),
          {
            code: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "IPC client rejects an oversized response",
  { timeout: 10_000 },
  async () => {
    await withSocketServer(
      socket => {
        readRequest(socket, () => {
          socket.end(
            "x".repeat(
              4 * 1024 * 1024 + 1,
            ),
          );
        });
      },
      async socketPath => {
        const client =
          createScannerIpcClient({
            socketPath,
            responseTimeoutMs: 5_000,
          });

        await assert.rejects(
          scan(client),
          {
            code: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);