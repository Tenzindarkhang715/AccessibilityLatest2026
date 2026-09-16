import React, { useState, useRef, useEffect, useCallback } from "react";
import "./app.css";

const TABLE_API = "/api/now/table/x_2191106_test_age_url_test";
const RESULTS_API = "/api/now/table/x_2191106_test_age_test_result";
const IS_GITHUB_PAGES = window.location.hostname === "tenzindarkhang715.github.io";

const URL_PATTERN = /^https?:\/\/[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+/;

const BROWSER_OPTIONS = [
  { group: "Google Chrome", versions: ["Chrome 137 (Latest)", "Chrome 136", "Chrome 135"] },
  { group: "Mozilla Firefox", versions: ["Firefox 139 (Latest)", "Firefox 138", "Firefox 137"] },
  { group: "Apple Safari", versions: ["Safari 18.5 (Latest)", "Safari 18.4", "Safari 18.3"] },
];

const WCAG_OPTIONS = [
  { group: "WCAG 2.0", items: [
    { value: "wcag_2_0_a", label: "WCAG 2.0 Level A" },
    { value: "wcag_2_0_aa", label: "WCAG 2.0 Level AA" },
    { value: "wcag_2_0_aaa", label: "WCAG 2.0 Level AAA" },
  ]},
  { group: "WCAG 2.1", items: [
    { value: "wcag_2_1_a", label: "WCAG 2.1 Level A" },
    { value: "wcag_2_1_aa", label: "WCAG 2.1 Level AA" },
    { value: "wcag_2_1_aaa", label: "WCAG 2.1 Level AAA" },
  ]},
  { group: "WCAG 2.2", items: [
    { value: "wcag_2_2_a", label: "WCAG 2.2 Level A" },
    { value: "wcag_2_2_aa", label: "WCAG 2.2 Level AA" },
    { value: "wcag_2_2_aaa", label: "WCAG 2.2 Level AAA" },
  ]},
];

const wcagLabel = (val: string) =>
  WCAG_OPTIONS.flatMap((g) => g.items).find((i) => i.value === val)?.label || val;

/** Safely retrieve the CSRF token from the global scope. */
function getCsrfToken(): string {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.g_ck === "string" && w.g_ck.length > 0) {
    return w.g_ck;
  }
  return "";
}

interface SubmitResult {
  type: "site" | "page";
  value: string;
  browsers: string[];
  wcag: string;
}

interface HistoryRecord {
  sys_id: string;
  url: string;
  wcag_standard: string;
  browser: string;
  status: string;
  sys_created_on: string;
}

interface TestResult {
  sys_id: string;
  test_url: string;
  test_type: string;
  issue: string;
  issue_type: string;
  fix_reference: string;
  severity: string;
  screenshot: string;
}

type AppView = "form" | "success" | "results";

