import { isIP } from "node:net";

import { PROHIBITED_IPV4 } from "./network-policy.mjs";

function fail() {
  throw new Error("Invalid production scanner policy configuration");
}

function ipv4(value) {
  if (typeof value !== "string" || isIP(value) !== 4) {
    fail();
  }

  return value;
}

function port(value) {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  ) {
    fail();
  }

  return value;
}

export function validateProductionPolicyConfig(input) {
  const keys = [
    "workerAddress",
    "proxyAddress",
    "proxyPort",
    "resolverAddress",
  ];

  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).length !== keys.length ||
    keys.some(key => !Object.hasOwn(input, key)) ||
    Object.keys(input).some(key => !keys.includes(key))
  ) {
    fail();
  }

  const workerAddress = ipv4(input.workerAddress);
  const proxyAddress = ipv4(input.proxyAddress);
  const resolverAddress = ipv4(input.resolverAddress);
  const proxyPort = port(input.proxyPort);

  if (
    workerAddress === proxyAddress ||
    workerAddress.startsWith("127.") ||
    proxyAddress.startsWith("127.") ||
    resolverAddress.startsWith("127.") ||
    workerAddress === "0.0.0.0" ||
    proxyAddress === "0.0.0.0" ||
    resolverAddress === "0.0.0.0"
  ) {
    fail();
  }

  return Object.freeze({
    workerAddress,
    proxyAddress,
    proxyPort,
    resolverAddress,
  });
}

export function productionPolicyModel(input) {
  const config = validateProductionPolicyConfig(input);

  return Object.freeze({
    worker: Object.freeze({
      default: "drop",
      loopback: "allow",
      established: "allow",
      outbound: Object.freeze([
        Object.freeze({
          protocol: "tcp",
          destination: config.proxyAddress,
          port: config.proxyPort,
        }),
      ]),
    }),

    proxy: Object.freeze({
      default: "drop",
      loopback: "allow",
      established: "allow",
      inbound: Object.freeze([
        Object.freeze({
          protocol: "tcp",
          source: config.workerAddress,
          port: config.proxyPort,
        }),
      ]),
      outbound: Object.freeze([
        Object.freeze({
          protocol: "udp",
          destination: config.resolverAddress,
          port: 53,
        }),
        Object.freeze({
          protocol: "tcp",
          destination: config.resolverAddress,
          port: 53,
        }),
        Object.freeze({
          protocol: "tcp",
          destinationClass: "validated-public-ipv4",
          ports: Object.freeze([80, 443]),
        }),
      ]),
      prohibitedIpv4: PROHIBITED_IPV4,
    }),
  });
}
