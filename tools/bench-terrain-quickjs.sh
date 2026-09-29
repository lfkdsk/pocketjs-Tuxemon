#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
scratch=/var/tmp/fleet/task-1806/quickjs-host
target=/var/tmp/fleet/task-1806/quickjs-target
dist=${G5_DIST:-/var/tmp/fleet/task-1806/dist}
pocketjs="$root/vendor/pocket-rpgkit/vendor/pocketjs"

rm -rf "$scratch"
mkdir -p "$scratch"
cp -a "$pocketjs/hosts/desktop/." "$scratch/"
cp "$root/tools/terrain-quickjs-bench.rs" "$scratch/src/terrain-quickjs-bench.rs"
sed -i "s#path = \"../../engine#path = \"$pocketjs/engine#g" "$scratch/Cargo.toml"
sed -i '$a include!("terrain-quickjs-bench.rs");' "$scratch/src/main.rs"

CARGO_TARGET_DIR="$target" cargo test --manifest-path "$scratch/Cargo.toml" --release --no-run
binary=$(find "$target/release/deps" -maxdepth 1 -type f -name 'pocket_desktop_host-*' -perm -111 -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)

for viewport in "480 272" "960 544"; do
  read -r width height <<<"$viewport"
  G5_DIST="$dist" G5_BENCH_W="$width" G5_BENCH_H="$height" \
    G5_BENCH_REPS="${G5_BENCH_REPS:-3}" G5_BENCH_STABLE="${G5_BENCH_STABLE:-600}" \
    "$binary" terrain_quickjs_bench::all_terrain_maps --ignored --exact --nocapture
done