export default function App() {
  const [siteUrl, setSiteUrl] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [siteBrowsers, setSiteBrowsers] = useState<string[]>([]);
  const [pageBrowsers, setPageBrowsers] = useState<string[]>([]);
  const [siteWcag, setSiteWcag] = useState("wcag_2_1_aa");
  const [pageWcag, setPageWcag] = useState("wcag_2_1_aa");
  const [loading, setLoading] = useState<"site" | "page" | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("form");

  /* -- URL validation state -- */
  const [siteUrlError, setSiteUrlError] = useState<string | null>(null);
  const [pageUrlError, setPageUrlError] = useState<string | null>(null);

  /* -- History -- */
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* -- Auto-transition timer ref -- */
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
  
    try {
      // GitHub Pages Demo Mode
      if (IS_GITHUB_PAGES) {
        const savedHistory = JSON.parse(
          localStorage.getItem("accessibilityTestHistory") || "[]"
        );
  
        setHistory(savedHistory);
        return;
      }
  
      // Existing ServiceNow behavior
      const token = getCsrfToken();
      const headers: Record<string, string> = { Accept: "application/json" };
      if (token) headers["X-UserToken"] = token;
  
      const resp = await fetch(
        `${TABLE_API}?sysparm_limit=10&sysparm_order_by=-sys_created_on&sysparm_display_value=true`,
        { method: "GET", headers },
      );
  
      if (resp.ok) {
        const data = await resp.json();
        setHistory(data.result || []);
      }
    } catch {
      /* silently ignore history fetch errors */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  /* Cleanup timer on unmount */
  useEffect(() => {
    return () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
  }, []);

  const validateUrl = (url: string): string | null => {
    if (!url) return null; // empty handled by canSubmit
    if (!URL_PATTERN.test(url)) {
      return "Please enter a valid URL starting with https:// or http://";
    }
    return null;
  };

  const handleSubmit = async (type: "site" | "page") => {
    const value = type === "site" ? siteUrl : pageUrl;
    const browsers = type === "site" ? siteBrowsers : pageBrowsers;
    const wcag = type === "site" ? siteWcag : pageWcag;
    if (!value || browsers.length === 0) return;

    /* Client-side URL validation */
    const urlErr = validateUrl(value);
    if (urlErr) {
      if (type === "site") setSiteUrlError(urlErr);
      else setPageUrlError(urlErr);
      return;
    }

    setLoading(type);
    setError(null);

    const standard = wcagLabel(wcag);
    try {
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
    
        const submitData: SubmitResult = { type, value, browsers, wcag };
        setSubmitted(submitData);
        setView("success");
    
        fetchHistory();
    
        transitionTimer.current = setTimeout(() => {
          setView("results");
        }, 2000);
    
        return;
      }
    
      // Existing ServiceNow behavior
      const token = getCsrfToken();
      if (!token) {
        setError("Security token (g_ck) is missing. Please reload the page and try again.");
        return;
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
      const submitData: SubmitResult = { type, value, browsers, wcag };
      setSubmitted(submitData);
      setView("success");
      fetchHistory(); // refresh history after successful submission

      /* Auto-transition to results after 2 seconds */
      transitionTimer.current = setTimeout(() => {
        setView("results");
      }, 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
    } finally {
      setLoading(null);
    }
  };

  const handleReset = () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setSiteUrl("");
    setPageUrl("");
    setSiteBrowsers([]);
    setPageBrowsers([]);
    setSiteWcag("wcag_2_1_aa");
    setPageWcag("wcag_2_1_aa");
    setSubmitted(null);
    setError(null);
    setSiteUrlError(null);
    setPageUrlError(null);
    setView("form");
  };

  const handleViewResults = () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setView("results");
  };

  const dismissError = () => setError(null);

  const handleDeleteTest = async (sysId: string) => {
    // GitHub Pages Demo Mode
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
  
        fetchHistory();
      } catch {
        setError("Failed to delete test");
      }
  
      return;
    }
  
    // Existing ServiceNow behavior
    const token = getCsrfToken();
    if (!token) {
      setError("Security token missing. Please reload.");
      return;
    }
  
    try {
      const resp = await fetch(`${TABLE_API}/${sysId}`, {
        method: "DELETE",
        headers: { "X-UserToken": token, Accept: "application/json" },
      });
  
      if (!resp.ok) throw new Error("Delete failed: " + resp.status);
  
      fetchHistory();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to delete test"
      );
    }
  };

  const handleRetestTest = async (record: HistoryRecord) => {
  // GitHub Pages Demo Mode
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

      fetchHistory();
    } catch {
      setError("Failed to re-test");
    }

    return;
  }

  // Existing ServiceNow behavior
  const token = getCsrfToken();
  if (!token) {
    setError("Security token missing. Please reload.");
    return;
  }

  try {
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

    fetchHistory();
  } catch (err: unknown) {
    setError(
      err instanceof Error ? err.message : "Failed to re-test"
    );
  }
};

  return (
    <div className="app-container">
      {/* WCAG 2.4.1 — Skip to main content */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header>
        <Header />
      </header>

      <main id="main-content">
        {error && <ErrorBanner message={error} onDismiss={dismissError} />}

        {view === "results" && submitted ? (
          <ResultsPanel submittedUrl={submitted.value} onBack={handleReset} />
        ) : view === "success" && submitted ? (
          <SuccessView submitted={submitted} onReset={handleReset} onViewResults={handleViewResults} />
        ) : (
          <div className="cards-grid" aria-busy={loading !== null}>
            <TestCard
              title="Site URL"
              description="Test accessibility across an entire website."
              urlLabel="Website URL"
              urlPlaceholder="https://example.com"
              urlValue={siteUrl}
              onUrlChange={(v) => { setSiteUrl(v); setSiteUrlError(null); }}
              urlError={siteUrlError}
              selectedBrowsers={siteBrowsers}
              onBrowsersChange={setSiteBrowsers}
              wcagValue={siteWcag}
              onWcagChange={setSiteWcag}
              loading={loading === "site"}
              onSubmit={() => handleSubmit("site")}
            />
            <TestCard
              title="Page"
              description="Test accessibility of a single page."
              urlLabel="Page URL"
              urlPlaceholder="https://example.com/about"
              urlValue={pageUrl}
              onUrlChange={(v) => { setPageUrl(v); setPageUrlError(null); }}
              urlError={pageUrlError}
              selectedBrowsers={pageBrowsers}
              onBrowsersChange={setPageBrowsers}
              wcagValue={pageWcag}
              onWcagChange={setPageWcag}
              loading={loading === "page"}
              onSubmit={() => handleSubmit("page")}
            />
          </div>
        )}

        <HistorySection records={history} loading={historyLoading} onDelete={handleDeleteTest} onRetest={handleRetestTest} />
      </main>
    </div>
  );
}

