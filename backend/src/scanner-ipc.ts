import { randomUUID } from "node:crypto";
import { Socket } from "node:net";

import type { ScanRequest } from "./models.js";
import {
  ScannerError,
  type AccessibilityScanner,
  type FindingDraft,
  type ScanOutcome,
} from "./scanner.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 45_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type ScannerErrorCode =
  | "UNSUPPORTED_SCAN_OPTIONS"
  | "TARGET_NOT_ALLOWED"
  | "CANCELLED"
  | "SCAN_TIMEOUT"
  | "ENGINE_FAILURE"
  | "FIXTURE_LOAD_FAILED";

interface ScanIpcRequest {
  id: string;
  op: "scan";
  request: ScanRequest;
}

interface ScanIpcSuccess {
  id: string;
  ok: true;
  outcome: ScanOutcome;
}

interface ScanIpcFailure {
  id: string;
  ok: false;
  error: ScannerErrorCode;
}

type ScanIpcResponse = ScanIpcSuccess | ScanIpcFailure;

export interface ScannerIpcOptions {
  socketPath: string;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
}

const SCANNER_ERROR_CODES = new Set<ScannerErrorCode>([
  "UNSUPPORTED_SCAN_OPTIONS",
  "TARGET_NOT_ALLOWED",
  "CANCELLED",
  "SCAN_TIMEOUT",
  "ENGINE_FAILURE",
  "FIXTURE_LOAD_FAILED",
]);

function scannerErrorCode(value: unknown): ScannerErrorCode | null {
  return typeof value === "string" &&
    SCANNER_ERROR_CODES.has(value as ScannerErrorCode)
    ? (value as ScannerErrorCode)
    : null;
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);

  return (
    actual.length === keys.length &&
    keys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function validateScanRequest(value: unknown): ScanRequest | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "url",
      "testType",
      "browsers",
      "wcagStandard",
    ])
  ) {
    return null;
  }

  if (
    typeof value.url !== "string" ||
    value.url.length === 0 ||
    value.url.length > 8_192
  ) {
    return null;
  }

  if (value.testType !== "page" && value.testType !== "site") {
    return null;
  }

  if (
    !Array.isArray(value.browsers) ||
    value.browsers.length === 0 ||
    value.browsers.length > 16 ||
    !value.browsers.every(
      (browser) =>
        typeof browser === "string" &&
        browser.length > 0 &&
        browser.length <= 128,
    )
  ) {
    return null;
  }

  if (
    typeof value.wcagStandard !== "string" ||
    value.wcagStandard.length > 64 ||
    !/^wcag_2_[012]_[a]{1,3}$/i.test(value.wcagStandard)
  ) {
    return null;
  }

  return {
    url: value.url,
    testType: value.testType,
    browsers: [...value.browsers],
    wcagStandard:
      value.wcagStandard as ScanRequest["wcagStandard"],
  };
}

function validateExecution(
  value: unknown,
): ScanOutcome["execution"] | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "browser",
      "browserVersion",
      "engine",
      "engineVersion",
      "tags",
      "evaluatedRuleIds",
      "incompleteRuleIds",
      "mode",
    ])
  ) {
    return null;
  }

  if (
    value.browser !== "chromium" ||
    typeof value.browserVersion !== "string" ||
    typeof value.engine !== "string" ||
    typeof value.engineVersion !== "string" ||
    !stringArray(value.tags) ||
    !stringArray(value.evaluatedRuleIds) ||
    !stringArray(value.incompleteRuleIds) ||
    (value.mode !== "fixture-only" && value.mode !== "live")
  ) {
    return null;
  }

  return {
    browser: value.browser,
    browserVersion: value.browserVersion,
    engine: value.engine,
    engineVersion: value.engineVersion,
    tags: [...value.tags],
    evaluatedRuleIds: [...value.evaluatedRuleIds],
    incompleteRuleIds: [...value.incompleteRuleIds],
    mode: value.mode,
  };
}

