import assert from "node:assert/strict";
import test from "node:test";

import { workloadErrorCode } from "../infra/scanner/proxy-entry.mjs";

test("worker protocol preserves allow-listed scanner failure codes", () => {
  for (const code of [
    "UNSUPPORTED_SCAN_OPTIONS",
    "TARGET_NOT_ALLOWED",
    "CANCELLED",
    "SCAN_TIMEOUT",
    "ENGINE_FAILURE",
    "FIXTURE_LOAD_FAILED",
  ]) {
    assert.equal(workloadErrorCode({ code }), code);
  }
});

test("worker protocol strips unknown and malformed failure codes", () => {
  assert.equal(workloadErrorCode({ code: "INTERNAL_SECRET_FAILURE" }), null);
  assert.equal(workloadErrorCode({ code: "" }), null);
  assert.equal(workloadErrorCode({ code: 123 }), null);
  assert.equal(workloadErrorCode(new Error("private internal detail")), null);
  assert.equal(workloadErrorCode(null), null);
  assert.equal(workloadErrorCode(undefined), null);
});
