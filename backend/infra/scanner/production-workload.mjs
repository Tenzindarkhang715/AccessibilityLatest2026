import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rmdir,
  writeFile,
} from "node:fs/promises";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { verifyIdentity } from "./proxy-entry.mjs";
import { scannerErrorWire } from "./linux-boundary.mjs";

const CGROUP_SETUP = `set -eu
printf '0' > "$1/cgroup.procs" || exit 21
shift
exec "$@"
`;

const WORKLOAD_SETUP = `set -u
mount --make-rprivate / || exit 22
mount --bind "$5" "$5" || exit 23
mount -o remount,bind,ro "$5" || exit 24
mount -t tmpfs -o mode=700,nosuid,nodev tmpfs /root || exit 25
mount -t tmpfs -o mode=700,nosuid,nodev tmpfs /home || exit 26
mount -t tmpfs -o mode=755,nosuid,nodev tmpfs /run || exit 27
mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs /tmp || exit 28
mount --bind /sys /sys || exit 29
mount -o remount,bind,ro /sys || exit 30
if [ "$4" = "browser" ]; then
  # Enter the scanner-specific AppArmor profile BEFORE setting no_new_privs.
  # Ubuntu restricts unprivileged user namespaces for unconfined processes;
  # Chromium needs userns for its sandbox.  Entering the narrow profile first
  # lets Chromium keep its sandbox while the workload still runs as UID 61001,
  # with no capabilities and NoNewPrivs=1.
  exec aa-exec -p accessibility-scanner-chrome -- \
    setpriv --reuid="$1" --regid="$1" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs -- "$2" "$3"
fi
exec setpriv --reuid="$1" --regid="$1" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs -- "$2" "$3"
exit 31
`;

const waitBounded = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Lifecycle deadline")), ms);
  promise.then(
    value => {
      clearTimeout(timer);
      resolve(value);
    },
    error => {
      clearTimeout(timer);
      reject(error);
    },
  );
});

class PipePeer {
  constructor(child, onFailure, label) {
    this.child = child;
    this.next = 0;
    this.requests = new Map();
    this.buffer = "";
    this.dead = false;
    this.expectedExit = false;

    this.identity = new Promise((resolve, reject) => {
      this.identify = resolve;
      this.rejectIdentity = reject;
    });
    this.identity.catch(() => {});

    this.exited = new Promise(resolve => {
      child.once("close", (code, signal) => {
        this.dead = true;
        resolve(code);
        const status = signal ? `signal ${signal}` : `code ${code}`;
        const error = new Error(`Owned workload exited (${label}, ${status})`);
        this.rejectIdentity(error);
        for (const pending of this.requests.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.requests.clear();
        if (!this.expectedExit) onFailure(error);
      });
    });

    child.on("error", error => {
      this.rejectIdentity(error);
      onFailure(error);
    });
    child.stdin.on("error", () => {});

    // Workload stderr is trusted-server diagnostics only. Keep it bounded and
    // single-line so a failed browser/proxy cannot flood or forge journal lines.
    let stderrBytes = 0;
    child.stderr.on("data", bytes => {
      if (stderrBytes >= 8192) return;
      const remaining = 8192 - stderrBytes;
      const chunk = Buffer.from(bytes).subarray(0, remaining);
      stderrBytes += chunk.length;
      const diagnostic = chunk.toString("utf8")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim();
      if (diagnostic) console.error(`[scanner-workload:${label}] ${diagnostic}`);
    });

    child.stdout.on("data", bytes => {
      this.buffer += bytes;
      if (this.buffer.length > 131072) {
        onFailure(new Error("Workload output limit"));
        return;
      }

      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.event === "identity") {
            this.identify(message.value);
            continue;
          }

          const request = this.requests.get(message.id);
          if (!request) throw new Error("Unexpected response");
          this.requests.delete(message.id);
          clearTimeout(request.timer);

          if (message.error) {
            const error = new Error(message.error);
            const wire = scannerErrorWire(message.code);
            if (wire) error.code = wire.code;
            request.reject(error);
          } else {
            request.resolve(message.value);
          }
        } catch {
          onFailure(new Error("Invalid workload protocol"));
        }
      }
    });
  }

  call(message, timeoutMs = 5000) {
    if (this.dead) return Promise.reject(new Error("Workload stopped"));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("Workload operation deadline"));
      }, timeoutMs);
      this.requests.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...message, id }) + "\n");
    });
  }
}

function productionGroupPath(parent, token, index) {
  if (
    typeof parent !== "string" ||
    !/^\/sys\/fs\/cgroup\/scanner-parent-[A-Za-z0-9]{12}$/.test(parent) ||
    !/^[a-f0-9]{12}$/.test(token) ||
    !Number.isSafeInteger(index) ||
    index < 0
  ) {
    throw new Error("Invalid production workload cgroup path");
  }
  return `${parent}/scanner-production-${token}-${index}`;
}

