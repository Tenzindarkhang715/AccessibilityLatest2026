import { test } from "node:test";
import assert from "node:assert/strict";
import { harnessConfig, runLifecycle, PHASES, normalizeRuleset, verifyRuleset, dropPackets, command, LinuxBoundary, verifySupervisor, validateCgroupParent, workloadCgroupPath } from "../infra/scanner/linux-boundary.mjs";
import { verifyIdentity } from "../infra/scanner/proxy-entry.mjs";
import { dnsResponse } from "./helpers/scanner-network-fixtures.mjs";

test("reference configuration is immutable, exact, and rejects unsafe identities and modes", () => {
  const c = harnessConfig(); assert.ok(Object.isFrozen(c)); assert.ok(Object.isFrozen(c.policy));
  assert.equal(c.policy.profile, "ipv4-only"); assert.notEqual(c.workerUid, c.proxyUid);
  for (const value of [{ workerUid: 0 }, { proxyUid: 61001 }, { fixtureUid: -1 }, { control: "yes" },
    { ipv6Probe: 1 }, { fault: "anything" }, { command: "sh" }, { resolver: "8.8.8.8" }, { workerUid: 1.5 }]) assert.throws(() => harnessConfig(value));
});
test("command runner passes metacharacters as literal arguments without shell execution", async () => {
  const input = '$(touch forbidden); `id` $HOME "quoted"';
  const out = await command(process.execPath, ["-e", "process.stdout.write(process.argv[1])", input]);
  assert.equal(out, input);
  await assert.rejects(command(process.execPath, ["\0"]));
});
test("successful lifecycle releases probes only after identities, fixtures, proxy and readiness", async () => {
  const seen = []; let cleaned = false;
  await runLifecycle(Object.fromEntries(PHASES.map(name => [name, async () => seen.push(name)])), async () => { cleaned = true; });
  assert.deepEqual(seen, PHASES); assert.equal(cleaned, false);
  assert.ok(seen.indexOf("readiness") < seen.indexOf("probes"));
});
for (const stage of PHASES) {
  test(`failure at ${stage} prevents later phases and invokes cleanup`, async () => {
    const seen = []; let count = 0;
    const ops = Object.fromEntries(PHASES.map(name => [name, async () => { seen.push(name); if (stage === name) throw new Error("injected failure"); }]));
    await assert.rejects(runLifecycle(ops, async () => { count++; }), /injected failure/);
    assert.deepEqual(seen, PHASES.slice(0, PHASES.indexOf(stage) + 1)); assert.equal(count, 1);
  });
}
test("readiness remains a pending barrier without timing assumptions", async () => {
  let release; let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; }); let probes = false;
  const ops = Object.fromEntries(PHASES.map(name => [name, async () => {}]));
  ops.readiness = async () => { entered(); await barrier; }; ops.probes = async () => { probes = true; };
  const running = runLifecycle(ops, async () => {}); await enteredPromise;
  assert.equal(probes, false); release(); await running; assert.equal(probes, true);
});
test("cleanup failure is not hidden by startup failure", async () => {
  const ops = { prerequisites: async () => { throw new Error("startup"); } };
  await assert.rejects(runLifecycle(ops, async () => { throw new Error("cleanup"); }), error => error instanceof AggregateError && error.errors.length === 2);
});
test("unused harness cleanup is repeatable and never invokes privileged commands", async () => {
  const boundary = new LinuxBoundary({}, async () => { assert.fail("Unexpected command"); });
  const closing = boundary.close(); assert.equal(boundary.close(), closing); await closing;
  await assert.rejects(boundary.probe({ op: "probe" }));
});
const sample = () => ({ nftables: [
  { metainfo: { version: "test" } }, { table: { family: "inet", name: "scanner_worker", handle: 1 } },
  { chain: { family: "inet", table: "scanner_worker", name: "output", type: "filter", hook: "output", prio: 0, policy: "drop", handle: 2 } },
  { rule: { family: "inet", table: "scanner_worker", chain: "output", handle: 3, expr: [
    { match: { op: "==", left: { meta: { key: "nfproto" } }, right: "ipv6" } }, { counter: { packets: 3, bytes: 120 } }, { drop: null }] } },
  { set: { family: "inet", table: "scanner_worker", name: "blocked_v4", type: "ipv4_addr", flags: ["interval"], elem: [{ prefix: { addr: "10.0.0.0", len: 8 } }] } },
] });
test("readback normalization retains semantics while normalizing merged CIDRs and runtime counters", () => {
  const a = sample(), b = sample(); b.nftables[1].table.handle = 50; b.nftables[3].rule.expr[1].counter.packets = 999;
  b.nftables[4].set.elem = [{ prefix: { addr: "10.128.0.0", len: 9 } }, { prefix: { addr: "10.0.0.0", len: 9 } }];
  assert.deepEqual(normalizeRuleset(a), normalizeRuleset(b)); verifyRuleset(a, b);
});
test("complete readback rejects changed verdict, default policy, missing rule or additional table", () => {
  for (const mutate of [b => { b.nftables[2].chain.policy = "accept"; }, b => { b.nftables[3].rule.expr[2] = { accept: null }; },
    b => { b.nftables.splice(3, 1); }, b => { b.nftables.push({ table: { family: "inet", name: "extra" } }); }]) {
    const a = sample(), b = sample(); mutate(b); assert.throws(() => verifyRuleset(a, b));
  }
  assert.throws(() => normalizeRuleset({ nftables: [{ unknown: {} }] }));
  assert.equal(dropPackets(sample(), "output", true), 3); assert.equal(dropPackets(sample()), 0);
});
test("identity verification requires distinct non-root exact UIDs, all zero caps and no-new-privs", () => {
  const value = { uid: 61001, gid: 61001, groups: [], uids: "61001 61001 61001 61001", gids: "61001 61001 61001 61001",
    noNewPrivs: "1", caps: Object.fromEntries(["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].map(k => [k, "0000000000000000"])) };
  verifyIdentity(value, 61001, 61001);
  for (const k of Object.keys(value.caps)) assert.throws(() => verifyIdentity({ ...value, caps: { ...value.caps, [k]: "0000000000001000" } }, 61001, 61001));
  for (const change of [{ uid: 0 }, { noNewPrivs: "0" }, { groups: [0] }, { uids: "61001 0 61001 61001" }]) assert.throws(() => verifyIdentity({ ...value, ...change }, 61001, 61001));
});
function query(type) {
  const header = Buffer.alloc(12); header.writeUInt16BE(42); header.writeUInt16BE(0x100, 2); header.writeUInt16BE(1, 4);
  const labels = "fixture.example.com".split(".").flatMap(label => [Buffer.from([label.length]), Buffer.from(label)]);
  const tail = Buffer.alloc(5); tail.writeUInt16BE(type, 1); tail.writeUInt16BE(1, 3);
  return Buffer.concat([header, ...labels, tail]);
}
test("fixture DNS emits deterministic A/AAAA answers, zero TTL, no recursion, and controlled truncation", () => {
  const records = { "fixture.example.com": { A: ["8.8.8.8"], AAAA: ["2001:db8::1"] } };
  for (const type of [1, 28]) {
    const a = dnsResponse(query(type), records).response;
    assert.equal(a.readUInt16BE(6), 1); assert.equal(a.readUInt16BE(2) & 0x80, 0);
    assert.deepEqual(a, dnsResponse(query(type), records).response);
    const truncated = dnsResponse(query(type), records, true).response;
    assert.equal(truncated.readUInt16BE(2) & 0x200, 0x200); assert.equal(truncated.readUInt16BE(6), 0);
  }
  assert.equal(dnsResponse(query(1), {}).response.readUInt16BE(2) & 15, 3);
  assert.throws(() => dnsResponse(Buffer.alloc(2), records));
});

test("partial topology cleanup lowers worker links before deleting namespaces and is idempotent", async () => {
  const calls = [];
  const boundary = new LinuxBoundary({}, async (file, args) => {
    calls.push([file, ...args]);
    if (args.includes("-j")) return JSON.stringify([{ ifname: "worker0" }, { ifname: "escape0" }]);
    return "";
  });
  boundary.created.push(boundary.ns.w, boundary.ns.p);
  await boundary.close(); await boundary.close();
  const down = calls.findIndex(x => x.includes("down"));
  const remove = calls.findIndex(x => x.includes("delete"));
  assert.ok(down >= 0 && remove > down);
  assert.equal(calls.filter(x => x.includes("delete")).length, 2);
});
test("cleanup reports a retained namespace and still attempts independent resource deletion", async () => {
  const calls = [];
  const boundary = new LinuxBoundary({}, async (_file, args) => {
    calls.push(args);
    if (args.includes("-j")) return "[]";
    if (args.includes("pids") && args.includes(boundary.ns.p)) return "1234\n";
    return "";
  });
  boundary.created.push(boundary.ns.w, boundary.ns.p);
  await assert.rejects(boundary.close(), AggregateError);
  assert.ok(calls.some(x => x.includes("delete") && x.includes(boundary.ns.w)));
  assert.ok(!calls.some(x => x.includes("delete") && x.includes(boundary.ns.p)));
});

test("close during an in-flight startup phase waits for settlement and prevents later allocation", async () => {
  const boundary = new LinuxBoundary({}, async () => { assert.fail("Unexpected command"); });
  let release; let entered;
  const inside = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  boundary.prerequisites = async () => { entered(); await gate; };
  const starting = boundary.start(); const rejected = assert.rejects(starting, /Boundary closing/);
  await inside; const closing = boundary.close(); let settled = false;
  closing.then(() => { settled = true; }); await Promise.resolve(); assert.equal(settled, false);
  release(); await rejected; await closing;
  assert.deepEqual(boundary.events, ["prerequisites"]); assert.equal(boundary.close(), closing);
});


test("supervisor rejects excess or missing setup capabilities", () => {
  const mask = [5, 6, 7, 8, 12, 21].reduce((n, bit) => n | (1n << BigInt(bit)), 0n).toString(16);
  const status = ["CapEff", "CapPrm", "CapBnd"].map(k => `${k}: ${mask}`).concat(["CapInh: 0", "CapAmb: 0"]).join("\n");
  verifySupervisor(status);
  assert.throws(() => verifySupervisor(status.replace(`CapBnd: ${mask}`, "CapBnd: ffffffffff")));
  assert.throws(() => verifySupervisor(status.replace(`CapEff: ${mask}`, "CapEff: 0")));
  assert.throws(() => verifySupervisor(status.replace("CapAmb: 0", "CapAmb: 1")));
});

const preparedParent = "/sys/fs/cgroup/scanner-parent-abc123ABC456";
function parentFs(overrides = {}) {
  return {
    realpath: async p => p,
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, gid: 0, mode: 0o40700 }),
    statfs: async () => ({ type: 0x63677270 }),
    access: async () => {},
    readFile: async p => p.endsWith("cgroup.procs") ? "" : "memory pids",
    ...overrides,
  };
}
test("prepared cgroup parent accepts private root-owned cgroup v2 without root-directory write access", async () => {
  const fs = parentFs({ access: async p => { assert.ok(p.startsWith(preparedParent)); } });
  assert.equal(await validateCgroupParent(preparedParent, fs), preparedParent);
  assert.equal(workloadCgroupPath(preparedParent, "scanner-012345abcdef", 2), `${preparedParent}/scanner-012345abcdef-2`);
});
test("prepared parent rejects missing, root, traversal, noncanonical and unsafe filesystem handoffs", async () => {
  for (const p of [undefined, "", "/sys/fs/cgroup", preparedParent + "/", preparedParent + "/../other", "/tmp/scanner-parent-abc123ABC456"])
    await assert.rejects(validateCgroupParent(p, parentFs()));
  for (const fs of [
    parentFs({ realpath: async () => "/elsewhere" }),
    parentFs({ statfs: async () => ({ type: 0 }) }),
    parentFs({ access: async () => { throw new Error("denied"); } }),
    parentFs({ readFile: async () => "123" }),
    parentFs({ readFile: async p => p.endsWith("cgroup.procs") ? "" : "pids" }),
    ...[{ uid: 1000 }, { gid: 1000 }, { mode: 0o40777 }, { isSymbolicLink: () => true }].map(change => parentFs({
      lstat: async () => ({ ...(await parentFs().lstat()), ...change }),
    })),
  ]) await assert.rejects(validateCgroupParent(preparedParent, fs));
});
test("workload cgroup paths cannot escape the prepared parent", () => {
  for (const args of [[undefined, "scanner-012345abcdef", 0], [preparedParent, "../escape", 0],
    [preparedParent, "scanner-012345abcdef", -1], [preparedParent, "scanner-012345abcdef", 0.5]])
    assert.throws(() => workloadCgroupPath(...args));
});
test("launcher prepares and owns parent before unchanged capability drop and retains cleanup traps", async () => {
  const { readFile } = await import("node:fs/promises");
  const shell = await readFile(new URL("../infra/scanner/linux-boundary.sh", import.meta.url), "utf8");
  assert.ok(shell.indexOf("trap cleanup EXIT") < shell.indexOf("parent=$(mktemp"));
  assert.ok(shell.indexOf('chmod 700 "$parent"') < shell.indexOf("\nsetpriv"));
  assert.match(shell, /unset SCANNER_CGROUP_PARENT/);
  assert.match(shell, /SCANNER_CGROUP_PARENT=\$parent/);
  assert.match(shell, /--bounding-set=-all,\+kill,\+setgid,\+setuid,\+setpcap,\+net_admin,\+sys_admin/);
  assert.doesNotMatch(shell, /dac_override|exec setpriv/);
  assert.match(shell, /parent\/cgroup.kill/);
  assert.match(shell, /rmdir --/);
  for (const signal of ["HUP", "INT", "TERM"]) assert.ok(shell.includes(`' ${signal}`));
});
