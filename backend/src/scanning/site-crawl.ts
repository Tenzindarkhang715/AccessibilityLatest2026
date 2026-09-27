export const MAX_SITE_PAGES = 25;
export const MAX_SITE_DEPTH = 3;

export interface CrawlEntry {
  readonly url: string;
  readonly depth: number;
}

export function shouldScanAnotherPage(testType: "page" | "site", scannedPages: number): boolean {
  return scannedPages < (testType === "site" ? MAX_SITE_PAGES : 1);
}

export function canDiscoverLinks(testType: "page" | "site", depth: number): boolean {
  return testType === "site" && depth < MAX_SITE_DEPTH;
}

export function discoverSameHostLinks(options: {
  hrefs: readonly string[];
  rootHostname: string;
  depth: number;
  queued: Set<string>;
  remainingSlots: number;
}): CrawlEntry[] {
  const discovered: CrawlEntry[] = [];
  if (options.remainingSlots <= 0) return discovered;

  for (const href of options.hrefs) {
    if (discovered.length >= options.remainingSlots) break;
    let candidate: URL;
    try {
      candidate = new URL(href);
    } catch {
      continue;
    }
    candidate.hash = "";
    if (!["http:", "https:"].includes(candidate.protocol)
        || candidate.hostname.toLowerCase() !== options.rootHostname) continue;
    const canonical = candidate.href;
    if (options.queued.has(canonical)) continue;
    options.queued.add(canonical);
    discovered.push({ url: canonical, depth: options.depth + 1 });
  }
  return discovered;
}
