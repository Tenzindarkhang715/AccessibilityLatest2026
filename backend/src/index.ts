import { createApp } from "./app.js";
import { MemoryTestRepository } from "./memory-test-repository.js";
import { TestService } from "./test-service.js";

const host = process.env.HOST ?? "127.0.0.1";
const portText = process.env.PORT ?? "3001";
const port = Number(portText);

if (!host.trim() || host !== host.trim() || !/^\d+$/.test(portText)
    || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Invalid configuration: HOST must be nonempty and PORT must be an integer from 1 to 65535.");
  process.exit(1);
}

const server = createApp(new TestService(new MemoryTestRepository()));

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
