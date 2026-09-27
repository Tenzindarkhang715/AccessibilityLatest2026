import { createApp } from "./app.js";
import { MemoryTestRepository } from "./memory-test-repository.js";
import { createScannerIpcClient } from "./scanner-ipc.js";
import { TestService } from "./test-service.js";

const host = process.env.HOST ?? "127.0.0.1";
const portText = process.env.PORT ?? "3001";
const port = Number(portText);

if (!host.trim() || host !== host.trim() || !/^\d+$/.test(portText)
    || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Invalid configuration: HOST must be nonempty and PORT must be an integer from 1 to 65535.");
  process.exit(1);
}

const scannerSocketPath = process.env.SCANNER_SOCKET_PATH?.trim() || undefined;
const scanner = scannerSocketPath
  ? createScannerIpcClient({ socketPath: scannerSocketPath })
  : undefined;

const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? "")
  .split(",").map(value => value.trim()).filter(Boolean);
for (const origin of frontendOrigins) {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    console.error("Invalid configuration: FRONTEND_ORIGINS must contain comma-separated HTTP(S) origins.");
    process.exit(1);
  }
}

const server = createApp(
  new TestService(new MemoryTestRepository(), scanner),
  { allowedOrigins: frontendOrigins },
);

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
