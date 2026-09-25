import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import tls from "node:tls";
import { Resolver } from "node:dns/promises";
import { createPinnedConnector, createPinnedTunnelConnector } from "../dist/security/pinned-connection.js";

class FakeSocket extends EventEmitter {
  destroyed = false;
  authorized = true;
  remoteAddress;
  certificate = { subjectaltname: "DNS:example.com" };
  constructor(address) { super(); this.remoteAddress = address; }
  getPeerCertificate() { return this.certificate; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } return this; }
}
const signal = () => new AbortController().signal;
function fixture({ answers = ["8.8.8.8"], act, timeoutMs = 1000, resolve } = {}) {
  const calls = []; const sockets = []; let resolutions = 0;
  const dial = kind => options => {
    calls.push({ kind, options });
    const socket = new FakeSocket(options.host); sockets.push(socket);
    queueMicrotask(() => {
      if (act) act(socket, options, kind);
      else socket.emit(kind === "tls" ? "secureConnect" : "connect");
    });
    return socket;
  };
  const connect = createPinnedConnector({ allowedPorts: [80, 443], timeoutMs,
    resolve: resolve ?? (async () => { resolutions++; return answers; }),
    dialers: { tcp: dial("tcp"), tls: dial("tls") } });
  return { connect, calls, sockets, resolutions: () => resolutions };
}

test("TCP connects only to the first assessed literal with no hostname resolution", async () => {
  const f = fixture({ answers: ["8.8.8.8", "1.1.1.1", "2606:4700::1111"] });
  const result = await f.connect("http://example.com/path", signal());
  assert.equal(result.address, "8.8.8.8"); assert.equal(result.hostname, "example.com");
  assert.equal(f.calls[0].options.host, "8.8.8.8"); assert.equal(f.calls[0].options.family, 4);
  assert.equal(f.calls[0].options.autoSelectFamily, false);
  assert.throws(() => f.calls[0].options.lookup("example.com"), /forbidden/);
  assert.equal(f.resolutions(), 1); result.socket.destroy();
});

test("IPv6 connection uses the exact assessed literal and family", async () => {
  const f = fixture({ answers: ["2606:4700:4700::1111"] });
  const result = await f.connect("http://example.com", signal());
  assert.equal(f.calls[0].options.host, "2606:4700:4700::1111");
  assert.equal(f.calls[0].options.family, 6); result.socket.destroy();
});

test("literal targets skip resolver; mapped/private targets and mixed answers never dial", async () => {
  const f = fixture();
  const result = await f.connect("http://8.8.8.8", signal());
  assert.equal(f.resolutions(), 0); result.socket.destroy();
  for (const url of ["http://127.1", "http://10.0.0.1", "http://[::1]", "http://[fd00::1]",
    "http://[::ffff:8.8.8.8]", "http://169.254.169.254"]) {
    const blocked = fixture();
    await assert.rejects(blocked.connect(url, signal()), { code: "TARGET_NOT_ALLOWED" });
    assert.equal(blocked.calls.length, 0);
  }
  for (const answers of [["8.8.8.8", "10.0.0.1"], ["8.8.8.8", "::1"], ["2606:4700::1111", "fd00::1"]]) {
    const blocked = fixture({ answers });
    await assert.rejects(blocked.connect("https://example.com", signal()), { code: "TARGET_NOT_ALLOWED" });
    assert.equal(blocked.calls.length, 0);
  }
});

test("TLS retains original hostname for SNI and identity with verification enabled", async () => {
  const f = fixture();
  const result = await f.connect("https://EXAMPLE.COM/path", signal());
  const options = f.calls[0].options;
  assert.equal(f.calls[0].kind, "tls");
  assert.equal(options.host, "8.8.8.8"); assert.equal(options.servername, "example.com");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.checkServerIdentity("8.8.8.8", { subjectaltname: "DNS:example.com" }), undefined);
  assert.ok(options.checkServerIdentity("attacker.com", { subjectaltname: "DNS:attacker.com" }) instanceof Error);
  assert.throws(() => options.lookup("example.com"));
  result.socket.destroy();
});

