
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestService } from "../dist/test-service.js";
import { MemoryTestRepository } from "../dist/memory-test-repository.js";
import { ScannerError } from "../dist/scanner.js";

const input = {
  url: "https://example.com", testType: "page",
  browsers: ["Chrome 137 (Latest)", "Firefox 139 (Latest)"],
  wcagStandard: "wcag_2_1_aa",
};
function outcome(browser) {
  return {
    findings: [{
      pageUrl: input.url, issue: "Fixture finding", issueType: "fixture",
      severity: "serious", fixReference: null, screenshotId: null,
      ruleId: "fixture", target: ["#fixture"], html: "<div></div>",
      failureSummary: null, tags: [],
    }],
    execution: {
      browser, browserVersion: "fixture-version", engine: "axe-core",
      engineVersion: "fixture", tags: [], evaluatedRuleIds: [],
      incompleteRuleIds: [], mode: "live",
    },
  };
}
async function terminal(repository, id) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const record = await repository.get(id);
    if (["completed", "failed"].includes(record.test.status)) return record;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Fixture did not finish.");
}

test("combined run scans sequentially and publishes browser-attributed findings", async () => {
  const repository = new MemoryTestRepository();
  const calls = [];
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const service = new TestService(repository, {
    async scan(request) {
      calls.push(request);
      if (calls.length === 2) { entered(); await gate; }
      return outcome(request.browsers[0]);
    },
  });
  const submitted = await service.submit(input);
  await waiting;
  assert.deepEqual(calls.map(call => call.browsers), [["chromium"], ["firefox"]]);
  assert.equal((await repository.get(submitted.test.id)).test.status, "in_progress");
  assert.deepEqual((await service.results(submitted.test.id, 100, null)).findings, []);
  release();
  const record = await terminal(repository, submitted.test.id);
  assert.equal(record.test.status, "completed");
  assert.deepEqual(record.test.browsers, input.browsers);
  const results = await service.results(submitted.test.id, 100, null);
  assert.equal(results.findings.length, 2);
  assert.deepEqual(results.findings.map(f => f.browser).sort(),
    ["Chromium fixture-version", "Firefox fixture-version"]);
});

test("failure in the second browser publishes no partial findings", async () => {
  const repository = new MemoryTestRepository();
  let calls = 0;
  const service = new TestService(repository, {
    async scan(request) {
      if (++calls === 2) throw new ScannerError("ENGINE_FAILURE");
      return outcome(request.browsers[0]);
    },
  });
  const submitted = await service.submit(input);
  const record = await terminal(repository, submitted.test.id);
  assert.equal(calls, 2);
  assert.equal(record.test.status, "failed");
  assert.deepEqual(record.findings, []);
  assert.equal(record.test.failure.code, "ENGINE_FAILURE");
});

test("unsupported combined selections launch no scans", async () => {
  for (const browsers of [
    ["Chrome 137 (Latest)", "Safari 18.5"],
    ["Chrome 137 (Latest)", "Chrome 136"],
    ["chromium", "firefox", "chromium"],
  ]) {
    const repository = new MemoryTestRepository();
    let calls = 0;
    const service = new TestService(repository, {
      async scan() { calls++; throw new Error("Must not execute."); },
    });
    const submitted = await service.submit({ ...input, browsers });
    const record = await terminal(repository, submitted.test.id);
    assert.equal(calls, 0);
    assert.equal(record.test.failure.code, "UNSUPPORTED_SCAN_OPTIONS");
  }
});
