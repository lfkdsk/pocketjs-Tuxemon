# Review of task 1946 — PR #1 rebase onto current main

Reviewed worktree `~/.fleet/worktrees/task-1946`, branch `fleet/task-1946`, HEAD
`6d1ec20`, baseline `main` = `a0857e0`. Spec: `kit-PR1-rebase.md`. Prior
read-only review: `/var/tmp/fleet/pr-review-doodlewind/findings/doodlewind-prs-review.md`.
Builder's own report: `findings/PR1-rebase.md` (not re-quoted verbatim below;
every claim in it was independently re-derived from source or re-run).

## 1. Authorship and commit structure

- `git range-diff 4dfb651...pr-1 4dfb651...923b87e` shows the rebased commit
  is a genuine adapted cherry-pick of the original `ca83cc6f` (same hunks,
  contextually rewired around new main symbols like `ExtensionScope`,
  `activeIndexAt`), not a rewrite.
- Commit messages are byte-identical to the original PR-1 commits (`diff <(git
  show -s --format=%B ca83cc6f) <(git show -s --format=%B 923b87e)` etc. all
  empty), and author identity is preserved: `923b87e`/`352da31`/`a2fc53c` are
  all `Yifeng "Evan" Wang <7312949+doodlewind@users.noreply.github.com>`.
