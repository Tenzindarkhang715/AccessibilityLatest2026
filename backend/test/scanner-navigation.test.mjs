import { test } from "node:test";
import assert from "node:assert/strict";
import { navigateWithNetworkRetry } from "../dist/scanning/navigation.js";

test("network change retries once with the remaining timeout", async () => {
  const budgets = [];
  await navigateWithNetworkRetry({
    timeoutMs: 1000,
    check() {},
    async navigate(timeout) {
      budgets.push(timeout);
      if (budgets.length === 1) throw new Error("page.goto: net::ERR_NETWORK_CHANGED");
    },
  });
  assert.equal(budgets.length, 2);
  assert.ok(budgets[1] <= budgets[0]);
});

test("repeated network changes stop after two attempts", async () => {
  let calls = 0;
  const error = new Error("page.goto: net::ERR_NETWORK_CHANGED");
  await assert.rejects(navigateWithNetworkRetry({
    timeoutMs: 1000,
    check() {},
    async navigate() { calls++; throw error; },
  }), value => value === error);
  assert.equal(calls, 2);
});

test("other navigation errors are not retried", async () => {
  let calls = 0;
  const error = new Error("page.goto: net::ERR_CERT_AUTHORITY_INVALID");
  await assert.rejects(navigateWithNetworkRetry({
    timeoutMs: 1000,
    check() {},
    async navigate() { calls++; throw error; },
  }), value => value === error);
  assert.equal(calls, 1);
});

test("cancellation prevents a retry", async () => {
  let cancelled = false;
  let calls = 0;
  const error = new Error("cancelled");
  await assert.rejects(navigateWithNetworkRetry({
    timeoutMs: 1000,
    check() { if (cancelled) throw error; },
    async navigate() {
      calls++;
      cancelled = true;
      throw new Error("page.goto: net::ERR_NETWORK_CHANGED");
    },
  }), value => value === error);
  assert.equal(calls, 1);
});

test("an exhausted navigation budget prevents a retry", async () => {
  let calls = 0;
  await assert.rejects(navigateWithNetworkRetry({
    timeoutMs: 20,
    check() {},
    async navigate() {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 30));
      throw new Error("page.goto: net::ERR_NETWORK_CHANGED");
    },
  }), /ERR_NETWORK_CHANGED/);
  assert.equal(calls, 1);
});

test("retry identifies the second attempt for page replacement", async () => {
  const attempts = [];
  await navigateWithNetworkRetry({
    timeoutMs: 1000,
    check() {},
    async navigate(_timeout, attempt) {
      attempts.push(attempt);
      if (attempt === 0) throw new Error("net::ERR_NETWORK_CHANGED");
    },
  });
  assert.deepEqual(attempts, [0, 1]);
});
