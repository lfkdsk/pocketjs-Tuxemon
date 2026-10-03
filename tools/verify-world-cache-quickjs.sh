#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bench_root=${WORLD_CACHE_BENCH_ROOT:-${TMPDIR:-/tmp}/pocket-tuxemon-world-cache}
scratch="$bench_root/quickjs-host"
target="$bench_root/quickjs-target"
pocketjs="$root/vendor/pocket-rpgkit/vendor/pocketjs"
app_dist=${WORLD_CACHE_DIST:-$root/dist/linux-app}

for artifact in \
  "$app_dist/pocket-tuxemon.js" \
  "$app_dist/pocket-tuxemon.pak" \
  "$root/dist/project-shell.json"; do
  if [[ ! -f "$artifact" ]]; then
    echo "verify-world-cache: missing build artifact: $artifact" >&2
    echo "run 'bun tools/desktop.ts --build-only' first" >&2
    exit 1
  fi
done

map_manifest_hash=$(bun -e '
  const project = JSON.parse(await Bun.file(process.argv[1]).text());
  const value = project.mapManifestHash;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("missing or malformed mapManifestHash");
  }
  console.log(value);
' "$root/dist/project-shell.json")
if ! grep -Fq "$map_manifest_hash" "$app_dist/pocket-tuxemon.js"; then
  echo "verify-world-cache: desktop bundle is stale relative to project-shell.json" >&2
  echo "run 'bun tools/desktop.ts --build-only' first" >&2
  exit 1
fi

rm -rf "$scratch"
mkdir -p "$scratch"
cp -a "$pocketjs/hosts/desktop/." "$scratch/"
cp "$root/tools/g6-quickjs-bench.rs" "$scratch/src/g6-quickjs-bench.rs"
sed -i "s#path = \"../../engine#path = \"$pocketjs/engine#g" "$scratch/Cargo.toml"
sed -i '$a include!("g6-quickjs-bench.rs");' "$scratch/src/main.rs"

CARGO_TARGET_DIR="$target" cargo test \
  --manifest-path "$scratch/Cargo.toml" \
  --release --no-default-features --no-run
binary=$(find "$target/release/deps" -maxdepth 1 -type f \
  -name 'pocket_desktop_host-*' -perm -111 -printf '%T@ %p\n' \
  | sort -nr | head -1 | cut -d' ' -f2-)

if [[ -n ${WORLD_CACHE_VIEWPORT:-} ]]; then
  viewports=("$WORLD_CACHE_VIEWPORT")
else
  viewports=("480 272" "960 544")
fi
for viewport in "${viewports[@]}"; do
  read -r width height <<<"$viewport"
  G6_WORLD_CACHE_STRESS=1 \
    G6_DIST="$app_dist" \
    G6_MAPS="$root/dist/maps" \
    G6_BATTLE="$root/dist/battle" \
    G6_ANIMATED="$root/dist/animated" \
    G6_NPC_SRC="$root/dist/npc-src" \
    G6_TERRAIN_STREAM="$root/dist/terrain-stream" \
    G6_BENCH_ROOT="$bench_root" \
    G6_BENCH_W="$width" \
    G6_BENCH_H="$height" \
    "$binary" g6_quickjs_bench::world_cache_stress --ignored --exact --nocapture
done
