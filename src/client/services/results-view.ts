
import type { TestResult } from "./test-service";

export type ResultSortKey = Exclude<keyof TestResult, "sys_id">;
export interface ResultView {
  search: string;
  browser: string;
  severity: string;
  issueType: string;
  sortKey: ResultSortKey | null;
  direction: "asc" | "desc";
}
export const resultValue = (row: TestResult, key: ResultSortKey): string =>
  row[key] || "Not recorded";

export function filterSortResults(rows: TestResult[], view: ResultView): TestResult[] {
  const query = view.search.trim().toLowerCase();
  const filtered = rows.filter(row => {
    const searchable = [
      row.test_url, row.test_type,
      row.test_type === "page" ? "Single Page Test" :
        row.test_type === "site" ? "Site Test" : "",
      row.browser, row.issue, row.issue_type, row.severity,
      row.fix_reference, row.screenshot,
    ].join(" ").toLowerCase();
    return (!query || searchable.includes(query)) &&
      (!view.browser || resultValue(row, "browser") === view.browser) &&
      (!view.severity || resultValue(row, "severity") === view.severity) &&
      (!view.issueType || resultValue(row, "issue_type") === view.issueType);
  });
  if (!view.sortKey) return filtered;
  const key = view.sortKey;
  const severityOrder: Record<string, number> = {
    critical: 0, serious: 1, moderate: 2, minor: 3,
  };
  return filtered.sort((a, b) => {
    const left = a[key] || "";
    const right = b[key] || "";
    // Missing values remain last in either direction.
    if (!left || !right) return left ? -1 : right ? 1 : 0;
    const comparison = key === "severity"
      ? (severityOrder[left.toLowerCase()] ?? 4) -
          (severityOrder[right.toLowerCase()] ?? 4) ||
          left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
      : left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    return view.direction === "asc" ? comparison : -comparison;
  });
}
