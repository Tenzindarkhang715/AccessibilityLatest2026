import {
  PROHIBITED_IPV4,
  validateNetworkConfig,
} from "./network-policy.mjs";

function chain(name, rules) {
  return `  chain ${name} {\n`
    + `    type filter hook ${name} priority 0; policy drop;\n`
    + `    meta nfproto ipv6 counter drop\n`
    + `    ct state invalid counter drop\n`
    + rules.map(rule => `    ${rule}\n`).join("")
    + `    counter drop\n`
    + `  }\n`;
}

export function renderProductionNamespaceNetworkPolicy(input) {
  const config = validateNetworkConfig(input);

  const blocked = [
    ...new Set([
      ...PROHIBITED_IPV4,
      ...config.deploymentExclusions,
      `${config.workerAddress}/32`,
      `${config.proxyAddress}/32`,
      `${config.resolverAddress}/32`,
    ]),
  ].sort();

  const worker = `table inet scanner_worker {\n`
    + chain("output", [
      `oifname "lo" counter accept`,
      `oifname "${config.workerInterface}" ip saddr ${config.workerAddress} ip daddr ${config.proxyAddress} tcp dport ${config.proxyPort} ct state { new, established } counter accept`,
    ])
    + chain("input", [
      `iifname "lo" counter accept`,
      `iifname "${config.workerInterface}" ip saddr ${config.proxyAddress} ip daddr ${config.workerAddress} tcp sport ${config.proxyPort} ct state established counter accept`,
    ])
    + chain("forward", [])
    + `}\n`;

  const dns = (direction, protocol) =>
    direction === "output"
      ? `oifname "${config.proxyUpstreamInterface}" ip daddr ${config.resolverAddress} ${protocol} dport 53 ct state { new, established } counter accept`
      : `iifname "${config.proxyUpstreamInterface}" ip saddr ${config.resolverAddress} ${protocol} sport 53 ct state established counter accept`;

  const proxy = `table inet scanner_proxy {\n`
    + `  set blocked_v4 {\n`
    + `    type ipv4_addr; flags interval; auto-merge;\n`
    + `    elements = { ${blocked.join(", ")} }\n`
    + `  }\n`
    + chain("input", [
      `iifname "lo" counter accept`,
      `iifname "${config.proxyWorkerInterface}" ip saddr ${config.workerAddress} ip daddr ${config.proxyAddress} tcp dport ${config.proxyPort} ct state { new, established } counter accept`,
      dns("input", "udp"),
      dns("input", "tcp"),
      `ip saddr @blocked_v4 counter drop`,
      `iifname "${config.proxyUpstreamInterface}" tcp sport { 80, 443 } ct state established counter accept`,
    ])
    + chain("output", [
      `oifname "lo" counter accept`,
      `oifname "${config.proxyWorkerInterface}" ip saddr ${config.proxyAddress} ip daddr ${config.workerAddress} tcp sport ${config.proxyPort} ct state established counter accept`,
      dns("output", "udp"),
      dns("output", "tcp"),
      `ip daddr @blocked_v4 counter drop`,
      `oifname "${config.proxyUpstreamInterface}" tcp dport { 80, 443 } ct state { new, established } counter accept`,
    ])
    + chain("forward", [])
    + `}\n`;

  return Object.freeze({
    worker,
    proxy,
  });
}
