# Standalone accessibility API contract

Status: contract only. No HTTP server, storage, scanner, browser automation, or
frontend mode switching is implemented. `src/models.ts` contains types, not
runtime validation. This contract describes the intended standalone boundary;
it does not change existing ServiceNow or demo behavior.

## Domain versus compatibility

The permanent application concepts are scan requests, test runs, findings,
optional screenshots, IDs, timestamps, status, and re-test lineage. These models
are not a database schema. Storage layout remains deferred.

- `ScanRequest`: `url`, explicit `testType`, `browsers[]`, `wcagStandard`.
- `TestRun`: scan request plus `id`, `status`, `submittedAt`, `completedAt`,
  `retestOfId`, and nullable `failure`.
- `Finding`: `id`, `testId`, `pageUrl`, `issue`, `issueType`, nullable `severity`,
  `fixReference`, and `screenshotId`.
- `FindingResponse`: finding plus parent-derived `testType` and nullable
  authorized `screenshotUrl`. These derived fields are not independent stored
  truth. Including type makes the temporary cross-run URL query self-contained.
- `Screenshot`: future internal metadata with `id`, `testId`, `findingId`,
  `storageKey`, `contentType`, and `createdAt`. Never return `storageKey` publicly.

IDs are opaque application-generated strings. Timestamps use ISO 8601 UTC.
`submittedAt` is the accepted run's creation time; no redundant run `createdAt`
is needed initially. Screenshot `createdAt` is its capture/storage creation time.
Requested browser strings do not establish support for particular versions.
WCAG identifiers express requested coverage, not a conformance guarantee.

### Temporary frontend compatibility fields

The existing frontend shapes remain outside the standalone models and API.
A future frontend adapter translates them as follows:

| Existing field | Standalone source / mapping |
| --- | --- |
| `SubmitResult.type` | `ScanRequest.testType` |
| `SubmitResult.value` | `ScanRequest.url` |
| `SubmitResult.wcag` | `ScanRequest.wcagStandard` |
| `SubmitResult.browsers` | `ScanRequest.browsers` (array retained) |
| Extra `standard` argument | Display label used in legacy notes; not an API field |
| `HistoryRecord.sys_id` | `TestRun.id` |
| `HistoryRecord.sys_created_on` | `TestRun.submittedAt` |
| `HistoryRecord.wcag_standard` | `TestRun.wcagStandard`; presentation policy deferred |
| `HistoryRecord.browser` | Join `TestRun.browsers` with `", "` for display only |
| `TestResult.sys_id` | `Finding.id` |
| `TestResult.test_url` | `Finding.pageUrl` |
| `TestResult.test_type` | `FindingResponse.testType` |
| `TestResult.issue_type` | `Finding.issueType` |
| `TestResult.fix_reference` | `Finding.fixReference`, null mapped to empty string |
| `TestResult.screenshot` | `FindingResponse.screenshotUrl`, null mapped to empty string |
| `TestResult.severity` | `Finding.severity`, null mapped to empty string |

History `url`/`status` and result `issue` retain their domain meaning. Their presence
in an old interface does not make those concepts temporary. Legacy generated
`name` and prose `notes` are not required standalone fields. Never infer test type
from notes or reconstruct browser requests by splitting a display string.

The URL-query bridge and its `CompatibilityResultsQuery` and
`CompatibilityResultsResponse` types are temporary too. Remove them after callers
use run IDs. The bridge's `url`/`limit` parameters are temporary access semantics,
not new domain fields.

### ServiceNow concepts excluded from this API

`sys_id`, `sys_created_on`, table names/URLs, `sysparm_*`, display-value response
rules, `g_ck`, `X-UserToken`, Glide APIs, SDK metadata, and ServiceNow role names
must not appear in standalone requests or response models. Existing ServiceNow
transport and authentication stay exclusively in its frontend provider until
that provider is retired. Standalone authentication is a separate deferred choice.

## HTTP conventions and errors

Routes are relative to the configured API origin, independent of the Pages base
path. Requests with bodies use JSON; responses use JSON except 204. Unknown or
malformed fields, invalid IDs/query values, and unsupported options require
runtime validation. Clients cannot set run IDs, status, timestamps, or findings.

All HTTP errors use `ApiErrorResponse`:

