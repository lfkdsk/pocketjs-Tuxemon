# GP1 — startup back under 250 ms: on-demand battle data + a startup assertion

## Result

PASS. `battle/production.ts` no longer imports `data/battle-runtime-db.json`
(801,152 bytes) as a bundled object literal. The importer now splits the
runtime projection into a compact, bundled `BattleRuntimeShell`
(113,396 bytes — every small, always-needed table: rules, shapes, elements,
tastes, encounters, environments) plus one canonical pak/data.fs entry per
monster/technique/item/status slug (650 entries, 634,682 bytes). A new
`BattleDbProvider` (`battle/battle-repository.ts`) resolves and caches each
slug from its entry on first read, so a battle parses only the species and
techniques it actually uses instead of the whole database. On the release
QuickJS desktop host, startup through the first painted frame is
**237.890 ms** at 480×272 and **236.387 ms** at 960×544, both now under the
250 ms budget (a new hard assertion in `tools/g6-quickjs-bench.rs` enforces
this going forward). Battle entry/exit stay inside the existing 50 ms budget.
The maintained journey's terminal state — win and lose lines, with L
rewind — is byte-for-byte unchanged.

## 1. Where startup time went (measured, before this task)

| stage | before (e905824, this exact revision) |
| --- | --- |
| desktop JS bundle | 2,440,853 bytes |
| desktop pak | 60,592,688 bytes |
| startup → first paint, 480×272 (QuickJS) | 265.175 ms |
| startup → first paint, 960×544 (QuickJS) | 267.692 ms |

`battle/production.ts` imported `data/battle-runtime-db.json` (801,152 bytes)
as a plain `import ... from "../data/battle-runtime-db.json"`. Bun's bundler
inlines a JSON import as a JS object literal to skip a runtime `JSON.parse`,
but parsing 801 KB of JS object-literal syntax and constructing the resulting
object graph is itself the dominant startup cost added since G7 (which had no
battle system at all: 1,098,633-byte bundle, 181.787/169.096 ms startup).
`battle/game.ts` also imports the full `data/battle-db.json` (1,195,862
bytes), but that module is only reachable from tests and tools
(`tools/smoke-spyder.ts`, `tests/*.ts`) — `main.tsx` never imports it, so it
was never part of the shipped startup path.

Crucially, GB4 had already measured (`findings/GB4.md` line 141) that naively
deferring the *whole* database to a cold `JSON.parse` at first battle produces
a 245–451 ms spike — worse than doing nothing, and it would blow the 50 ms
battle-entry budget on top of not fixing startup. Splitting the file without
also making the reducer-facing conversion lazy would not have helped either:
`battleDbToTuxemonBattleDb` (`battle/from-battle-db.ts`) unconditionally ran
`Object.entries(db.monsters).map(toMonster)` (and the same for techniques,
items, statuses) on *every* battle start, regardless of which species were
actually fighting.

## 2. Design: per-slug sharding, not staged fade preparation

The task spec offered two options: shard so a battle parses only what it
uses, or stage preparation across fixed units per reference tick during a
fade/transition (the map repository's model). This task uses **sharding**:

- The four dominant tables — `monsters` (293,989 bytes), `techniques`
  (97,011 bytes), `items` (64,755 bytes), `statuses` (13,928 bytes) — are
  ~80% of the runtime database's bytes. A real battle (the maintained
  Billie fight) touches on the order of 2–6 species and a dozen or so
  techniques: a few kilobytes, not hundreds.
- The kit's staged-preparation hook (`MapRepository.acquireStep`, driven by
  `GameView` during a non-zero-fade map transfer) is a **map**-specific
  mechanism; there is no equivalent hook for `BattleRules.start`. Building
  one would mean extending the kit's session/battle-queue protocol — a
  cross-repo change this task's scope explicitly defers ("不改
  `vendor/pocketjs`… 需要框架改动就停下来在报告里说明"; a battle-side staging
  hook would live in the RPG Kit component repo, not this game repo).
- Sharding is self-contained in game code, composes with the existing
  `BattleDbProvider`/`BattleDbSource` abstraction that GB4 already defined in
  `battle/extension.ts` (`load()`/`release()`) but never wired to anything
  lazy, and needs no changes to `vendor/pocket-rpgkit`.

Two lazy layers, not one:

1. **Source layer** (`battle/battle-repository.ts`): `createTuxemonBattleDbProvider(shell, source)`
   returns a `BattleDb` whose `monsters`/`techniques`/`items`/`statuses`
   fields are `Proxy`-backed tables. `db.monsters['nut']` reads and
   `JSON.parse`s exactly `battle/monsters/nut.json` on first access and
   caches the parsed record; `'nut' in db.monsters` is answered from an
   in-memory slug index with no parse at all. Every other field (rules,
   shapes, elements, tastes, encounters, environments) is plain, eager data
   from the shell — all of it is small and every battle needs all of it.
2. **Reducer layer** (`battle/from-battle-db.ts`): `battleDbToTuxemonBattleDb`
   used to eagerly build `monster`/`technique`/`item`/`status`/
   `technique_speed` via `Object.entries(...).map(...)` over the complete
   table — 257 + 245 + 113 + 35 conversions every single battle, even reading
   from an already-fully-resident source. It now returns lazy, memoized
   `Proxy` records here too (`lazyRecord` in that file), composing
   transparently with either an eager plain-object source (tests,
   `battle/game.ts`) or the sharded provider. This is a real fix on its own:
   it removes redundant full-table conversion work that ran on every battle
   regardless of source, which is why battle-entry frame cost *improved*
   (see §4) rather than merely holding steady.

No `release()`: the provider's parsed-slug caches live for the session's
lifetime. Evicting them between battles would only force paying the same
parse cost again for a species or technique the player has already seen
(a starter, a rematch); the worst case — every slug eventually resolved — is
the same 635 KB the bundle used to carry unconditionally, just spread over
the whole playthrough instead of paid upfront. The `BattleDbProvider.load()`/
`release()` shape (`battle/extension.ts`) already existed from GB4; this task
is the first to give it a real (non-identity) implementation. The existing
`active = null` reset in `runtime.ts`'s `BattleRules.start` (with its comment
about a provider "warmed" by a preceding `add_monster` event) needed no
change: `add_monster` already calls `resolveBattleDb(source)`
(`battle/extension.ts`), so with a real provider in place a species is now
naturally warmed by the event that adds it to the party, well before any
battle-entry frame — this was anticipated in GB4's code but only becomes real
once `production.ts` passes a lazy source instead of an already-resident
object.

## 3. What changed

- `importer/battle-schema.ts`: adds `BattleRuntimeIndexEntry` (`{id, entry}`)
  and `BattleRuntimeShell` — the split projection's bundled half.
- `importer/battle.ts`: `splitBattleRuntimeDb()` (mirrors the kit's
  `splitProjectMaps`) takes `runtimeBattleDb()`'s output and produces the
  shell plus one canonical-JSON entry per monster/technique/item/status,
  keyed `battle/<table>/<slug>.json`. `writeBattleArtifacts` writes the
  shards under `dist/battle/` and the shell to
  `dist/battle-runtime-shell.json`, and returns their pak manifest entries.
  `data/battle-runtime-db.json` (the complete, consolidated projection) is
  still written unchanged — it remains the out-of-bundle parity oracle for
  `tests/battle-db-adapter.test.ts`, `tests/battle-spawn.test.ts`, and the
  new `tests/battle-repository.test.ts`, exactly as `dist/project.json`
  stayed the parity oracle for maps after G7.
