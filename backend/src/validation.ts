import { ApiError, invalid } from "./api-error.js";
import type { ScanRequest, WcagStandard } from "./models.js";

export function scanRequest(value: unknown): ScanRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object.");
  const data = value as Record<string, unknown>;
  const keys = ["url", "testType", "browsers", "wcagStandard"];
  if (Object.keys(data).some(key => !keys.includes(key))) invalid("Unknown request field.");
  if (typeof data.url !== "string" || !data.url || data.url !== data.url.trim()) invalid("Invalid URL.");
  let url: URL;
  try { url = new URL(data.url); } catch { return invalid("Invalid URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ApiError(422, "TARGET_NOT_ALLOWED", "URL protocol or credentials are not allowed.");
  }
  // Syntax checks only. No DNS lookup or network access; all scans remain disabled.
  if (data.testType !== "site" && data.testType !== "page") invalid("Invalid testType.");
  if (!Array.isArray(data.browsers) || data.browsers.length === 0
      || !data.browsers.every(v => typeof v === "string" && v.trim().length > 0)) {
    invalid("browsers must be a nonempty array of nonempty strings.");
  }
  if (typeof data.wcagStandard !== "string" || !/^wcag_2_[012]_(a|aa|aaa)$/.test(data.wcagStandard)) {
    invalid("Invalid wcagStandard.");
  }
  return { url: data.url, testType: data.testType, browsers: [...data.browsers],
    wcagStandard: data.wcagStandard as WcagStandard };
}

export function queryKeys(query: URLSearchParams, allowed: string[]): void {
  for (const key of query.keys()) {
    if (!allowed.includes(key) || query.getAll(key).length !== 1) invalid("Invalid query parameters.");
  }
}

export function limit(query: URLSearchParams, defaultValue: number): number {
  const raw = query.get("limit");
  if (raw === null) return defaultValue;
  // Numeric representation safeguard only; the public API maximum remains deferred.
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    invalid("limit must be a positive safely representable integer.");
  }
  return Number(raw);
}

export function runId(raw: string): string {
  let id: string;
  try { id = decodeURIComponent(raw); } catch { return invalid("Invalid test ID."); }
  // Opaque URL-safe application IDs; not restricted to ServiceNow or UUID syntax.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) invalid("Invalid test ID.");
  return id;
}
