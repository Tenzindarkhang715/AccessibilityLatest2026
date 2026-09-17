# AccessibilityLatest2026 — Project Handoff

## 1. Project Purpose

AccessibilityLatest2026 is a web accessibility testing application originally developed within ServiceNow.

The application allows users to submit either:

- A website URL for a full-site accessibility scan
- A page URL for a single-page accessibility scan

Users can select:

- WCAG standard
- Browser
- Test type

The application displays accessibility findings and maintains recent test information.

The long-term objective is to completely eliminate ServiceNow and evolve this into a standalone, maintainable web application.

---

## 2. Current Technology

Current repository contains technologies including:

- React 18
- TypeScript
- CSS
- Vite
- Node/npm
- ServiceNow SDK
- ServiceNow Glide dependencies
- Git
- GitHub
- GitHub Actions
- GitHub Pages

Repository:

Tenzindarkhang715/AccessibilityLatest2026

---

## 3. Original ServiceNow Architecture

The application was originally created as a ServiceNow application.

ServiceNow currently/previously provides functionality such as:

- Application runtime
- REST/Table APIs
- Test data storage
- Accessibility result storage
- Authentication/session context
- CSRF protection using g_ck
- ServiceNow-specific tables
- ServiceNow deployment/build functionality

The React frontend contains ServiceNow-specific API integration.

Examples that may exist in the source include:

- ServiceNow Table API URLs
- TABLE_API
- RESULTS_API
- g_ck
- X-UserToken
- CSRF handling
- ServiceNow-specific fetch calls
- ServiceNow table names
- ServiceNow runtime assumptions

Codex must inspect the actual repository to identify the complete list rather than relying only on this document.

---

## 4. Existing Frontend

The primary frontend is React + TypeScript.

Important files include:

src/client/app.tsx
src/client/app.css
src/client/main.tsx
src/client/index.html

The current UI includes functionality such as:

- Web Accessibility Tool header
- Site URL testing
- Page URL testing
- WCAG standard selection
- Browser selection
- URL validation
- Submit
- Results
- Issue type
- Severity
- Screenshot column
- How to Fix reference
- Recent Tests
- Re-Test
- Delete
- CSV export
- PDF export

Existing UI/UX should be preserved during the migration unless a change is intentionally approved.

---

## 5. Screenshot Functionality

The Results UI currently contains a Screenshot column.

The frontend can display a screenshot when a result provides a screenshot value/URL.

At present, screenshots are not being populated in the GitHub demo results, so the column displays a dash.

Actual issue screenshot capture is intentionally deferred.

Do NOT remove the Screenshot functionality.

Future architecture should support capturing screenshots of accessibility violations.

---

## 6. GitHub Repository

The repository was originally misspelled:

AccesbilityLatest2026

It has been renamed correctly to:

AccessibilityLatest2026

The local Mac folder was also renamed to:

/Users/tenzindarkhang/Desktop/AccessibilityLatest2026

The Git remote points to:

Tenzindarkhang715/AccessibilityLatest2026.git

The main development branch is:

main

---

## 7. GitHub Pages Demo

A GitHub Pages-compatible version of the application was created so that the UI could run independently from the ServiceNow page/runtime.

A Vite configuration exists:

vite.github.config.js

The GitHub Pages base path is:

/AccessibilityLatest2026/

A separate entry page exists:

src/client/github.html

The package.json contains GitHub-specific build/preview commands.

The production GitHub Pages build outputs to:

dist/

The build process converts the GitHub entry page to:

dist/index.html

---

## 8. GitHub Demo Mode

The React application contains logic that detects when it is running outside the ServiceNow environment.

A constant currently exists similar to:

IS_GITHUB_PAGES

The implementation was expanded to recognize:

- tenzindarkhang715.github.io
- localhost
- 127.0.0.1

This was necessary so the application could run in demo mode both on GitHub Pages and during local Vite preview.

Demo mode was introduced because ServiceNow-specific authentication such as g_ck is unavailable on GitHub Pages.

Do NOT assume demo data represents a real accessibility scan.

Codex should inspect app.tsx to understand exactly how demo mode currently works.

---

## 9. GitHub Pages Deployment

GitHub Actions deployment has been configured.

Workflow:

.github/workflows/deploy-pages.yml

The workflow performs approximately:

1. Checkout repository
2. Setup Node
3. npm ci
4. npm run build:github
5. Configure GitHub Pages
6. Upload dist artifact
7. Deploy GitHub Pages

The GitHub Pages site currently works.

Test/demo URL:

https://tenzindarkhang715.github.io/AccessibilityLatest2026/

---

## 10. Purpose of GitHub Pages Going Forward

GitHub Pages is NOT intended to be the final production hosting environment.

It should remain available as a:

- Development/test environment
- Demo environment
- Validation environment
- Safe location for testing frontend enhancements

The final production application will be hosted on a real production hosting platform/server.

Do NOT remove the existing working GitHub Pages deployment during the ServiceNow migration.

---

## 11. Development Environment Going Forward

VS Code is intended to become the primary development environment.

Codex is installed in VS Code and can work against the repository.

Future development should primarily follow:

VS Code
  -> Git
  -> GitHub
  -> CI/CD
  -> Test environment
  -> Production environment

ServiceNow Studio should eventually no longer be required.

---

## 12. Primary Architecture Goal

COMPLETELY ELIMINATE SERVICENOW.

The final application must not require:

- ServiceNow runtime
- ServiceNow Studio
- ServiceNow tables
- ServiceNow Table APIs
- ServiceNow authentication
- g_ck
- X-UserToken
- ServiceNow CSRF/session handling
- ServiceNow deployment
- ServiceNow SDK at runtime
- ServiceNow-specific application dependencies

