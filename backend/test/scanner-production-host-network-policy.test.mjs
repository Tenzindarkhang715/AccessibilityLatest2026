import assert from "node:assert/strict";
import test from "node:test";

import {
  renderProductionHostNetworkPolicy,
} from "../infra/scanner/production-host-network-policy.mjs";

const config = {
  hostInterface: "sp123456789012",
  uplinkInterface: "enp0s1",
  proxyAddress: "10.89.1.2",
  resolverAddress: "192.168.64.1",
};

test("renders scanner-owned host forwarding and NAT", () => {
  const rendered = renderProductionHostNetworkPolicy(config);

  assert.match(rendered, /table inet scanner_production_host/);
  assert.match(rendered, /table ip scanner_production_nat/);

  assert.match(
    rendered,
    /iifname "sp123456789012" ip saddr 10\.89\.1\.2/,
  );

  assert.match(
    rendered,
    /oifname "enp0s1" tcp dport \{ 80, 443 \}/,
  );

  assert.match(
    rendered,
    /ip daddr 192\.168\.64\.1 udp dport 53/,
  );

  assert.match(
    rendered,
    /ip daddr 192\.168\.64\.1 tcp dport 53/,
  );

  assert.match(
    rendered,
    /ip saddr 10\.89\.1\.2 oifname "enp0s1" masquerade/,
  );

  assert.doesNotMatch(rendered, /10\.89\.0\./);
  assert.doesNotMatch(rendered, /flush ruleset/);
});

test("rejects invalid or additional configuration", () => {
  assert.throws(
    () => renderProductionHostNetworkPolicy({
      ...config,
      extra: true,
    }),
    /Invalid production host network policy/,
  );

  assert.throws(
    () => renderProductionHostNetworkPolicy({
      ...config,
      hostInterface: "enp0s1",
    }),
    /Invalid production host network policy/,
  );

  assert.throws(
    () => renderProductionHostNetworkPolicy({
      ...config,
      resolverAddress: "127.0.0.53",
    }),
    /Invalid production host network policy/,
  );
});
