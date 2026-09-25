# AccessibilityLatest2026 — Standalone Architecture

## Purpose

This document describes the standalone architecture created after removing
ServiceNow from AccessibilityLatest2026.

The application now owns its API, test lifecycle, scanner communication,
and production scanner security boundary.

---

## Application Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         USER                                │
│                    Web Browser                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  REACT / TYPESCRIPT UI                      │
│                                                             │
│  • Submit URL                                              │
│  • Select browser                                          │
│  • Select WCAG standard                                    │
│  • Test history                                            │
│  • Accessibility results                                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ Standalone REST API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    NODE.JS BACKEND                          │
│                                                             │
│  • HTTP API                                                │
│  • Request validation                                      │
│  • TestService                                             │
│  • Test Repository                                         │
│  • Test lifecycle                                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ Scanner IPC
                            │ Unix Domain Socket
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  SCANNER SUPERVISOR                         │
│                                                             │
│  • Validates scanner requests                              │
│  • Controls scanner workload lifecycle                     │
│  • Maps scanner failures                                   │
│  • Enforces privileged security boundary                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              PRODUCTION LINUX BOUNDARY                      │
│                                                             │
│   Browser Namespace                Proxy Namespace           │
│   ┌──────────────────┐           ┌──────────────────────┐    │
│   │ Chromium         │           │ Controlled network   │    │
│   │ Playwright       │──────────►│ proxy / DNS / egress │    │
│   │ axe-core         │           │ policy               │    │
│   └──────────────────┘           └──────────┬───────────┘    │
│                                             │                │
│   Security Controls:                        │                │
│   • Linux namespaces                        │                │
│   • cgroups                                 │                │
│   • privilege dropping                      │                │
│   • SSRF / target protection                │                │
│   • nftables                                │                │
│   • controlled Internet egress              │                │
└─────────────────────────────────────────────┼────────────────┘
                                              │
                                              ▼
                                           Internet
                                              │
                                              ▼
                                        Target Website
```

---

## Result Flow

```text
Target Website
      │
      ▼
Chromium + Playwright + axe
      │
      ▼
Production Linux Boundary
      │
      ▼
Scanner Supervisor
      │
      │ IPC Result
      ▼
Node.js Backend
      │
      ▼
TestService / Repository
      │
      ▼
REST API
      │
      ▼
React UI
      │
      ▼
Accessibility Results
```

---

## Source Control and Hosting

```text
                    GitHub
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
       main                    CI/CD
  Source of Truth                 │
                                  ▼
                           GitHub Pages
                                  │
                                  ▼
                        Development/Test UI


               FINAL PRODUCTION
                     │
                     ▼
             Production Hosting
                     │
                     ▼
                React UI
                     │
                     ▼
              Node.js Backend
                     │
                     ▼
             Scanner Supervisor
                     │
                     ▼
        Secure Linux Scanner Boundary
```

GitHub Pages is retained as a development/test environment.

It is not intended to be the final production hosting environment.

GitHub remains the source-control and CI/CD repository.

---

## Production Scanner Security Model

The production scanner is intentionally separated from the web application.

The browser workload must not receive unrestricted direct Internet access.

The production architecture is designed around:

- Chromium sandbox enabled
- No `--no-sandbox`
- Linux namespace isolation
- cgroup resource isolation
- Privilege separation and dropping
- SSRF and target validation
- Controlled proxy-based Internet access
- DNS restrictions
- nftables network policy
- Deployment-network exclusions
- Root-owned trusted supervisor/runtime components
- Bounded supervisor capabilities

---

## Current Implementation Status

The standalone application and production scanner boundary foundation are
part of the current `main` baseline.

The production scanner execution path is still being completed.

Remaining production work includes:

- Final cgroup/workload lifecycle
- Workload UID separation
- Production browser/proxy process launch
- Readiness lifecycle
- Scanner execution lifecycle
- Linux production end-to-end validation

This section should be updated as those milestones are completed.