```json
{"error":{"code":"INVALID_REQUEST","message":"A safe explanation."}}
```

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Malformed body/query or invalid field values |
| 401 | `UNAUTHENTICATED` | Authentication required |
| 403 | `FORBIDDEN` | Authenticated caller lacks an operation permission |
| 404 | `NOT_FOUND` | Resource missing or outside caller's accessible scope |
| 422 | `UNSUPPORTED_SCAN_OPTIONS` | Unsupported browser/WCAG/type combination |
| 422 | `TARGET_NOT_ALLOWED` | Target prohibited by scanning policy |
| 429 | `RATE_LIMITED` | Request or execution capacity exceeded |
| 503 | `SCANNER_UNAVAILABLE` | Scan execution cannot accept work |
| 500 | `INTERNAL_ERROR` | Unexpected failure; no internal details disclosed |

These errors apply to relevant endpoints below. Missing or inaccessible run IDs
use 404 to avoid revealing another user's records. Failures discovered after
acceptance are stored as run failure information, not retroactive HTTP errors.
Failure-code taxonomy and detailed authentication/authorization policy are deferred.

## Operation contracts

### submitTest

- Current frontend: `submitTest({ type, value, browsers, wcag }, standard)` returns
  `Promise<void>`. The compatibility adapter can discard the new API response
  until the frontend is approved to retain a run ID.
- HTTP: `POST /api/tests`.
- Body: `SubmitTestRequest` = `{ url, testType, browsers, wcagStandard }`.
  Require a valid permitted URL, explicit site/page type, nonempty browser array,
  and valid WCAG identifier. Actual supported options are validated separately.
- Success: 202, `SubmitTestResponse` = `{ test: TestRun }`, with
  `Location: /api/tests/{id}`. The returned run is `pending`, terminal time and
  failure are null, and `retestOfId` is null.
- Persist the accepted request and pending run before acknowledgment. Execution
  follows asynchronously; acceptance does not mean a completed accessibility scan.
- Without a functioning execution path, return 503 `SCANNER_UNAVAILABLE` and do
  not create fake completed results or leave accepted jobs pending indefinitely.
- Errors: common envelope, particularly 400/422/429/503/500 and authorization errors.

### getRecentTests

- Current frontend: no arguments; `Promise<HistoryRecord[] | undefined>`.
- HTTP: `GET /api/tests?limit=10`. No body.
- Query: `RecentTestsQuery`; positive bounded integer `limit`, default 10.
  Maximum is deferred. Order by submission time descending, with a stable ID
  tie-breaker. Only return runs accessible to the caller.
- Success: 200, `RecentTestsResponse` = `{ tests: TestRun[] }`; empty list is valid.
- Persistence: read saved runs; do not fabricate history when storage fails.
- Errors: common envelope. A temporary adapter preserves the current UI behavior
  of leaving displayed history untouched on failed reads, rather than replacing
  it with an empty list. Broader history pagination is deferred.

### getResults

- Current frontend: `getResults(submittedUrl)` returns `Promise<TestResult[]>`.
- Permanent HTTP: `GET /api/tests/{id}/results`. No body.
- Query: `ResultsQuery` with optional bounded positive `limit` and opaque `cursor`.
  Default page size 50; maximum and cursor encoding are deferred.
- Success: 200, `ResultsResponse` =
  `{ testId, status, findings: FindingResponse[], nextCursor }`.
- Pending/in-progress runs return an empty findings page with their actual
  status. Initially publish findings as a complete immutable set when the run
  completes. Completed runs may legitimately have zero findings. Failed runs
  return status `failed` and no published findings; inspect the run for failure.
- Pagination must have stable ordering; exact finding ordering is deferred.
- Persistence: every finding belongs to a run and records the affected page URL.
- Errors: common envelope, including 404 for missing/inaccessible runs.

Temporary HTTP bridge: `GET /api/results?url=<encoded-url>&limit=50`, no body.
`CompatibilityResultsQuery` requires an exact stored page URL and has a default
limit of 50, capped at 50 to retain the legacy access limit. Respond 200 with
`CompatibilityResultsResponse` = `{ findings: FindingResponse[] }` from accessible
runs, or an empty list. Reading this route never initiates a scan or fetches the
URL. Do not silently change it to newest-run-only retrieval. Existing ServiceNow
result ordering is unspecified, so exact ordering parity is not promised.

The adapter projects findings into `TestResult[]`. Existing results reads turn
HTTP failure into `[]`; network/parse errors enter the UI retry path. Preserving
this temporary behavior must not cause the backend to conceal errors as HTTP
success. Retirement of URL lookup and status-aware UI behavior require approval.

Supporting route: `GET /api/tests/{id}`, no body/query, returns 200 `TestResponse`
or a common error. This supplies status and failure details without findings.

### deleteTest

