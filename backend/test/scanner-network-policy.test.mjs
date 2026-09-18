import { test } from "node:test";
import assert from "node:assert/strict";
import { PROHIBITED_IPV4, validateNetworkConfig, renderNetworkPolicy } from "../infra/scanner/network-policy.mjs";
import { assessAddress } from "../dist/security/address-policy.js";
const config = () => ({ profile: "ipv4-only", workerAddress: "10.77.0.2", proxyAddress: "10.77.0.1",
  resolverAddress: "10.88.0.53", proxyPort: 3128, workerInterface: "worker0",
  proxyWorkerInterface: "peer0", proxyUpstreamInterface: "upstream0", deploymentExclusions: ["11.0.0.0/24"] });

test("renders deterministic separate immutable namespace policies without mutating configuration", () => {
  const c = config(); const snapshot = structuredClone(c);
  const result = renderNetworkPolicy(c);
  assert.deepEqual(result, renderNetworkPolicy(c)); assert.deepEqual(c, snapshot);
  assert.ok(Object.isFrozen(result)); assert.match(result.worker, /^table inet scanner_worker/);
  assert.match(result.proxy, /^table inet scanner_proxy/);
});
test("worker permits only the exact interface/address/port TCP tuple and its replies", () => {
  const { worker } = renderNetworkPolicy(config());
  assert.match(worker, /oifname "worker0" ip saddr 10\.77\.0\.2 ip daddr 10\.77\.0\.1 tcp dport 3128/);
  assert.match(worker, /iifname "worker0" ip saddr 10\.77\.0\.1 ip daddr 10\.77\.0\.2 tcp sport 3128 ct state established/);
  assert.equal(worker.match(/counter accept/g).length, 2);
});
test("all chains default deny, worker has no UDP DNS loopback or forwarding allowance", () => {
  for (const text of Object.values(renderNetworkPolicy(config()))) {
    assert.equal(text.match(/policy drop/g).length, 3);
    assert.equal(text.match(/meta nfproto ipv6 counter drop/g).length, 3);
    assert.match(text, /chain forward \{[^}]*counter drop\n  \}/);
  }
  const { worker } = renderNetworkPolicy(config());
  assert.doesNotMatch(worker, /udp|dport 53|127\.0\.0\.1|iifname "lo"|oifname "lo"/);
});
test("proxy DNS is limited to the explicit resolver and upstream interface for TCP and UDP", () => {
  const { proxy } = renderNetworkPolicy(config());
  for (const protocol of ["tcp", "udp"]) {
    assert.ok(proxy.includes(`oifname "upstream0" ip daddr 10.88.0.53 ${protocol} dport 53 ct state { new, established } counter accept`));
    assert.ok(proxy.includes(`iifname "upstream0" ip saddr 10.88.0.53 ${protocol} sport 53 ct state established counter accept`));
  }
  assert.equal(proxy.match(/udp/g).length, 2);
});
test("proxy target ports follow deny sets; deployment and infrastructure destinations are excluded", () => {
  const { proxy } = renderNetworkPolicy(config());
  for (const range of ["11.0.0.0/24", "10.77.0.2/32", "10.77.0.1/32", "10.88.0.53/32", ...PROHIBITED_IPV4]) assert.ok(proxy.includes(range));
  assert.ok(proxy.indexOf("ip daddr @blocked_v4 counter drop") < proxy.indexOf("tcp dport { 80, 443 }"));
  assert.ok(proxy.indexOf("ip saddr @blocked_v4 counter drop") < proxy.indexOf("tcp sport { 80, 443 }"));
  assert.doesNotMatch(proxy, /flush ruleset|masquerade|dnat|redirect/);
});
test("configuration rejects missing unknown unsafe contradictory and unsupported values", () => {
  for (const key of Object.keys(config())) { const c = config(); delete c[key]; assert.throws(() => renderNetworkPolicy(c)); }
  for (const [key, value] of [["profile", "dual-stack"], ["workerAddress", "127.0.0.1"],
    ["proxyAddress", "0.0.0.0"], ["proxyAddress", "10.77.0.2"], ["workerAddress", "8.8.8.8"],
    ["resolverAddress", "169.254.169.254"], ["resolverAddress", "::1"], ["resolverAddress", "dns.example.com"],
    ["resolverAddress", "10.77.0.1"], ["proxyPort", 0], ["proxyPort", 443], ["proxyPort", 65536], ["proxyPort", "3128"],
    ["workerInterface", "lo"], ["workerInterface", 'x"; accept'], ["proxyUpstreamInterface", "peer0"],
    ["deploymentExclusions", []], ["deploymentExclusions", ["11.0.0.1/24"]],
    ["deploymentExclusions", ["0.0.0.0/0"]], ["deploymentExclusions", ["::/0"]],
    ["deploymentExclusions", new Array(1)], ["deploymentExclusions", ["11.0.0.0/24; accept"]]]) {
    assert.throws(() => renderNetworkPolicy({ ...config(), [key]: value }), `${key}=${value}`);
  }
  for (const c of [null, [], {}, { ...config(), answers: ["8.8.8.8"] }]) assert.throws(() => renderNetworkPolicy(c));
});
test("no DNS-answer input or dynamic destination allowlist exists", () => {
  for (const key of ["dnsAnswers", "allowedTargets", "resolve", "allowPrivate", "ipv6"]) {
    assert.throws(() => renderNetworkPolicy({ ...config(), [key]: ["8.8.8.8"] }));
  }
  const normalized = validateNetworkConfig(config());
  assert.ok(Object.isFrozen(normalized.deploymentExclusions));
});
test("mirrored IPv4 exclusions agree with production policy at every boundary and representative addresses", () => {
  const n = ip => ip.split(".").reduce((v, x) => v * 256 + +x, 0);
  const ip = n => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join(".");
  const ranges = PROHIBITED_IPV4.map(c => { const [base, bits] = c.split("/"); return [n(base), n(base) + 2 ** (32 - +bits) - 1]; });
  const samples = new Set([n("8.8.8.8"), n("1.1.1.1"), n("11.0.0.1")]);
  for (const [a, b] of ranges) for (const v of [a - 1, a, b, b + 1]) if (v >= 0 && v <= 0xffffffff) samples.add(v);
  // Uniform coverage additionally detects policy additions away from current boundaries.
  for (let first = 0; first < 256; first++) for (let second = 0; second < 256; second++) samples.add(n(`${first}.${second}.0.1`));
  for (const v of samples) assert.equal(assessAddress(ip(v)).allowed, !ranges.some(([a, b]) => v >= a && v <= b), ip(v));
});

