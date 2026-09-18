# Standalone backend skeleton

Requires Node.js 24 or newer. Dependencies are isolated in this directory.

From `backend/`:

```sh
npm ci
npm run build
npm start
```

Defaults: `HOST=127.0.0.1`, `PORT=3001`. Override with environment variables:

```sh
HOST=127.0.0.1 PORT=3002 npm start
```

An empty host or invalid port fails startup. Port must be an integer from 1 to
65535. Binding to a non-loopback interface requires an explicit HOST override.
Use Ctrl+C to stop. Build output is `backend/dist/`, separate from the Pages build.

## Implemented API (scanning unavailable)

| Route | Behavior |
| --- | --- |
| `GET /health` | 200 `{ "status": "ok" }` (process health only) |
| `POST /api/tests` | Validate JSON; valid requests return 503 `SCANNER_UNAVAILABLE`, no writes |
| `GET /api/tests` | 200 `{ tests: [] }` on a fresh process |
| `GET /api/tests/{id}` | 200 `{ test }` when stored, otherwise 404 |
| `GET /api/tests/{id}/results` | 200 `{ testId, status, findings, nextCursor }` when stored, otherwise 404 |
| `DELETE /api/tests/{id}` | 204 when deleted, otherwise 404 |
| `POST /api/tests/{id}/retests` | 503 for an existing valid run; 404 when missing; no writes |

Errors use the contract's JSON envelope. Invalid input/query/body is 400;
unsafe URL protocol or embedded credentials is 422 `TARGET_NOT_ALLOWED`.
Unknown routes return 404, unsupported methods 405 with Allow, unexpected errors
500 without internal details. The temporary `/api/results?url=...` compatibility
route remains deferred and returns 404. No authentication is implemented; this
is local development infrastructure, not a production service.

POST requires `application/json`; the body limit is 16 KiB. Other operations
accept no body. Unknown fields, duplicate/unknown query parameters, invalid IDs,
and malformed JSON are rejected. IDs are opaque URL-safe strings, 1–128
characters (letters, digits, underscore, hyphen), not ServiceNow identifiers.
No IDs are allocated while scan acceptance is disabled.

Pagination/query maximums remain deferred. There is no 100-record cap or other
chosen page-size maximum in this increment. Defaults remain 10 for history and
50 for findings. A supplied limit must be a positive JavaScript safe integer;
this is an implementation safeguard against numeric rounding, not a finalized
API maximum. The in-memory repository slices existing records and does not
allocate storage proportional to the requested limit, so an additional cap is
not technically necessary here. Future production resource bounds require review.

The current in-memory implementation sorts history by submittedAt
descending then ID ascending; published findings sort by ID ascending. Cursors
are opaque base64url-encoded run-ID/offset pairs, validated against the requested
run. Cursor encoding and finding ordering are provisional implementation details,
not finalized API design decisions. They are pagination positions, not
authorization credentials. Active/failed
runs publish no findings; completed runs may have an empty findings list.

HTTP handling lives in `src/app.ts`; application operations in
`src/test-service.ts`; `TestRepository` defines asynchronous storage operations.
`MemoryTestRepository` stores consistent run/findings snapshots, copies records
on input/output, and deletes both together. It starts empty and loses everything
on restart. Independent re-tests are not cascade-deleted. There is no public
record insertion endpoint, startup seed, history fixture, or fake scan result.
Database implementations can replace the repository without changing routes.
Status updates/job publication are deliberately deferred until a scanner exists.

The contract is explicit about no-scanner behavior: requests are not accepted
as pending and no fake completed runs are created. Basic request syntax is
validated but browser capabilities and DNS/network SSRF enforcement are not yet
implemented. No URL is fetched or resolved. Private/public destinations alike
cannot execute scans. Complete SSRF protections remain mandatory before enabling
any real execution path.

## Validation

From `backend/`:

```sh
npm run build
node --test test/api.test.mjs
node --test test/address-policy.test.mjs test/target-policy.test.mjs
node --test test/scanner.test.mjs
node --test test/target-resolver.test.mjs test/pinned-connection.test.mjs
node --test test/egress-proxy.test.mjs
node --test test/*.test.mjs
```

Tests start and stop isolated loopback servers. Existing-run checks insert marked
fixtures into test-only repositories; they never seed the application server or
invent accessibility findings. The tests cover errors, no-write submission and
re-test behavior, record reads/deletion, storage isolation, and process health.

