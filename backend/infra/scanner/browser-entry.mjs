import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { serve } from "./proxy-entry.mjs";

const CHROMIUM_EXECUTABLE =
  "/opt/scanner-runtime/chromium-1243/chrome-linux-arm64/chrome";

const FIREFOX_EXECUTABLE =
  "/opt/scanner-runtime/firefox-1543/firefox/firefox";

async function main() {
  let scanner;

  await serve(
    async message => {
      if (message.op !== "scan" || scanner) {
        throw new Error("Invalid browser operation");
      }

      await mkdir("/tmp/browser-home", {
        recursive: true,
        mode: 0o700,
      });

      process.env.HOME = "/tmp/browser-home";

      const { createLiveScanner } =
        await import("../../dist/scanning/live-scanner.js");

      scanner = createLiveScanner({
        targetPolicy: {
          allowedPorts: [80, 443],
          // Browser admission must never perform DNS. The isolated egress
          // proxy independently resolves, validates and pins every connection.
          resolve: async () => {
            throw new Error("Browser target policy must not resolve DNS");
          },
        },
        proxy: {
          server: message.proxyServer,
          username: "proxy",
          password: message.secret,
        },
        browserExecutablePath:
          message.request.browsers[0] === "firefox"
            ? FIREFOX_EXECUTABLE
            : CHROMIUM_EXECUTABLE,
        observe: event => {
          console.error(`[scanner-browser-stage] ${event}`);
        },
      });

      return scanner.scan(
        message.request,
        {
          signal: new AbortController().signal,
        },
      );
    },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.exitCode = 1;
  });
}