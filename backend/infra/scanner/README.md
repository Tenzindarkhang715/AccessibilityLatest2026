# Portable scanner network policy — NOT enforced

This increment validates trusted configuration and renders two independent nftables
rulesets. It creates no namespaces, interfaces, routes, processes, or firewall rules.
There is no Linux launcher or Chromium integration. Rendering is not proof of Linux
network isolation or browser-wide SSRF protection. Live scanning remains disabled.

Import `validateNetworkConfig` or `renderNetworkPolicy` from `network-policy.mjs`.
Supply all fields; unknown fields and unsupported profiles fail closed:

- `profile`: exactly `ipv4-only`.
- `workerAddress`, `proxyAddress`: distinct canonical RFC1918 IPv4 literals for
  the dedicated link; actual subnet/interface ownership is a future Linux check.
- `resolverAddress`: distinct canonical public or RFC1918 unicast IPv4 literal.
  Loopback, link-local, metadata and special-use public ranges are rejected.
- `proxyPort`: integer 1024–65535, permitting unprivileged listener operation.
- `workerInterface`, `proxyWorkerInterface`, `proxyUpstreamInterface`: explicit
  safe Linux interface names; never `lo`. Proxy interfaces must be distinct.
- `deploymentExclusions`: nonempty list of canonical IPv4 network CIDRs for host,
  gateway, management, provider and other deployment-specific infrastructure.
  Values are copied, deduplicated and sorted. A catch-all exclusion is rejected.

No production addresses are supplied by default. The trusted deployer must provide
an accurate exclusion inventory: a pure renderer cannot discover omitted host or
provider addresses. DNS answers, target allowlists and bypass flags are not accepted.
The output object contains `worker` and `proxy` strings, for separate namespaces.
It does not flush global rules or implement NAT. Future application must use fresh
namespaces, validate nft syntax with the installed version, atomically install and
read back rules, verify addressing/routes and privileges, then start workloads.

Each input/output/forward chain defaults to drop and explicitly drops IPv6 and
invalid connection state. Worker output permits only TCP to the exact proxy tuple
on its dedicated interface; input allows only established replies. There is no UDP,
DNS, loopback, IPv6 or forwarding allowance. Proxy input permits worker TCP only on
its dedicated interface. DNS TCP/UDP 53 is permitted only to the configured resolver
on the upstream interface, with established replies. This infrastructure exception
precedes address exclusions; it does not authorize HTTP(S) to that resolver.

Proxy target TCP 80/443 follows conservative IPv4 exclusions mirrored from the
existing address policy plus deployment exclusions and worker/proxy/resolver IPs.
Replies are restricted to the upstream interface and established TCP source ports
80/443, after source exclusions. There is no generic established/related allowance,
ICMP exception, automatic helper, or forwarding permission. PMTU behavior and any
necessary narrowly scoped ICMP exceptions remain Linux integration work; this
conservative policy may fail closed on paths needing such traffic.

The future runtime must also configure links/neighbors, disable redirects/source
routing/forwarding and IPv6, and prevent workload privilege changes. None exists
here. Complete A/AAAA assessment remains unchanged even though rendered transport
is IPv4-only; IPv6-only targets will not gain an IPv4 fallback or assessment bypass.

The proxy component now accepts a trusted `bindAddress`: default `127.0.0.1`, or
an explicit canonical RFC1918 address. Hostnames, wildcard, public, IPv6 and
link-local binding are rejected. It binds exactly the supplied address without
fallback. Authentication remains mandatory. Do not publish the listener externally.
Only trusted composition may set this option; no HTTP request can control it.

Portable tests assert configuration and rendered intent, not actual kernel behavior.
The separate Linux integration increment must prove packet denial, startup failure,
namespace ownership, proxy reachability and cleanup before browser integration.
No production firewall enforcement is claimed by these tests.
