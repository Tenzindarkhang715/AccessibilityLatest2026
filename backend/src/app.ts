import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ApiError, invalid } from "./api-error.js";
import type { ApiErrorResponse } from "./models.js";
import type { TestService } from "./test-service.js";
import { limit, queryKeys, runId, scanRequest } from "./validation.js";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function noBody(request: IncomingMessage): void {
  if (request.headers["transfer-encoding"] !== undefined
      || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
    invalid("Request body is not supported.");
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    invalid("Content-Type must be application/json.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 16_384) invalid("Request body exceeds 16384 bytes.");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return invalid("Malformed JSON body."); }
}

export function createApp(service: TestService) {
  const server = createServer((request, response) => {
    request.on("error", () => { /* A disconnected request must not crash the server. */ });
    void route(request, response).catch(error => {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      const failure = error instanceof ApiError ? error
        : new ApiError(500, "INTERNAL_ERROR", "Internal server error.");
      response.setHeader("Connection", "close");
      json(response, failure.status, { error: { code: failure.code, message: failure.message } });
    }).finally(() => request.resume());
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://localhost"); }
    catch { return invalid("Invalid request target."); }
    const path = url.pathname;
    const match = /^\/api\/tests\/([^/]+)(?:\/(results|retests))?$/.exec(path);
    const allowed = path === "/health" ? ["GET"]
      : path === "/api/tests" ? ["GET", "POST"]
      : match ? (match[2] === "retests" ? ["POST"] : match[2] === "results" ? ["GET"] : ["GET", "DELETE"])
      : [];
    if (!allowed.length) throw new ApiError(404, "NOT_FOUND", "Route not found.");
    if (!allowed.includes(request.method ?? "")) {
      response.setHeader("Allow", allowed.join(", "));
      throw new ApiError(405, "INVALID_REQUEST", "Method not allowed.");
    }
    if (path === "/health") {
      noBody(request);
      json(response, 200, { status: "ok" });
      return;
    }
    if (path === "/api/tests" && request.method === "POST") {
      queryKeys(url.searchParams, []);
      await service.submit(scanRequest(await readJson(request)));
      return;
    }
    noBody(request);
    if (path === "/api/tests") {
      queryKeys(url.searchParams, ["limit"]);
      json(response, 200, await service.recent(limit(url.searchParams, 10)));
      return;
    }
    const id = runId(match![1]);
    if (match![2] === "results") {
      queryKeys(url.searchParams, ["limit", "cursor"]);
      json(response, 200, await service.results(id, limit(url.searchParams, 50), url.searchParams.get("cursor")));
      return;
    }
    queryKeys(url.searchParams, []);
    if (match![2] === "retests") { await service.retest(id); return; }
    if (request.method === "DELETE") {
      await service.delete(id);
      response.writeHead(204);
      response.end();
      return;
    }
    json(response, 200, await service.get(id));
  }

  server.on("clientError", (_error, socket) => {
    if (!socket.writable || socket.destroyed) return;
    const body = JSON.stringify({ error: { code: "INVALID_REQUEST", message: "Malformed HTTP request." } } satisfies ApiErrorResponse);
    socket.end("HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\n"
      + `Connection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
  return server;
}
