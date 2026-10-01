# Review: GI-2a 改名 + 图鉴/日志场景 (task 2205)

Reviewer: task 2242. Branch `fleet/task-2205` (10 commits on `a1f8510`), kit pinned at `d4353ee`.
Reviewed against `/var/tmp/fleet-specs/pocket-tuxemon/game-GI2a-scenes.md` and `reviewer-generic.md`.

## 1. 语义对照上游

Three read-only subagents (SA1 rename, SA2 tuxepedia, SA3 journal) compared the port against
Tuxemon Python; every claim below was re-verified by the reviewer against the source and the
generated maps.

### rename_player (5 sites) — Degraded, accurate
- All 5 corpus sites are `rename_player player,random` (healing_center.tmx:119,
  player_house_bedroom.yaml:33,50, spyder_paper_scoop.yaml:248, spyder_candy_cafe.yaml:11).
- The lowering (`importer/project.ts:2068-2086`) emits `rpgkit.nameInput` with `maxLength:15`,
  `default:""`, `swallowCancel:true`, and the 66-char Tuxemon en_US alphabet. This matches
  upstream `rename_player.py:52-60` exactly: empty start, `PLAYER_NAME_LIMIT=15`,
  `escape_key_exits=False`.
- **Random-name button is missing** — all 5 sites pass `random`, which upstream uses to show the
  dontcare button (`states/input.py:174-181`). This is the documented Degraded reason and is
  real (every site is affected).
- NPC rename targets are dropped (`project.ts:2083-2084`); no corpus content uses them.
- Prompt is generic `"Name"` (the `po.get("name")` lookup misses; upstream shows `"Name?"`).

### get_player_monster + rename_monster (2 pairs) — Degraded + Native
- Both `rename_monster` sites are immediately preceded by `get_player_monster rename`
  (healing_center.tmx:100-101, spyder_candy_cafe.yaml:38-39). The importer fuses the pair into
  `tux.monsterPicker` → `tux.prepare_monster_rename` → `rpgkit.nameInput` →
  `tux.apply_monster_rename` (`project.ts:2171-2217`).
- The name input prefills the DB species name (15-char clamp), is non-cancellable
  (`swallowCancel`), and writes a validated 1..15-char `nickname` on the party monster by stable
  IID. Matches upstream `rename_monster.py:57-64` storage semantics.
- **One undocumented behavioral divergence:** the monster picker allows cancel
  (`battle/scenes.ts:178-180,194`), whereas upstream's no-filter `get_player_monster` sets
  `escape_key_exits=False` (`get_player_monster.py:161-166`) to force a selection. Cancelling
  skips the rename; the candy-cafe event then plays `happy_rename` dialog regardless. Minor,
  player-friendly, no story gate depends on it.
- Evolution copies the nickname only when explicitly set (`battle/progression.ts:287`), matching
  upstream's conditional copy in practice.

### set_tuxepedia (6 sites) — Degraded, accurate
- All 6 are in spyder_dojo4 "Billie encounter" (act80-85, player/seen for eyesore, cardiwing,
  vivipere, viviphyta, eyenemy, cardiling) and match 1:1 in `dist/maps/spyder_dojo4.json`.
- Action semantics are exact vs `set_tuxepedia.py:41-61`: tri-state validation, `unseen` is a
  no-op, caught-wins monotonicity (`battle/extension.ts:614-633`), unknown-species/bad-label
  errors. Capture/evolution/add_monster all promote to caught.
- State model is degraded: player-only, no per-NPC journals, no appearance/caught repeat
  counters (`extension.ts:80-82`). Zero content impact (all 6 target the player). The disjoint
  /known-species/no-dupes validation (`extension.ts:336-346`) is stricter than upstream.

### open_journal (14 sites) — Degraded, accurate
- 14 upstream occurrences (5 spyder_paper_scoop, 5 spyder_paper_town, 3 professor_lab,
  1 eclipse_lion_mountain_middle) import with matching monster args and `reveal:true`.
- `tux.journal` (`battle/scenes.ts:91-140`) is a faithful port of the `open_journal` action
  contract: opens on the target with full reveal even when unknown, never mutates tuxepedia
  state, disables directional cycling (matching upstream's `source` gate), closes on A/B.
- Descriptions come from the same en_US `base.po` (ignibus string byte-identical).
- Degradations are confined to detail breadth (no shape/species/evolution names, type names as
  text not icons, metric-only) and the merged single-screen layout. One minor gap: no
  already-active guard (`open_journal.py:46-51`), absorbed by the scene host parking the fiber.

### Coverage report accuracy
`reports/G1-coverage.md` is accurate: rename_player 0/5/0/0, rename_monster 2/0/0/0,
open_journal 0/14/0/0, set_tuxepedia 0/6/0/0, get_player_monster 0/2/0/15 (total 17 = corpus).
The `dist/import-report.json` `get_player_monster` dropped=21 is a multi-profile aggregate (its
byFate totals 43,250 ≫ 13,617 corpus uses), not the canonical report; not an error.
A side effect: `is button_pressed` moved 402→407 native / 17→12 dropped — the importer's
button_pressed logic is unchanged, so this is a materialization side effect of the
scene/blocking changes; the number is generated and deterministic.

## 2. 场景宿主 (save / replay / rewind / multi-Hz)

All three scenes use the kit's KG1 generic scene host (`scene` command parks the fiber,
`SceneRules` pure reducer, `GameView.sceneViews` Solid view). The kit's `kg1-scene-host.test.ts`
proves the generic lifecycle: save rejected while open, save/restore round-trip, rewind
byte-identical, 60/30/20/4 Hz same result, zero-cost for scene-free projects.

