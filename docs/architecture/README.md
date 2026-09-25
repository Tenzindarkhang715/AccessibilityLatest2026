# AccessibilityLatest2026 Architecture Documentation

This directory contains the architectural history and current architecture
of AccessibilityLatest2026.

## Documents

### 01 — ServiceNow Architecture

`01-servicenow-architecture.md`

Documents the original ServiceNow-dependent architecture before the
standalone migration.

Use this document for historical reference.

### 02 — Standalone Architecture

`02-standalone-architecture.md`

Documents the current standalone architecture, including:

- React / TypeScript frontend
- Node.js backend
- TestService and repository layer
- Scanner IPC
- Scanner Supervisor
- Production Linux security boundary
- Chromium / Playwright / axe scanner
- Network and workload isolation
- GitHub and hosting architecture

This document should evolve as the production architecture evolves.

### 03 — Migration Comparison

`03-migration-comparison.md`

Provides a side-by-side explanation of what changed during the migration
from ServiceNow to the standalone architecture.

---

## Source of Truth

The canonical development repository is:

```text
AccessibilityLatest2026
└── main
```

GitHub `main` is the canonical remote baseline.

The `migration/remove-servicenow` branch is retained on GitHub for
historical migration reference.

Important historical tags include:

- `pre-standalone-main`
- `production-scanner-boundary-baseline`

---

## Documentation Rule

Whenever a significant architectural change is completed and merged into
`main`, review this directory and update the relevant architecture
documentation.

The goal is to keep these documents synchronized with the actual
application rather than reconstructing the architecture later from Git
history.
