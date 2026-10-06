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
│   ┌──────────────────────┐       ┌──────────────────────┐    │
│   │ Chromium / Firefox   │       │ Controlled network   │    │
│   │ Playwright + axe     │──────►│ proxy / DNS / egress │    │
│   │ Browser-specific     │       │ policy               │    │
│   │ runtime + sandbox    │       └──────────┬───────────┘    │
│   └──────────────────────┘                  │                │
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
Chromium or Firefox + Playwright + axe
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

- Chromium and Firefox browser sandboxes remain enabled
- No `--no-sandbox`
- Dedicated immutable browser runtime paths
- AppArmor user-namespace profiles for Chromium and Firefox
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

The standalone application and production scanner boundary are implemented
in the current development architecture.

The validation environment has completed live end-to-end scanner checks for
both Chromium and Firefox through the scanner supervisor. The validated path
includes browser-specific executable selection, Playwright browser launch,
axe-core accessibility evaluation, controlled proxy-based egress, Linux
workload isolation, and browser lifecycle cleanup.

The validated browser runtimes are pinned to immutable runtime paths:

- Chromium: `/opt/scanner-runtime/chromium-1243/chrome-linux-arm64/chrome`
- Firefox: `/opt/scanner-runtime/firefox-1543/firefox/firefox`

Ubuntu AppArmor user-namespace profiles are used for the browser sandboxes.
The production workload selects the dedicated profile based on the requested
browser: Chromium uses `accessibility-scanner-chrome`, while Firefox uses
`accessibility-scanner-firefox`. Unknown browser profile selections fail
closed before the browser process is launched.

The validation service continues to be treated as the controlled Linux
validation environment; final production hosting and deployment remain
separate concerns.

This section should be updated as the production deployment architecture
evolves.

## Scan Lifecycle and Results

See [Scan Lifecycle and Results](05-scan-lifecycle-and-results.md) for scan execution, browser tables, exports, pagination, and history actions.
