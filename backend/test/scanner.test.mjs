import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createFixtureScanner, WCAG_TAGS } from "../dist/scanning/playwright-scanner.js";

const request = { url: "https://fixture.example.com/page", testType: "page",
  browsers: ["chromium"], wcagStandard: "wcag_2_1_aa" };
const fixture = name => readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
function setup(load, overrides = {}) {
  const events = [];
  const scanner = createFixtureScanner({ source: { load },
    targetPolicy: { allowedPorts: [443], resolve: async () => ["8.8.8.8"] },
    observe: event => events.push(event), ...overrides });
  return { scanner, events };
}
const scan = (scanner, input = request, signal = new AbortController().signal) => scanner.scan(input, { signal });
function cleaned(events) {
  for (const event of ["browser-started", "page-closed", "context-closed", "browser-closed"]) {
    assert.equal(events.filter(value => value === event).length, 1, `${event}: ${events}`);
  }
}

test("real Chromium and axe produce node evidence, correct tags and cleanup", { timeout: 45_000 }, async () => {
  const { scanner, events } = setup(async url => {
    assert.equal(url, request.url); return fixture("violations");
  });
  const result = await scan(scanner);
  assert.equal(result.execution.engine, "axe-core");
  assert.equal(result.execution.engineVersion, "4.13.0");
  assert.match(result.execution.browserVersion, /^153\./);
  assert.deepEqual(result.execution.tags, ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  assert.deepEqual(result.execution.tags, WCAG_TAGS);
  assert.ok(result.execution.evaluatedRuleIds.includes("button-name"));
  assert.ok(!result.execution.evaluatedRuleIds.includes("region"), "best-practice rule excluded");
  const finding = result.findings.find(item => item.ruleId === "button-name");
  assert.ok(finding);
  assert.deepEqual(finding.target, ["#unnamed"]);
  assert.match(finding.html, /id="unnamed"/);
  assert.match(finding.fixReference, /button-name/);
  assert.ok(finding.failureSummary);
  assert.equal(finding.pageUrl, request.url);
  assert.equal(finding.screenshotId, null);
  for (const finding of result.findings) assert.ok(finding.tags.some(tag => WCAG_TAGS.includes(tag)));
  cleaned(events);
});

test("fixing fixture markup eliminates the actual axe violation; zero findings is valid", { timeout: 45_000 }, async () => {
  const { scanner, events } = setup(() => fixture("no-violations"));
  const result = await scan(scanner);
  assert.deepEqual(result.findings, []);
  assert.ok(result.execution.evaluatedRuleIds.includes("button-name"));
  assert.deepEqual(result.execution.incompleteRuleIds, []);
  cleaned(events);
});

test("unsupported type, browser and WCAG are rejected before fixture loading or launch", async () => {
  const { scanner, events } = setup(async () => assert.fail("must not load"));
  for (const input of [{ ...request, testType: "site" }, { ...request, browsers: ["firefox"] },
    { ...request, browsers: ["Chrome 137 (Latest)"] }, { ...request, browsers: ["chromium", "webkit"] },
    { ...request, browsers: [] }, { ...request, wcagStandard: "wcag_2_2_aa" }]) {
    await assert.rejects(scan(scanner, input), { code: "UNSUPPORTED_SCAN_OPTIONS" });
  }
  assert.deepEqual(events, []);
});

test("existing target policy blocks literals, credentials, protocols and DNS private answers", async () => {
  const { scanner, events } = setup(async () => assert.fail("must not load"));
  for (const url of ["https://127.0.0.1", "https://[::1]", "https://169.254.169.254",
    "https://user:pass@example.com", "file:///tmp/page.html"]) {
    await assert.rejects(scan(scanner, { ...request, url }), { code: "TARGET_NOT_ALLOWED" });
  }
  const privateDns = setup(async () => assert.fail("must not load"), {
    targetPolicy: { allowedPorts: [443], resolve: async () => ["8.8.8.8", "10.0.0.1"] },
  });
  await assert.rejects(scan(privateDns.scanner), { code: "TARGET_NOT_ALLOWED" });
  assert.deepEqual(events, []); assert.deepEqual(privateDns.events, []);
});

test("fixture loading failure returns a safe error and closes all resources", { timeout: 45_000 }, async () => {
  const { scanner, events } = setup(async () => { throw new Error("private fixture detail"); });
  await assert.rejects(scan(scanner), { code: "FIXTURE_LOAD_FAILED", message: "Scanner failed: FIXTURE_LOAD_FAILED." });
  cleaned(events);
});

test("actual axe execution failure returns ENGINE_FAILURE and closes resources", { timeout: 45_000 }, async () => {
  const { scanner, events } = setup(async () => `<!doctype html><html lang="en"><title>Failure</title>
    <script>Object.defineProperty(window, 'axe', {value: {}, writable: false, configurable: false});</script>
    <main><h1>Fixture</h1></main></html>`);
  await assert.rejects(scan(scanner), { code: "ENGINE_FAILURE" });
  cleaned(events);
});

test("cancellation before launch creates no resources", async () => {
  const { scanner, events } = setup(async () => assert.fail("must not load"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(scan(scanner, request, controller.signal), { code: "CANCELLED" });
  assert.deepEqual(events, []);
});

test("cancellation during fixture loading closes real resources", { timeout: 45_000 }, async () => {
  const controller = new AbortController();
  const { scanner, events } = setup(async () => {
    controller.abort(); return new Promise(() => {});
  });
  await assert.rejects(scan(scanner, request, controller.signal), { code: "CANCELLED" });
  cleaned(events);
});

test("total scan deadline terminates a stalled fixture load and cleans resources", { timeout: 15_000 }, async () => {
  const { scanner, events } = setup(async () => new Promise(() => {}), { scanTimeoutMs: 5_000 });
  await assert.rejects(scan(scanner), { code: "SCAN_TIMEOUT" });
  cleaned(events);
});

test("invalid timeout configuration is rejected", () => {
  for (const scanTimeoutMs of [0, -1, Infinity, 1.5, 2_147_483_648]) {
    assert.throws(() => setup(() => fixture("no-violations"), { scanTimeoutMs }));
  }
});
