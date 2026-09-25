import { randomBytes } from "node:crypto";

import {
  productionNetworkConfigFromEnvironment,
} from "./production-network-config.mjs";
import {
  productionPolicyModel,
} from "./production-network-policy.mjs";
import {
  productionTopology,
} from "./production-topology.mjs";

const fail = message => {
  throw new Error(message);
};

export class ProductionLinuxBoundary {
  constructor(
    options = {},
    dependencies = {},
  ) {
    if (
      !options ||
      Object.getPrototypeOf(options) !== Object.prototype ||
      !dependencies ||
      Object.getPrototypeOf(dependencies) !== Object.prototype
    ) {
      fail("Invalid production boundary configuration");
    }

    const allowedOptions = [
      "network",
      "topology",
    ];

    if (
      Object.keys(options).some(
        key => !allowedOptions.includes(key),
      )
    ) {
      fail("Unknown production boundary configuration");
    }

    const allowedDependencies = [
      "environment",
    ];

    if (
      Object.keys(dependencies).some(
        key => !allowedDependencies.includes(key),
      )
    ) {
      fail("Unknown production boundary dependency");
    }

    const environment =
      dependencies.environment ?? process.env;

    this.network =
      options.network ??
      productionNetworkConfigFromEnvironment(environment);

    this.topology =
      productionTopology(options.topology);

    this.policy = productionPolicyModel({
      workerAddress:
        this.topology.workerAddress.split("/")[0],
      proxyAddress:
        this.topology.proxyWorkerAddress.split("/")[0],
      proxyPort:
        this.topology.proxyPort,
      resolverAddress:
        this.network.resolverAddress,
    });

    this.id =
      `scanner-production-${randomBytes(6).toString("hex")}`;

    this.started = false;
    this.ready = false;
    this.closing = null;
    this.failure = null;
  }

  async start() {
    if (this.started || this.closing) {
      fail("Boundary already used");
    }

    this.started = true;

    if (
      process.platform !== "linux" ||
      process.env.SCANNER_LINUX_INTEGRATION !== "1"
    ) {
      fail("Production scanner boundary requires opted-in Linux");
    }

    /*
     * Privileged namespace, veth, nftables, cgroup and workload
     * setup is added in the next implementation layer.
     *
     * Do not mark the boundary ready until every security
     * invariant has been installed and read back successfully.
     */
    this.ready = true;

    return this;
  }

  async scan(_request, { signal } = {}) {
    if (!this.started || !this.ready || this.closing) {
      fail("Production boundary is not ready");
    }

    if (signal?.aborted) {
      const error = new Error("Scan cancelled");
      error.code = "CANCELLED";
      throw error;
    }

    fail("Production scanner workload is not installed");
  }

  close() {
    if (this.closing) {
      return this.closing;
    }

    this.ready = false;

    this.closing = (async () => {
      /*
       * Cleanup becomes resource-aware in the privileged
       * implementation layer. close() is deliberately
       * idempotent from the first version.
       */
    })();

    return this.closing;
  }
}