test("HTTPS IP targets omit DNS SNI and verify IP SAN, including IPv6", async () => {
  for (const [url, address] of [["https://8.8.8.8", "8.8.8.8"],
    ["https://[2606:4700:4700::1111]", "2606:4700:4700::1111"]]) {
    const f = fixture({ act: socket => {
      socket.certificate = { subjectaltname: `IP Address:${address}` }; socket.emit("secureConnect");
    } });
    const result = await f.connect(url, signal());
    assert.equal(f.calls[0].options.servername, undefined);
    assert.equal(f.calls[0].options.rejectUnauthorized, true);
    assert.equal(f.resolutions(), 0); result.socket.destroy();
  }
});

test("unauthorized certificates and hostname mismatch fail and destroy sockets", async () => {
  for (const mode of ["untrusted", "wrong-host"]) {
    const f = fixture({ act: socket => {
      if (mode === "untrusted") socket.authorized = false;
      else socket.certificate = { subjectaltname: "DNS:attacker.com" };
      socket.emit("secureConnect");
    } });
    await assert.rejects(f.connect("https://example.com", signal()), { code: "CONNECTION_FAILED" });
    assert.equal(f.sockets[0].destroyed, true);
  }
});

test("unexpected connected peer is rejected", async () => {
  const f = fixture({ act: socket => { socket.remoteAddress = "1.1.1.1"; socket.emit("connect"); } });
  await assert.rejects(f.connect("http://example.com", signal()), { code: "CONNECTION_FAILED" });
  assert.equal(f.sockets[0].destroyed, true);
});

test("network error and early close fail closed without retrying another address", async () => {
  for (const mode of ["error", "close"]) {
    const f = fixture({ answers: ["8.8.8.8", "1.1.1.1"], act: socket => {
      if (mode === "error") socket.emit("error", new Error("private network detail")); else socket.destroy();
    } });
    await assert.rejects(f.connect("http://example.com", signal()),
      { code: "CONNECTION_FAILED", message: "Pinned connection failed: CONNECTION_FAILED." });
    assert.equal(f.calls.length, 1); assert.equal(f.sockets[0].destroyed, true);
  }
});

test("DNS failure or empty answer set opens no socket", async () => {
  for (const resolve of [async () => [], async () => { throw new Error("DNS failed"); }]) {
    const f = fixture({ resolve });
    await assert.rejects(f.connect("http://example.com", signal()), { code: "RESOLUTION_FAILED" });
    assert.equal(f.calls.length, 0);
  }
});

test("separate connections reassess changed DNS and never reuse an allowed-host decision", async () => {
  let calls = 0;
  const f = fixture({ resolve: async () => ++calls === 1 ? ["8.8.8.8"] : ["127.0.0.1"] });
  const first = await f.connect("http://example.com", signal()); first.socket.destroy();
  await assert.rejects(f.connect("http://example.com", signal()), { code: "TARGET_NOT_ALLOWED" });
  assert.equal(calls, 2); assert.equal(f.calls.length, 1);
});

test("timeout covers DNS and TCP/TLS establishment", async () => {
  const dns = fixture({ timeoutMs: 10, resolve: async () => new Promise(() => {}) });
  await assert.rejects(dns.connect("http://example.com", signal()), { code: "CONNECTION_TIMEOUT" });
  assert.equal(dns.calls.length, 0);
  for (const scheme of ["http", "https"]) {
    const f = fixture({ timeoutMs: 10, act: () => {} });
    await assert.rejects(f.connect(`${scheme}://example.com`, signal()), { code: "CONNECTION_TIMEOUT" });
    assert.equal(f.sockets[0].destroyed, true);
  }
});

