# Review: task 1886 (KB1+KB2 fix 1 — B1 same-tick battle collision + world freeze)

Reviewed branch `fleet/task-1877` (HEAD `61827a8`) against the pre-fix HEAD `11f5b82`
(reviewed FAIL in `findings/review-task-1877.md`), spec `kit-KB12-fix1.md`, and
`reviewer-generic.md`.

## Gates (reproduced myself, in the required order)

```
$ bun run build:example      -> exit 0
$ bun test                   -> 709 pass, 0 fail, 457244 expect() calls, 46 files [82.28s]
$ bunx tsc --noEmit          -> exit 0
```

Matches the builder's report exactly. `git diff 11f5b82..HEAD --stat -- bun.lock vendor/`
is empty. `git log 11f5b82..HEAD --format="%H %s"` and `git diff 11f5b82..HEAD` contain
no `1886`/`1877`/`1884`/`fleet`/`task-` strings in commits or code.

Two consecutive `bun run build:example` runs: `sha256sum dist/sunstone.js dist/sunstone.pak`
identical both times — byte-stable, confirmed independently.

## Item 1 — B1 (same-tick collision / mid-scene request)

Both original repros from `findings/review-task-1877.md` are now covered by shipped tests
and I re-verified them directly:

- **Two parallels same tick** — `tests/battle.test.ts:155` ("two parallel battle requests
  in one tick run FIFO and both fibers resume"): both fibers reach `won.*`/`done.*`, no
  fiber is left stuck in `external` (`Object.values(state.interp.parallels).some(mode ===
  "external")` is `false` at the end).
- **Main battle in progress, parallel requests mid-scene** — `tests/battle.test.ts:339`
  ("a parallel battle requested during a main battle queues without throwing"): no throw,
  the second request joins the FIFO and later runs.
- **FIFO order** — `tests/battle.test.ts:192` ("a main request precedes same-tick
  parallels, whose keys sort ascending") asserts `pendingBattles` is
  `["a/a-next", "a/z-last"]` when a main request and two parallels fire in the same tick.
  `src/engine/README.md` documents "the blocking main fiber first, then parallel fibers by
  ascending event key."
- **"Next real scene opens on the next reference tick, not the completion frame"** is both
  documented (`session.ts:825-830` comment + README) and tested implicitly by the
  multi-battle sequencing tests; `stepReferenceTick`'s dequeue call happens at the *top* of
  the tick, never inside `advanceBattleScene`'s completion path.
- **Mutation: queue → single-slot overwrite.** I changed
  `s.pendingBattles.push(...)` to `s.pendingBattles = [...]` (overwrite) in
  `interpreter.ts:1376` and reran `tests/battle.test.ts`: **3 tests fail** (FIFO-order test,
  the two-parallels-resume test, and the rewind-across-queued-battles test), confirming the
  suite actually depends on the array/FIFO behavior rather than merely tolerating it.
  Reverted cleanly afterward (`git checkout -- src/engine/interpreter.ts`).
- **`throw` audit in the content path.** `grep -rn "throw " src/engine/*.ts` and classified
  every hit reachable from `stepSession`:
  - `session.ts:583` (`startBattleScene`'s "cannot start while a scene is active") is the
    exact crash site from the original B1. It is now called **only** from
    `startNextBattleScene`, whose `while (s.scene === null && ...)` loop guarantees the
    precondition; the function's own comment now states this explicitly: "The caller
    guarantees there is no active scene; violating that invariant is an engine programming
    error, never a project-content path." I did not find a call site that can violate this.
  - `session.ts:602-720` (`BattleStart`/`BattleCompletion` shape checks) are
    programmer-contract errors in the **game's** `BattleRules` implementation (bad return
    shape), not authored map/event content — consistent with the spec's explicit allowance
    ("程序员错误的断言可以保留，但要与内容路径分开，并写清"), and the code comments now
    separate this class from the content path.
  - `interpreter.ts:1114/1118/1121` (variable-addressed `transfer` resolution: "transfer: map
    variable must hold a non-empty string" etc.) **are** reachable from ordinary authored
    content (an event's `transfer` target references a variable that is unset or
    wrong-typed at the moment the command runs) and **do** propagate out of `stepSession`.
    This is pre-existing KB1 behavior at the `11f5b82` baseline, unrelated to fix 1's diff,
    and out of this task's stated scope — flagging for the record, not as a fix-1 defect.
  - `extensions.ts`/other `interpreter.ts` extension-call throws (unregistered
    call/condition, bad return shape) are pre-validated at `createSession`
    (and "checked when acquired" for sharded maps per the KB1 report), so they should not
    fire during normal play; I did not find a path that skips that validation.
  - Everything else (`map-repository.ts`, `save.ts`, `passability.ts`, `tiles.ts`,
    `journey-search.ts`, `chunk-window.ts`, `motion-clock.ts`) is setup/load/save-time
    validation, not per-frame `stepSession` content execution.

### Finding B1 (new): fiber execution order was globally reversed, not just battle-queue order

To make same-tick battle requests enter the queue "main first, then parallel by key," the
fix did not just re-order the *collection* of the `battle` op's queue entries — it reversed
`stepInterpWithExtensions`'s actual fiber execution order for **every** command
(`interpreter.ts:1424-1432`): before the fix, parallels ran first and the main fiber ran
last ("so a parallel can never observe a value the main fiber sets later in the same
frame" — the removed comment, present since the interpreter's earliest commits); after the
fix, main runs first and parallels run last.

I confirmed this is a real, general behavior change, not just a queue-ordering detail, with
a minimal repro (main-fiber `autorun` sets `v.x=1`; a `parallel` page reads `v.x==1` and
sets `v.y=1` in the same first tick):

- At `11f5b82` (pre-fix): `v.x = 1`, `v.y = undefined` — parallel does not see main's
  same-tick write.
- At `HEAD` (post-fix): `v.x = 1`, `v.y = 1` — parallel **now** sees main's same-tick write.

Symmetrically, main can no longer see a parallel's same-tick write (the inverse used to be
true). This is a full reversal of which fiber "wins" same-tick visibility, reachable by
completely ordinary content (any main event and any parallel event that both touch a
switch/variable in the same frame) — not something specific to battles.

Concerns:
- **Undisclosed scope.** `src/data/CHANGELOG.md`'s new entry and `src/engine/README.md`'s
  new paragraph both frame this exclusively as "battle queue... deterministic
  main-then-parallel-key order." Neither documents that the *general* interpreter fiber
  order changed, or that ordinary (non-battle) same-tick main/parallel interactions now
  resolve oppositely from before.
- **No regression coverage.** `bun test` stayed green because no existing test asserted the
  old visibility direction for non-battle commands — the change is invisible to the suite.
  Grepping `tests/interpreter.test.ts`/`tests/session.test.ts` for "same frame"/"same
  tick"/"observe"/"visib" found nothing that exercises this.
- **Broader than the minimal fix.** The stated goal (`kit-KB12-fix1.md` item 1) is queue
  *order* — main's battle request should sort before same-tick parallels' requests. That is
  achievable without touching general fiber execution order: collect a tick's newly-pushed
  `pendingBattles` entries and sort/prepend them by fiber priority (main, then parallel key)
  before merging into the persistent queue, exactly as `pendingMoveRoutes`-style array
  accumulation already does for other per-tick collections, while leaving `runFiber`'s
  existing parallels-first/main-last order untouched for every other command. The chosen
  implementation reversed execution order globally instead, which is a strictly bigger,
  differently-scoped change than what was asked for.
- **Reachable by real Tuxemon-shaped content.** Given the goal's own numbers (730/671
  `is`/`not variable_set`, 1400 `not char_exists`, heavy reliance on `parallel` sight-check
  pages alongside `autorun`/`action` main-fiber dialogue), a same-tick ordering flip between
  main-fiber writes and parallel-fiber reads is squarely in the class of interaction GB4's
  importer will generate at scale. Whether the new order is "more correct" than the old one
  is not obvious either way — but an undocumented, untested reversal of a previously
  deliberate invariant in generic KB1/KB2 machinery is exactly the class of risk the prior
  review (1884) blocked on for B1 itself.

This is not a crash and does not fail any existing/added test, so it is a different kind of
gap than the original B1 (silent stall/crash). But it is a real, verified, silent behavior
change in the *generic* engine's per-tick fiber semantics, introduced as an unscoped side
effect of the battle-queue-order fix, without documentation of its true scope or any test
covering its new (or old) semantics for non-battle content. I'm treating this as blocking
per the same standard the prior review applied to B1 (undisclosed, untested, content-
reachable behavior change in shared reducer machinery).

## Item 2 — world freeze / timer correction

- Default freeze: `stepReferenceTick` (`session.ts:835`) calls `tickFrozenWorld` whenever
  `s.scene !== null && !sess.sceneOptions.worldContinues`, which advances only
  `s.interp.frame`/`scene.pausedTicks` and clears only same-tick transient fields
  (`cues`/`pendingMoveRoutes`/`pendingPlacements`/`abortedRoutes`) — no `syncPages`, no
  mover, no `stepChars`, no interpreter fiber fold. `tests/battle.test.ts:261` ("battle
  input is isolated and the map world freezes by default") asserts a parallel fiber's state,
  a variable it increments, and an NPC's position are all byte-identical across 5 frozen
  frames. **Mutation:** short-circuiting the freeze branch (`if (false && ...)`) makes this
  exact test fail (`parallel.ticks` goes from the expected `1` to `3`) — reverted after.
- `scene.worldContinues: true` still queues rather than replacing/crashing
  (`tests/battle.test.ts:302,339`); confirmed by reading `stepReferenceTick`'s two branches
  independently of `worldContinues`.
- **Timing correction is deterministic and Hz-independent.** I built a project with a
  battle-owning main fiber and an independent `parallel` fiber running `wait 30 ticks` (30
  reference ticks = 0.5s at the fixed `MOTION_HZ=60` reference clock that `wait`/`text`
  always compile against, per `interpreter.ts:322` / `session.ts:322,413`), spanning the
  battle at 60/30/20/4 Hz. Raw absolute-tick landing points differ across Hz (e.g. the wait
  fires at reference-tick 47/50/51/75 for 60/30/20/4 Hz respectively), but this is fully and
  exactly explained by *when the battle itself can start* being host-frame-quantized
  (entry lands at reference-tick 1/2/3/15 respectively, because player input/`battle.step`
  are sampled once per host frame) plus the *freeze duration itself* being host-frame-
  quantized (16/18/18/30 ticks respectively, since `toyBattleRules`' 15-tick animation
  threshold interacts differently with `ticksPerFrame` at each Hz). Once both of those
  (independently expected, pre-existing-since-KB2) effects are subtracted out —
  `fire − freezeDuration − battleEntryTick`  — the result is **exactly 30** at all four Hz,
  i.e. the parallel fiber experiences exactly 30 unfrozen reference ticks of wait progress
  regardless of Hz or freeze length; the correction neither drops nor adds a tick. I did not
  find a test in the shipped suite that isolates this specific "wait spans a freeze, verify
  virtual-time-only progress" property at multiple Hz (the closest, `tests/battle.test.ts:370`,
  compares whole-session semantic JSON across Hz but has no long-lived non-battle timer
  running through the freeze) — worth adding as an explicit regression test, but the
  mechanism itself checks out as correct by direct measurement.

## Item 3 — save

- `canSave` (`save.ts:61-75`) independently requires `interp.pendingBattles.length === 0`
  **and** `scene === null`. **Mutation:** removing the `scene === null` clause makes exactly
  one test fail — `tests/battle.test.ts:207` ("a parallel-only active battle is never a save
  point") — matching the builder's claim precisely (the gap the prior review, 1884, flagged
  as untested). Reverted after.
- Legacy saves: `hydrateLegacyV1` (`save.ts:402-416`) accepts both a save that predates
  `pendingBattle`/`pendingBattles` entirely (hydrates to `[]`) and — by code path, though
  untested — a save with the old single-slot `pendingBattle` populated (wraps it into a
  1-element array). `tests/save.test.ts:288` only exercises the `pendingBattle: null` case;
  a populated single-slot legacy save is not directly exercised by a test, though it's also
  not a case that could have existed for real (old `canSave` already required
  `pendingBattle === null` at any legitimate save point, so a real old save could never have
  had a populated `pendingBattle`). Minor coverage gap, not a functional one.

## Item 4 — switch write-back

`advanceBattleScene` (`session.ts:697-728`) validates `completion.switches` the same way as
`writes` (record of booleans only), then applies both `writes` and `switches` to `s.interp.sw`
in the same block, **before** `continueBattle(...)` runs the result branch and before
`s.scene = null`. This is atomic with variable writes and precedes branching, matching spec
item 4. Save/rewind coverage: switches live in `s.sw`, which is part of the ordinary reducer
snapshot used by both save and attract rewind — no separate plumbing needed, and the
existing win/lose/escape test (`tests/battle.test.ts:220`) already asserts
`toy.result.<name>` and `branch.<name>` switches land correctly per outcome.

## Item 5 — rewind

`tests/battle.test.ts:410` ("attract rewind restores the queued gap and post-queue state
byte-for-byte") drives two queued battles through a full baseline run and an
`AttractController` rewind, asserting `rewound.state` equals the baseline's `structuredClone`
snapshot both at the mid-queue gap and after both battles complete — this is exactly the
"rewind across queued battles is byte-identical" property item 5 asks for, and it passes.

## Item 6 — QuickJS performance

Reproduced independently with the documented harness:

```
$ bun build findings/KB12-bench.ts --format=iife --target=browser --outfile=/var/tmp/fleet/1894/KB12-bench.js
$ BENCH_SCRIPT=/var/tmp/fleet/1894/KB12-bench.js /var/tmp/kit-scrub-scratch/target/release/deps/pocket_desktop_host-0010752dfe1701fe qjs_script_bench::qjs_script --ignored --exact --nocapture

map_walk_ms_per_frame=0.036837
battle_active_ms_per_frame=0.071568
battle_enter_ms_per_frame=0.097800
battle_exit_ms_per_frame=0.101468
```

Close to the report's medians (0.036396 / 0.074485 / 0.090858 / 0.098627), within
run-to-run noise; all four remain far under a 4 Hz frame's 250 ms budget.

`dist/sunstone.js` is **402,097 bytes** (matches the report and the spec's stated figure
exactly), well under the 415,000-byte guard. The increment over the pre-fix `11f5b82`
baseline (399,670 bytes per the prior review) is 2,427 bytes, all attributable to the
persistent-queue/freeze-clock/`scene` option plumbing added by this fix — `examples/sunstone`
still registers no `battle`/`extensions` option (confirmed:
`grep -rn "battle\|extensions" examples/sunstone/*.ts*` — no hits), so this is pure
always-linked-core growth, consistent with the prior review's note that KB1/KB2 code isn't
tree-shakeable out of a battle-less game build.

## Item 7 — hygiene

- Goldens: full `bun test` includes the framebuffer/golden assertions and is green; I did
  not find any golden file touched in `git diff 11f5b82..HEAD --stat`.
- `bun.lock`/`vendor/`: no diff (checked above).
- No task numbers in commits or diff content (checked above).

## Verdict rationale

Every explicit acceptance item in `kit-KB12-fix1.md` and the review brief is met and
independently re-verified, including three separate mutation tests (queue→single-slot,
freeze→always-continue, `canSave`'s `scene === null` guard removed) that each turn exactly
the sentinel test(s) the builder claimed red. The original B1 crash/stall is genuinely fixed
for both repro shapes, `startBattleScene`'s invariant-violation throw is now provably
unreachable from content, world freeze is byte-stable and its timer correction is exactly
Hz-invariant by direct measurement, save/switch/rewind semantics are correct, QuickJS numbers
and the 402,097-byte bundle reproduce, and there is no `bun.lock`/`vendor`/task-number
hygiene violation.

However, the mechanism chosen to satisfy "main-first queue order" reversed the interpreter's
general per-tick fiber execution order for *all* commands, not just battle requests — a
broader, undocumented, and untested change to generic KB1/KB2 same-tick visibility semantics
that CHANGELOG/README describe only as a battle-queue detail. This is a real, reproduced,
silent behavior change in shared reducer machinery reachable by ordinary (non-battle)
content, of the same class the prior review (1884) blocked B1 on. It should either be
narrowed to only reorder the battle-queue collection (leaving general fiber execution order
as it was) or be explicitly disclosed as a general semantics change with its own rationale
and test coverage before merge.

## Blocking findings

### B1: `stepInterpWithExtensions` reversed general fiber execution order (main-then-parallel) to satisfy battle-queue ordering, an undocumented and untested change to non-battle same-tick visibility semantics

See "Item 1 — Finding B1 (new)" above for full detail, repro, and evidence
(`interpreter.ts:1424-1432`; removed invariant comment vs. new one; minimal repro showing
`v.y` flips from `undefined` to `1` pre-/post-fix for a same-tick main-write/parallel-read
pair that has nothing to do with battles).

FAIL
