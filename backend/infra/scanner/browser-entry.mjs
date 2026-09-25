import { mkdir } from "node:fs/promises";
import { Resolver } from "node:dns/promises";
import { pathToFileURL } from "node:url";

import { serve } from "./proxy-entry.mjs";
import { createTargetResolver } from "../../dist/security/target-resolver.js";

const BROWSER_EXECUTABLE =
  "/opt/scanner-runtime/chromium-1243/chrome-linux-arm64/chrome";

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
          resolve: createTargetResolver({
            createResolver: () => {
              const resolver = new Resolver({
                timeout: 1000,
                tries: 1,
              });

              resolver.setServers([message.resolverAddress]);
              return resolver;
            },
          }),
        },
        proxy: {
          server: message.proxyServer,
          username: "proxy",
          password: message.secret,
        },
        browserExecutablePath: BROWSER_EXECUTABLE,
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