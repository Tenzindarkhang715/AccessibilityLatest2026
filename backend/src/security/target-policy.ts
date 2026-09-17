import { isIP } from "node:net";
import { assessAddress } from "./address-policy.js";

export class TargetPolicyError extends Error {
  constructor(public readonly code: "TARGET_NOT_ALLOWED" | "RESOLUTION_FAILED" | "CANCELLED") {
    super(code === "CANCELLED" ? "Target assessment cancelled."
      : code === "RESOLUTION_FAILED" ? "Target resolution failed." : "Target is not allowed.");
  }
}

/** Trusted infrastructure seam. Must supply ALL A/AAAA answers, follow aliases,
 * avoid search-domain expansion, and reject partial/failed lookups. No concrete
 * resolver is supplied or connected to the API in this increment.
 */
export type TargetResolver = (hostname: string, signal: AbortSignal) => Promise<readonly string[]>;

export interface TargetPolicyOptions {
  readonly resolve: TargetResolver;
  // Required explicitly: this module does not finalize production port policy.
  readonly allowedPorts: readonly number[];
  // Additional deployment-specific service/metadata names and their subdomains.
  readonly deniedHostnames?: readonly string[];
}

export interface TargetAssessment {
  readonly kind: "assessment-only";
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
  readonly addresses: readonly string[];
  // An assessment is NEVER permission to let a browser independently resolve.
  readonly requiresConnectionEnforcement: true;
}

const deniedNames = ["localhost", "local", "internal", "home.arpa", "test", "invalid",
  "example", "onion", "metadata.google.internal", "metadata.goog", "instance-data.ec2.internal"];

function denied(): never { throw new TargetPolicyError("TARGET_NOT_ALLOWED"); }
function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) throw new TargetPolicyError("CANCELLED");
}

function parseTarget(raw: string, ports: readonly number[], extraNames: readonly string[]): URL {
  // Reject URL parser repairs that obscure authority interpretation.
  if (typeof raw !== "string" || /[\u0000-\u0020\u007f\\]/.test(raw)
      || !/^https?:\/\//i.test(raw)) denied();
  let url: URL;
  try { url = new URL(raw); } catch { return denied(); }
  const authority = raw.slice(raw.indexOf("://") + 3).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@") || url.username || url.password
      || !["http:", "https:"].includes(url.protocol)) denied();
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!ports.includes(port)) denied();
  let hostname = url.hostname;
  if (hostname.startsWith("[")) hostname = hostname.slice(1, -1);
  if (!isIP(hostname)) {
    hostname = hostname.replace(/\.$/, "").toLowerCase();
    if (hostname.length > 253 || !hostname.includes(".")
        || hostname.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) denied();
    if ([...deniedNames, ...extraNames].some(name => hostname === name || hostname.endsWith(`.${name}`))) denied();
    url.hostname = hostname;
  }
  return url;
}

/** Policy evaluation only, no fetch, sockets, browser or built-in DNS resolver.
 * Caller supplies a deadline-bound signal. Cancellation settles even if the
 * resolver ignores its signal; actual resolver resource cleanup is its duty.
 */
export function createTargetPolicy(options: TargetPolicyOptions) {
  const ports = [...options.allowedPorts];
  if (!ports.length || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("An explicit valid target port policy is required.");
  }
  const extraNames = (options.deniedHostnames ?? []).map(name => {
    const normalized = name.toLowerCase().replace(/\.$/, "");
    if (!normalized || normalized.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new Error("Invalid denied hostname configuration.");
    }
    return normalized;
  });
  const resolve = options.resolve;

  async function assess(raw: string, signal: AbortSignal): Promise<TargetAssessment> {
    checkCancellation(signal);
    const url = parseTarget(raw, ports, extraNames);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let answers: readonly string[];
    if (isIP(hostname)) answers = [hostname];
    else {
      let onAbort: () => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new TargetPolicyError("CANCELLED"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        answers = await Promise.race([Promise.resolve().then(() => {
          checkCancellation(signal);
          return resolve(hostname, signal);
        }), cancelled]);
      } catch {
        checkCancellation(signal);
        throw new TargetPolicyError("RESOLUTION_FAILED");
      } finally { signal.removeEventListener("abort", onAbort); }
    }
    checkCancellation(signal);
    if (!Array.isArray(answers) || answers.length === 0) throw new TargetPolicyError("RESOLUTION_FAILED");
    const addresses = new Set<string>();
    for (const answer of answers) {
      const result = assessAddress(answer);
      if (!result.allowed) denied();
      addresses.add(result.address);
    }
    return Object.freeze({ kind: "assessment-only", url: url.href, hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      addresses: Object.freeze([...addresses]), requiresConnectionEnforcement: true });
  }

  /** Evaluate each redirect afresh, including same-host DNS changes. Does not
   * follow it, authorize crawl scope, cap hops, or enforce the actual connection.
   */
  async function assessRedirect(location: string, previousUrl: string, signal: AbortSignal) {
    checkCancellation(signal);
    const previous = parseTarget(previousUrl, ports, extraNames);
    if (!location || /[\u0000-\u0020\u007f\\]/.test(location)) denied();
    let next: URL;
    try { next = new URL(location, previous); } catch { return denied(); }
    // Reject empty userinfo too, before URL serialization can erase it.
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*@/i.test(location)) denied();
    return assess(next.href, signal);
  }
  return Object.freeze({ assess, assessRedirect });
}
