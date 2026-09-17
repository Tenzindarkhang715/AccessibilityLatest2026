import { ApiError, invalid } from "./api-error.js";
import type { ResultsResponse, ScanRequest } from "./models.js";
import type { TestRepository } from "./test-repository.js";
import { scanRequest } from "./validation.js";

export class TestService {
  constructor(private readonly repository: TestRepository) {}

  async submit(request: ScanRequest): Promise<never> {
    scanRequest(request);
    // No ID allocation or persistence until a real execution path can accept work.
    throw new ApiError(503, "SCANNER_UNAVAILABLE", "Accessibility scanning is unavailable.");
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

  async retest(id: string): Promise<never> {
    const { test } = await this.requireTest(id);
    return this.submit({ url: test.url, testType: test.testType,
      browsers: test.browsers, wcagStandard: test.wcagStandard });
  }
}
