import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rmdir, realpath, access, readlink, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateNetworkConfig, renderNetworkPolicy } from "./network-policy.mjs";
import { verifyIdentity } from "./proxy-entry.mjs";
import { FIXTURE } from "../../test/helpers/scanner-network-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const helper = path.join(root, "test/helpers/scanner-network-fixtures.mjs");
const entry = fileURLToPath(new URL("./proxy-entry.mjs", import.meta.url));
const fail = message => { throw new Error(message); };
export const PHASES = Object.freeze(["prerequisites", "configuration", "namespaces", "links", "routes",
  "syntax", "application", "readback", "identities", "fixtures", "proxy", "readiness", "probes"]);

/** Also used by portable injected-failure tests; no stage may jump the readiness barrier. */
export async function runLifecycle(operations, cleanup) {
  try { for (const stage of PHASES) await operations[stage](); }
  catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Startup and cleanup failed"); }
    throw error;
  }
}

export function harnessConfig(input = {}) {
  const allowed = ["workerUid", "proxyUid", "fixtureUid", "control", "ipv6Probe", "fault"];
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(k => !allowed.includes(k))) fail("Unknown harness configuration");
  const c = { workerUid: 61001, proxyUid: 61002, fixtureUid: 61003, control: false, ipv6Probe: false, fault: null, ...input };
  for (const k of ["workerUid", "proxyUid", "fixtureUid"]) if (!Number.isSafeInteger(c[k]) || c[k] < 1000 || c[k] > 2147483647) fail("Invalid workload identity");
  if (new Set([c.workerUid, c.proxyUid, c.fixtureUid]).size !== 3) fail("Workload identities must differ");
  if (typeof c.control !== "boolean" || typeof c.ipv6Probe !== "boolean" || ![null, "syntax", "application", "readback"].includes(c.fault)) fail("Invalid harness mode");
  const policy = validateNetworkConfig({ profile: "ipv4-only", workerAddress: "10.77.0.2", proxyAddress: "10.77.0.1",
    resolverAddress: FIXTURE.resolver, proxyPort: 3128, workerInterface: "worker0", proxyWorkerInterface: "peer0",
    proxyUpstreamInterface: "upstream0", deploymentExclusions: ["10.77.0.0/30", "10.88.0.0/24", "10.99.0.0/30"] });
  return Object.freeze({ ...c, policy });
}

