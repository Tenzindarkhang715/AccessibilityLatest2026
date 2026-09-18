import net from "node:net";
import dgram from "node:dgram";
import { Resolver } from "node:dns/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import ipaddr from "ipaddr.js";
import { serve } from "../../infra/scanner/proxy-entry.mjs";

export const FIXTURE = Object.freeze({ public: "8.8.8.8", private: "10.20.0.1", link: "169.254.8.8",
  metadata: "169.254.169.254", host: "10.88.0.2", gateway: "10.99.0.1", resolver: "10.88.0.53",
  wrongResolver: "10.88.0.54", ipv6: "2001:db8:99::1" });

/** Authoritative fixture DNS only. No recursion or external query path. */
export function dnsResponse(query, records, truncate = false) {
  if (!Buffer.isBuffer(query) || query.length < 17 || query.readUInt16BE(4) !== 1) throw new Error("Invalid DNS query");
  let offset = 12; const labels = [];
  while (query[offset] !== 0) {
    const length = query[offset++];
    if (!length || length > 63 || offset + length >= query.length) throw new Error("Invalid DNS name");
    labels.push(query.subarray(offset, offset + length).toString("ascii")); offset += length;
  }
  offset++;
  if (offset + 4 > query.length || query.readUInt16BE(offset + 2) !== 1) throw new Error("Invalid DNS question");
  const type = query.readUInt16BE(offset); const name = labels.join(".").toLowerCase();
  const answer = records[name];
  const values = truncate ? [] : (type === 1 ? answer?.A : type === 28 ? answer?.AAAA : []) ?? [];
  const header = Buffer.alloc(12); query.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8400 | (query.readUInt16BE(2) & 0x0100) | (truncate ? 0x0200 : 0) | (answer ? 0 : 3), 2);
  header.writeUInt16BE(1, 4); header.writeUInt16BE(values.length, 6);
  const encoded = values.map(value => {
    const bytes = Buffer.from(ipaddr.parse(value).toByteArray());
    if (bytes.length !== (type === 1 ? 4 : 16)) throw new Error("Wrong DNS family");
    const rr = Buffer.alloc(12); rr.writeUInt16BE(0xc00c); rr.writeUInt16BE(type, 2);
    rr.writeUInt16BE(1, 4); rr.writeUInt16BE(bytes.length, 10);
    return Buffer.concat([rr, bytes]);
  });
  return { name, response: Buffer.concat([header, query.subarray(12, offset + 4), ...encoded]) };
}

export async function socketProbe({ host, port, transport = "tcp", payload = "probe", http = false, tunnel = false }) {
  if (!["tcp", "udp"].includes(transport) || !net.isIP(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Literal fixture endpoint required");
  return new Promise(resolve => {
    let finished = false; let response = ""; let sentTunnel = false;
    const socket = transport === "udp" ? dgram.createSocket(net.isIP(host) === 6 ? "udp6" : "udp4") : net.connect({ host, port });
    const timer = setTimeout(() => finish(false), 700);
    function finish(delivered) {
      if (finished) return; finished = true; clearTimeout(timer);
      if (transport === "udp") { try { socket.close(); } catch {} } else socket.destroy();
      resolve({ delivered, response });
    }
    socket.on("error", () => finish(false));
    if (transport === "udp") {
      socket.on("message", bytes => { response += bytes.toString(); finish(true); }); socket.send(payload, port, host);
    } else {
      socket.on("connect", () => socket.write(payload));
      socket.on("data", bytes => {
        response += bytes.toString();
        if (tunnel && response.startsWith("HTTP/1.1 200 ")) {
          if (!sentTunnel && response.includes("\r\n\r\n")) { sentTunnel = true; socket.write("fixture-tunnel"); }
          else if (sentTunnel && response.endsWith("fixture-tunnel")) finish(true);
        } else if (!http || response.includes("\r\n\r\n")) finish(true);
      });
      socket.on("end", () => finish(response.length > 0));
    }
  });
}

async function main() {
  const servers = []; const sockets = new Set(); const counts = {};
  let records = { "fixture.example.com": { A: [FIXTURE.public], AAAA: [] } }; let truncated = false;
  const bump = key => { counts[key] = (counts[key] ?? 0) + 1; };
  const tcp = async (host, port, dns = false) => {
    const server = net.createServer(socket => {
      sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
      bump(`tcp:${host}:${port}`); let buffer = Buffer.alloc(0);
      socket.on("data", chunk => {
        if (dns) {
          buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 65537) return socket.destroy();
          while (buffer.length >= 2 && buffer.length >= 2 + buffer.readUInt16BE(0)) {
            const size = buffer.readUInt16BE(0); const query = buffer.subarray(2, size + 2); buffer = buffer.subarray(size + 2);
            try { const result = dnsResponse(query, records); bump(`dns-tcp:${result.name}`);
              const length = Buffer.alloc(2); length.writeUInt16BE(result.response.length); socket.write(Buffer.concat([length, result.response]));
            } catch { socket.destroy(); }
          }
        } else if (port === 80) socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nfixture");
        else socket.write(chunk);
      });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); }); servers.push(server);
  };
  const udp = async (host, port, dns = false) => {
    const server = dgram.createSocket(net.isIP(host) === 6 ? "udp6" : "udp4");
    server.on("message", (query, peer) => {
      bump(`udp:${host}:${port}`);
      try { const result = dns ? dnsResponse(query, records, truncated) : { response: query };
        if (dns) bump(`dns-udp:${result.name}`); server.send(result.response, peer.port, peer.address);
      } catch { /* Invalid fixture query: no reply. */ }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.bind(port, host, resolve); }); servers.push(server);
  };
  await serve(async m => {
    if (m.op === "start") {
      if (servers.length) throw new Error("Already started");
      if (m.role === "fixture") {
        for (const host of Object.values(FIXTURE)) {
          if (host === FIXTURE.resolver || host === FIXTURE.wrongResolver) {
            await tcp(host, 53, true); await udp(host, 53, true); await tcp(host, 9000); continue;
          }
          for (const port of [80, 443, 9000]) await tcp(host, port);
          for (const port of [53, 443, 3478, 9999]) await udp(host, port);
        }
      } else { await tcp("127.0.0.1", 9000); if (m.role === "proxy-probe") await tcp("10.77.0.1", 9000); }
      return true;
    }
    if (m.op === "probe") return socketProbe(m);
    if (m.op === "listeners") return servers.map(server => server.address());
    if (m.op === "stats") return { ...counts };
    if (m.op === "dns") { records = m.records; truncated = Boolean(m.truncated); return true; }
    if (m.op === "resolve") {
      const resolver = new Resolver({ timeout: 500, tries: 1 }); resolver.setServers([m.server]);
      try { return { answers: await resolver.resolve4("fixture.example.com.") }; }
      catch { return { failed: true }; } finally { resolver.cancel(); }
    }
    if (m.op === "admin") {
      const results = [];
      for (const [file, args] of [["ip", ["route", "add", "192.0.2.1/32", "dev", "lo"]], ["nft", ["add", "table", "inet", "forbidden_probe"]]]) {
        try { await promisify(execFile)(file, args, { timeout: 2000 }); results.push({ denied: false }); }
        catch (error) { results.push({ denied: /[Pp]ermission|[Oo]peration not permitted/.test(error.stderr ?? "") }); }
      }
      return results;
    }
    throw new Error("Unsupported fixture command");
  }, async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { process.exitCode = 1; });
