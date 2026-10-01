# Review GI-1a (task 2080): importer presentation effects

Reviewer: task 2141 (relay/seed). Reviewed branch `fleet/task-2080` (13 commits, merge-base `91d79e7`). All gates and verifies re-run by the reviewer; subagents used for read-only fact gathering only.

## 逐条对照规格

### 1. 映射语义 — 成立

逐类对照上游 `/var/tmp/tuxemon-src/tuxemon/event/actions/*.py`、`conditions/*.py` 与组件仓 `vendor/pocket-rpgkit`（df2d1c3）契约：

| Tuxemon 源规则 | 上游语义（证据） | 导入器映射 | 判定 |
| --- | --- | --- | --- |
| `play_map_animation` (276) | 一次性快照角色格、不跟随、layer=4 在角色上层、每帧秒数（`play_map_animation.py:38-66`） | `mapAnim` follow:false layer:"above" frameDuration=秒（`importer/project.ts:1435-1465`） | 成立 |
| `play_tile_animation` (1) | 固定格、同上（`play_tile_animation.py:38-62`） | `mapAnim` x/y 固定格（`project.ts:1467-1497`） | 成立 |
| `screen_transition` (25) | 阻塞 2×trans_time 淡出淡入、默认 0.3s 黑色、秒数不转帧（`screen_transition.py:36-61`） | 两条阻塞 `screenFade` out+in、秒数直传（kit 编译时 `secondsToFrames`，多 Hz 一致）（`project.ts:1499-1510`） | 成立 |
| `camera_position` (6) | 瞬时快照、无参恢复跟随（`camera_position.py:31-63`） | `camera` duration:0，有坐标固定格/无参 player 跟随（`project.ts:1512-1528`） | 成立 |
| `set_bubble` (16) | `gfx/bubbles/{name}.png`、无图标清除（`set_bubble.py:36-58`） | `balloon` 持久图标/无图标清除（`project.ts:1530-1552`） | 成立 |
| `change_bg` (15) | 256×144 背景或 R:G:B 纯色、居中前景、阻塞、无参关闭（`change_bg.py:49-96`） | `screenBackdrop` 构建期合成、color/image 变体、variant:null 关闭（`project.ts:1554-1568`） | 成立 |
| `change_bg_char` (4) | 战斗 sheet 正面帧 + 背景、阻塞（`change_bg_char.py:53-80`） | `screenBackdrop` + `foregroundCrop` x=frameW 正面帧（`project.ts:1570-1581`） | 成立 |
| `set_layer` (79) | 世界地图上、对话框下的全屏叠层；**上游每次换图也清除**（`map/transition.py:54-67` `_clear_overlay`） | KV1 `layer` screen 变体；kit 每次传送重建 interp（`session.ts:682`）→ 同样每次换图清除 | 成立 |
| `set_template` (24) | 行走+战斗 sheet；`default` 按 `race_choice` 恢复（`set_template.py:52-67`） | `appearance` 行走外观；race 选择用 `saveDefault` 存基线、`sprite:null` 恢复（`project.ts:1599-1637`） | 成立（战斗 sheet 6 条 T1-lowered，P1 可接受） |
| `update_tile_properties` (2) | 更新全部带 label 格、moverate 0=阻挡 >0=可通、每图重置（`update_tile_properties.py:33-47`） | 逐格 `tileProperty` passage "pass"/null（`project.ts:1639-1666`） | 成立 |
| `is/not tile_property_updated` (6) | `all(带 label 格 == moverate)`；空 label `all([])==True`（`tile_property_updated.py:36-38`） | 代表格 `tileProperty` 条件（`project.ts:825-859`） | 成立（见下方不变量验证） |
| `is/not char_sprite` (66) | 检查 `appearance_manager.state.sprite_name`（`char_sprite.py:30-39`） | `appearance` 条件读有效行走外观（`project.ts:807-823`） | 成立 |

