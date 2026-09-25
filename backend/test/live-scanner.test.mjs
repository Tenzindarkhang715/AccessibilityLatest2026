import { test } from "node:test";
import assert from "node:assert/strict";

import { createLiveScanner } from "../dist/scanning/live-scanner.js";

const request = {
  url: "https://fixture.example.com/page",
  testType: "page",
  browsers: ["chromium"],
  wcagStandard: "wcag_2_1_aa",
};

function setup(overrides = {}) {
  const events = [];

  const scanner = createLiveScanner({
    targetPolicy: {
      allowedPorts: [80, 443],
      resolve: async () => ["8.8.8.8"],
    },
    proxy: {
      server: "http://10.77.0.1:3128",
      username: "proxy",
      password: "0123456789abcdef0123456789abcdef",
    },
    observe: event => events.push(event),
    ...overrides,
  });

  return { scanner, events };
}

const scan = (
  scanner,
  input = request,
  signal = new AbortController().signal,
) => scanner.scan(input, { signal });

test("invalid proxy configuration is rejected before scanning", () => {
  for (const proxy of [
    {
      server: "https://10.77.0.1:3128",
      username: "proxy",
      password: "0123456789abcdef0123456789abcdef",
    },
    {
      server: "http://user:pass@10.77.0.1:3128",
      username: "proxy",
      password: "0123456789abcdef0123456789abcdef",
    },
    {
      server: "http://10.77.0.1",
      username: "proxy",
      password: "0123456789abcdef0123456789abcdef",
    },
    {
      server: "http://10.77.0.1:3128",
      username: "wrong",
      password: "0123456789abcdef0123456789abcdef",
    },
    {
      server: "http://10.77.0.1:3128",
      username: "proxy",
      password: "",
    },
  ]) {
    assert.throws(
      () => setup({ proxy }),
      /Invalid live scanner proxy configuration/,
    );
  }
});

test("unsupported scan options are rejected before browser launch", async () => {
  const { scanner, events } = setup();

  for (const input of [
    { ...request, testType: "site" },
    { ...request, browsers: ["firefox"] },
    { ...request, browsers: ["chromium", "webkit"] },
    { ...request, browsers: [] },
    { ...request, wcagStandard: "wcag_2_2_aa" },
  ]) {
    await assert.rejects(
      scan(scanner, input),
      { code: "UNSUPPORTED_SCAN_OPTIONS" },
    );
  }

  assert.deepEqual(events, []);
});

test("cancellation before target assessment launches no browser", async () => {
  const { scanner, events } = setup();

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    scan(scanner, request, controller.signal),
    { code: "CANCELLED" },
  );

  assert.deepEqual(events, []);
});

test("invalid timeout configuration is rejected", () => {
  for (const scanTimeoutMs of [
    0,
    -1,
    Infinity,
    1.5,
    2_147_483_648,
  ]) {
    assert.throws(() => setup({ scanTimeoutMs }));
  }
});