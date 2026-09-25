/**
 * Standalone domain/API contract only. No server, persistence, or scanner implementation.
 * See ../API_CONTRACT.md for lifecycle, validation, compatibility, and deferred decisions.
 * Legacy frontend record shapes intentionally do not belong in this module.
 */

/** Opaque application-generated identifier; not a ServiceNow record identifier. */
export type Id = string;
/** ISO 8601 UTC timestamp. Runtime validation is required at implementation time. */
export type Timestamp = string;

export type TestType = "site" | "page";
export type TestStatus = "pending" | "in_progress" | "completed" | "failed";
export type WcagStandard =
  | "wcag_2_0_a" | "wcag_2_0_aa" | "wcag_2_0_aaa"
  | "wcag_2_1_a" | "wcag_2_1_aa" | "wcag_2_1_aaa"
  | "wcag_2_2_a" | "wcag_2_2_aa" | "wcag_2_2_aaa";

export interface ScanRequest {
  url: string;
  testType: TestType;
  /** Requested selections, not proof of executable browser/version support. */
  browsers: string[];
  /** Requested coverage; does not assert complete WCAG conformance. */
  wcagStandard: WcagStandard;
}

export interface ScanFailure {
  /** Scanner failure taxonomy is deferred; never expose stack traces or secrets. */
  code: string;
  message: string;
}

export interface TestRun extends ScanRequest {
  id: Id;
  status: TestStatus;
  /** Time the request was accepted and its run record created. */
  submittedAt: Timestamp;
  /** Terminal timestamp for either completed or failed; null before termination. */
  completedAt: Timestamp | null;
  /** Historical lineage only; deleting the source must not delete its re-tests. */
  retestOfId: Id | null;
  failure: ScanFailure | null;
}

export interface Finding {
  id: Id;
  testId: Id;
  pageUrl: string;
  issue: string;
  /** Category taxonomy and engine mapping are deferred. */
  issueType: string;
  /** Severity taxonomy and handling of unknown impact are deferred. */
  severity: string | null;
  fixReference: string | null;
  screenshotId: Id | null;
}

/** API projection: derived fields are not additional authoritative stored state. */
export interface FindingResponse extends Finding {
  testType: TestType;
  /** Authorized delivery URL, never a filesystem path or storage credential. */
  screenshotUrl: string | null;
}

/** Internal future screenshot metadata; storageKey must not be exposed by the API. */
export interface Screenshot {
  id: Id;
  testId: Id;
  findingId: Id;
  storageKey: string;
  contentType: string;
  createdAt: Timestamp;
}

export type SubmitTestRequest = ScanRequest;
export interface TestResponse { test: TestRun }
export type SubmitTestResponse = TestResponse;
export type RetestTestResponse = TestResponse;

/** Numeric values describe parsed query parameters, not raw query strings. */
export interface RecentTestsQuery { limit?: number }
export interface RecentTestsResponse { tests: TestRun[] }
export interface ResultsQuery { limit?: number; cursor?: string }
export interface ResultsResponse {
  testId: Id;
  status: TestStatus;
  findings: FindingResponse[];
  nextCursor: string | null;
}

/** Temporary URL-based API bridge; remove after the frontend uses run IDs. */
export interface CompatibilityResultsQuery { url: string; limit?: number }
export interface CompatibilityResultsResponse { findings: FindingResponse[] }

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNSUPPORTED_SCAN_OPTIONS"
  | "TARGET_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "SCANNER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
