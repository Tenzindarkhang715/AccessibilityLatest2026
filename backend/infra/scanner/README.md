# Portable scanner network policy — NOT enforced

This increment validates trusted configuration and renders two independent nftables
rulesets. It creates no namespaces, interfaces, routes, processes, or firewall rules.
The separate Linux reference harness below is opt-in; there is no Chromium integration. Rendering is not proof of Linux
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

## Step 2: disconnected Linux reference harness

**Linux enforcement has not been validated on the macOS development host.**
Portable tests exercise configuration, sequencing, failure handling, identity checks,
DNS encoding and readback comparison. They are not packet-enforcement evidence.
No harness code runs on import. No API or Chromium integration exists.

Files:

- `linux-boundary.sh`: explicit opt-in entry to the Linux integration suite.
- `linux-boundary.mjs`: supervisor, fixed fixture topology, immutable configuration,
  firewall application/readback, process ownership, monitoring and teardown.
- `proxy-entry.mjs`: pipe-controlled proxy composition using the existing real DNS
  resolver and real pinned connectors. Also provides workload identity verification.
- `../../test/scanner-linux-boundary.test.mjs`: portable tests with injected failures.
- `../../test/scanner-network-isolation.test.mjs`: real Linux-only integration matrix.
- `../../test/helpers/scanner-network-fixtures.mjs`: deterministic nonrecursive DNS,
  target servers and literal-address TCP/UDP probes. Test/reference infrastructure only.

### Linux prerequisites and execution

Use a dedicated disposable Linux VM/runner, not a general development or production
host. It must contain no unrelated secrets or workload-accessible runtime sockets.
No installation or provisioning is performed by this harness. Require:

- Root supervisor, Linux network/mount/PID namespaces, IPv6 support for denial tests.
- `iproute2`, `nftables` with JSON/interval auto-merge support, `sysctl`, `mount`,
  `unshare` and `setpriv` from util-linux. `/var/run` must resolve to `/run`.
- Read-write cgroup v2 mount with memory and pids controllers already enabled at the root, and
  per-cgroup `cgroup.kill` support. The launcher needs root permission to create a dedicated parent; the mount root may be mode 0555. It does not enable root controllers.
- Existing backend dependencies/build; Node and the repository installed at
  root-owned globally traversable locations such as `/usr/bin/node` and `/opt/scanner`.
  Paths under `/root`, `/home`, `/run` or `/tmp` are rejected because workload mounts
  hide those directories. Runtime artifacts must be immutable to workload UIDs.
- Unassigned distinct UIDs/GIDs 61001 (worker), 61002 (proxy), 61003 (fixture), or
  explicitly validated alternative identities via the trusted programmatic API.

From the repository root, in that prepared Linux environment only:

```sh
SCANNER_LINUX_INTEGRATION=1 SCANNER_DISPOSABLE_LINUX=1 \
  sh backend/infra/scanner/linux-boundary.sh
```

Missing prerequisites in an explicitly requested Linux run are failures. Without
opt-in, the integration test reports NOT RUN/skipped. Opt-in on macOS fails; it does
not simulate enforcement. No Docker Desktop result certifies another Linux host.

### Topology and traffic

Each run creates fresh W (worker), P (proxy), F (fixtures), and V (rule verification)
network namespaces. Every veth endpoint is inside one of them; there is no host
bridge, host-facing interface, NAT, external port or Internet/default route.

| Link | Addresses |
| --- | --- |
| W worker0 ↔ P peer0 | 10.77.0.2/30 ↔ 10.77.0.1/30 |
| P upstream0 ↔ F fixture0 | 10.88.0.1/24 ↔ 10.88.0.2/24 |
| W escape0 ↔ F escapepeer (adversarial test route) | 10.99.0.2/30 ↔ 10.99.0.1/30 |
| Proxy listener | 10.77.0.1:3128 |
| Fixture DNS | 10.88.0.53:53 TCP/UDP |
| Wrong-resolver fixture | 10.88.0.54:53 |
| Public-looking target, confined to F | 8.8.8.8 |
| Forbidden fixtures | 10.20.0.1, 169.254.8.8, 169.254.169.254, simulated host/gateway |
| IPv6 fixture (test only) | 2001:db8:99::1 |

These are fixed disconnected TEST addresses, not production defaults. W has explicit
adversarial routes to fixtures; no extra firewall allowance is added for escape0.
The ordinary profile disables IPv6 in W/P. A separate test mode enables static IPv6
on W's adversarial link while retaining the unchanged IPv6-drop firewall, proving
packet denial independently of disabled addressing. F serves both families.
Static neighbors and equal link MTUs avoid requiring ICMP allowances or discovery.
The existing policy is not modified to accommodate fixtures.

A fresh control run omits both W and P firewall tables and proves real delivery.
It is destroyed before a protected run applies the production-rendered tables.
No protected run removes its rules. Denial tests require destination counters to
stay unchanged, corresponding output-drop counters to increase, an installed route,
and a still-bound fixture listener. Control success demonstrates listener reachability.
All target connections, including control connections, stay within the disconnected
namespaces. Host/gateway tests use simulated endpoints, never real host services.

### Lifecycle and privilege ownership

