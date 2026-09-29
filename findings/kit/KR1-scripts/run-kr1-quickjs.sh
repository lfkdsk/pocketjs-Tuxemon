#!/usr/bin/env bash
# Build and compare the same 263-map Tuxemon project as an inline document and
# as a ProjectShell backed by synchronous per-map data.fs reads. Each line
# beginning KR1_ is emitted by PocketJS's real desktop QuickJS host.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
source_app=${1:?usage: run-kr1-quickjs.sh <S3 app dir> <new scratch dir>}
scratch=${2:?usage: run-kr1-quickjs.sh <S3 app dir> <new scratch dir>}
if [[ -e "$scratch" ]]; then
  echo "scratch path already exists: $scratch" >&2
  exit 2
fi

bun "$root/findings/scripts/kr1-prepare-bench.ts" "$source_app" "$scratch"
mkdir -p "$scratch/dist/inline" "$scratch/dist/sharded"
for variant in inline sharded; do
  bun "$root/vendor/pocketjs/tools/build.ts" "$scratch/apps/$variant/main.tsx" \
    --project-root="$scratch/apps/$variant" --outdir="$scratch/dist/$variant" \
    >"$scratch/build-$variant.log"
done

cp -a "$root/vendor/pocketjs/hosts/desktop/." "$scratch/quickjs-host/"
cp "$root/findings/scripts/kr1-quickjs-bench.rs" "$scratch/quickjs-host/src/kr1-quickjs-bench.rs"
pocketjs="$root/vendor/pocketjs"
sed -i "s#path = \"../../engine#path = \"$pocketjs/engine#g" "$scratch/quickjs-host/Cargo.toml"
printf '\ninclude!("kr1-quickjs-bench.rs");\n' >>"$scratch/quickjs-host/src/main.rs"

target="$scratch/quickjs-target"
CARGO_TARGET_DIR="$target" cargo test --manifest-path "$scratch/quickjs-host/Cargo.toml" --release --no-run
binary=$(find "$target/release/deps" -maxdepth 1 -type f -name 'pocket_desktop_host-*' -perm -111 -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
results="$scratch/results.txt"
: >"$results"
for mode in boot journey; do
  reps=3
  [[ "$mode" == boot ]] && reps=5
  for variant in inline sharded; do
    for run in $(seq 1 "$reps"); do
      echo "KR1_RUN mode=$mode variant=$variant run=$run" | tee -a "$results"
      KR1_MODE="$mode" KR1_VARIANT="$variant" KR1_DIST="$scratch/dist/$variant" \
        KR1_DATA_ROOT="$scratch/data" KR1_JOURNEY="$scratch/g6-journey.json" \
        "$binary" kr1_quickjs_bench::measure --ignored --exact --nocapture 2>&1 \
        | grep '^KR1_' | tee -a "$results"
    done
  done
done
echo "KR1_RESULTS $results"
