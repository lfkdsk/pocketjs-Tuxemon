# Review: task 1896 (KB1+KB2 fix 2 — restore general fiber order + fatalize transfer content errors)

Reviewed branch `fleet/task-1877` (HEAD `609154e`) against pre-fix2 HEAD `860178f`
(reviewed FAIL in `findings/review-task-1886.md`, on top of the earlier FAIL in
`findings/review-task-1877.md`), spec `kit-KB12-fix2.md`, and `reviewer-generic.md`.

## Gates (reproduced myself, in the required order)

```
$ bun run build:example      -> exit 0
$ bun test                   -> 717 pass, 0 fail, 457308 expect() calls, 46 files [83.94s]
$ bunx tsc --noEmit          -> exit 0
```

Matches the builder's report exactly (`findings/KB12.md` claims the same 717/0/457308).
`git diff 860178f..HEAD --stat -- bun.lock vendor/` is empty. `git log 860178f..HEAD` has
no fleet/task-number strings in any commit subject; `git diff 860178f..HEAD` has no such
strings in code — the only hits are in `findings/KB12.md` itself (bench command paths
`/var/tmp/fleet/1886/...` → `/var/tmp/fleet/1896/...`), which is the report file, not code
or a commit message, so this does not violate the hygiene rule.

Two consecutive `bun run build:example` runs (after `rm -rf dist`) produced identical
`sha256sum` for `dist/sunstone.js`/`dist/sunstone.pak` — byte-stable, confirmed independently.
`git status --short` was clean after both rebuilds (no golden diffs).

## Item 1 — general fiber execution order restored, battle queue ordered separately

`git show 3b35acc -- src/engine/interpreter.ts` is the whole fix: the loop order in
`stepInterpWithExtensions` (`interpreter.ts:1449-1462`) is back to "parallels first
(ascending key), then main," with the removed invariant restored, and a
`queuedBattleCount`/`splice`/`push` staging step layered on top that appends this tick's
*newly emitted* battle requests main-first-then-parallel-key behind the persistent FIFO,
without touching who runs when for anything else.