Before dropping capabilities, the trusted root shell creates a unique root-owned mode-0700
`/sys/fs/cgroup/scanner-parent-*` parent and enables its memory/pids controllers.
It passes that parent through `SCANNER_CGROUP_PARENT`, replacing any caller value.
Node validates the canonical path, ownership, mode, cgroup v2 filesystem, empty
parent process list, write access, kill support and enabled controllers. All workload
cgroups are created beneath that parent. The shell remains outside it, traps normal
exit and HUP/INT/TERM, kills remaining descendants and removes owned cgroup directories;
cleanup failure returns nonzero. SIGKILL still requires outer runner cleanup.
The invocation is unchanged. The launcher additionally uses `id`, `mktemp`, `chown`,
`chmod`, `find`, `rmdir` and `sleep`.

The shell entry bounds the supervisor to CAP_KILL, CAP_SETGID, CAP_SETUID,
CAP_SETPCAP, CAP_NET_ADMIN and CAP_SYS_ADMIN, with empty inheritable/ambient sets.
Actual effective/permitted/bounding sets are verified before setup; direct Node
invocation with unrestricted root capabilities fails. These are trusted setup
privileges only and are all removed from workloads.

The supervisor validates prerequisites/configuration, creates namespaces and down
veths, assigns static addresses/routes, checks nft syntax, applies each namespace's
rules transactionally, and verifies full JSON readback before starting workloads.
There is no cross-namespace atomic transaction; failure in either causes teardown.
The verifier namespace applies the exact renderer output to obtain kernel-normalized
reference JSON. Comparisons preserve semantic fields and ordered rules; only runtime
handles/indexes/counter values are removed, and IPv4 interval sets are normalized.
Unexpected tables, rules, defaults, verdicts or set coverage fail verification.

Workloads start behind a pipe barrier in private PID/mount namespaces with no
network operation before identity approval. The trusted setup process enters an
owned cgroup and uses setpriv to clear all capability sets, clear supplementary
groups, set distinct non-root UID/GID and enforce NoNewPrivs. The supervisor verifies
actual /proc status, namespace identities and cgroup membership. Only the supervisor
owns namespace/firewall administration. No privileged network descriptor is inherited.

Workload root filesystems are bind-remounted read-only; private mounts hide /root,
/home, /run and /tmp; /sys is bind-remounted read-only. Their fresh /proc exposes the
private PID namespace, not host process namespace handles. Environment is reduced to
PATH/LANG. No container socket or host control endpoint is deliberately provided.
These controls require the clean disposable-runner prerequisite; they are not a
complete arbitrary-host filesystem sandbox. Seccomp remains deferred.

Each workload cgroup has a 32-process and 256-MiB bound. The boundary has a two-minute
post-start lifetime; workload processes also have a three-minute watchdog. Commands,
identity handshakes, socket probes and RPC operations have bounded deadlines.
Secrets are fresh per boundary and passed through the owned stdin pipe, never argv,
network control endpoints, environment variables or logs. The proxy uses Basic auth
unchanged. The worker is assumed capable of using its own credential.

Fixture DNS and proxy start only after policy and identity verification. Authenticated
HTTP readiness originates in W and must produce both a 200 response and an observed
fixture connection. Only then are ordinary probes released. Monitoring checks rules,
routes and links, and unexpected workload exit starts teardown. DNS fixtures answer
A/AAAA over UDP/TCP, support controlled transitions and truncation/TCP fallback, and
never recurse. CONNECT tests use raw echo bytes, not TLS or Chromium navigation.

### Failure and teardown

Startup failures stop later stages. Fault tests cover actual invalid nft syntax,
failed kernel transactions and readback mismatches before identity/probe startup.
Shutdown closes the startup barrier, lowers worker links, closes workload pipes,
waits boundedly and uses owned cgroup.kill where needed. It verifies empty cgroups
and namespace process lists before removing names; host namespace/link inventories
are compared with the pre-run baseline. Cleanup failures are surfaced, not suppressed.
The same idempotent path handles normal completion, startup failure, workload failure,
SIGINT/SIGTERM and deadlines. Rules remain until namespace destruction.

Deleting a namespace name alone does not prove destruction. Cgroups/processes and
owned references must be gone first. SIGKILL or VM/kernel failure can defeat in-process
cleanup; the disposable runner must provide outer VM/cgroup cleanup. No reboot recovery
or production supervisor is supplied here.

### Scope and remaining acceptance gate

The Linux suite covers the reviewed authentication, HTTP/CONNECT, DNS reassessment,
IPv4/IPv6/mapped-address, private/metadata/host, UDP/DNS/QUIC/STUN, privilege mutation,
proxy outage, setup failure and cleanup cases using real Linux primitives.
It must actually pass on a prepared Linux runner before enforcement is claimed.
Linux/kernel/nft compatibility, filesystem restrictions and resource cleanup remain
unverified until then. This is not hostile-browser containment, production-host
isolation, a Chromium seccomp profile, or production-ready browser-wide SSRF protection.
CONNECT remains opaque; permitted public endpoints could themselves relay traffic.
API submission and Re-Test guards and the fixture-only scanner remain unchanged.