- `a2fc53c` (rebased `4607cc7f`) pins `vendor/pocketjs` to `d790b5d8`, exactly
  matching the original commit's pointer (`git ls-tree 4607cc7f vendor/pocketjs`
  = `git ls-tree a2fc53c vendor/pocketjs` = `d790b5d8`). The spec's required
  final pin `d48962e8` is reached by a **separate**, correctly-attributed
  follow-up commit `a78b39b` (`lfkdsk <lfkdsk@gmail.com>`, "build: pin pocketjs
  to merged PSP performance work") — this is the right structure: the
  author's original commit is preserved verbatim, our adjustment is its own
  commit. Confirmed final submodule pointer: `git ls-tree HEAD vendor/pocketjs`
  → `d48962e82a237cc49719e5a0da72a6dbd45ff5e8`.
- All conflict-adaptation and verification work is in separate, correctly
  attributed `lfkdsk` commits: `eb365f6`, `38543af`, `6915159`, `ac3dd9b`,
  `a78b39b`, `6d1ec20`. None of these commit messages contain a fleet task
  number (`git log a0857e0..HEAD` grep for `task|1946|1950|fleet` only
  false-positive-matched the word "task" inside the original author's prose
  in `a2fc53c`'s body).

**Verdict: 成立.**

## 2. Copy-on-write purity (the core risk)

Read the actual diffs, not just the report's table:

- `eb365f6` (`fix(engine): adapt tick-copy folding to current state`) is
  exactly the three high-risk write sites the spec named:
  `src/engine/session.ts:850-856` wraps the battle-completion `variables`/
  `switches` write-back in `ownRecord(s.interp.sw, ...)`;
  `src/engine/interpreter.ts:1611` wraps the plugin-extension-command
  `variables` write-back the same way; `src/engine/interpreter.ts:1773-1789`
  wraps every shop buy/sell path (`items`, `shopStock` both directions) in
  `ownRecord(s.sw, ...)`.
- `src/engine/chars.ts:291` — `syncPagesInPlace`'s `detachPatrol` parameter
  default was changed from `false` to `true` (see §6), closing the aliasing
  gap the read-only review flagged as a non-blocking follow-up.

**Mutation check (required by the reviewer spec, done and reverted):** I
reverted three of these `ownRecord` call sites to their pre-fix direct
mutation (`interpreter.ts` shop-stock buy deduction, `interpreter.ts` ext
command `variables` write, `session.ts` battle-completion `variables`/
`switches` write-back), confirmed `bunx tsc --noEmit` still passed (the bug
is not a type error), then reran `tools/pr1-equivalence.sh`. It failed
immediately on the first queued-battle scenario:

```
error: battle-queued-60hz: retained state 0 changed after publication (produced 0f4e921a, final e164080c)
```

This is exactly the failure mode the harness is designed to catch (a later
in-place write polluting an earlier published, retained state). All three
files were restored from the pre-mutation copy and `git status --porcelain`
confirmed the worktree returned to a clean `HEAD` match. Evidence: command
transcript above; files restored via `cp` from `/tmp/*.bak`, `git diff --stat`
empty afterward.

I did not find any additional un-gated write path in `chars.ts`,
`interpreter.ts`, or `session.ts` beyond what `eb365f6` already covers;
`Session.preparingMap` is correctly treated as a derived cache outside the
published-state contract rather than forced into COW (report's table, §"Session.preparingMap" — this matches how it's used at its only call sites, which retry unchanged logical state during map preparation).

**Verdict: 成立.**

## 3. Equivalence check methodology

`tools/pr1-equivalence.ts` (784 lines) checks out the **real** baseline commit
`a0857e097c9a68880f28ace2c13e2253be886d1c` into a detached worktree (not a
self-comparison) and loads both engines as separate ES module roots. Each
`Recorder` captures a hash **at production time** (`capture()`) and keeps the
live object reference, then rehashes every retained reference **after the
entire run completes** (`finish()`) — this is precisely the "produced +
post-run rehash" method the spec required, and it is what caught my
deliberate mutation in §2.

I reran it myself (fresh scratch dir, not reusing the builder's artifact):

```
$ PR1_EQUIV_SCRATCH=/var/tmp/fleet/1946-reviewcheck bash tools/pr1-equivalence.sh \
    a0857e097c9a68880f28ace2c13e2253be886d1c /var/tmp/fleet/1946-reviewcheck/result.json
...
PR1_EQUIV PASS scenarios=37 states=12376
```

Identical scenario count and state count to the builder's report. Coverage
checked against the spec's required list, all present in
`tools/pr1-equivalence.ts`: `sunstoneTraces` (60/30/20/4 Hz journey + frozen
tape + attract at 4 Hz rates = KF-adjacent parity), `wanderTraces`,
`growTrace`, `sessionFixtureTraces` (meadow, event-model, r2-ui, streamed),
`repositoryTraces` (KR1 inline-vs-sharded parity at 4 Hz rates),
`battleTraces` (KB2 queued-battle ordering at 4 Hz rates, KB4 win sequence at
4 Hz rates, and a dedicated `battle-rewind-boundaries` scenario that rewinds
across a battle's start/end), `shopTrace` (K4 shop buy/sell with an actual
`encodeEnvelope`/`restoreSessionEnvelope` save round-trip mid-run), and
`dialogTraces` (KF2 message-blocks-player freeze at 4 Hz rates).

**Verdict: 成立.**

## 4. DialogBox three-panel persistent mount

`src/ui/DialogBox.tsx` now mounts all three panels — `rpgkit-choices-box`,
`rpgkit-shop-box`, `rpgkit-message-box` (line ~171/220/300) — unconditionally
and switches visibility with `display: 0/1` (`choicesDisplay`/`shopDisplay`/
`messageDisplay`), extending the original PR's message/choice-only technique
to the shop panel current main added.

Scroll-window correctness: both the choices and shop rows compute
`windowStart(m()?.index ?? 0, total(), VISIBLE_ROWS)` **inline, every
reactive recomputation**, deriving directly from the live modal cursor
(`DialogBox.tsx:186,243`) rather than from any persisted local scroll-offset
signal. Since persistent mounting cannot introduce any stale local state that
doesn't already get recomputed from the reducer's current modal object, there
is no scroll-desync risk from staying mounted.

Node budget: `tests/sunstone-game-sim.test.ts` (commit `ac3dd9b`) asserts
`nodes < 130` with a comment recording the measured value 119 (11 nodes of
headroom) and explaining the composition (13 NPC images + ground/upper/
player/root + message host with all three panels + fade). This is part of the
910-test green run I reproduced (§ gates below), so the measured count is
consistent with the assertion passing.

Visual check — opened all 8 PNGs referenced by the report:
- `dialog-text.png`: message box text contained within its band, no clipping.
- `dialog-choices-scroll.png`: 4-row choice window, selected row highlighted,
  long option truncated with `…`, `ok back` legend visible — correct.
- `dialog-shop.png`: Buy stage header with gold total, three priced item rows
  plus Sell row, selection cursor on second row — correct.
- `tests/goldens/kb4-battle.{command,hit,faint,winmsg,losemsg}.png`: command
  menu (Fight/Skill/Guard/Run), hit message "Rock", faint state (HP bar at
  0/1, sprite dimmed blue), win message "You win!", lose message "You lost…"
  — all render as expected, HP bars and sprites visible, no overlap.

**Verdict: 成立.**

## 5. Performance

Reran `tools/pr1-quickjs-bench.sh` myself (fresh scratch dir, real QuickJS
guest built from the pinned desktop host, interleaved main/candidate/
candidate/main, 2000 iterations × 9 rounds):

```
PR1_QJS label=main      case=sunstoneIdle  mean_us=138.499 / 135.560
PR1_QJS label=candidate case=sunstoneIdle  mean_us=73.807 / 73.011
PR1_QJS label=main      case=sunstoneWalk  mean_us=144.201 / 146.125
PR1_QJS label=candidate case=sunstoneWalk  mean_us=83.242 / 78.619
PR1_QJS label=main      case=wanderAuto    mean_us=388.047 / 387.556
PR1_QJS label=candidate case=wanderAuto    mean_us=275.864 / 280.501
PR1_QJS label=main      case=battleScene   mean_us=136.443 / 138.620
PR1_QJS label=candidate case=battleScene   mean_us=134.016 / 134.254
```

This independently reproduces the report's claimed magnitudes (≈45% off
Sunstone idle, ≈43% off Sunstone walk, ≈28% off Wander auto, flat-to-slightly-
better on the battle scene tick — no regression). The method matches the
mandated QuickJS-guest style (`tools/pr1-quickjs-bench.rs` is included into a
copy of the pinned desktop host crate via `include!`, same technique as
`kit-scrub-scratch/run-bench.sh`), not a Bun/JSC number.

**Verdict: 成立.**

## 6. Named follow-ups from the read-only review

- `detachPatrol` default: **fixed to `true`** (`src/engine/chars.ts:291`,
  confirmed above), plus a new regression test `tests/chars.test.ts` "a
  page-switch patrol template is detached by default" added in `eb365f6`
  that exercises the *public* `syncPages` entry point (default parameter),
  not just the in-place helper.
- `World.keyedEvents` invalidation: documented in place at
  `src/engine/interpreter.ts:709-711`: "This index assumes map.events is
  immutable; callers that replace or mutate that array must rebuild the
  World so the cache is invalidated."
- `bun.lock`: `git diff --stat a0857e0 -- bun.lock` is empty.
- Commit messages: no fleet task numbers, verified in §1.

**Verdict: 成立 (all four items).**

## Required gates — independently reproduced, in the mandated order

```
$ bun run build:example   → exit 0, all 8 example/fixture bundles built
$ bun run build:wasm      → exit 0, pocketjs.wasm 289,510 bytes (matches report)
$ bun test                → 910 pass, 0 fail, 467,641 expect() calls, 60 files (matches report exactly)
$ bunx tsc --noEmit       → exit 0
$ git status --porcelain  → clean (worktree + submodule)
$ git diff --stat a0857e0 -- bun.lock → empty
$ git diff --stat a0857e0 -- tests/goldens/ → empty (goldens byte-identical)
```

No discrepancy between the builder's claimed numbers and what I reproduced.

## 阻断项

无.

## 非阻断观察

None beyond what's already tracked as documented, non-blocking limitations in
the source comments themselves (`Session.preparingMap` COW exclusion,
`World.keyedEvents` immutability assumption) — both are correctly scoped to
the current codebase's actual capabilities and already called out in-repo.

PASS
