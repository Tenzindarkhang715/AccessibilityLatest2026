import { isIP } from "node:net";

const INTERFACE = /^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/;

function fail() {
  throw new Error("Invalid production host network policy");
}

function ipv4(value) {
  if (typeof value !== "string" || isIP(value) !== 4) {
    fail();
  }
  return value;
}

function interfaceName(value) {
  if (
    typeof value !== "string" ||
    !INTERFACE.test(value) ||
    value === "lo"
  ) {
    fail();
  }
  return value;
}

export function renderProductionHostNetworkPolicy(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    fail();
  }

  const keys = [
    "hostInterface",
    "uplinkInterface",
    "proxyAddress",
    "resolverAddress",
  ];

  if (
    Object.keys(input).length !== keys.length ||
    keys.some(key => !Object.hasOwn(input, key)) ||
    Object.keys(input).some(key => !keys.includes(key))
  ) {
    fail();
  }

  const hostInterface = interfaceName(input.hostInterface);
  const uplinkInterface = interfaceName(input.uplinkInterface);
  const proxyAddress = ipv4(input.proxyAddress);
  const resolverAddress = ipv4(input.resolverAddress);

  if (
    hostInterface === uplinkInterface ||
    proxyAddress === "0.0.0.0" ||
    resolverAddress === "0.0.0.0" ||
    proxyAddress.startsWith("127.") ||
    resolverAddress.startsWith("127.")
  ) {
    fail();
  }

  return `table inet scanner_production_host {
  chain forward {
    type filter hook forward priority 0; policy accept;

    iifname "${hostInterface}" ip saddr ${proxyAddress} ip daddr ${resolverAddress} udp dport 53 ct state { new, established } counter accept
    iifname "${hostInterface}" ip saddr ${proxyAddress} ip daddr ${resolverAddress} tcp dport 53 ct state { new, established } counter accept
    iifname "${hostInterface}" ip saddr ${proxyAddress} oifname "${uplinkInterface}" tcp dport { 80, 443 } ct state { new, established } counter accept

    iifname "${uplinkInterface}" oifname "${hostInterface}" ip daddr ${proxyAddress} udp sport 53 ct state established counter accept
    iifname "${uplinkInterface}" oifname "${hostInterface}" ip daddr ${proxyAddress} tcp sport { 53, 80, 443 } ct state established counter accept

    iifname "${hostInterface}" counter drop
    oifname "${hostInterface}" counter drop
  }
}

table ip scanner_production_nat {
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr ${proxyAddress} oifname "${uplinkInterface}" masquerade
  }
}
`;
}