**Self-constructed verification** (`/var/tmp/fleet/2242/gi2a-save-verify.ts`, artifact 30653):
drives the production `TUXEMON_SCENES` + `TUXEMON_EXTENSIONS` through a kit session. 15/15 PASS:
- mid-rename `canSave` is false and `createSessionSnapshot` throws;
- name input starts empty, commits `playerName="A"`;
- `tux.set_tuxepedia` seen/caught persist in the extension state;
- after close, save code encode/decode is equal and `restoreSessionEnvelope` keeps `playerName="A"`,
  seen=`["ignibus"]`, caught=`["embazook"]`, with no open scene.

The GB6/J1/J2 journey tapes cross the opening rename prompt and pass at 60/30/20 Hz with
stateful save/restore and rewind (§5), confirming the scenes are replay/rewind-safe in the
production worldline.

## 3. 画面

Opened both committed goldens at full resolution:
- `tests/goldens/gi2a-journal.480x272.png` and `gi2a-journal.960x544.png`.

The 480×272 view shows the TUXEPEDIA list (#026 ??? ?, #027 Budaye S, #030 Ignibus P selected,
#031 Embazook C, #032-033 ???) and the Ignibus detail panel: complete front sprite (turtle with
flame shell, not cropped), "Fire 68 cm 27 kg", and the full localized description with no
truncation. The 960×544 view is the same composition at exact 2× with crisp pixel art. All four
states (unknown/seen/caught/preview) render. The visual test (`tests/gi2a-journal-visual.test.ts`)
backs the hash with semantic pixel assertions: selected-row accent fill, detail paper region,
>1,000 opaque front-sprite pixels with >100 in the far-right quarter (anti-crop), and 2×
composition similarity >0.89.

## 4. 录像变化

The tapes were re-recorded because name input is now a real blocking scene. Scene autoplay
(`tools/scene-autoplay.ts`) deterministically enters "A", picks the highlighted party member,
completes monster naming, and closes journal previews. Terminal hashes match the builder report:

| Tape | Frames | Terminal SHA-256 |
| --- | ---: | --- |
| GB6 | 108,618 | `f303bc39…dec380` |
| First-loss | 3,127 | `7a08fb15…c942592` |
| Later-loss | 65,004 | `d6ea2b5b…f72f93d59` |
| J1 | 121,224 combined | `7090d514…2dec82a1` |
| J2 | 170,983 combined | `64a941e0…d1ecb93` |

The field-by-field audit is justified: `playerName` Player→A (autoplay now enters the rename),
party/tuxepedia/item differences are consequences of the fully re-recorded deterministic battle
route (not nickname persistence), and the clock envelope shifts with the tape (epoch/day and
weather unchanged). J1/J2 inherit the five-member GB6 party and retain their terminal maps,
positions, story checkpoints, and battle counts.

## 5. 性能

Re-ran `bench:gb6:quickjs` (108,618-frame GB6 tape, QuickJS desktop host) at both viewports.
The machine was shared with other fleet tasks (load ~9–10 on 32 cores), so the numbers are
inflated relative to a quiet machine; the budget is on per-thread CPU time
(`cpu_clock=thread-cputime`), not wall time.

| Viewport | qjs_core max CPU | Limit | Battle entry / exit max | Canonical state |
| --- | ---: | ---: | ---: | --- |
| 480×272 | 44.747 ms | 50 ms | 28.712 / 23.473 ms | `f303bc39…` matched |
| 960×544 | 49.537 ms | 50 ms | 21.716 / 16.016 ms | `f303bc39…` matched |

Both pass the 50 ms budget and replay to the canonical terminal state. The builder's
quiet-machine numbers were 40.582 ms (480×272) and 29.211 ms (960×544); the ~10% / ~70%
inflation here tracks the concurrent load (the 960×544 render path moves 4× the pixels and is
more sensitive to memory-bandwidth contention). A first 480×272 run that overlapped a second
concurrent bench panicked at 71.7 ms and was discarded; the re-run above is the valid one.
The scene host is zero-cost on the scene-free hot path (KG1 test), and the GB6 tape only opens
scenes at the rename prompt, so GI-2a does not regress the per-frame budget.