- Current frontend: `deleteTest(sysId)` returns `Promise<void>`; the adapter uses
  the mapped application ID, never a ServiceNow table address.
- HTTP: `DELETE /api/tests/{id}`. No body or query.
- Success: 204, no body. Missing/inaccessible runs return 404; other failures use
  the common envelope. A repeated deletion therefore returns 404.
- Persistence: atomically remove the run and its findings from API visibility.
  Clean up its screenshot objects reliably; cleanup may be retried separately.
- Running work must be stopped or prevented from publishing after deletion.
  A completion callback must not resurrect deleted data.
- Re-tests are independent runs and must survive deletion of their source run.
  `retestOfId` may remain as historical lineage without requiring a live parent.

### retestTest

- Current frontend: `retestTest(record: HistoryRecord)` returns `Promise<void>`.
- HTTP: `POST /api/tests/{id}/retests`. No request body or query required.
- Read and authorize the original run; copy its stored scan specification and
  revalidate against current capabilities/security policy. Ignore client-side
  display strings as authoritative input.
- Success: 202, `RetestTestResponse` = `{ test: TestRun }` with a new ID, pending
  status, fresh submission timestamp, null terminal time/failure, and
  `retestOfId` referencing the source. Include the new run's Location header.
- Persistence: save a separate run; never overwrite the original findings.
- Errors: common envelope, especially 404/422/429/503. Without a scanner, reject
  rather than accepting work that cannot run.
- The frontend currently refreshes history without navigating to the new run.
  Keep that behavior until explicitly approved otherwise.

## Lifecycle and compatibility limits

Lifecycle: `pending -> in_progress -> completed | failed`; failures before
execution can also move pending directly to failed. `completedAt` is null while
active and the terminal timestamp for both completed and failed. `failure` is
non-null only for failed runs. Save findings and completed status consistently
before making completion visible. Partial result publication is deferred.

Neither the current ServiceNow path nor demo performs real scanning. Preserve
their existing data, token errors, generic demo storage errors, labels, and
quirks in their own providers. Standalone errors must not mention ServiceNow
tokens. Error-message mapping for the standalone adapter is deferred.

Known frontend constraints requiring separately approved integration work:

- Submission discards run IDs, while results use URL-wide retrieval.
- Polling makes one attempt plus five retries at three-second intervals, stops
  at the first nonempty findings array, and cannot distinguish zero findings,
  pending work, or failure. Real scans may exceed this duration.
- Existing history carries display values and lacks explicit test type.
- Current ServiceNow re-test notes lose site intent; standalone re-tests instead
  copy the stored specification. This is an intentional new-mode semantic
  difference, not a correction to the retained legacy provider.
- Demo findings always use site type, high/medium/low severities, and no screenshot.
- Exact browser versions, WCAG coverage, severity/category normalization, and
  full-site scope need explicit capability decisions before engine integration.
- Result pagination, complete exports, timestamp formatting, and successful
  zero-finding presentation require approval before changing the UI.

## Temporary three-mode frontend architecture

`app.tsx -> test-service facade -> ServiceNow | demo | standalone provider`.
The standalone provider owns REST calls and legacy frontend projections.

Future optional runtime configuration selects `servicenow`, `demo`, or
`standalone`, with an API base URL for standalone. Validate explicit configuration;
do not silently fall back to fake results on configuration or network failure.
Select the provider once at startup. No secrets belong in browser configuration.

Without explicit configuration, retain the existing behavior exactly: the
GitHub hostname, localhost, and 127.0.0.1 select demo; other hosts select ServiceNow.
Thus the existing Pages build/workflow can remain untouched. Local standalone
testing requires explicit opt-in. The exact configuration injection mechanism is
deferred. No mode switch is implemented by these files.

## Implementation boundaries

### Persistence

A narrow store owns run creation/read/list/status changes, finding publication,
and deletion. Domain models do not prescribe SQL tables or an ORM. Memory storage
is acceptable only for isolated local contract validation: it loses data on
restart and cannot support multiple processes. Durable storage, retention,
ownership, recovery, and migrations must be resolved before replacing ServiceNow
in production. Never import demo history as real scan evidence automatically.

### Scanner

A scanner accepts a validated specification and cancellation signal, producing
normalized findings and execution metadata. It has no React, HTTP, ServiceNow,
or database knowledge. The application service controls lifecycle and persistence.
No scanner implementation or fake production findings belong in this phase.

### Playwright/browser automation

