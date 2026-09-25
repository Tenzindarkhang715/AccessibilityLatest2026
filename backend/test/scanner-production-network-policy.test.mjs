import assert from "node:assert/strict";
import test from "node:test";

import {
  productionPolicyModel,
  validateProductionPolicyConfig,
} from "../infra/scanner/production-network-policy.mjs";

const valid = () => ({
  workerAddress: "10.89.0.2",
  proxyAddress: "10.89.0.1",
  proxyPort: 18080,
  resolverAddress: "192.168.64.1",
});

test("production worker is default-deny with loopback and proxy-only egress", () => {
  const policy = productionPolicyModel(valid());

  assert.equal(policy.worker.default, "drop");
  assert.equal(policy.worker.loopback, "allow");
  assert.equal(policy.worker.established, "allow");

  assert.deepEqual(policy.worker.outbound, [
    {
      protocol: "tcp",
      destination: "10.89.0.1",
      port: 18080,
    },
  ]);
});

test("production proxy permits worker ingress, DNS, and controlled web egress", () => {
  const policy = productionPolicyModel(valid());

  assert.equal(policy.proxy.default, "drop");
  assert.equal(policy.proxy.loopback, "allow");
  assert.equal(policy.proxy.established, "allow");

  assert.deepEqual(policy.proxy.inbound, [
    {
      protocol: "tcp",
      source: "10.89.0.2",
      port: 18080,
    },
  ]);

  assert.deepEqual(policy.proxy.outbound, [
    {
      protocol: "udp",
      destination: "192.168.64.1",
      port: 53,
    },
    {
      protocol: "tcp",
      destination: "192.168.64.1",
      port: 53,
    },
    {
      protocol: "tcp",
      destinationClass: "validated-public-ipv4",
      ports: [80, 443],
    },
  ]);
});

test("production proxy retains prohibited IPv4 destinations", () => {
  const policy = productionPolicyModel(valid());

  assert.ok(policy.proxy.prohibitedIpv4.length > 0);
  assert.ok(policy.proxy.prohibitedIpv4.includes("127.0.0.0/8"));
  assert.equal(Object.isFrozen(policy.proxy.prohibitedIpv4), true);
});

test("production policy rejects malformed or unsafe configuration", () => {
  assert.throws(() =>
    validateProductionPolicyConfig({
      ...valid(),
      workerAddress: "127.0.0.2",
    }),
  );

  assert.throws(() =>
    validateProductionPolicyConfig({
      ...valid(),
      proxyAddress: "127.0.0.1",
    }),
  );

  assert.throws(() =>
    validateProductionPolicyConfig({
      ...valid(),
      resolverAddress: "127.0.0.53",
    }),
  );

  assert.throws(() =>
    validateProductionPolicyConfig({
      ...valid(),
      workerAddress: "10.89.0.1",
    }),
  );

  assert.throws(() =>
    validateProductionPolicyConfig({
      ...valid(),
      proxyPort: 0,
    }),
  );

  assert.throws(() =>
    validateProductionPolicyConfig({
      ...valid(),
      unexpected: true,
    }),
  );
});
