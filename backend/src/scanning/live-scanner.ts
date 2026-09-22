/// <reference lib="dom" />

import { chromium, type Browser, type BrowserServer } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

import {
  ScannerError,
  type AccessibilityScanner,
  type ScanOutcome,
} from "../scanner.js";
import {
  createTargetPolicy,
  TargetPolicyError,
  type TargetPolicyOptions,
} from "../security/target-policy.js";
import { mapAxeFindings } from "./axe-findings.js";
import { WCAG_TAGS } from "./playwright-scanner.js";

export interface LiveProxyConfiguration {
  readonly server: string;
  readonly username: string;
  readonly password: string;
}

export function createLiveScanner(options: {
  targetPolicy: TargetPolicyOptions;
  proxy: LiveProxyConfiguration;
  browserExecutablePath?: string;
  scanTimeoutMs?: number;
  documentTimeoutMs?: number;
  observe?: (
    event:
      | "browser-started"
      | "page-closed"
      | "context-closed"
      | "browser-closed",
  ) => void;
}): AccessibilityScanner {
  const policy = createTargetPolicy(options.targetPolicy);

  const scanTimeoutMs = options.scanTimeoutMs ?? 30_000;
  const documentTimeoutMs = options.documentTimeoutMs ?? 10_000;

  for (const value of [scanTimeoutMs, documentTimeoutMs]) {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > 2_147_483_647
    ) {
      throw new Error("Invalid scanner timeout.");
    }
  }

  let proxyUrl: URL;

  try {
    proxyUrl = new URL(options.proxy.server);
  } catch {
    throw new Error("Invalid live scanner proxy configuration.");
  }

  if (
    proxyUrl.protocol !== "http:" ||
    proxyUrl.username ||
    proxyUrl.password ||
    !proxyUrl.hostname ||
    !proxyUrl.port ||
    options.proxy.username !== "proxy" ||
    !options.proxy.password
  ) {
    throw new Error("Invalid live scanner proxy configuration.");
  }

  const observe = (
    event: Parameters<NonNullable<typeof options.observe>>[0],
  ) => {
    try {
      options.observe?.(event);
    } catch {
      // Observers cannot interfere with cleanup.
    }
  };

  return {
    async scan(request, control): Promise<ScanOutcome> {
      if (
        request.testType !== "page" ||
        request.wcagStandard !== "wcag_2_1_aa" ||
        request.browsers.length !== 1 ||
        request.browsers[0] !== "chromium"
      ) {
        throw new ScannerError("UNSUPPORTED_SCAN_OPTIONS");
      }

      const controller = new AbortController();
      const deadline = Date.now() + scanTimeoutMs;

      const cancel = () =>
        controller.abort(new ScannerError("CANCELLED"));

      control.signal.addEventListener("abort", cancel, { once: true });

      if (control.signal.aborted) {
        cancel();
      }

      const timer = setTimeout(
        () => controller.abort(new ScannerError("SCAN_TIMEOUT")),
        scanTimeoutMs,
      );

      const signal = controller.signal;

      const check = () => {
        if (signal.aborted) {
          throw signal.reason;
        }
      };

      let rejectAbort: (reason: unknown) => void = () => {};

      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });

      void aborted.catch(() => {});

      const onAbort = () => rejectAbort(signal.reason);

      signal.addEventListener("abort", onAbort, { once: true });

      const bounded = <T>(operation: Promise<T>) =>
        Promise.race([operation, aborted]);

      let server: BrowserServer | undefined;
      let browser: Browser | undefined;

      try {
        check();

        /*
         * This assessment is an admission check only. It is not the connection
         * security boundary. Every browser connection must still be forced
         * through the validating proxy by the surrounding Linux worker
         * network boundary.
         */
        const target = await bounded(policy.assess(request.url, signal));

        check();

        server = await chromium.launchServer({
          headless: true,
          host: "127.0.0.1",
          executablePath: options.browserExecutablePath,
          timeout: Math.max(1, deadline - Date.now()),
          chromiumSandbox: true,
          args: ["--disable-background-networking"],
        });

        check();

        browser = await bounded(
          chromium.connect(server.wsEndpoint(), {
            timeout: documentTimeoutMs,
          }),
        );

        observe("browser-started");

        const context = await bounded(
          browser.newContext({
            proxy: {
              server: options.proxy.server,
              username: options.proxy.username,
              password: options.proxy.password,
            },
            serviceWorkers: "block",
            acceptDownloads: false,
          }),
        );

        context.on("close", () => observe("context-closed"));

        await bounded(
          context.routeWebSocket("**/*", socket => socket.close()),
        );

        const page = await bounded(context.newPage());

        page.on("close", () => observe("page-closed"));

        page.on("dialog", dialog => {
          void dialog.dismiss().catch(() => {});
        });

        page.on("popup", popup => {
          void popup.close().catch(() => {});
        });

        page.on("download", download => {
          void download.cancel().catch(() => {});
        });

        check();

        await bounded(
          page.goto(target.url, {
            waitUntil: "domcontentloaded",
            timeout: documentTimeoutMs,
          }),
        );

        check();

        const results = await bounded(
          new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze(),
        );

        check();

        const allResults = [
          ...results.violations,
          ...results.passes,
          ...results.incomplete,
          ...results.inapplicable,
        ];

        return {
          findings: mapAxeFindings(results, page.url()),
          execution: {
            browser: "chromium",
            browserVersion: browser.version(),
            engine: results.testEngine.name,
            engineVersion: results.testEngine.version,
            tags: [...WCAG_TAGS],
            evaluatedRuleIds: [
              ...new Set(allResults.map(rule => rule.id)),
            ].sort(),
            incompleteRuleIds: results.incomplete.map(rule => rule.id),
            mode: "live",
          },
        };
      } catch (error) {
        if (signal.aborted) {
          throw signal.reason;
        }

        if (error instanceof ScannerError) {
          throw error;
        }

        if (error instanceof TargetPolicyError) {
          throw new ScannerError("TARGET_NOT_ALLOWED");
        }

        throw new ScannerError("ENGINE_FAILURE");
      } finally {
        clearTimeout(timer);

        control.signal.removeEventListener("abort", cancel);
        signal.removeEventListener("abort", onAbort);

        if (server) {
          const ownedServer = server;

          const killTimer = setTimeout(() => {
            void ownedServer.kill().catch(() => {});
          }, 2_000);

          try {
            if (browser) {
              await browser.close().catch(() => {});
            }

            await ownedServer.close();
          } catch {
            await ownedServer.kill();
          } finally {
            clearTimeout(killTimer);
            observe("browser-closed");
          }
        }
      }
    },
  };
}