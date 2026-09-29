#!/bin/sh
set -eu

if [ "$(uname -s)" != Linux ] || \
   [ "${SCANNER_LINUX_INTEGRATION:-}" != 1 ] || \
   [ "${SCANNER_DISPOSABLE_LINUX:-}" != 1 ]; then
  echo 'Requires SCANNER_LINUX_INTEGRATION=1 SCANNER_DISPOSABLE_LINUX=1 in a disposable Linux runner.' >&2
  exit 1
fi

[ "$(id -u)" = 0 ] || { echo 'Root launcher required.' >&2; exit 1; }

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
unset SCANNER_CGROUP_PARENT

BASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SUPERVISOR_ENTRY="$BASE_DIR/supervisor-entry.mjs"
[ -r "$SUPERVISOR_ENTRY" ] || { echo 'Supervisor entry is missing.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node is required.' >&2; exit 1; }
command -v aa-exec >/dev/null 2>&1 || { echo 'aa-exec is required for the Chromium sandbox.' >&2; exit 1; }
[ -r /sys/module/apparmor/parameters/enabled ] || { echo 'AppArmor is required.' >&2; exit 1; }
grep -q '^Y' /sys/module/apparmor/parameters/enabled || { echo 'AppArmor must be enabled.' >&2; exit 1; }

parent=
child=
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || :; wait "$child" 2>/dev/null || :; fi
  if [ -n "$parent" ]; then
    if ! printf '1' > "$parent/cgroup.kill"; then result=1; fi
    attempts=0
    while [ "$attempts" -lt 50 ]; do
      if find "$parent" -depth -type d -exec rmdir -- {} + 2>/dev/null; then break; fi
      attempts=$((attempts + 1)); sleep 0.1
    done
    if [ -d "$parent" ]; then echo "Failed to remove owned cgroup parent: $parent" >&2; result=1; fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 0' TERM

parent=$(mktemp -d /sys/fs/cgroup/scanner-parent-XXXXXXXXXXXX)
chown 0:0 "$parent"
chmod 700 "$parent"
printf '+memory +pids' > "$parent/cgroup.subtree_control"
SCANNER_CGROUP_PARENT=$parent
export SCANNER_CGROUP_PARENT

setpriv \
  --inh-caps=-all \
  --ambient-caps=-all \
  --bounding-set=-all,+kill,+setgid,+setuid,+setpcap,+net_admin,+sys_admin \
  /usr/bin/node "$SUPERVISOR_ENTRY" &
child=$!
result=0
wait "$child" || result=$?
child=
exit "$result"
