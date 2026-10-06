import React, { useState, useRef, useEffect, useCallback } from "react";
import "./app.css";
import { submitTest, getRecentTests, getResults, deleteTest, retestTest, getTestDetails } from "./services/test-service";
import type { SubmitResult, HistoryRecord, TestResult } from "./services/test-service";

const URL_PATTERN = /^https?:\/\/[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+/;

const BROWSER_OPTIONS = [
  { group: "Google Chrome", versions: ["Chrome 137 (Latest)", "Chrome 136", "Chrome 135"] },
  { group: "Mozilla Firefox", versions: ["Firefox 139 (Latest)", "Firefox 138", "Firefox 137"] },
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

type AppView = "form" | "success" | "results";

export default function App() {
  const [siteUrl, setSiteUrl] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [siteBrowsers, setSiteBrowsers] = useState<string[]>([]);
  const [pageBrowsers, setPageBrowsers] = useState<string[]>([]);
  const [siteWcag, setSiteWcag] = useState("wcag_2_1_aa");
  const [pageWcag, setPageWcag] = useState("wcag_2_1_aa");
  const [loading, setLoading] = useState<"site" | "page" | null>(null);
  const submissionLock = useRef(false);
  const [historyAction, setHistoryAction] = useState<string | null>(null);
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
      const records = await getRecentTests();
      if (records !== undefined) setHistory(records);
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
    if (submissionLock.current) return;
    const otherUrl = type === "site" ? pageUrl : siteUrl;
    if (otherUrl.trim()) {
      setError("You can use one scan at a time.");
      return;
    }
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

    submissionLock.current = true;
    setLoading(type);
    setError(null);

    const standard = wcagLabel(wcag);
    try {
      const runId = await submitTest(
        { type, value, browsers, wcag },
        standard,
      );
      const submitData: SubmitResult = {
        type,
        value,
        browsers,
        wcag,
        runId,
      };
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
      submissionLock.current = false;
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
    try {
      await deleteTest(sysId);
      await fetchHistory();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to delete test"
      );
      throw err;
    }
  };

  const openHistoryTest = async (record: HistoryRecord, retest: boolean) => {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setHistoryAction(`${retest ? "retest" : "view"}:${record.sys_id}`);
    setError(null);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    try {
      const test = retest
        ? await retestTest(record)
        : await getTestDetails(record.sys_id);
      setSubmitted(test);
      setView("results");
      void fetchHistory();
      document.getElementById("main-content")?.focus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to open test.");
    } finally {
      submissionLock.current = false;
      setHistoryAction(null);
    }
  };

  const handleRetestTest = (record: HistoryRecord) => {
    void openHistoryTest(record, true);
  };

  const handleViewTest = (record: HistoryRecord) => {
    void openHistoryTest(record, false);
  };

  return (
    <div className="app-container">
      {/* WCAG 2.4.1 — Skip to main content */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header>
        <Header />
      </header>

      <main id="main-content" tabIndex={-1}>
        {error && <ErrorBanner message={error} onDismiss={dismissError} />}

        {view === "results" && submitted ? (
          <ResultsPanel
            key={submitted.runId}
            submittedUrl={submitted.value}
            wcag={submitted.wcag}
            selectedBrowsers={submitted.browsers}
            runId={submitted.runId}
            onSettled={fetchHistory}
            onBack={handleReset}
          />
        ) : view === "success" && submitted ? (
          <SuccessView submitted={submitted} onReset={handleReset} onViewResults={handleViewResults} />
        ) : (
          <div className="cards-grid" aria-busy={loading !== null}>
            {(siteUrl.trim() || pageUrl.trim()) && (
              <p className="scan-mode-notice" role="status">
                You can use one scan at a time. Clear the entered URL to switch between Site and Page.
              </p>
            )}
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
              disabled={Boolean(pageUrl.trim()) || loading !== null}
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
              disabled={Boolean(siteUrl.trim()) || loading !== null}
              loading={loading === "page"}
              onSubmit={() => handleSubmit("page")}
            />
          </div>
        )}

        <HistorySection
          records={history}
          loading={historyLoading}
          onDelete={handleDeleteTest}
          onRetest={handleRetestTest}
          onView={handleViewTest}
          actionPending={historyAction}
          actionsDisabled={historyAction !== null || loading !== null}
        />
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
  disabled: boolean;
  onSubmit: () => void;
}

function TestCard(props: TestCardProps) {
  const {
    title, description, urlLabel, urlPlaceholder,
    urlValue, onUrlChange, urlError, selectedBrowsers, onBrowsersChange,
    wcagValue, onWcagChange, loading, disabled, onSubmit,
  } = props;
  const fieldId = title.toLowerCase().replace(/\s/g, "-");
  const canSubmit = !!urlValue && selectedBrowsers.length > 0 && !loading && !disabled;
  const urlErrorId = `${fieldId}-url-error`;

  return (
    <fieldset
      className={`view-container card-body scan-card${disabled ? " scan-card--disabled" : ""}`}
      disabled={disabled || loading}
      aria-labelledby={`${fieldId}-title`}>
      <h2 id={`${fieldId}-title`} className="card-title">{title}</h2>
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
    </fieldset>
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

import { filterSortResults, resultValue, type ResultSortKey } from "./services/results-view";

/* ── Results Panel ── */
function ResultsPanel({
  submittedUrl,
  wcag,
  selectedBrowsers,
  runId,
  onSettled,
  onBack,
}: {
  submittedUrl: string;
  wcag: string;
  selectedBrowsers: string[];
  runId?: string;
  onSettled: () => Promise<void>;
  onBack: () => void;
}) {
  const [results, setResults] = useState<TestResult[]>([]);
  const [resultsMessage, setResultsMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 80;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchResults = useCallback(async () => {
    return getResults(runId, submittedUrl);
  }, [runId, submittedUrl]);

  useEffect(() => {
    let cancelled = false;
    setResults([]);
    setCompleted(false);
    setResultsMessage("");
    setRetryCount(0);

    const attempt = async (currentRetry: number) => {
      setResultsLoading(true);
      try {
        const data = await fetchResults();
        if (cancelled) return;

        if (data.status === "completed") {
          void onSettled();
          setCompleted(true);
          setResults(data.results);
          setResultsMessage("Scan completed. No automated accessibility issues were found. This does not establish WCAG compliance.");
          setResultsLoading(false);
        } else if (data.status === "failed") {
          void onSettled();
          setResultsMessage(data.failure?.message || "The accessibility scan failed. Please try again.");
          setResults([]);
          setResultsLoading(false);
        } else if (currentRetry < maxRetries) {
          setRetryCount(currentRetry + 1);
          retryTimer.current = setTimeout(() => {
            if (!cancelled) attempt(currentRetry + 1);
          }, 3000);
        } else {
          setResultsMessage("The scan has not finished within the waiting period. Check Recent Tests for its status.");
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
          setResultsMessage("Unable to load scan results. Please try again.");
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
  }, [fetchResults, onSettled]);


  const labels = [...new Set(results.map(row => row.browser || "Browser not recorded"))];
  for (const selected of selectedBrowsers) {
    const family = /^Chrome(?:\s|$)|^chromium$/i.test(selected) ? "Chromium"
      : /^Firefox(?:\s|$)/i.test(selected) ? "Firefox" : "Browser not recorded";
    if (!labels.some(label => label.startsWith(family))) {
      labels.push(`${family} (version not recorded)`);
    }
  }
  labels.sort((a, b) => a.localeCompare(b));
  return (
    <div className="browser-results-page">
      <div className="results-header">
        <div className="results-header__left">
          <button className="results-back-btn" type="button" onClick={onBack}>← Back</button>
          <div>
            <h2 className="results-heading">Results</h2>
            <span className="results-url">{submittedUrl}</span>
          </div>
        </div>
      </div>
      {resultsLoading ? (
        <div className="results-loading" role="status">
          <span className="results-spinner" /><p>Analyzing… results will appear shortly</p>
        </div>
      ) : !completed ? (
        <div className="results-empty"><p role="status">{resultsMessage}</p></div>
      ) : labels.map(browser => (
        <BrowserResultsTable key={`${runId}-${browser}`} browser={browser}
          wcag={wcag} runId={runId} submittedUrl={submittedUrl}
          results={results.filter(row => (row.browser || "Browser not recorded") === browser)} />
      ))}
    </div>
  );
}

function BrowserResultsTable({ results, browser, wcag, runId, submittedUrl }: {
  results: TestResult[];
  browser: string;
  wcag: string;
  runId?: string;
  submittedUrl: string;
}) {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [issueTypeFilter, setIssueTypeFilter] = useState("");
  const [sortKey, setSortKey] = useState<ResultSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [runId, search, severityFilter, issueTypeFilter, sortKey, sortDirection]);
  const resetView = () => {
    setSearch(""); setSeverityFilter("");
    setIssueTypeFilter(""); setSortKey(null); setSortDirection("asc"); setCurrentPage(1);
  };
  const visibleResults = filterSortResults(results, {
    search, browser: "", severity: severityFilter,
    issueType: issueTypeFilter, sortKey, direction: sortDirection,
  });
  const pageCount = Math.max(1, Math.ceil(visibleResults.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const pageStart = (activePage - 1) * pageSize;
  const pageResults = visibleResults.slice(pageStart, pageStart + pageSize);
  const pageNumbers: Array<number | string> = [];
  const firstPageInGroup = Math.floor((activePage - 1) / 10) * 10 + 1;
  const lastPageInGroup = Math.min(firstPageInGroup + 9, pageCount);
  if (firstPageInGroup > 1) {
    pageNumbers.push(1);
    if (firstPageInGroup > 2) pageNumbers.push("earlier");
  }
  for (let page = firstPageInGroup; page <= lastPageInGroup; page++) {
    pageNumbers.push(page);
  }
  if (lastPageInGroup < pageCount) {
    if (lastPageInGroup < pageCount - 1) pageNumbers.push("later");
    pageNumbers.push(pageCount);
  }

  const filterOptions = (key: ResultSortKey) =>
    [...new Set(results.map(row => resultValue(row, key)))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const columns: Array<[ResultSortKey, string]> = [
    ["test_url", "Test URL"], ["test_type", "Type of Test"],
    ["issue", "Issue"],
    ["issue_type", "Type of Issue"], ["severity", "Severity"],
    ["screenshot", "Screenshot"], ["fix_reference", "How to Fix Reference"],
  ];
  const toggleSort = (key: ResultSortKey) => {
    if (sortKey === key) setSortDirection(value => value === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("asc"); }
  };
  const viewDescription = [
    search.trim() ? `Search: ${search.trim()}` : "",
    severityFilter ? `Severity: ${severityFilter}` : "",
    issueTypeFilter ? `Issue type: ${issueTypeFilter}` : "",
    sortKey ? `Sort: ${columns.find(([key]) => key === sortKey)?.[1]} (${sortDirection === "asc" ? "ascending" : "descending"})` : "",
  ].filter(Boolean).join("; ") || "All findings; original order";

  /* -- Summary counts -- */
  const totalIssues = visibleResults.length;
  const countByType = (type: string) => visibleResults.filter((r) => r.issue_type === type).length;
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
    const rows = visibleResults.map((r) =>
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
    const metadata = [
      ["WCAG standard", wcagLabel(wcag)].map(escapeField).join(","),
      ["Browser", browser].map(escapeField).join(","),
      ["View", viewDescription].map(escapeField).join(","),
      "",
    ];
    const csv = [...metadata, header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `accessibility-results-${browser.replace(/[^a-z0-9]+/gi, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /* -- Export PDF (print-friendly) -- */
  const exportPdf = () => {
    const tableRows = visibleResults
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
  <h1>${escapeHtml(wcagLabel(wcag))} / ${escapeHtml(browser)}</h1>
  <p>${escapeHtml(submittedUrl)}</p>
  <div class="summary">Showing ${totalIssues} of ${results.length} findings</div>
  <p>${escapeHtml(viewDescription)}</p>
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
    <section className="results-panel browser-results-section"
      aria-label={`${wcagLabel(wcag)} / ${browser}`}>
      <div className="results-header">
        <h3 className="results-heading">{wcagLabel(wcag)} / {browser}</h3>
        <div className="results-header__actions">
          <button className="export-btn" type="button" onClick={exportCsv}
            disabled={!visibleResults.length}
            aria-label={`Export ${browser} CSV`}>Export CSV</button>
          <button className="export-btn" type="button" onClick={exportPdf}
            disabled={!visibleResults.length}
            aria-label={`Export ${browser} PDF`}>Export PDF</button>
        </div>
      </div>
          <div className="results-controls" role="group" aria-label={`Filter ${browser} results`}>
            <label className="results-control results-control--search">
              Search findings
              <input type="search" value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="URL, issue, or reference" />
            </label>
            <label className="results-control">
              Severity
              <select value={severityFilter} onChange={event => setSeverityFilter(event.target.value)}>
                <option value="">All severities</option>
                {filterOptions("severity").map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="results-control">
              Issue type
              <select value={issueTypeFilter} onChange={event => setIssueTypeFilter(event.target.value)}>
                <option value="">All issue types</option>
                {filterOptions("issue_type").map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button type="button" className="results-reset" onClick={resetView}>Reset view</button>
          </div>
          {/* Summary Bar */}
          <div className="results-summary">
            <div className="results-summary__total">
              <span role="status" aria-live="polite">Showing <strong>{totalIssues}</strong> of {results.length} findings</span>
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
                  {columns.map(([key, label]) => (
                    <th key={key} scope="col"
                      aria-sort={sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" className="results-sort"
                        onClick={() => toggleSort(key)}
                        aria-label={`Sort by ${label}${sortKey === key ? `; currently ${sortDirection === "asc" ? "ascending" : "descending"}` : ""}`}>
                        {label} <span aria-hidden="true">{sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleResults.length === 0 && (
                  <tr><td colSpan={7}>{results.length ? "No findings match these filters. Use Reset view to show all findings." : "Scan completed. No automated accessibility issues were found. This does not establish WCAG compliance."}</td></tr>
                )}
                {pageResults.map((r) => (
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
          <div className="results-pagination">
            <span role="status" aria-live="polite">
              {visibleResults.length === 0
                ? "0 matching findings"
                : `Rows ${pageStart + 1}–${pageStart + pageResults.length} of ${visibleResults.length} matching findings`}
            </span>
            {pageCount > 1 && (
              <nav aria-label={`${browser} results pages`}>
                <button type="button" disabled={activePage === 1}
                  onClick={() => setCurrentPage(activePage - 1)}
                  aria-label="Previous results page">‹ Previous</button>
                {pageNumbers.map(page => typeof page === "number" ? (
                  <button key={page} type="button"
                    aria-label={`Results page ${page}`}
                    aria-current={activePage === page ? "page" : undefined}
                    onClick={() => setCurrentPage(page)}>
                    {page}
                  </button>
                ) : (
                  <span key={page} className="results-page-ellipsis" aria-hidden="true">…</span>
                ))}
                <button type="button" disabled={activePage === pageCount}
                  onClick={() => setCurrentPage(activePage + 1)}
                  aria-label="Next results page">Next ›</button>
              </nav>
            )}
          </div>

    </section>
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
  onView,
  actionPending,
  actionsDisabled,
}: {
  records: HistoryRecord[];
  loading: boolean;
  onDelete: (sysId: string) => Promise<void>;
  onRetest: (record: HistoryRecord) => void;
  onView: (record: HistoryRecord) => void;
  actionPending: string | null;
  actionsDisabled: boolean;
}) {
  const [deleteTarget, setDeleteTarget] = useState<HistoryRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteLock = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !deleteTarget) return;
    if (!dialog.open) dialog.showModal();
    cancelRef.current?.focus();
  }, [deleteTarget]);

  const closeDelete = () => {
    if (deleteLock.current) return;
    dialogRef.current?.close();
    setDeleteTarget(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteLock.current) return;
    deleteLock.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(deleteTarget.sys_id);
      dialogRef.current?.close();
      setDeleteTarget(null);
    } catch (error: unknown) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete this test. Please try again.");
    } finally {
      deleteLock.current = false;
      setDeleting(false);
    }
  };

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
      <dialog
        ref={dialogRef}
        className="delete-confirm-dialog"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-description"
        onCancel={event => {
          event.preventDefault();
          closeDelete();
        }}
      >
        <h2 id="delete-confirm-title">Delete this test?</h2>
        <p id="delete-confirm-description">
          This will permanently delete this test and its scan results.
        </p>
        <p className="delete-confirm-url">{deleteTarget?.url}</p>
        {deleteError && <p role="alert">{deleteError}</p>}
        <div className="delete-confirm-actions" aria-busy={deleting}>
          <button ref={cancelRef} type="button" onClick={closeDelete} disabled={deleting}>
            Cancel
          </button>
          <button
            type="button"
            className="delete-confirm-danger"
            onClick={() => { void confirmDelete(); }}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete test"}
          </button>
        </div>
      </dialog>
      <div className="history-card">
        {actionPending && (
          <p role="status" aria-live="polite">
            {actionPending.startsWith("retest:") ? "Starting scan…" : "Opening test results…"}
          </p>
        )}
        <div className="history-header">
          <h2 className="history-title">Recent Tests</h2>
          <span className="history-limit-note">Showing the 10 most recent tests.</span>
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
                      className="history-action-btn history-action-btn--view"
                      type="button"
                      onClick={() => onView(r)}
                      disabled={actionsDisabled || deleting}
                      aria-label={`View results for ${r.url}`}
                    >
                      View results
                    </button>
                    <button
                      className="history-action-btn history-action-btn--retest"
                      onClick={() => onRetest(r)}
                      disabled={actionsDisabled || deleting}
                      type="button"
                      aria-label={`Re-test ${r.url}`}
                      title="Re-Test"
                    >
                      <span aria-hidden="true">🔄</span> Re-Test
                    </button>
                    <button
                      className="history-action-btn history-action-btn--delete"
                      onClick={() => { setDeleteError(""); setDeleteTarget(r); }}
                      disabled={actionsDisabled || deleting}
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
