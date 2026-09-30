# Review of GB3 fix 1 (task 1930)

Reviewed in worktree `~/.fleet/worktrees/task-1918`, branch `fleet/task-1918`, HEAD `f7bf5d3`
(fix commits `2f2eb42..f7bf5d3` on top of the pre-fix HEAD `cf77886`). Spec: `game-GB3-fix1.md`,
process: `reviewer-generic.md` + `review-GB3-fix1.md`. Prior review: `findings/review-task-1918.md`
(FAIL — §4d: shop `SessionState.items`/`gold` and battle `ext.inventory`/`ext.money` were two
non-communicating bags/wallets). Builder self-report: `findings/GB3.md` §10.

## 1. Checklist (spec item by item)

| # | Requirement | Verdict | Evidence |
| - | --- | --- | --- |
| Component bump | `vendor/pocket-rpgkit` → `a124186` (KB5) | **成立** | `git show 2f2eb42` touches only the submodule pointer; `git -C vendor/pocket-rpgkit rev-parse HEAD` = `a124186f70dd078eeafc109eba80a5e1fb5873eb`. |
| 1. 单一来源 | `ext` no longer carries inventory/money; importer no longer emits `tux.change_item`/`tux.has_item`; battle menu/consumption/reward go through session `items`/`gold` | **成立** | See §2. |
| 2. 跨功能整合 | Buy→battle-menu→consume→sell-back→reward→has_item→save/rewind all consistent; `tests/shared-economy.test.ts` covers it; mutations turn it red | **成立** | See §3 (I reran the test myself and independently mutated the wiring twice). |
| 3. 哈希变化来源 | New terminal hash `7fdc130b…` differs from old `e47eb756…` only by the removed ext fields/reward path, not behavior drift | **成立** | See §4 (independent before/after structural diff). |
| 4. 旧存档 | `ext.inventory`/`ext.money` from old saves discarded safely, not erroring or silently corrupting item counts | **成立，策略合理** | See §5. |
| 5. 门禁 | import ×2 no diff; build+wasm; `bun test` green; locks/determinism/frozen; desktop QuickJS both viewports; web + web-verify; `bun.lock` untouched; no fleet/task numbers in code/commits | **成立** | See §6. |

## 2. Single source of truth

```
grep -rn "tux.change_item\|tux.has_item" --include="*.ts" .
```
→ only two hits, both in `tests/importer.test.ts` (negative assertions: `.toBeFalse()` that these commands are *not* emitted, lines 535/537). No production code path (`battle/`, `importer/`) references either command any more.

`battle/extension.ts` diff (commit `52e5516`) removes `inventory`/`money` from `TuxemonExtensionState`, its initial value, its validator (`tuxemonStateProblem`), and deletes the `tux.change_item` command and `tux.has_item` condition handlers entirely — confirmed by reading the current file, not just the diff (`battle/extension.ts:41-80` no longer declares those fields).

`battle/runtime.ts:697` now seeds the reducer's per-battle inventory snapshot from `context.items` (the read-only session context passed into `BattleRules.start`), not `ext.inventory`; `battle/runtime.ts:576-579` returns `items`/`gold` on `BattleCompletion` instead of writing an `ext.money`/`ext.inventory` mirror (`completedExtension` at `runtime.ts:534-545` no longer touches `money`/`inventory` at all).

`importer/project.ts` diff: `add_item` (`:1023-1028`) now emits only `{op:"item",...}`, no `tux.change_item`; `has_item` clause construction (`:540-546`) now emits only the native `{k:"item",...}` condition, no `tux.has_item` ext condition, regardless of `options.battle`.

Traced the kit-side contract to confirm this isn't just cosmetic: `vendor/pocket-rpgkit/src/engine/session.ts:674-685` (`startBattleScene`) populates `context.items`/`context.gold` directly from `s.interp.sw.items`/`s.interp.sw.gold` — the exact same bank the shop UI reads (`interpreter.ts:1520,1528,1682,1693` mutate `s.sw.items`/`s.sw.gold` for shop buy/sell). On battle exit, `session.ts:818-853` takes `BattleCompletion.items`/`.gold`, runs `items` through `replaceItemCounts(s.interp.sw.items, itemReplacements, sess.worldOptions.inventory)` (the same clamp/cap function shops use, honoring the importer's `system.inventory.maxKinds:99`, `importer/project.ts:2107`), and assigns the result straight into `s.interp.sw.items`/`.gold`. There is exactly one bag and one wallet, and both shop and battle read/write it through the same normalizer.

## 3. Cross-feature integration walkthrough (buy → battle → consume → sell → reward → has_item → save/rewind)

I ran the submitted `tests/shared-economy.test.ts` myself rather than trusting the report:

