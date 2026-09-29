import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../infra/scanner/browser-entry.mjs", import.meta.url);

test("browser workload performs URL admission without DNS capability", async () => {
  const text = await readFile(sourceUrl, "utf8");
  assert.doesNotMatch(text, /node:dns\/promises/);
  assert.doesNotMatch(text, /createTargetResolver/);
  assert.match(text, /Browser target policy must not resolve DNS/);
  assert.match(text, /observe: event =>/);
});
