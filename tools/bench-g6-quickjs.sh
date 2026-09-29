#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
scratch=/var/tmp/fleet/1833/quickjs-host
target=/var/tmp/fleet/1833/quickjs-target
pocketjs="$root/vendor/pocket-rpgkit/vendor/pocketjs"

rm -rf "$scratch"
mkdir -p "$scratch"
cp -a "$pocketjs/hosts/desktop/." "$scratch/"
cp "$root/tools/g6-quickjs-bench.rs" "$scratch/src/g6-quickjs-bench.rs"
sed -i "s#path = \"../../engine#path = \"$pocketjs/engine#g" "$scratch/Cargo.toml"
sed -i '$a include!("g6-quickjs-bench.rs");' "$scratch/src/main.rs"

CARGO_TARGET_DIR="$target" cargo test --manifest-path "$scratch/Cargo.toml" --release --no-run
binary=$(find "$target/release/deps" -maxdepth 1 -type f -name 'pocket_desktop_host-*' -perm -111 -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)

for viewport in "480 272" "960 544"; do
  read -r width height <<<"$viewport"
  G6_DIST="$root/dist/linux-app" G6_JOURNEY="$root/data/g6-journey.json" \
    G6_BENCH_W="$width" G6_BENCH_H="$height" \
    "$binary" g6_quickjs_bench::journey --ignored --exact --nocapture
done
