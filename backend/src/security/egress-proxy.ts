import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";
import { Transform } from "node:stream";
import { createPinnedConnector, createPinnedTunnelConnector, type ConnectionDialers } from "./pinned-connection.js";
import type { TargetResolver } from "./target-policy.js";

export const PROXY_LIMITS = Object.freeze({ headerBytes: 16_384, headerCount: 100,
  connections: 16, perClient: 8, headerMs: 5_000, establishMs: 10_000,
  idleMs: 10_000, lifetimeMs: 60_000, responseBytes: 16 * 1024 * 1024,
  tunnelBytes: 16 * 1024 * 1024, headBytes: 16_384, halfCloseMs: 2_000 });
type Limits = { [K in keyof typeof PROXY_LIMITS]: number };
class Rejection extends Error { constructor(readonly status: number) { super("Proxy request rejected."); } }
const reject = (status = 400): never => { throw new Rejection(status); };
const hop = new Set(["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate",
  "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"]);
const protectedFields = new Set(["host", "content-length", "transfer-encoding", "proxy-authorization"]);
const digest = (value: string) => createHash("sha256").update(value).digest();

function rawHeaders(message: IncomingMessage, limits: Limits): Map<string, string[]> {
  if (message.rawHeaders.length / 2 > limits.headerCount) reject(431);
  const fields = new Map<string, string[]>();
  for (let i = 0; i < message.rawHeaders.length; i += 2) {
    const name = message.rawHeaders[i].toLowerCase();
    fields.set(name, [...(fields.get(name) ?? []), message.rawHeaders[i + 1]]);
  }
  return fields;
}
function cleanedHeaders(fields: Map<string, string[]>): http.OutgoingHttpHeaders {
  const omitted = new Set(hop);
  for (const value of fields.get("connection") ?? []) {
    for (const item of value.split(",")) {
      const name = item.trim().toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || protectedFields.has(name)) reject();
      omitted.add(name);
    }
  }
  const result: http.OutgoingHttpHeaders = {};
  for (const [name, values] of fields) {
    if (!omitted.has(name) && name !== "host" && name !== "content-length"
        && name !== "forwarded" && !name.startsWith("x-forwarded-")) result[name] = values;
  }
  return result;
}
function authority(raw: string, scheme: "http:" | "https:", requirePort: boolean): URL {
  if (!raw || /[\s\u0000-\u001f\u007f@/?#\\%]/.test(raw)) reject();
  const match = /^(\[[0-9a-fA-F:.]+\]|[^:\[\]]+)(?::([0-9]+))?$/.exec(raw);
  if (!match) return reject();
  if (requirePort && !match[2]) reject();
  if (match[2] && (!/^[1-9]\d*$/.test(match[2]) || Number(match[2]) > 65535)) reject();
  let url: URL;
  try { url = new URL(`${scheme}//${raw}/`); } catch { return reject(); }
  if (!url.hostname || url.username || url.password) reject();
  if (!url.hostname.startsWith("[")) url.hostname = url.hostname.replace(/\.$/, "");
  return url;
}

/** Programmatic, loopback-only component. No import-time listener or API wiring.
 * Trusted injected DNS/dialers still run through the real policy/pinned connector.
 */
export function createEgressProxy(options: {
  secret: string;
  resolve?: TargetResolver;
  dialers?: ConnectionDialers;
  deniedHostnames?: readonly string[];
  limits?: Partial<Limits>;
}) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(options.secret)) throw new Error("A 32–128 character proxy secret is required.");
  const limits: Limits = { ...PROXY_LIMITS, ...options.limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error("Invalid proxy limits.");
  }
  const credential = digest(`Basic ${Buffer.from(`proxy:${options.secret}`).toString("base64")}`);
  const common = { resolve: options.resolve, dialers: options.dialers,
    deniedHostnames: options.deniedHostnames, timeoutMs: limits.establishMs };
  const connectHttp = createPinnedConnector({ ...common, allowedPorts: [80] });
  const connectTunnel = createPinnedTunnelConnector({ ...common, allowedPorts: [443] });
  const clients = new Map<Socket, State>();
  const counts = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopping = false;
  type State = { controller: AbortController; started: boolean; handled: boolean; ended: boolean;
    upstream?: Socket; response?: ServerResponse; agent?: http.Agent;
    headerTimer: ReturnType<typeof setTimeout>; lifeTimer: ReturnType<typeof setTimeout>;
    halfTimer?: ReturnType<typeof setTimeout>; streams: Transform[];
    fail: (status: number) => void };
  const later = (callback: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
    timers.add(timer); return timer;
  };
  const clear = (timer?: ReturnType<typeof setTimeout>) => {
    if (timer) { clearTimeout(timer); timers.delete(timer); }
  };
  function teardown(state: State) {
    state.controller.abort(); state.upstream?.destroy(); state.agent?.destroy();
    state.streams.forEach(stream => stream.destroy());
    clear(state.headerTimer); clear(state.lifeTimer); clear(state.halfTimer);
  }
  function wireError(socket: Socket, status: number) {
    if (socket.destroyed || !socket.writable) { socket.destroy(); return; }
    const reason = http.STATUS_CODES[status] ?? "Error";
    const body = `${reason}\n`;
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n`
      + (status === 407 ? 'Proxy-Authenticate: Basic realm="scanner-proxy"\r\n' : "")
      + `\r\n${body}`, () => socket.destroy());
  }
  const server = http.createServer({ insecureHTTPParser: false, maxHeaderSize: limits.headerBytes },
    (request, response) => { void handle(request, response); });
  // Do not let Node silently truncate duplicate-header evidence at a count limit.
  server.maxHeadersCount = 0;
  server.headersTimeout = limits.headerMs;
  server.requestTimeout = limits.lifetimeMs;
  server.on("connection", socket => {
    socket.allowHalfOpen = true;
    const identity = socket.remoteAddress ?? "unknown";
    socket.on("error", () => {});
    if (stopping || clients.size >= limits.connections || (counts.get(identity) ?? 0) >= limits.perClient) {
      wireError(socket, 503); return;
    }
    const state: State = { controller: new AbortController(), started: false, handled: false, ended: false,
      streams: [], headerTimer: later(() => state.fail(408), limits.headerMs),
      lifeTimer: later(() => state.fail(504), limits.lifetimeMs),
      fail: status => {
        if (state.ended) return;
        state.ended = true; teardown(state);
        if (state.started) socket.destroy(); else wireError(socket, status);
      } };
    clients.set(socket, state); counts.set(identity, (counts.get(identity) ?? 0) + 1);
    socket.setTimeout(limits.idleMs, () => state.fail(state.handled ? 504 : 408));
    socket.once("close", () => {
      teardown(state); socket.setTimeout(0); clients.delete(socket);
      const remaining = (counts.get(identity) ?? 1) - 1;
      if (remaining) counts.set(identity, remaining); else counts.delete(identity);
    });
    // Disconnect during headers/assessment must cancel pending resolution or dial.
    // Established tunnels instead receive the bounded half-close grace below.
    socket.on("end", () => { if (!state.upstream) state.fail(400); });
  });
  server.on("clientError", (error, socket) => {
    const status = (error as NodeJS.ErrnoException).code === "HPE_HEADER_OVERFLOW" ? 431 : 400;
    const state = clients.get(socket as Socket);
    if (state) state.fail(status); else wireError(socket as Socket, status);
  });
  server.on("checkContinue", request => clients.get(request.socket)?.fail(417));
  server.on("checkExpectation", request => clients.get(request.socket)?.fail(417));
  server.on("upgrade", (request, socket) => clients.get(socket as Socket)?.fail(400));
  server.on("connect", (request, socket, head) => { void handle(request, undefined, head); });

  function validate(request: IncomingMessage, tunnel: boolean): { target: URL; headers: http.OutgoingHttpHeaders } {
    if (request.httpVersion !== "1.1") reject();
    const fields = rawHeaders(request, limits);
    const auth = fields.get("proxy-authorization");
    if (auth?.length !== 1 || !timingSafeEqual(digest(auth[0]), credential)) reject(407);
    if (fields.get("host")?.length !== 1) reject();
    const cl = fields.get("content-length");
    if (fields.has("transfer-encoding") || fields.has("trailer") || fields.has("upgrade")) reject();
    if (fields.has("expect")) reject(417);
    if (cl && (cl.length !== 1 || !/^(0|[1-9]\d*)$/.test(cl[0]))) reject();
    if (cl && cl[0] !== "0") reject(413);
    if (!tunnel && !["GET", "HEAD"].includes(request.method ?? "")) reject(405);
    const raw = request.url ?? "";
    let target: URL;
    if (tunnel) {
      target = authority(raw, "https:", true);
      if (Number(target.port || 443) !== 443) reject(403);
    } else {
      if (!/^http:\/\//i.test(raw) || /[\s\u0000-\u001f\u007f\\#]/.test(raw)) reject();
      const rawAuthority = raw.slice(raw.indexOf("://") + 3).split(/[/?]/, 1)[0];
      authority(rawAuthority, "http:", false);
      try { target = new URL(raw); } catch { return reject(); }
      if (!target.hostname.startsWith("[")) target.hostname = target.hostname.replace(/\.$/, "");
      if (Number(target.port || 80) !== 80) reject(403);
    }
    const host = authority(fields.get("host")![0], target.protocol as "http:" | "https:", tunnel);
    if (host.host !== target.host) reject();
    const headers = cleanedHeaders(fields);
    headers.host = target.host; headers.connection = "close";
    return { target, headers };
  }
  function statusOf(error: unknown): number {
    if (error instanceof Rejection) return error.status;
    const code = (error as { code?: string })?.code;
    return code === "TARGET_NOT_ALLOWED" ? 403 : code === "CONNECTION_TIMEOUT" ? 504 : 502;
  }
  function meter(state: State, bytes: number) {
    let total = 0;
    const stream = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > bytes) { state.fail(502); callback(new Error("Transfer limit exceeded.")); }
      else callback(null, chunk);
    } });
    stream.on("error", () => state.fail(502)); state.streams.push(stream); return stream;
  }
  async function handle(request: IncomingMessage, response?: ServerResponse, head?: Buffer) {
    const client = request.socket;
    const state = clients.get(client);
    if (!state || state.ended) { client.destroy(); return; }
    if (state.handled) { state.fail(400); return; }
    state.handled = true; state.response = response;
    clear(state.headerTimer);
    request.on("error", () => state.fail(400));
    request.on("aborted", () => state.fail(400));
    const tunnel = !response;
    try {
      const { target, headers } = validate(request, tunnel);
      if (head && head.length > limits.headBytes) reject(413);
      const result = await (tunnel ? connectTunnel : connectHttp)(target.href, state.controller.signal);
      if (state.ended || client.destroyed) { result.socket.destroy(); return; }
      const upstream = result.socket; state.upstream = upstream;
      upstream.setTimeout(limits.idleMs, () => state.fail(504));
      upstream.on("error", () => state.fail(502));
      if (tunnel) {
        upstream.allowHalfOpen = true;
        state.started = true;
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const outgoing = meter(state, limits.tunnelBytes);
        const incoming = meter(state, limits.tunnelBytes);
        outgoing.pipe(upstream); upstream.pipe(incoming).pipe(client);
        if (head?.length) outgoing.write(head);
        client.pipe(outgoing);
        const halfClose = () => { state.halfTimer ??= later(() => state.fail(504), limits.halfCloseMs); };
        client.once("end", halfClose); upstream.once("end", halfClose);
        upstream.once("close", () => { if (!client.destroyed) client.destroy(); });
      } else {
        // Private, per-request agent. Its only connection is this assessed socket;
        // neither global agents nor environment proxy configuration are consulted.
        const agent = new http.Agent({ keepAlive: false, maxSockets: 1 }); state.agent = agent;
        agent.createConnection = () => upstream;
        const outgoing = http.request({ protocol: "http:", hostname: target.hostname,
          port: 80, method: request.method, path: `${target.pathname}${target.search}`,
          headers, agent, insecureHTTPParser: false, maxHeaderSize: limits.headerBytes }, incoming => {
          try {
            const fields = rawHeaders(incoming, limits);
            const lengths = fields.get("content-length");
            if (lengths && (lengths.length !== 1 || !/^\d+$/.test(lengths[0]) || fields.has("transfer-encoding"))) reject(502);
            const transfers = fields.get("transfer-encoding");
            if (transfers && (transfers.length !== 1 || transfers[0].toLowerCase() !== "chunked")) reject(502);
            if (lengths && request.method !== "HEAD" && Number(lengths[0]) > limits.responseBytes) reject(502);
            const clean = cleanedHeaders(fields); clean.connection = "close";
            response!.writeHead(incoming.statusCode ?? 502, clean); state.started = true;
            incoming.on("error", () => state.fail(502));
            incoming.on("aborted", () => state.fail(502));
            incoming.pipe(meter(state, limits.responseBytes)).pipe(response!);
          } catch { state.fail(502); }
        });
        outgoing.maxHeadersCount = 0;
        outgoing.on("error", () => state.fail(502));
        outgoing.on("upgrade", (_response, socket) => { socket.destroy(); state.fail(502); });
        response!.once("close", () => { teardown(state); client.destroy(); });
        outgoing.end();
      }
    } catch (error) { state.fail(statusOf(error)); }
  }

  return Object.freeze({
    async listen(port = 0): Promise<number> {
      if (!Number.isInteger(port) || port < 0 || port > 65535 || stopping || server.listening) throw new Error("Invalid proxy startup.");
      return new Promise((resolve, rejectStart) => {
        const failed = () => { server.removeListener("listening", ready); rejectStart(new Error("Proxy startup failed.")); };
        const ready = () => { server.removeListener("error", failed); resolve((server.address() as { port: number }).port); };
        server.once("error", failed); server.once("listening", ready);
        server.listen(port, "127.0.0.1");
      });
    },
    async close(): Promise<void> {
      stopping = true;
      const closed = [...clients].map(([socket, state]) => new Promise<void>(resolve => {
        socket.once("close", () => resolve()); teardown(state); socket.destroy();
      }));
      for (const timer of timers) clear(timer);
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      await Promise.all(closed);
    },
    diagnostics: () => ({ clients: clients.size, timers: timers.size,
      upstreams: [...clients.values()].filter(state => state.upstream && !state.upstream.destroyed).length }),
  });
}
