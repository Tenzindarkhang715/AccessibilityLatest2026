import assert from "node:assert/strict";
import test from "node:test";

import {
  productionNetworkConfigFromEnvironment,
  validateProductionNetworkConfig,
} from "../infra/scanner/production-network-config.mjs";

const valid = () => ({
  profile: "ipv4-only",
  uplinkInterface: "enp0s1",
  gatewayAddress: "192.168.64.1",
  resolverAddress: "192.168.64.1",
});

test("accepts an exact IPv4 production network configuration", () => {
  const config = validateProductionNetworkConfig(valid());

  assert.deepEqual(config, valid());
  assert.equal(Object.isFrozen(config), true);
});

test("loads trusted production network configuration from environment", () => {
  assert.deepEqual(
    productionNetworkConfigFromEnvironment({
      SCANNER_UPLINK_INTERFACE: "enp0s1",
      SCANNER_UPLINK_GATEWAY: "192.168.64.1",
      SCANNER_UPSTREAM_DNS: "192.168.64.1",
    }),
    valid(),
  );
});

test("rejects missing, additional, or unsupported configuration", () => {
  assert.throws(() =>
    validateProductionNetworkConfig({
      ...valid(),
      resolverAddress: undefined,
    }),
  );

  assert.throws(() =>
    validateProductionNetworkConfig({
      ...valid(),
      unexpected: "value",
    }),
  );

  assert.throws(() =>
    validateProductionNetworkConfig({
      ...valid(),
      profile: "dual-stack",
    }),
  );
});

test("rejects unsafe interface names and loopback DNS or gateway", () => {
  for (const uplinkInterface of [
    "lo",
    "../eth0",
    "eth0;id",
    "",
  ]) {
    assert.throws(() =>
      validateProductionNetworkConfig({
        ...valid(),
        uplinkInterface,
      }),
    );
  }

  for (const gatewayAddress of [
    "127.0.0.1",
    "0.0.0.0",
    "not-an-ip",
  ]) {
    assert.throws(() =>
      validateProductionNetworkConfig({
        ...valid(),
        gatewayAddress,
      }),
    );
  }

  for (const resolverAddress of [
    "127.0.0.53",
    "0.0.0.0",
    "::1",
    "not-an-ip",
  ]) {
    assert.throws(() =>
      validateProductionNetworkConfig({
        ...valid(),
        resolverAddress,
      }),
    );
  }
});
