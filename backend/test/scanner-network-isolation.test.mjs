import { test } from "node:test";
import assert from "node:assert/strict";
import { LinuxBoundary, dropPackets } from "../infra/scanner/linux-boundary.mjs";
import { FIXTURE } from "./helpers/scanner-network-fixtures.mjs";

const opted = process.env.SCANNER_LINUX_INTEGRATION === "1";
const unavailable = process.platform !== "linux" ? `LINUX INTEGRATION: NOT RUN — host is ${process.platform}; requires Linux namespaces, nftables and cgroup v2`
  : "LINUX INTEGRATION: NOT RUN — explicit SCANNER_LINUX_INTEGRATION=1 and disposable-runner acknowledgement required";

const cases = [
  ["direct public IPv4", FIXTURE.public, 9000], ["private IPv4", FIXTURE.private, 9000],
  ["link-local", FIXTURE.link, 9000], ["metadata", FIXTURE.metadata, 9000],
  ["loopback", "127.0.0.1", 9000, "tcp", "w"], ["simulated host", FIXTURE.host, 9000],
  ["simulated gateway", FIXTURE.gateway, 9000], ["proxy other port", "10.77.0.1", 9000, "tcp", "p"],
  ["UDP", FIXTURE.public, 9999, "udp"], ["worker DNS", FIXTURE.public, 53, "udp"],
  ["QUIC-style UDP", FIXTURE.public, 443, "udp"], ["STUN-style UDP", FIXTURE.public, 3478, "udp"],
  ["IPv6", FIXTURE.ipv6, 9000], ["IPv4-mapped IPv6", "::ffff:8.8.8.8", 9000],
];
const peerFor = (h, role) => role === "w" ? h.worker : role === "p" ? h.proxyProbe : h.fixture;
const receiptKey = (host, port, transport = "tcp") => `${transport}:${host.replace(/^::ffff:/, "")}:${port}`;
const probe = (host, port, transport = "tcp") => ({ op: "probe", host, port, transport });
async function withBoundary(options, action) {
  const h = new LinuxBoundary(options);
  try { await h.start(); return await action(h); } finally { await h.close(); }
}
async function route(h, host, role = "w") {
  const mapped = host.replace(/^::ffff:/, "");
  return h.ip(role, ...(mapped.includes(":") ? ["-6"] : []), "-j", "route", "get", mapped);
}

