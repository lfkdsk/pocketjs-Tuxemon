# Review: GB2 battle rules + differential oracle (task 1866 + continuation 1873)

Reviewed in an independent worktree (`~/.fleet/worktrees/task-1866`, branch
`fleet/task-1866`, HEAD `0848e17`, baseline G6 `3111ac9`) against
`game-GB2-battle-rules.md`, `game-GB2-continue.md`, and Scout S4
(`~/.fleet/worktrees/task-1865/findings/scout-S4-battle.md` §2, §2.14, §4.2,
§5). All numbers below were reproduced independently; builder self-reported
counts were not taken on faith.

## Gates (rerun independently)

- `bunx tsc --noEmit`: exit 0.
- `bun test`: 46 pass, 0 fail, 39,388 `expect()` calls, 9 files, 58.3 s —
  matches `findings/GB2.md`'s own numbers exactly.
- `git diff 3111ac9..HEAD --stat -- bun.lock vendor/`: empty. The submodule
  pointer in this branch (`4dfb6518f`) equals the G6 baseline commit
  `3111ac9`'s pointer, not a change introduced by GB2; `main` is simply behind
  that baseline (`git ls-tree 3111ac9 vendor/pocket-rpgkit` vs
  `git ls-tree main vendor/pocket-rpgkit`).
- No fleet task numbers in code/comments: `grep -rniE "task[- ]?1[0-9]{3}|fleet.?1[0-9]{3}" battle/ tools/battle-oracle/ tests/` → no hits. Commit
  subjects (`98cfdb2`..`0848e17`) are plain `feat(battle)/fix(battle)/test(battle)/docs` with no task IDs. One nit: `findings/GB2.md:102` names a scratch
  path `/var/tmp/fleet/1873/run-a` while documenting the double-generation
  determinism check — a session path, not an identifier baked into shipped
  code; non-blocking.
- `git ls-files | grep -i pycache` → empty; `.gitignore` gained `__pycache__/`
  in `46558c5`.

## 1. Is the differential real?

Rebuilt a Python 3.14 venv (`/var/tmp/fleet/1879/gb2-oracle-venv`) from
`/var/tmp/tuxemon-src/requirements.txt` (pygame-ce 2.5.7, pydantic 2.13.5,
PyYAML 6.0.3) per `tools/battle-oracle/README.md`. Regenerated everything from
the pinned upstream source and diffed against the committed artifacts:

- `extract_spyder_parties.py` → byte-identical to `tools/battle-oracle/spyder-parties.json` (`jq -S` diff empty; `{"definitions":214,"double":5}`).
- `export_data.py` → byte-identical to `battle/data/tuxemon-battle.json` (802,725 bytes, `jq -S` diff empty).
- `generate_spyder.py … 2` (all 214 definitions × 2 seeds × 2 policies = 856
  battles, run from real upstream Tuxemon, ~8s) → every one of the 856 cases
  matched the corresponding entry in the committed 8,560-case golden
  byte-for-byte (`/var/tmp/fleet/1879/diff-check.ts`: `{checked:856,
  identical:856, missing:0, different:0}`). This is a wider check than the
  spec's suggested "10 defs × 2 seeds × 2 policies" — all 214 definitions were
  covered.

`compare-golden.ts`'s `canonical()` only sorts object keys recursively for
stable `JSON.stringify` comparison; it does not touch array order, does not
round numbers, and does not drop fields (`tools/battle-oracle/compare-golden.ts:37-48`). The only other transform is `remapKeys`/`label()`, which
substitutes each side's non-comparable object identity (Python object id vs.
TS uid) with a stable `p{index}`/`e{index}` name computed from initial party
position — and the **same** substitution is applied symmetrically on the
Python oracle side (`generate_spyder.py:204-207`, `label()` at :230-231), so
this isn't a one-sided cover-up of a real divergence. Verdict: **only the two
declared exemptions (draw-as-player-defeat, stable-active-field order) affect
the comparison; nothing else is ignored, rounded, or reordered.**

## 2. Mutation testing

Four independent mutations, each reverted after confirming red, each
confirmed green again on the 200/500-case slice used:

