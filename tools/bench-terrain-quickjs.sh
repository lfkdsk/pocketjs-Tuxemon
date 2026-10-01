#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bench_root=${TERRAIN_BENCH_ROOT:-${TMPDIR:-/tmp}/pocket-tuxemon-terrain-bench}
scratch="$bench_root/quickjs-host"
target="$bench_root/quickjs-target"
dist=${G5_DIST:-$bench_root/dist}
pocketjs="$root/vendor/pocket-rpgkit/vendor/pocketjs"
terrain_stream="$root/dist/terrain-stream"

if [[ ! -d "$terrain_stream" ]]; then
  echo "missing $terrain_stream (run bun run gen-assets first)" >&2
  exit 1
fi

rm -rf "$scratch"
mkdir -p "$scratch"
cp -a "$pocketjs/hosts/desktop/." "$scratch/"
cp "$root/tools/terrain-quickjs-bench.rs" "$scratch/src/terrain-quickjs-bench.rs"
sed -i "s#path = \"../../engine#path = \"$pocketjs/engine#g" "$scratch/Cargo.toml"
sed -i '$a include!("terrain-quickjs-bench.rs");' "$scratch/src/main.rs"

CARGO_TARGET_DIR="$target" cargo test --manifest-path "$scratch/Cargo.toml" --release --no-default-features --no-run
binary=$(find "$target/release/deps" -maxdepth 1 -type f -name 'pocket_desktop_host-*' -perm -111 -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)

for viewport in "480 272" "960 544"; do
  read -r width height <<<"$viewport"
  data="$bench_root/data-${width}x${height}"
  rm -rf "$data"
  store="$data/dev.lfkdsk.pocket-tuxemon-terrain-bench/data"
  mkdir -p "$store"
  cp -a "$terrain_stream" "$store/terrain-stream"
  G5_DIST="$dist" G5_DATA_ROOT="$data" G5_BENCH_W="$width" G5_BENCH_H="$height" \
    G5_BENCH_REPS="${G5_BENCH_REPS:-3}" G5_BENCH_STABLE="${G5_BENCH_STABLE:-600}" \
    "$binary" terrain_quickjs_bench::all_terrain_maps --ignored --exact --nocapture
  rm -rf "$data"
done
