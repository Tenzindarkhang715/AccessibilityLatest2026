import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const infra = new URL("../infra/scanner/", import.meta.url);

test("production supervisor launcher is packaged and location independent", async () => {
  const url = new URL("supervisor-launcher.sh", infra);
  const text = await readFile(url, "utf8");
  const mode = (await stat(url)).mode & 0o777;
  assert.equal(mode, 0o755);
  assert.match(text, /BASE_DIR=.*dirname/);
  assert.match(text, /SUPERVISOR_ENTRY="\$BASE_DIR\/supervisor-entry\.mjs"/);
  assert.doesNotMatch(text, /\/opt\/scanner\/infra\/scanner\/supervisor-entry\.mjs/);
  assert.doesNotMatch(text, /\/opt\/accessibility-scanner-validation\/infra\/scanner\/supervisor-entry\.mjs/);
  assert.match(text, /command -v aa-exec/);
  assert.match(text, /AppArmor must be enabled/);
  assert.match(text, /trap cleanup EXIT/);
  assert.match(text, /trap 'exit 0' TERM/);
  assert.doesNotMatch(text, /trap 'exit 143' TERM/);
  assert.doesNotMatch(text, /--no-sandbox/);
});

test("validation systemd unit uses canonical backend scanner paths", async () => {
  const text = await readFile(new URL("accessibility-scanner-validation.service", infra), "utf8");
  assert.match(text, /ConditionPathExists=\/opt\/accessibility-scanner-validation\/backend\/infra\/scanner\/supervisor-entry\.mjs/);
  assert.match(text, /ExecStart=\/opt\/accessibility-scanner-validation\/backend\/infra\/scanner\/supervisor-launcher\.sh/);
  assert.doesNotMatch(text, /\/opt\/accessibility-scanner-validation\/infra\/scanner\//);
  assert.match(text, /NoNewPrivileges=no/);
});
