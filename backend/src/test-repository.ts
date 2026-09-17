import type { Finding, TestRun } from "./models.js";

/** One consistent run/findings snapshot. No HTTP or storage-specific types. */
export interface StoredTest {
  test: TestRun;
  findings: Finding[];
}

export interface TestRepository {
  /** Insert only; must not overwrite existing IDs. Not exposed as an HTTP route. */
  insert(record: StoredTest): Promise<void>;
  get(id: string): Promise<StoredTest | undefined>;
  /** Submission time descending, then ID ascending for ties. */
  recent(limit: number): Promise<TestRun[]>;
  /** Atomically remove a run and its findings. Do not delete independent re-tests. */
  delete(id: string): Promise<boolean>;
}
