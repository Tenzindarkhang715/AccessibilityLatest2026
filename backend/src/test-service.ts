import { randomUUID } from "node:crypto";
import { ApiError, invalid } from "./api-error.js";
import type { Finding, ResultsResponse, ScanRequest, TestRun } from "./models.js";
import { ScannerError, type AccessibilityScanner, type FindingDraft } from "./scanner.js";
import type { TestRepository } from "./test-repository.js";
import { scanRequest } from "./validation.js";

function executionRequest(request: ScanRequest): ScanRequest {
  const browsers = request.browsers.length === 1 && /^Chrome(?:\s|$)/i.test(request.browsers[0])
    ? ["chromium"] : [...request.browsers];
  return { ...request, browsers };
}

function publishedFinding(testId: string, draft: FindingDraft): Finding {
  return {
    id: randomUUID(), testId, pageUrl: draft.pageUrl, issue: draft.issue,
    issueType: draft.issueType, severity: draft.severity,
    fixReference: draft.fixReference, screenshotId: draft.screenshotId,
  };
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ScannerError) {
    const messages: Record<ScannerError["code"], string> = {
      UNSUPPORTED_SCAN_OPTIONS: "The requested scan options are not supported.",
      TARGET_NOT_ALLOWED: "The requested target is not allowed.",
      CANCELLED: "The accessibility scan was cancelled.",
      SCAN_TIMEOUT: "The accessibility scan timed out.",
      ENGINE_FAILURE: "The accessibility scanning engine failed.",
      FIXTURE_LOAD_FAILED: "The accessibility scan input could not be loaded.",
    };
    return { code: error.code, message: messages[error.code] };
  }
  return { code: "INTERNAL_ERROR", message: "Accessibility scanning failed." };
}

export class TestService {
  constructor(private readonly repository: TestRepository,
    private readonly scanner?: AccessibilityScanner) {}

  async submit(request: ScanRequest, retestOfId: string | null = null) {
    scanRequest(request);
    if (!this.scanner) {
      throw new ApiError(503, "SCANNER_UNAVAILABLE", "Accessibility scanning is unavailable.");
    }

    const test: TestRun = {
      ...request, id: randomUUID(), status: "pending",
      submittedAt: new Date().toISOString(), completedAt: null,
      retestOfId, failure: null,
    };
    await this.repository.insert({ test, findings: [] });

    // Acceptance is returned immediately. Execution owns all later lifecycle transitions.
    queueMicrotask(() => { void this.execute(test).catch(() => {}); });
    return { test };
  }

  private async execute(accepted: TestRun): Promise<void> {
    if (!this.scanner) return;
    const running: TestRun = { ...accepted, status: "in_progress" };
    if (!await this.repository.replace({ test: running, findings: [] })) return;

    try {
      const outcome = await this.scanner.scan(executionRequest(accepted), {
        signal: new AbortController().signal,
      });
      const completed: TestRun = {
        ...running, status: "completed", completedAt: new Date().toISOString(), failure: null,
      };
      await this.repository.replace({
        test: completed,
        findings: outcome.findings.map(draft => publishedFinding(accepted.id, draft)),
      });
    } catch (error) {
      const failed: TestRun = {
        ...running, status: "failed", completedAt: new Date().toISOString(),
        failure: safeFailure(error),
      };
      await this.repository.replace({ test: failed, findings: [] });
    }
  }

  async recent(limit: number) {
    return { tests: await this.repository.recent(limit) };
  }

  private async requireTest(id: string) {
    const record = await this.repository.get(id);
    if (!record) throw new ApiError(404, "NOT_FOUND", "Test not found.");
    return record;
  }

  async get(id: string) {
    return { test: (await this.requireTest(id)).test };
  }

  async results(id: string, limit: number, cursor: string | null): Promise<ResultsResponse> {
    const { test, findings } = await this.requireTest(id);
    let offset = 0;
    if (cursor !== null) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (decoded.testId !== id || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0
            || Buffer.from(JSON.stringify(decoded)).toString("base64url") !== cursor) {
          invalid("Invalid results cursor.");
        }
        offset = decoded.offset;
      } catch { invalid("Invalid results cursor."); }
    }
    const published = test.status === "completed"
      ? [...findings].sort((a, b) => a.id.localeCompare(b.id)) : [];
    if (offset > published.length) invalid("Invalid results cursor.");
    const page = published.slice(offset, offset + limit);
    return {
      testId: id, status: test.status,
      findings: page.map(finding => ({ ...finding, testType: test.testType, screenshotUrl: null })),
      nextCursor: offset + limit < published.length
        ? Buffer.from(JSON.stringify({ testId: id, offset: offset + limit })).toString("base64url") : null,
    };
  }

  async delete(id: string): Promise<void> {
    if (!await this.repository.delete(id)) throw new ApiError(404, "NOT_FOUND", "Test not found.");
  }

  async retest(id: string) {
    const { test } = await this.requireTest(id);
    return this.submit({ url: test.url, testType: test.testType,
      browsers: test.browsers, wcagStandard: test.wcagStandard }, id);
  }
}