/* ── Header ── */
function Header() {
  return (
    <div className="app-header" role="banner">
      <div className="app-header-title">
        <h1 style={{ color: "white", fontSize: "22px" }}>Web Accessibility Tool</h1>
        <p style={{ color: "rgba(255,255,255,0.9)", fontSize: "14px", marginTop: "4px" }}>
          Test websites for accessibility compliance
        </p>
      </div>
      <span className="wcag-badge" aria-label="Built per WCAG 2.1 Level AA">
        Built per WCAG 2.1 Level AA
      </span>
    </div>
  );
}

/* ── Error Banner ── */
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-banner" role="alert" aria-live="assertive">
      <span className="error-banner__message">{message}</span>
      <button
        className="error-banner__close"
        onClick={onDismiss}
        aria-label="Dismiss error"
        type="button"
      >
        ×
      </button>
    </div>
  );
}

/* ── Test Card ── */
interface TestCardProps {
  title: string;
  description: string;
  urlLabel: string;
  urlPlaceholder: string;
  urlValue: string;
  onUrlChange: (v: string) => void;
  urlError: string | null;
  selectedBrowsers: string[];
  onBrowsersChange: (v: string[]) => void;
  wcagValue: string;
  onWcagChange: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
}

function TestCard(props: TestCardProps) {
  const {
    title, description, urlLabel, urlPlaceholder,
    urlValue, onUrlChange, urlError, selectedBrowsers, onBrowsersChange,
    wcagValue, onWcagChange, loading, onSubmit,
  } = props;
  const fieldId = title.toLowerCase().replace(/\s/g, "-");
  const canSubmit = !!urlValue && selectedBrowsers.length > 0 && !loading;
  const urlErrorId = `${fieldId}-url-error`;

  return (
    <div className="view-container card-body">
      <h2 className="card-title">{title}</h2>
      <p className="card-desc">{description}</p>

      {/* URL + WCAG inline row */}
      <div className="url-wcag-row">
        <div className="url-wcag-row__url">
          <label htmlFor={`${fieldId}-url`} className="field-label">{urlLabel}</label>
          <input
            id={`${fieldId}-url`}
            type="url"
            placeholder={urlPlaceholder}
            value={urlValue}
            onChange={(e) => onUrlChange(e.target.value)}
            className={`field-input${urlError ? " field-input--invalid" : ""}`}
            aria-required="true"
            aria-invalid={urlError ? "true" : undefined}
            aria-describedby={urlError ? urlErrorId : undefined}
          />
          {urlError && (
            <span id={urlErrorId} className="field-validation-error">{urlError}</span>
          )}
        </div>
        <div className="url-wcag-row__wcag">
          <label htmlFor={`${fieldId}-wcag`} className="field-label">WCAG Standard</label>
          <select
            id={`${fieldId}-wcag`}
            value={wcagValue}
            onChange={(e) => onWcagChange(e.target.value)}
            className="field-select field-select--sm"
          >
            {WCAG_OPTIONS.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.items.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="field-group">
        <span className="field-label">
          Browser <span className="field-required">*</span>
        </span>
        <BrowserDropdown
          id={fieldId}
          selected={selectedBrowsers}
          onChange={onBrowsersChange}
        />
        {selectedBrowsers.length === 0 && (
          <span className="field-hint">Select at least one browser to run the test</span>
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className={`submit-btn ${canSubmit ? "submit-btn--active" : ""}`}
        aria-disabled={!canSubmit}
      >
        {loading ? "Submitting..." : "Submit"}
      </button>
    </div>
  );
}

/* ── Browser Checkbox Dropdown ── */
interface BrowserDropdownProps {
  id: string;
  selected: string[];
  onChange: (v: string[]) => void;
}

function BrowserDropdown({ id, selected, onChange }: BrowserDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  /* WCAG 2.1.1 — Escape key closes dropdown */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      setOpen(false);
      /* Return focus to trigger button */
      const trigger = ref.current?.querySelector("button");
      trigger?.focus();
    }
  }, [open]);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClickOutside, handleKeyDown]);

  const toggle = (version: string) => {
    if (selected.includes(version)) {
      onChange(selected.filter((v) => v !== version));
    } else {
      onChange([...selected, version]);
    }
  };

  const summary =
    selected.length === 0
      ? "Select browsers..."
      : selected.length <= 2
        ? selected.join(", ")
        : `${selected.length} browsers selected`;

  return (
    <div className="browser-dropdown" ref={ref}>
      <button
        type="button"
        className={`browser-trigger ${open ? "browser-trigger--open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        id={`${id}-browser-trigger`}
      >
        <span className={selected.length === 0 ? "browser-trigger-placeholder" : ""}>
          {summary}
        </span>
        <span className={`browser-arrow ${open ? "browser-arrow--open" : ""}`}>▾</span>
      </button>

      {open && (
        <div
          className="browser-panel"
          role="group"
          aria-label="Select browsers"
          aria-labelledby={`${id}-browser-trigger`}
        >
          {BROWSER_OPTIONS.map((group) => (
            <div key={group.group} className="browser-group">
              <div className="browser-group-label">{group.group}</div>
              {group.versions.map((version) => {
                const checked = selected.includes(version);
                const inputId = `${id}-${version.replace(/[\s().]/g, "-")}`;
                return (
                  <label key={version} className="browser-option" htmlFor={inputId}>
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(version)}
                      className="browser-checkbox"
                    />
                    <span className={`browser-checkmark ${checked ? "browser-checkmark--checked" : ""}`}>
                      {checked && "✓"}
                    </span>
                    <span className="browser-version-label">{version}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Success View ── */
function SuccessView({
  submitted,
  onReset,
  onViewResults,
}: {
  submitted: SubmitResult;
  onReset: () => void;
  onViewResults: () => void;
}) {
  return (
    <div className="view-container" style={{ padding: "32px" }} aria-live="polite">
      <div className="success-content">
        <div className="success-icon" aria-hidden="true">✓</div>
        <h2 style={{ marginBottom: "8px", fontSize: "20px" }}>
          {submitted.type === "site" ? "Website Submitted!" : "Page Submitted!"}
        </h2>
        <p className="success-detail">
          <strong>{submitted.value}</strong> has been submitted for{" "}
          {submitted.type === "site"
            ? "full website accessibility testing"
            : "single page accessibility testing"}.
        </p>
        <div className="success-meta">
          <span className="success-tag">{wcagLabel(submitted.wcag)}</span>
          <span className="success-tag">{submitted.browsers.length} browser{submitted.browsers.length > 1 ? "s" : ""}</span>
        </div>
        <p className="success-browser">
          Browsers: <strong>{submitted.browsers.join(", ")}</strong>
        </p>
        <div className="success-actions">
          <button onClick={onViewResults} className="submit-btn submit-btn--active">
            View Results
          </button>
          <button onClick={onReset} className="submit-btn submit-btn--active submit-btn--secondary">
            Run Another Test
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Results Panel ── */
function ResultsPanel({ submittedUrl, onBack }: { submittedUrl: string; onBack: () => void }) {
  const [results, setResults] = useState<TestResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 5;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchResults = useCallback(async (): Promise<TestResult[]> => {
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
  }, [submittedUrl]);

  useEffect(() => {
    let cancelled = false;

    const attempt = async (currentRetry: number) => {
      setResultsLoading(true);
      try {
        const data = await fetchResults();
        if (cancelled) return;
        if (data.length > 0) {
          setResults(data);
          setResultsLoading(false);
        } else if (currentRetry < maxRetries) {
          setRetryCount(currentRetry + 1);
          retryTimer.current = setTimeout(() => {
            if (!cancelled) attempt(currentRetry + 1);
          }, 3000);
        } else {
          setResults([]);
          setResultsLoading(false);
        }
      } catch {
        if (cancelled) return;
        if (currentRetry < maxRetries) {
          setRetryCount(currentRetry + 1);
          retryTimer.current = setTimeout(() => {
            if (!cancelled) attempt(currentRetry + 1);
          }, 3000);
        } else {
          setResults([]);
          setResultsLoading(false);
        }
      }
    };

    attempt(0);

    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [fetchResults]);

  /* -- Summary counts -- */
  const totalIssues = results.length;
  const countByType = (type: string) => results.filter((r) => r.issue_type === type).length;
  const errorCount = countByType("error");
  const warningCount = countByType("warning");
  const noticeCount = countByType("notice");
  const contrastCount = countByType("contrast");
  const ariaCount = countByType("aria");
  const structureCount = countByType("structure");
  const navigationCount = countByType("navigation");

  /* -- Export CSV -- */
  const exportCsv = () => {
    const header = "Test URL,Type of Test,Issue,Type of Issue,Severity,How to Fix Reference,Screenshot";
    const escapeField = (field: string) => {
      if (field.includes(",") || field.includes('"') || field.includes("\n")) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    const rows = results.map((r) =>
      [
        escapeField(r.test_url || ""),
        escapeField(formatTestType(r.test_type)),
        escapeField(r.issue || ""),
        escapeField(r.issue_type || ""),
        escapeField(r.severity || ""),
        escapeField(r.fix_reference || ""),
        escapeField(r.screenshot || ""),
      ].join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "accessibility-results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /* -- Export PDF (print-friendly) -- */
  const exportPdf = () => {
    const tableRows = results
      .map(
        (r) =>
          `<tr>
            <td>${escapeHtml(r.test_url || "")}</td>
            <td>${escapeHtml(formatTestType(r.test_type))}</td>
            <td>${escapeHtml(r.issue || "")}</td>
            <td>${escapeHtml(r.issue_type || "")}</td>
            <td>${escapeHtml(r.severity || "")}</td>
            <td>${r.fix_reference ? '<a href="' + escapeHtml(r.fix_reference) + '">' + escapeHtml(r.fix_reference) + "</a>" : ""}</td>
            <td>${r.screenshot ? '<a href="' + escapeHtml(r.screenshot) + '">View Screenshot</a>' : ""}</td>
          </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Accessibility Test Results - ${escapeHtml(submittedUrl)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #222; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    p { font-size: 13px; color: #555; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px; border: 1px solid #ccc; background: #f5f5f5; font-weight: 600; }
    td { padding: 8px; border: 1px solid #ccc; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    a { color: #0070d2; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .summary { margin-bottom: 16px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Accessibility Test Results</h1>
  <p>${escapeHtml(submittedUrl)}</p>
  <div class="summary">Total Issues: ${totalIssues} | Errors: ${errorCount} | Warnings: ${warningCount} | Notices: ${noticeCount}</div>
  <table>
    <thead>
      <tr>
        <th>Test URL</th>
        <th>Type of Test</th>
        <th>Issue</th>
        <th>Type of Issue</th>
        <th>Severity</th>
        <th>How to Fix Reference</th>
        <th>Screenshot</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  };

  return (
    <div className="results-panel">
      {/* Header */}
      <div className="results-header">
        <div className="results-header__left">
          <button className="results-back-btn" onClick={onBack} type="button" aria-label="Back to form">
            ← Back
          </button>
          <div className="results-header__title">
            <h2 className="results-heading">Results</h2>
            <span className="results-url" title={submittedUrl}>{submittedUrl}</span>
          </div>
        </div>
        <div className="results-header__actions">
          <button className="export-btn" onClick={exportCsv} disabled={results.length === 0} type="button">
            Export CSV
          </button>
          <button className="export-btn" onClick={exportPdf} disabled={results.length === 0} type="button">
            Export PDF
          </button>
        </div>
      </div>

      {/* Loading / Analyzing */}
      {resultsLoading ? (
        <div className="results-loading" aria-live="polite" role="status">
          <span className="results-spinner" />
          <p className="results-loading-text">
            Analyzing… results will appear shortly
            {retryCount > 0 && <span className="results-retry-count"> (attempt {retryCount + 1}/{maxRetries + 1})</span>}
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="results-empty">
          <p>No results found for this URL. The test may still be processing.</p>
          <button className="submit-btn submit-btn--active" onClick={onBack} type="button">
            Go Back
          </button>
        </div>
      ) : (
        <>
          {/* Summary Bar */}
          <div className="results-summary">
            <div className="results-summary__total">
              <strong>{totalIssues}</strong> total issue{totalIssues !== 1 ? "s" : ""} found
            </div>
            <div className="results-summary__breakdown">
              {errorCount > 0 && <span className="summary-chip summary-chip--error">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
              {warningCount > 0 && <span className="summary-chip summary-chip--warning">{warningCount} warning{warningCount !== 1 ? "s" : ""}</span>}
              {noticeCount > 0 && <span className="summary-chip summary-chip--notice">{noticeCount} notice{noticeCount !== 1 ? "s" : ""}</span>}
              {contrastCount > 0 && <span className="summary-chip summary-chip--contrast">{contrastCount} contrast</span>}
              {ariaCount > 0 && <span className="summary-chip summary-chip--aria">{ariaCount} aria</span>}
              {structureCount > 0 && <span className="summary-chip summary-chip--structure">{structureCount} structure</span>}
              {navigationCount > 0 && <span className="summary-chip summary-chip--navigation">{navigationCount} navigation</span>}
            </div>
          </div>

          {/* Results Table */}
          <div className="results-table-wrapper">
            <table className="results-table">
              <thead>
                <tr>
                  <th scope="col">Test URL</th>
                  <th scope="col">Type of Test</th>
                  <th scope="col">Issue</th>
                  <th scope="col">Type of Issue</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Screenshot</th>
                  <th scope="col">How to Fix Reference</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.sys_id}>
                    <td className="results-url-cell" title={r.test_url}>{r.test_url}</td>
                    <td>{formatTestType(r.test_type)}</td>
                    <td className="results-issue-cell">{r.issue}</td>
                    <td>
                      <span className={`issue-badge issue-badge--${r.issue_type}`}>
                        {r.issue_type}
                      </span>
                    </td>
                    <td>
                      {r.severity ? (
                        <span className={`severity-pill severity-pill--${r.severity}`}>{r.severity}</span>
                      ) : (
                        <span className="no-fix">—</span>
                      )}
                    </td>
                    <td>
                      {r.screenshot ? (
                        <a
                          href={r.screenshot}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="screenshot-link"
                          aria-label={`View screenshot for: ${r.issue}`}
                        >
                          <span className="screenshot-icon" aria-hidden="true">📷</span> View
                        </a>
                      ) : (
                        <span className="no-fix">—</span>
                      )}
                    </td>
                    <td>
                      {r.fix_reference ? (
                        <a
                          href={r.fix_reference}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="fix-link"
                        >
                          View Fix ↗
                        </a>
                      ) : (
                        <span className="no-fix">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Helpers ── */
function formatTestType(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "site" || lower === "full site scan") return "Full Site Scan";
  if (lower === "page" || lower === "single page test") return "Single Page Test";
  return raw;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── History Section ── */
function HistorySection({
  records,
  loading,
  onDelete,
  onRetest,
}: {
  records: HistoryRecord[];
  loading: boolean;
  onDelete: (sysId: string) => void;
  onRetest: (record: HistoryRecord) => void;
}) {
  const statusLabel = (s: string) => s.replace(/_/g, " ");
  const statusClass = (s: string) => {
    const key = s.toLowerCase();
    if (key === "pending") return "status-pill--pending";
    if (key === "in_progress") return "status-pill--in_progress";
    if (key === "completed") return "status-pill--completed";
    if (key === "failed") return "status-pill--failed";
    return "status-pill--pending";
  };

  return (
    <section className="history-section" aria-label="Recent tests">
      <div className="history-card">
        <div className="history-header">
          <h2 className="history-title">Recent Tests</h2>
          {loading && <span className="history-spinner" aria-label="Loading history" role="status" />}
        </div>

        {!loading && records.length === 0 ? (
          <p className="history-empty">No tests submitted yet.</p>
        ) : records.length > 0 ? (
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">URL</th>
                <th scope="col">WCAG Standard</th>
                <th scope="col">Browser</th>
                <th scope="col">Status</th>
                <th scope="col">Submitted</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.sys_id}>
                  <td className="url-cell" title={r.url}>{r.url}</td>
                  <td>{r.wcag_standard}</td>
                  <td>{r.browser}</td>
                  <td>
                    <span className={`status-pill ${statusClass(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td>{r.sys_created_on}</td>
                  <td className="history-actions-cell">
                    <button
                      className="history-action-btn history-action-btn--retest"
                      onClick={() => onRetest(r)}
                      type="button"
                      aria-label={`Re-test ${r.url}`}
                      title="Re-Test"
                    >
                      <span aria-hidden="true">🔄</span> Re-Test
                    </button>
                    <button
                      className="history-action-btn history-action-btn--delete"
                      onClick={() => onDelete(r.sys_id)}
                      type="button"
                      aria-label={`Delete test ${r.url}`}
                      title="Delete"
                    >
                      <span aria-hidden="true">🗑</span> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
