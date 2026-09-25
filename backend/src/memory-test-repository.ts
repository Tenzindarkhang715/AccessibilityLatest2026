import type { StoredTest, TestRepository } from "./test-repository.js";
import type { TestRun } from "./models.js";

/** Development-only, empty at startup, discarded on restart. Never seeds history. */
export class MemoryTestRepository implements TestRepository {
  private readonly records = new Map<string, StoredTest>();

  async insert(record: StoredTest): Promise<void> {
    if (this.records.has(record.test.id)) throw new Error("Duplicate test ID.");
    if (record.findings.some(finding => finding.testId !== record.test.id)) {
      throw new Error("Finding belongs to another test.");
    }
    if (record.test.status !== "completed" && record.findings.length > 0) {
      throw new Error("Only completed runs may publish findings.");
    }
    this.records.set(record.test.id, structuredClone(record));
  }

  async replace(record: StoredTest): Promise<boolean> {
    if (!this.records.has(record.test.id)) return false;
    if (record.findings.some(finding => finding.testId !== record.test.id)) {
      throw new Error("Finding belongs to another test.");
    }
    if (record.test.status !== "completed" && record.findings.length > 0) {
      throw new Error("Only completed runs may publish findings.");
    }
    this.records.set(record.test.id, structuredClone(record));
    return true;
  }

  async get(id: string): Promise<StoredTest | undefined> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async recent(limit: number): Promise<TestRun[]> {
    const tests = [...this.records.values()].map(record => record.test);
    tests.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || a.id.localeCompare(b.id));
    return structuredClone(tests.slice(0, limit));
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id);
  }
}
