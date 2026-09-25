import { isIP } from "node:net";

const INTERFACE = /^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/;

function fail() {
  throw new Error("Invalid production scanner network configuration");
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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


function ipv4Number(value) {
  return value
    .split(".")
    .reduce(
      (number, octet) => number * 256 + Number(octet),
      0,
    );
}

function ipv4Cidr(value) {
  if (typeof value !== "string") {
    fail();
  }

  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    isIP(parts[0]) !== 4 ||
    !/^(?:0|[1-9]|[12][0-9]|3[0-2])$/.test(parts[1])
  ) {
    fail();
  }

  const prefix = Number(parts[1]);
  const size = 2 ** (32 - prefix);

  if (ipv4Number(parts[0]) % size !== 0) {
    fail();
  }

  return value;
}

export function validateProductionNetworkConfig(input) {
  const keys = [
    "profile",
    "uplinkInterface",
    "gatewayAddress",
    "resolverAddress",
    "deploymentExclusions",
  ];

  if (
    !plainObject(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some(key => !Object.hasOwn(input, key)) ||
    Object.keys(input).some(key => !keys.includes(key))
  ) {
    fail();
  }

  if (input.profile !== "ipv4-only") {
    fail();
  }

  const uplinkInterface =
    interfaceName(input.uplinkInterface);

  const gatewayAddress =
    ipv4(input.gatewayAddress);

  const resolverAddress =
    ipv4(input.resolverAddress);

  if (
    !Array.isArray(input.deploymentExclusions) ||
    input.deploymentExclusions.length === 0 ||
    input.deploymentExclusions.length > 1024
  ) {
    fail();
  }

  const deploymentExclusions = Object.freeze(
    [...new Set(input.deploymentExclusions.map(ipv4Cidr))].sort(),
  );

  if (
    gatewayAddress === "0.0.0.0" ||
    resolverAddress === "0.0.0.0" ||
    gatewayAddress.startsWith("127.") ||
    resolverAddress.startsWith("127.")
  ) {
    fail();
  }

  return Object.freeze({
    profile: "ipv4-only",
    uplinkInterface,
    gatewayAddress,
    resolverAddress,
    deploymentExclusions,
  });
}

export function productionNetworkConfigFromEnvironment(
  env = process.env,
) {
  return validateProductionNetworkConfig({
    profile: "ipv4-only",
    uplinkInterface:
      env.SCANNER_UPLINK_INTERFACE,
    gatewayAddress:
      env.SCANNER_UPLINK_GATEWAY,
    resolverAddress:
      env.SCANNER_UPSTREAM_DNS,
    deploymentExclusions:
      typeof env.SCANNER_DEPLOYMENT_EXCLUSIONS === "string"
        ? env.SCANNER_DEPLOYMENT_EXCLUSIONS
            .split(",")
            .map(value => value.trim())
            .filter(Boolean)
        : undefined,
  });
}
