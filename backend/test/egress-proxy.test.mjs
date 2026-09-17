import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Duplex } from "node:stream";
import { once } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createEgressProxy } from "../dist/security/egress-proxy.js";

const secret = "deterministic_test_credential_0123456789";
const auth = `Proxy-Authorization: Basic ${Buffer.from(`proxy:${secret}`).toString("base64")}\r\n`;
const httpRequest = (url = "http://example.com/path?q=1", extra = "") =>
  `GET ${url} HTTP/1.1\r\nHost: ${new URL(url).host}\r\n${auth}${extra}\r\n`;
const tunnelRequest = (host = "example.com:443", extra = "") =>
  `CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n${auth}${extra}\r\n`;

class Upstream extends Duplex {
  constructor(address, onWrite) {
    super({ allowHalfOpen: true }); this.remoteAddress = address; this.onWrite = onWrite;
    this.writes = []; this.connecting = false;
  }
  _read() {}
  _write(chunk, _encoding, done) {
    this.writes.push(Buffer.from(chunk));
    try { this.onWrite?.(this, chunk); done(); } catch (error) { done(error); }
  }
  _final(done) { done(); }
  setTimeout() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { return this; }
  unref() { return this; }
}

async function fixture(t, options = {}) {
  const sockets = []; const dials = []; const names = [];
  const proxy = createEgressProxy({ secret, limits: { lifetimeMs: 2000, ...options.limits },
    resolve: async (name, signal) => { names.push(name); return options.resolve ? options.resolve(name, signal) : ["8.8.8.8"]; },
    dialers: { tls: () => assert.fail("Proxy must never initiate target TLS"), tcp: args => {
      dials.push(args); assert.equal(net.isIP(args.host) > 0, true);
      assert.throws(() => args.lookup("example.com"), /forbidden/);
      const socket = new Upstream(args.host, options.onWrite ?? ((stream) => {
        if (!stream.responded && Buffer.concat(stream.writes).includes("\r\n\r\n")) {
          stream.responded = true; stream.push("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"); stream.push(null);
        }
      }));
      sockets.push(socket);
      queueMicrotask(() => {
        if (options.onDial) options.onDial(socket);
        else socket.emit("connect");
      });
      return socket;
    } } });
  const port = await proxy.listen();
  t.after(async () => {
    await proxy.close(); await nextTurn();
    assert.deepEqual(proxy.diagnostics(), { clients: 0, timers: 0, upstreams: 0 });
    for (const socket of sockets) {
      assert.equal(socket.destroyed, true); assert.equal(socket.listenerCount("data"), 0);
    }
  });
  return { proxy, port, sockets, dials, names };
}
async function client(port) {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.on("error", () => {}); await once(socket, "connect"); return socket;
}
async function exchange(port, text) {
  const socket = await client(port); const chunks = [];
  socket.on("data", chunk => chunks.push(chunk));
  const closed = new Promise(resolve => socket.once("close", resolve));
  socket.write(text); await closed; return Buffer.concat(chunks).toString();
}
function status(response, code) { assert.match(response, new RegExp(`^HTTP/1.1 ${code} `)); }
async function openedTunnel(port, request = tunnelRequest()) {
  const socket = await client(port); let received = Buffer.alloc(0);
  const header = new Promise((resolve, reject) => {
    const data = chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.includes("\r\n\r\n")) { socket.removeListener("data", data); resolve(received); }
    };
    socket.on("data", data); socket.once("error", reject);
  });
  socket.write(request); status((await header).toString(), 200); return socket;
}

test("HTTP forwarding pins destination, serializes origin-form and strips proxy/hop headers", async t => {
  const f = await fixture(t);
  status(await exchange(f.port, httpRequest("http://EXAMPLE.COM.:80/path?q=1",
    "Connection: close, X-Remove\r\nX-Remove: private\r\nProxy-Connection: keep-alive\r\nForwarded: forged\r\n")), 200);
  assert.equal(f.dials.length, 1); assert.equal(f.dials[0].host, "8.8.8.8");
  const forwarded = Buffer.concat(f.sockets[0].writes).toString();
  assert.match(forwarded, /^GET \/path\?q=1 HTTP\/1.1/);
  assert.match(forwarded, /host: example.com\r\n/i);
  assert.doesNotMatch(forwarded, /Proxy-|X-Remove|Forwarded|deterministic/i);
});