## 6. 门禁

| Gate | Result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run import` ×2 | byte-identical tree `3ae430ea…`, matches committed |
| `bun run build` | exit 0 (dist/main.js 1,452,416 B, pak 67,234,560 B) |
| `bun run test` | 282 pass, 1 timeout (see note), 102,483 assertions |
| g6 determinism / frozen / locks | PASS (4,742 files; 263 maps 0 locks; 334 checks 0 errors) |
| terrain determinism / collision | PASS (961 files identical; 56,176 steps 0 mismatch) |
| gb6 mainline / failures / stateful / rates | PASS (hashes above) |
| j1 full / j2 full | PASS (hashes above) |
| web journey | PASS (3,342 frames, all checkpoints, 0 console errors) |
| merge current main | NOT GREEN — see merge section below |

**Test timeout note:** `tests/g6-locks.test.ts` timed out at 30 s (32.8 s) under the full-suite
concurrent load, but passes in isolation at 19.42 s. The file was not touched by GI-2a and CI
runs it in an explicit slow-test group (`.github/workflows/ci.yml:62`), so this is a load-induced
flakiness of the all-files `bun run test`, not a regression.

### Merge with current main (temp copy, branch untouched)

Merged `origin/main` (D2 + DEMO-G1 chapters + SLIM-G) into a temp copy of the branch
(`/var/tmp/fleet/2242/merge-test`, discarded after). The branch itself was not modified.

**Conflicts and resolution:**
- `tools/desktop.ts` — kept the branch's ALSA auto-detect function.
- `ui/battle-scene.tsx` — textual conflict (helper region); resolved by keeping both
  `monsterName`/`pathFor` (branch) and `imageSource` (main).
- `vendor/pocket-rpgkit` — took the branch's `d4353ee`, which is a descendant of main's
  `2e10436` (verified via `git merge-base` in the kit repo), so the scene host is preserved.
- `README.md`, `docs/status.md`, `docs/importer.md`, `docs/verification.md`,
  `data/battle-assets-report.json`, `data/g6-assets-report.json` — content conflicts resolved by
  combining both branches' updates.

**Integration fixes required (applied in the temp copy):**
- `tools/bake-chapters.ts` (from main) needed `scenes: TUXEMON_SCENES` in `GAME_OPTIONS` and
  `leftEdge`/`rightEdge` in its `input()` function — the d4353ee kit asserts scene registration
  and the rename autoplay drives the name-input grid with LEFT. Without these, bake-chapters
  fails with `unregistered scene ids: tux.journal` and `checkpoint Starter chosen was never
  reached`.

**Remaining blocker — battle stack incompatibility:** after the above, `bun run build` passes but
`bake-chapters` fails rendering a chapter thumbnail: `PocketJS: unknown image src
"ui:tile.battle/gfx/sprites/battle/nut-sheet#0"`. The root cause is that main's SLIM-G refactored
the whole battle rendering stack (`battle/runtime.ts` now carries `visuals` with `BattleImageRef`,
`battle-scene.tsx` uses `activeImageSource`/`battlePaint`), while the git auto-merge kept the
branch's older `battle/runtime.ts`/`extension.ts`/etc. All seven `battle/*.ts` files differ
between the merge result and main. A naive `git merge` thus mixes the branch's battle runtime
with main's SLIM-G `battle-scene.tsx`, which is incompatible. A correct forward integration must
take main's SLIM-G battle stack and re-apply GI-2a's nickname/tuxepedia/scene changes on top —
this is a rebase/re-integration, not a plain merge. **The merge is not green as-is.**

## 阻断项

无.

## Subagent 使用

3 个只读 subagent 并行核对上游语义（SA1 rename、SA2 tuxepedia、SA3 journal），各自产出带
file:line 证据的报告；主 agent 逐条复核后写入本报告。变异测试由主 agent 在隔离 worktree
(`/var/tmp/fleet/2242/mut-1`) 串行执行。subagent 节省了上游语义调研时间。

## 结论

GI-2a 按规格落实了改名、图鉴与日志：四族动作的上游语义对照准确（降级均有记录且无内容影响），
三个场景走组件仓 KG1 通用场景宿主（存档/回放/倒带/多 Hz 经自构造脚本与旅程录像双重验证），
画面四态与本地化简介正确，录像终态字段差异逐项有据，QuickJS 两档视口最慢帧均 < 50 ms，
分支自身门禁全绿。前向合并当前 main 不能直接 git merge（SLIM-G 重构了战斗渲染栈，需取
main 的战斗栈再重挂 GI-2a 的昵称/图鉴/场景改动），属集成事项，不阻断本任务验收。

PASS
