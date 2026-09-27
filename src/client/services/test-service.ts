// Data access for the standalone API and GitHub Pages demo execution paths.
// Keep platform details here; React owns presentation and request lifecycle state.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");
const IS_GITHUB_PAGES = window.location.hostname === "tenzindarkhang715.github.io";

function apiUrl(path: string): string {
  if (IS_GITHUB_PAGES && !API_BASE_URL) {
    throw new Error("Real scanning is not configured for this deployment. Set VITE_API_BASE_URL to the HTTPS backend URL.");
  }
  return `${API_BASE_URL}${path}`;
}

export interface SubmitResult {
  type: "site" | "page";
  value: string;
  browsers: string[];
  wcag: string;
  runId?: string;
}

export interface HistoryRecord {
  sys_id: string;
  url: string;
  wcag_standard: string;
  browser: string;
  status: string;
  sys_created_on: string;
}

export interface TestResult {
  sys_id: string;
  test_url: string;
  test_type: string;
  issue: string;
  issue_type: string;
  fix_reference: string;
  severity: string;
  screenshot: string;
}

export async function getRecentTests(): Promise<HistoryRecord[] | undefined> {
  const resp = await fetch(apiUrl("/api/tests?limit=10"), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    // Preserve the currently displayed history when the request fails.
    return undefined;
  }

  const data = await resp.json();

  return (data.tests || []).map((test: {
    id: string;
    url: string;
    wcagStandard: string;
    browsers: string[];
    status: string;
    submittedAt: string;
  }) => ({
    sys_id: test.id,
    url: test.url,
    wcag_standard: test.wcagStandard,
    browser: test.browsers.join(", "),
    status: test.status,
    sys_created_on: test.submittedAt,
  }));
}

export async function submitTest(
  { type, value, browsers, wcag }: SubmitResult,
  _standard: string,
): Promise<string> {
  const resp = await fetch(apiUrl("/api/tests"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      url: value,
      testType: type,
      browsers,
      wcagStandard: wcag,
    }),
  });

  if (!resp.ok) {
    let message = `Failed to submit: ${resp.status}`;
    try {
      const data = await resp.json();
      if (data?.error?.message) {
        message = data.error.message;
      }
    } catch {
      // Keep the safe generic message.
    }
    throw new Error(message);
  }

  const data = await resp.json();
  if (!data?.test?.id || typeof data.test.id !== "string") {
    throw new Error("The server returned an invalid test identifier.");
  }

  return data.test.id;
}

export interface ResultsResponse {
  status: string;
  results: TestResult[];
}

export async function getResults(
  runId: string | undefined,
  _submittedUrl: string,
): Promise<ResultsResponse> {
  if (!runId) {
    throw new Error("Test identifier is missing.");
  }

  const results: TestResult[] = [];
  let cursor: string | null = null;
  let status = "failed";

  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const resp = await fetch(
      apiUrl(`/api/tests/${encodeURIComponent(runId)}/results?${query.toString()}`),
      { method: "GET", headers: { Accept: "application/json" } },
    );
    if (!resp.ok) {
      let message = `Failed to load results: ${resp.status}`;
      try {
        const data = await resp.json();
        if (data?.error?.message) message = data.error.message;
      } catch { /* Keep the safe generic message. */ }
      throw new Error(message);
    }
    const data = await resp.json();
    status = typeof data.status === "string" ? data.status : "failed";
    results.push(...(data.findings || []).map((finding: {
      id: string; pageUrl: string; testType: string; issue: string; issueType: string;
      severity: string | null; fixReference: string | null; screenshotUrl: string | null;
    }) => ({
      sys_id: finding.id, test_url: finding.pageUrl, test_type: finding.testType,
      issue: finding.issue, issue_type: finding.issueType,
      fix_reference: finding.fixReference ?? "", severity: finding.severity ?? "",
      screenshot: finding.screenshotUrl ?? "",
    })));
    cursor = typeof data.nextCursor === "string" ? data.nextCursor : null;
  } while (status === "completed" && cursor);

  return { status, results };
}

export async function deleteTest(id: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/tests/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });

  if (!resp.ok) {
    let message = `Delete failed: ${resp.status}`;
    try {
      const data = await resp.json();
      if (data?.error?.message) message = data.error.message;
    } catch {
      // Keep the safe generic message.
    }
    throw new Error(message);
  }
}

export async function retestTest(record: HistoryRecord): Promise<void> {
  const resp = await fetch(
    apiUrl(`/api/tests/${encodeURIComponent(record.sys_id)}/retests`),
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );

  if (!resp.ok) {
    let message = `Re-test failed: ${resp.status}`;
    try {
      const data = await resp.json();
      if (data?.error?.message) message = data.error.message;
    } catch {
      // Keep the safe generic message.
    }
    throw new Error(message);
  }
}