- `gen-assets.ts`: merges the battle shard pak entries into `pak.json`.
- `battle/battle-repository.ts` (new): the `BattleDbProvider` described above.
- `battle/from-battle-db.ts`: lazy `monster`/`technique`/`item`/
  `technique_speed`/`status` records.
- `battle/production.ts`: exports `createProductionTuxemonBattle(source)`
  instead of eagerly-built `TUXEMON_EXTENSIONS`/`TUXEMON_BATTLE_RULES`
  constants; imports only the 113 KB shell.
- `main.tsx`: builds one `readEntry` function (`fsHost() ? readFileSync : pakGet`,
  the same convention G7 already used for maps) and passes it to both the map
  repository and the new battle provider — desktop reads staged data.fs
  files, web/consoles read the pak.
- `tools/desktop.ts`: stages `dist/battle/**` into the app-scoped data root,
  the same way it already stages `dist/maps/**` (desktop's `readFileSync`
  resolves against data.fs, not the pak).
- `tools/g6-quickjs-bench.rs` / `tools/bench-g6-quickjs.sh`: the benchmark
  harness now also stages the sharded battle tree (recursively — unlike
  maps, the shards are nested under `battle/{monsters,techniques,items,statuses}/`)
  before booting, and **asserts `startup_to_first <= 250.0` ms** for each
  viewport.
- `tools/verify-g6-determinism.ts`: scans `dist/battle` and
  `dist/battle-runtime-shell.json` too.
- `tools/generated-battle.ts` (new) + `tests/battle-repository.test.ts` (new):
  mirrors `tools/generated-project.ts`/`tests/g7-repository.test.ts`'s
  inline-vs-sharded parity pattern, but for the battle database instead of
  maps — proves the sharded `rulesDb` equals the inline one for every slug,
  and replays the full maintained journey through the sharded provider,
  asserting byte-identical `SessionState` on every frame against the pinned
  terminal hash.
- `tests/battle-spawn.test.ts`: one test used `structuredClone(RULES_DB)` to
  produce an isolated, mutable copy of the reducer database. `structuredClone`
  cannot clone a `Proxy` (not a structured-cloneable type), so the test now
  builds a plain-object override of just the one monster it mutates instead
  of deep-cloning the whole (now lazy) database — same isolation, no
  behavior change to what's under test.

## 4. QuickJS performance (release desktop host, real rquickjs guest)

Measured against a clean checkout of `e905824` (this task's exact base
commit) using the identical benchmark methodology, so the "before" numbers
are not carried over from an earlier report — they were re-measured in this
environment for a fair comparison.

| viewport / metric | before (e905824) | after (GP1) | budget |
| --- | ---: | ---: | ---: |
| 480×272 startup → first paint | 265.175 ms | **237.890 ms** | ≤250 ms |
| 960×544 startup → first paint | 267.692 ms | **236.387 ms** | ≤250 ms |
| 480×272 battle-entry (total) | 16.258 ms | **8.486 ms** | ≤50 ms |
| 960×544 battle-entry (total) | 13.302 ms | **8.313 ms** | ≤50 ms |
| 480×272 battle-exit (total) | 20.604 ms | 28.687 ms | ≤50 ms |
| 960×544 battle-exit (total) | 24.628 ms | 34.761 ms | ≤50 ms |
| 480×272 walking p95 (total) | 1.237 ms | 1.257 ms | no regression |
| 960×544 walking p95 (total) | 1.150 ms | 1.150 ms | no regression |
| 480×272 map-switch max (total) | 14.375 ms | 13.358 ms | ≤50 ms |
| 960×544 map-switch max (total) | 13.808 ms | 13.390 ms | ≤50 ms |
| desktop JS bundle | 2,440,853 B | **1,525,709 B** (−37.5%) | — |
| desktop pak | 60,592,688 B | 61,267,328 B (+1.1%) | — |
| web JS bundle | — | 1,525,707 B | — |
| web pak | — | 61,267,328 B | — |
| pinned terminal state SHA-256 | `7fdc...0d0a7` | `7fdc...0d0a7` (unchanged) | — |

Both viewports pass the new hard startup assertion. Battle-entry improved
(the lazy reducer-layer conversion in `from-battle-db.ts` no longer rebuilds
all 257/245/113/35 entries on every `BattleRules.start`, only the handful the
first fight actually uses). Battle-exit got measurably slower — still well
inside the 50 ms budget, but real: the frames right after the fight ends are
where the player's newly-caught/leveled monster and the next few map events
first touch species/techniques the earlier warm-up didn't already resolve, so
some of the parse cost that used to be invisible (paid once, at startup,
before any frame was timed) now lands on a timed frame. This is the expected
trade every lazy-loading change makes — total work goes down, but some of it
becomes visible where it used to be hidden in a cost nobody profiled per
frame. It is 25–30% of the 50 ms budget, not a majority.

`map_first_visits` (the G7 per-map staged first-visit benchmark) is
unaffected: worst non-exempt map (`buddha_mountain`) is 43.462 ms, `test_npcs`
remains the documented exemption. This benchmark never touches battle data.

## 5. Correctness

- `tests/battle-repository.test.ts` (new): the sharded `rulesDb` deep-equals
  the inline one (`canonicalJson` comparison over every resolved slug), and
  the full maintained journey replays byte-identical `SessionState` on every
  frame between `battle/game.ts` (eager, full `battle-db.json`) and the
  sharded provider (`dist/battle-runtime-shell.json` + shards), ending at the
  pinned terminal hash `7fdc130b0b90fece5f3814d886dad0a4513417ce31e2d59019dd0ce310d8dd64`.
- `bun tools/smoke-spyder.ts` (win line, `HZ=60`) and
  `GB4_OUTCOME=lose bun tools/smoke-spyder.ts` (lose line): both complete,
  "the recorded tape replays to the reducer-identical result", "L rewind
  crossed back into the active battle", "replaying after L rewind restores
  the identical result". Win-line hash matches the pinned canonical state;
  lose-line ends `billie_result: "lost"` with the stored faint-point recovery
  intact. Both use the unchanged reducer/extension code path
  (`battle/game.ts`); combined with the sharded/inline equivalence proof
  above, this transitively covers the production (lazy) path for both
  outcomes without needing a second, redundant full replay.
- `bun tools/g6-quickjs-bench.rs`'s `journey` test (the real desktop host,
  real wasm-equivalent rquickjs guest, the actual shipped bundle+pak) ends at
  the same pinned hash on both viewports.
- `tests/g6-golden.test.ts` (built-bundle visual goldens, boots the real
  `dist/main.js`/`.wasm`) passes unchanged.

## 6. Final gates

| command | result |
| --- | --- |
| `bun run import` twice, `git diff` clean between | stable |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | success |
| `bun test tests/` | 130 pass, 0 fail, 62,935 expect() calls |
| `bun run verify:g6:locks` | 329 pages / 333 lock commands, 327 unlocked, 2 transferred, 0 unresolved, 0 errors |
| `bun run verify:g6:frozen` | 263 maps, 0 permanent locks/blocking fibers/errors |
| `bun run verify:g6:determinism` | PASS; 2 isolated roots, files=3885, bytes=60,271,174, sha256=`5136c0d5ae73dcc1add1bdcb1737927b23740dbc6c8013315ee48d411ca0ded6` |
| `bun run bench:g6:quickjs` | PASS; both viewports under the new 250 ms startup budget and the existing 50 ms battle-entry/exit budget |
| `bun run web && bun run web:verify` | PASS; 30 requests, 0 failed, 0 console errors |

