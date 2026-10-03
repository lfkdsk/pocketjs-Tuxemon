#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
journey="$root/data/gb6-mainline-journey.json"
# The expected terminal state is the one the tape itself records, so a
# re-pinned tape cannot leave a stale literal behind here.
terminal_sha256=$(bun -e '
  const journey = JSON.parse(await Bun.file(process.argv[1]).text());
  const value = journey.terminalStateSha256;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("missing or malformed terminalStateSha256");
  }
  console.log(value);
' "$journey")

run=(env)
if [[ -n ${GB6_BENCH_VIEWPORT:-} ]]; then
  run+=(G6_BENCH_VIEWPORT="$GB6_BENCH_VIEWPORT")
else
  # The handoff gate is release evidence at both supported logical sizes.
  run+=(-u G6_BENCH_VIEWPORT)
fi
run+=(
  G6_BENCH_ROOT=${GB6_BENCH_ROOT:-${TMPDIR:-/tmp}/pocket-tuxemon-gb6-quickjs}
  G6_JOURNEY="$journey"
  G6_EXPECTED_MAP=spyder_route3
  G6_STATE_SHA256="$terminal_sha256"
  G6_SKIP_MAP_BENCH=1
  G6_FAST_BENCH=1
  G6_HANDOFF_BUCKETS=1
  G6_HASH_EVERY=${GB6_HASH_EVERY:-10})
"${run[@]}" bash "$root/tools/bench-g6-quickjs.sh"
