# Review: task 1877 (KB1+KB2 — extension commands + battle processing)

Reviewed branch `fleet/task-1877` (HEAD `96dde29`) against baseline `08880fa`,
spec `kit-KB12-ext-battle.md`, `reviewer-generic.md`, and Scout S4
(`~/.fleet/worktrees/task-1865/findings/scout-S4-battle.md`).

## Gates (reproduced myself, in the required order)

```
$ bun run build:example      -> completed, no error
$ bun test                   -> 702 pass, 0 fail, 457190 expect() calls, 46 files [84.7s]
$ bunx tsc --noEmit          -> exit 0
```

Matches the builder's report exactly. `git diff 08880fa..HEAD --stat -- bun.lock vendor/`
is empty; `git log 08880fa..HEAD` and `git diff 08880fa..HEAD` contain no `1877`/`fleet`/`task-`
strings in commits or code.

## Blocking finding

### B1: a second `battle` command request in the same tick silently strands one fiber forever, or crashes the game if the scene is already active

`SessionState.interp.pendingBattle` (`interpreter.ts:627`) is a **single** slot, unlike the
array `pendingMoveRoutes` the codebase already uses for the analogous "more than one fiber
can publish this in the same tick" case (`interpreter.ts:1373` sets `s.pendingBattle = {...}`
by plain overwrite, no accumulation). `runFiber`'s `battle` case parks the issuing fiber
(`f.mode = "external"`) unconditionally, whether it is `s.main` or a `s.parallels[key]`
fiber, *before* the tick's single request field is read by the session layer
(`session.ts:936`, `if (s.interp.pendingBattle) startBattleScene(...)`).

Two fibers requesting a battle inside the **same** reference tick is directly reachable
because KB2 deliberately keeps parallel fibers ticking during and around battles (the
`stepSession` loop always calls `stepInterpWithExtensions` — see "world continues" note
below), and a freshly-started parallel fiber runs in the same
`stepInterpWithExtensions` call that starts it (`scanTriggers` before the
`for (const key of Object.keys(s.parallels).sort()) runFiber(...)` loop, `interpreter.ts`
around 1420). I reproduced two concrete failure modes with two tiny test projects (methodology
below; not committed):

1. **Silent corruption, no exception.** Two `parallel` events on the same map, each an
   unconditional `{op:"battle"}` as their first command. On frame 1 both parallel fibers
   start and run; `p1` executes `battle` first (parks, `mode:"external"`), `p2` executes
   `battle` second and **overwrites** `s.interp.pendingBattle`. `session.ts` only sees `p2`'s
   request, so `s.scene.fiber === "a/p2"`. `a/p1` is left permanently parked
   (`mode:"external"`) with nothing ever resuming it — `continueBattle`/`continueExternal`
   are only ever called for `scene.fiber`. I stepped 200 more frames (including winning the
   `p2` battle) and `a/p1`'s trailing command (`switch id:"done.p1"`) never ran;
   `state.interp.parallels["a/p1"].mode` stayed `"external"` forever. No error, no test
   catches this — it is a silent, un-debuggable stuck event.
2. **Hard crash.** A `main` fiber starts a battle via `autorun`; while that scene is active,
   a `parallel` fiber (armed on a later tick) also executes `{op:"battle"}`. `startBattleScene`
   (`session.ts:567-569`) throws `battle: nested request from ... while ... is active` —
   this is an **uncaught exception that propagates out of `stepSession`**, i.e. it crashes
   the whole game loop (`GameView`'s `onFrame` only catches `MapNotReadyError`,
   `GameView.tsx:536-537`). There is no graceful "ignore/queue the second request" path.

Both are directly reachable in real Tuxemon content, not a contrived corner case: per
Scout S4/commander data, trainer "sight" detection (`char_at`/`char_moved`, `not
char_defeated player` guards) is the standard pattern for the 283 trainer battle triggers,
and such continuous-polling detectors are naturally modeled as `parallel` (or self-looping
`autorun`) pages — exactly the fiber kind this bug hits. Two trainers who can both notice the
player in the same frame (adjacent sight cones), or a second trainer noticing the player
while already mid-battle with a first one, are ordinary level-design situations, not edge
cases. Route 2/City Park/Route 3 (§7 of S4) already puts 3+ NPCs in view together.

This is a correctness/robustness gap in the **generic** KB1/KB2 machinery — nothing
Tuxemon-specific about it — and the spec explicitly asked me to judge exactly this class of
risk (review item 3, "若会导致战斗期间 parallel 事件…问题，给出建议"). The fix belongs in KB2:
either reject/defer a second `battle` request within the same tick deterministically (with a
typed, catchable error or a documented queuing rule) instead of silently overwriting the
slot, or restrict `battle` to the main fiber only and document that a game must gate
sight-trigger events with an ext condition that reads "is a scene already active" before
publishing another one. Given the array precedent already set by `pendingMoveRoutes`, the
straightforward fix is the same shape: accumulate `pendingBattle` into an array and either
queue overflow requests for the next tick or surface a typed, catchable rejection rather than
an uncaught throw.

