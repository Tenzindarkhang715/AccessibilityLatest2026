import process from "node:process";
import { pathToFileURL } from "node:url";

import { createScannerIpcClient } from "../../dist/scanner-ipc.js";

const socketPath = process.env.SCANNER_SOCKET_PATH;
const target = process.env.SCANNER_SMOKE_TARGET;

if (!socketPath || !socketPath.startsWith("/") || !target) {
  console.error(
    "Usage: SCANNER_SOCKET_PATH=/run/.../supervisor.sock " +
    "SCANNER_SMOKE_TARGET=https://public.example/ node infra/scanner/production-smoke.mjs",
  );
  process.exitCode = 2;
} else {
  const client = createScannerIpcClient({
    socketPath,
    responseTimeoutMs: 120_000,
  });
  const controller = new AbortController();

  try {
    const outcome = await client.scan({
      url: target,
      testType: "page",
      browsers: ["chromium"],
      wcagStandard: "wcag_2_1_aa",
    }, { signal: controller.signal });

    if (!outcome || !Array.isArray(outcome.findings)) {
      throw new Error("Scanner returned an invalid smoke-test outcome");
    }
    console.log(JSON.stringify({
      ok: true,
      target,
      findings: outcome.findings.length,
      evaluatedRules: outcome.evaluatedRuleIds?.length ?? 0,
      incompleteRules: outcome.incompleteRuleIds?.length ?? 0,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code ?? "ENGINE_FAILURE",
      message: error?.message ?? "Scanner smoke test failed",
    }, null, 2));
    process.exitCode = 1;
  }
}
