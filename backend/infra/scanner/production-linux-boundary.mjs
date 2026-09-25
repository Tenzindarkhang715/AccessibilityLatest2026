import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  command,
  validateCgroupParent,
  verifySupervisor,
} from "./linux-boundary.mjs";
import {
  renderNetworkPolicy,
} from "./network-policy.mjs";

import {
  productionNetworkConfigFromEnvironment,
} from "./production-network-config.mjs";
import {
  productionPolicyModel,
} from "./production-network-policy.mjs";
import {
  renderProductionNamespaceNetworkPolicy,
} from "./production-namespace-network-policy.mjs";
import {
  renderProductionHostNetworkPolicy,
} from "./production-host-network-policy.mjs";
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

    this.renderedPolicy =
      renderProductionNamespaceNetworkPolicy({
        workerAddress:
          this.topology.workerAddress.split("/")[0],
        proxyAddress:
          this.topology.proxyWorkerAddress.split("/")[0],
        resolverAddress:
          this.network.resolverAddress,
        proxyPort:
          this.topology.proxyPort,
        workerInterface: "worker0",
        proxyWorkerInterface: "peer0",
        proxyUpstreamInterface: "upstream0",
        deploymentExclusions:
          this.network.deploymentExclusions,
        profile: "ipv4-only",
      });

    const token = randomBytes(6).toString("hex");

    this.id = `scanner-production-${token}`;
    this.ns = Object.freeze({
      worker: `${this.id}-w`,
      proxy: `${this.id}-p`,
    });

    /*
     * Linux interface names are limited to IFNAMSIZ-1 (15) bytes.
     * Only this endpoint remains visible in the host namespace.
     */
    this.hostInterface = `sp${token}`;

    this.renderedHostPolicy =
      renderProductionHostNetworkPolicy({
        hostInterface: this.hostInterface,
        uplinkInterface:
          this.network.uplinkInterface,
        proxyAddress:
          this.topology.proxyUpstreamAddress.split("/")[0],
        resolverAddress:
          this.network.resolverAddress,
      });

    this.createdNamespaces = [];
    this.hostLinkCreated = false;

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

    this.cgroupParent = await validateCgroupParent(
      this.environment.SCANNER_CGROUP_PARENT,
    );

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

  ip(namespace, ...args) {
    return this.run(
      "ip",
      ["-n", namespace, ...args],
    );
  }

  async createNetworkTopology() {
    const worker = this.ns.worker;
    const proxy = this.ns.proxy;

    await this.run(
      "ip",
      ["netns", "add", worker],
    );
    this.createdNamespaces.push(worker);

    await this.run(
      "ip",
      ["netns", "add", proxy],
    );
    this.createdNamespaces.push(proxy);

    /*
     * Worker <-> proxy segment.
     * worker0 remains in the worker namespace.
     * peer0 is created directly in the proxy namespace.
     */
    await this.ip(
      worker,
      "link",
      "add",
      "worker0",
      "type",
      "veth",
      "peer",
      "name",
      "peer0",
      "netns",
      proxy,
    );

    await this.ip(
      worker,
      "addr",
      "add",
      this.topology.workerAddress,
      "dev",
      "worker0",
    );

    await this.ip(
      proxy,
      "addr",
      "add",
      this.topology.proxyWorkerAddress,
      "dev",
      "peer0",
    );

    /*
     * Proxy <-> host boundary segment.
     * Create the host endpoint first, then move its peer into
     * the proxy namespace. The host endpoint is scanner-owned.
     */
    await this.run(
      "ip",
      [
        "link",
        "add",
        this.hostInterface,
        "type",
        "veth",
        "peer",
        "name",
        "upstream0",
      ],
    );
    this.hostLinkCreated = true;

    await this.run(
      "ip",
      [
        "link",
        "set",
        "upstream0",
        "netns",
        proxy,
      ],
    );

    await this.ip(
      proxy,
      "addr",
      "add",
      this.topology.proxyUpstreamAddress,
      "dev",
      "upstream0",
    );

    await this.run(
      "ip",
      [
        "addr",
        "add",
        this.topology.hostBoundaryAddress,
        "dev",
        this.hostInterface,
      ],
    );

    for (const [namespace, name] of [
      [worker, "lo"],
      [worker, "worker0"],
      [proxy, "lo"],
      [proxy, "peer0"],
      [proxy, "upstream0"],
    ]) {
      await this.ip(
        namespace,
        "link",
        "set",
        name,
        "up",
      );
    }

    await this.run(
      "ip",
      [
        "link",
        "set",
        this.hostInterface,
        "up",
      ],
    );
  }

  nft(namespace, args, options = {}) {
    return this.run(
      "ip",
      ["netns", "exec", namespace, "nft", ...args],
      options,
    );
  }

  async installNamespacePolicy() {
    await this.nft(
      this.ns.worker,
      ["--file", "-"],
      {
        input: this.renderedPolicy.worker,
      },
    );

    await this.nft(
      this.ns.proxy,
      ["--file", "-"],
      {
        input: this.renderedPolicy.proxy,
      },
    );
  }

  async installHostPolicy() {
    await this.run(
      "nft",
      ["--file", "-"],
      {
        input: this.renderedHostPolicy,
      },
    );
  }

  async createRoutes() {
    const workerGateway =
      this.topology.proxyWorkerAddress.split("/")[0];

    const proxyGateway =
      this.topology.hostBoundaryAddress.split("/")[0];

    await this.ip(
      this.ns.worker,
      "route",
      "add",
      "default",
      "via",
      workerGateway,
      "dev",
      "worker0",
    );

    await this.ip(
      this.ns.proxy,
      "route",
      "add",
      "default",
      "via",
      proxyGateway,
      "dev",
      "upstream0",
    );
  }

  async start() {
    if (this.started || this.closing) {
      fail("Boundary already used");
    }

    this.started = true;

    try {
      await this.prerequisites();
      await this.createNetworkTopology();
      await this.createRoutes();
      await this.installNamespacePolicy();
      await this.installHostPolicy();

      /*
       * nftables, cgroups and workloads are installed in
       * subsequent layers. Readiness remains false until the
       * complete security boundary exists.
       */
      this.ready = false;

      return this;
    } catch (error) {
      try {
        await this.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Production boundary startup and cleanup failed",
        );
      }

      throw error;
    }
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
      const errors = [];

      const attempt = async operation => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };

      /*
       * Deleting the host endpoint deletes its veth peer too.
       * If startup failed before the peer moved namespaces,
       * this still removes the complete scanner-owned pair.
       */
      if (this.hostLinkCreated) {
        await attempt(
          () => this.run(
            "ip",
            ["link", "delete", this.hostInterface],
          ),
        );
        this.hostLinkCreated = false;
      }

      for (
        const namespace of [...this.createdNamespaces].reverse()
      ) {
        await attempt(async () => {
          const pids = (
            await this.run(
              "ip",
              ["netns", "pids", namespace],
            )
          ).trim();

          if (pids) {
            fail("Production namespace retains processes");
          }

          await this.run(
            "ip",
            ["netns", "delete", namespace],
          );
        });
      }

      this.createdNamespaces = [];

      if (errors.length) {
        throw new AggregateError(
          errors,
          "Production boundary cleanup failed",
        );
      }
    })();

    return this.closing;
  }
}