```
bun test tests/shared-economy.test.ts
 1 pass / 0 fail, 24 expect() calls
```

Reading the test (`tests/shared-economy.test.ts:216-306`) confirms it walks the exact path the
spec asks for, using the real imported `cotton_scoop`/`taba_town` content
(`buildProject(["cotton_scoop","taba_town"], G6_IMPORT_OPTIONS)`, not a synthetic project): buy 2
potions + 2 tuxeballs at the imported Cotton Scoop shop (`sw.items` → `{potion:2,tuxeball:2}`) →
next battle's Item/Capture menu shows the same counts (`runtime.battle.inventory` matches) →
consuming one of each drops the in-battle snapshot to 1/1 → after the battle, `sw.items` shows
`{potion:1,tuxeball:1}` → the shop's sell-back rows show `owned:1` for both → a trainer-battle win
credits 20 gold to `sw.gold` → that gold buys another potion back at the shop → the imported
`has_item(potion,2)` condition (extracted from the real project, not hand-written) fires
(`condition.sees.items` switch set) → `tuxemonExtensionState(...)` no longer has `inventory`/`money`
→ `restoreSessionEnvelope` round-trip leaves `sw`/`ext` `toEqual` the live state → an `L` rewind to
frame 0 restores `sw.items = {}` / `sw.gold = 140` (the harness's starting gold) → replaying the
same input tape reaches a `canonicalJson` identical to the original terminal state.

To confirm this isn't a vacuous/tautological test, I mutated the wiring twice myself and reverted
each time (`git status --porcelain` empty afterward, `git diff --stat battle/runtime.ts` empty):

1. Dropped the `items` field from `completionFor`'s returned `BattleCompletion` (simulating
   "battle consumption not written back to session") → test failed exactly at the
   post-battle assertion: `expected {potion:1,tuxeball:1}, received {potion:2,tuxeball:2}`
   (`battle/runtime.ts:573-578`, reverted).
2. Changed `gold = state.startingGold + reward` to `gold = state.startingGold` (simulating
   "reward written elsewhere / lost") → test failed exactly at the reward assertion:
   `expected 20, received 0` (`battle/runtime.ts:562`, reverted).

Both mutations turn red at precisely the site the spec calls out, and the revert left the tree
byte-identical to HEAD.

## 4. Hash-diff source (independently reproduced, not just re-read from the report)

Dispatched an independent check that checked out the pre-fix parent `cf77886` and the post-fix
`f7bf5d3` into two scratch git worktrees (outside the reviewed worktree, since removed), ran the
maintained win-line journey (`HZ=60 bun tools/smoke-spyder.ts`) in each, and diffed the full
`canonicalJson` state trees (not just the hashes):

- Reproduced both hashes exactly: pre-fix `e47eb75642729ce7ed321f87a0ccce1f5c09b02a1d1a76cedb7c08e9cb3c7f98`,
  post-fix `7fdc130b0b90fece5f3814d886dad0a4513417ce31e2d59019dd0ce310d8dd64`; both end at identical
  `frames=2788`, `map=spyder_route1`, `position=[14,19]`.
- A recursive structural diff of the two fully-parsed canonical JSON trees found exactly **3**
  differing key paths: `ext` (only `inventory`/`money` sub-keys removed, every other `ext` field —
  full party monster snapshot, kennel, caught, runAttempts, npcParties, history, environment,
  faintPoints, nextMonsterId — byte-identical), and `interp.sw.gold`/`sw.gold` (`500→550`).
- Where the money went: pre-fix, the 50-gold win reward was stranded in the now-deleted
  `ext.money` (`50`) while `sw.gold` stayed at its untouched starting `500`; post-fix, `sw.gold`
  is `550 = 500 + 50` — i.e. the reward moved from the dead-end mirror into the real wallet, which
  is exactly the bug being fixed.
- `sw.rng`, `sw.switches`, `sw.variables`, `sw.items` (already `{friendship_scroll:1}` on both
  sides, untouched by this battle), map/position/facing, and `scene`/`chars` are all identical.

No other field differs. The hash change is fully and only explained by the intended
inventory/gold reshuffle; no gameplay/behavior drift rode along with it.

## 5. Legacy-save handling

`battle/extension.ts:292-303` (`migrateV1`) now destructures `inventory`/`money` out of any
decoded v1 extension state and discards them (`const { inventory: _legacyInventory, money:
_legacyMoney, ...extension } = state`), keeping every other field (party/kennel/history/etc.)
intact. This runs unconditionally for `state.version === 1` — there is no separate v2 schema
bump, since the removed fields were always optional bookkeeping, not required shape.

