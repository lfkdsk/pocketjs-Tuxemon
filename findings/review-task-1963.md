# Review: GB6 主线真打验收 (task 1963 + finish 1965)

Reviewed branch `fleet/task-1963` (11 commits on `main` @ `449d916`), report under
review: `findings/GB6.md`. Method: independently re-ran every gate from a clean
checkout of the worktree (no reuse of the builder's numbers), read the
implementation and upstream Tuxemon source directly, and used four parallel
research agents to cross-check tape authenticity, mutation-test the autoplay
policy, trace the failure paths and three flagged commits against upstream
semantics, and visually inspect all 8 golden PNGs. All findings below are from
these independent runs, not from re-stating `findings/GB6.md`.

## 1. Gates — independently re-run, all reproduce the report's numbers

| Gate | Result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run import` ×2 | exit 0 both times; `git status --porcelain` empty after each |
| `bun run build` | exit 0; pak 4,622 entries / 62,192,144 bytes |
| `bun run build:wasm` | exit 0; 289,758-byte wasm |
| `bun test tests/` | **167 pass / 0 fail**, 71,037 assertions, 35 files, 158.6s |
| `verify:g6:locks` | 329 pages / 333 locks, 327 unlocked / 2 transferred / 0 unresolved / 0 errors — matches |
| `verify:g6:determinism` | PASS, sha256 `0550ca5e…` — matches |
| `verify:g6:frozen` | 263 maps, 0 permanent locks/blocking fibers/errors — matches |
| `verify:gb6:mainline` | PASS, 109,981 frames, 22 trainer + 78 wild, terminal `bd3616c7…` — matches |
| `verify:gb6:failures` | PASS, first-loss 3,357 frames → `spyder_route1@14,19`; later-loss 65,500 frames, Wanda lost, blocked exit, healed — matches |
| `verify:gb6:full` | PASS; stateful save/load (Connor pre/post identical `75042d0a…`), Novak rewind restored+replayed correctly; rate-60/30/20 **all three** independently converge to terminal `bd3616c7…` (10m26s) |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`, 4/4 checkpoints, 0 console errors |
| `bun.lock` / `vendor/` | `git diff 449d916..HEAD --stat -- bun.lock vendor/` → empty |
| fleet task numbers / Co-Authored-By in commits | none found across all 11 commits |

No gate diverged from what `findings/GB6.md` claims.

## 2. Long tape is a real playthrough — CONFIRMED

`tools/verify-gb6-mainline.ts` replays strictly from frame 0 through the
production `createSession`/`stepSession` API using only `journey.masks[]`;
battle/story checkpoints are independently recomputed during the fold and only
*compared* against the frozen data afterward, never read as an oracle. Battle
`outcome` traces cleanly to `battle/core.ts`'s `remainingSides()` /
`finishIfDecided()`, which derive win/loss purely from real HP/fainting state
— there is no settable shortcut. A repo-wide grep for cheat/debug/bypass
hooks reachable from tape input found nothing exploitable. All 22 trainer
rows in GB6.md §2.1 match `opponents.tsv` and were spot-checked directly
against the Tuxemon `.tmx` NPC definitions (Wanda, Edith, Zoolander, Billie)
— exact match on species/levels.

**Caveat (non-blocking):** the report's claim that the route "must" pass
through Wayfarer Inn (justifying 3 extra trainer fights beyond the spec's 19)
is stated as settled fact but is not proven by anything in the report beyond
narrative description. An independent BFS over `spyder_route3.tmx` collision
geometry was inconclusive (Tuxemon's real terrain collision isn't captured by
map-object rectangles alone), so this is flagged as unverified rather than
contradicted — worth a live pathfinder probe in a follow-up, not a blocker
since all 22 fights that did occur are independently confirmed as real wins.

## 3. Autoplay policy — CONFIRMED pure, test suite has two real gaps

`battle/autoplay.ts` is confirmed read-only and RNG-free (no `rng`/`random`
import, no mutation of passed-in state; independently re-verified by
mutation-testing). Three targeted mutations were applied one at a time and
reverted (`git status --porcelain` clean before/after):

- Flipping the heal-threshold comparison (`<=` → `<` at line 220): **survived**
  `bun test` (6/6 pass) — the only heal test uses `currentHp=1`, far from the
  0.35 boundary, so boundary behavior is untested.
- Flipping the max-damage tie-break (line 85, first-max vs last-max): **survived**
  (6/6 pass) — the test only checks the *value* of the chosen damage, not
  *which* move/index won a tie.
- Breaking the forget-lowest-move selection (line 290): **caught**, 5/6 pass,
  1 failure with a clear mismatch.

Verdict: the suite reliably catches a fully-broken decision rule but is not
discriminating on boundary/tie-break behavior for heal and move-selection.
Non-blocking test-quality gap, not a correctness defect (the mutations tested
were synthetic, not evidence of an actual bug in the shipped logic).

## 4. Failure paths — Wanda path CONFIRMED, first-battle-loss path DISCREPANCY

**Mid-game loss (Wanda → Leather Center):** CONFIRMED against upstream.
`spyder.yaml:239-248`'s "Cannot Leave Fainted" gate (`char_at`+`char_facing
down`+`char_defeated`+`location_type clinic`) matches `spyder_leather_center.tmx`/`.yaml`'s
`clinic` type and `(6,7)` faint point exactly; `char_at` is a native T1
trigger in the importer, so this path doesn't depend on any lowered
condition. Independently re-run: `verify:gb6:failures` reproduces the exact
terminal hash `d87ba6c0…` the report claims.

**First-battle loss (global Teleport Faint vs "First Fight - Lose" ordering):**
The report (GB6.md §4) asserts our engine's visible order — global Teleport
Faint fires first (bedroom detour + `heal_before_leave`), then "First Fight -
Lose" fires on return to Paper Town — matches "upstream's visible result."
A code-level trace of upstream's own event engine suggests the opposite is
more likely: the global Teleport Faint is gated on `is current_state
WorldState` (`spyder.yaml:230-238`), and upstream's `lock_controls` pushes a
`SinkState` that keeps `current_state` non-`WorldState` until "First Fight -
Lose" itself calls `unlock_controls` *after* healing the party — meaning in
upstream, the global event's gate is very plausibly still false when the loss
resolves, and the bedroom detour may not happen upstream at all. Our
importer folds `current_state` to a compile-time constant
(`importer/project.ts:611-613`, documented as "T1-lowered … folded against
the P1 WorldState-only runtime"), which discards this exact mutual-exclusion
mechanism, and the kit's `lockInput` is explicitly non-blocking to other
fibers (unlike upstream's stack-based `SinkState`) — so our engine can show
both events' effects where upstream might show only one.

This is a real, evidence-backed concern, not proven conclusively (verifying
it for certain requires running the actual Python oracle, which was out of
scope for this review pass). The report does acknowledge this is "two
concurrent upstream events" and explains its own reasoning, but its specific
claim of matching "upstream visible behavior" is not substantiated and the
code trace points the other way. **Recommend**: re-run this specific case
through the Scout S4 Tuxemon oracle recipe before treating the first-loss
path as upstream-faithful; this affects a secondary/bonus verification case
(not the 22-battle win path), so it is flagged as non-blocking but should be
tracked as a follow-up rather than closed.

Both failure-path data files (`data/gb6-first-loss-journey.json`,
`data/gb6-later-loss-journey.json`) are masks-only (no raw state injection);
one schema nit — `gb6-first-loss-journey.json` lacks the
`format`/`tapeSha256` fields the other two tapes have.

## 5. Three flagged non-test commits — all CONFIRMED reasonable

- `07d0819 feat(importer): lower world destroy items` — maps to upstream's
  `remove_entity` item effect (`tuxemon/core/effects/remove_entity.py:37-54`,
  used by `sledgehammer.yaml`/`hatchet.yaml`); the new importer block mirrors
  it (held-item gate → text → variable write → despawn). `git show --stat`
  confirms the diff touches only `importer/project.ts`, its test, and
  regenerated reports — no runtime/battle files — and it's a general rule
  (any matching `facing_sprite`+`remove_entity` pair), so it converts
  previously-dropped content to native behavior without being GB6-specific;
  the twice-run diff-free `bun run import` independently confirms no other
  map's committed output changed.
- `16ba49f perf: bound repeated battle transition work` — `git show --stat`
  confirms two independent sub-changes: (a) `battle/runtime.ts` caches
  converted `BattleDb`/`rulesDb` across battles for immutable sources instead
  of rebuilding (pinned by a new `battle-runtime.test.ts` case, and
  indirectly by every multi-battle GB6 tape's unchanged terminal hash); (b)
  `gen-assets.ts`/`ui/game-assets.ts` shrinks `maxActors` 500→17 by excluding
  `test_*` stress-fixture maps — a UI rendering-pool bound, not
  `SessionState`, so save/rewind are unaffected. No determinism regression
  possible from either change given the reproduced hashes above.
- `d1f5b8a chore: regenerate G6 lock report` — a 4-line diff
  (`resolvedAt` 524→258, one new `seededBy` annotation); explanation in the
  commit message (earlier commits turned `e024_first_fight_start` into a real
  Battle Processing fight, so the lock verifier's guard facts now come from
  the seed-fallback mechanism instead of the old inline placeholder writes)
  holds up against the diff and the unchanged aggregate counts (329/333/327/2/0/0).

## 6. Coverage — CONFIRMED

`findings/G1-coverage.md`'s 20-placeholder table (choice_monster=2,
choice_npc=1, open_shop=7, remove_monster=4, start_battle=5,
is-party_infected=1) matches the report exactly; spot-checked `start_battle`
(NPC-vs-NPC skip, `importer/project.ts:1250-1253`) and
`choice_monster`/`choice_npc` (`importer/project.ts:1006-1018`) — both
reasons are accurate, and neither is on the player's own mainline path.

## 7. Golden PNGs — CONFIRMED, semantic assertions

All 8 PNGs opened and visually inspected: each of the 4 locations is
visually distinct and plausible (Cotton Town red-roofed buildings/fountain,
Route 2 dense grass/flowers, City Park walled garden/pond, Route 3 end
sandy quarry with vehicles), no blank/corrupted/mismatched frames.
`tests/gb6-route-golden.test.ts` combines whole-file hash pins with two
genuinely semantic checks: an independent player-sprite compositing check
(loads the real sprite PNG, computes expected screen position from tile/camera
data, and does an opaque-pixel RGBA comparison — `:82-106`, asserted `:129-131`)
and a per-location color-histogram check tied to named landmarks
(`:60-66`, `:135-164`). This satisfies the "not hash-only" bar.

## 8. Performance (QuickJS) — budget holds; report's "0.4 ms margin" does not reproduce

Independently re-ran the full 109,981-frame journey in QuickJS at 960×544
(the viewport the report flagged as tightest) via `tools/bench-gb6-quickjs.sh`
on a clean host (own `GB6_BENCH_ROOT`, no concurrent load):

| kind | n | total p95 / max | worst frame |
| --- | ---: | --- | --- |
| walking | 6,340 | 1.075 / 25.813 ms | f93700 |
| map-switch | 1,760 | 3.180 / 8.734 ms | f43104 |
| battle | 44,108 | 20.640 / 44.948 ms | f58754 |
| battle-entry | 100 | 38.149 / 44.948 ms | f58754 |
| battle-exit | 100 | 40.664 / 42.747 ms | f94568 |
| **all** | 109,980 | 17.665 / **44.948 ms** | **f58754** |

All categories pass the ≤50 ms budget, consistent with the report. However,
the specific claimed hot spot — f93927, battle-exit, 49.648 ms, "0.4 ms from
budget" — **did not reproduce**: this clean run's worst frame overall is
44.948 ms at a different frame (f58754, battle-entry, not battle-exit), a
~4.7 ms more comfortable margin. This corroborates the report's own §7.3
admission that near-budget numbers are sensitive to concurrent host load —
the originally-reported 49.648 ms was very likely a scheduling artifact from
that particular run rather than a fixed property of the tape, and no
immediate remediation appears necessary. Battle p95 (~20 ms, consistent with
the report's 20.5–20.8 ms) is reproduced, but **`findings/GB6.md` does not
contain the explanation the task spec explicitly asks for** — why this is
higher than "GB5's ~12 ms" (sample-set difference vs. a real regression).
This is a documentation gap in the report, non-blocking given the number
itself is within budget and reproduces.

## Blocking items

无 (none). All gates independently reproduce; the tape is a genuine
playthrough with no cheats; roster, coverage, goldens, and all three flagged
commits check out. Findings worth tracking as follow-ups, none of which
undermine the milestone's core claim (22 real trainer wins, deterministic
multi-Hz replay, save/rewind correctness):

1. First-battle-loss visible-order claim vs. upstream is not substantiated
   and a code trace suggests it may be backwards (§4).
2. Autoplay's heal-threshold and max-damage tie-break aren't covered by
   boundary-value tests (§3).
3. "Route must pass through Wayfarer Inn" is asserted, not proven (§2).
4. Report doesn't explain the GB5→GB6 battle p95 delta as the spec requests (§8).

PASS
