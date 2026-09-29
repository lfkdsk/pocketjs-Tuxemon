#!/bin/sh
# findings/scout-S1/run-all.sh — regenerate every Scout S1 artifact.
# Reads TUXEMON_SRC (default /var/tmp/tuxemon-src, pinned 9e6258ff) and the
# kit at vendor/pocket-rpgkit. Run from the repository root.
set -eu
d=findings/scout-S1
bun $d/census.ts > $d/census.json
bun $d/shapes.ts > $d/shapes.json
bun $d/patterns.ts > $d/patterns.json
bun $d/vars.ts > $d/vars.json
bun $d/mainline.ts > $d/mainline.json
for c in spyder xero water; do bun $d/sim.ts $c > $d/sim-$c.json; done
bun $d/mapping.ts
bun $d/proto.ts
for hz in 60 30 20; do HZ=$hz bun $d/smoke.ts > /dev/null; done
echo "scout-S1: all artifacts regenerated"
