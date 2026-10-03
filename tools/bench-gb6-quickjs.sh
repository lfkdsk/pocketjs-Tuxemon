#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# BENCH_JOURNEY overrides the tape (e.g. the zh_CN smoke journey); the
# default is the English GB6 mainline.
journey="${BENCH_JOURNEY:-$root/data/gb6-mainline-journey.json}"
# The expected terminal state is the one the tape itself records, so a
# re-pinned tape cannot leave a stale literal behind here. G6_STATE_SHA256
# still overrides it (e.g. G6_WEATHER=rain runs, whose terminal state
# intentionally differs from the sunny tape).
terminal_sha256=$(bun -e '
  const journey = JSON.parse(await Bun.file(process.argv[1]).text());
  const value = journey.terminalStateSha256;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("missing or malformed terminalStateSha256");
  }
  console.log(value);
' "$journey")

# The expected terminal map also comes from the tape, so a re-pinned tape
# (e.g. the zh_CN smoke journey, which ends in spyder_paper_town) needs no
# extra flag. G6_EXPECTED_MAP still overrides it.
terminal_map=$(bun -e '
  const journey = JSON.parse(await Bun.file(process.argv[1]).text());
  const value = journey.map;
  if (typeof value !== "string" || !value) {
    throw new Error("missing or malformed terminal map");
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
  G6_EXPECTED_MAP=${G6_EXPECTED_MAP:-$terminal_map}
  G6_STATE_SHA256=${G6_STATE_SHA256:-$terminal_sha256}
  G6_SKIP_MAP_BENCH=1
  G6_FAST_BENCH=1
  G6_HASH_EVERY=${GB6_HASH_EVERY:-10})
# The handoff bucket gate applies to the English GB6 mainline tape (which
# crosses outdoor seams). An overridden tape (BENCH_JOURNEY, e.g. the zh_CN
# smoke) may have no handoffs, so the gate is only added for the default.
if [[ -z "${BENCH_JOURNEY:-}" ]]; then
  run+=(G6_HANDOFF_BUCKETS=1)
fi
"${run[@]}" bash "$root/tools/bench-g6-quickjs.sh"
