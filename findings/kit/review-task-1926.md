# Review of task 1926 (KB5 — shared session backpack/wallet)

Spec: `/var/tmp/fleet-specs/pocket-tuxemon/kit-KB5-shared-bag.md`.
Reviewed range: `fdc54ca..84537b3` on branch `fleet/task-1926`
(`c0690f2` feat, `dfb42d9` test, `df8f40c` docs, `84537b3` report).

## Gates (rerun myself)

- `bun run build:example`: exit 0, all fixtures/examples built (meadow, sunstone,
  grow, wander, r2-ui, streamed, event-model, editor, ui-theme).
- `bunx tsc --noEmit`: exit 0, no diagnostics.
- `bun test`: **851 pass, 0 fail**, 465,955 `expect()` calls across 56 files,
  82.9s — matches `findings/KB5.md` line 55.

## Point-by-point against the spec

1. **`BattleRules.start` 4th read-only context** — `src/engine/battle.ts:36-52`
   adds `context: ExtensionReadContext` as the 4th parameter of `start`.
   `src/engine/session.ts:670-687` builds it from live `s.interp.sw`
   (switches/variables/items/gold) plus a cloned `ext`, captured at the moment
   the queued battle actually starts. A three-parameter implementation stays
   valid: `tests/shared-inventory.test.ts:196-216` runs a literal
   3-arg-signature `BattleRules.start` through the real session and asserts it
   is still called once and its `scene.state` is set. **成立.**

2. **`BattleCompletion`/`ExtensionCommandResult.items`/`gold`, atomic before
   branch/next command, clamped, maxPerItem/maxKinds** —
   `src/engine/battle.ts:33-40`, `src/engine/extensions.ts:28-33` add the
   optional fields. `src/engine/session.ts:818-853` (battle) and
   `src/engine/interpreter.ts:1439-1531` (`ext`) validate the whole patch,
   normalize through the shared `replaceItemCounts`/`clampFiniteVar`
   (`src/engine/interpreter.ts:1206-1237`), then commit items/gold together
   with ext/writes/switches before, respectively, `continueBattle` resumes the
   result branch or `top.pc++` advances to the next instruction. Rule for
   overflow, written down in README/CHANGELOG: existing positive kinds keep
   their slot; zero removes; previously-unheld positive ids are admitted in
   **lexical id order** up to `maxKinds`, remainder silently dropped — this is
   documented in `src/engine/README.md` and `src/data/CHANGELOG.md`'s new "v1
   amendment — 2026-09-29" section. `maxPerItem` defaults to `SHOP_ITEM_CAP`
   (99), same constant the shop path already uses. **成立.**
   - I mutated `replaceItemCounts` to skip the `maxKinds` check
     (`src/engine/interpreter.ts:1236`) and mutated the battle-completion gold
     clamp to skip `Math.max(0, clampFiniteVar(...))`
     (`src/engine/session.ts:837`): both mutations turned tests red
     (`item replacements clamp and admit new kinds…` and `battle item and gold
     writeback has the same semantic state at every supported Hz`), then I
     reverted both (`git checkout --`, confirmed clean + tsc 0 after). The
     safety rails are load-bearing, not decorative.
   - I also mutated the item-write ordering in `advanceBattleScene` to happen
     after `continueBattle` instead of before it; all 7 shared-inventory tests
     still passed. This is because `advanceBattleScene` runs once at the very
     end of a host frame's tick batch (`src/engine/session.ts:926-934`) and the
     branch's own commands only execute on the *next* frame's
     `stepInterpWithExtensions` call — so no test in this suite can
     distinguish "before continueBattle" from "before the next frame's
     interpreter step" within the same function. This is a **test-coverage
     gap**, not a correctness bug: I could not construct an observable
     within-frame reordering because `continueBattle` itself only flips fiber
     mode and pushes a continuation, it does not run any commands
     synchronously. Not blocking — the code visibly commits items/gold ahead
     of `continueBattle` and ahead of the return from `advanceBattleScene`,
     matching the documented ordering — but a future regression that swaps
     order only within `advanceBattleScene` (not across frames) would not be
     caught by the current suite.

3. **Compatibility** — legacy 3-arg `start` test as above. `canSave` untouched:
   `grep canSave src/engine/session.ts` shows no diff in that function (not in
   the diff stat at all). No new schema field was needed at the save boundary:
   `SessionState.sw.items`/`gold` already existed pre-KB5 (used by shops), so
   the diff touches no code in `save.ts`/`save-restore.ts`; old envelopes still
   decode the same shape. CHANGELOG has the new "v1 amendment" entry;
   `README.md`/`src/engine/README.md` both updated to match code exactly
   (verified by reading the diffs against the implementation, not just
   trusting prose). **成立.**

4. **Cross-functional integration (重点)** —
   `tests/shared-inventory.test.ts` has the exact chain the spec asked for:
   - `BattleRules.start reads a purchase from the same backpack and wallet`
     (buy a potion in a shop, `battle` command starts, `context.items`/`gold`
     inside `start` sees the post-purchase state) — lines 178-217.
   - `a battle reward immediately drives the shop sell list and survives
     save/restore` (battle `done()` awards items+gold, next shop's sell list
     shows the right owned count and sale price, gold updates, then a full
     `createSessionSnapshot`/`encodeEnvelope`/`restoreSessionEnvelope` round
     trip preserves both banks) — lines 233-263.
   - `rewind refolds item and gold replacements from the clean session` (an
     `ext` command award, rewind with `L`, then refold to the same frame
     reproduces identical state) — lines 265-286.
   - `battle item and gold writeback has the same semantic state at every
     supported Hz` (60/30/20/4) with overflow triggered on both banks at once
     — lines 288-318.
   - Same-tick visibility for `ext` writes to a following `if item`/`if gold`
     condition and a following `ext` read — lines 99-136.
   I reran all of these live (not just trusting the report) via
   `bun test tests/shared-inventory.test.ts` (7 pass, 53 assertions) both
   clean and against each mutation above. **成立.**

5. **Bundle/repo hygiene** — `git diff fdc54ca..84537b3 --name-only`: only
   `README.md`, `findings/KB5.md`, `src/data/CHANGELOG.md`,
   `src/engine/README.md`, `src/engine/battle.ts`, `src/engine/extensions.ts`,
   `src/engine/interpreter.ts`, `src/engine/session.ts`,
   `tests/battle.test.ts`, `tests/shared-inventory.test.ts`. No `bun.lock`,
   no `vendor/`, no `.pak`/fixture/golden file touched. No Tuxemon-specific
   identifiers anywhere in the diff (`grep -i tuxemon` on the diff: empty).
   No fleet task numbers in code or commit messages (`git log
   fdc54ca..84537b3 --format='%H %s'` has none; `findings/KB5.md`'s own
   "KB5" title is the spec's own naming, not a fleet task id, and is scoped to
   the findings doc). Commit author `lfkdsk <lfkdsk@gmail.com>`, no
   Co-Authored-By/AI trailer, `feat(engine)/test(engine)/docs:` prefixes match
   repo convention. **成立.**

## Blocking issues

无. The one gap noted in item 2 is a test-coverage note, not a defect —
the implementation itself commits items/gold ahead of the branch resume in
`advanceBattleScene`, and every invariant I could actually falsify by mutation
(maxKinds enforcement, gold clamp) turned tests red as expected.

## Verdict

PASS