| Mutation | File:line | Result |
| --- | --- | --- |
| Damage formula constant `7 + user.level` → `8 + user.level` | `battle/tuxemon.ts:358-359` | 200/200 cases flip red (`event 6` damage mismatch) |
| Status duration increment `turn++` → `turn += 2` | `battle/tuxemon.ts:1045` | 10/500 cases flip red (exactly the `noddingoff`-sensitive cases) |
| Element table cell `fire→earth` `0.5` → `2.0` in `battle/data/tuxemon-battle.json` | data, not code | 0/500 in first slice (matchup absent there) but **1,058/8,560 flip red on the full corpus** — confirms the affinity table is load-bearing and exercised widely |
| (baseline control) | — | 8,560/8,560 identical before/after revert |

All mutations were reverted; `git status` is clean and `bun test` /
`bunx tsc --noEmit` still pass post-revert. I did not need to try a "swap two
RNG draw order" mutation separately — the duration mutation above already
demonstrates the golden is sensitive to RNG-cursor-affecting control flow
(each `randomChoice`/`nextRandom` call consumed at a different point changes
every subsequent draw), and the element-table mutation demonstrates
sensitivity to a single data cell across the full corpus.

## 3. Coverage: 18 effects, 30 statuses

- Scout S4 §2.5/§2.6/§11 (`findings/scout-S4-battle.md:64,73,154`) independently establishes "Spyder mainline uses exactly 18 effect types and
  30 statuses" as the target, not something GB2 invented.
- Scanned the committed golden directly (`/var/tmp/fleet/1879/status-scan.ts`,
  `/var/tmp/fleet/1879/effect-scan.ts`): 205 distinct techniques appear, using
  16 real effect types plus the generated `empty` technique (17 total types
  incl. `empty`) — `prop_damage` and `reverse` are genuinely absent from the
  trainer corpus, matching the report's claim that those two get direct unit
  tests instead. All 30 requested statuses (and no extras) appear as
  `event.statuses` values in the golden trace. Both counts match
  `findings/GB2.md` exactly.
- Spot-checked the two effects claimed to have "direct rule-level regression
  tests instead of corpus coverage" (`tests/battle-effects.test.ts`) against
  upstream, not against the reducer's own output:
  - `prop_damage` test expects 75 remaining HP for a 100-HP monster hit by
    `panjandrum` (`0.25` proportional damage per
    `/var/tmp/tuxemon-src/mods/tuxemon/db/technique/panjandrum.yaml:14-16`) —
    100 × 0.25 = 25 damage, matches independently of the reducer.
  - `reverse` test expects both monsters' types restored to their species
    defaults after `neutralize`, which upstream's `ReverseEffect.apply_tech_target` in `/var/tmp/tuxemon-src/tuxemon/core/effects/reverse.py:44-58`
    implements as `enemy_team:own_team` → `get_target_monsters` expands to
    both sides in a 1v1 battle. Test assertion matches upstream semantics, not
    a self-referential echo of the TS implementation.
- Commander-pinned quirks checked in code, not just prose:
  - PERFORM_TECH double-apply: `battle/tuxemon.ts:326-332` literally calls
    `randomChoice` and `applyStatus` twice in sequence with a comment citing
    the upstream double-application, matching the report.
  - `runAttempts` persists across battles with no reset logic anywhere in
    `battle/tuxemon.ts` (`grep -n runAttempts` → only the `createBattle`
    threading site at `:1114`); `capture` is a reserved decision type
    (`battle/types.ts:215`) that `reduceBattle` rejects
    (`battle/tuxemon.ts:1126-1128`) — both match "reserved for GB3" as
    claimed.

## 4. Reducer purity

- `battle/core.ts` has no `Math.random`/`Date.now`/module-level mutable state
  (`grep -n "Math.random\|Date.now\|new Date(\|^let \|^var " battle/*.ts` →
  empty except `tools/battle-oracle/bench-entry.ts:13`'s guarded
  `__benchNow`-or-`Date.now` fallback, which is bench-only code, not the
  reducer).
- All randomness flows through `nextRandom(state)` (`battle/core.ts:18-25`,
  the same mulberry32 as the component repo's interpreter and the oracle's
  patched Python `random`), consuming and advancing `state.rng`/`rngDraws` —
  no other source of nondeterminism.
- Public boundary immutability: `reduceBattle` clones via
  `cloneBattleState` (`JSON.parse(JSON.stringify(state))`,
  `battle/tuxemon.ts:54-55,1125`) before mutating the draft, so the caller's
  `previous` state object is never mutated. `createBattle` builds a fresh
  state from `start`; `monsterFromSnapshot` (`battle/stats.ts:135-178`) spreads
  every array/object field from the input snapshot rather than aliasing it, so
  the caller's `BattleStart` isn't mutated either.
