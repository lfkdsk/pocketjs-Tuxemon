#!/usr/bin/env bash
# C1 read-path decomposition bench (QuickJS desktop host). Own G6_BENCH_ROOT
# so it never touches the official bench's scratch/target dirs. Output:
# C1_STAGE lines on stdout (redirect to a file), one per map per rep.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bench_root=${C1_BENCH_ROOT:-/var/tmp/fleet/pocket-tuxemon-c1-readpath}
export PATH="$HOME/.cargo/bin:$PATH"
scratch="$bench_root/quickjs-host"
target="$bench_root/quickjs-target"
pocketjs="$root/vendor/pocket-rpgkit/vendor/pocketjs"
bundle="$bench_root/map-bundle"

rm -rf "$scratch"
mkdir -p "$scratch"
cp -a "$pocketjs/hosts/desktop/." "$scratch/"
cp "$root/tools/c1-readpath-bench.rs" "$scratch/src/c1-readpath-bench.rs"
sed -i "s#path = \"../../engine#path = \"$pocketjs/engine#g" "$scratch/Cargo.toml"
sed -i '$a include!("c1-readpath-bench.rs");' "$scratch/src/main.rs"

rm -rf "$bundle"
mkdir -p "$bundle"
bun "$pocketjs/tools/build.ts" "$root/tools/c1-readpath-entry.tsx" \
  --framework=solid --project-root="$root" --outdir="$bundle"

CARGO_TARGET_DIR="$target" cargo test --manifest-path "$scratch/Cargo.toml" --release --no-run
binary=$(find "$target/release/deps" -maxdepth 1 -type f -name 'pocket_desktop_host-*' -perm -111 -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)

C1_DIST="$bundle" C1_MAPS="$root/dist/maps" C1_BENCH_ROOT="$bench_root" \
  "$binary" c1_readpath::readpath --ignored --exact --nocapture
