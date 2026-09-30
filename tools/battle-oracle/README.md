# Tuxemon battle oracle

These tools run the pinned Tuxemon engine headlessly, replace Python's random
module with the battle reducer's mulberry32 stream, and generate the committed
Spyder differential corpus. Normal TypeScript tests only read the committed
database and gzip trace; Python and pygame are generation-time dependencies.

## Python environment

Use Tuxemon commit `9e6258ff` and Python 3.10 or newer. The default source
location is `/var/tmp/tuxemon-src`; set `TUXEMON_SRC` to override it.

```sh
python3 -m venv /var/tmp/fleet/gb2-oracle-venv
/var/tmp/fleet/gb2-oracle-venv/bin/pip install -r /var/tmp/tuxemon-src/requirements.txt
```

The pinned source requirements include pygame-ce, pydantic, and PyYAML. SDL's
dummy video and audio drivers are selected by `boot.py`, so no display or audio
device is needed.

## Regenerate

Run these commands from the repository root:

```sh
mkdir -p /var/tmp/fleet/gb2-oracle
/var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/extract_spyder_parties.py tools/battle-oracle/spyder-parties.json
TUXEMON_SRC=/var/tmp/tuxemon-src /var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/export_data.py tools/battle-oracle/tuxemon-battle.json
TUXEMON_SRC=/var/tmp/tuxemon-src /var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/generate_spyder.py tools/battle-oracle/spyder-parties.json tests/goldens/gb2-spyder-traces.ndjson.gz 20
TUXEMON_SRC=/var/tmp/tuxemon-src /var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/generate_spawn.py data/battle-db.json tests/goldens/gb4-monster-spawns.json.gz
TUXEMON_SRC=/var/tmp/tuxemon-src /var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/generate_gb3.py tests/goldens/gb3-rules.json.gz
TUXEMON_SRC=/var/tmp/tuxemon-src /var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/generate_gb3_progression.py data/battle-db.json tests/goldens/gb3-progression.json.gz
TUXEMON_SRC=/var/tmp/tuxemon-src /var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/generate_gb3_double.py tools/battle-oracle/spyder-parties.json tests/goldens/gb3-double-traces.ndjson.gz
bun tools/battle-oracle/compare-golden.ts tests/goldens/gb2-spyder-traces.ndjson.gz tools/battle-oracle/tuxemon-battle.json
```

The corpus contains 214 distinct Spyder opponent/party definitions, 20 seeds,
and the `first` and `cycle` player policies: 8,560 battles in total. It declares
two intentional oracle exemptions: Python UUID-set iteration for multi-target
techniques is replaced with stable active-field order, and a true draw is a
player defeat with a retained `draw` result instead of invoking Tuxemon's
crashing draw handler. The generator writes sorted compact JSON into gzip with
`mtime=0`, making repeated output byte-identical.

The spawn corpus covers every imported trainer definition at three seeds and
twelve representative wild species. It compares all persistent spawn fields
and the final random cursor; every monster must consume exactly thirteen draws.

The GB3 rule corpus covers all 27 regular-combat capture devices, all 25 other
combat items, and escape attempts across level advantages, accumulated failed
attempt counts, seeds, and the two blocking statuses. It records the exact RNG
cursor after each isolated rule as well as upstream item consumption and
post-effect state. Its sole intentional gameplay exemption is recorded in the
fixture header: a successful capture still receives Pocket Tuxemon's normal
post-battle cleanup.

The GB3 progression corpus covers all acquisition methods, one- and two-way
reward splits, level boundaries and multi-level gains, max-level overflow,
stat/HP growth, crossed move schedules, a deterministic first-slot forget
choice, and every evolution row reachable from the imported battle database
(including forms not directly encountered on a map). Progression itself
consumes no random values; evolution form spawning remains a separate spawn
operation covered by the monster-spawn corpus.

The focused GB3 double corpus runs both deterministic player policies over 20
seeds for the five distinct opponent parties referenced by all eight Spyder
double-battle events. It preserves explicit target choices and contains real
two-opponent spread hits, whose per-target damage includes upstream's 0.75
modifier.

To verify determinism without replacing committed files, generate twice under
`/var/tmp/fleet/gb2-oracle` and compare them with `cmp`. To run the checked-in
corpus without Python:

```sh
bun test tests/battle-golden.test.ts tests/battle-gb3-golden.test.ts
```

## QuickJS benchmark entry

`bench-entry.ts` is a self-checking IIFE entry for a real 12-turn Spyder
battle with GB3 progression enabled. Bundle it for the browser target, then
evaluate it in PocketJS's bare QuickJS `Guest` with a host-provided
`globalThis.__benchNow()` monotonic clock:

```sh
bun build tools/battle-oracle/bench-entry.ts --target=browser --format=iife --minify --outfile=/var/tmp/fleet/gb2-oracle/battle-bench.js
```

It reports round-settlement, active-frame, and complete-battle mean/p95/max
timings over 250 battles, after 20 warmup battles. Each active frame is either
the initial `createBattle` call or one immutable `reduceBattle` decision.