**Repro method** (for reproduction, not committed — scratch files were removed after
verification): a project with two `parallel` `GameEvent`s at different map cells, each with a
single-page `{op:"battle", setup:{enemyHp:99}}` command, run through
`createSession(p, 60, {battle: toyBattleRules})` → `startSession` → one `stepSession` call.
Confirmed with `bun test <scratch file>`.

## Other requested checks

### Interface coverage vs Scout S4 §4.3

Walked every row builder's report and my own reading of `battle.ts`/`extensions.ts`/
`session.ts` cover:

- `add_monster` (incl. variable monster name): expressible — an `ext` command handler
  receives the live `variables` bank (`extensions.ts:14`, `ExtensionReadContext.variables`),
  so a game handler resolves `{monsterVar:"v.billie_choice"}` itself; no kit change needed.
- `start_battle`/`start_double_battle`, team + write-back
  (`bo.<npc>.won/lost`, `boc.<npc>.won`, `v.battle_last_result/...`): `setup` is opaque game
  JSON and `BattleCompletion.writes` lands directly in `sw.variables`
  (`session.ts:673-674`) — fully expressible for **variable**-shaped write-backs. One caveat:
  `writes` can only set variables (`Record<string, string|number>`), never the built-in
  `switches` bank; S1's P1 placeholder used boolean switches (`bo.<npc>.won`) for this. Not a
  blocker — GB4 can store battle history inside `ext` and expose `bo.*`-style booleans through
  an `ext` **condition** instead of a built-in switch — but it does mean GB4's importer cannot
  reuse the P1-era switch-kind page conditions verbatim; they need regenerating against ext
  conditions. Worth a note in the GB4 spec, not a KB1/KB2 defect.
- `random_encounter` (`start()` returning `null` resumes the fiber immediately, no scene):
  verified directly — `tests/battle.test.ts:116-126` and my own reading of
  `startBattleScene` (`session.ts:582-586`) confirm a `null` start calls `continueExternal`
  with no scene created, consuming exactly one RNG draw either way.
- `char_defeated player` (ext condition over `ext` party HP): expressible —
  `ExtensionConditionHandler` gets the same read-only `ext` plus switches/variables.
- `set_teleport_faint`/`teleport_faint` (transfer by variable): native —
  `TransferMap`/`TransferCoordinate`/`TransferDirection` all accept `{variable:"id"}`
  (`types.ts:31-33`), resolved strictly at execution time (`interpreter.ts` `resolveTransfer`).
- `set_monster_health/status`: expressible as an ordinary `ext` command mutating whatever
  party shape the game keeps in `ext`.

GB2's `createBattle`/`reduceBattle` (`~/.fleet/worktrees/task-1866/battle/tuxemon.ts:1082-1122`)
return "ordinary JSON" per their own doc comment and take a `db` + `decision`, not raw button
input — this fits `BattleRules` cleanly: `start()` closes over `db` and calls `createBattle`,
`done()`/`step()` need a GB4-side adapter that turns `BattleInput` into a
`TuxemonBattleDecision` plus a menu/animation phase kept inside the JSON state (the same shape
`toyBattleRules` already uses for its `choice`/`animate` phases). No semantic change to GB2's
reducer is required.

### Determinism / rewind / save

- `canSave` (`save.ts:60-75`) correctly requires `scene === null` **and**
  `pendingBattle === null`. I mutated out the `scene === null` clause and confirmed the
  existing suite did *not* catch it for a `main`-fiber battle (the `!isBusy(interp)` clause
  already blocks that case independently, since the parked main fiber keeps `s.main` non-null)
  — but a battle started from a **parallel** fiber only (`s.main` stays `null` the whole time)
  *does* let `createSessionSnapshot` succeed mid-battle with the mutation applied, and my own
  added test catches it. This is a real coverage gap (not a bug in the shipped code — the
  existing `scene === null` guard is correct and necessary) worth adding as an explicit test
  case in a follow-up: a parallel-only-triggered battle, saved several frames after entry.
- Reproduced the builder's two claimed mutations conceptually (host `Math.random` in step
  reducer, module-level hidden RNG cursor) — the reasoning holds: `toyBattleRules.step` never
  reads anything but its own `state.rng`, and `battle.test.ts`'s "toy damage is independent of
  host randomness" / "branch entirely from SessionState" tests assert exactly that shape, so a
  regression there would fail them.
- Rewind: `tests/battle.test.ts:224-273` (map→battle→map rewind, byte-identical replay) and
  `attract.test.ts` pass; I did not find a gap here beyond B1 above.
- 60/30/20/4 Hz: `tests/battle.test.ts:207-222` passes as written; the QuickJS numbers below
  are independent of Hz since they measure JS cost per host frame, not per reference tick.
- Legacy v1 saves: `hydrateLegacyV1` (`save.ts:402-413`) fills `pendingBattle: null` and
  `ext: null` for a save that predates both fields; `save-validate.ts` and the checksum path
  treat that as valid. I did not find a case where an old save is misread.

