import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SITE_DEPTH,
  MAX_SITE_PAGES,
  canDiscoverLinks,
  discoverSameHostLinks,
  shouldScanAnotherPage,
} from "../dist/scanning/site-crawl.js";

test("page scans stop after one page while site scans are bounded to 25 pages", () => {
  assert.equal(shouldScanAnotherPage("page", 0), true);
  assert.equal(shouldScanAnotherPage("page", 1), false);
  assert.equal(MAX_SITE_PAGES, 25);
  assert.equal(shouldScanAnotherPage("site", 24), true);
  assert.equal(shouldScanAnotherPage("site", 25), false);
});

test("site link discovery stops at depth three", () => {
  assert.equal(MAX_SITE_DEPTH, 3);
  assert.equal(canDiscoverLinks("page", 0), false);
  assert.equal(canDiscoverLinks("site", 0), true);
  assert.equal(canDiscoverLinks("site", 2), true);
  assert.equal(canDiscoverLinks("site", 3), false);
});

test("site discovery keeps same-host HTTP(S), removes fragments and deduplicates", () => {
  const queued = new Set(["https://fixture.example.com/"]);
  const links = discoverSameHostLinks({
    hrefs: [
      "https://fixture.example.com/about#team",
      "https://fixture.example.com/about#other",
      "http://fixture.example.com/contact",
      "https://other.example.net/outside",
      "mailto:test@fixture.example.com",
      "not a url",
    ],
    rootHostname: "fixture.example.com",
    depth: 1,
    queued,
    remainingSlots: 10,
  });
  assert.deepEqual(links, [
    { url: "https://fixture.example.com/about", depth: 2 },
    { url: "http://fixture.example.com/contact", depth: 2 },
  ]);
});

test("site discovery never queues more links than remaining scan slots", () => {
  const queued = new Set(["https://fixture.example.com/"]);
  const links = discoverSameHostLinks({
    hrefs: Array.from({ length: 30 }, (_, index) => `https://fixture.example.com/page-${index}`),
    rootHostname: "fixture.example.com",
    depth: 0,
    queued,
    remainingSlots: 4,
  });
  assert.equal(links.length, 4);
  assert.equal(queued.size, 5);
});
