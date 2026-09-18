import { readFile, readlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { Resolver } from "node:dns/promises";

export async function identity() {
  if (process.platform !== "linux") throw new Error("Linux workload required");
  const status = await readFile("/proc/self/status", "utf8");
  const field = name => status.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1].trim();
  return { uid: process.getuid(), gid: process.getgid(), groups: process.getgroups(),
    uids: field("Uid"), gids: field("Gid"), noNewPrivs: field("NoNewPrivs"),
    caps: Object.fromEntries(["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].map(k => [k, field(k)])),
    net: await readlink("/proc/self/ns/net"), pid: await readlink("/proc/self/ns/pid"),
    mount: await readlink("/proc/self/ns/mnt") };
}

export function verifyIdentity(value, uid, gid) {
  if (!value || value.uid !== uid || value.gid !== gid || uid === 0 || gid === 0
      || value.noNewPrivs !== "1" || value.groups.some(g => g !== gid)
      || value.uids?.split(/\s+/).some(v => Number(v) !== uid)
      || value.gids?.split(/\s+/).some(v => Number(v) !== gid)
      || !value.uids || !value.gids
      || ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].some(k => !/^0+$/.test(value.caps?.[k] ?? ""))) {
    throw new Error("Workload privilege verification failed");
  }
}

/** Bounded supervisor pipe protocol. EOF kills this owned workload; no network control API. */
export async function serve(handler, dispose = async () => {}) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await dispose(); } finally { process.exit(0); }
  };
  process.on("SIGTERM", () => void stop());
  const watchdog = setTimeout(() => process.exit(2), 180_000);
  try {
    process.stdout.write(JSON.stringify({ event: "identity", value: await identity() }) + "\n");
    for await (const line of lines) {
      if (line.length > 65_536) throw new Error("Oversized control message");
      const message = JSON.parse(line);
      try {
        const value = await handler(message);
        process.stdout.write(JSON.stringify({ id: message.id, value }) + "\n");
      } catch {
        process.stdout.write(JSON.stringify({ id: message.id, error: "Workload operation failed" }) + "\n");
      }
    }
  } finally { clearTimeout(watchdog); await stop(); }
}

async function main() {
  let proxy;
  await serve(async message => {
    if (message.op !== "start" || proxy) throw new Error("Invalid proxy operation");
    const { createEgressProxy } = await import("../../dist/security/egress-proxy.js");
    const { createTargetResolver } = await import("../../dist/security/target-resolver.js");
    const resolve = createTargetResolver({ createResolver: () => {
      const resolver = new Resolver({ timeout: 1000, tries: 1 });
      resolver.setServers([message.resolverAddress]);
      return resolver;
    } });
    proxy = createEgressProxy({ secret: message.secret, bindAddress: message.proxyAddress, resolve });
    return { port: await proxy.listen(message.proxyPort) };
  }, async () => { await proxy?.close(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.exitCode = 1; });
}