function validateTarget(
  value: unknown,
): (string | string[])[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const target: (string | string[])[] = [];

  for (const item of value) {
    if (typeof item === "string") {
      target.push(item);
      continue;
    }

    if (
      Array.isArray(item) &&
      item.every((part) => typeof part === "string")
    ) {
      target.push([...item]);
      continue;
    }

    return null;
  }

  return target;
}

function validateFinding(value: unknown): FindingDraft | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "pageUrl",
      "issue",
      "issueType",
      "severity",
      "fixReference",
      "screenshotId",
      "ruleId",
      "target",
      "html",
      "failureSummary",
      "tags",
    ])
  ) {
    return null;
  }

  const target = validateTarget(value.target);

  if (
    typeof value.pageUrl !== "string" ||
    typeof value.issue !== "string" ||
    typeof value.issueType !== "string" ||
    typeof value.severity !== "string" ||
    typeof value.fixReference !== "string" ||
    (value.screenshotId !== null &&
      typeof value.screenshotId !== "string") ||
    typeof value.ruleId !== "string" ||
    target === null ||
    typeof value.html !== "string" ||
    (value.failureSummary !== null &&
      typeof value.failureSummary !== "string") ||
    !stringArray(value.tags)
  ) {
    return null;
  }

  return {
    pageUrl: value.pageUrl,
    issue: value.issue,
    issueType: value.issueType,
    severity: value.severity,
    fixReference: value.fixReference,
    screenshotId: value.screenshotId,
    ruleId: value.ruleId,
    target,
    html: value.html,
    failureSummary: value.failureSummary,
    tags: [...value.tags],
  } as FindingDraft;
}

function validateScanOutcome(value: unknown): ScanOutcome | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["findings", "execution"]) ||
    !Array.isArray(value.findings)
  ) {
    return null;
  }

  const execution = validateExecution(value.execution);

  if (!execution) {
    return null;
  }

  const findings: FindingDraft[] = [];

  for (const item of value.findings) {
    const finding = validateFinding(item);

    if (!finding) {
      return null;
    }

    findings.push(finding);
  }

  return {
    findings,
    execution,
  };
}

function decodeResponse(
  value: unknown,
  expectedId: string,
): ScanIpcResponse | null {
  if (!isPlainObject(value)) {
    return null;
  }

  if (value.ok === true) {
    if (
      !hasExactKeys(value, ["id", "ok", "outcome"]) ||
      value.id !== expectedId
    ) {
      return null;
    }

    const outcome = validateScanOutcome(value.outcome);

    if (!outcome) {
      return null;
    }

    return {
      id: expectedId,
      ok: true,
      outcome,
    };
  }

  if (value.ok === false) {
    if (
      !hasExactKeys(value, ["id", "ok", "error"]) ||
      value.id !== expectedId
    ) {
      return null;
    }

    const error = scannerErrorCode(value.error);

    if (!error) {
      return null;
    }

    return {
      id: expectedId,
      ok: false,
      error,
    };
  }

  return null;
}

function positiveTimeout(
  value: number | undefined,
  fallback: number,
): number {
  if (
    value === undefined ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return fallback;
  }

  return value;
}

function validateSocketPath(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.includes("\0")
  ) {
    throw new Error("Invalid scanner IPC socket path.");
  }

  return value;
}

function scannerFailure(code: ScannerErrorCode): ScannerError {
  return new ScannerError(code);
}