I confirmed this is the exact original (pre-KB1, baseline `08880fa`) order, not just an
approximation: `git show 08880fa:src/engine/interpreter.ts` around `stepInterp`'s fold has
the identical comment — "Parallels first (ascending key), then the blocking fiber, so a
parallel can never observe a value the main fiber sets later in the same frame" — and the
identical `for (parallels) ...; if (s.main) runFiber(...)` shape. Fix 2 reproduces this
verbatim (modulo the battle-queue splice, which is additive and does not change any other
command's ordering).

- **Minimal repro (spec's exact scenario).** `tests/interpreter.test.ts:621` ("parallels run
  before main for general same-tick visibility"): a main-fiber `autorun` sets `v.x=1` and
  then, in the *same* command list, reads `v.parallel==1` to set `v.mainSawParallel`; a
  `parallel` page sets `v.parallel=1` and then reads `v.x==1` to set `v.y`. Asserted:
  `v.x===1`, `v.y===undefined` (parallel does not see main's later same-tick write — matches
  the pre-fix1 baseline, reverses the fix-1 regression flagged in review 1886), and
  `v.mainSawParallel===1` (main *does* see the parallel's earlier same-tick write — the
  spec's required symmetric direction). I ran this test directly; it passes as written.
- **Mutation: reverse the order back to fix-1's main-first-then-parallel shape.** I edited
  `interpreter.ts` to run main before parallels (swapping which loop runs first, keeping the
  battle-queue splice logic intact) and reran `tests/interpreter.test.ts` +
  `tests/battle.test.ts`: the new regression test fails exactly as expected
  (`v.y` becomes `1` instead of staying `undefined`), 80 pass / 1 fail. All battle tests still
  passed under this mutation (expected — battle-queue ordering is now decoupled from general
  fiber order). Reverted cleanly (`cp` from a saved backup, confirmed `git status --short`/
  `git diff --stat` empty afterward).
- **Baseline comparison for ordinary content.** `tests/interpreter.test.ts` retains its
  pre-existing parallel/main interaction tests unmodified in this diff (`git diff
  860178f..HEAD -- tests/interpreter.test.ts` shows only the one new test added, nothing else
  touched): "a parallel event runs concurrently with an open dialog" (:603), "only one
  blocking fiber runs: an autorun is not interrupted by an action" (:646), "C09: a queued
  parallel line does not overwrite the main dialog slot" (:672), "C11: a canceled parallel
  page never resumes a stale wait" (:694), "C12: punctuation ids arbitrate by explicit code
  points" (:657) — all pass at HEAD exactly as they did at `860178f` and at the `08880fa`
  baseline (the loop body is byte-identical to `08880fa` except for the additive
  battle-queue splice). Combined with the verbatim-comment match above, non-battle same-tick
  semantics are unchanged from baseline, not merely "close."

## Item 2 — battle queue order (main priority, parallel keys ascending)

- Fix 1's FIFO/collision tests are all still green in the full run above:
  `tests/battle.test.ts:192` ("a main request precedes same-tick parallels, whose keys sort
  ascending"), `:155` (two parallels FIFO), `:339` (parallel request mid-scene queues without
  throwing), plus the freeze/rewind/save tests.
- **Mutation: remove the queue reordering.** I deleted the `parallelBattles`/`mainBattles`
  splice-and-requeue step (letting `pendingBattles` accumulate in plain run order —
  parallel-battles first, since parallels now run first) and reran
  `tests/battle.test.ts`/`tests/interpreter.test.ts`: exactly the FIFO-order test fails
  (`state.scene?.fiber` is `"a/a-next"` instead of `"a/battle"`), 80 pass / 1 fail, while the
  new general-visibility test still passes — confirming the two concerns are cleanly
  decoupled and the queue-ordering test is discriminating. Reverted cleanly.

## Item 3 — content path does not throw

`resolveTransfer` (`interpreter.ts:1114-1146`) and the new `transferMapKnown` check in
`stepReferenceTick` (`session.ts:1023-1030`) now record `s.error = { kind: "content", message
}` and return `null`/short-circuit instead of throwing, for all four live-operand failure
classes: empty/non-string map, non-integer/negative coordinates, invalid direction string, and
an unknown resolved map id.

- **Four discriminating tests**, `tests/extensions.test.ts:236-296` (table-driven): unset map
  variable, non-integer coordinate, invalid direction, and non-existent map — each asserts
  `step()` does **not** throw, `interp.error` is set with the exact expected message, the
  event's trailing `switch` command never ran, `createSessionSnapshot` throws (save refused),
  and a further `step()` leaves `interp`/`move`/`chars` byte-identical except the frame clock.
- **Mutation: revert one branch to `throw`.** I changed the "empty/non-string map" branch in
  `resolveTransfer` back to `throw new Error(...)` (its pre-fix2 shape) and reran
  `tests/extensions.test.ts`: exactly the corresponding scenario's test fails on `expect(() =>
  { failed = step(...) }).not.toThrow()`, 10 pass / 1 fail. Reverted cleanly.
- **UI visibility.** `src/ui/GameView.tsx` now derives a `fatalError` signal from
  `state.interp.error?.message` and renders an "EVENT ERROR" overlay with the message when
  non-null. `tests/battle-scene-sim.test.ts` ("shows a fatal content error and keeps the
  reducer frozen") drives the real Solid/wasm UI harness (`bootGameWorld`) through a fixture
  that fires an unset-variable transfer, and asserts the rendered tree contains "EVENT ERROR"
  and the exact message, and that a further tick leaves `interp`/`move` unchanged except the
  frame counter. I read this test and its fixture (`tests/fixtures/r2-ui/r2-ui.tsx`); it
  exercises the real component tree, not a mocked one.
- **`stepSession`-reachable `throw` audit**, redone independently (not just trusting the
  builder's grep): every remaining `throw new Error(...)` in `interpreter.ts`/`session.ts`/
  `extensions.ts`/`save.ts` falls into one of: (a) extension command/condition
  registration-or-return-shape checks, pre-validated at `createSession`/map-acquisition for
  registration, and a registered-handler contract violation for return shape (both
  now explicitly commented as such at the call sites, e.g. `interpreter.ts:1060-1064`,
  `1085-1088`); (b) `BattleRules.start/step/done`/completion shape checks and the
  scene-active invariant (`session.ts:585,588,604,645-725`), likewise game-registered-code
  contract violations, with the scene-active throw's precondition still enforced only by
  `startNextBattleScene`'s `while (s.scene === null && ...)` loop; (c) project/session
  construction, sharded-map acquisition integrity (schema/manifest/payload/checksum), and
  save envelope/checksum/shape validation — all load/setup/save-time boundaries, never
  per-frame content execution. I did not find a new or pre-existing throw reachable from
  ordinary authored event/variable/condition content left unaddressed. "Unknown map before
  effects" (commit `6a6a95f`) closes the one gap the spec named explicitly (an unknown
  variable-addressed destination map used to only be caught by whatever threw inside
  `acquireSessionMap`/`releaseSessionMapsExcept`; it is now caught by `transferMapKnown`
  before any side effect runs, converting it to the same `content`-kind fatal state).
- **Legal content unaffected.** `tests/extensions.test.ts`'s existing variable-transfer
  success test (":233" area, "an ordinary variable-addressed transfer resolves...") and the
  broader `tests/battle.test.ts`/`tests/interpreter.test.ts` transfer coverage are unmodified
  and still pass, so a well-formed variable transfer is unaffected by the new validation.

## Item 4 — multi-Hz frozen-wait test and legacy `pendingBattle` save test

- `tests/battle.test.ts` ("a parallel 30-tick wait excludes battle freeze time at every
  supported Hz") drives a battle to completion at 60/30/20/4 Hz with an independent parallel
  `wait 30/60` timer running throughout, and asserts
  `fireTick - freezeTicks - battleEntryTick === 30` at all four rates — this is the exact
  method the prior review (1886) used to verify the freeze-timer correction by hand; it is
  now a committed regression. I read the test; it correctly separates host-frame-quantized
  entry/freeze-length effects from virtual-time wait progress, matching the spec's item.
- `tests/save.test.ts` ("rejects a legacy populated pendingBattle slot as an unsafe save
  point"): builds a v1 envelope, deletes `pendingBattles`, injects a populated single-slot
  `pendingBattle`, fixes up the checksum, and asserts `decodeEnvelopeText` throws with the
  exact `save-validate.ts:648` message ("no queued battles at a save point"). This exercises
  the real `hydrateLegacyV1` (`save.ts:402-416`, wraps the legacy slot into a one-element
  array) chained into the real, independently-reused `validateSnapshot` invariant — not a
  test-only stub. I did not need to mutate this one; the mechanism it exercises
  (`hydrateLegacyV1` + the pre-existing non-empty-`pendingBattles` rejection, both read
  directly) is shared code already covered by other mutations in this review and in
  `findings/review-task-1886.md`'s Item 3.

## Documentation

`src/data/CHANGELOG.md`, `src/engine/README.md`, and root `README.md` all disclose (a) the
general fold is unchanged (parallel-before-main) and the battle queue's main-first ordering
is a narrow, separately-staged exception, (b) variable-transfer content errors now fatalize
via `InterpState.error` instead of throwing, are shown by `GameView`, and reject saves, and
(c) legacy populated `pendingBattle` is explicitly rejected while `null` still hydrates to an
empty queue. This directly addresses the "undisclosed scope" complaint from
`findings/review-task-1886.md` — the new text names the previous risk (general order) and its
resolution explicitly, rather than only describing the battle-queue detail.

`findings/KB12.md` has a new "修复 2（复审）" section with all four required elements (gates,
mutation log including the new fiber-order mutation, byte counts, QuickJS numbers).

## QuickJS performance and bundle size

Reproduced independently with the documented harness:

```
$ bun build findings/KB12-bench.ts --format=iife --target=browser --outfile=/var/tmp/fleet/1902/KB12-bench.js
$ BENCH_SCRIPT=/var/tmp/fleet/1902/KB12-bench.js /var/tmp/kit-scrub-scratch/target/release/deps/pocket_desktop_host-0010752dfe1701fe qjs_script_bench::qjs_script --ignored --exact --nocapture

map_walk_ms_per_frame=0.041677
battle_active_ms_per_frame=0.072701
battle_enter_ms_per_frame=0.094509
battle_exit_ms_per_frame=0.097001
```

Close to the report's medians (0.040009 / 0.068840 / 0.097489 / 0.095524), well within
run-to-run noise; all four remain far under a 4 Hz frame's 250 ms budget.

`dist/sunstone.js` is **404,644 bytes**, matching the report and the spec's stated figure
exactly, 10,356 bytes (2.5%) under the 415,000-byte guard. Confirmed byte-stable across two
independent full `build:example` runs (`sha256sum` identical for both `dist/sunstone.js` and
`dist/sunstone.pak`).

## Hygiene

- `bun.lock`/`vendor/`: no diff (checked above).
- No fleet/task numbers in commits or code diff (checked above; the two hits are inside
  `findings/KB12.md`'s own bench-reproduction shell snippet, referencing this review's and
  the prior review's task numbers as file paths — a report artifact, not code/commit text).
- Commits are `lfkdsk <lfkdsk@gmail.com>`, no Co-Authored-By, English messages in the
  repo's existing style, and reasonably separated: `3b35acc` (B1 fiber order),
  `0a25412`+`6a6a95f` (B2 content-error fatalization, split into "fatalize invalid
  operands" and "reject unknown transfer maps"), `0e31359`+`ae528bd` (tests), `609154e`
  (docs).
- Goldens: full `bun test` includes framebuffer/golden assertions and is green; no golden
  file appears in `git diff 860178f..HEAD --stat`.

## Minor, non-blocking observation

`GameView`'s new fatal-error overlay reads `state.interp.error?.message` unconditionally, so
it also now surfaces the pre-existing `kind: "runaway"` fatal state (previously invisible to
players — the game just silently froze). This is a strict improvement and not a regression,
but the CHANGELOG/README prose frames the new UI surface only in terms of transfer content
errors; it doesn't call out that runaway errors are incidentally now visible too. Worth a
one-line mention in a future pass; not blocking.

## Verdict rationale

Both items the spec was reopened for are fixed and independently reproduced: (1) the general
interpreter fiber execution order is restored to the exact pre-KB1/KB2 baseline (verbatim
comment and loop shape match against `08880fa`), with battle-request queue ordering
cleanly decoupled into an additive staging step that a targeted mutation shows is what
actually drives the FIFO test (removing it breaks only that test, not the general-order
test, and vice versa); (2) variable-addressed transfer failures — unset/wrong-typed
operand and now also an unknown resolved map — fatalize through the existing
`InterpState.error` machinery instead of throwing, are visible in the real UI, freeze
subsequent frames, and reject saves, confirmed both by table-driven unit tests and a
full-stack UI-harness test, with a mutation back to `throw` catching the regression. The two
"顺带" items (multi-Hz frozen-wait regression, legacy-`pendingBattle` rejection test) are both
present and exercise real, shared code paths rather than test-only stubs. All gates
(build, 717/0 tests, tsc) reproduce exactly; bundle size, byte-stability, and QuickJS numbers
reproduce closely; no `bun.lock`/`vendor`/task-number/commit-hygiene violations found.

PASS