`bun.lock` and `vendor/` are unchanged from base `e905824`. Not pushed.

## Fix 1 — a real margin under 250 ms, staged timing, and the two more literals that were still eager

Review of the original fix (`findings/review-task-1939.md`, base `e905824`, head `c2ec606`) found the
sharded battle repository correct but the ≤250 ms startup budget unstable: 480×272 hit `265.568 ms`
directly from the official gate command, and repeated sampling showed 4/7 (480×272) and 2/6 (960×544)
runs over budget. It also asked for the spec's four-stage timing (bundle eval / big JSON literals /
battle-rule registration / first-frame render+mount) instead of inferring composition from bundle
input bytes alone.

### 1. Staged timing (the four requested stages)

`bun build`'s bundler hoists every statically-imported dependency's own top-level code to run
*before* the importing module's own body, in source order for sibling imports — confirmed empirically
(`bun build --format=iife --target=browser` on a two-module probe: both `modA`/`modB`'s own
`console.log`s ran before `entry.ts`'s own code, in import order). That means a timestamp placed
between two `import` lines in `main.tsx` itself does **not** land between those two imports'
evaluation — it lands after the whole graph, alongside every other one of `main.tsx`'s own statements.
Getting a real per-stage boundary requires the mark to be the *last statement of a dependency module
itself*.

Three new, always-on, negligible-cost files do this without touching any production data module:

- `ui/gp1-marks.ts`: a `globalThis.__gp1Marks` array + `gp1Mark(name)`; fires `"module-start"` as its
  own first statement.
- `ui/gp1-kit-stage.ts`: re-exports `@pocketjs/framework`(`/fs`) and the kit's
  `createJsonMapRepository`/`GameView`, then marks `"engine"` — this boundary is *everything* PocketJS's
  UI/engine machinery needs to evaluate, with no Pocket Tuxemon data yet loaded.
- `ui/gp1-data-stage.ts`: re-exports `project-shell.json`, `ui/game-assets.ts`, `ui/battle-assets.ts`,
  `battle/production.ts` (which itself imports `battle-runtime-shell.json`), `ui/battle-scene.tsx`, and
  the new keep-alive asset-path lists (§4), then marks `"json-literals"`.

`main.tsx` imports these two wrappers (in that order) instead of importing the framework/data modules
directly, and marks `"battle-registration"` right after `createProductionTuxemonBattle(...)` and
`"mount"` right after `mount(() => <GameView .../>)`. `tools/g6-quickjs-bench.rs`'s `journey` test reads
`globalThis.__gp1Marks` right after `Runtime::boot` returns and prints the deltas — no new build step,
no risk to the existing frame-budget numbers (the read happens once, after boot, not per frame).

A representative run (480×272, load 2.76 at sample time):

| stage | delta | cumulative |
| --- | ---: | ---: |
| engine (`@pocketjs/framework` + kit UI) | ~0–1 ms | ~0–1 ms |
| json-literals (project-shell + game-assets + battle-assets + battle-runtime-shell + battle-scene) | ~0–1 ms | ~1–2 ms |
| battle-rule registration (`createProductionTuxemonBattle` call) | ~0–1 ms | ~1–2 ms |
| **GameView mount** | **~99–117 ms** | ~101–119 ms |
| *(implicit) pre-JS: QuickJS bytecode compile of the whole bundle + host init* | *(boot_ms − cumulative)* | boot_ms ≈ 214–242 ms |

Two findings this instrumentation actually changes the picture on:

1. **All four requested execution-time stages are cheap (≤2 ms combined).** Neither the big JSON
   literals nor the lazy battle-provider construction cost anything visible once split — the shards
   parse on first *use*, not at import time, exactly as designed. This directly falsifies the
   byte-size-only inference that "the big JSON literal is the dominant *execution* cost": splitting it
   made its *execution* cost vanish, but the *pre-JS bytecode-compile* bucket (below) still scales with
   how many source bytes the bundle carries, which is why removing those bytes from the bundle (§3)
   still mattered.
2. **`mount()` — GameView's synchronous initial render — is the dominant *execution* cost (~100–117 ms),
   not any of the three literal/registration stages.** This lives entirely in
   `vendor/pocket-rpgkit/src/ui/GameView.tsx`, out of this game-repo task's reach (component-repo
   changes go through a separate worktree per the goal's硬规矩). It is the clear next lever for a
   future component-repo task, not something this fix attempts.
3. **The pre-JS bucket (`boot_ms` minus the sum of the four stages) is the single largest number in the
   table — roughly 113–115 ms, essentially constant across viewports.** This is QuickJS compiling the
   whole bundle's bytecode before any of it runs, which is why cutting bundle *source bytes* (§3), not
   just deferring *when* data gets parsed, was the lever that actually moved `startup_to_first`.

### 2. What was still eager, cross-checked against `bun build` input bytes

The prior fix moved the battle database out of the bundle but left two more map/NPC-keyed tables
inline. Re-measuring `ui/game-assets.ts` and `ui/terrain-assets.ts` on disk (a direct proxy for what
the bundler has to parse, corroborating the byte-size argument the original review asked to see
substantiated) before this fix:

| file | bytes | dominant content |
| --- | ---: | --- |
| `ui/game-assets.ts` | 563,531 | `NPC_SRC` (175 NPCs' sprite-frame paths, ~136 KB) + `ANIMATED` (48 maps' tile placements, ~426 KB) |
| `ui/terrain-assets.ts` | 107,252 | `TERRAIN_STREAM.ground`/`.upper` (263 maps' chunk-ref lists) |

`ANIMATED` alone (5,785 placements across 48 maps) was the single largest input in the desktop bundle
the original review's `metafile` breakdown found (`ui/game-assets.ts` 460,265 input bytes — bigger than
`battle-runtime-shell.json` 113,396 and `project-shell.json` 81,950 combined). All three tables share
the exact shape that made battle sharding work: **keyed by an id a session only ever reads one of at a
time (the current map, or one NPC art id), never enumerated** —

- `AnimatedTiles.tsx:97` / `OccludingUpperLayer.tsx:241`: `tiles[mapId]` / `assets.animated?.[mapId]`
- `GameView.tsx:127`: `npcSrc[name]` (one NPC art id at a time, inside `npcFrame`)
- `StreamedChunkLayer.tsx:136-137` / `OccludingUpperLayer.tsx:216`: `refs[mapId]` / `stream.upper[mapId]`

so the same lazy-Proxy-per-shard-file design applies directly, with no `vendor/pocket-rpgkit` change
needed.

### 3. The fix: three more shards, one shared Proxy helper

- `importer/animated.ts` (`splitAnimatedTiles`), `importer/npc-src.ts` (`splitNpcSrc`), and
  `importer/terrain.ts`'s new `splitStreamRefs` each produce a small inline **index** (id → pak/data.fs
  entry) plus one canonical JSON shard per id — `dist/animated/<mapId>.json`,
  `dist/npc-src/<npcId>.json`, `dist/terrain-stream/{ground,upper}/<mapId>.json`. `splitStreamRefs` is
  new game-repo code (not the vendor `streamManifestSource`, which still exists and still produces the
  single-literal form — this split path is additive, unused by anything else).
