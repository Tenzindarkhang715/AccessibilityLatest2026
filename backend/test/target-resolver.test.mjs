import { test } from "node:test";
import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import { createTargetResolver } from "../dist/security/target-resolver.js";
import { createTargetPolicy } from "../dist/security/target-policy.js";

const signal = () => new AbortController().signal;
const noData = () => Promise.reject(Object.assign(new Error("no data"), { code: "ENODATA" }));
function fixture(v4, v6, timeoutMs = 1000) {
  const calls = [];
  const resolve = createTargetResolver({ timeoutMs, createResolver: () => ({
    resolve4: async name => { calls.push([4, name]); return typeof v4 === "function" ? v4() : v4; },
    resolve6: async name => { calls.push([6, name]); return typeof v6 === "function" ? v6() : v6; },
    cancel: () => calls.push(["cancel"]),
  }) });
  return { resolve, calls, assess: createTargetPolicy({ resolve, allowedPorts: [443] }).assess };
}

test("IPv4 resolution queries both families and uses an absolute DNS name", async () => {
  const { resolve, calls } = fixture(["8.8.8.8"], noData);
  assert.deepEqual(await resolve("EXAMPLE.COM", signal()), ["8.8.8.8"]);
  assert.deepEqual(calls, [[4, "example.com."], [6, "example.com."], ["cancel"]]);
});

test("IPv6-only and multiple allowed dual-stack answers are retained", async () => {
  const ipv6 = fixture(noData, ["2606:4700:4700::1111"]);
  assert.deepEqual((await ipv6.assess("https://example.com", signal())).addresses, ["2606:4700:4700::1111"]);
  const dual = fixture(["8.8.8.8", "1.1.1.1", "8.8.8.8"], ["2001:4860:4860::8888"]);
  assert.deepEqual((await dual.assess("https://example.com", signal())).addresses,
    ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"]);
});

test("policy rejects private IPv4, IPv6 and all mixed answer sets", async () => {
  for (const [v4, v6] of [[["127.0.0.1"], []], [[], ["::1"]], [["10.0.0.1"], []],
    [[], ["fd00::1"]], [["8.8.8.8", "192.168.1.1"], []], [["8.8.8.8"], ["fe80::1"]],
    [["169.254.169.254"], ["2606:4700::1111"]], [[], ["::ffff:8.8.8.8"]]]) {
    await assert.rejects(fixture(v4, v6).assess("https://example.com", signal()), { code: "TARGET_NOT_ALLOWED" });
  }
});

test("resolver failure in either family cannot become partial success", async () => {
  for (const code of ["ENOTFOUND", "ESERVFAIL", "ETIMEOUT", "ECANCELLED"]) {
    const failure = async () => { throw Object.assign(new Error("secret DNS details"), { code }); };
    for (const [v4, v6] of [[failure, ["2606:4700::1111"]], [["8.8.8.8"], failure]]) {
      await assert.rejects(fixture(v4, v6).resolve("example.com", signal()),
        { code: "RESOLUTION_FAILED", message: "Target resolution failed: RESOLUTION_FAILED." });
    }
  }
});

test("empty, malformed and wrong-family DNS results fail closed", async () => {
  for (const [v4, v6] of [[[], []], [noData, noData], [["::1"], []], [[], ["8.8.8.8"]],
    [["127.1"], []], [null, []], [[], ["fe80::1%en0"]]]) {
    await assert.rejects(fixture(v4, v6).resolve("example.com", signal()), { code: "RESOLUTION_FAILED" });
  }
});

test("fresh separate assessments see changed DNS instead of cached permission", async () => {
  let index = 0;
  const { assess } = fixture(() => ++index === 1 ? ["8.8.8.8"] : ["10.0.0.1"], []);
  assert.deepEqual((await assess("https://example.com", signal())).addresses, ["8.8.8.8"]);
  await assert.rejects(assess("https://example.com", signal()), { code: "TARGET_NOT_ALLOWED" });
  assert.equal(index, 2);
});

test("resolver timeout cancels outstanding DNS and rejects uncooperative seam", async () => {
  const { resolve, calls } = fixture(() => new Promise(() => {}), [], 10);
  await assert.rejects(resolve("example.com", signal()), { code: "RESOLUTION_TIMEOUT" });
  assert.ok(calls.some(([kind]) => kind === "cancel"));
});

test("pre-cancellation performs no DNS and mid-resolution cancellation fails closed", async () => {
  const before = new AbortController(); before.abort();
  const first = fixture([], []);
  await assert.rejects(first.resolve("example.com", before.signal), { code: "CANCELLED" });
  assert.deepEqual(first.calls, []);
  const during = new AbortController();
  const next = fixture(() => { during.abort(); return new Promise(() => {}); }, []);
  await assert.rejects(next.resolve("example.com", during.signal), { code: "CANCELLED" });
  assert.ok(next.calls.some(([kind]) => kind === "cancel"));
});

test("default production resolver uses Node A/AAAA methods (stubbed, no network)", async t => {
  const calls = [];
  t.mock.method(Resolver.prototype, "resolve4", async name => { calls.push(name); return ["8.8.8.8"]; });
  t.mock.method(Resolver.prototype, "resolve6", async name => { calls.push(name); return []; });
  t.mock.method(Resolver.prototype, "cancel", () => {});
  assert.deepEqual(await createTargetResolver()("example.com", signal()), ["8.8.8.8"]);
  assert.deepEqual(calls, ["example.com.", "example.com."]);
});

test("invalid resolver inputs, factory failures and timeout configuration fail closed", async () => {
  for (const timeoutMs of [0, -1, Infinity, 1.5, 2_147_483_648]) assert.throws(() => createTargetResolver({ timeoutMs }));
  for (const name of ["localhost", "8.8.8.8", "example.com..", "a b.com"]) {
    await assert.rejects(fixture([], []).resolve(name, signal()), { code: "RESOLUTION_FAILED" });
  }
  await assert.rejects(createTargetResolver({ createResolver: () => { throw new Error("secret"); } })("example.com", signal()),
    { code: "RESOLUTION_FAILED" });
});
