/// <reference lib="dom" />
// Browser library declarations need DOM types; no browser types enter scanner.ts.
import { chromium, type Browser, type BrowserServer } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { ScannerError, type AccessibilityScanner, type FixtureSource, type ScanOutcome } from "../scanner.js";
import { createTargetPolicy, TargetPolicyError, type TargetPolicyOptions } from "../security/target-policy.js";
import { mapAxeFindings } from "./axe-findings.js";

export const WCAG_TAGS = Object.freeze(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);

/** Deliberately fixture-only: no goto, route.continue, route.fetch, or live source.
 * Never composed into index.ts. Offline mode/routing is not a hostile-page sandbox.
 */
export function createFixtureScanner(options: {
  source: FixtureSource;
  targetPolicy: TargetPolicyOptions;
  scanTimeoutMs?: number;
  documentTimeoutMs?: number;
  // Plain lifecycle observations for deterministic cleanup checks; no handles leak.
  observe?: (event: "browser-started" | "page-closed" | "context-closed" | "browser-closed") => void;
}): AccessibilityScanner {
  const policy = createTargetPolicy(options.targetPolicy);
  const scanTimeoutMs = options.scanTimeoutMs ?? 30_000;
  const documentTimeoutMs = options.documentTimeoutMs ?? 5_000;
  for (const value of [scanTimeoutMs, documentTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error("Invalid scanner timeout.");
  }
  const observe = (event: Parameters<NonNullable<typeof options.observe>>[0]) => {
    try { options.observe?.(event); } catch { /* Observers cannot interfere with cleanup. */ }
  };

  return {
    async scan(request, control): Promise<ScanOutcome> {
      if (request.testType !== "page" || request.wcagStandard !== "wcag_2_1_aa"
          || request.browsers.length !== 1 || request.browsers[0] !== "chromium") {
        throw new ScannerError("UNSUPPORTED_SCAN_OPTIONS");
      }
      const controller = new AbortController();
      const deadline = Date.now() + scanTimeoutMs;
      const cancel = () => controller.abort(new ScannerError("CANCELLED"));
      control.signal.addEventListener("abort", cancel, { once: true });
      if (control.signal.aborted) cancel();
      const timer = setTimeout(() => controller.abort(new ScannerError("SCAN_TIMEOUT")), scanTimeoutMs);
      const signal = controller.signal;
      const check = () => { if (signal.aborted) throw signal.reason; };
      let rejectAbort: (reason: unknown) => void = () => {};
      const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
      // Register rejection handling immediately, including cancellation before launch.
      void aborted.catch(() => {});
      const onAbort = () => rejectAbort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      const bounded = <T>(operation: Promise<T>) => Promise.race([operation, aborted]);
      let server: BrowserServer | undefined;
      let browser: Browser | undefined;
      try {
        check();
        const target = await bounded(policy.assess(request.url, signal));
        check();
        // Launch has its own hard timeout. A cancellation during launch is checked
        // immediately afterwards so the process handle can always be cleaned up.
        server = await chromium.launchServer({ headless: true, host: "127.0.0.1",
          timeout: Math.max(1, deadline - Date.now()),
          chromiumSandbox: true, args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND"] });
        check();
        browser = await bounded(chromium.connect(server.wsEndpoint(), { timeout: documentTimeoutMs }));
        observe("browser-started");
        const context = await bounded(browser.newContext({ offline: true, serviceWorkers: "block", acceptDownloads: false }));
        context.on("close", () => observe("context-closed"));
        await bounded(context.route("**/*", route => route.abort("blockedbyclient")));
        await bounded(context.routeWebSocket("**/*", socket => socket.close()));
        const page = await bounded(context.newPage());
        page.on("close", () => observe("page-closed"));
        page.on("dialog", dialog => { void dialog.dismiss().catch(() => {}); });
        page.on("popup", popup => { void popup.close().catch(() => {}); });
        page.on("download", download => { void download.cancel().catch(() => {}); });
        check();
        let html: string;
        try { html = await bounded(options.source.load(target.url, signal)); }
        catch { check(); throw new ScannerError("FIXTURE_LOAD_FAILED"); }
        if (typeof html !== "string") throw new ScannerError("FIXTURE_LOAD_FAILED");
        // Render supplied bytes at about:blank, never navigate to the target URL.
        await bounded(page.setContent(html, { waitUntil: "domcontentloaded", timeout: documentTimeoutMs }));
        const results = await bounded(new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze());
        check();
        const allResults = [...results.violations, ...results.passes, ...results.incomplete, ...results.inapplicable];
        return { findings: mapAxeFindings(results, target.url), execution: {
          browser: "chromium", browserVersion: browser.version(), engine: results.testEngine.name,
          engineVersion: results.testEngine.version, tags: [...WCAG_TAGS],
          evaluatedRuleIds: [...new Set(allResults.map(rule => rule.id))].sort(),
          incompleteRuleIds: results.incomplete.map(rule => rule.id), mode: "fixture-only",
        } };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof ScannerError) throw error;
        if (error instanceof TargetPolicyError) throw new ScannerError("TARGET_NOT_ALLOWED");
        throw new ScannerError("ENGINE_FAILURE");
      } finally {
        clearTimeout(timer);
        control.signal.removeEventListener("abort", cancel);
        signal.removeEventListener("abort", onAbort);
        // Explicit process ownership permits forceful cleanup if graceful close stalls.
        if (server) {
          const ownedServer = server;
          const killTimer = setTimeout(() => { void ownedServer.kill().catch(() => {}); }, 2_000);
          try {
            if (browser) await browser.close().catch(() => {});
            await ownedServer.close();
          } catch { await ownedServer.kill(); }
          finally { clearTimeout(killTimer); observe("browser-closed"); }
        }
      }
    },
  };
}