- `ui/lazy-entry-table.ts` is one shared Proxy factory (`get`/`has`/`ownKeys`/`getOwnPropertyDescriptor`,
  same shape as `battle/battle-repository.ts`'s pre-existing `lazyShardTable`, which keeps its own copy
  since it's tied to `BattleDb`'s shell shape) used by the three new repositories:
  `ui/animated-repository.ts`, `ui/npc-src-repository.ts`, `ui/terrain-stream-repository.ts`. Each
  resolves and caches exactly the ids a session reads; `Reflect.ownKeys`/`in` cost nothing (answered
  from the in-memory index); `Object.keys`/enumeration would force every shard open, same documented
  trade-off as the battle tables.
- `ui/game-assets.ts` now carries `ANIMATED_INDEX`/`NPC_SRC_INDEX` (tiny) instead of `ANIMATED`/`NPC_SRC`
  (large); `ui/terrain-assets.ts` carries `TERRAIN_STREAM_META` (chunkPx + the small per-map `columns`
  ints) and `TERRAIN_STREAM_GROUND_INDEX`/`_UPPER_INDEX` instead of the full `TERRAIN_STREAM` object.
  `GAME_ASSETS`'s generated type is now `Omit<GameAssets, "npcSrc" | "animated" | "stream">`; `main.tsx`
  builds the three lazy providers and spreads them onto `GAME_ASSETS` before passing `assets` to
  `GameView`. `terrain-preview.tsx` (the G5 manual verification harness) does the same, since it also
  constructs a `TERRAIN_STREAM`-shaped value.
- `tools/desktop.ts` stages `dist/animated`, `dist/npc-src`, `dist/terrain-stream` into data.fs the same
  way it already staged `dist/maps`/`dist/battle`; `tools/verify-g6-determinism.ts` and the QuickJS bench
  (`tools/bench-g6-quickjs.sh`/`g6-quickjs-bench.rs`) do the equivalent staging/scanning.

Byte-size result (`ui/game-assets.ts` + `ui/terrain-assets.ts`, on-disk source the bundler parses):
670,783 → 92,348 bytes (−86%). Desktop JS bundle: this fix's starting point `1,525,709 B` →
**`988,463 B`** (−35%; −59% from the pre-GP1 baseline `2,440,853 B`).

### 4. A real correctness bug this fix caught and fixed: the pak baker's literal-scan discovery

`bun run build`'s pak baker (`vendor/pocket-rpgkit/vendor/pocketjs/tools/build.ts`) bakes a PNG (or a
`sprites.json`-registered atlas) into the pak only when its literal path string is reachable from
scanned TS/TSX source (`classStrings`, collected in "pass 1"; confirmed by reading the baker: it
filters `classStrings` for `.png`/`.svg`-shaped strings, then separately checks `spriteMeta[name]` from
`sprites.json` to decide static-image vs. sprite-atlas — both branches key off the *same* scanned-literal
list). Raw JSON blobs listed in `pak.json` (every shard this fix and the prior one produce) are exempt —
they're read unconditionally, which is why the shard *data* was never at risk. This is exactly why
`ui/battle-assets.ts`'s `BATTLE_ASSET_PATHS` already existed (a literal-string anchor, `void`-referenced
from `main.tsx`, doing nothing except keeping those paths visible to the scanner) — and why moving
`NPC_SRC`'s sprite-frame paths and `ANIMATED`'s atlas names out of `ui/game-assets.ts` and into JSON
shards silently broke their discoverability.

