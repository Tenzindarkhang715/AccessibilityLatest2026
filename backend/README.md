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
```

Tests start and stop isolated loopback servers. Existing-run checks insert marked
fixtures into test-only repositories; they never seed the application server or
invent accessibility findings. The tests cover errors, no-write submission and
re-test behavior, record reads/deletion, storage isolation, and process health.

TypeScript and Node declarations remain development dependencies; there are no
external runtime dependencies. `API_CONTRACT.md` is the original design document;
its opening "contract only" implementation-status note predates these increments.
Its 202 accepted-scan lifecycle remains future behavior; the contracted 503 guard
is the only available submission outcome for valid requests in this increment.