async function verifyMembers(group, launcherPid, uid) {
  const members = (await readFile(`${group}/cgroup.procs`, "utf8"))
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!members.includes(String(launcherPid)) || members.length < 2) {
    throw new Error("Production workload cgroup membership mismatch");
  }

  let unprivileged = 0;
  for (const pidText of members) {
    const status = await readFile(`/proc/${pidText}/status`, "utf8");
    if (Number(pidText) === launcherPid) continue;

    if (
      !new RegExp(`^Uid:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}$`, "m").test(status) ||
      !new RegExp(`^Gid:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}$`, "m").test(status) ||
      !/^NoNewPrivs:\s+1$/m.test(status) ||
      ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].some(
        name => !new RegExp(`^${name}:\\s+0+$`, "m").test(status),
      )
    ) {
      throw new Error("Production workload privilege readback failed");
    }
    unprivileged += 1;
  }

  if (unprivileged < 1) {
    throw new Error("Production workload process missing");
  }
}

export class ProductionWorkloads {
  constructor({
    cgroupParent,
    token,
    namespaces,
    workerUid = 61001,
    proxyUid = 61002,
  }) {
    this.cgroupParent = cgroupParent;
    this.token = token;
    this.namespaces = namespaces;
    this.workerUid = workerUid;
    this.proxyUid = proxyUid;
    this.nextGroup = 0;
    this.owned = new Set();
    this.failure = null;
  }

  noteFailure(error) {
    if (!this.failure) this.failure = error;
  }

  async spawnPeer(namespace, uid, script, label) {
    const deploymentRoot = resolve(dirname(script), "../../..");
    const group = productionGroupPath(
      this.cgroupParent,
      this.token,
      this.nextGroup++,
    );

    await mkdir(group, { mode: 0o700 });
    this.owned.add(group);
    // Chromium needs substantially more tasks/threads and memory than the
    // long-lived proxy. Keep both bounded, but size the browser cgroup for a
    // real headless Chromium process tree instead of failing at ~32 tasks.
    const browserWorkload = label === "production-browser";
    await writeFile(`${group}/pids.max`, browserWorkload ? "256\n" : "32\n");
    await writeFile(
      `${group}/memory.max`,
      browserWorkload ? "1073741824\n" : "268435456\n",
    );

    const child = spawn(
      "/bin/sh",
      [
        "-c",
        CGROUP_SETUP,
        "scanner-cgroup",
        group,
        "ip",
        "netns",
        "exec",
        namespace,
        "unshare",
        "--mount",
        "--pid",
        "--fork",
        "--mount-proc",
        "/bin/sh",
        "-c",
        WORKLOAD_SETUP,
        "scanner-workload",
        String(uid),
        process.execPath,
        script,
        browserWorkload ? "browser" : "proxy",
        deploymentRoot,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
          LANG: "C",
        },
      },
    );

    const peer = new PipePeer(
      child,
      error => this.noteFailure(error),
      label,
    );
    peer.group = group;

    try {
      const proof = await waitBounded(peer.identity, 5000);
      verifyIdentity(proof, uid, uid);
      await verifyMembers(group, child.pid, uid);
      return peer;
    } catch (error) {
      peer.expectedExit = true;
      try {
        await writeFile(`${group}/cgroup.kill`, "1\n");
      } catch {}
      try {
        await waitBounded(peer.exited, 5000);
      } catch {}
      try {
        await rmdir(group);
      } catch {}
      this.owned.delete(group);
      throw error;
    }
  }

  async stopPeer(peer) {
    if (!peer) return;
    peer.expectedExit = true;

    try {
      if (!peer.dead) {
        await writeFile(`${peer.group}/cgroup.kill`, "1\n");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    if (!peer.dead) {
      await waitBounded(peer.exited, 5000);
    }

    try {
      await rmdir(peer.group);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.owned.delete(peer.group);
  }

  async close() {
    const errors = [];
    for (const group of [...this.owned].reverse()) {
      try {
        await writeFile(`${group}/cgroup.kill`, "1\n");
      } catch (error) {
        if (error?.code !== "ENOENT") errors.push(error);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 25));

    for (const group of [...this.owned].reverse()) {
      try {
        await rmdir(group);
        this.owned.delete(group);
      } catch (error) {
        if (error?.code !== "ENOENT") errors.push(error);
      }
    }

    if (errors.length) {
      throw new AggregateError(errors, "Production workload cleanup failed");
    }
  }
}