### Scene-time world semantics (review item 3)

The report's claim ("NPC/forced routes/parallel keep ticking; only input is frozen") is
accurate by reading — `stepReferenceTick` always runs `syncPages`/`stepChars`/
`stepInterpWithExtensions` regardless of `s.scene`; only the `tickInput` fed to them is zeroed
(`session.ts:727-731`). Compared to RPG Maker MV (map fully frozen during battle) and Tuxemon
(world state paused under the battle state), this is a deliberate divergence, and it is the
direct cause of finding B1: keeping parallel fibers live during a battle is what lets a second
`battle` request collide with the first. Freezing NPC motion during a scene would be a
reasonable, more MV-like default and would remove most of the exposure (a walking NPC could
still, in principle, own a `parallel` page that publishes `battle`, but the far more common
"stand still and watch" sight-check pattern would degrade to something that never runs mid
scene). I'd suggest making battle-time world-freeze a `Session`/`createSession` option (default
either way is defensible) rather than requiring it, but B1 needs a fix regardless of which
default is chosen, because the same collision can happen on the very tick a scene *starts*
(two parallels firing together), before any freeze policy would apply.

### Unregistered `call` / preview no-op

`tests/extensions.test.ts:97-121` verifies `createSession` throws listing every unregistered
command/condition call, and that `{allowUnknown: true}` must be passed explicitly for a preview
session to treat them as no-ops/false. Matches spec item 4.

### Bundle size

Reproduced: `dist/sunstone.js` is 399,670 bytes (matches report exactly); the guard in
`tests/sunstone-game-sim.test.ts:417` is `415_000`. I confirmed `examples/sunstone` registers
**no** `battle` or `extensions` option at all (`grep -rn "battle\|extensions"
examples/sunstone/*.ts*` — no hits), yet the bundle still grew by ~35 KB over the 365 KB KR1
baseline. The KB1/KB2 code (`extensions.ts`, `battle.ts`, the extended `interpreter.ts`/
`session.ts`/`GameView.tsx` paths) is wired directly into the always-reachable core fold
(`stepInterpWithExtensions`, `stepSession`, `GameView`'s scene branch), so Bun's bundler cannot
tree-shake it out for a game that never calls `createSession(..., {battle, extensions})`. This
matches the review brief's expectation and is explicitly **not required to be fixed in this
task**; if a future game wants to avoid the cost, the options are (a) a stripped
"map-only" build target that omits the scene/extension code paths at the bundler level via a
build flag, or (b) splitting `battle.ts`/the battle-specific half of `session.ts` into a
separate entry point games opt into. Given KR1-perf and K4 are adding their own increments on
other branches, the combined merge will eat further into the 15,330-byte (3.84%) headroom the
report notes; worth remeasuring once those land.

### QuickJS performance

Reproduced independently with the documented harness:

```
$ bun build findings/KB12-bench.ts --format=iife --target=browser --outfile=/var/tmp/fleet/1884/KB12-bench.js
$ BENCH_SCRIPT=/var/tmp/fleet/1884/KB12-bench.js /var/tmp/kit-scrub-scratch/target/release/deps/pocket_desktop_host-0010752dfe1701fe qjs_script_bench::qjs_script --ignored --exact --nocapture

map_walk_ms_per_frame=0.038548
battle_active_ms_per_frame=0.119464
battle_enter_ms_per_frame=0.091043
battle_exit_ms_per_frame=0.136222
```

Matches the report's medians (0.038065 / 0.120772 / 0.093958 / 0.136581) closely — well within
run-to-run noise. All four remain far under a 4 Hz frame's 250 ms budget.

### schema / CHANGELOG / README / editor

`src/data/CHANGELOG.md` has a new "v1 amendment" entry describing all four additions and their
backward-compatible defaults; `src/data/schema.json` and `editor/engine/projects.ts` carry
matching `oneOf` variable-ref unions and the new `ext`/`battle` command/condition shapes,
`additionalProperties: false` throughout. `src/engine/README.md` and the root `README.md` both
describe the new API surface (spot-checked, not quoted in full here). No specialized editor
form was added, matching the spec's "raw JSON is enough" allowance.

## Verdict rationale

Everything the spec and Scout S4 asked to check passed except B1, which is a real,
reproduced, silent-or-crashing correctness defect in the generic KB2 machinery, directly
reachable by ordinary Tuxemon-shaped content (parallel sight-trigger events), with no test in
the 702-test suite that exercises two fibers requesting `battle` in the same tick. That is
enough to block merge until `pendingBattle` gets the same "more than one request per tick"
treatment `pendingMoveRoutes` already has, or `battle` is restricted to the main fiber with
that restriction enforced (not just documented).

PASS-worthy aside from B1: gates green, byte-stable build, no `bun.lock`/`vendor` drift, no
task-number leakage, interface expressive enough for GB2/GB4, QuickJS numbers reproduced,
schema/CHANGELOG/README complete, legacy-save hydration correct, rewind/multi-Hz correct for
every scenario the shipped tests actually exercise.

FAIL