TypeScript and Node declarations remain development dependencies. Runtime
dependencies are pinned to `ipaddr.js` 2.5.0, `playwright` 1.63.0 and
`@axe-core/playwright` 4.13.0. The latter supplies axe-core transitively.
`API_CONTRACT.md` is the original design document;
its opening "contract only" implementation-status note predates these increments.
Its 202 accepted-scan lifecycle remains future behavior; the contracted 503 guard
is the only available submission outcome for valid requests in this increment.

## Target security policy (not connected to scan acceptance)

`src/security/address-policy.ts` classifies literal IP addresses without I/O.
`src/security/target-policy.ts` evaluates URLs using a caller-injected resolver;
it contains no built-in DNS resolver, HTTP client, socket creation or navigation.
Neither module is imported by the running API. The existing submission/Re-Test
503 guard remains unchanged: no ID, history, pending job or findings are created.

Policy behavior:

- Require explicit HTTP/HTTPS URLs without userinfo (including empty userinfo),
  whitespace/control characters or backslash parser repairs.
- Canonicalize hostnames with WHATWG URL, including IDNs, one trailing DNS dot,
  and alternate IPv4 URL representations, before checking destinations.
- Reject localhost/subdomains, single-label names, local/internal/reserved names,
  known metadata hostnames, malformed DNS labels and scoped IPv6 addresses.
- Reject IPv4 loopback, private, link-local, shared, multicast, reserved,
  documentation and special-purpose ranges, including Azure's 168.63.129.16.
  Common AWS/GCP link-local and Alibaba shared-space metadata addresses are
  covered by those ranges. This is not an exhaustive provider service inventory.
- Permit IPv6 only within global unicast 2000::/3 with explicit special-purpose
  exclusions. Reject ULA, link-local, loopback, unspecified, multicast, mapped
  IPv4 (even public mappings), NAT64 and 6to4/other excluded transition space.
- Require explicit allowed ports from trusted configuration. There is no default
  production port selection; tests using 80/443/8443 do not establish one.
  Additional deployment-specific denied hostnames may only extend exclusions.
- Require all resolver-supplied A/AAAA answers to pass. Empty, malformed, mixed
  public/private answers and resolver errors fail closed. Literal IPs skip DNS.
- Reassess relative or absolute redirect destinations with fresh resolution,
  including same-host redirects. This helper never follows a redirect and does
  not define site/crawl scope or a redirect-hop limit.
- Require an AbortSignal. The caller must supply a bounded deadline/cancellation
  signal. Assessment settles on cancellation even if a resolver ignores it;
  terminating resolver resources remains the resolver adapter's responsibility.

The conservative address ranges were reviewed against the
[IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry/)
and [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry/).
Some globally reachable special-purpose exceptions are intentionally excluded.
These lists require maintenance and review against the eventual host network;
they are explicit application rules, not ipaddr.js's default range taxonomy.

### Mandatory boundary before any future navigation

Successful evaluation returns an immutable **assessment-only** snapshot with
`requiresConnectionEnforcement: true`. It does not authorize browser navigation
and does not close the DNS rebinding/validation-to-connection race.

A future trusted resolver must supply all A/AAAA answers through aliases, reject
partial failures, avoid search-domain expansion, and honor cancellation. These
resolver obligations cannot be verified by inspecting an answer array alone.
The resolver/connection foundation below now supplies a concrete resolver; it is
not connected to the API or browser adapter.

Before enabling scanning, an isolated worker and controlled egress must validate
and pin the actual upstream connection to an assessed address, preserve hostname
TLS verification, and deny bypass paths/direct egress. Independently resolving
the hostname in a browser after assessment is unsafe. Revalidate each new
connection and redirect, plus frames, subresources and script-originated traffic.
Network-level restrictions must cover service workers, WebSockets, UDP/other
browser traffic, worker/API/host addresses, metadata and deployment-specific
internal services. Browser interception alone is insufficient. Nonstandard
deployment NAT64/translation routes and publicly numbered internal services need
deployment-specific egress exclusions too.

Redirect hop limits, crawl boundaries, concrete production ports, resource limits,
browser integration, production hosting and the other deferred scanner decisions
remain open at the scanner/deployment level. The component controls described
below do not enable live scanning or provide browser-wide enforcement.

Tests inject fixed resolver answers and manually controlled cancellation. They
exercise allowed/prohibited IPv4/IPv6, URL normalization, credentials, hostnames,
DNS failures/mixed answers, changed DNS and redirects without external DNS or
target requests. Service-level guards also assert no network/process/ID-generation
calls or writes during unavailable submission/Re-Test. Existing HTTP tests retain
their temporary loopback API servers; production target rules are never relaxed
to permit test pages.

