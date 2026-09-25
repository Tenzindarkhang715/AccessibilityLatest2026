# AccessibilityLatest2026 — ServiceNow Architecture

## Purpose

This document preserves the architecture of AccessibilityLatest2026 before
ServiceNow was removed.

It is retained for historical reference and should not be treated as the
current production architecture.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         USER                                │
│                    Web Browser                              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       FRONTEND                              │
│              React + TypeScript UI                          │
│                                                             │
│  • URL / Page submission                                   │
│  • Browser selection                                       │
│  • WCAG selection                                          │
│  • Test history                                            │
│  • Results display                                         │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ ServiceNow REST/Table API
                            │ + g_ck CSRF token
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       SERVICENOW                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ServiceNow Application                               │  │
│  │                                                       │  │
│  │ • URL Test table                                     │  │
│  │ • Test Result table                                  │  │
│  │ • Business Rules                                     │  │
│  │ • UI/Application configuration                       │  │
│  │ • ServiceNow security / ACLs                         │  │
│  │ • Status & test record management                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Table APIs:                                                │
│                                                             │
│  /api/now/table/x_2191106_test_age_url_test                 │
│  /api/now/table/x_2191106_test_age_test_result              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ Test processing / results
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                 ACCESSIBILITY TEST DATA                     │
│                                                             │
│  • Test status                                             │
│  • WCAG results                                            │
│  • Browser information                                     │
│  • Findings                                                │
│  • Test history                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## GitHub / Development Architecture

```text
Developer
    │
    ▼
ServiceNow Studio
    │
    │ Git Source Control
    ▼
GitHub Repository
    │
    └──── GitHub Pages
              │
              ▼
        Development / Test UI
```

## ServiceNow Responsibilities

ServiceNow provided major application-platform capabilities including:

- Application data tables
- URL test records
- Accessibility result records
- Business Rules
- Table REST APIs
- Application security and ACLs
- Test status management
- Record persistence
- ServiceNow-specific application configuration

The React frontend communicated directly with ServiceNow APIs and used the
ServiceNow `g_ck` CSRF token for authenticated requests.

## Historical Status

This architecture was replaced during the standalone migration.

ServiceNow is no longer part of the active AccessibilityLatest2026 runtime.

Historical ServiceNow implementation and migration history remain available
through Git history, the retained `migration/remove-servicenow` branch, and
the `pre-standalone-main` tag.
