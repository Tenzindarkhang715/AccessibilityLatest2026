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
```

Tests start and stop isolated loopback servers. Existing-run checks insert marked
fixtures into test-only repositories; they never seed the application server or
invent accessibility findings. The tests cover errors, no-write submission and
re-test behavior, record reads/deletion, storage isolation, and process health.

TypeScript and Node declarations remain development dependencies. `ipaddr.js`
2.5.0 is the sole external runtime dependency, used for IP parsing/CIDR matching
in the isolated security policy. No browser or accessibility engine is installed.
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
No production resolver is supplied in this increment.

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
remain open. No redirect or DNS-rebinding protection is claimed for live traffic:
there is no live scanning traffic, and these connection controls are not built.

Tests inject fixed resolver answers and manually controlled cancellation. They
exercise allowed/prohibited IPv4/IPv6, URL normalization, credentials, hostnames,
DNS failures/mixed answers, changed DNS and redirects without external DNS or
target requests. Service-level guards also assert no network/process/ID-generation
calls or writes during unavailable submission/Re-Test. Existing HTTP tests retain
their temporary loopback API servers; production target rules are never relaxed
to permit test pages.