**`set_layer` 跨图保留**：规格补充要求对照上游确认叠层跨图是否保留。上游 `MapTransition.change_map` 末尾调用 `_clear_overlay()`（`tuxemon/map/transition.py:54-67`，docstring 明确 "Reset the world overlay so it does not persist across maps"）。kit `enterMap` 重建 `InterpState`（`vendor/pocket-rpgkit/src/engine/session.ts:682`），`layers` 不保留。两侧语义一致，无需导入侧重发。

**`tile_property_updated` 代表格不变量**：导入器用 `cells[0]` 代表格替代 `all(cells)`，依赖「全部 surfable 格初值 0 且只有两个 whole-label writer」。审查验证：全部 264 个 tileset surfable 属性均为 `value="0"`（`grep -rn 'name="surfable"' mods/tuxemon/gfx/tilesets/*.tsx`），且语料只有 `update_tile_properties surfable,0/1` 两个 writer（上游语义本身就是原子更新全部带 label 格）。不变量成立，代表格与 `all(cells)` 等价。

**`K(true)`/`K(false)` 的 not 处理**：`K = (value) => [{k:"const", value: not ? !value : value}]`（`project.ts:768`），not 形式正确取反。空 label（无参）路径 `K(false)` 对 is/not 分别为 const false/const true，与上游 `all([])==True` 的 is=True/not=False 不一致，但语料中 6 条 `tile_property_updated` 全部带 `surfable` label，此路径不可达（潜在差异，无实际影响）。

**stop 类动作**：上游动作目录无 stop/hide 地图动画动作（仅 `play_map_animation`/`play_tile_animation`），导入器无 `stopAnim` 用例，与 builder 报告一致。

### 2. 覆盖率 — 成立

`reports/G1-coverage.md` 数字与 builder 报告一致，且重新 `bun run import` 后复现：

| 规则 | 覆盖 |
| --- | --- |
| play_map_animation | 276N |
| play_tile_animation | 1N |
| screen_transition | 25N |
| camera_position | 6N |
| set_bubble | 16N |
| change_bg | 15N |
| change_bg_char | 4N |
| set_layer | 77N + 2X |
| set_template | 17N + 6D + 1X |
| update_tile_properties | 2N |
| is tile_property_updated | 4N |
| not tile_property_updated | 2D |
| is char_sprite | 9N + 28X |
| not char_sprite | 28N + 1X |

合计：动作 439N + 6D + 3X = 448；条件 41N + 2D + 29X = 72。与 builder 报告一致。2 条 set_layer Dropped 属于固定假守卫事件（`not tile_property_updated` 在无 surfable 格的图上编译为 const false → 整事件丢弃，`project.ts:2236-2241`），不可达，非资源缺失。

### 3. 画面 — 成立

三张 golden 已用 Read 工具打开肉眼核对：
- `gi1a-appearance.png`：bedroom 中 player 渲染为 adventurer 行走外观，16×32 精灵在正确 tile anchor 上。
- `gi1a-map-animation.png`：grass 动画帧精确覆盖 player 当前格上层，16×16 box 内恰有 28 个变化像素。
- `gi1a-screen-fade.png`：1 秒黑色 fade-out 的 30/60 tick 中点，全屏变暗约 50%，地板探针 [167,140,75]→[83,70,37]。

语义像素断言辨识力（变异检查，见第 4 节）：3 个变异全部使测试变红。

### 4. 不回退 — 成立

**终态哈希字段级 diff**：`git diff 91d79e7..HEAD -- data/*-journey.json` 确认 4 个 journey 文件仅 `terminalStateSha256` 变化，`tapeSha256` 与全部其他字段不变。tape（输入帧）未重录。

**审查复跑全部 verify**：

