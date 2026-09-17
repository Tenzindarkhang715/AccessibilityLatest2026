import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import type { TargetResolver } from "./target-policy.js";

export class ResolutionError extends Error {
  constructor(public readonly code: "RESOLUTION_FAILED" | "RESOLUTION_TIMEOUT" | "CANCELLED") {
    super(`Target resolution failed: ${code}.`);
  }
}

/** Trusted DNS seam, not a request option. One independent instance per lookup. */
export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  cancel(): void;
}

export function createTargetResolver(options: {
  timeoutMs?: number;
  createResolver?: () => DnsResolver;
} = {}): TargetResolver {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error("Invalid resolver timeout.");
  }
  const factory = options.createResolver ?? (() => new Resolver({ timeout: timeoutMs, tries: 1 }));
  return async (hostname, signal) => {
    if (signal.aborted) throw new ResolutionError("CANCELLED");
    // Absolute DNS names avoid search suffixes; URL canonicalization occurs in
    // target-policy. No hosts-file fallback, caching or public-address selection.
    const name = hostname.toLowerCase().replace(/\.$/, "");
    if (isIP(name) || name.length > 253 || !name.includes(".")
        || name.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new ResolutionError("RESOLUTION_FAILED");
    }
    let resolver: DnsResolver;
    try { resolver = factory(); } catch { throw new ResolutionError("RESOLUTION_FAILED"); }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    const stop = () => { try { resolver.cancel(); } catch { /* Preserve safe error. */ } };
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => { reject(new ResolutionError("CANCELLED")); stop(); };
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { reject(new ResolutionError("RESOLUTION_TIMEOUT")); stop(); }, timeoutMs);
        if (signal.aborted) abort();
      });
      const family = async (version: 4 | 6): Promise<string[]> => {
        if (signal.aborted) throw new ResolutionError("CANCELLED");
        try {
          const values = await (version === 4 ? resolver.resolve4(`${name}.`) : resolver.resolve6(`${name}.`));
          if (!Array.isArray(values) || values.some(value => typeof value !== "string"
              || value.includes("%") || isIP(value) !== version)) throw new ResolutionError("RESOLUTION_FAILED");
          return values;
        } catch (error) {
          // ENODATA means this family has no records. NXDOMAIN, SERVFAIL,
          // timeouts and all other failures must not become partial success.
          if ((error as NodeJS.ErrnoException)?.code === "ENODATA") return [];
          throw new ResolutionError("RESOLUTION_FAILED");
        }
      };
      const answers = await Promise.race([Promise.all([family(4), family(6)]), interrupted]);
      if (signal.aborted) throw new ResolutionError("CANCELLED");
      const all = [...new Set(answers.flat())];
      if (!all.length) throw new ResolutionError("RESOLUTION_FAILED");
      return all;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      stop();
    }
  };
}