## Fixture-only real scanner engine

This increment is independent of the normal API: POST and Re-Test still return
SCANNER_UNAVAILABLE for valid existing specifications, without creating jobs,
IDs, history or findings. No application-service, HTTP, repository, startup or
existing API model file was changed. No public URL scanner is wired up.

`src/scanner.ts` defines AccessibilityScanner, FixtureSource, finding drafts,
execution metadata and safe domain errors without Playwright types. The adapter
in `src/scanning/playwright-scanner.ts` supports exactly page / [chromium] /
wcag_2_1_aa, with tags wcag2a, wcag2aa, wcag21a and wcag21aa. Other selections,
including historical Chrome display labels and multiple browsers, are rejected.
These are engine capabilities only; the frontend remains unchanged.

FixtureSource supplies trusted HTML bytes for an assessed URL. There is no
default source or live source implementation. The injected resolver supplies
deterministic public-address answers in tests; no external DNS is used. Existing
target/address policy runs before browser launch and no private-address exception
exists. The synthetic URL is provenance, not a fetched or navigated destination.
The adapter uses setContent at about:blank, not goto, route.fetch or route.continue.
Relative resources and origin-sensitive behavior are therefore not modeled as a
real hosted page. Fixtures must be trusted, self-contained test documents.

Each scan launches a real Chromium process/context. Offline mode, abort-all HTTP
routing, blocked service workers and closed WebSockets prevent fixture target
traffic through those APIs. Downloads are not accepted, dialogs are dismissed,
and page-created popups are closed. The axe-owned helper page remains usable.
The Playwright control connection is loopback-only; it is not target navigation.
Browser DNS resolution is disabled via a launch flag. These are fixture controls,
not a complete egress sandbox for arbitrary hostile documents.

Default engine limits are 30 seconds total and 5 seconds for document loading.
Both are constructor options for this fixture engine, not production scan limits.
Cancellation/deadline races stop awaiting an uncooperative source or engine.
Launch has its own remaining-deadline timeout; cancellation during launch is
handled when the process handle arrives. Cleanup closes browser resources and
force-kills the owned process if graceful cleanup exceeds two seconds. A source
must honor its cancellation signal to clean up its own work. No job queue exists.

`src/scanning/axe-findings.ts` maps each actual violation node into a draft:
rule help -> issue; native cat.* tag -> issueType; node/rule impact -> severity;
helpUrl -> fixReference. Drafts additionally preserve rule ID, structured target,
HTML evidence, failure summary and tags. No application IDs are allocated and
screenshotId remains null. Treat HTML as untrusted text. Incomplete checks are
reported separately by rule ID; zero violations do not establish conformance.
Actual browser and axe versions and evaluated rule IDs accompany each outcome.
No screenshots, persistence, UI taxonomy translation or API model redesign occurs.

Install the matching Chromium components before running scanner tests:

```sh
npm ci
npx playwright install chromium
npm run build
node --test test/scanner.test.mjs
```

Playwright 1.63.0 uses Chromium/Chrome for Testing 153.0.8010.12, revision 1243,
and the matching headless shell. No Firefox/WebKit is required. Package and
browser provisioning needs network access; fixture scan tests do not need public
internet or a fixture HTTP server. Tests exercise actual axe findings, a repaired
zero-violation document, tag filtering, rejected capabilities/targets, real engine
failure, fixture-load failure, cancellation, timeout and page/context/process
cleanup. Existing security and HTTP API tests remain unchanged.

Browser-wide DNS rebinding, browser egress bypass, and redirects/subresources/
frames/script traffic over uncontrolled connections remain unsolved. The pinned
connector and proxy below protect only their own connections. A network-isolated
worker and controlled egress must be designed
and verified before introducing a live transport or enabling normal API scans.
Synthetic fixture sources must never be selected from HTTP input or treated as
a production navigation bypass.

## Resolver and pinned-connection foundation (not activated)

`src/security/target-resolver.ts` supplies a real Node DNS implementation by
default and accepts a trusted resolver factory for deterministic tests. Each
assessment gets an independent resolver, queries both A and AAAA records with
an absolute DNS name, and returns all answers. Node's DNS resolver follows DNS
aliases; no OS hosts-file/search-domain fallback is used. ENODATA is accepted
as absence of one family; other errors, malformed/wrong-family answers and an
empty combined result fail closed. A separate total deadline bounds resolution,
and cancellation cancels this resolver without affecting other assessments.