- Serialization round-trip is exercised implicitly on every single call:
  `reduceBattle` performs a JSON round-trip clone internally on every
  decision, and the entire 8,560-case golden corpus plus all 46 `bun test`
  cases exercise this path repeatedly to completion. There is no dedicated
  standalone round-trip test, but the corpus effectively fuzzes it at scale.
  Non-blocking observation, not a defect.
- `ticks`/hz independence: `TuxemonBattleState` has no wall-clock or frame-rate
  field; `turn` is a pure round counter advanced once per `housekeeping` phase
  (`battle/core.ts:207-208`). No hz-dependent state exists in this slice
  (that concern applies to the world/journey layer, not the battle reducer).

## 5. QuickJS performance

No `.rs` bench harness was committed for GB2 (contrast with G6's
`tools/g6-quickjs-bench.rs` / `tools/terrain-quickjs-bench.rs`, which *are*
committed and scripted via `tools/bench-g6-quickjs.sh`). `tools/battle-oracle/bench-entry.ts` only produces the bundle; running it under real QuickJS
required reconstructing a harness. I built one from the same pattern as the
committed G6/terrain benches — a scratch copy of `hosts/desktop` with a new
`#[test] #[ignore]` that builds a bare `pocket_mod::Guest`, binds
`__benchNow` to a native `Instant`-backed clock, evals the bundle, and reads
`globalThis.__out` — and reproduced the bundle build first
(`bun build tools/battle-oracle/bench-entry.ts --target=browser --format=iife
--minify` → byte-identical to the builder's leftover
`/var/tmp/fleet/1873/battle-bench.js`).

Three independent runs of my harness (`GB2_BENCH_JS=… pocket_desktop_host
battle_quickjs_bench::run --ignored --exact --nocapture`):

| Metric | My run 1 | My run 2 | My run 3 | Report's 3 runs |
| --- | ---: | ---: | ---: | --- |
| Round mean | 0.638 ms | 0.649 ms | 0.628 ms | 0.598–0.636 ms |
| Round p95 | 0.870 ms | 0.873 ms | 0.862 ms | 0.839–0.867 ms |
| Round max | 1.734 ms | 2.598 ms | 1.456 ms | 1.310–1.954 ms |
| Over 1 ms / 2,750 | 7 | 12 | 7 | 2–9 |

