// Data access for the standalone API and GitHub Pages demo execution paths.
// Keep platform details here; React owns presentation and request lifecycle state.
const IS_GITHUB_PAGES =
  window.location.hostname === "tenzindarkhang715.github.io";

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
  if (IS_GITHUB_PAGES) {
    try {
      const history = JSON.parse(
        localStorage.getItem("accessibilityTestHistory") || "[]"
      );
      return Array.isArray(history) ? history.slice(0, 10) : [];
    } catch {
      return [];
    }
  }

  const resp = await fetch("/api/tests?limit=10", {
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
  if (IS_GITHUB_PAGES) {
    const runId = `demo-${Date.now()}`;
    const demoTest: HistoryRecord = {
      sys_id: runId,
      url: value,
      name: value,
      browser: browsers.join(", "),
      wcag_standard: wcag,
      status: "completed",
      notes: `Demo test. Browsers: ${browsers.join(", ")}.`,
      sys_created_on: new Date().toISOString(),
    };

    try {
      const existingHistory = JSON.parse(
        localStorage.getItem("accessibilityTestHistory") || "[]"
      );
      const history = Array.isArray(existingHistory) ? existingHistory : [];
      localStorage.setItem(
        "accessibilityTestHistory",
        JSON.stringify([demoTest, ...history].slice(0, 10))
      );
    } catch {
      throw new Error("Failed to save demo test");
    }

    return runId;
  }

  const resp = await fetch("/api/tests", {
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
  submittedUrl: string,
): Promise<ResultsResponse> {
  if (IS_GITHUB_PAGES) {
    return {
      status: "completed",
      results: [
        {
          sys_id: `demo-result-1-${submittedUrl}`,
          test_url: submittedUrl,
          test_type: "site",
          issue: "Images should have alternative text",
          issue_type: "error",
          fix_reference: "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html",
          severity: "high",
          screenshot: "",
        },
        {
          sys_id: `demo-result-2-${submittedUrl}`,
          test_url: submittedUrl,
          test_type: "site",
          issue: "Form controls should have accessible labels",
          issue_type: "warning",
          fix_reference: "https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html",
          severity: "medium",
          screenshot: "",
        },
        {
          sys_id: `demo-result-3-${submittedUrl}`,
          test_url: submittedUrl,
          test_type: "site",
          issue: "Page should contain a descriptive title",
          issue_type: "notice",
          fix_reference: "https://www.w3.org/WAI/WCAG21/Understanding/page-titled.html",
          severity: "low",
          screenshot: "",
        },
      ],
    };
  }

  if (!runId) {
    throw new Error("Test identifier is missing.");
  }

  const resp = await fetch(
    `/api/tests/${encodeURIComponent(runId)}/results`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );

  if (!resp.ok) {
    let message = `Failed to load results: ${resp.status}`;
    try {
      const data = await resp.json();
      if (data?.error?.message) message = data.error.message;
    } catch {
      // Keep the safe generic message.
    }
    throw new Error(message);
  }

  const data = await resp.json();

  return {
    status: typeof data.status === "string" ? data.status : "failed",
    results: (data.findings || []).map((finding: {
      id: string;
      pageUrl: string;
      testType: string;
      issue: string;
      issueType: string;
      severity: string | null;
      fixReference: string | null;
      screenshotUrl: string | null;
    }) => ({
      sys_id: finding.id,
      test_url: finding.pageUrl,
      test_type: finding.testType,
      issue: finding.issue,
      issue_type: finding.issueType,
      fix_reference: finding.fixReference ?? "",
      severity: finding.severity ?? "",
      screenshot: finding.screenshotUrl ?? "",
    })),
  };
}

export async function deleteTest(id: string): Promise<void> {
  if (IS_GITHUB_PAGES) {
    try {
      const existingHistory = JSON.parse(
        localStorage.getItem("accessibilityTestHistory") || "[]"
      );
      const updatedHistory = existingHistory.filter(
        (item: HistoryRecord) => item.sys_id !== id
      );
      localStorage.setItem(
        "accessibilityTestHistory",
        JSON.stringify(updatedHistory)
      );
    } catch {
      throw new Error("Failed to delete test");
    }
    return;
  }

  const resp = await fetch(`/api/tests/${encodeURIComponent(id)}`, {
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
  if (IS_GITHUB_PAGES) {
    try {
      const demoTest = {
        sys_id: Date.now().toString(),
        url: record.url,
        name: "Re-Test - " + record.url,
        browser: record.browser,
        wcag_standard: record.wcag_standard,
        status: "completed",
        notes: `Re-test of ${record.url}. Browsers: ${record.browser}.`,
        sys_created_on: new Date().toISOString(),
      };
      const existingHistory = JSON.parse(
        localStorage.getItem("accessibilityTestHistory") || "[]"
      );
      localStorage.setItem(
        "accessibilityTestHistory",
        JSON.stringify([demoTest, ...existingHistory])
      );
    } catch {
      throw new Error("Failed to re-test");
    }
    return;
  }

  const resp = await fetch(
    `/api/tests/${encodeURIComponent(record.sys_id)}/retests`,
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