export function command(file, args, { input = "", timeout = 5000, env } = {}) {
  if (typeof file !== "string" || !Array.isArray(args) || args.some(a => typeof a !== "string" || a.includes("\0"))) return Promise.reject(new Error("Invalid command"));
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, env: env ?? { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C" }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = ""; let failure;
    const timer = setTimeout(() => { failure = new Error(`Command deadline: ${file}`); child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", b => { out += b; if (out.length > 2_000_000) { failure = new Error("Command output limit"); child.kill("SIGKILL"); } });
    child.stderr.on("data", b => { err = (err + b).slice(-8192); });
    child.on("error", error => { failure = error; });
    child.on("close", code => { clearTimeout(timer); failure || code !== 0 ? reject(failure ?? new Error(`${file} failed (${code}): ${err}`)) : resolve(out); });
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}

const ipNumber = ip => {
  if (typeof ip !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) fail("Unexpected nft address");
  const octets = ip.split(".").map(Number); if (octets.some(n => n > 255)) fail("Invalid nft address");
  return octets.reduce((n, octet) => n * 256 + octet, 0);
};
function intervals(elements) {
  const ranges = elements.map(e => {
    if (typeof e === "string") return [ipNumber(e), ipNumber(e)];
    if (e.prefix && Object.keys(e).length === 1) { const start = ipNumber(e.prefix.addr), size = 2 ** (32 - e.prefix.len);
      if (!Number.isInteger(e.prefix.len) || e.prefix.len < 0 || e.prefix.len > 32 || start % size) fail("Unexpected nft prefix");
      return [start, start + size - 1]; }
    if (e.range?.length === 2 && Object.keys(e).length === 1) return e.range.map(ipNumber);
    return fail("Unexpected nft interval representation");
  }).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of ranges) {
    if (b < a) fail("Invalid nft interval");
    const prev = merged.at(-1);
    if (prev && a <= prev[1] + 1) prev[1] = Math.max(prev[1], b); else merged.push([a, b]);
  }
  return merged;
}
/** Preserve every semantic field and rule order. Ignore only nft runtime identifiers/counters. */
export function normalizeRuleset(document) {
  if (!document || !Array.isArray(document.nftables)) fail("Invalid nft readback");
  const clean = (value, key = "") => {
    if (key === "counter") return {};
    if (Array.isArray(value)) return value.map(v => clean(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([k]) => k !== "handle" && k !== "index")
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, clean(v, k)]));
    return value;
  };
  return document.nftables.filter(item => !item.metainfo).map(item => {
    if (Object.keys(item).length !== 1 || !["table", "chain", "rule", "set"].includes(Object.keys(item)[0])) fail("Unexpected nft object");
    const copy = structuredClone(item);
    if (copy.set?.type === "ipv4_addr") copy.set.elem = intervals(copy.set.elem ?? []);
    return clean(copy);
  });
}
export function verifyRuleset(expected, actual) {
  if (!isDeepStrictEqual(normalizeRuleset(expected), normalizeRuleset(actual))) fail("Installed nft ruleset mismatch");
}
export function dropPackets(document, chain = "output", ipv6 = false) {
  return document.nftables.filter(x => x.rule?.chain === chain).reduce((sum, { rule }) => {
    if (!rule.expr.some(x => Object.hasOwn(x, "drop"))) return sum;
    const v6 = rule.expr.some(x => x.match?.left?.meta?.key === "nfproto" && x.match.right === "ipv6");
    if (ipv6 !== v6) return sum;
    return sum + rule.expr.reduce((n, e) => n + (e.counter?.packets ?? 0), 0);
  }, 0);
}

class PipePeer {
  constructor(child, onFailure) {
    this.child = child; this.next = 0; this.requests = new Map(); this.buffer = "";
    this.identity = new Promise((resolve, reject) => { this.identify = resolve; this.rejectIdentity = reject; });
    this.identity.catch(() => {});
    this.exited = new Promise(resolve => { child.once("close", code => { this.dead = true; resolve(code);
      const error = new Error("Owned workload exited"); this.rejectIdentity(error);
      for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.requests.clear(); if (!this.expectedExit) onFailure(error);
    }); });
    child.on("error", error => { this.rejectIdentity(error); onFailure(error); });
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => {}); // Never relay secret-bearing workload diagnostics.
    child.stdout.on("data", bytes => {
      this.buffer += bytes;
      if (this.buffer.length > 131072) return onFailure(new Error("Workload output limit"));
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.event === "identity") { this.identify(message.value); continue; }
          const request = this.requests.get(message.id); if (!request) throw new Error("Unexpected response");
          this.requests.delete(message.id); clearTimeout(request.timer);
          message.error ? request.reject(new Error(message.error)) : request.resolve(message.value);
        } catch { onFailure(new Error("Invalid workload protocol")); }
      }
    });
  }
  call(message) {
    if (this.dead) return Promise.reject(new Error("Workload stopped"));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error("Workload operation deadline")); }, 5000);
      this.requests.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ ...message, id }) + "\n");
    });
  }
}
const waitBounded = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Lifecycle deadline")), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

// Static shell program only. All variable data is positional, never shell-interpolated.
// It executes after entering a fresh network, PID and mount namespace.
const WORKLOAD_SETUP = `set -eu
printf '0' > "$1/cgroup.procs"
mount --make-rprivate /
mount --bind / /
mount -o remount,bind,ro /
mount -t tmpfs -o mode=700,nosuid,nodev tmpfs /root
mount -t tmpfs -o mode=700,nosuid,nodev tmpfs /home
mount -t tmpfs -o mode=755,nosuid,nodev tmpfs /run
mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs /tmp
mount --bind /sys /sys
mount -o remount,bind,ro /sys
exec setpriv --reuid="$2" --regid="$2" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs -- "$3" "$4"
`;