However, ServiceNow must NOT be removed prematurely.

The migration must preserve the currently working application until equivalent standalone functionality has been implemented and tested.

---

## 13. Proposed Standalone Architecture

Target architecture:

VS Code
   |
   v
GitHub
   |
   +--------------------+
   |                    |
   v                    v
Test Environment     Production Deployment
GitHub Pages         Real Hosting Server
   |                    |
   v                    v
React Frontend       Production Frontend
                        |
                        v
                 Accessibility API
                        |
               +--------+--------+
               |        |        |
               v        v        v
          Playwright  axe-core  Screenshots
               |
               v
          Results / Storage

GitHub remains the source-control platform.

GitHub Pages remains the test/demo frontend.

Production will eventually run on real hosting infrastructure.

---

## 14. Proposed Accessibility Backend

A standalone backend should replace the ServiceNow backend.

Preferred initial technology direction:

- Node.js
- TypeScript
- REST API
- Playwright
- @axe-core/playwright / axe-core

Conceptual scan:

User submits URL
    |
    v
React frontend
    |
    v
POST /api/scan
    |
    v
Node API
    |
    v
Playwright launches browser
    |
    v
Target webpage loads
    |
    v
axe-core accessibility analysis
    |
    v
Normalize violations
    |
    v
Return results
    |
    v
Existing React Results UI

The exact implementation should be evaluated against the existing repository before changes are made.

---

## 15. Future Data Storage

ServiceNow tables eventually need to be replaced.

Likely standalone entities include:

tests

- id
- url
- test_type
- browser
- wcag_standard
- status
- submitted_at
- completed_at

test_results

- id
- test_id
- issue
- issue_type
- severity
- fix_reference
- screenshot
- created_at

A production database technology has NOT yet been finalized.

Do not introduce a database merely for architectural elegance.

First establish the standalone scanning API and feature parity.

Persistent storage can then be introduced deliberately.

---

## 16. Production Hosting

Production hosting has NOT yet been finalized.

Requirements:

- Real production hosting/server
- HTTPS
- Node/backend support
- Browser automation support
- Ability to run Playwright
- Future database connectivity
- Environment variables/secrets
- CI/CD deployment from GitHub
- Ability to scale later

GitHub Pages should NOT be treated as production hosting.

---

## 17. Migration Strategy

Migration must be incremental.

### Phase 1 — Preserve

Keep the existing working application and GitHub Pages deployment intact.

Create a known-good Git reference/branch/tag before major architectural changes.

### Phase 2 — Separate

Separate ServiceNow-specific API/data logic from React presentation components.

The UI should interact through abstractions such as:

submitTest()
getTest()
getResults()
getRecentTests()
deleteTest()
retest()

instead of directly knowing about ServiceNow.

### Phase 3 — Standalone API

Implement a Node/TypeScript backend.

Initial API concepts may include:

POST /api/scan
GET /api/tests
GET /api/tests/:id
DELETE /api/tests/:id

Exact endpoints should be designed after repository analysis.

### Phase 4 — Accessibility Engine

Introduce Playwright + axe-core.

Support real accessibility scans independently from ServiceNow.

### Phase 5 — Feature Parity

Verify existing functionality including:

- Site URL
- Page URL
- URL validation
- WCAG selection
- Browser selection
- Submit
- Results
- Issue type
- Severity
- How to Fix
- Recent Tests
- Re-Test
- Delete
- CSV export
- PDF export
- Screenshot field compatibility

### Phase 6 — Persistence

Replace ServiceNow tables with standalone database/storage where required.

### Phase 7 — Production Hosting

Deploy frontend/backend to the selected real hosting environment.

Keep GitHub Pages as test/demo.

### Phase 8 — Remove ServiceNow

Only after standalone feature parity is proven:

Remove:

- ServiceNow API URLs
- ServiceNow tables
- g_ck
- X-UserToken
- ServiceNow CSRF handling
- ServiceNow-specific frontend branches
- ServiceNow SDK dependencies that are no longer required
- ServiceNow build/deployment dependencies

---

## 18. Critical Migration Rule

DO NOT BREAK THE WORKING APPLICATION WHILE MIGRATING.

Every meaningful migration stage should:

1. Start from a clean Git state.
2. Use an appropriate branch.
3. Make a small, understandable change.
4. Build successfully.
5. Test locally.
6. Test existing functionality.
7. Review the Git diff.
8. Commit only verified changes.
9. Push only after validation.

Large destructive rewrites should be avoided.

---

## 19. Source of Truth

The repository itself is the technical source of truth.

This handoff document contains project history, goals, architectural decisions, and migration requirements.

When this document differs from actual implementation details, Codex should:

1. Report the discrepancy.
2. Explain what exists in the repository.
3. Ask before making a consequential architectural change.

Do not silently rewrite working behavior based only on assumptions in this document.

---

## 20. Immediate Next Task for Codex

FIRST TASK: ANALYSIS ONLY.

Read this document and inspect the entire repository.

Do NOT modify, create, delete, rename, format, install, or upgrade anything.

Provide:

1. Current repository architecture.
2. Frontend entry points.
3. Complete ServiceNow dependency inventory.
4. ServiceNow API/table inventory.
5. Authentication/CSRF/g_ck dependency inventory.
6. GitHub demo-mode architecture.
7. GitHub Pages build architecture.
8. GitHub Actions deployment architecture.
9. Functionality currently independent of ServiceNow.
10. Functionality that still depends on ServiceNow.
11. Risks involved in removing ServiceNow.
12. Proposed migration boundaries.
13. Recommended first small refactoring step.

Wait for explicit approval before modifying any file.