// Never replace this suite with mocks. Opting in on an unsuitable host fails prerequisites.
test("Linux disconnected enforcement integration", { skip: opted ? false : unavailable, timeout: 180_000 }, async t => {
  assert.equal(process.platform, "linux", "Explicit Linux integration requires a real Linux environment");
  assert.equal(process.env.SCANNER_DISPOSABLE_LINUX, "1", "Use an isolated disposable Linux runner");
  const controls = new Map();
  await t.test("fresh unprotected control proves every forbidden worker destination is genuinely reachable", async () => {
    await withBoundary({ control: true, ipv6Probe: true }, async h => {
      for (const [name, host, port, transport = "tcp", destination = "f"] of cases) {
        const receiver = peerFor(h, destination), key = receiptKey(host, port, transport);
        const before = await receiver.call({ op: "stats" }); const installedRoute = await route(h, host);
        const result = await h.probe(probe(host, port, transport));
        assert.equal(result.delivered, true, name);
        const after = await receiver.call({ op: "stats" }); assert.ok((after[key] ?? 0) > (before[key] ?? 0), name);
        controls.set(name, { installedRoute, delivered: true });
      }
      assert.equal((await h.probe(probe(FIXTURE.private, 9000), "p")).delivered, true);
      assert.deepEqual((await h.probe({ op: "resolve", server: FIXTURE.resolver })).answers, [FIXTURE.public]);
    });
  });
  // The control has been destroyed before this protected topology is created.
  await withBoundary({ ipv6Probe: true }, async h => {
    for (const [name, host, port, transport = "tcp", destination = "f"] of cases) {
      await t.test(`firewall blocks ${name} despite route and listening fixture`, async () => {
        assert.equal(controls.get(name)?.delivered, true);
        const receiver = peerFor(h, destination), key = receiptKey(host, port, transport);
        const before = await receiver.call({ op: "stats" }); const routeBefore = await route(h, host);
        const packets = dropPackets(await h.rules("w"), "output", name === "IPv6");
        assert.equal((await h.probe(probe(host, port, transport))).delivered, false);
        const after = await receiver.call({ op: "stats" }); assert.equal(after[key] ?? 0, before[key] ?? 0);
        assert.ok(dropPackets(await h.rules("w"), "output", name === "IPv6") > packets, "Corresponding firewall drop counter must increase");
        assert.equal(await route(h, host), routeBefore);
        const listeners = await receiver.call({ op: "listeners" });
        assert.ok(listeners.some(x => x.address === host.replace(/^::ffff:/, "") && x.port === port), "Fixture still listening");
      });
    }
    await t.test("worker cannot use even the configured infrastructure DNS resolver", async () => {
      const before = await h.fixture.call({ op: "stats" });
      const count = dropPackets(await h.rules("w"));
      const installedRoute = await route(h, FIXTURE.resolver);
      assert.equal((await h.probe({ op: "resolve", server: FIXTURE.resolver })).failed, true);
      assert.deepEqual(await h.fixture.call({ op: "stats" }), before);
      assert.ok(dropPackets(await h.rules("w")) > count);
      assert.equal(await route(h, FIXTURE.resolver), installedRoute);
    });
    for (const connect of [false, true]) await t.test(`authenticated ${connect ? "CONNECT" : "HTTP"} reaches approved pinned fixture`, async () => {
      const before = await h.fixture.call({ op: "stats" });
      const response = await h.probe(h.proxyMessage({ connect }));
      assert.match(response.response, /^HTTP\/1.1 200 /);
      if (connect) assert.ok(response.response.endsWith("fixture-tunnel"));
      const key = receiptKey(FIXTURE.public, connect ? 443 : 80);
      assert.ok((await h.fixture.call({ op: "stats" }))[key] > (before[key] ?? 0));
    });
    for (const credential of [null, "wrong"]) await t.test(`${credential === null ? "missing" : "bad"} credentials reject without target connection`, async () => {
      const before = await h.fixture.call({ op: "stats" });
      assert.match((await h.probe(h.proxyMessage({ credential }))).response, /^HTTP\/1.1 407 /);
      assert.deepEqual(await h.fixture.call({ op: "stats" }), before);
    });
    await t.test("mixed and prohibited A/AAAA answers never connect; changed answers are reassessed", async () => {
      for (const records of [{ A: [FIXTURE.public, FIXTURE.private], AAAA: [] },
        { A: [FIXTURE.public], AAAA: ["fd00::1"] }, { A: [FIXTURE.private], AAAA: [] }]) {
        await h.fixture.call({ op: "dns", records: { "fixture.example.com": records } });
        const before = await h.fixture.call({ op: "stats" });
        assert.match((await h.probe(h.proxyMessage())).response, /^HTTP\/1.1 403 /);
        const after = await h.fixture.call({ op: "stats" });
        for (const key of Object.keys(after).filter(k => k.startsWith("tcp:") && !k.endsWith(":53"))) assert.equal(after[key], before[key]);
        assert.ok(after["dns-udp:fixture.example.com"] > before["dns-udp:fixture.example.com"]);
      }
      await h.fixture.call({ op: "dns", records: { "fixture.example.com": { A: [FIXTURE.public], AAAA: [] } } });
      assert.match((await h.probe(h.proxyMessage())).response, /^HTTP\/1.1 200 /);
    });
    await t.test("proxy direct prohibited-IP dialing is blocked independently of application policy", async () => {
      const before = await h.fixture.call({ op: "stats" }); const r = await route(h, FIXTURE.private, "p");
      const count = dropPackets(await h.rules("p"));
      assert.equal((await h.probe(probe(FIXTURE.private, 9000), "p")).delivered, false);
      assert.ok(dropPackets(await h.rules("p")) > count);
      assert.deepEqual(await h.fixture.call({ op: "stats" }), before); assert.equal(await route(h, FIXTURE.private, "p"), r);
    });
    await t.test("proxy DNS supports configured UDP and TCP fallback, never alternate resolver", async () => {
      const normal = { "fixture.example.com": { A: [FIXTURE.public], AAAA: [] } };
      await h.fixture.call({ op: "dns", records: normal });
      assert.deepEqual((await h.probe({ op: "resolve", server: FIXTURE.resolver }, "p")).answers, [FIXTURE.public]);
      const before = await h.fixture.call({ op: "stats" });
      await h.fixture.call({ op: "dns", records: normal, truncated: true });
      assert.deepEqual((await h.probe({ op: "resolve", server: FIXTURE.resolver }, "p")).answers, [FIXTURE.public]);
      const after = await h.fixture.call({ op: "stats" });
      assert.ok(after["dns-tcp:fixture.example.com"] > (before["dns-tcp:fixture.example.com"] ?? 0));
      assert.ok(after["dns-udp:fixture.example.com"] > before["dns-udp:fixture.example.com"]);
      const count = dropPackets(await h.rules("p"));
      assert.equal((await h.probe({ op: "resolve", server: FIXTURE.wrongResolver }, "p")).failed, true);
      assert.equal((await h.probe(probe(FIXTURE.wrongResolver, 53), "p")).delivered, false);
      assert.equal((await h.probe(probe(FIXTURE.resolver, 9000), "p")).delivered, false);
      assert.ok(dropPackets(await h.rules("p")) > count);
      await h.fixture.call({ op: "dns", records: normal });
    });
    await t.test("worker and proxy identities cannot modify routes or firewall", async () => {
      for (const role of ["w", "p"]) assert.deepEqual(await h.probe({ op: "admin" }, role), [{ denied: true }, { denied: true }]);
      await h.check();
    });
    await t.test("proxy outage cannot enable worker direct fallback", async () => {
      await h.stopProxy();
      assert.equal((await h.probe(h.proxyMessage())).delivered, false);
      const count = dropPackets(await h.rules("w"));
      assert.equal((await h.probe(probe(FIXTURE.public, 9000))).delivered, false);
      assert.ok(dropPackets(await h.rules("w")) > count);
    });
  });
  for (const fault of ["syntax", "application", "readback"]) await t.test(`${fault} failure prevents workload startup and cleans topology`, async () => {
    const h = new LinuxBoundary({ fault });
    await assert.rejects(h.start()); await h.close();
    assert.equal(h.events.includes("identities"), false); assert.equal(h.peers.length, 0);
    assert.equal(h.events.includes("probes"), false);
  });
  await t.test("ordinary IPv4-only profile disables IPv6 and teardown is idempotent", async () => {
    const h = new LinuxBoundary();
    try {
      await h.start();
      for (const role of ["w", "p"]) assert.equal((await h.exec(role, "sysctl", ["-n", "net.ipv6.conf.all.disable_ipv6"])).trim(), "1");
    } finally { const closing = h.close(); assert.equal(h.close(), closing); await closing; }
  });
});
