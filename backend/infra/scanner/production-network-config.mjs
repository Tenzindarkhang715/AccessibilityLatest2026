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

export function validateProductionNetworkConfig(input) {
  const keys = [
    "profile",
    "uplinkInterface",
    "gatewayAddress",
    "resolverAddress",
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
  });
}