This surfaced as a real, reproducible failure: `tests/g6-golden.test.ts` (`bun run build` real bundle
booted in PocketJS's sim host) threw `unknown image src "assets/characters/npc-npc-fashionista-idle-0.png"
- no texture registered under that key`. The QuickJS desktop bench never caught it because its `journey`
test only asserts the terminal **session-state hash**, not rendered pixels — a missing texture is
invisible to that check. Fix: `gen-assets.ts` now also writes `ui/npc-src-assets.ts`
(`NPC_SRC_ASSET_PATHS`) and `ui/animated-assets.ts` (`ANIMATED_ATLAS_NAMES`), flat deduplicated literal
lists mirroring `BATTLE_ASSET_PATHS` exactly, `void`-referenced from `main.tsx`. `bun build`'s dead-code
elimination removes the unused array from the *executed* bundle (confirmed: the desktop JS byte count
is identical with or without these two new modules reachable — the win from §3 is not undone), while
"pass 1"'s literal scan — which runs on source text before that elimination — still finds the strings.
After the fix: `bun test` 140/140 pass (was 135/136, the golden test above), and `bun run web && bun
tools/verify-web-journey.ts` passes with 0 console errors and all 4 pixel/state checkpoints matching
(desktop was never actually broken by this bug — `fsHost()` is true there, so textures come from the
pak baked into the binary the same way regardless — but web/console/sim hosts read entirely through the
pak and would have shipped broken).

### 5. Stability: 10 consecutive runs × 2 viewports, with machine load recorded

This machine runs several other fleet tasks concurrently; `uptime` was sampled at each run. Two full
10-run sets, both after every fix in this section:

**Light load** (`load average` 2.16–3.39 across the run):

| viewport | min | median | p90 | max | over 250 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 480×272 | 210.996 ms | 224.766 ms | 233.380 ms | 233.584 ms | 0/10 |
| 960×544 | 212.833 ms | 222.387 ms | 235.564 ms | 237.279 ms | 0/10 |

Meets both bars: median ≤225 ms, all 10 ≤250 ms, on both viewports.

**Heavy load** (`load average` 4.11–6.16, several other fleet tasks' `bun test`/`traecli`/`claude`
processes active): all 10/10 runs still stayed under 250 ms on both viewports (480×272 max 240.959 ms;
960×544 max 244.849 ms), though the median rose to ~236–238 ms under that contention — confirming the
budget is real margin, not a coin flip, even though it isn't immune to heavy host contention. For
comparison, an earlier 10-run sample taken with only the animated-tile shard applied (before NPC
sprites/terrain-stream) — at a *lighter* load (2.13–3.11) than "heavy" above — still failed 1/10 at
`255.501 ms`; the original FAIL review's own samples (4/7 and 2/6 over budget) were taken with the
battle-only fix. The margin genuinely widened with each additional shard.

Journey terminal state stayed pinned at `7fdc130b0b90fece5f3814d886dad0a4513417ce31e2d59019dd0ce310d8dd64`
on every run, both viewports, confirming no behavior change from any of this section's changes.

### 6. Battle entry/exit, map-switch: still inside budget, moved as expected

| metric | 480×272 | 960×544 | budget |
| --- | ---: | ---: | ---: |
| battle-entry | 7.4–8.6 ms | 8.3–8.4 ms | ≤50 ms |
| battle-exit | 26.5–32.2 ms | 35.3–36.8 ms | ≤50 ms |
| map-switch max | 14.7–14.8 ms | 22.4–25.4 ms | ≤50 ms |
| `map_first_visits` non-exempt worst (`buddha_mountain`) | 48.220 ms | — | ≤50 ms |

`map-switch max` is higher than the pre-this-fix baseline (13.4/13.4 ms) — expected: a map's terrain-
stream ground/upper shard now parses on that map's first visit instead of at startup, the same
visible-cost shift the original GP1 fix already documented for battle-exit. Both viewports stay well
inside the 50 ms budget. `map_first_visits` (the G7 per-map staged benchmark, `bun tools/map-benchmark-
entry.tsx`) is unaffected by design — that harness never renders through `GameView`/`StreamedChunkLayer`,
so it never touches `GameAssets.animated`/`.npcSrc`/`.stream` at all; `buddha_mountain`'s `48.220 ms`
matches the pre-fix `47.955 ms` within run-to-run noise.

### 7. Exit-frame breakdown (non-blocking, as requested)

The review asked for reducer-completion / scene-teardown / map-remount staged timing inside the
battle-exit frame. `BattleRules.done()` (game-owned, `battle/runtime.ts`) is the only piece of that
frame this task's scope can instrument — scene teardown and map remount are
`vendor/pocket-rpgkit/src/engine/session.ts`/`GameView.tsx` internals, out of reach for the same reason
`mount()`'s cost is (§1). `vendor/pocket-rpgkit/src/engine/session.ts`'s `advanceBattleScene` steps and
checks `done()` in the *same* tick it clears the scene, so the public `SessionState` never exposes the
exact value that satisfied `done()` — a new script, `tools/gp1-exit-frame-probe.ts`, replays the
maintained journey through the production sharded path, captures the scene state one frame before the
transition, and reconstructs `advanceBattleScene`'s own step-then-done call (`ticksPerFrame` is 1 at
this journey's 60 Hz) to recover the exact triggering value, then times `done()` on it in isolation (50
samples, Bun — a relative-share estimate, not a QuickJS budget gate):

```
doneMs: { min: 0.011, median: 0.016, p95: 0.036, max: 0.093 }
```

This is negligible next to the QuickJS exit-frame total (26.5–36.8 ms, §6) — even generously scaling for
QuickJS being roughly an order of magnitude slower than Bun, `done()` alone would account for well under
1 ms. This positively rules out the reducer's completion work as a contributor (extending the prior
review's variance-trace finding, which had already ruled out shard-parse cost). The remaining
26–37 ms is entirely kit-owned scene teardown + map remount + draw; splitting further needs a
component-repo task.

### 8. Final gates (this section)

| command | result |
| --- | --- |
| `bun run import` twice, `git diff` clean between | stable |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | success |
| `bun test tests/` | 140 pass, 0 fail, 63,901 expect() calls |
| `bun run verify:g6:locks` | 329 pages / 333 lock commands, 327 unlocked, 2 transferred, 0 unresolved, 0 errors |
| `bun run verify:g6:frozen` | 263 maps, 0 permanent locks/blocking fibers/errors |
| `bun run verify:g6:determinism` | PASS; 2 isolated roots, files=4,636, bytes=60,587,915 |
| `bun run bench:g6:quickjs` | PASS; both viewports under 250 ms, all other budgets held (§5–6) |
| `bun run web && bun tools/verify-web-journey.ts` | PASS; 4/4 state+pixel checkpoints, 0 console errors |

`bun.lock` and `vendor/` unchanged. No code or commit message carries a fleet task number. Not pushed.

## 修复 2（复审 review-task-1947 的 B2/B3，合并 main@ba32513）

复审 [findings/review-task-1947.md](review-task-1947.md) 判 FAIL：B1（启动仍偶发越界）明确移交给组件仓 KP1，本节不再追 225 ms
中位目标；本节处理 B2（保活清单无双向测试）、B3（分段计时归因不完整）与合并 main。

### B2：保活清单双向测试

新增 `tests/g6-keepalive.test.ts`。三个测试分别独立遍历 `dist/npc-src/*.json`、`dist/animated/*.json`
与 `dist/terrain-stream/{ground,upper}/*.json`（直接 `readdirSync`，不经过 `NPC_SRC_INDEX`/`ANIMATED_INDEX`
这些同一次生成产物的索引表），反推出引用集合，与 `NPC_SRC_ASSET_PATHS`（`ui/npc-src-assets.ts`）、
`ANIMATED_ATLAS_NAMES`（`ui/animated-assets.ts`）、`pak.json` 里的 `ui:tile.*` 条目做无硬编码的
Set 双向相等（`missing`/`extra` 两个方向）。反推逻辑抽成 `importer/npc-src.ts` 的
`collectNpcSrcAssetPaths`、`importer/animated.ts` 的 `collectAnimatedAtlasNames`、`importer/terrain.ts`
的 `collectStreamRefKeys` 三个导出函数（`gen-assets.ts` 生成 `NPC_SRC_ASSET_PATHS` 时也改为调用
`collectNpcSrcAssetPaths`，不再另存一份等价逻辑）。terrain-stream 一路的机制其实和 NPC/动画不同：
`pak.json` 里的 prebaked blob 是宿主构建时逐条 splice 进去的，不经过 PocketJS pass-1 的源码字面量扫描
（`vendor/…/pocketjs/tools/build.ts` 里 `pak.json` 那段注释明说是"verbatim"），所以它没有 NPC/动画那种
"漏字面量就漏贴图"的风险；但仍然实现了双向检查（分片引用的 key 都能在 `pak.json` 找到、且都指向存在的文件），
用来在这条独立路径上防同一类 stale-manifest 问题。

删项变异验证（每次改后单独跑 `bun test tests/g6-keepalive.test.ts`，再 `git checkout --` 复原）：

```text
NPC:      missing=[assets/characters/npc-npc-xerogrunt-walk-r-3.png] → 1 fail
animated: missing=[assets/anim/terrain-9.png] → 1 fail
terrain:  missing=[ui:tile.tuxemon-37707_tower-ground-0] → 1 fail
```

三次变异后 `git diff --exit-code` 均为 0（改动已完全复原）。

### B3：可信分段计时

选择"在 QuickJS host 的 bundle compile/eval 调用边界计时"这条路（复审给的二选一），不选"把最早 marker
挪到 bundle 顶层第一条语句之前"——因为 `main.tsx` 已经把 `ui/gp1-marks.ts` 放在自己 import 列表的第一行，
但产品 bundle 里 `solid-js/dist/solid.js` 仍然排在它前面（`@pocketjs/framework`/`GameView.tsx` 的依赖图
决定了打包器的输出顺序，不是 import 语句的文本顺序），这是组件仓 build.ts 的打包顺序决策，属于 vendor/，
改不了。

`tools/g6-quickjs-bench.rs` 新增 `gp1_eval_staged`：`pocket_mod::Guest::eval` 内部只有一次 `JS_Eval`
调用，同时完成编译与顶层执行，没有 API 能把两段分开计时。这个函数改用裸 quickjs FFI（`pocket_mod::qjs::qjs`，
即 `rquickjs::qjs`/`rquickjs_sys` 的全量重导出——`qjs_memory` 已经在用同一条路径读内存统计，不是新引入的
访问面）：先用 `JS_EVAL_FLAG_COMPILE_ONLY` 编译出字节码（不执行任何顶层代码，纯解析+codegen 时间），
再用 `JS_EvalFunction` 执行编译结果（bundle 从第一行到 `mount()` 返回的全部顶层执行时间，天然包含
`solid-js` 自己的顶层初始化）。`JS_EvalFunction` 按 quickjs.c 的 `JS_EvalFunctionInternal` 实现会消费
（释放）传入的 `fun_obj`，所以编译成功后不能再手动 free 那个值，只有编译失败（异常）分支需要 free。

`boot_staged`（同文件新增）复制了一份 `Runtime::boot`（`vendor/…/hosts/desktop/src/main.rs`）的函数体，
把中间那一行 `guest.eval(...)` 换成 `gp1_eval_staged(...)`，其余原样——`include!` 把这份 `.rs` 拼进
main.rs 同一个模块，`Runtime` 的私有字段和 `resolve_asset`/`text_worker`/`HOST_ID`/`HOST_ABI`/`fs::*`
等私有辅助函数因此都可直接引用，不需要改 main.rs 本身（vendor/ 未改，`git diff` 可证）。产出
`StageTimes { host_init_ms, compile_ms, eval_ms, host_finish_ms }`，四段全部来自 Rust `Instant`
（纳秒级分辨率，不受 QuickJS `Date.now()` 整数毫秒粒度限制——QuickJS 侧没有 `performance.now()`，加一个
就要改 pocket-mod/vendor，规格不允许）。

`report_startup_stages` 现在：

1. 打印 host-init / compile 两段（host 侧真实测量）；
2. 用 `eval_ms - (marks[last].at - marks[0].at)` 算出"module-start 之前"这段此前完全不可见的桶
   （`solid-js`/框架顶层初始化，真实来自 `eval_ms` 减去 marks 自己的真实跨度，两者都是实测值，不是按字节
   比例瞎猜）；
3. 打印 marks 自身的四段（engine/json-literals/battle-registration/mount，仍是 `Date.now()` 整数毫秒，
   跨度通常几十上百毫秒，粒度足够）；
4. `assert_gp1_marks` 断言 marks 的名字、顺序、数量必须恰好是
   `["module-start","engine","json-literals","battle-registration","mount"]` 且时间戳非递减——
   缺失、改名、乱序会让整个 bench 直接 panic，不再"打印一张残缺表还算通过"。

变异验证：把 `EXPECTED_GP1_MARKS` 最后一项改成 `"WRONG"`，重新编译并跑一次官方 journey，输出：

```text
assertion `left == right` failed: gp1 marks must be exactly ["module-start", "engine", "json-literals", "battle-registration", "WRONG"] in that order
  left: ["module-start", "engine", "json-literals", "battle-registration", "mount"]
```

`test result: FAILED`；随后复原并确认 `git diff tools/g6-quickjs-bench.rs` 为 0。

合并前（本分支 `4142ed2`，此时尚未合并 main）实测一次干净样本（480×272）：

```text
STAGE name=host-init  delta_ms=78.379
STAGE name=compile    delta_ms=37.543
STAGE name=eval-before-module-start delta_ms=1.619
STAGE name=engine/json-literals/battle-registration 共 delta_ms=1.000
STAGE name=mount      delta_ms=102.000
STAGE name=TOTAL accounted_ms=220.549 boot_ms=221.126 unaccounted_ms=0.578
```

`unaccounted_ms`（`boot_ms` 减去四段之和）稳定在 1 ms 以内，说明四段确实覆盖了从 host 起计时到 mount 完成
的几乎全部时间；`mount≈102 ms` 独立印证了 fix 1 报告里"GameView 首次同步挂载"的量级，`eval-before-module-
start` 只有 1.6 ms——`solid-js` 顶层初始化本身很轻，此前缺失的桶不大，但既然规格要求可信分段，就应该测出来
而不是靠减法留白。

### 合并 main@ba32513

`git merge main`，共同祖先 `e905824`，冲突：

- `data/battle-assets-report.json`、`data/g6-assets-report.json`：两份生成报告，没有手改，`bun run import`
  重新生成后冲突消失，`git diff main -- data/battle-runtime-db.json data/battle-db.json` 为空（重生成结果
  与 main committed 的字节一致）。
- `tools/g6-quickjs-bench.rs`：`boot_staged`/`report_startup_stages`（本分支）与
  `bench.install_structural_counter()`（main 的 GB5）在同一处修改了 `journey()` 的 boot 段；按复审前瞻的
  顺序保留两者——先 `report_startup_stages`（读 marks、装 `StageTimes`），再
  `bench.install_structural_counter()`（在首帧渲染前挂 `ui.*` 调用计数器）。

子模块 `vendor/pocket-rpgkit` 用 `git submodule update --init --recursive` 跟到 main 记录的 `b778aa0`
（连带其自身对 `vendor/pocketjs` 的 pin 从 `76ae741f` 前进到 `d48962e8`——这是 `b778aa0` 提交里已经决定
好的组件仓自身历史，不是本任务手改 `vendor/pocketjs`）。

**合并暴露的一个真实 bug（不在复审前瞻里，合并后才现形）**：GB5 把 `importer/battle.ts` 的
`runtimeBattleDb()` 投影加了两个新顶层字段——`npcs`（训练师战斗立绘）与 `ui`（HP/XP 条、训练师立绘）。
但 GP1 更早就把这份运行时 DB 拆成"`BattleRuntimeShell`（常驻，内联进 bundle）+
monsters/techniques/items/statuses 四张懒加载分片表"的结构（`importer/battle-schema.ts` 的
`BattleRuntimeShell`、`importer/battle.ts` 的 `splitBattleRuntimeDb`、`battle/battle-repository.ts` 的
`createTuxemonBattleDbProvider`），当时按字段名手动列了一份"哪些字段进 shell"的清单，GB5 加字段时不知道
这份清单的存在，于是 `npcs`/`ui` 两个字段没有进 shell，也没有在 `battle-repository.ts` 的重建逻辑里补上。
生产路径（`main.tsx` → `createProductionTuxemonBattle` → 懒加载 provider）因此在战斗开场时读到
`db.ui === undefined`，`bun run build` 出的 `dist/main.js` 一运行就在 `db.ui.hpBar` 处抛
`TypeError: undefined is not an object`——8 个 GB5 golden 测试全部失败（`db.npcs`/`db.ui` 未定义,
症状是 `hosts/sim/sim.ts` 里的运行时 eval 报错，因为 sim host 用同一个文件名标签 eval 内嵌的产品 bundle）。
按现有 `environments`/`encounters` 等字段的先例，把 `npcs`/`ui` 补进
`BattleRuntimeShell`（类型）、`splitBattleRuntimeDb`（写入）、`createTuxemonBattleDbProvider`（重建）
三处后，`bun run import` 重生成的 shell 从 130,720 字节涨到 191,257 字节（`npcs`/`ui` 都不大），
154 个测试全绿。这处修复完全落在 GP1 自己拥有的三个文件里，不是碰 GB5 的代码。

另外把 `tests/battle-repository.test.ts` 里独立维护的一份 `EXPECTED_TERMINAL_STATE_SHA256` 常量
（这份测试没有被 main 的 diff 碰到，合并没帮它自动更新）从旧的 `7fdc130b…`（2,788 帧）改成 main 延长后的
`5653f011…`（3,793 帧）——`tests/g7-repository.test.ts` 已经在 main 侧同步更新过，独立确认过一遍没有遗漏。
同一份测试逐帧对比 inline/sharded 战斗会话，帧数变长后在这台机器上偶发超过 bun 5 s 的默认单测超时
（`this test timed out after 5000ms`）；main 自己那份逐帧回放测试（`tests/g7-repository.test.ts`）已经在
`ba32513` 里把超时提到 60 s，但那次修复同样没碰到 `battle-repository.test.ts`，照抄同一处理（`}, 60_000)`）。

`git diff main -- ui/battle-assets.ts`：GB5 的 578 项战斗贴图与本分支合并前完全一致（`578` 张纹理，
`data/battle-assets-report.json` 的 `art.files=578`），沿用既有 `BATTLE_ASSET_PATHS` 双向测试
（`tests/battle-import.test.ts:137-151`）覆盖，不需要单独再测。

### 合并后重测

完整门禁（合并 + B2/B3 + `npcs`/`ui` 修复之后，独立执行）：

| 命令 | 结果 |
| --- | --- |
| `bun run import` 连续两遍 + `git diff --exit-code` | 两遍一致，0 diff |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | 成功；`dist/main.js=1,142,150 B`（含 GB5 战斗演出代码，此前 987,860 B）、`wasm=289,758 B` |
| `bun test tests/` | **154 pass, 0 fail**（合并前 143 pass；+11 为 GB5 goldens/presentation 测试），70,915 assertions，0 skip |
| `bun run verify:g6:locks` | 329 pages / 333 checks；327 unlocked、2 transferred、0 unresolved、0 error |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks、0 permanent blocking fibers、0 errors |
| `bun run verify:g6:determinism` | PASS；2 roots，4,636 files，61,054,321 bytes |
| `bun run web && bun tools/verify-web-journey.ts` | PASS；3,793 帧（main 延长后的 journey），4/4 状态+像素检查点，0 console error |

`git diff main -- bun.lock vendor` 为空（`vendor/pocket-rpgkit` 停在 `b778aa0`，与 main 一致）；代码与
两条提交信息均不含 fleet 任务号。

单帧 QuickJS 预算（诊断跑，放宽了本地 scratch 副本的 250 ms 断言以便拿到完整 journey 的 CASE 数据；提交的
`tools/g6-quickjs-bench.rs` 断言未改）：

| 指标 | 480×272 | 960×544 | 门槛 |
| --- | ---: | ---: | ---: |
| map-switch max | 15.445 ms | 13.866 ms | ≤50 ms，PASS |
| battle-entry | 22.341 ms | 20.725 ms | ≤50 ms，PASS |
| battle-exit | 30.193 ms | 37.175 ms | ≤50 ms，PASS |
| 终态 SHA-256 | `5653f011…`（两视口一致，与官方 expected 一致） | | |

battle-entry/exit 比合并前（fix 1：7–8 ms / 27–36 ms）更贵，量级与 `findings/kit-bump-b778aa0.md` 记录的
"GB5 常驻对话框随地图视图一起重挂，约 +15 ms" 一致，仍在 50 ms 预算内。

### 启动预算：不追 225 ms，但要证明没有回退

这台机器在测量窗口内被其他并发 fleet 任务的 `rustc`/`cc1` 编译反复冲高（`uptime` 1 分钟负载在同一小时内
从 2 到 16 之间剧烈波动，`free -h` 显示 2 GiB swap 一度用满），`bun tools/bench-g6-quickjs.sh` 自带的
250 ms 硬断言因此多次在单次跑动里直接 panic；这与 `uptime` 报的数字并不总是同步（同一进程连续两批
10 连跑，`uptime` 从 1.4 降到接近 1 却比更高负载的前一批还慢 30–50 ms），怀疑是内存带宽/NUMA/其它容器邻居
的争用，不是这台机器 `uptime` 能完整反映的信号。规格已经把 225 ms 中位数目标移交给组件仓 KP1，本节只验证
"合并没有让情况变得更糟"，为此做了三组独立 10×2 采样，其中最有说服力的一组是背靠背测的：

| 构建 | 视口 | min | median | max | >250 ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 合并前（`4142ed2`，本分支自己的分片，B2/B3 均不改 bundle） | 480×272 | — | 225.538*  | — | 1/10* |
| 合并前 | 960×544 | — | 243.518* | — | 0/10* |
| **合并后分片（本分支 `bee9ede`）**，较空闲窗口 | 480×272 | 225.865 | 241.738 | 256.943 | 3/10 |
| **合并后分片** | 960×544 | 228.166 | 250.086 | 258.115 | 5/10 |
| **合并后分片**，同一时段另一批（较吵） | 480×272 | 281.871 | 295.068 | 317.730 | 10/10 |
| **合并后分片** | 960×544 | 237.646 | 280.261 | 295.213 | 7/10 |
| **main 未分片（`ba32513`，独立 worktree 重新 build，紧接着上一行测的，机器状态最接近）** | 480×272 | 281.746 | 307.393 | 353.809 | 10/10 |
| **main 未分片** | 960×544 | 284.557 | 292.965 | 314.284 | 10/10 |

\* 合并前中位数引自 `findings/review-task-1947.md` 对同一份分片 bundle（B2/B3 不改 `dist/main.js` 字节，
数字仍然成立）的独立 10×2 采样，未在本次会话里重跑。

关键对比是最后两组和它们正上方两组——同一段安静窗口里背靠背测的、四组机器状态最接近：
**合并后的分片构建在 min/median/max 三项上都比同一时刻的未分片 main 快**（480×272 median 295.068 <
307.393；960×544 median 280.261 < 292.965；且 min/max 均如此）。也就是说，即便吸收了 GB5 更大的 bundle
（`dist/main.js` 987,860 → 1,142,150 B，compile 段相应从约 37–41 ms 涨到约 40–49 ms）和更贵的常驻对话框
重挂（mount 段从约 102–118 ms 涨到约 97–121 ms），分片仍然比不分片明显快——这就是"不许回退"要证明的：
GP1 的分片架构本身没有因为这次合并而失效，合并只是把 main 已经决定要付的 GB5 成本原样带了进来，本任务
自己的改动（B2 纯测试、B3 只改 benchmark 工具）都不改 `dist/main.js` 的字节，不会引入额外成本。

真正没有达到的是 225 ms 中位数这个更严的门槛——这条线在合并前分片构建的"空闲窗口"里也只是勉强够到
（225.538 ms，且仍有 1/10 越界），合并后 GB5 增加的约 15–30 ms 结构性成本（compile + mount 两段）几乎
正好吃掉这条线剩下的余量。这正是规格把 B1/225 ms 移交给 KP1（组件仓 GameView 首次同步挂载）的原因；
本任务的职责范围到"证明分片架构没有失效、没有额外退步"为止。

## 修复 3（复审 review-task-1955 的 R1，升组件仓 03533e3，启动验收）

复审 [findings/review-task-1955.md](review-task-1955.md) 判 FAIL，唯一阻断项 R1：修复 2 用三处手写字段清单
补回 `npcs`/`ui`，却没有"完整 inline runtime DB 与重建分片 DB 全量相等"的回归测试——删掉重建结果里的
`sourceRevision` 后 tsc 与 `tests/battle-repository.test.ts` 仍全绿。本节同时完成组件仓 KP1 升级
（启动不再重算外壳 SHA-256）与 GP1 的最终启动验收。

### R1：战斗库全量等价测试

`tests/battle-repository.test.ts` 新增一条测试：`readShardedBattleDb(ROOT).load()` 与
`readInlineBattleDb(ROOT)` 做 canonical 全量等价比较。**可比字段集不手写**——先断言
`Object.keys(rebuilt).sort()` 等于 `Object.keys(inlineDb).sort()`（inline 库有什么，重建结果就必须有
什么），再对整个对象做 `canonicalJson` 比较；`canonicalJson` 递归 `Object.keys`，会强制四张懒加载
Proxy 分片表（monsters/techniques/items/statuses）全量解析，所以任一分片不再 round-trip 同样变红。
当前两边都是 17 个顶层键（13 个内联字段 + 4 张分片表；shell 侧是 13 个内联字段 + 4 个 `*Index`）。

删项变异（临时从 `battle/battle-repository.ts` 的重建对象里删掉 `sourceRevision: shell.sourceRevision`）：

```text
tests/battle-repository.test.ts:
    expect(Object.keys(rebuilt).sort()).toEqual(Object.keys(inlineDb).sort());
error: expect(received).toEqual(expected)
@@ -12,3 +12,3 @@
    "shapes",
-   "sourceRevision",
    "statuses",
(fail) GP1 lazy battle-runtime repository > the sharded provider rebuilds the complete inline battle database
 2 pass, 1 fail
```

新测试变红且差异直接点名缺失字段；旧两条测试（rulesDb 投影比较、journey 逐帧回放）仍全绿——正是复审
描述的缺口。变异随后复原，`git diff --exit-code -- battle/battle-repository.ts` 为 0。

### 组件仓升级 03533e3（KP1：启动信任外壳声明的 mapManifestHash）

`vendor/pocket-rpgkit` 从 `b778aa0` 升到 `03533e3`（只提交指针；其自身 pin 的 `vendor/pocketjs` 仍为
`d48962e8`，嵌套指针无变化）。关键提交 `6288766 perf(engine): stop rehashing the packaged map shell at
startup`：运行时默认信任 `dist/project-shell.json` 里声明的 `mapManifestHash`，不再在启动时对整个外壳
重算 SHA-256；没有声明的手搓外壳仍回退到启动计算。组件仓 README「Large projects」与
`src/data/CHANGELOG.md` 2026-09-30 条目明确要求：**打包方必须在构建或测试期检查新鲜度**，组件仓导出
`assertShellManifestFresh(shell)`（重算并比对，不匹配时连同两个摘要一起抛错；缺声明或格式非法也抛错）。

按此接了三处：

- `gen-assets.ts`：写完 `dist/project-shell.json` 后**从磁盘读回**并调用 `assertShellManifestFresh`，
  每次 `bun run import` 都证明落盘字节与声明一致（`splitProjectMaps` 内部也有自检，双重保险）；
- `tools/generated-project.ts` 的 `readShardedProject`：解析外壳后立即 `assertShellManifestFresh`，
  所有从磁盘读外壳喂给运行时的测试/工具（journey 回放、g7-repository 等）都走这道检查，不需要各自传
  `verifyMapManifest: true`；
- `tests/map-shards.test.ts` 新增测试：真实 `dist/project-shell.json` 通过；内存里把 `title` 改成
  `"Pocket Tuxemon (hand-edited)"` 后抛 `shell manifest hash mismatch`；删掉 `mapManifestHash` 后抛
  `no mapManifestHash`。

升级对生成产物零影响：`bun run import` 两遍后 `data/`、`dist/`、`ui/`、`pak.json` 等生成文件
`git diff` 为空（splitter 的变化只是加了自检调用，外壳字节不变）。

### 启动验收（10 连跑 × 2 视口，官方 QuickJS journey 基准）

`bun tools/desktop.ts --build-only` 后，用官方 `g6_quickjs_bench::journey`（同一 release host 二进制、
同一 `G6_BENCH_ROOT=/var/tmp/fleet/1961/bench-root`）每个视口连续 10 次，记录 `startup_to_first`。
测量窗口 `uptime` 1 分钟负载 1.1–3.3（32 核机器，较空闲）：

| 视口 | min | median | p90 | max | 门槛 |
| --- | ---: | ---: | ---: | ---: | --- |
| 480×272 | 145.203 | **151.897** | 162.657 | 229.679 | median ≤225、全部 ≤250，PASS（10/10） |
| 960×544 | 151.546 | **155.168** | 165.678 | 166.358 | median ≤225、全部 ≤250，PASS（10/10） |

20/20 次终态 SHA-256 均为 `5653f011…`，250 ms 硬断言 20/20 通过。480 的 max 229.679 是首批第一次
（host-init 段冷启动冲到 142.961 ms，其余 9 次 host-init 都在 76–84 ms），仍在 250 ms 内。

分段表（10 次的 min/median/p90/max，单位 ms；JS 侧四段仍是 `Date.now()` 整数毫秒）：

| 段 | 480 min | 480 median | 480 max | 960 min | 960 median | 960 max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| host-init | 76.545 | 79.214 | 142.961 | 77.480 | 80.511 | 82.070 |
| compile | 39.866 | 41.914 | 47.007 | 40.462 | 42.648 | 46.975 |
| eval-before-module-start | 0.665 | 1.170 | 2.034 | 0.340 | 1.114 | 1.902 |
| engine / json-literals / battle-registration | — | 0–1 | 1 | — | 0–1 | 1 |
| **mount** | 24 | **24** | 32 | 27 | **29** | 32 |
| host-finish | 0.006 | 0.007 | 0.015 | 0.006 | 0.007 | 0.008 |
| TOTAL accounted | 143.031 | 149.510 | 226.017 | 149.163 | 152.709 | 163.638 |
| boot_ms | 143.666 | 150.184 | 227.146 | 149.809 | 153.368 | 164.357 |
| unaccounted | 0.635 | 0.657 | 1.129 | 0.609 | 0.665 | 0.727 |

**mount 段从修复 2 的 97–125 ms 降到 24–32 ms**（KP1 预期 20–30 ms，吻合）——启动不再重算外壳
SHA-256 后，mount 基本只剩 GameView 首次同步挂载本身。`unaccounted` 稳定在 1 ms 左右，分段加和闭合。
host-init（约 79–81 ms，pak/data.fs 装载）与 compile（约 42–43 ms，1.15 MB bundle）现在是启动的两大头，
都不属于 GP1 的职责范围。

单帧预算（10 次跑动的 worst-of-run 再取最差，单位 ms）：

| 指标 | 480×272 | 960×544 | 门槛 |
| --- | ---: | ---: | --- |
| map-switch worst | 15.857 | 14.734 | ≤50，PASS |
| battle-entry worst | 22.156 | 22.586 | ≤50，PASS |
| battle-exit worst | 34.372 | 38.491 | ≤50，PASS |
| battle-steady structural | 0（11,320 帧） | 0（11,320 帧） | 0，PASS |

### 完整门禁

| 命令 | 结果 |
| --- | --- |
| `bun run import` 两遍 + `git diff`（生成文件） | 两遍一致，0 diff |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | 成功；`dist/main.js=1,145,029 B`、`wasm=289,758 B` |
| `bun test tests/` | **156 pass, 0 fail, 0 skip**（修复 2 为 154；+2 为本次两条新测试），70,920 assertions |
| GB2/GB3/怪物生成/GB5 聚焦套件（7 文件） | 29 pass, 0 fail, 2,578 assertions |
| `bun run verify:g6:locks` | 329 pages / 333 checks；327 unlocked、2 transferred、0 unresolved、0 error |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks、0 blocking fibers、0 errors |
| `bun run verify:g6:determinism` | PASS；2 roots、4,636 files、61,054,321 bytes；SHA-256 `3a87d1d3…`（与修复 2 相同） |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；3,793 帧、4/4 状态+像素检查点、0 console error |

`git diff dfd9a60..HEAD` 只动 4 个源文件 + `vendor/pocket-rpgkit` 指针；`bun.lock` 与 `vendor/` 其它内容
无变化；代码与 4 条提交信息均不含 fleet 任务号。`findings/G7-map-first-visits.tsv` 随本次官方基准刷新
（263 行计时列更新，地图/尺寸/字节/pass 列不变）。