test("HEAD is supported and responses have no forwarded entity body", async t => {
  const f = await fixture(t, { onWrite: socket => {
    if (!socket.responded) { socket.responded = true; socket.push("HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\n"); socket.push(null); }
  } });
  const response = await exchange(f.port, httpRequest().replace(/^GET/, "HEAD"));
  status(response, 200); assert.equal(response.split("\r\n\r\n")[1], "");
});

test("prohibited literal and hostname targets reject without upstream dialing", async t => {
  const f = await fixture(t);
  for (const url of ["http://localhost/", "http://127.1/", "http://10.0.0.1/", "http://169.254.169.254/",
    "http://[::1]/", "http://[fd00::1]/", "http://[::ffff:8.8.8.8]/", "http://metadata.google.internal/"]) {
    status(await exchange(f.port, httpRequest(url)), 403);
  }
  assert.equal(f.dials.length, 0);
});

test("mixed DNS and resolver failure/empty answers fail closed", async t => {
  let answers;
  const f = await fixture(t, { resolve: async () => { if (answers instanceof Error) throw answers; return answers; } });
  for (const [value, code] of [[["8.8.8.8", "10.0.0.1"], 403], [["8.8.8.8", "::1"], 403],
    [[], 502], [new Error("private DNS detail"), 502]]) {
    answers = value; status(await exchange(f.port, httpRequest()), code);
  }
  assert.equal(f.dials.length, 0);
});

test("CONNECT uses raw pinned TCP for hostname, IPv4 and bracketed IPv6", async t => {
  const f = await fixture(t, { onWrite: (socket, bytes) => socket.push(bytes) });
  for (const host of ["EXAMPLE.COM.:443", "8.8.8.8:443", "[2606:4700:4700::1111]:443"]) {
    const socket = await openedTunnel(f.port, tunnelRequest(host));
    const data = once(socket, "data"); socket.write("opaque bytes");
    assert.equal((await data)[0].toString(), "opaque bytes");
    socket.destroy(); await once(socket, "close");
  }
  assert.equal(f.dials.length, 3); assert.deepEqual(f.names, ["example.com"]);
  assert.equal(f.dials[2].host, "2606:4700:4700::1111");
  assert.equal(f.dials[2].family, 6);
  assert.ok(f.dials.every(args => args.servername === undefined));
});

test("CONNECT prohibited destinations, malformed authorities and invalid ports never dial", async t => {
  const f = await fixture(t);
  for (const [host, code] of [["127.0.0.1:443", 403], ["[::1]:443", 403], ["169.254.169.254:443", 403],
    ["example.com", 400], ["example.com:0", 400], ["example.com:65536", 400], ["example.com:80", 403],
    ["example.com:0443", 400], ["example.com:abc", 400], ["::1:443", 400], ["[::1%en0]:443", 400],
    ["https://example.com:443", 400], ["user@example.com:443", 400], ["example.com:443/path", 400]]) {
    status(await exchange(f.port, tunnelRequest(host)), code);
  }
  assert.equal(f.dials.length, 0);
});

test("independent requests reassess changed DNS; redirects are returned and never internally followed", async t => {
  let privateAnswer = false;
  const f = await fixture(t, { resolve: async () => privateAnswer ? ["10.0.0.1"] : ["8.8.8.8"],
    onWrite: socket => { if (!socket.responded) { socket.responded = true;
      socket.push("HTTP/1.1 302 Found\r\nLocation: http://example.org/next\r\nContent-Length: 0\r\n\r\n"); socket.push(null); } } });
  status(await exchange(f.port, httpRequest()), 302); assert.deepEqual(f.names, ["example.com"]);
  status(await exchange(f.port, httpRequest("http://example.org/next")), 302);
  assert.deepEqual(f.names, ["example.com", "example.org"]);
  privateAnswer = true;
  status(await exchange(f.port, httpRequest("http://example.org/next")), 403);
  assert.equal(f.dials.length, 2);
});

