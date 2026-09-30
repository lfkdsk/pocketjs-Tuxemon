#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)

G6_BENCH_ROOT=${GB6_BENCH_ROOT:-/var/tmp/fleet/pocket-tuxemon-gb6-quickjs} \
G6_JOURNEY="$root/data/gb6-mainline-journey.json" \
G6_EXPECTED_MAP=spyder_route3 \
G6_STATE_SHA256=bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0 \
G6_BENCH_VIEWPORT=${GB6_BENCH_VIEWPORT:-"480 272"} \
G6_SKIP_MAP_BENCH=1 \
G6_FAST_BENCH=1 \
G6_HASH_EVERY=${GB6_HASH_EVERY:-10} \
bash "$root/tools/bench-g6-quickjs.sh"
