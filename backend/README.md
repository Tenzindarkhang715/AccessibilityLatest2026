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

Only `GET /health` is implemented: 200 JSON `{"status":"ok"}`. It indicates
HTTP process availability, not scanner/storage readiness. Other routes return
404 JSON using the contract's error envelope. Unsupported methods on `/health`
return 405 (`Allow: GET`, code `INVALID_REQUEST`). HEAD responses have no body
as required by HTTP semantics. Health request bodies are rejected with 400;
there is no JSON body parser. Malformed HTTP returns a generic 400 JSON response
when the connection remains writable. Unexpected handler errors return generic
500 JSON without internal details.

`API_CONTRACT.md` describes future scan endpoints; they remain unimplemented and
return 404 in this skeleton. There are no route stubs, scans, persistence,
authentication, or frontend integration. TypeScript and Node type declarations
are development dependencies; the compiled server has no external runtime
dependencies. No framework choice is imposed on later API increments.
