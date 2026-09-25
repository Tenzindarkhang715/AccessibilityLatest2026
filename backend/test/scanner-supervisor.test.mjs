import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  startSupervisor,
} from "../infra/scanner/supervisor-entry.mjs";

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
    tags: [
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
    ],
    evaluatedRuleIds: [
      "button-name",
    ],
    incompleteRuleIds: [],
    mode: "live",
  },
};

function fakeBoundary({
  start,
  scan,
  close,
} = {}) {
  return {
    async start() {
      if (start) {
        return start();
      }

      return this;
    },

    async scan(
      scanRequest,
      control,
    ) {
      if (scan) {
        return scan(
          scanRequest,
          control,
        );
      }

      return outcome;
    },

    async close() {
      if (close) {
        return close();
      }
    },
  };
}

async function withSupervisor(
  createBoundary,
  run,
) {
  const directory = await mkdtemp(
    join(
      tmpdir(),
      "scanner-supervisor-",
    ),
  );

  const socketPath = join(
    directory,
    "supervisor.sock",
  );

  const supervisor =
    await startSupervisor({
      socketPath,
      createBoundary,
    });

  try {
    return await run(
      socketPath,
      supervisor,
    );
  } finally {
    await supervisor.close();

    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
}

function exchange(
  socketPath,
  message,
) {
  return new Promise(
    (resolve, reject) => {
      const socket = connect(socketPath);
      let input = "";

      socket.setEncoding("utf8");

      socket.once(
        "error",
        reject,
      );

      socket.on(
        "data",
        chunk => {
          input += chunk;
        },
      );

      socket.once(
        "end",
        () => {
          try {
            resolve(
              JSON.parse(
                input.trim(),
              ),
            );
          } catch (error) {
            reject(error);
          }
        },
      );

      socket.once(
        "connect",
        () => {
          socket.end(
            `${JSON.stringify(
              message,
            )}\n`,
          );
        },
      );
    },
  );
}

function scanMessage(
  id = "test-request",
) {
  return {
    id,
    op: "scan",
    request,
  };
}

test(
  "supervisor returns a successful scan only after cleanup succeeds",
  async () => {
    const events = [];

    await withSupervisor(
      () =>
        fakeBoundary({
          start: async () => {
            events.push("start");
          },

          scan: async value => {
            events.push("scan");

            assert.deepEqual(
              value,
              request,
            );

            return outcome;
          },

          close: async () => {
            events.push("close");
          },
        }),
      async socketPath => {
        const response =
          await exchange(
            socketPath,
            scanMessage(),
          );

        assert.deepEqual(
          response,
          {
            id: "test-request",
            ok: true,
            outcome,
          },
        );

        assert.deepEqual(
          events,
          [
            "start",
            "scan",
            "close",
          ],
        );
      },
    );
  },
);

test(
  "supervisor converts cleanup failure to ENGINE_FAILURE",
  async () => {
    await withSupervisor(
      () =>
        fakeBoundary({
          close: async () => {
            throw new Error(
              "sensitive cleanup detail",
            );
          },
        }),
      async socketPath => {
        const response =
          await exchange(
            socketPath,
            scanMessage(),
          );

        assert.deepEqual(
          response,
          {
            id: "test-request",
            ok: false,
            error: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "supervisor preserves allow-listed scanner failures",
  async () => {
    await withSupervisor(
      () =>
        fakeBoundary({
          scan: async () => {
            const error =
              new Error(
                "internal target detail",
              );

            error.code =
              "TARGET_NOT_ALLOWED";

            throw error;
          },
        }),
      async socketPath => {
        const response =
          await exchange(
            socketPath,
            scanMessage(),
          );

        assert.deepEqual(
          response,
          {
            id: "test-request",
            ok: false,
            error:
              "TARGET_NOT_ALLOWED",
          },
        );
      },
    );
  },
);

test(
  "supervisor hides unexpected scanner failures",
  async () => {
    await withSupervisor(
      () =>
        fakeBoundary({
          scan: async () => {
            throw new Error(
              "privileged internal detail",
            );
          },
        }),
      async socketPath => {
        const response =
          await exchange(
            socketPath,
            scanMessage(),
          );

        assert.deepEqual(
          response,
          {
            id: "test-request",
            ok: false,
            error: "ENGINE_FAILURE",
          },
        );
      },
    );
  },
);

test(
  "supervisor rejects malformed protocol requests without starting a boundary",
  async () => {
    let created = 0;

    await withSupervisor(
      () => {
        created += 1;

        return fakeBoundary();
      },
      async socketPath => {
        await new Promise(
          (resolve, reject) => {
            const socket =
              connect(socketPath);

            socket.once(
              "error",
              error => {
                if (
                  error.code ===
                  "ECONNRESET"
                ) {
                  resolve();
                  return;
                }

                reject(error);
              },
            );

            socket.once(
              "close",
              resolve,
            );

            socket.once(
              "connect",
              () => {
                socket.write(
                  '{"id":"bad","op":"scan"}\n',
                );
              },
            );
          },
        );

        assert.equal(
          created,
          0,
        );
      },
    );
  },
);

test(
  "supervisor aborts an in-flight scan when the client disconnects",
  async () => {
    let observedSignal = null;
    let closeCount = 0;

    let scanStarted;
    const started =
      new Promise(resolve => {
        scanStarted = resolve;
      });

    let releaseScan;
    const released =
      new Promise(resolve => {
        releaseScan = resolve;
      });

    await withSupervisor(
      () =>
        fakeBoundary({
          scan: async (
            _request,
            { signal },
          ) => {
            observedSignal =
              signal;

            scanStarted();

            await released;

            const error =
              new Error(
                "cancelled",
              );

            error.code =
              "CANCELLED";

            throw error;
          },

          close: async () => {
            closeCount += 1;
          },
        }),
      async socketPath => {
        const socket =
          connect(socketPath);

        await new Promise(
          (resolve, reject) => {
            socket.once(
              "error",
              reject,
            );

            socket.once(
              "connect",
              resolve,
            );
          },
        );

        socket.write(
          `${JSON.stringify(
            scanMessage(),
          )}\n`,
        );

        await started;

        const aborted =
  observedSignal.aborted
    ? Promise.resolve()
    : new Promise(resolve => {
        observedSignal.addEventListener(
          "abort",
          resolve,
          { once: true },
        );
      });

socket.destroy();

await aborted;

assert.equal(
  observedSignal.aborted,
  true,
);

        releaseScan();

        await new Promise(
          resolve =>
            setImmediate(resolve),
        );

        assert.equal(
          closeCount,
          1,
        );
      },
    );
  },
);