export function createScannerIpcClient(
  options: ScannerIpcOptions,
): AccessibilityScanner {
  const path = validateSocketPath(options.socketPath);

  const connectTimeoutMs = positiveTimeout(
    options.connectTimeoutMs,
    DEFAULT_CONNECT_TIMEOUT_MS,
  );

  const responseTimeoutMs = positiveTimeout(
    options.responseTimeoutMs,
    DEFAULT_RESPONSE_TIMEOUT_MS,
  );

  return {
    async scan(
      request: ScanRequest,
      control: { signal: AbortSignal },
    ): Promise<ScanOutcome> {
      const validatedRequest = validateScanRequest(request);

      if (!validatedRequest) {
        throw scannerFailure("ENGINE_FAILURE");
      }

      if (control.signal.aborted) {
        throw scannerFailure("CANCELLED");
      }

      const id = randomUUID();

      const message: ScanIpcRequest = {
        id,
        op: "scan",
        request: validatedRequest,
      };

      const payload = `${JSON.stringify(message)}\n`;

      if (Buffer.byteLength(payload, "utf8") > MAX_REQUEST_BYTES) {
        throw scannerFailure("ENGINE_FAILURE");
      }

      return await new Promise<ScanOutcome>((resolve, reject) => {
        const socket = new Socket();

        let settled = false;
        let responseBytes = 0;
        let responseBuffer = Buffer.alloc(0);

        let responseTimer: ReturnType<typeof setTimeout> | null =
          null;

        const cleanup = (): void => {
          clearTimeout(connectTimer);

          if (responseTimer !== null) {
            clearTimeout(responseTimer);
            responseTimer = null;
          }

          control.signal.removeEventListener("abort", abort);
          socket.removeAllListeners();
          socket.destroy();
        };

        const finish = (
          error: Error | null,
          outcome?: ScanOutcome,
        ): void => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();

          if (error) {
            reject(error);
            return;
          }

          if (outcome) {
            resolve(outcome);
            return;
          }

          reject(scannerFailure("ENGINE_FAILURE"));
        };

        const abort = (): void => {
          finish(scannerFailure("CANCELLED"));
        };

        const connectTimer = setTimeout(() => {
          finish(scannerFailure("ENGINE_FAILURE"));
        }, connectTimeoutMs);

        control.signal.addEventListener("abort", abort, {
          once: true,
        });

        if (control.signal.aborted) {
          abort();
          return;
        }

        socket.once("error", () => {
          finish(scannerFailure("ENGINE_FAILURE"));
        });

        socket.on("data", (chunk: Buffer) => {
          if (settled) {
            return;
          }

          responseBytes += chunk.length;

          if (responseBytes > MAX_RESPONSE_BYTES) {
            finish(scannerFailure("ENGINE_FAILURE"));
            return;
          }

          responseBuffer = Buffer.concat([
            responseBuffer,
            chunk,
          ]);

          const newline = responseBuffer.indexOf(0x0a);

          if (newline === -1) {
            return;
          }

          const frame = responseBuffer.subarray(0, newline);
          const trailing = responseBuffer.subarray(newline + 1);

          if (trailing.length !== 0 || frame.length === 0) {
            finish(scannerFailure("ENGINE_FAILURE"));
            return;
          }

          let parsed: unknown;

          try {
            parsed = JSON.parse(frame.toString("utf8"));
          } catch {
            finish(scannerFailure("ENGINE_FAILURE"));
            return;
          }

          const response = decodeResponse(parsed, id);

          if (!response) {
            finish(scannerFailure("ENGINE_FAILURE"));
            return;
          }

          if (response.ok === false) {
            finish(scannerFailure(response.error));
            return;
          }

          finish(null, response.outcome);
        });

        socket.once("end", () => {
          if (!settled) {
            finish(scannerFailure("ENGINE_FAILURE"));
          }
        });

        socket.once("close", () => {
          if (!settled) {
            finish(scannerFailure("ENGINE_FAILURE"));
          }
        });

        socket.once("connect", () => {
          if (settled) {
            return;
          }

          clearTimeout(connectTimer);

          responseTimer = setTimeout(() => {
            finish(scannerFailure("SCAN_TIMEOUT"));
          }, responseTimeoutMs);

          socket.write(payload, (error) => {
            if (error && !settled) {
              finish(scannerFailure("ENGINE_FAILURE"));
            }
          });
        });

        try {
          socket.connect(path);
        } catch {
          finish(scannerFailure("ENGINE_FAILURE"));
        }
      });
    },
  };
}