// kill, setgid, setuid, setpcap, net_admin, sys_admin: setup/identity/cleanup only.
const SETUP_CAPS = [5, 6, 7, 8, 12, 21].reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n);
export function verifySupervisor(status) {
  for (const name of ["CapEff", "CapPrm", "CapBnd", "CapInh", "CapAmb"]) {
    const value = status.match(new RegExp(`^${name}:\\s*([0-9a-f]+)$`, "mi"))?.[1];
    if (!value) fail("Missing supervisor capability evidence");
    const bits = BigInt(`0x${value}`);
    if (bits !== (["CapInh", "CapAmb"].includes(name) ? 0n : SETUP_CAPS)) fail("Supervisor must have only the documented setup capabilities; use linux-boundary.sh");
  }
}

export class LinuxBoundary {
  constructor(options = {}, runner = command) {
    this.config = harnessConfig(options); this.run = runner;
    this.id = `scanner-${randomBytes(6).toString("hex")}`;
    this.ns = Object.fromEntries(["w", "p", "f", "v"].map(k => [k, `${this.id}-${k}`]));
    this.created = []; this.groups = []; this.peers = []; this.events = [];
    this.secret = randomBytes(32).toString("base64url"); this.expected = {};
  }
  ip(role, ...args) { return this.run("ip", ["-n", this.ns[role], ...args]); }
  exec(role, file, args, options) { return this.run("ip", ["netns", "exec", this.ns[role], file, ...args], options); }
  async prerequisites() {
    if (process.platform !== "linux" || process.env.SCANNER_LINUX_INTEGRATION !== "1" || process.env.SCANNER_DISPOSABLE_LINUX !== "1") fail("Requires explicitly opted-in disposable Linux environment");
    if (Number(process.versions.node.split(".")[0]) < 24) fail("Node 24 or newer required");
    if (process.getuid() !== 0) fail("Trusted setup must run as root in the disposable Linux runner");
    verifySupervisor(await readFile("/proc/self/status", "utf8"));
    // Do not hide the repository or Node executable behind the private runtime mounts.
    for (const file of [await realpath(root), await realpath(process.execPath)]) {
      const info = await stat(file);
      if (info.uid !== 0 || (info.mode & 0o022)) fail("Runtime and repository paths must be root-owned and not group/world writable");
      if (["/tmp/", "/run/", "/root/", "/home/"].some(p => file.startsWith(p))) fail("Place repository and Node in root-owned globally traversable paths outside /tmp, /run, /root and /home");
    }
    for (const [file, args] of [["ip", ["-Version"]], ["nft", ["--version"]], ["setpriv", ["--version"]], ["unshare", ["--version"]], ["mount", ["--version"]], ["sysctl", ["--version"]]]) await this.run(file, args);
    if (await realpath("/var/run") !== "/run") fail("Reference runner requires /var/run -> /run");
    const passwd = await readFile("/etc/passwd", "utf8");
    for (const uid of [this.config.workerUid, this.config.proxyUid, this.config.fixtureUid]) {
      if (passwd.split("\n").some(line => Number(line.split(":")[2]) === uid)) fail("Reference workload UID already assigned");
    }
    await access(path.join(root, "dist/security/egress-proxy.js"), constants.R_OK);
    await access("/sys/fs/cgroup/cgroup.controllers", constants.R_OK);
    await access("/sys/fs/cgroup", constants.W_OK);
    const controllers = (await readFile("/sys/fs/cgroup/cgroup.subtree_control", "utf8")).trim().split(/\s+/);
    if (!["memory", "pids"].every(name => controllers.includes(name))) fail("Disposable runner must enable memory and pids cgroup controllers in advance");
    this.baseNamespaces = await this.run("ip", ["netns", "list"]);
    this.baseLinks = await this.run("ip", ["-j", "link", "show"]);
    this.hostNet = await readlink("/proc/self/ns/net");
    this.hostPid = await readlink("/proc/self/ns/pid"); this.hostMount = await readlink("/proc/self/ns/mnt");
  }
  async start() {
    if (this.started || this.closing) fail("Boundary already used"); this.started = true;
    this.signalHandler = () => this.failed(new Error("Boundary interrupted"));
    process.on("SIGTERM", this.signalHandler); process.on("SIGINT", this.signalHandler);
    const ops = Object.fromEntries(PHASES.map(stage => [stage, async () => {
      if (this.failure || this.closing) throw this.failure ?? new Error("Boundary closing");
      this.events.push(stage);
      this.inFlight = this[stage]();
      try { await this.inFlight; } finally { this.inFlight = null; }
      if (this.failure || this.closing) throw this.failure ?? new Error("Boundary closing");
    }]));
    await runLifecycle(ops, () => this.close());
    this.lease = setTimeout(() => this.failed(new Error("Boundary lifetime exceeded")), 120_000);
    this.monitor = setInterval(() => { if (!this.checking && !this.closing) {
      this.checking = this.check().catch(error => this.failed(error)).finally(() => { this.checking = null; });
    } }, 1000);
    return this;
  }
  async configuration() { this.rendered = renderNetworkPolicy(this.config.policy); }
  async namespaces() {
    for (const name of Object.values(this.ns)) { await this.run("ip", ["netns", "add", name]); this.created.push(name); }
  }
  async links() {
    for (const [a, an, b, bn, aa, ba] of [
      ["w", "worker0", "p", "peer0", "10.77.0.2/30", "10.77.0.1/30"],
      ["p", "upstream0", "f", "fixture0", "10.88.0.1/24", "10.88.0.2/24"],
      ["w", "escape0", "f", "escapepeer", "10.99.0.2/30", "10.99.0.1/30"],
    ]) {
      await this.ip(a, "link", "add", an, "type", "veth", "peer", "name", bn, "netns", this.ns[b]);
      await this.ip(a, "link", "set", an, "addrgenmode", "none");
      await this.ip(b, "link", "set", bn, "addrgenmode", "none");
      await this.ip(a, "addr", "add", aa, "dev", an); await this.ip(b, "addr", "add", ba, "dev", bn);
      // Static neighbors avoid relying on discovery traffic for denial evidence.
      const am = JSON.parse(await this.ip(a, "-j", "link", "show", an))[0].address;
      const bm = JSON.parse(await this.ip(b, "-j", "link", "show", bn))[0].address;
      await this.ip(a, "neigh", "replace", ba.split("/")[0], "lladdr", bm, "nud", "permanent", "dev", an);
      await this.ip(b, "neigh", "replace", aa.split("/")[0], "lladdr", am, "nud", "permanent", "dev", bn);
    }
    for (const role of ["w", "p", "f"]) {
      for (const setting of ["net.ipv4.ip_forward=0", "net.ipv4.conf.all.accept_redirects=0", "net.ipv4.conf.default.accept_redirects=0",
        "net.ipv4.conf.all.send_redirects=0", "net.ipv4.conf.default.send_redirects=0", "net.ipv4.conf.all.accept_source_route=0",
        "net.ipv4.conf.default.accept_source_route=0", "net.ipv6.conf.all.forwarding=0", "net.ipv6.conf.all.accept_ra=0",
        "net.ipv6.conf.default.accept_ra=0", "net.ipv6.conf.all.accept_redirects=0", "net.ipv6.conf.default.accept_redirects=0",
        "net.ipv4.ip_unprivileged_port_start=0"]) await this.exec(role, "sysctl", ["-q", "-w", setting]);
      const disable = role === "f" || (role === "w" && this.config.ipv6Probe) ? "0" : "1";
      for (const scope of ["all", "default"]) await this.exec(role, "sysctl", ["-q", "-w", `net.ipv6.conf.${scope}.disable_ipv6=${disable}`]);
    }
    for (const address of Object.values(FIXTURE).filter(v => v !== FIXTURE.host && v !== FIXTURE.gateway && !v.includes(":"))) await this.ip("f", "addr", "add", `${address}/32`, "dev", "lo");
    await this.ip("f", "-6", "addr", "add", `${FIXTURE.ipv6}/128`, "dev", "lo", "nodad");
    if (this.config.ipv6Probe) {
      await this.ip("w", "-6", "addr", "add", "2001:db8:77::2/64", "dev", "escape0", "nodad");
      await this.ip("f", "-6", "addr", "add", "2001:db8:77::1/64", "dev", "escapepeer", "nodad");
      const wm = JSON.parse(await this.ip("w", "-j", "link", "show", "escape0"))[0].address;
      const fm = JSON.parse(await this.ip("f", "-j", "link", "show", "escapepeer"))[0].address;
      await this.ip("w", "-6", "neigh", "replace", "2001:db8:77::1", "lladdr", fm, "nud", "permanent", "dev", "escape0");
      await this.ip("f", "-6", "neigh", "replace", "2001:db8:77::2", "lladdr", wm, "nud", "permanent", "dev", "escapepeer");
    }
  }
  async routes() {
    for (const address of Object.values(FIXTURE).filter(v => !v.includes(":"))) {
      if (address !== FIXTURE.gateway) await this.ip("w", "route", "add", `${address}/32`, "via", "10.99.0.1", "dev", "escape0", "onlink");
      if (!address.startsWith("10.88.0.")) await this.ip("p", "route", "add", `${address}/32`, "via", "10.88.0.2", "dev", "upstream0", "onlink");
    }
    if (this.config.ipv6Probe) await this.ip("w", "-6", "route", "add", `${FIXTURE.ipv6}/128`, "via", "2001:db8:77::1", "dev", "escape0", "onlink");
    for (const role of ["w", "p", "f"]) {
      if ((await this.ip(role, "route", "show", "default")).trim()) fail("Unexpected default route");
    }
  }
  async syntax() {
    for (const [role, text] of [["w", this.rendered.worker], ["p", this.rendered.proxy]]) {
      await this.exec(role, "nft", ["--check", "--file", "-"], { input: this.config.fault === "syntax" ? "invalid nft syntax\n" : text });
    }
  }
  async application() {
    if (this.config.fault === "application") {
      // Valid syntax, nonexistent object: real kernel transaction must fail.
      await this.exec("w", "nft", ["--file", "-"], { input: "delete table inet nonexistent_scanner_table\n" });
      fail("Application fault was not rejected");
    }
    // Independent reference namespace canonicalizes the exact same renderer output.
    await this.exec("v", "nft", ["--file", "-"], { input: this.rendered.worker });
    this.expected.w = JSON.parse(await this.exec("v", "nft", ["-j", "list", "ruleset"]));
    await this.exec("v", "nft", ["delete", "table", "inet", "scanner_worker"]);
    await this.exec("v", "nft", ["--file", "-"], { input: this.rendered.proxy });
    this.expected.p = JSON.parse(await this.exec("v", "nft", ["-j", "list", "ruleset"]));
    if (!this.config.control) await this.exec("w", "nft", ["--file", "-"], { input: this.rendered.worker });
    if (!this.config.control) await this.exec("p", "nft", ["--file", "-"], { input: this.rendered.proxy });
    if (this.config.fault === "readback") await this.exec("w", "nft", ["add", "table", "inet", "unexpected_table"]);
  }
  async rules(role) { return JSON.parse(await this.exec(role, "nft", ["-j", "list", "ruleset"])); }
  async readback() {
    verifyRuleset(this.config.control ? { nftables: [] } : this.expected.w, await this.rules("w"));
    verifyRuleset(this.config.control ? { nftables: [] } : this.expected.p, await this.rules("p"));
  }
  async spawnPeer(role, uid, script) {
    const group = `/sys/fs/cgroup/${this.id}-${this.groups.length}`;
    await mkdir(group); this.groups.push(group);
    await access(`${group}/cgroup.kill`, constants.W_OK);
    await writeFile(`${group}/pids.max`, "32"); await writeFile(`${group}/memory.max`, "268435456");
    const args = ["netns", "exec", this.ns[role], "unshare", "--mount", "--pid", "--fork", "--mount-proc",
      "/bin/sh", "-c", WORKLOAD_SETUP, "scanner-workload", group, String(uid), process.execPath, script];
    const child = spawn("ip", args, { env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C" }, stdio: ["pipe", "pipe", "pipe"] });
    const peer = new PipePeer(child, error => this.failed(error)); peer.group = group; this.peers.push(peer);
    const proof = await waitBounded(peer.identity, 5000);
    verifyIdentity(proof, uid, uid);
    const netns = `net:[${(await stat(`/var/run/netns/${this.ns[role]}`)).ino}]`;
    if (proof.net !== netns || proof.net === this.hostNet || proof.pid === this.hostPid || proof.mount === this.hostMount) fail("Workload namespace verification failed");
    const pids = (await readFile(`${group}/cgroup.procs`, "utf8")).trim().split(/\s+/);
    if (!pids.length || pids.some(pid => !/^\d+$/.test(pid))) fail("Missing cgroup membership");
    for (const pid of pids) {
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      if (!new RegExp(`^Uid:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}$`, "m").test(status)
          || !/^NoNewPrivs:\s+1$/m.test(status)
          || ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].some(k => !new RegExp(`^${k}:\\s+0+$`, "m").test(status))) fail("Supervisor privilege readback failed");
    }
    return peer;
  }
  async identities() {
    this.worker = await this.spawnPeer("w", this.config.workerUid, helper);
    this.proxyPeer = await this.spawnPeer("p", this.config.proxyUid, entry);
    this.fixture = await this.spawnPeer("f", this.config.fixtureUid, helper);
    this.proxyProbe = await this.spawnPeer("p", this.config.proxyUid, helper);
    // No workload has opened a network socket before this point.
    for (const [role, links] of [["w", ["lo", "worker0", "escape0"]], ["p", ["lo", "peer0", "upstream0"]], ["f", ["lo", "fixture0", "escapepeer"]]]) {
      for (const link of links) await this.ip(role, "link", "set", link, "up");
    }
  }
  async fixtures() { await this.fixture.call({ op: "start", role: "fixture" }); }
  async proxy() { await this.proxyPeer.call({ op: "start", ...this.config.policy, secret: this.secret }); }
  async readiness() {
    const response = await this.worker.call(this.proxyMessage());
    if (!response.delivered || !response.response.startsWith("HTTP/1.1 200 ")) fail("Authenticated proxy readiness failed");
    const stats = await this.fixture.call({ op: "stats" });
    if (!(stats[`tcp:${FIXTURE.public}:80`] > 0)) fail("Readiness target did not receive connection");
  }
  async probes() {
    await this.worker.call({ op: "start", role: "worker" });
    await this.proxyProbe.call({ op: "start", role: "proxy-probe" });
    this.topology = await this.topologySnapshot();
    this.ready = true;
  }
  proxyMessage({ connect = false, credential = this.secret, hostname = "fixture.example.com" } = {}) {
    const authority = connect ? `${hostname}:443` : hostname;
    const auth = credential === null ? "" : `Proxy-Authorization: Basic ${Buffer.from(`proxy:${credential}`).toString("base64")}\r\n`;
    return { op: "probe", host: this.config.policy.proxyAddress, port: this.config.policy.proxyPort, http: true, tunnel: connect,
      payload: `${connect ? `CONNECT ${authority}` : `GET http://${hostname}/`} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n` };
  }
  async probe(message, role = "w") {
    if (!this.ready || this.closing || this.failure) throw this.failure ?? new Error("Probe startup barrier closed");
    await this.check(); return (role === "w" ? this.worker : this.proxyProbe).call(message);
  }
  async topologySnapshot() {
    const result = {};
    for (const role of ["w", "p", "f"]) {
      result[role] = {
        links: JSON.parse(await this.ip(role, "-j", "link", "show")).map(x => ({ name: x.ifname, address: x.address, mtu: x.mtu, flags: x.flags })),
        routes: JSON.parse(await this.ip(role, "-j", "route", "show", "table", "all")),
        routes6: JSON.parse(await this.ip(role, "-6", "-j", "route", "show", "table", "all")),
      };
    }
    return result;
  }
  async check() {
    if (this.failure) throw this.failure;
    await this.readback();
    if (this.topology && !isDeepStrictEqual(this.topology, await this.topologySnapshot())) fail("Namespace topology drift");
    for (const role of ["w", "p", "f"]) if ((await this.ip(role, "route", "show", "default")).trim()) fail("Unexpected external route");
  }
  failed(error) {
    if (this.closing) return;
    this.failure ??= error;
    if (!this.ready) return; // Startup unwinds only after the in-flight phase settles.
    void this.close().catch(cleanup => { this.failure = new AggregateError([error, cleanup], "Workload and cleanup failure"); });
  }
  async stopProxy() {
    this.proxyPeer.expectedExit = true;
    await writeFile(`${this.proxyPeer.group}/cgroup.kill`, "1");
    await waitBounded(this.proxyPeer.exited, 3000);
  }
  close() {
    if (this.closing) return this.closing;
    this.ready = false; clearInterval(this.monitor); clearTimeout(this.lease);
    if (this.signalHandler) { process.removeListener("SIGTERM", this.signalHandler); process.removeListener("SIGINT", this.signalHandler); }
    this.closing = (async () => {
      if (this.inFlight) await this.inFlight.catch(() => {});
      const errors = []; const attempt = async fn => { try { await fn(); } catch (e) { errors.push(e); } };
      if (this.created.includes(this.ns.w)) for (const link of ["worker0", "escape0"]) {
        // A partial setup may not yet have created the interface.
        const links = await this.ip("w", "-j", "link", "show").catch(() => "[]");
        if (JSON.parse(links).some(x => x.ifname === link)) await attempt(() => this.ip("w", "link", "set", link, "down"));
      }
      for (const peer of this.peers) { peer.expectedExit = true; peer.child.stdin.end(); }
      for (const peer of this.peers) {
        await waitBounded(peer.exited, 1000).catch(() => {});
        await attempt(async () => {
          await writeFile(`${peer.group}/cgroup.kill`, "1"); await waitBounded(peer.exited, 3000);
          if ((await readFile(`${peer.group}/cgroup.procs`, "utf8")).trim()) fail("Owned workload survived cleanup");
        });
      }
      for (const name of [...this.created].reverse()) await attempt(async () => {
        if ((await this.run("ip", ["netns", "pids", name])).trim()) fail("Namespace retains processes");
        await this.run("ip", ["netns", "delete", name]);
      });
      for (const group of [...this.groups].reverse()) await attempt(() => rmdir(group));
      if (this.baseNamespaces !== undefined) await attempt(async () => {
        if ((await this.run("ip", ["netns", "list"])) !== this.baseNamespaces) fail("Namespace inventory changed");
        // Host interfaces are never used. Compare identity/name rather than live statistics.
        const names = text => JSON.parse(text).map(x => [x.ifindex, x.ifname]).sort();
        if (!isDeepStrictEqual(names(await this.run("ip", ["-j", "link", "show"])), names(this.baseLinks))) fail("Host link inventory changed");
      });
      this.secret = null;
      if (errors.length) throw new AggregateError(errors, "Boundary cleanup failed");
    })();
    return this.closing;
  }
}
