import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createApp } from "../dist/app.js";
import { MemoryTestRepository } from "../dist/memory-test-repository.js";
import { TestService } from "../dist/test-service.js";

const specification = { url: "https://example.com", testType: "page",
  browsers: ["Chrome 137 (Latest)"], wcagStandard: "wcag_2_1_aa" };

async function withServer(repository, callback) {
  const server = createApp(new TestService(repository));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = "GET", body) {
    const response = await fetch(base + path, { method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  try { await callback(request, base); }
  finally { const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed; }
}

test("empty application rejects scans without creating history and survives errors", async () => {
  const repository = new MemoryTestRepository();
  await withServer(repository, async (request, base) => {
    assert.deepEqual(await request("/health"), { status: 200, body: { status: "ok" } });
    const submit = await request("/api/tests", "POST", specification);
    assert.equal(submit.status, 503); assert.equal(submit.body.error.code, "SCANNER_UNAVAILABLE");
    for (const body of [{}, [], null, { ...specification, status: "completed" },
      { ...specification, browsers: [] }, { ...specification, wcagStandard: "wrong" },
      { ...specification, testType: "wrong" }, { ...specification, url: "not a url" }]) {
      assert.equal((await request("/api/tests", "POST", body)).status, 400);
    }
    assert.equal((await request("/api/tests", "POST", { ...specification, url: "file:///tmp/test" })).status, 422);
    const badJson = await fetch(base + "/api/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    assert.equal(badJson.status, 400); assert.equal((await badJson.json()).error.code, "INVALID_REQUEST");
    const oversized = await fetch(base + "/api/tests", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...specification, url: "https://example.com/" + "x".repeat(17_000) }) });
    assert.equal(oversized.status, 400); assert.equal((await oversized.json()).error.code, "INVALID_REQUEST");
    const unsupported = await fetch(base + "/api/tests", { method: "POST", body: "text" });
    assert.equal(unsupported.status, 400); await unsupported.text();
    // Even private-looking destinations cannot cause acceptance or any network scan.
    assert.equal((await request("/api/tests", "POST", { ...specification, url: "http://127.0.0.1" })).status, 503);
    assert.deepEqual(await request("/api/tests"), { status: 200, body: { tests: [] } });
    for (const path of ["/api/tests/missing", "/api/tests/missing/results", "/unknown"]) {
      assert.equal((await request(path)).status, 404);
    }
    assert.equal((await request("/api/tests/missing", "DELETE")).status, 404);
    assert.equal((await request("/api/tests/missing/retests", "POST")).status, 404);
    for (const query of ["limit=0", "limit=-1", "limit=1.5", "limit=9007199254740992", "limit=abc", "limit=1&limit=2", "unknown=1"]) {
      assert.equal((await request("/api/tests?" + query)).status, 400);
    }
    for (const size of [101, 1000, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(await request(`/api/tests?limit=${size}`), { status: 200, body: { tests: [] } });
    }
    assert.equal((await request("/health", "POST")).status, 405);
    assert.deepEqual(await repository.recent(10), []);
    assert.equal((await request("/health")).status, 200);
  });
});

test("existing-record routes use only isolated fixtures, with no invented findings", async () => {
  const repository = new MemoryTestRepository();
  // Unit/integration fixture only: never loaded by index.ts or public submissions.
  const id = randomUUID();
  const record = { test: { ...specification, id, status: "failed",
    submittedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z",
    retestOfId: null, failure: { code: "TEST_FIXTURE", message: "Isolated test fixture." } }, findings: [] };
  await repository.insert(record);
  record.test.url = "https://changed.example";
  assert.equal((await repository.get(id)).test.url, specification.url);
  const copy = await repository.get(id); copy.test.browsers.push("changed");
  assert.equal((await repository.get(id)).test.browsers.length, 1);
  await assert.rejects(repository.insert(record));
  await withServer(repository, async request => {
    assert.equal((await request("/api/tests")).body.tests.length, 1);
    assert.equal((await request(`/api/tests/${id}`)).body.test.id, id);
    assert.deepEqual(await request(`/api/tests/${id}/results`), { status: 200,
      body: { testId: id, status: "failed", findings: [], nextCursor: null } });
    assert.equal((await request(`/api/tests/${id}/results?cursor=invalid`)).status, 400);
    for (const size of [101, 1000, Number.MAX_SAFE_INTEGER]) {
      assert.equal((await request(`/api/tests/${id}/results?limit=${size}`)).status, 200);
    }
    assert.equal((await request(`/api/tests/${id}/results?limit=9007199254740992`)).status, 400);
    const beforeRetest = await repository.get(id);
    const retest = await request(`/api/tests/${id}/retests`, "POST");
    assert.equal(retest.status, 503);
    assert.equal(retest.body.error.code, "SCANNER_UNAVAILABLE");
    assert.deepEqual(await repository.get(id), beforeRetest);
    assert.equal((await repository.recent(10)).length, 1);
    assert.deepEqual(await request(`/api/tests/${id}`, "DELETE"), { status: 204, body: null });
    assert.equal((await request(`/api/tests/${id}`, "DELETE")).status, 404);
    assert.equal((await request(`/api/tests/${id}/results`)).status, 404);
    assert.equal((await request("/health")).status, 200);
  });
  assert.deepEqual(await new MemoryTestRepository().recent(10), []);
});

test("run statuses, ordering, and independent re-test deletion use empty test fixtures", async () => {
  const repository = new MemoryTestRepository();
  for (const [index, status] of ["pending", "in_progress", "completed"].entries()) {
    await repository.insert({ test: { ...specification, id: `fixture-${index}`, status,
      submittedAt: "2026-01-01T00:00:00.000Z",
      completedAt: status === "completed" ? "2026-01-01T00:00:01.000Z" : null,
      retestOfId: index ? "fixture-0" : null, failure: null }, findings: [] });
  }
  assert.deepEqual((await repository.recent(2)).map(r => r.id), ["fixture-0", "fixture-1"]);
  await withServer(repository, async request => {
    for (const [index, status] of ["pending", "in_progress", "completed"].entries()) {
      assert.deepEqual((await request(`/api/tests/fixture-${index}/results`)).body,
        { testId: `fixture-${index}`, status, findings: [], nextCursor: null });
    }
    assert.equal((await request("/api/tests/fixture-0", "DELETE")).status, 204);
    assert.equal((await request("/api/tests/fixture-1")).status, 200);
  });
});

test("repository failures produce safe JSON 500 responses", async () => {
  const repository = new MemoryTestRepository();
  repository.recent = async () => { throw new Error("private storage details"); };
  await withServer(repository, async request => {
    assert.deepEqual(await request("/api/tests"), { status: 500,
      body: { error: { code: "INTERNAL_ERROR", message: "Internal server error." } } });
    assert.equal((await request("/health")).status, 200);
  });
});

test("history limits above 100 return all requested stored records", async () => {
  const repository = new MemoryTestRepository();
  for (let index = 0; index < 125; index++) {
    await repository.insert({ test: { ...specification, id: `fixture-${String(index).padStart(3, "0")}`,
      status: "completed", submittedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z", retestOfId: null, failure: null }, findings: [] });
  }
  await withServer(repository, async request => {
    assert.equal((await request("/api/tests")).body.tests.length, 10);
    for (const size of [101, 125, 1000, Number.MAX_SAFE_INTEGER]) {
      const response = await request(`/api/tests?limit=${size}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.tests.length, Math.min(size, 125));
    }
  });
});
