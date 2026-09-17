import { createServer, type ServerResponse } from "node:http";
import type { ApiErrorResponse } from "./models.js";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  status: number,
  code: ApiErrorResponse["error"]["code"],
  message: string,
): void {
  sendJson(response, status, { error: { code, message } } satisfies ApiErrorResponse);
}

const host = process.env.HOST ?? "127.0.0.1";
const portText = process.env.PORT ?? "3001";
const port = Number(portText);

if (!host.trim() || host !== host.trim() || !/^\d+$/.test(portText)
    || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Invalid configuration: HOST must be nonempty and PORT must be an integer from 1 to 65535.");
  process.exit(1);
}

const server = createServer((request, response) => {
  // This skeleton accepts no request bodies and never parses submitted JSON.
  request.on("error", () => response.destroy());
  try {
    const path = request.url?.split("?", 1)[0];
    if (path !== "/health") {
      sendError(response, 404, "NOT_FOUND", "Route not found.");
    } else if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendError(response, 405, "INVALID_REQUEST", "Method not allowed.");
    } else if (request.headers["transfer-encoding"] !== undefined
        || (request.headers["content-length"] !== undefined
          && request.headers["content-length"] !== "0")) {
      response.setHeader("Connection", "close");
      sendError(response, 400, "INVALID_REQUEST", "Request body is not supported.");
    } else {
      sendJson(response, 200, { status: "ok" });
    }
    request.resume();
  } catch {
    if (response.headersSent) response.destroy();
    else sendError(response, 500, "INTERNAL_ERROR", "Internal server error.");
  }
});

// Parser errors happen before the request handler; avoid exposing parser details.
server.on("clientError", (_error, socket) => {
  if (!socket.writable || socket.destroyed) return;
  const body = JSON.stringify({
    error: { code: "INVALID_REQUEST", message: "Malformed HTTP request." },
  } satisfies ApiErrorResponse);
  socket.end("HTTP/1.1 400 Bad Request\r\n"
    + "Content-Type: application/json; charset=utf-8\r\n"
    + "Connection: close\r\n"
    + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
});

server.on("error", () => {
  console.error("Backend server failed to start or encountered a server error.");
  process.exit(1);
});

server.listen(port, host, () => console.log("Backend listening."));

function stop(): void {
  server.close();
  server.closeAllConnections();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
