import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionLinuxBoundary,
} from "../infra/scanner/production-linux-boundary.mjs";

const network = Object.freeze({
  profile: "ipv4-only",
  uplinkInterface: "enp0s1",
  gatewayAddress: "192.168.64.1",
  resolverAddress: "192.168.64.1",
});

function boundary() {
  return new ProductionLinuxBoundary({
    network,
  });
}

test("builds production topology and policy without changing the disconnected harness", () => {
  const instance = boundary();

  assert.equal(instance.topology.workerAddress, "10.89.0.2/30");
  assert.equal(instance.topology.proxyWorkerAddress, "10.89.0.1/30");
  assert.equal(instance.topology.proxyUpstreamAddress, "10.89.1.2/30");
  assert.equal(instance.topology.hostBoundaryAddress, "10.89.1.1/30");

  assert.deepEqual(instance.policy.worker.outbound, [
    {
      protocol: "tcp",
      destination: "10.89.0.1",
      port: 18080,
    },
  ]);

  assert.equal(instance.policy.worker.default, "drop");
  assert.equal(instance.policy.proxy.default, "drop");
});

test("rejects unknown configuration and dependencies", () => {
  assert.throws(
    () => new ProductionLinuxBoundary(
      {
        network,
        unexpected: true,
      },
    ),
    /Unknown production boundary configuration/,
  );

  assert.throws(
    () => new ProductionLinuxBoundary(
      {
        network,
      },
      {
        unexpected: true,
      },
    ),
    /Unknown production boundary dependency/,
  );
});

test("scan fails before the boundary is ready", async () => {
  const instance = boundary();

  await assert.rejects(
    instance.scan({}),
    /Production boundary is not ready/,
  );
});

test("close is idempotent", async () => {
  const instance = boundary();

  const first = instance.close();
  const second = instance.close();

  assert.strictEqual(first, second);

  await first;
  assert.equal(instance.ready, false);
});

test("start is single-use even when Linux opt-in is absent", async () => {
  const instance = boundary();

  await assert.rejects(
    instance.start(),
    /Production scanner boundary requires opted-in Linux/,
  );

  await assert.rejects(
    instance.start(),
    /Boundary already used/,
  );

  await instance.close();
});

test("an already-aborted scan maps to CANCELLED", async () => {
  const instance = boundary();

  /*
   * Privileged startup is intentionally not exercised by this
   * portable contract test.
   */
  instance.started = true;
  instance.ready = true;

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    instance.scan(
      {},
      {
        signal: controller.signal,
      },
    ),
    error => {
      assert.equal(error.code, "CANCELLED");
      return true;
    },
  );

  await instance.close();
});

test("creates the isolated worker, proxy, and host-boundary topology", async () => {
  const calls = [];

  const runner = async (file, args) => {
    calls.push([file, args]);
    return "";
  };

  const instance = new ProductionLinuxBoundary(
    {
      network,
    },
    {
      runner,
    },
  );

  await instance.createNetworkTopology();

  assert.equal(instance.createdNamespaces.length, 2);
  assert.equal(instance.hostLinkCreated, true);

  assert.ok(
    calls.some(
      ([file, args]) =>
        file === "ip" &&
        args[0] === "netns" &&
        args[1] === "add" &&
        args[2] === instance.ns.worker,
    ),
  );

  assert.ok(
    calls.some(
      ([file, args]) =>
        file === "ip" &&
        args[0] === "netns" &&
        args[1] === "add" &&
        args[2] === instance.ns.proxy,
    ),
  );

  assert.ok(
    calls.some(
      ([file, args]) =>
        file === "ip" &&
        args.includes("worker0") &&
        args.includes("peer0") &&
        args.includes(instance.ns.proxy),
    ),
  );

  assert.ok(
    calls.some(
      ([file, args]) =>
        file === "ip" &&
        args[0] === "link" &&
        args[1] === "add" &&
        args[2] === instance.hostInterface &&
        args.includes("upstream0"),
    ),
  );

  assert.ok(
    calls.some(
      ([file, args]) =>
        file === "ip" &&
        args.includes(instance.topology.hostBoundaryAddress) &&
        args.includes(instance.hostInterface),
    ),
  );

  assert.ok(instance.hostInterface.length <= 15);

  /*
   * Prevent this portable command-sequence test from asking close()
   * to clean up resources that were only simulated by the fake runner.
   */
  instance.hostLinkCreated = false;
  instance.createdNamespaces = [];
  await instance.close();
});

test("cleans scanner-owned host link and namespaces in reverse order", async () => {
  const calls = [];

  const runner = async (file, args) => {
    calls.push([file, args]);

    if (
      file === "ip" &&
      args[0] === "netns" &&
      args[1] === "pids"
    ) {
      return "";
    }

    return "";
  };

  const instance = new ProductionLinuxBoundary(
    {
      network,
    },
    {
      runner,
    },
  );

  instance.hostLinkCreated = true;
  instance.createdNamespaces = [
    instance.ns.worker,
    instance.ns.proxy,
  ];

  await instance.close();

  const deleteCalls = calls.filter(
    ([file, args]) =>
      file === "ip" &&
      (
        (
          args[0] === "link" &&
          args[1] === "delete"
        ) ||
        (
          args[0] === "netns" &&
          args[1] === "delete"
        )
      ),
  );

  assert.deepEqual(deleteCalls, [
    [
      "ip",
      [
        "link",
        "delete",
        instance.hostInterface,
      ],
    ],
    [
      "ip",
      [
        "netns",
        "delete",
        instance.ns.proxy,
      ],
    ],
    [
      "ip",
      [
        "netns",
        "delete",
        instance.ns.worker,
      ],
    ],
  ]);
});

test("refuses to delete a namespace that still contains processes", async () => {
  const runner = async (file, args) => {
    if (
      file === "ip" &&
      args[0] === "netns" &&
      args[1] === "pids"
    ) {
      return "4242\n";
    }

    return "";
  };

  const instance = new ProductionLinuxBoundary(
    {
      network,
    },
    {
      runner,
    },
  );

  instance.createdNamespaces = [
    instance.ns.worker,
  ];

  await assert.rejects(
    instance.close(),
    error => {
      assert.equal(error instanceof AggregateError, true);
      assert.match(
        error.message,
        /Production boundary cleanup failed/,
      );
      return true;
    },
  );
});
