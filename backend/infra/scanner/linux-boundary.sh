#!/bin/sh
set -eu
# Opt-in and prerequisites are enforced again by the Node harness before mutation.
if [ "$(uname -s)" != Linux ] || [ "${SCANNER_LINUX_INTEGRATION:-}" != 1 ] || [ "${SCANNER_DISPOSABLE_LINUX:-}" != 1 ]; then
  echo 'Requires SCANNER_LINUX_INTEGRATION=1 SCANNER_DISPOSABLE_LINUX=1 in a disposable Linux runner.' >&2
  exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec setpriv --inh-caps=-all --ambient-caps=-all \
  --bounding-set=-all,+kill,+setgid,+setuid,+setpcap,+net_admin,+sys_admin \
  node --test "$script_dir/../../test/scanner-network-isolation.test.mjs"
