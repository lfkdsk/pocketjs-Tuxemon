#!/bin/bash
# QuickJS bench matrix for the S2 prototype (desktop host Runtime, headless).
bin=$(ls -t /var/tmp/fleet/task-1783/target/release/deps/pocket_desktop_host-* | grep -v '\.d$' | head -1)
out=/var/tmp/fleet/task-1783/bench
for vp in "480 272" "960 544"; do
  set -- $vp
  for mode in chunks nodes; do
    for map in classic_gym_pyra taba_town buddha_mountain; do
      map2=buddha_mountain; [ "$map" = buddha_mountain ] && map2=taba_town
      POCKETJS_DIST=/var/tmp/fleet/task-1783/dist BENCH_W=$1 BENCH_H=$2 S2_MODE=$mode S2_MAP=$map S2_MAP2=$map2 BENCH_REPS=${BENCH_REPS:-3} \
        timeout 900 "$bin" s2_bench::s2_render_bench --ignored --exact --nocapture 2>&1 \
        | grep -E "^(BOOT|CASE|STATE|SWITCH|END|thread|error)" > "$out/$mode-$map-$1x$2.log"
      echo "done $mode $map $1x$2"
    done
  done
done
