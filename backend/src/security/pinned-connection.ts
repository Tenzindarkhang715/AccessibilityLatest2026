import net, { type Socket, type NetConnectOpts } from "node:net";
import tls, { type ConnectionOptions, type TLSSocket } from "node:tls";
import ipaddr from "ipaddr.js";
import { createTargetPolicy, type TargetPolicyOptions } from "./target-policy.js";
import { createTargetResolver } from "./target-resolver.js";

export class PinnedConnectionError extends Error {
  constructor(public readonly code: "CONNECTION_FAILED" | "CONNECTION_TIMEOUT" | "CANCELLED") {
    super(`Pinned connection failed: ${code}.`);
  }
}

/** Trusted test/composition seam. Never expose dialers through user requests. */
export interface ConnectionDialers {
  tcp(options: NetConnectOpts): Socket;
  tls(options: ConnectionOptions): TLSSocket;
}

export interface PinnedConnection {
  socket: Socket;
  address: string;
  hostname: string;
  port: number;
  protocol: "http:" | "https:";
}

/** Opens a socket only; no HTTP request, redirects, proxy or browser integration.
 * Each call reassesses the target. No caller-supplied assessment is trusted.
 */
export type PinnedConnectorOptions = Omit<TargetPolicyOptions, "resolve"> & {
  resolve?: TargetPolicyOptions["resolve"];
  timeoutMs?: number;
  dialers?: ConnectionDialers;
};

export function createPinnedConnector(options: PinnedConnectorOptions) {
  return connector(options, false);
}

/** Raw TCP for an assessed HTTPS authority. TLS belongs to the tunnel client.
 * This is a separate trusted composition API, never a request-controlled flag.
 */
export function createPinnedTunnelConnector(options: PinnedConnectorOptions) {
  const connect = connector(options, true);
  return (url: string, signal: AbortSignal) => {
    if (!/^https:\/\//i.test(url)) return Promise.reject(new PinnedConnectionError("CONNECTION_FAILED"));
    return connect(url, signal);
  };
}

function connector(options: PinnedConnectorOptions, tunnel: boolean) {
  const policy = createTargetPolicy({ ...options, resolve: options.resolve ?? createTargetResolver() });
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error("Invalid connection timeout.");
  }
  const dialers = options.dialers ?? { tcp: net.connect, tls: tls.connect };

  return async (url: string, signal: AbortSignal): Promise<PinnedConnection> => {
    const controller = new AbortController();
    const cancel = () => controller.abort(new PinnedConnectionError("CANCELLED"));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new PinnedConnectionError("CONNECTION_TIMEOUT")), timeoutMs);
    let socket: Socket | undefined;
    let handedOff = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      const assessment = await policy.assess(url, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      const address = assessment.addresses[0];
      const protocol = new URL(assessment.url).protocol as "http:" | "https:";
      // Do not offer a hostname or alternate addresses to the network stack.
      // Family auto-selection/retry cannot bypass the complete assessment.
      const connectOptions: NetConnectOpts = { host: address, port: assessment.port,
        family: net.isIP(address), autoSelectFamily: false,
        lookup: () => { throw new Error("Hostname lookup forbidden for pinned connection."); } };
      const secured = protocol === "https:" && !tunnel;
      socket = secured ? dialers.tls({ ...connectOptions,
        servername: net.isIP(assessment.hostname) ? undefined : assessment.hostname,
        rejectUnauthorized: true,
        checkServerIdentity: (_hostname, cert) => tls.checkServerIdentity(assessment.hostname, cert),
      }) : dialers.tcp(connectOptions);
      const ownedSocket = socket;
      await new Promise<void>((resolve, reject) => {
        const failed = () => reject(new PinnedConnectionError("CONNECTION_FAILED"));
        const aborted = () => { ownedSocket.destroy(); reject(controller.signal.reason); };
        const ready = () => {
          try {
            if (controller.signal.aborted) return aborted();
            // Only peer comparison unwraps mapped IPv4. Target policy itself
            // continues rejecting mapped IPv6 targets and DNS answers.
            if (!ownedSocket.remoteAddress || ipaddr.process(ownedSocket.remoteAddress).toString()
                !== ipaddr.process(address).toString()) return failed();
            if (secured) {
              const secureSocket = ownedSocket as TLSSocket;
              if (!secureSocket.authorized || tls.checkServerIdentity(assessment.hostname,
                secureSocket.getPeerCertificate())) return failed();
            }
            resolve();
          } catch { failed(); }
        };
        controller.signal.addEventListener("abort", aborted, { once: true });
        ownedSocket.once(secured ? "secureConnect" : "connect", ready);
        // Keep an error listener through close to avoid unhandled errors during
        // teardown. Callers should attach their own listener after handoff.
        ownedSocket.on("error", failed);
        ownedSocket.once("close", () => {
          controller.signal.removeEventListener("abort", aborted);
          ownedSocket.removeListener("error", failed);
          ownedSocket.removeListener(secured ? "secureConnect" : "connect", ready);
          cleanup();
          failed();
        });
        if (controller.signal.aborted) aborted();
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      clearTimeout(timer);
      // Signal continues owning the socket until close; establishment timeout
      // ends here. Caller must bound the subsequent protocol/session lifetime.
      handedOff = true;
      return { socket, address, hostname: assessment.hostname, port: assessment.port, protocol };
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (socket) throw new PinnedConnectionError("CONNECTION_FAILED");
      // Preserve policy errors; hide raw synchronous dialer errors.
      if (error instanceof Error && "code" in error
          && ["TARGET_NOT_ALLOWED", "RESOLUTION_FAILED", "CANCELLED"].includes(String(error.code))) throw error;
      throw new PinnedConnectionError("CONNECTION_FAILED");
    } finally {
      if (!handedOff) { socket?.destroy(); cleanup(); }
    }
  };
}
