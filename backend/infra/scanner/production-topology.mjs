import { isIP } from "node:net";

function fail() {
  throw new Error("Invalid production scanner topology");
}

function ipv4(value) {
  if (typeof value !== "string" || isIP(value) !== 4) {
    fail();
  }

  return value;
}

function prefix(value) {
  if (
    typeof value !== "string" ||
    !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(value)
  ) {
    fail();
  }

  return Number(value);
}

function cidr(value) {
  if (typeof value !== "string") {
    fail();
  }

  const parts = value.split("/");

  if (parts.length !== 2) {
    fail();
  }

  const address = ipv4(parts[0]);
  const bits = prefix(parts[1]);

  return { address, bits };
}

function number(address) {
  return address
    .split(".")
    .reduce((value, octet) => value * 256 + Number(octet), 0);
}

function sameSubnet(a, b) {
  const left = cidr(a);
  const right = cidr(b);

  if (left.bits !== right.bits) {
    return false;
  }

  const size = 2 ** (32 - left.bits);

  return (
    Math.floor(number(left.address) / size) ===
    Math.floor(number(right.address) / size)
  );
}

export function productionTopology(input = {}) {
  const config = {
    workerAddress: "10.89.0.2/30",
    proxyWorkerAddress: "10.89.0.1/30",
    proxyUpstreamAddress: "10.89.1.2/30",
    hostBoundaryAddress: "10.89.1.1/30",
    proxyPort: 18080,
    ...input,
  };

  const allowed = [
    "workerAddress",
    "proxyWorkerAddress",
    "proxyUpstreamAddress",
    "hostBoundaryAddress",
    "proxyPort",
  ];

  if (
    !input ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some(key => !allowed.includes(key))
  ) {
    fail();
  }

  for (const key of [
    "workerAddress",
    "proxyWorkerAddress",
    "proxyUpstreamAddress",
    "hostBoundaryAddress",
  ]) {
    const parsed = cidr(config[key]);

    if (
      parsed.bits !== 30 ||
      parsed.address.startsWith("127.") ||
      parsed.address === "0.0.0.0"
    ) {
      fail();
    }
  }

  if (
    !sameSubnet(
      config.workerAddress,
      config.proxyWorkerAddress,
    ) ||
    !sameSubnet(
      config.proxyUpstreamAddress,
      config.hostBoundaryAddress,
    ) ||
    sameSubnet(
      config.workerAddress,
      config.proxyUpstreamAddress,
    )
  ) {
    fail();
  }

  const addresses = [
    config.workerAddress,
    config.proxyWorkerAddress,
    config.proxyUpstreamAddress,
    config.hostBoundaryAddress,
  ].map(value => value.split("/")[0]);

  if (new Set(addresses).size !== addresses.length) {
    fail();
  }

  if (
    !Number.isInteger(config.proxyPort) ||
    config.proxyPort < 1024 ||
    config.proxyPort > 65535
  ) {
    fail();
  }

  return Object.freeze({
    workerAddress: config.workerAddress,
    proxyWorkerAddress: config.proxyWorkerAddress,
    proxyUpstreamAddress: config.proxyUpstreamAddress,
    hostBoundaryAddress: config.hostBoundaryAddress,
    proxyPort: config.proxyPort,
  });
}
