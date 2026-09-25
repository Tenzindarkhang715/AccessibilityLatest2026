import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  command,
  verifySupervisor,
} from "./linux-boundary.mjs";

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
      "runner",
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

    this.environment = environment;
    this.run = dependencies.runner ?? command;

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

  async prerequisites() {
    if (
      process.platform !== "linux" ||
      this.environment.SCANNER_LINUX_INTEGRATION !== "1"
    ) {
      fail("Production scanner boundary requires opted-in Linux");
    }

    if (Number(process.versions.node.split(".")[0]) < 24) {
      fail("Node 24 or newer required");
    }

    if (process.getuid() !== 0) {
      fail("Trusted production scanner setup must run as root");
    }

    verifySupervisor(
      await readFile("/proc/self/status", "utf8"),
    );

    for (const [file, args] of [
      ["ip", ["-Version"]],
      ["nft", ["--version"]],
      ["setpriv", ["--version"]],
      ["unshare", ["--version"]],
      ["mount", ["--version"]],
      ["sysctl", ["--version"]],
    ]) {
      await this.run(file, args);
    }

    const forwarding = (
      await this.run(
        "sysctl",
        ["-n", "net.ipv4.ip_forward"],
      )
    ).trim();

    if (forwarding !== "1") {
      fail(
        "Production scanner requires net.ipv4.ip_forward=1",
      );
    }

    const links = JSON.parse(
      await this.run(
        "ip",
        ["-j", "link", "show", "dev", this.network.uplinkInterface],
      ),
    );

    if (
      links.length !== 1 ||
      links[0]?.ifname !== this.network.uplinkInterface ||
      !Array.isArray(links[0]?.flags) ||
      !links[0].flags.includes("UP")
    ) {
      fail("Configured scanner uplink is unavailable");
    }
  }

  async start() {
    if (this.started || this.closing) {
      fail("Boundary already used");
    }

    this.started = true;

    await this.prerequisites();

    /*
     * Namespace, veth, nftables, cgroup and workload setup is
     * added only after all production prerequisites succeed.
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
