import assert from "node:assert/strict";
import test from "node:test";

import {
  productionTopology,
} from "../infra/scanner/production-topology.mjs";

test("returns the fixed default production topology", () => {
  assert.deepEqual(productionTopology(), {
    workerAddress: "10.89.0.2/30",
    proxyWorkerAddress: "10.89.0.1/30",
    proxyUpstreamAddress: "10.89.1.2/30",
    hostBoundaryAddress: "10.89.1.1/30",
    proxyPort: 18080,
  });
});

test("keeps worker and upstream segments separate", () => {
  const topology = productionTopology();

  assert.notEqual(
    topology.workerAddress.split("/")[0],
    topology.proxyWorkerAddress.split("/")[0],
  );

  assert.notEqual(
    topology.proxyUpstreamAddress.split("/")[0],
    topology.hostBoundaryAddress.split("/")[0],
  );
});

test("accepts an explicit valid isolated topology", () => {
  assert.deepEqual(
    productionTopology({
      workerAddress: "10.90.0.2/30",
      proxyWorkerAddress: "10.90.0.1/30",
      proxyUpstreamAddress: "10.90.1.2/30",
      hostBoundaryAddress: "10.90.1.1/30",
      proxyPort: 19080,
    }),
    {
      workerAddress: "10.90.0.2/30",
      proxyWorkerAddress: "10.90.0.1/30",
      proxyUpstreamAddress: "10.90.1.2/30",
      hostBoundaryAddress: "10.90.1.1/30",
      proxyPort: 19080,
    },
  );
});

test("rejects overlapping, malformed, loopback, or unexpected topology", () => {
  assert.throws(() =>
    productionTopology({
      proxyUpstreamAddress: "10.89.0.3/30",
    }),
  );

  assert.throws(() =>
    productionTopology({
      workerAddress: "127.0.0.2/30",
    }),
  );

  assert.throws(() =>
    productionTopology({
      workerAddress: "10.89.0.2/24",
    }),
  );

  assert.throws(() =>
    productionTopology({
      workerAddress: "not-an-address",
    }),
  );

  assert.throws(() =>
    productionTopology({
      proxyPort: 80,
    }),
  );

  assert.throws(() =>
    productionTopology({
      unexpected: true,
    }),
  );
});

test("returns an immutable topology", () => {
  assert.equal(Object.isFrozen(productionTopology()), true);
});
