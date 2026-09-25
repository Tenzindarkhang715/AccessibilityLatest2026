import { test } from "node:test";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { createTargetPolicy, TargetPolicyError } from "../dist/security/target-policy.js";
import { TestService } from "../dist/test-service.js";
import { MemoryTestRepository } from "../dist/memory-test-repository.js";

const signal = () => new AbortController().signal;
const policy = (resolve = async () => ["8.8.8.8"], other = {}) =>
  createTargetPolicy({ allowedPorts: [80, 443], resolve, ...other });
const failure = code => error => error instanceof TargetPolicyError && error.code === code;

test("normalizes public URLs, IDNs, trailing dots and all DNS answers without fetching", async () => {
  const calls = [];
  const instance = policy(async (hostname, receivedSignal) => {
    calls.push(hostname); assert.ok(receivedSignal instanceof AbortSignal);
    return ["8.8.8.8", "2606:4700:4700:0:0:0:0:1111", "8.8.8.8"];
  });
  const result = await instance.assess("HTTPS://EXAMPLE.COM.:443/path?q=1#section", signal());
  assert.equal(result.url, "https://example.com/path?q=1#section");
  assert.equal(result.kind, "assessment-only");
  assert.equal(result.requiresConnectionEnforcement, true);
  assert.deepEqual(result.addresses, ["8.8.8.8", "2606:4700:4700::1111"]);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.addresses));
  await instance.assess("http://bücher.de/", signal());
  assert.deepEqual(calls, ["example.com", "xn--bcher-kva.de"]);
});

test("public IP literals bypass DNS and alternative URL IPv4 spellings are canonicalized", async () => {
  const instance = policy(async () => { assert.fail("IP literal must not resolve"); });
  for (const value of ["https://8.8.8.8/", "http://0x08080808/", "http://134744072/",
    "https://[2606:4700:4700::1111]/"]) {
    assert.equal((await instance.assess(value, signal())).addresses.length, 1);
  }
});

test("rejects unsafe URL syntax, schemes, credentials and prohibited hostnames before DNS", async () => {
  const instance = policy(async () => { assert.fail("Invalid targets must not resolve"); });
  for (const url of ["", "example.com", "/relative", "//example.com", "https:example.com",
    "https:///example.com", " https://example.com", "https://exam\nple.com", "https://example.com/has space",
    "https://example.com\\@8.8.8.8", "file:///etc/passwd", "ftp://example.com", "data:text/html,hi",
    "javascript:alert(1)", "ws://example.com", "https://user:password@example.com", "https://@example.com",
    "https://user%40name@example.com", "http://localhost", "http://LOCALHOST.", "http://a.localhost",
    "http://printer", "http://a.local", "http://a.internal", "http://a.home.arpa", "http://a.test",
    "http://a.invalid", "http://a.example", "http://a.onion", "http://metadata.google.internal",
    "http://metadata.goog", "http://instance-data.ec2.internal", "http://a..com", "http://-a.com",
    "http://foo_bar.com", "http://example.com..", "http://[fe80::1%25en0]/", "http://example.com:8080"]) {
    await assert.rejects(instance.assess(url, signal()), failure("TARGET_NOT_ALLOWED"), url);
  }
});

test("rejects prohibited literals including alternate and encoded loopback representations", async () => {
  const instance = policy(async () => { assert.fail("Literal must not resolve"); });
  for (const host of ["127.0.0.1", "127.1", "2130706433", "0x7f000001", "0177.0.0.1",
    "%31%32%37.0.0.1", "127.0.0.1.", "0", "10.1.2.3", "172.16.1.1", "192.168.1.1",
    "169.254.169.254", "100.100.100.200", "168.63.129.16", "[::1]", "[::ffff:127.0.0.1]",
    "[::ffff:8.8.8.8]", "[fd00:ec2::254]", "[fe80::1]", "[64:ff9b::7f00:1]"]) {
    await assert.rejects(instance.assess(`http://${host}/`, signal()), failure("TARGET_NOT_ALLOWED"), host);
  }
});

test("rejects any prohibited or malformed DNS answer, including mixed-family results", async () => {
  for (const answers of [["127.0.0.1"], ["::1"], ["8.8.8.8", "10.0.0.1"],
    ["8.8.8.8", "fd00::1"], ["2606:4700::1111", "169.254.169.254"],
    ["8.8.8.8", "::ffff:8.8.8.8"], ["8.8.8.8", "not-an-address"], ["8.8.8.8", null]]) {
    await assert.rejects(policy(async () => answers).assess("https://example.com", signal()),
      failure("TARGET_NOT_ALLOWED"));
  }
});

test("DNS errors, empty answers and invalid resolver output fail closed without exposing details", async () => {
  for (const resolve of [async () => [], async () => null, async () => "8.8.8.8",
    async () => { throw new Error("secret resolver detail"); }, () => { throw new Error("sync error"); }]) {
    await assert.rejects(policy(resolve).assess("https://example.com", signal()), error => {
      assert.equal(error.message, "Target resolution failed.");
      return failure("RESOLUTION_FAILED")(error);
    });
  }
});