for (const [name, exclusions] of [
  ["single /0", ["0.0.0.0/0"]],
  ["split /1 coverage", ["0.0.0.0/1", "128.0.0.0/1"]],
  ["unordered coverage", ["128.0.0.0/1", "0.0.0.0/1"]],
  ["four adjacent quarters", ["0.0.0.0/2", "64.0.0.0/2", "128.0.0.0/2", "192.0.0.0/2"]],
  ["overlapping and adjacent unordered coverage", ["192.0.0.0/2", "0.0.0.0/2",
    "128.0.0.0/2", "0.0.0.0/1", "32.0.0.0/3", "128.0.0.0/1"]],
]) {
  test(`rejects full IPv4 interval union: ${name}`, () => {
    const c = { ...config(), deploymentExclusions: exclusions };
    assert.throws(() => validateNetworkConfig(c), /Invalid scanner network configuration/);
    assert.throws(() => renderNetworkPolicy(c), /Invalid scanner network configuration/);
  });
}

// Canonical CIDRs covering every address except one, without enumerating addresses.
function allExcept(address) {
  const value = address.split(".").reduce((n, part) => n * 256 + Number(part), 0);
  const format = n => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join(".");
  const ranges = [];
  for (let prefix = 1; prefix <= 32; prefix++) {
    const size = 2 ** (32 - prefix);
    const parent = Math.floor(value / (2 * size)) * (2 * size);
    const sibling = value < parent + size ? parent + size : parent;
    ranges.push(`${format(sibling)}/${prefix}`);
  }
  return ranges.reverse();
}
for (const gap of ["0.0.0.0", "8.8.8.8", "255.255.255.255"]) {
  test(`accepts near-complete coverage with exactly one address gap: ${gap}`, () => {
    const exclusions = allExcept(gap);
    const size = exclusions.reduce((sum, range) => sum + 2 ** (32 - Number(range.split("/")[1])), 0);
    assert.equal(size, 2 ** 32 - 1);
    const c = { ...config(), deploymentExclusions: exclusions };
    assert.doesNotThrow(() => validateNetworkConfig(c));
    assert.doesNotThrow(() => renderNetworkPolicy(c));
  });
}
test("accepts a remaining range and preserves exclusion rendering without replacing CIDRs by merged intervals", () => {
  const exclusions = ["128.0.0.0/2", "0.0.0.0/1", "64.0.0.0/2"];
  const c = { ...config(), deploymentExclusions: exclusions };
  assert.deepEqual(validateNetworkConfig(c).deploymentExclusions, [...exclusions].sort());
  const rendered = renderNetworkPolicy(c);
  assert.equal(rendered.worker, renderNetworkPolicy(config()).worker);
  const expected = [...new Set([...PROHIBITED_IPV4, ...exclusions,
    `${c.workerAddress}/32`, `${c.proxyAddress}/32`, `${c.resolverAddress}/32`])].sort();
  assert.ok(rendered.proxy.includes(`elements = { ${expected.join(", ")} }`));
});
