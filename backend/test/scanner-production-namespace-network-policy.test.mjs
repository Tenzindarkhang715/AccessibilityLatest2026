import assert from "node:assert/strict";
import test from "node:test";

import {
  renderProductionNamespaceNetworkPolicy,
} from "../infra/scanner/production-namespace-network-policy.mjs";

const config = Object.freeze({
  profile: "ipv4-only",
  workerAddress: "10.89.0.2",
  proxyAddress: "10.89.0.1",
  resolverAddress: "192.168.64.1",
  proxyPort: 18080,
  workerInterface: "worker0",
  proxyWorkerInterface: "peer0",
  proxyUpstreamInterface: "upstream0",
  deploymentExclusions: Object.freeze([
    "192.168.64.0/24",
  ]),
});

test("production worker allows loopback and only proxy network egress", () => {
  const { worker } =
    renderProductionNamespaceNetworkPolicy(config);

  assert.match(worker, /oifname "lo" counter accept/);
  assert.match(worker, /iifname "lo" counter accept/);

  assert.match(
    worker,
    /oifname "worker0" ip saddr 10\.89\.0\.2 ip daddr 10\.89\.0\.1 tcp dport 18080/,
  );

  assert.match(
    worker,
    /iifname "worker0" ip saddr 10\.89\.0\.1 ip daddr 10\.89\.0\.2 tcp sport 18080/,
  );

  assert.doesNotMatch(worker, /tcp dport \{ 80, 443 \}/);

  assert.match(
    worker,
    /chain forward \{[\s\S]*policy drop;/,
  );
});

test("production proxy allows loopback, DNS, and controlled web egress", () => {
  const { proxy } =
    renderProductionNamespaceNetworkPolicy(config);

  assert.match(proxy, /oifname "lo" counter accept/);
  assert.match(proxy, /iifname "lo" counter accept/);

  assert.match(
    proxy,
    /ip daddr 192\.168\.64\.1 udp dport 53/,
  );
  assert.match(
    proxy,
    /ip daddr 192\.168\.64\.1 tcp dport 53/,
  );

  assert.match(
    proxy,
    /oifname "upstream0" tcp dport \{ 80, 443 \}/,
  );

  assert.match(
    proxy,
    /chain forward \{[\s\S]*policy drop;/,
  );
});

test("production proxy blocks prohibited and deployment IPv4 ranges", () => {
  const { proxy } =
    renderProductionNamespaceNetworkPolicy(config);

  assert.match(proxy, /set blocked_v4/);
  assert.match(proxy, /127\.0\.0\.0\/8/);
  assert.match(proxy, /169\.254\.0\.0\/16/);
  assert.match(proxy, /192\.168\.0\.0\/16/);
  assert.match(proxy, /192\.168\.64\.0\/24/);

  assert.match(proxy, /ip daddr @blocked_v4 counter drop/);
  assert.match(proxy, /ip saddr @blocked_v4 counter drop/);
});

test("DNS exception precedes blocked destination enforcement", () => {
  const { proxy } =
    renderProductionNamespaceNetworkPolicy(config);

  const outputStart = proxy.indexOf("chain output");
  const dns = proxy.indexOf(
    "ip daddr 192.168.64.1 udp dport 53",
    outputStart,
  );
  const blocked = proxy.indexOf(
    "ip daddr @blocked_v4 counter drop",
    outputStart,
  );

  assert.ok(outputStart >= 0);
  assert.ok(dns > outputStart);
  assert.ok(blocked > dns);
});