`src/security/pinned-connection.ts` exposes createPinnedConnector. Its default
composition uses that resolver, the unchanged target/address policy, and Node
TCP/TLS sockets. Explicit allowed ports are still required from trusted
configuration. Resolver and dialer injection are infrastructure/test seams, not
HTTP request options; there is no private-address bypass.

Every call performs a new complete target assessment. A prohibited address in
either family rejects the whole set. The connector selects the first allowed
address only after all answers pass; it neither filters out prohibited answers
nor retries another address after connection failure. Both public IPv4 and IPv6
are supported. Literal URL targets are assessed directly without DNS.

The socket receives the assessed literal address as host and its explicit family.
Automatic family selection is disabled and a lookup guard rejects any unexpected
hostname lookup. The connected peer must match the assessed address. IPv4-mapped
peer formatting is normalized for comparison only; mapped URL/DNS targets remain
prohibited. This closes the second-resolution/rebinding race for this specific
connection primitive, assuming trustworthy resolver/dialer implementations and
network routing. It does not make a hostname permanently trusted: later calls
resolve and reassess again, and existing sockets retain their original endpoint.

HTTPS establishes TLS directly to the assessed IP. DNS targets retain their
canonical original hostname as SNI. IP targets omit DNS SNI and require a matching
IP certificate SAN. rejectUnauthorized is explicitly true; the normal Node trust
chain validation remains enabled. checkServerIdentity verifies the original
hostname/IP rather than replacing it with the selected DNS address. The connector
also checks TLS authorization and peer identity before handing off the socket.
It supplies no custom CA, permissive verifier or certificate-error bypass.

The default resolver deadline is 5 seconds; the connector's 10-second default
covers assessment plus TCP/TLS establishment. Both are configurable primitive
defaults, not finalized production scan budgets. Timeout/cancellation fails
closed and destroys any pending socket. After handoff the establishment timer
is cleared, but caller cancellation still destroys the socket until it closes.
The caller owns subsequent I/O, error handling, session timeout and final close.
Safe errors do not expose resolver, certificate or connection details.

This connector opens sockets only when explicitly invoked; nothing imports it
into the running API or scanner. It sends no HTTP request, follows no redirects,
runs no listener, and enables no browser navigation.
There is no browser-wide rebinding protection, egress firewall, worker isolation,
deployment-specific routing guarantee or redirect enforcement. TLS is performed
by this direct connector, not Chromium. The separate createPinnedTunnelConnector
now supplies raw TCP for assessed HTTPS authorities; it retains the same address,
pinning, peer, timeout and cancellation checks without starting target TLS.

Tests use injected DNS/socket/TLS seams and stub Node's default entry points;
they contact no target or external DNS service. They check complete IPv4/IPv6
assessments, mixed-answer rejection, changed answers, literal dialing without
re-resolution, safe failures, timeout/cancellation, peer mismatch, and original
hostname/IP certificate verification using Node's real identity checker. TLS
handshake/trust-chain behavior is delegated to Node with verification enabled;
these deterministic seam tests are not a live TLS handshake or network-isolation
certification. Existing fixture scanner, security and API suites remain intact.

POST /api/tests and existing-source Re-Test remain SCANNER_UNAVAILABLE, without
allocating run IDs or creating scan history/jobs/findings. Live URL scanning must
remain disabled until the enforced egress/isolation boundary and browser
integration are implemented and validated.

## Validating egress proxy component (not activated)

`src/security/egress-proxy.ts` exports createEgressProxy: a programmatic HTTP/1.1
listener bound only to 127.0.0.1. Importing it starts nothing. There is no main
entry point, npm startup command, API/worker wiring or Chromium proxy setting.
Trusted composition supplies a high-entropy 32–128 character base64url secret.
Every request requires Basic proxy credentials with username `proxy`; comparison
uses constant-time SHA-256 digests. Credentials never enter upstream headers or
error bodies. Loopback binding alone is not authorization. This local transport
and credential scheme is not a production worker/network identity boundary.

Ordinary forwarding accepts only GET/HEAD absolute-form `http:` URLs on port 80,
without a request body (Content-Length: 0 is accepted). CONNECT requires a host
and explicit port 443, including bracketed IPv6 syntax. Canonical Host must match
the target. Both paths use the unchanged target/address policy, complete A/AAAA
assessment and a pinned literal-IP connector. Prohibited or mixed answer sets,
empty answers and resolver failures cannot dial. Each new request reassesses;
there is no upstream pool, global-agent fallback, environment-proxy fallback,
second hostname lookup or retry to an unassessed address.

