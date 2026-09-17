import type { Finding, ScanRequest } from "./models.js";

/** Engine evidence only; application IDs and persistence remain outside scanner. */
export interface FindingDraft extends Omit<Finding, "id" | "testId"> {
  ruleId: string;
  target: (string | string[])[];
  html: string;
  failureSummary: string | null;
  tags: string[];
}

export interface ScanOutcome {
  findings: FindingDraft[];
  execution: {
    browser: "chromium";
    browserVersion: string;
    engine: string;
    engineVersion: string;
    tags: string[];
    evaluatedRuleIds: string[];
    incompleteRuleIds: string[];
    mode: "fixture-only";
  };
}

export interface AccessibilityScanner {
  scan(request: ScanRequest, control: { signal: AbortSignal }): Promise<ScanOutcome>;
}

export class ScannerError extends Error {
  constructor(public readonly code: "UNSUPPORTED_SCAN_OPTIONS" | "TARGET_NOT_ALLOWED"
    | "CANCELLED" | "SCAN_TIMEOUT" | "ENGINE_FAILURE" | "FIXTURE_LOAD_FAILED") {
    super(`Scanner failed: ${code}.`);
  }
}

/** Trusted, injected fixture source only. No browser handles or live transport. */
export interface FixtureSource {
  load(url: string, signal: AbortSignal): Promise<string>;
}
