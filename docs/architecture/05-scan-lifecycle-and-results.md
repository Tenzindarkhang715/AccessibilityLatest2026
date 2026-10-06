# Scan Lifecycle and Results

## Scan selection and execution
A submission selects a Site scan or a Page scan. Entering a URL in one card disables the other until cleared.
The live scanner supports WCAG 2.1 Level AA and one Chromium selection, one Firefox selection, or one of each.
Multiple version labels from the same browser family are unsupported.
UI version labels map to browser families; execution uses the installed runtime, not the requested historical version.
Page scans evaluate the submitted page. Site scans crawl eligible same-host pages, bounded to 25 pages and depth 3.

## Lifecycle and findings
Submission returns a run ID. Tests transition through pending, in_progress, completed, or failed.
Combined tests execute sequential single-browser IPC requests. Findings publish only after all browsers succeed.
If either browser fails, the whole run fails and no partial findings publish.
Findings record the executed browser family and version. Missing version metadata is marked as not recorded.
Results use run IDs and API cursors. The frontend collects completed findings before filtering and sorting.
Safe failure messages reach the UI; detailed engine diagnostics remain in scanner logs.

## Navigation recovery and security
net::ERR_NETWORK_CHANGED can retry once using a fresh page and the remaining navigation timeout budget.
Other navigation errors are not automatically retried. Cancellation and target admission remain enforced.
Browser sandboxes, proxy egress, DNS validation, namespaces, cgroups, and firewall controls remain enabled.

## Results tables and reports
Each browser has its own table headed by selected WCAG standard and executed browser, without a Browser column.
Search, severity/type filters, sorting, reset, and ten-row pagination are independent per browser section.
Filtering or sorting resets that section to page one.
CSV and printable PDF exports include all filtered findings in sorted order, not just the displayed page.
Exports include WCAG, browser, and view context. PDF uses the browser print/save-to-PDF flow.
Exports are disabled when no filtered findings exist.
Completed empty scans and filters with no matches have distinct messages.
Automated findings do not establish WCAG compliance or replace manual assessment.

## Recent Tests
History displays the ten most recent tests; this is a display limit, not a retention policy.
View results opens the selected run without starting another scan.
Re-Test creates a new run with the original settings, opens progress, then displays the new results.
Delete requires confirmation identifying the URL. Cancel or Escape preserves the test.
Confirmation deletes the test and findings; deletion errors appear in the dialog.
Storage is currently in memory. Backend restart clears tests and findings.

## Validation status
Live Chromium, Firefox, and combined scans returned results through the Linux supervisor.
Navigation tests passed on Mac and Linux. The backend suite reported 225 passes and one skip out of 226.
Latest frontend changes built successfully. Manual checks of separate tables and new history actions remain to be recorded.
Final production hosting and persistent storage remain separate work.