This is covered by a real unit test (`tests/battle-extension.test.ts`, diff in `52e5516`): a
legacy blob is built with **both** `inventory: {potion:2}` and `money: 300` populated, decoded,
and asserted to no longer have either property while other fields (`runAttempts`) still migrate
correctly. I confirmed this test passes as part of the full `bun test` run (§6).

Judged against the project's actual status (pre-release, "旧存档只来自开发期" per the task
context): discarding is the right call. The removed fields were only ever a battle-internal mirror
that never synced to the shop-visible `SessionState.items`/`gold` in the first place (that
divergence was the bug), so dropping them on load neither errors nor silently changes the
player-visible item/gold counts that already lived in `SessionState` before this fix — it just
deletes a shadow copy nobody outside battle ever consulted correctly. There is no plausible dev-era
save where this discard causes an observable regression, and erroring on load or attempting a
best-effort reconciliation of a known-broken mirror would both be worse than a silent, harmless
drop for an unreleased project.

## 6. Gates (rerun independently in this worktree)

| Gate | Result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run import` ×2 | byte-identical: `dist/project.json` `6bcf190e…`, `dist/project-shell.json` `708775e6…`, `data/battle-db.json` `881814d8…`, `data/battle-runtime-db.json` `cc8414bd…`, `dist/import-report.json` `c1acea29…` |
| `bun run build && bun run build:wasm` | exit 0; `dist/main.js` 2,440,250 bytes; wasm 289,758 bytes |
| `bun test tests/` | 128 pass, 0 fail, 60,143 expect() calls, 26 files |
| `bun run verify:g6:locks` | `{"pages":329,"lockCommands":333,"dynamicChecks":333,"outcomes":{"unlocked":327,"transferred":2,"unresolved":0,"error":0},"exceptions":0}` |
| `bun run verify:g6:determinism` | PASS, isolatedRoots=2, files=3234, bytes=59,455,087 |
| `bun run verify:g6:frozen` | 263 maps, 0 permanent locks, 0 blocking fibers, 0 errors |
| `bun tools/desktop.ts --build-only` + QuickJS bench, both viewports | PASS; script asserts the canonical-state hash `7fdc130b…` matches, would hard-fail otherwise; 480×272 battle p95 6.715ms/max 19.336ms, 960×544 battle p95 6.488ms/max 14.366ms; map-first-visits sweep 263/263, worst non-exempt `buddha_mountain` 46.739ms (within the informal 50ms budget noted in project memory as occasionally flaky under load — passed this run) |
| `bun run web && bun run web:verify` | PASS, 10/10 checks ok, 30 requests/0 failed/0 console errors (note: `tools/verify-web-journey.ts` named in the review spec does not exist in this repo — `web:verify` is the actual precedent script used by every prior review in this goal, e.g. `findings/GB4.md`, `findings/review-task-1907.md`; treating the spec's filename as a wording slip, not a missing gate) |
| `git diff main...HEAD -- bun.lock` | empty |
| commit-message / diff scan for `task-\d+`/`fleet`/`Co-Authored-By` | one merge-commit subject naming the branch itself (`Merge branch 'main' into fleet/task-1918`, git's own default text — the branch is named that), plus prior review docs' own prose (`findings/GB3.md`, `findings/review-task-1918.md` describing the gate) and a pre-existing `/var/tmp/fleet/...` scratch-path convention in `tools/battle-oracle/README.md` already present on `main`; no hits in any `battle/`/`importer/`/`tests/` source file |

Working tree confirmed clean (`git status --porcelain` empty) and HEAD unchanged (`f7bf5d3`)
after all gates.

## 7. Principles

- All-automatic import: the fix changes generic rule tables in `importer/project.ts` (`add_item`,
  `has_item` clause), not per-map hand edits; two-pass `bun run import` stays byte-identical.
- No Tuxemon-specific code leaked into the component repo: the only vendor change is the pinned
  submodule commit bump (`2f2eb42`); `vendor/pocket-rpgkit`'s own KB5 change (read separately,
  `src/engine/battle.ts`, `extensions.ts`, `interpreter.ts`, `session.ts`) is generic
  items/gold-context plumbing with no Tuxemon references.
- `vendor/pocketjs` untouched (confirmed nested pin unchanged at `76ae741f` by the hash-diff
  agent's rebuild).

## Blocking items

无。The prior blocking finding (§4d of `findings/review-task-1918.md`: two non-communicating
item/gold banks between G8's shops and GB3's battle) is fixed: shop and battle now read and write
through exactly one session-level items bank and one gold wallet, verified structurally at both
the game-repo wiring layer and the kit's session-application layer, exercised end-to-end by a real
imported-content test I reran and adversarially mutated myself, and the resulting hash change is
fully accounted for with no collateral behavior drift.

## PASS/FAIL

PASS