Browser execution owns browser/context creation, bounded navigation, cleanup,
and cancellation. Requested versions must not be silently substituted. Record
actual execution capabilities when implemented. Site traversal requires approved
origin/path scope, page/depth/time limits, and URL deduplication. One page does
not count as a completed full-site scan. Browser contexts alone are not a security
boundary against hostile pages.

### axe-core

The accessibility engine analyzes loaded documents and supplies rule/node evidence.
Mapping requested WCAG coverage to engine rules, affected-node granularity,
severity/category mapping, and evidence storage are deferred. Automated checks
do not establish complete WCAG conformance or replace manual testing.

### Screenshot capture/storage

Capture produces image bytes plus run/finding association. Storage owns object
keys, access, retention, and cleanup. The API resolves authorized delivery URLs;
the existing UI can keep linking to screenshots. Until implemented,
`screenshotId` and `screenshotUrl` are null (mapped to empty strings for the UI).
Do not use stock images as scan evidence. Storage paths and credentials stay
internal. URL expiry and durable links in CSV/PDF exports require a later policy.

## Security requirements before network scanning

The frontend URL regex is not an SSRF defense. Before production scanning, enforce
server-side target policy and network isolation; do not expose an unrestricted
scanner during development either.

- Parse URLs safely; permit only approved HTTP/HTTPS schemes and ports. Reject
  embedded credentials, unsafe protocols, malformed/ambiguous destinations, and
  attempts to select local files or internal services.
- Block localhost names, loopback addresses, private/link-local networks, cloud
  metadata endpoints, and other non-public/internal destinations. Handle IPv4,
  IPv6, alternate address representations, and all resolved DNS addresses.
- Revalidate every redirect; reject redirects to prohibited destinations. Address
  DNS rebinding and validation-to-connection races, rather than trusting a single
  initial DNS lookup.
- Apply destination restrictions to browser subresources, frames, popups,
  fetches, and other outbound traffic, not just the initial page URL. Enforce
  egress policy at the network layer; browser interception alone is insufficient.
- Isolate hostile pages from the API process, credentials, metadata services,
  storage networks, and host filesystem. Use least privilege and browser sandboxing.
- Bound request bodies, URLs, execution duration, pages/depth, redirects, memory,
  response sizes, concurrency, and queue size. Add rate limits and abuse controls.
- Authorize every run/finding/screenshot read, re-test, and deletion. CORS is not
  authentication. Cookie-based authentication would require an independent CSRF
  design. Never forward application credentials to scan targets.
- Use HTTPS in production. Do not log secrets or sensitive URL query values.
  Treat scanned text/HTML, fix links, screenshot links, and export cells as
  untrusted. Safe URL schemes and CSV formula handling require explicit review.
- Protect screenshot content and define retention/deletion; it may contain
  sensitive page information. Keep failure responses free of stack traces/secrets.

References informing these requirements:
[OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html),
[Playwright isolation guidance](https://playwright.dev/docs/docker), and
[automated accessibility testing limitations](https://playwright.dev/docs/accessibility-testing).

## Deferred decisions (complete register)

1. Node/TypeScript versions, HTTP library, package scripts, runtime validation,
   dependency choices, and executable server structure.
2. Database/storage technology, physical schema, migrations, durability, historical
   data import, retention, and multi-process operation.
3. Authentication, user/tenant ownership, authorization rules, CORS origins, and
   CSRF mechanism if cookie authentication is selected.
4. Execution scheduling, queue/recovery strategy, retries/idempotency, cancellation,
   deletion races, and interrupted-run handling.
5. Browser/version support, actual execution metadata, WCAG rule mapping, and
   capability discovery. Unsupported selections must never be silently simulated.
6. Site crawl scope, URL normalization/deduplication, navigation readiness, and
   numeric scan/concurrency/network limits.
7. Finding granularity, evidence schema, category/severity mappings, failure-code
   taxonomy, and partial-results policy.
8. Query maximums, stable finding ordering, cursor encoding, and broader history
   pagination (documented defaults above are fixed for this proposed contract).
9. Screenshot format/capture strategy, object storage, authorized URL delivery,
   expiry/export-link policy, retention, and cleanup retries.
10. Mode-configuration injection, standalone adapter error/display mapping, run-ID
    adoption, compatibility-route retirement, polling, empty-state UI, and export
    pagination/security changes.
11. Production host, network sandbox/egress enforcement, secret management,
    resource limits, operational logging/monitoring, and future CI/CD deployment.

These decisions require later review; none is implemented or implicitly resolved
by creating these two contract files. No existing frontend, package, ServiceNow,
GitHub Pages, or GitHub Actions file needs modification for this step.
