#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bench_root=${G6_BENCH_ROOT:-/var/tmp/fleet/pocket-tuxemon-quickjs}
scratch="$bench_root/quickjs-host"
target="$bench_root/quickjs-target"
pocketjs="$root/vendor/pocket-rpgkit/vendor/pocketjs"
map_bundle="$bench_root/map-bundle"
map_report=${G6_MAP_REPORT:-$root/findings/G7-map-first-visits.tsv}

rm -rf "$scratch"
mkdir -p "$scratch"
cp -a "$pocketjs/hosts/desktop/." "$scratch/"
cp "$root/tools/g6-quickjs-bench.rs" "$scratch/src/g6-quickjs-bench.rs"
sed -i "s#path = \"../../engine#path = \"$pocketjs/engine#g" "$scratch/Cargo.toml"
sed -i '$a include!("g6-quickjs-bench.rs");' "$scratch/src/main.rs"

rm -rf "$map_bundle"
mkdir -p "$map_bundle"
bun "$pocketjs/tools/build.ts" "$root/tools/map-benchmark-entry.tsx" \
  --framework=solid --project-root="$root" --outdir="$map_bundle"

CARGO_TARGET_DIR="$target" cargo test --manifest-path "$scratch/Cargo.toml" --release --no-run
binary=$(find "$target/release/deps" -maxdepth 1 -type f -name 'pocket_desktop_host-*' -perm -111 -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)

for viewport in "480 272" "960 544"; do
  read -r width height <<<"$viewport"
  state="$bench_root/state-${width}x${height}.json"
  G6_DIST="$root/dist/linux-app" G6_JOURNEY="$root/data/g6-journey.json" \
    G6_MAPS="$root/dist/maps" G6_BENCH_ROOT="$bench_root" \
    G6_STATE_OUT="$state" \
    G6_BENCH_W="$width" G6_BENCH_H="$height" \
    "$binary" g6_quickjs_bench::journey --ignored --exact --nocapture
  actual=$(sha256sum "$state" | cut -d' ' -f1)
  # Complete post-Billie state, including persistent party/history, the
  # extension RNG cursor, and K4's persistent shop-stock banks.
  # Shared economy removes ext.inventory/ext.money and credits battle rewards
  # to SessionState.gold, changing only the pinned terminal state shape/value.
  expected=7fdc130b0b90fece5f3814d886dad0a4513417ce31e2d59019dd0ce310d8dd64
  test "$actual" = "$expected"
  echo "STATE viewport=${width}x${height} canonical_sha256=$actual"
done

G6_MAP_BENCH_DIST="$map_bundle" G6_MAPS="$root/dist/maps" \
  G6_BENCH_ROOT="$bench_root" G6_MAP_REPORT="$map_report" \
  "$binary" g6_quickjs_bench::map_first_visits --ignored --exact --nocapture
echo "MAP_REPORT $map_report"