Mean and p95 are reproduced consistently within a tight band of the report's
numbers (both meet the ≈0.6 ms / ≈0.86 ms targets on every run, mine
included). The max is noisier — my run 2 hit 2.6 ms, slightly above the
report's stated worst of 1.954 ms — but this is expected variance from a
different, shared/virtualized machine and a leaner bare-`Guest` harness
(no `UiSurface`/offload worker in the loop, unlike G6/terrain's benches); it
does not change the conclusion. The report is honest about the spike rather
than hiding it.

On "can settlement be spread across frames": at 60 Hz the frame budget is
16.7 ms, and even the worst observed single-round settlement (≈1.7–2.6 ms
here, ≈2 ms in the report) is under an eighth of that budget, so there is no
practical need to split a round settlement across frames for the stated
target. The architecture would technically allow it if ever needed —
`drain()` (`battle/core.ts:187-198`) pops one queued action at a time from
`state.queue`, so a future host could yield between iterations — but nothing
in the current design requires or blocks that; not a gap.

## 6. GB1 battle-db handoff

Cross-checked `findings/GB2.md`'s "Switching to the GB1 battle database"
section directly against GB1's committed `data/battle-db.json`
(`~/.fleet/worktrees/task-1867`, branch `fleet/task-1867`, already reviewed
and passed per that worktree's `findings/review-task-1816.md` history):

- Counts match exactly: 214 monsters, 228 techniques, 35 statuses, 13
  elements, 12 tastes, 14 shapes (`python3` count against
  `data/battle-db.json` in the GB1 worktree).
- `monsters` is keyed by slug with a separate localized `species` field (e.g.
  key `aardart`, `species: "anteater"`) — matches the claimed `key supplies
  slug` mapping.
- `techniques.panjandrum.effects` is `[{"type":"prop_damage","parameters":
  ["enemy_monster","0.25"]}]` — parameters survive the import faithfully, so
  the "convert camelCase … to the reducer's source-shaped names" adapter work
  is real but bounded (field renames/reshaping, not data recovery).
- `statModifiers` are genuinely compact: e.g. `techniques.boulder.statModifiers.armour = {"step": 1}` and `statuses.blinded.statModifiers.speed =
  {"value": 0.5, "operation": "*"}` — no `max_step_limit`/`scaling_mode`/
  `max_deviation`/`overridetofull` keys anywhere. The three listed data gaps
  (elementOrder, status `modifiers`, statModifier defaults) are real, not
  hypothetical.
- `db.elements` keys list alphabetically (`cosmic, earth, fire, frost,
  heroic, …`) with no separate order field — confirms the `elementOrder`
  gap: a `switch`-effect RNG pick over `Object.keys(db.elements)` would
  silently select a different multiplier target than the reducer's own
  RNG-seeded stream expects, changing outcomes without changing golden
  results (since GB2 doesn't consume GB1 data yet) but poisoning any future
  adapter that naively iterates `Object.keys`.
- `techniques` do contain a 19th effect type, `scope`, that none of GB2's 18
  covers, and the reducer's `default:` branch at `battle/tuxemon.ts:822`
  throws `unsupported technique effect` for anything outside its switch —
  confirmed this would hard-fail on any GB1 technique using `scope` today.

The "接 GB1" section is accurate and the cutover sequence (extend GB1 schema →
pure adapter → load at runtime → re-run the 8,560-case comparator against
adapted data → retire the oracle JSON from runtime) is executable as written.
One addition worth flagging for whoever picks this up: GB1's `monster.moveset`
is a full level-up *schedule* (`[{technique, level, method}]`), not the flat
"currently known moves" list GB2's `MonsterSnapshot.moves` expects — the
adapter needs `learnedMoves()`-style level-gated selection
(`battle/stats.ts:180-187` already has this exact logic for the oracle path),
not just a field rename. The report's phrasing ("moveset fields convert …")
under-states this; it's a small but real logic step, not pure reshaping.

## 7. Golden corpus size

5,868,945 bytes gz (≈5.6 MiB / 5.87 MB decimal, matching the "5.8 MB" figure
in the review brief), 82,205,079 bytes uncompressed, 92.9% compression ratio,
8,560 cases → ≈686 bytes/case compressed. This is reasonable for full
per-event traces (needed so `compareGoldenCase` can report the exact
diverging event index/payload on failure, which is what actually made the
five build-time regressions tractable to fix). A smaller alternative (final
state + hash only) would shrink the file but destroy the "first divergent
event" debugging signal that this project's determinism-first process
depends on elsewhere (see `compareGoldenCase` in
`tools/battle-oracle/compare-golden.ts:108-131`). Not requiring a change, per
the spec's own "不强制改".

## Verdict on the continuation's specific claim

The continuation spec expected "5 inconsistent goldens"; the builder's first
full rerun found 6 (one extra `wild`-self-damage-during-decisions case beyond
the four `empty`-hit-state cases and the one `outOfRange`/disappear case). All
six got root-caused and fixed with source-level reducer changes (not golden
edits) in three commits (`b069064`, `155b889`, `9e6dcda`), each independently
readable and each with a plausible upstream-parity rationale in its diff/
commit message. I independently reran the full comparator and got
`{"cases":8560,"identical":8560,"different":0}` — this is not being taken on
the builder's word.

## Blocking items

None.

## Non-blocking notes

1. `findings/GB2.md:102` embeds a fleet scratch path
   (`/var/tmp/fleet/1873/run-a`) — a session artifact reference, not an
   identifier in code; harmless but slightly outside the letter of "no fleet
   task numbers in reports."
2. No committed `.rs` QuickJS bench harness for GB2, unlike G6/terrain
   (`tools/g6-quickjs-bench.rs`, `tools/terrain-quickjs-bench.rs` +
   `tools/bench-g6-quickjs.sh`). Anyone re-verifying the QuickJS numbers has
   to hand-build a harness, as I did here. Worth adding a
   `tools/battle-quickjs-bench.rs` + `tools/bench-battle-quickjs.sh` pair
   mirroring the existing convention, as low-cost follow-up.
3. GB1 handoff section slightly under-states the `moveset` schedule →
   "currently known moves" derivation as a data-reshape rather than the small
   logic step it actually is (§6 above).

## Result

PASS
