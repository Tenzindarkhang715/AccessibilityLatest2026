import { isIP } from "node:net";

// Mirrored conservative IPv4 exclusions. Parity tests compare to address-policy.
export const PROHIBITED_IPV4 = Object.freeze([
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
  "192.31.196.0/24", "192.52.193.0/24", "192.88.99.0/24", "192.168.0.0/16",
  "192.175.48.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4", "168.63.129.16/32",
]);
const fail = () => { throw new Error("Invalid scanner network configuration."); };
const number = value => value.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const privateIP = ip => ip.startsWith("10.") || ip.startsWith("192.168.")
  || (ip.startsWith("172.") && +ip.split(".")[1] >= 16 && +ip.split(".")[1] <= 31);
function ipv4(value) {
  if (typeof value !== "string" || isIP(value) !== 4) fail();
  return value;
}
function cidr(value) {
  if (typeof value !== "string") fail();
  const parts = value.split("/");
  if (parts.length !== 2 || !/^(0|[1-9][0-9]?)$/.test(parts[1]) || +parts[1] > 32) fail();
  ipv4(parts[0]);
  if (number(parts[0]) % (2 ** (32 - +parts[1])) !== 0) fail();
  return value;
}
const contains = (range, ip) => {
  const [base, prefix] = range.split("/"); const size = 2 ** (32 - +prefix);
  return Math.floor(number(ip) / size) === Math.floor(number(base) / size);
};

/** Pure trusted configuration validation. No I/O, DNS, processes or rule application. */
export function validateNetworkConfig(input) {
  const keys = ["profile", "workerAddress", "proxyAddress", "resolverAddress", "proxyPort",
    "workerInterface", "proxyWorkerInterface", "proxyUpstreamInterface", "deploymentExclusions"];
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
      || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))
      || Object.keys(input).some(key => !keys.includes(key))) fail();
  if (input.profile !== "ipv4-only") fail();
  const { workerAddress, proxyAddress, resolverAddress } = input;
  [workerAddress, proxyAddress, resolverAddress].forEach(ipv4);
  if (!privateIP(workerAddress) || !privateIP(proxyAddress)
      || new Set([workerAddress, proxyAddress, resolverAddress]).size !== 3) fail();
  if (!privateIP(resolverAddress) && PROHIBITED_IPV4.some(range => contains(range, resolverAddress))) fail();
  if (!Number.isInteger(input.proxyPort) || input.proxyPort < 1024 || input.proxyPort > 65535) fail();
  for (const key of ["workerInterface", "proxyWorkerInterface", "proxyUpstreamInterface"]) {
    if (typeof input[key] !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/.test(input[key]) || input[key] === "lo") fail();
  }
  if (input.proxyWorkerInterface === input.proxyUpstreamInterface) fail();
  if (!Array.isArray(input.deploymentExclusions) || !input.deploymentExclusions.length
      || input.deploymentExclusions.length > 1024) fail();
  const exclusions = [...new Set(Array.from(input.deploymentExclusions, cidr))].sort();
  // Reject a configuration that rules out all IPv4 target traffic.
  // Numbers represent all IPv4 endpoints and the exclusive upper bound 2**32
  // exactly. Avoid signed 32-bit bitwise arithmetic for interval endpoints.
  const intervals = exclusions.map(range => {
    const [base, prefix] = range.split("/");
    const start = number(base);
    return [start, start + 2 ** (32 - Number(prefix)) - 1];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [start, end] of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  if (merged.length === 1 && merged[0][0] === 0 && merged[0][1] === 2 ** 32 - 1) fail();
  return Object.freeze({ ...input, deploymentExclusions: Object.freeze(exclusions) });
}

/** Render separate namespace rulesets only. Output is NOT evidence of enforcement. */
export function renderNetworkPolicy(input) {
  const c = validateNetworkConfig(input);
  const blocked = [...new Set([...PROHIBITED_IPV4, ...c.deploymentExclusions,
    `${c.workerAddress}/32`, `${c.proxyAddress}/32`, `${c.resolverAddress}/32`])].sort();
  const chain = (name, rules) => `  chain ${name} {\n    type filter hook ${name} priority 0; policy drop;\n    meta nfproto ipv6 counter drop\n    ct state invalid counter drop\n${rules.map(r => `    ${r}\n`).join("")}    counter drop\n  }\n`;
  const worker = `table inet scanner_worker {\n`
    + chain("output", [`oifname "${c.workerInterface}" ip saddr ${c.workerAddress} ip daddr ${c.proxyAddress} tcp dport ${c.proxyPort} ct state { new, established } counter accept`])
    + chain("input", [`iifname "${c.workerInterface}" ip saddr ${c.proxyAddress} ip daddr ${c.workerAddress} tcp sport ${c.proxyPort} ct state established counter accept`])
    + chain("forward", []) + `}\n`;
  const dns = (direction, protocol) => direction === "output"
    ? `oifname "${c.proxyUpstreamInterface}" ip daddr ${c.resolverAddress} ${protocol} dport 53 ct state { new, established } counter accept`
    : `iifname "${c.proxyUpstreamInterface}" ip saddr ${c.resolverAddress} ${protocol} sport 53 ct state established counter accept`;
  const proxy = `table inet scanner_proxy {\n  set blocked_v4 {\n    type ipv4_addr; flags interval; auto-merge;\n    elements = { ${blocked.join(", ")} }\n  }\n`
    + chain("input", [
      `iifname "${c.proxyWorkerInterface}" ip saddr ${c.workerAddress} ip daddr ${c.proxyAddress} tcp dport ${c.proxyPort} ct state { new, established } counter accept`,
      dns("input", "udp"), dns("input", "tcp"), "ip saddr @blocked_v4 counter drop",
      `iifname "${c.proxyUpstreamInterface}" tcp sport { 80, 443 } ct state established counter accept`,
    ])
    + chain("output", [
      `oifname "${c.proxyWorkerInterface}" ip saddr ${c.proxyAddress} ip daddr ${c.workerAddress} tcp sport ${c.proxyPort} ct state established counter accept`,
      dns("output", "udp"), dns("output", "tcp"), "ip daddr @blocked_v4 counter drop",
      `oifname "${c.proxyUpstreamInterface}" tcp dport { 80, 443 } ct state { new, established } counter accept`,
    ]) + chain("forward", []) + `}\n`;
  return Object.freeze({ worker, proxy });
}