CONNECT returns 200 only after the raw TCP connection succeeds. It does not
start TLS, terminate TLS, MITM, verify certificates, inspect SNI, or verify an
HTTP Host inside the tunnel. A future Chromium client must own end-to-end TLS
and certificate/hostname verification. The existing direct HTTPS connector's
verification remains enabled and unchanged. A tunnel carries opaque bytes to
one assessed endpoint; it cannot police application destinations or upstream
proxy services behind that endpoint.

HTTP redirects are returned unchanged and never followed internally. A new
HTTP request or CONNECT receives fresh assessment, including changed DNS on the
same hostname. HTTPS redirects and same-tunnel requests are encrypted and not
visible here. The proxy cannot enforce encrypted redirect hops, crawl scope,
hostname coalescing or same-tunnel HTTP authority. Explicit ws:/wss: requests,
plaintext Upgrade and upstream protocol switching are rejected. Encrypted WSS
inside CONNECT cannot be detected or blocked by this component.

Node's strict HTTP parser is used, with raw-header checks before dialing.
Duplicate/missing/conflicting Host, malformed/duplicate Content-Length,
Transfer-Encoding, request trailers, Upgrade, Expect, invalid authorities/ports,
unsupported methods/forms and ambiguous framing fail closed. Connection header
nominations of critical framing/authentication fields are rejected. Forwarding
reconstructs origin-form and canonical Host, strips hop-by-hop/proxy and forwarded
identity headers, validates response framing and permits one request per client
connection. Explicit proxy-chaining request forms are unsupported. This cannot
prevent a permitted public endpoint from itself acting as a relay.

Initial component defaults (not finalized production scan budgets):

| Resource | Limit |
| --- | --- |
| Request/response headers | 16 KiB, 100 fields |
| Concurrent clients | 16 total, 8 per source address, including unauthenticated |
| Request headers | 5 seconds |
| DNS | Existing resolver's 5 seconds |
| Assessment plus connection establishment | 10 seconds |
| Idle connection | 10 seconds |
| Total request/tunnel lifetime | 60 seconds |
| HTTP response body | 16 MiB |
| Tunnel transfer | 16 MiB in each direction |
| Initial CONNECT head | 16 KiB, included in tunnel byte count |
| Tunnel half-close grace | 2 seconds |

Trusted callers may configure component limits; invalid values reject startup.
Failures return bounded generic errors before forwarding starts, or close an
active transfer. Shutdown, disconnect, timeout, cancellation and upstream failure
abort owned resolution/connections, destroy streams/sockets and clear timers.
Shutdown waits for owned client sockets to close. Backpressure is preserved.

Tests use real loopback clients with injected deterministic DNS and in-memory
upstreams; public-looking IPs are assessed but never contacted. Tests cover
HTTP/CONNECT, IPv4/IPv6, raw TCP ownership, parser/auth/policy rejection before
dialing, redirect reassessment, pinning, resource limits and cleanup. Existing
scanner tests remain fixture-only and are not connected to this proxy.

This is not browser-wide SSRF protection: there is no firewall/container/worker
isolation, direct-egress denial, UDP/QUIC/WebRTC/DNS bypass prevention, deployment
routing exclusion, or compromised-worker containment. Those boundaries and
browser integration remain required before live navigation. POST /api/tests
remains 503 SCANNER_UNAVAILABLE; existing Re-Test behavior is unchanged, with
no IDs, jobs, history or findings created by scan submission.

## Portable Linux network-policy preparation (not enforced)

`infra/scanner/network-policy.mjs` validates explicit trusted IPv4-only runtime
configuration and renders separate default-deny worker/proxy nftables rulesets.
It performs no DNS, socket, subprocess or filesystem operations, and applies no
firewall. See `infra/scanner/README.md` for required fields, exceptions, limitations
and future Linux acceptance requirements. Run its portable tests after building:

```sh
node --test test/scanner-network-policy.test.mjs
```

The proxy's trusted `bindAddress` option defaults to `127.0.0.1`. Explicit canonical
RFC1918 addresses are supported for a future dedicated namespace interface;
wildcard, hostname, public, link-local and IPv6 binding are rejected. Listener
failure never falls back to another address. Authentication and existing security
checks are unchanged. Neither config nor binding is controlled by HTTP requests.

No Linux isolation or browser-wide SSRF protection exists in this increment.
Chromium remains disconnected from the proxy, the fixture scanner is unchanged,
and valid API submissions still return 503 SCANNER_UNAVAILABLE with no run ID,
history, job or findings. No package or runtime launcher was added.