| Verify | 结果 |
| --- | --- |
| `verify:gb6:mainline` | PASS；109,983 frames；100 battles（22 trainers + 78 wild）；terminal `cedface0…` |
| `verify:j1:mainline` | PASS；122,145 combined frames；17 battles；terminal `670a85f7…` |
| `verify:j2:mainline` | PASS；172,060 combined frames；56 battles（50 trainers 全胜 + 6 wild）；terminal `933c8a78…` |
| `verify:gb6:failures` | PASS；first-loss 3,254 frames + later-loss 65,515 frames（Wanda 败北、faint point、blockedExit、healed） |
| `verify:g6:locks` | 330 pages；334 dynamic checks；0 unresolved/error |
| `verify:g6:frozen` | 263 maps；0 permanent locks/fibers/errors |
| `verify:g6:determinism` | PASS；4,742 files；SHA `c0cd4745…` |
| web journey | PASS；3,793 frames；4 个像素/状态 checkpoint 全匹配；0 console errors |

### 5. 成本 — 成立

审查复跑 `tools/bench-g6-quickjs.sh`（QuickJS 桌面宿主，同一条 3,793 帧 G6 journey，两 viewport 终态 SHA 均为 `5653f011…`）：

- 263-map first-visit stage p95 = **4.272 ms**（builder 报告 3.882 ms；审查复测略高因同机有其它 fleet 任务在跑 benchmark 产生 CPU 争用，但远低于 50 ms/map 门限）
- stage max = 20.659 ms（builder 17.188 ms，同样受争用影响）
- 每帧预算：battle-entry 24.4 ms、battle-exit 41.2 ms、all 41.2 ms，全部 < 50 ms
- startup-to-first-paint：bench 内置 250 ms 预算断言（`g6-quickjs-bench.rs:973`）通过即 < 250 ms；builder 报告 480×272 = 180.871 ms、960×544 = 195.062 ms，均在门限内

方法可信：同一 journey、同一 canonical 终态 SHA、thread CPU time 计时。builder 报告的 960×544 单次 +14.68% 波动仍在 250 ms 门限内（余量 54.9 ms），无地图流送或每帧热路径回退。

### 6. 合并 main — 成立（1 处生成文件冲突，已解决）

临时副本 merge main（`34ec973`，kit c93a1ec）：
- **冲突**：仅 `data/g6-assets-report.json` 的 `manifestHash`/`schemaHash`（kit 子模块升级导致 schema hash 变化），取 main 版本解决
- **无代码冲突**
- 解决后 `bun run import` + `bun run build` + `bunx tsc --noEmit`（0 errors）+ `bun test`（257 pass / 0 fail；初次 6 个 battle-presentation-sim 失败因缺少 `dist/main.js`+`dist/main.pak`，build 后全绿）
- 被审分支未改动

### 7. 门禁与卫生 — 部分成立（见阻断项）

| 门禁 | 结果 |
| --- | --- |
| `bun run import` 连跑两次 | exit 0；两次后 `git status --short` 均空；`dist/project.json` SHA `c24ea238…` 两次一致 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 |
| `bun run build:wasm` | exit 0；289,808-byte wasm |
| `bun test` | 257 pass；0 fail；0 skip；102,619 expect |
| `bun.lock` 改动 | 无 |
| `vendor/` 改动 | 无 |
| 本机路径/任务号/AI 尾注 | 无 |
| `docs/status.md` Presentation 条目 | **未更新 — 见阻断项** |

## 阻断项

### B1. `docs/status.md` Presentation 条目过时，与实现不符

规格第 7 条要求「docs/status.md Presentation 条目已更新且与实现一致」；goal 硬规矩规定「功能分支合并时，把自己落实的条目在状态清单里标上……这是必做项」。分支 13 个提交无一提及 `docs/`（`git log 91d79e7..HEAD -- docs/` 为空）。

当前 `docs/status.md` Presentation 节（第 39-45 行）仍写：

| 条目 | 现状 | 实际 |
| --- | --- | --- |
| Screen transitions (`screen_transition`) | Partial — "Simplified to the kit's transfer fade" | 25N 原生 KS1 淡出淡入 |
| Map animations (`play_map_animation`, 276 uses) | Planned — "In progress" | 276N 原生 KA1 mapAnim |
| Screen overlays (`set_layer`, 79 uses) | Planned — "Imported as a no-op placeholder for now" | 77N 原生 KV1 layer（**"no-op placeholder" 说法已虚假**） |
| Camera moves, speech balloons, full-screen backgrounds, sprite changes | Planned — "In progress" | 全部原生（camera 6N、balloon 16N、backdrop 15+4N、appearance 17N+6D） |

