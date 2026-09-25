# AccessibilityLatest2026 — ServiceNow to Standalone Migration

## Purpose

This document summarizes the architectural transformation of
AccessibilityLatest2026 from a ServiceNow-dependent application to a
standalone accessibility testing platform.

---

## Before — ServiceNow Architecture

```text
User
 │
 ▼
React / TypeScript UI
 │
 │ ServiceNow Table REST API
 │ g_ck CSRF Token
 ▼
ServiceNow
 │
 ├── URL Test Table
 ├── Test Result Table
 ├── Business Rules
 ├── ACL / Security
 ├── Test Status Management
 └── Record Persistence
 │
 ▼
Accessibility Test Data
```

ServiceNow was part of the application runtime and provided the backend
application platform, APIs, records, business rules, and persistence.

---

## After — Standalone Architecture

```text
User
 │
 ▼
React / TypeScript UI
 │
 │ Standalone REST API
 ▼
Node.js Backend
 │
 ├── Request Validation
 ├── TestService
 ├── Test Repository
 └── Test Lifecycle
 │
 │ Unix Domain Socket IPC
 ▼
Scanner Supervisor
 │
 ▼
Production Linux Boundary
 │
 ├── Linux Namespaces
 ├── cgroups
 ├── Privilege Separation
 ├── SSRF Protection
 ├── nftables
 └── Controlled Network Egress
 │
 ▼
Chromium + Playwright + axe
 │
 ▼
Target Website
 │
 ▼
Accessibility Findings
```

ServiceNow is no longer part of the active runtime.

---

## Major Architectural Changes

| Area | Before | After |
|---|---|---|
| Frontend | React + TypeScript | React + TypeScript |
| Backend platform | ServiceNow | Standalone Node.js |
| API | ServiceNow Table API | Application REST API |
| Business logic | ServiceNow Business Rules | Node.js services |
| Test lifecycle | ServiceNow records/status | TestService |
| Scanner communication | ServiceNow-dependent workflow | Unix socket IPC |
| Scanner control | Platform-dependent | Scanner Supervisor |
| Browser execution | External/platform workflow | Chromium + Playwright |
| Accessibility engine | Platform workflow | axe |
| Network security | Platform-dependent | Explicit Linux boundary |
| Isolation | ServiceNow/platform | namespaces + cgroups |
| SSRF protection | Platform-dependent | Explicit target/network policy |
| Firewall | Platform-dependent | nftables |
| Source control | GitHub | GitHub |
| Dev/test hosting | GitHub Pages | GitHub Pages |
| Production hosting | ServiceNow-centric | Independent production hosting |

---

## Migration Result

The migration changed AccessibilityLatest2026 from:

```text
Frontend
   │
   ▼
ServiceNow Platform
```

into:

```text
Frontend
   │
   ▼
Standalone Backend
   │
   ▼
Scanner IPC
   │
   ▼
Privileged Supervisor
   │
   ▼
Secure Scanner Boundary
   │
   ▼
Browser Accessibility Engine
```

The application now owns its backend architecture and scanner execution
boundary rather than depending on ServiceNow as its runtime platform.

---

## Repository Strategy

Current development uses:

```text
Local
AccessibilityLatest2026
        │
        ▼
       main
        │
        ▼
GitHub origin/main
```

`main` is the canonical application baseline.

Historical migration references remain available through:

- `migration/remove-servicenow`
- `pre-standalone-main`
- `production-scanner-boundary-baseline`

Temporary implementation branches should be removed after their work is
validated and merged into `main`.

---

## Documentation Maintenance

These architecture documents should be updated whenever a significant
architectural change is merged into `main`.

In particular, update the standalone architecture after completion of:

- Production scanner workload lifecycle
- cgroup integration
- UID/process isolation
- Browser/proxy production launch
- Production readiness handling
- Linux end-to-end scanner validation
- Final production hosting
