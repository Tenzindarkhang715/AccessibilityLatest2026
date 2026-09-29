import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../infra/scanner/production-workload.mjs", import.meta.url);

async function source() {
  return readFile(sourceUrl, "utf8");
}

test("production workload maps sh -c positional arguments to uid, node and entry script", async () => {
  const text = await source();
  assert.match(
    text,
    /exec setpriv --reuid="\$1" --regid="\$1"[\s\S]*-- "\$2" "\$3"/,
  );
  assert.doesNotMatch(text, /--reuid="\$2"/);
  assert.doesNotMatch(text, /-- "\$3" "\$4"/);
});

test("production workload removes owned cgroups as empty directories", async () => {
  const text = await source();
  assert.match(text, /\brmdir\(group\)/);
  assert.match(text, /\brmdir\(peer\.group\)/);
  assert.doesNotMatch(text, /\brm\(group(?:\)|,)/);
  assert.doesNotMatch(text, /\brm\(peer\.group(?:\)|,)/);
  assert.doesNotMatch(text, /recursive\s*:\s*true[\s\S]{0,120}(?:group|peer\.group)/);
});

test("production workload diagnostics are bounded and do not write ad-hoc tmp logs", async () => {
  const text = await source();
  assert.match(text, /stderrBytes >= 8192/);
  assert.doesNotMatch(text, /production-workload-stderr\.log/);
  assert.doesNotMatch(text, /appendFileSync/);
});


test("production browser has bounded Chromium-sized cgroup limits while proxy stays narrow", async () => {
  const text = await source();
  assert.match(text, /label === "production-browser"/);
  assert.match(text, /browserWorkload \? "256\\n" : "32\\n"/);
  assert.match(text, /browserWorkload \? "1073741824\\n" : "268435456\\n"/);
});


test("production browser enters the scanner AppArmor profile before no-new-privs", async () => {
  const text = await source();
  assert.match(text, /if \[ "\$4" = "browser" \]; then/);
  assert.match(
    text,
    /exec aa-exec -p accessibility-scanner-chrome --[\s\S]{0,240}setpriv[\s\S]{0,240}--no-new-privs/,
  );
  assert.match(text, /browserWorkload \? "browser" : "proxy"/);
  assert.doesNotMatch(text, /--no-sandbox/);
  assert.doesNotMatch(text, /--disable-setuid-sandbox/);
});

test("scanner AppArmor policy grants userns only through the dedicated Chrome profile", async () => {
  const policy = await readFile(
    new URL("../infra/scanner/accessibility-scanner-chrome.apparmor", import.meta.url),
    "utf8",
  );
  assert.match(policy, /profile accessibility-scanner-chrome \/opt\/scanner-runtime\/chromium-1243\/chrome-linux-arm64\/chrome flags=\(unconfined\)/);
  assert.match(policy, /^\s*userns,\s*$/m);
  assert.doesNotMatch(policy, /capability,/);
});

test("production workload protects the deployment tree without self-binding the filesystem root", async () => {
  const text = await source();

  assert.doesNotMatch(text, /mount --bind \/ \//);
  assert.match(
    text,
    /const deploymentRoot = resolve\(dirname\(script\), "\.\.\/\.\.\/\.\."\)/,
  );
  assert.match(text, /mount --bind "\$5" "\$5" \|\| exit 23/);
  assert.match(text, /mount -o remount,bind,ro "\$5" \|\| exit 24/);
  assert.match(
    text,
    /browserWorkload \? "browser" : "proxy",\s*deploymentRoot,/,
  );
});

test("production boundary sends explicit proxy startup configuration", async () => {
  const text = await readFile(
    new URL("../infra/scanner/production-linux-boundary.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    text,
    /proxyAddress: this\.topology\.proxyWorkerAddress\.split\("\/"\)\[0\]/,
  );
  assert.match(
    text,
    /proxyPort: this\.topology\.proxyPort/,
  );
  assert.match(
    text,
    /resolverAddress: this\.network\.resolverAddress/,
  );
  assert.doesNotMatch(
    text,
    /op: "start",\s*\.\.\.this\.policy/,
  );
});