test("port policy is explicit and configuration is copied", async () => {
  for (const allowedPorts of [[], [0], [65536], [1.5], [NaN]]) {
    assert.throws(() => policy(undefined, { allowedPorts }));
  }
  const allowedPorts = [8443];
  const deniedHostnames = ["Service.Example.COM."];
  const instance = policy(undefined, { allowedPorts, deniedHostnames });
  allowedPorts.push(443); deniedHostnames.length = 0;
  assert.equal((await instance.assess("https://example.com:8443", signal())).port, 8443);
  await assert.rejects(instance.assess("https://example.com", signal()), failure("TARGET_NOT_ALLOWED"));
  await assert.rejects(instance.assess("https://a.service.example.com:8443", signal()), failure("TARGET_NOT_ALLOWED"));
  assert.throws(() => policy(undefined, { deniedHostnames: ["bad/host"] }));
});

test("cancellation rejects before resolution and while an uncooperative resolver is pending", async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(policy(async () => assert.fail("Must not resolve")).assess("https://example.com", before.signal),
    failure("CANCELLED"));
  const during = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let finish;
  const instance = policy(async () => { started(); return new Promise(resolve => { finish = resolve; }); });
  const pending = instance.assess("https://example.com", during.signal);
  await ready;
  during.abort(new Error("private cancellation reason"));
  await assert.rejects(pending, failure("CANCELLED"));
  finish(["8.8.8.8"]);
});

test("redirect assessment resolves relative URLs and rechecks every destination without following it", async () => {
  const calls = [];
  const instance = policy(async host => { calls.push(host); return ["8.8.8.8"]; });
  const result = await instance.assessRedirect("../next?q=1", "https://example.com/path/start", signal());
  assert.equal(result.url, "https://example.com/next?q=1");
  await instance.assessRedirect("https://example.org/", result.url, signal());
  assert.deepEqual(calls, ["example.com", "example.org"]);
  for (const location of ["http://127.1/", "//[::1]/", "file:///tmp/a", "//user@example.com/",
    "https://@example.com/", "//metadata.goog/", "https://example.com:8080", "\\evil.com", "\n/next"]) {
    await assert.rejects(instance.assessRedirect(location, result.url, signal()), failure("TARGET_NOT_ALLOWED"));
  }
});

test("reassessment and same-host redirects reject changed DNS, without claiming connection pinning", async () => {
  let count = 0;
  const instance = policy(async () => ++count === 1 ? ["8.8.8.8"] : ["127.0.0.1"]);
  const first = await instance.assess("https://example.com", signal());
  assert.equal(first.requiresConnectionEnforcement, true);
  await assert.rejects(instance.assessRedirect("/next", first.url, signal()), failure("TARGET_NOT_ALLOWED"));
  await assert.rejects(instance.assess(first.url, signal()), failure("TARGET_NOT_ALLOWED"));
  assert.equal(count, 3);
});

test("disabled application service allocates no ID, writes no data and invokes no network or process APIs", async t => {
  // Guard actual entry points, not a production private-address exception.
  const attempts = [];
  const guard = name => () => { attempts.push(name); throw new Error("Unexpected side effect"); };
  for (const [object, names] of [[dns, ["lookup", "resolve", "resolve4", "resolve6"]],
    [dns.promises, ["lookup", "resolve", "resolve4", "resolve6"]], [net.Socket.prototype, ["connect"]],
    [http, ["request", "get"]], [https, ["request", "get"]], [globalThis, ["fetch"]],
    [crypto, ["randomUUID", "randomBytes"]], [childProcess, ["spawn", "exec", "execFile", "fork"]]]) {
    for (const name of names) t.mock.method(object, name, guard(name));
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const repository = new MemoryTestRepository();
  const spec = { url: "https://example.com", testType: "page", browsers: ["Chrome 137 (Latest)"],
    wcagStandard: "wcag_2_1_aa" };
  await repository.insert({ test: { ...spec, id: "source", status: "completed",
    submittedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z",
    failure: null, retestOfId: null }, findings: [] });
  const before = await repository.get("source");
  t.mock.method(repository, "insert", guard("insert"));
  const service = new TestService(repository);
  for (const url of ["https://example.com", "http://127.0.0.1", "http://[::1]", "http://169.254.169.254"]) {
    await assert.rejects(service.submit({ ...spec, url }), { status: 503, code: "SCANNER_UNAVAILABLE" });
  }
  await assert.rejects(service.retest("source"), { status: 503, code: "SCANNER_UNAVAILABLE" });
  await assert.rejects(service.retest("missing"), { status: 404, code: "NOT_FOUND" });
  assert.deepEqual(await repository.get("source"), before);
  assert.equal((await repository.recent(10)).length, 1);
  assert.deepEqual(attempts, []);
});