错文档比没文档更坏：`set_layer` 行明确说 "Imported as a no-op placeholder for now"，但实现已是原生 KV1 layer。需将 4 行更新为 Done/Partial 并附能力与限制说明。

## 变异检查（3 个，全部使测试变红）

在隔离副本 `/var/tmp/fleet/2141/mut-importer`（已删除）中进行，不改被审 worktree：

1. **`update_tile_properties` passage 映射**：`"pass"` → `"block"`（`project.ts:1663`）→ `tests/importer.test.ts` KV1 测试失败（expected 23 pass, received 0）。还原。
2. **`char_sprite` 条件 sprite**：`sprite` → `"wrong_"+sprite`（仅条件返回，`project.ts:820`）→ KV1 测试在 `toContainEqual({kind:"appearance", target:"player", sprite:"swimmer"})` 处失败。还原。
3. **视觉像素断言**：fixture 注入的 mapAnim 实例 `start` 偏移 -5 tick（使渲染第 2 帧而非第 0 帧，`tools/gi1a-visual-fixture.ts:236`）→ `tests/gi1a-visual.test.ts` 像素断言失败（`delta.inside` expected 28, received 43）；状态形状断言不受影响，证明像素断言本身有辨识力。还原。

另做一层变异（`layer: "above"` → `"below"`）确认状态形状断言也能捕获层位错误（在 `mapAnimationState` toMatchObject 处失败）。

## 非阻断观察

- **`tux.set_layer` 占位 handler 未删除**：规格补充要求「删掉 `tux.set_layer` 占位 handler 与对应覆盖率文案」。导入器已不再发射 `tux.set_layer`（`dist/project.json` 0 引用），但 `battle/extension.ts:589-594` 的 no-op handler、`tests/time-weather-import.test.ts:228,250` 的 no-op 测试、`importer/time-weather.ts:326` 的注释仍在。死代码，无功能影响，但补充明确要求删除。
- **循环地图动画跨图**：上游 AnimationManager 跨图保留（`map/transition.py:54` 只清 overlay 不清动画），kit 每次传送清 anims。语料 276+1 全部 `noloop`，无实际影响。
- **player bubble 跨图**：上游 BubbleManager 在 MapRenderer 上跨图保留（player bubble），kit 传送清 balloons。语料中 bubble 均在剧情内即时清除，无实际影响。
- **`change_bg` 上游会先关已开对话框、已显示时 no-op**：导入器直接替换 backdrop。语料中 change_bg 均在对话框前调用，无实际影响。
- **dragonbirth 48×64 帧最近邻补到 64×64**：`gen-assets.ts` 的 `portableStaticPng` 做了 1.333× 最近邻放大再由 image node 缩回；builder 报告称「没有拉伸或插值」措辞略误导（有最近邻重采样），但视觉测试断言源 opaque pixel 精确匹配，且 dragonbirth 仅 1 处 `play_tile_animation` 使用。

## subagent 使用情况

3 个 subagent（全部只读调研，前台并行，结果已由主 agent 逐条核实）：
- SA1（上游语义 A 组）：play_map_animation / play_tile_animation / screen_transition / camera_position / set_bubble / change_bg 的上游参数、单位、阻塞、层级、跨图语义
- SA2（上游语义 B 组）：set_layer 跨图保留（确认上游也清除）、set_template / change_bg_char / update_tile_properties / char_sprite / tile_property_updated 条件真值语义
- SA3（组件仓契约）：KA1 mapAnim/stopAnim、KS1 screenFade/camera/balloon/screenBackdrop、KV1 layer/appearance/tileProperty 及条件的精确参数与状态生命周期

明显缩短了前期对照时间；实现核对、全部门禁/verify/journey 复跑、变异、画面肉眼核对、合并 main、成本复测与最终判定均由主 agent 执行。

FAIL
