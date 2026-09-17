// Data access for the existing ServiceNow and local demo execution paths.
// Keep platform details here; React owns presentation and request lifecycle state.
const TABLE_API = "/api/now/table/x_2191106_test_age_url_test";
const RESULTS_API = "/api/now/table/x_2191106_test_age_test_result";
const IS_GITHUB_PAGES =
  window.location.hostname === "tenzindarkhang715.github.io" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export interface SubmitResult {
  type: "site" | "page";
  value: string;
  browsers: string[];
  wcag: string;
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

/** Safely retrieve the CSRF token from the global scope. */
function getCsrfToken(): string {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.g_ck === "string" && w.g_ck.length > 0) {
    return w.g_ck;
  }
  return "";
}

export async function getRecentTests(): Promise<HistoryRecord[] | undefined> {
  if (IS_GITHUB_PAGES) {
    return JSON.parse(localStorage.getItem("accessibilityTestHistory") || "[]");
  }

  const token = getCsrfToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["X-UserToken"] = token;

  const resp = await fetch(
    `${TABLE_API}?sysparm_limit=10&sysparm_order_by=-sys_created_on&sysparm_display_value=true`,
    { method: "GET", headers },
  );
  if (resp.ok) {
    const data = await resp.json();
    return data.result || [];
  }
  // Preserve the currently displayed history when the request fails.
  return undefined;
}

export async function submitTest(
  { type, value, browsers, wcag }: SubmitResult,
  standard: string,
): Promise<void> {
  // GitHub Pages Demo Mode
  if (IS_GITHUB_PAGES) {
    const demoTest = {
      sys_id: Date.now().toString(),
      url: value,
      name: (type === "site" ? "Site Test - " : "Page Test - ") + value,
      browser: browsers.join(", "),
      wcag_standard: wcag,
      status: "completed",
      notes:
        `Test against ${standard}. ` +
        (type === "site"
          ? "Full website accessibility test."
          : "Single page accessibility test.") +
        ` Browsers: ${browsers.join(", ")}.`,
      sys_created_on: new Date().toISOString(),
    };

    const existingHistory = JSON.parse(
      localStorage.getItem("accessibilityTestHistory") || "[]"
    );

    localStorage.setItem(
      "accessibilityTestHistory",
      JSON.stringify([demoTest, ...existingHistory])
    );

    return;
  }

  // Existing ServiceNow behavior
  const token = getCsrfToken();
  if (!token) {
    throw new Error("Security token (g_ck) is missing. Please reload the page and try again.");
  }

  const resp = await fetch(TABLE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UserToken": token,
      Accept: "application/json",
    },
    body: JSON.stringify({
      url: value,
      name: (type === "site" ? "Site Test - " : "Page Test - ") + value,
      browser: browsers.join(", "),
      wcag_standard: wcag,
      status: "pending",
      notes:
        `Test against ${standard}. ` +
        (type === "site"
          ? "Full website accessibility test."
          : "Single page accessibility test.") +
        ` Browsers: ${browsers.join(", ")}.`,
    }),
  });

  if (!resp.ok) throw new Error("Failed to submit: " + resp.status);
}

export async function getResults(submittedUrl: string): Promise<TestResult[]> {
  // GitHub Pages Demo Mode: return representative local demo results.
  // ServiceNow behavior below remains unchanged.
  if (IS_GITHUB_PAGES) {
    return [
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
    ];
  }

  const token = getCsrfToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["X-UserToken"] = token;

  const query = encodeURIComponent(`test_url=${submittedUrl}`);
  const resp = await fetch(
    `${RESULTS_API}?sysparm_query=${query}&sysparm_display_value=true&sysparm_limit=50`,
    { method: "GET", headers },
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.result || []) as TestResult[];
}

export async function deleteTest(sysId: string): Promise<void> {
  if (IS_GITHUB_PAGES) {
    try {
      const existingHistory = JSON.parse(
        localStorage.getItem("accessibilityTestHistory") || "[]"
      );
      const updatedHistory = existingHistory.filter(
        (item: HistoryRecord) => item.sys_id !== sysId
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

  const token = getCsrfToken();
  if (!token) throw new Error("Security token missing. Please reload.");

  const resp = await fetch(`${TABLE_API}/${sysId}`, {
    method: "DELETE",
    headers: { "X-UserToken": token, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error("Delete failed: " + resp.status);
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

  const token = getCsrfToken();
  if (!token) throw new Error("Security token missing. Please reload.");

  const resp = await fetch(TABLE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UserToken": token,
      Accept: "application/json",
    },
    body: JSON.stringify({
      url: record.url,
      name: "Re-Test - " + record.url,
      browser: record.browser,
      wcag_standard: record.wcag_standard,
      status: "pending",
      notes: `Re-test of ${record.url}. Browsers: ${record.browser}.`,
    }),
  });
  if (!resp.ok) throw new Error("Re-test failed: " + resp.status);
}