test("unsupported schemes, forms, methods and explicit proxy chaining reject before dialing", async t => {
  const f = await fixture(t);
  for (const line of ["GET /path", "GET https://example.com/", "GET ws://example.com/", "GET wss://example.com/",
    "GET ftp://example.com/", "GET http:///example.com/", "GET http://user@example.com/",
    "GET http://example.com/#fragment", "GET http://example.com:8080/", "OPTIONS *", "POST http://example.com/",
    "TRACE http://example.com/", "PUT http://example.com/", "DELETE http://example.com/", "GET example.com:80"]) {
    const response = await exchange(f.port, `${line} HTTP/1.1\r\nHost: example.com\r\n${auth}\r\n`);
    assert.match(response, /^HTTP\/1.1 (400|403|405) /, line);
  }
  assert.equal(f.dials.length, 0);
});

test("authentication is mandatory, duplicate credentials fail and no resolution occurs", async t => {
  const f = await fixture(t);
  for (const credential of ["", "Proxy-Authorization: Basic wrong\r\n", auth + auth]) {
    const response = await exchange(f.port, `GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n${credential}\r\n`);
    status(response, 407); assert.match(response, /Proxy-Authenticate: Basic/);
    assert.doesNotMatch(response, /deterministic/);
  }
  assert.equal(f.names.length, 0); assert.equal(f.dials.length, 0);
});

test("duplicate/conflicting Host, framing, hop nominations and Upgrade reject", async t => {
  const f = await fixture(t);
  for (const extra of ["Host: example.com\r\n", "Host: attacker.com\r\n", "Content-Length: 0\r\nContent-Length: 0\r\n",
    "Content-Length: -1\r\n", "Content-Length: 00\r\n", "Content-Length: 1, 1\r\n", "Content-Length: 3\r\n",
    "Transfer-Encoding: chunked\r\n", "Transfer-Encoding: chunked\r\nContent-Length: 0\r\n",
    "Transfer-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n", "Trailer: X-Value\r\n",
    "Connection: host\r\n", "Connection: content-length\r\n", "Upgrade: websocket\r\nConnection: Upgrade\r\n",
    "Expect: 100-continue\r\n"]) {
    assert.match(await exchange(f.port, httpRequest(undefined, extra)), /^HTTP\/1.1 (400|413|417) /, extra);
  }
  status(await exchange(f.port, httpRequest().replace("Host: example.com", "Host: attacker.com")), 400);
  status(await exchange(f.port, httpRequest().replace("Host: example.com\r\n", "")), 400);
  assert.equal(f.dials.length, 0);
});

test("oversized headers and excessive header count reject", async t => {
  const f = await fixture(t, { limits: { headerBytes: 1024, headerCount: 5 } });
  status(await exchange(f.port, httpRequest(undefined, `X-Large: ${"a".repeat(2000)}\r\n`)), 431);
  status(await exchange(f.port, httpRequest(undefined, "A: 1\r\nB: 2\r\nC: 3\r\nD: 4\r\n")), 431);
  assert.equal(f.dials.length, 0);
});

test("pipelined second request never opens an additional upstream connection", async t => {
  const f = await fixture(t);
  await exchange(f.port, httpRequest() + httpRequest("http://example.org/"));
  assert.ok(f.dials.length <= 1); assert.ok(!f.names.includes("example.org"));
});

test("environment proxy settings cannot replace the pinned connection", async t => {
  const names = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY"];
  const previous = names.map(name => process.env[name]);
  names.forEach(name => { process.env[name] = name === "NODE_USE_ENV_PROXY" ? "1" : "http://127.0.0.1:1"; });
  t.after(() => names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }));
  const f = await fixture(t); status(await exchange(f.port, httpRequest()), 200);
  assert.equal(f.dials[0].host, "8.8.8.8");
});

test("CONNECT initial head bytes are forwarded exactly once and counted", async t => {
  const f = await fixture(t, { onWrite: () => {} });
  const socket = await openedTunnel(f.port, tunnelRequest() + "EARLY");
  await nextTurn(); assert.equal(Buffer.concat(f.sockets[0].writes).toString(), "EARLY");
  socket.destroy();
  const limited = await fixture(t, { limits: { headBytes: 4 } });
  status(await exchange(limited.port, tunnelRequest() + "12345"), 413);
  assert.equal(limited.dials.length, 0);
});