test("cancellation before/during connection and after handoff closes owned resources", async () => {
  const before = new AbortController(); before.abort();
  const a = fixture();
  await assert.rejects(a.connect("http://example.com", before.signal), { code: "CANCELLED" });
  assert.equal(a.resolutions(), 0); assert.equal(a.calls.length, 0);
  const during = new AbortController();
  const b = fixture({ act: () => during.abort() });
  await assert.rejects(b.connect("https://example.com", during.signal), { code: "CANCELLED" });
  assert.equal(b.sockets[0].destroyed, true);
  const after = new AbortController(); const c = fixture();
  const result = await c.connect("http://example.com", after.signal);
  after.abort(); assert.equal(result.socket.destroyed, true);
});

test("default composition uses real Node resolver and TCP/TLS entry points (stubbed, no network)", async t => {
  t.mock.method(Resolver.prototype, "resolve4", async () => ["8.8.8.8"]);
  t.mock.method(Resolver.prototype, "resolve6", async () => []);
  t.mock.method(Resolver.prototype, "cancel", () => {});
  for (const [module, method, event] of [[net, "connect", "connect"], [tls, "connect", "secureConnect"]]) {
    t.mock.method(module, method, options => {
      assert.equal(options.host, "8.8.8.8");
      const socket = new FakeSocket(options.host);
      queueMicrotask(() => socket.emit(event)); return socket;
    });
  }
  const connect = createPinnedConnector({ allowedPorts: [80, 443] });
  for (const scheme of ["http", "https"]) (await connect(`${scheme}://example.com`, signal())).socket.destroy();
});

test("invalid timeout and synchronous dial failure are safe", async () => {
  for (const timeoutMs of [0, -1, Infinity, 1.5]) assert.throws(() => fixture({ timeoutMs }));
  const fail = () => { throw new Error("private dial detail"); };
  const connect = createPinnedConnector({ allowedPorts: [80], resolve: async () => ["8.8.8.8"],
    dialers: { tcp: fail, tls: fail } });
  await assert.rejects(connect("http://example.com", signal()), { code: "CONNECTION_FAILED" });
});

test("tunnel connector assesses HTTPS authorities but exclusively dials raw TCP", async () => {
  for (const address of ["8.8.8.8", "2606:4700:4700::1111"]) {
    let calls = 0;
    const connect = createPinnedTunnelConnector({ allowedPorts: [443], resolve: async () => [address],
      dialers: { tls: () => assert.fail("Tunnel must not start TLS"), tcp: options => {
        calls++; assert.equal(options.host, address); assert.equal(options.port, 443);
        assert.equal(options.servername, undefined); assert.equal(options.rejectUnauthorized, undefined);
        assert.throws(() => options.lookup("example.com"), /forbidden/);
        const socket = new FakeSocket(address); socket.authorized = false;
        queueMicrotask(() => socket.emit("connect")); return socket;
      } } });
    const result = await connect("https://example.com:443", signal());
    assert.equal(calls, 1); result.socket.destroy();
    await assert.rejects(connect("http://example.com", signal()), { code: "CONNECTION_FAILED" });
    await assert.rejects(connect("https://127.0.0.1", signal()), { code: "TARGET_NOT_ALLOWED" });
    assert.equal(calls, 1);
  }
});

test("raw tunnel establishment retains timeout and cancellation cleanup", async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController(); let socket;
    const connect = createPinnedTunnelConnector({ allowedPorts: [443], timeoutMs: 10,
      resolve: async () => ["8.8.8.8"], dialers: { tls: () => assert.fail(), tcp: () => {
        socket = new FakeSocket("8.8.8.8");
        if (cancelled) queueMicrotask(() => controller.abort());
        return socket;
      } } });
    await assert.rejects(connect("https://example.com", controller.signal),
      { code: cancelled ? "CANCELLED" : "CONNECTION_TIMEOUT" });
    assert.equal(socket.destroyed, true);
  }
});