test("DNS/connection establishment timeout and upstream failures close clients", async t => {
  const dns = await fixture(t, { limits: { establishMs: 20 }, resolve: async () => new Promise(() => {}) });
  status(await exchange(dns.port, httpRequest()), 504); assert.equal(dns.dials.length, 0);
  const stalled = await fixture(t, { limits: { establishMs: 20 }, onDial: () => {} });
  status(await exchange(stalled.port, tunnelRequest()), 504);
  assert.equal(stalled.sockets[0].destroyed, true);
  const failed = await fixture(t, { onDial: socket => socket.destroy(new Error("secret detail")) });
  const response = await exchange(failed.port, httpRequest()); status(response, 502);
  assert.doesNotMatch(response, /secret detail/);
});

test("header, idle and total lifetime timers bound slow clients and tunnels", async t => {
  const slow = await fixture(t, { limits: { headerMs: 20 } });
  status(await exchange(slow.port, "GET "), 408); assert.equal(slow.dials.length, 0);
  for (const limits of [{ idleMs: 20 }, { lifetimeMs: 30 }]) {
    const f = await fixture(t, { limits, onWrite: () => {} });
    const socket = await openedTunnel(f.port);
    await once(socket, "close"); assert.equal(f.sockets[0].destroyed, true);
  }
});

test("connection limits count unauthenticated clients", async t => {
  const f = await fixture(t, { limits: { perClient: 1, connections: 2 } });
  const held = await client(f.port);
  status(await exchange(f.port, httpRequest()), 503); assert.equal(f.dials.length, 0); held.destroy();
});

test("shutdown and client disconnect cancel outstanding resolution and tunnels", async t => {
  let resolverSignal;
  const f = await fixture(t, { resolve: async (_name, signal) => { resolverSignal = signal; return new Promise(() => {}); } });
  const socket = await client(f.port); socket.write(httpRequest());
  while (!resolverSignal) await nextTurn();
  socket.destroy();
  for (let i = 0; i < 100 && !resolverSignal.aborted; i++) await nextTurn();
  assert.equal(resolverSignal.aborted, true); assert.equal(f.dials.length, 0);
  await f.proxy.close();
  const live = await fixture(t, { onWrite: () => {} });
  const tunnel = await openedTunnel(live.port); const closed = once(tunnel, "close");
  await live.proxy.close(); await closed; assert.equal(live.sockets[0].destroyed, true);
});

test("response and tunnel byte limits terminate transfers; half-close is bounded", async t => {
  const response = await fixture(t, { limits: { responseBytes: 1 } });
  status(await exchange(response.port, httpRequest()), 502);
  const f = await fixture(t, { limits: { tunnelBytes: 4 }, onWrite: () => {} });
  const socket = await openedTunnel(f.port); const closed = once(socket, "close");
  socket.write("12345"); await closed; assert.equal(Buffer.concat(f.sockets[0].writes).length, 0);
  const incoming = await fixture(t, { limits: { tunnelBytes: 4 }, onWrite: () => {} });
  const inbound = await openedTunnel(incoming.port); const ended = once(inbound, "close");
  incoming.sockets[0].push("12345"); await ended;
  const half = await fixture(t, { limits: { halfCloseMs: 20 }, onWrite: () => {} });
  const halfClient = await openedTunnel(half.port); const halfClosed = once(halfClient, "close");
  halfClient.end(); await halfClosed; assert.equal(half.sockets[0].destroyed, true);
});

test("upstream ambiguous framing and unsupported upgrades fail closed", async t => {
  for (const raw of ["HTTP/1.1 200 OK\r\nContent-Length: 0\r\nContent-Length: 1\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n",
    "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"]) {
    const f = await fixture(t, { onWrite: socket => { if (!socket.responded) { socket.responded = true; socket.push(raw); } } });
    status(await exchange(f.port, httpRequest()), 502);
  }
});

test("startup requires valid credentials/limits and has no implicit listener", async () => {
  assert.throws(() => createEgressProxy({ secret: "short" }));
  assert.throws(() => createEgressProxy({ secret, limits: { idleMs: 0 } }));
  const proxy = createEgressProxy({ secret });
  assert.deepEqual(proxy.diagnostics(), { clients: 0, timers: 0, upstreams: 0 });
  await assert.rejects(proxy.listen(-1)); await proxy.close(); await assert.rejects(proxy.listen());
});
