# GW1：`current_state WorldState` → `worldIdle` 与上游验收

## 结论

游戏仓已把 Pocket RPG Kit 子模块升级到
`4bba234b99550998d9f1e2ea532065da0564eb39`，并把 Tuxemon 的
`current_state WorldState` 条件导入为 reducer 派生的 `{kind:"worldIdle"}`。
Paper Town `Teleport Faint` 上临时添加的 `firstfightdue` / `firstfightend`
门已经完全删除；原有首战失败 tape 无需重录，严格失败路径仍通过。

真实上游运行确认了同一条调度规律：Radiotower `Stop!` 战败后必须先完成整段剧情并解锁，
昏厥传送才可启动；五张候选地图的 `Evolution all` 也都在阻塞状态释放前启动 0 次，
恢复 `WorldState` 后才启动。本地导入页对两类边界都保持这一顺序。

`worldIdle` 带来的两个正确时序变化使主线 tape 增加 2 个输入帧、Wanda 后续败线增加
15 个输入帧，均由原驱动和 autoplay 重录，而非手改。主线的逻辑地图检查点和 100 场战斗
完全不变；Wanda 败线现在会先完整发放 Fishing Rod，再执行昏厥传送。

## 1. 组件仓升级与 schema

- `vendor/pocket-rpgkit` 从 `fb3b319d9a168fb867015af3a43ebc47edbb932a`
  升级到 `4bba234b99550998d9f1e2ea532065da0564eb39`；嵌套
  `vendor/pocketjs` 没有改动。
- 新组件版本的 `worldIdle` 同时可用于 `condition.all` 和 `if`；它要求当前地图没有
  blocking main fiber、input lock、modal、player route、transfer/fade、pending/active scene、
  fatal overlay 或 host menu。它是 reducer 状态的派生值，不写入存档。
- 重新导入后的 schema hash 是
  `0ff7c248ce6b0e4ba42f815b41f869ce333ffa2b748acb69d712e3441a30692c`。
  两次 `bun run import` 都通过 shell manifest 自检，第二次没有产生 tracked diff。

## 2. `current_state` 映射

Tuxemon 的 `current_state A:B` 是“栈顶状态属于给定 OR-list”。Pocket RPG Kit 不让地图
fiber 在战斗、主菜单或传送场景中独立运行，因此唯一可观察且可运行的源分支是
`WorldState`；它恰好对应组件仓的“自由控制世界”派生谓词。

| 源参数 | `is current_state` | `not current_state` | 理由 |
| --- | --- | --- | --- |
| `WorldState` | `worldIdle` | `worldIdle, negate:true` | 直接保留“世界已恢复且无阻塞状态”的动态检查。 |
| `MainCombatMenuState:WorldState` | `worldIdle` | `worldIdle, negate:true` | OR-list 含可运行的 `WorldState`；combat-menu arm 冻结地图 fiber。 |
| `MainCombatMenuState` | 常量 `false` | 常量 `true` | 本运行时在 battle scene 内冻结地图 fiber，没有可独立观察的 map-fiber 状态。 |
| `MainCombatMenuState:WorldMenuState` | 常量 `false` | 常量 `true` | 两个 menu arm 都由 scene/host 所有，地图解释器不会在其中运行。 |
| `TeleporterState` | 常量 `false` | 常量 `true` | transfer/fade 本身就是 `worldIdle` blocker，且没有并行 map-fiber analogue。 |

覆盖报告因此把含 `WorldState` 的展开实例记为 T1 native：1,129 个；不含它、保持上述
显式常量折叠的实例为 T2-dropped：358 个。源覆盖总表中的 78 个 `is current_state`
定义相应变成 34 个 T1、44 个 T2-dropped，不再把 `WorldState` 记作 T1-lowered。

导入器的单元测试同时覆盖 `is`、`not`、混合 OR-list、三个不可运行状态族、真实
`Evolution all` 产物，以及 Paper Town `Teleport Faint` 不再含
`v.firstfightdue` / `v.firstfightend` 合成条件。首战败顺序现在只依赖公共
`worldIdle` 条件，`verify:gb6:failures` 的既有断言没有放宽。

## 3. 上游 oracle

`tools/upstream-world-idle-oracle.py` 直接加载只读 Tuxemon checkout
`9e6258ff726b786040a267e8bdbbf037b560285e`，用
`/var/tmp/fleet/gb2-oracle-venv` 和 60 Hz `LocalPygameClient.update()` 驱动真实事件引擎、
状态栈和战斗。只对缺失资源使用系统字体 fallback，并静音音频。两次独立运行生成的
`data/gw1-upstream-world-idle-oracle.json` 字节相同，SHA-256 为
`cf8372fd6cc2a08386fc4e7d8489101e5975b1cc003d8f797ac606894806b19c`。

复现命令：

```sh
TUXEMON_SRC=/var/tmp/tuxemon-src \
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
/var/tmp/fleet/gb2-oracle-venv/bin/python \
  tools/upstream-world-idle-oracle.py data/gw1-upstream-world-idle-oracle.json
```

### 3.1 Radiotower `Stop!` 战败

本地夹具加载真实导入的 `spyder_radiotower`、`spyder_leather_center` 与 `Stop!` 页，
只把耗时战斗替换为确定性一 tick 败局；这使测试聚焦地图事件的战后调度，不伪造剧情命令。

| 可见/持久结果 | 上游 Tuxemon | 本地导入结果 |
| --- | --- | --- |
| 战斗与剧情释放 | battle 596；lost 1,321；`kernelquest=yes` 并 unlock 2,156 | battle 284–285；`kernelquest=yes` 并 unlock 580 |
| `Stop!` 可见文本 | 六段剧情各 1 次，全部在 unlock 前 | 同六段各 1 次，全部在 unlock 前 |
| 昏厥传送 | unlock 后在 2,157 启动；fade 中于 2,167 又被源调度一次 | unlock 后且 fade 空闲时在 590 启动 1 次 |
| `heal_before_leave` | 2 次 | 1 次 |
| 终点 | `spyder_leather_center@6,7` | `spyder_leather_center@6,7` |
| 关键变量 | `battle_last_result=lost`、`kernelquest=yes` | 同值 |
| Rockitten | level 5，当前 HP `0/75` | level 5，当前 HP `0/71` |

两边的关键顺序和游戏结果一致：`Stop!` 的全部战后剧情先完成，随后才昏厥传送；最终位置、
战果、剧情变量与当前 HP 一致。两项数值差异均有明确原因：上游 `Monster.spawn_base` 与本地
固定 RNG fixture 抽到不同 IV，故最大 HP 为 75 与 71；这不影响两边战败后的当前 HP 都为 0。
上游在异步 source-map fade 尚未结束时又排入同一个全局事件，因而重复一次提示；组件仓
`worldIdle` 明确定义 transfer/fade 为 blocker，本地不会制造第二个 fiber。这里保留一次提示是
有意去除源调度竞态，而不是复刻重复可见文本。上游还证明跨地图 `teleport_faint` 只在动作开始时
已位于目的地图才治疗，因此该样本最终仍为 0 HP；本地与其一致。

### 3.2 五张图的 `Evolution all`

上游 probe 保留各地图真实 `Evolution all` EventObject，移除无关事件，在待进化队伍上持有
`SinkState` 5 ticks，再释放为 `[WorldState, BackgroundState]`。五例在释放前都没有启动，
release tick 5 才各启动一次事件并执行一次 `evolution` action。

本地 probe 保留同一张真实导入的 `Evolution all` 页，在一 tick 战斗后按该地图真实
lock/battle/unlock 页结构构造最小边界，并确认接受进化后 `cataspike → puparmor`：

| 地图 | 上游：release / event / action | 本地：battle exit / unlock / choice | 结果 |
| --- | --- | --- | --- |
| `spyder_route1` | 5 / 5 / 5 | 1 / 不适用 / 3 | 只等 battle 返回后进化 |
| `spyder_paper_town` | 5 / 5 / 5 | 1 / 5 / 6 | 首战结果页解锁后进化 |
| `spyder_radiotower` | 5 / 5 / 5 | 1 / 5 / 6 | `Stop!` 解锁后进化 |
| `taba_ba_br_1` | 5 / 5 / 5 | 1 / 5 / 6 | `move to middle` 持锁、后续战斗页、结果页解锁后进化 |
| `taba_ba_br_2` | 5 / 5 / 5 | 1 / 5 / 6 | acolyte/battle-redo 结果页解锁后进化 |

测试还逐个检查这些是真实导入产物中的 `worldIdle`、`lockInput`、`battle`、`unlockInput`
命令；尤其 Taba BR1 的锁在 `e008_move_to_middle_r001`，初始战斗可续于
`e009_start_fight`，因此断言跨页所有权而不是错误要求战斗页自己持锁。

## 4. Tape 变化与理由

### 4.1 主线长 tape

旧 tape 为 109,981 frames，新 tape 为 109,983 frames；新 `tapeSha256` 为
`ce6b28fa4fe502a0e5aa88881da7e1854db5d0072b1a5aedca9cb1bf6ff48221`，终态 hash 为
`d62d1465492219071b0dfcb14e6ba59571c1fed91ce176bb4ccfb749821d3413`。

逐帧诊断找到第一次差异在输入 mask index 13,017。去掉 frame 字段后，100 个逻辑 battle
检查点和 112 个逻辑地图检查点全部相同；时间偏移只经历 0、+1、+2 三段。新增的 idle 等待
把 `Allow evolution?` 推迟到 Billie 战后对白结束之后。
这正是上游以 `WorldState` 栈顶门控进化的顺序，因此用原 `tools/gb6-journey.ts` 驱动与
autoplay 重录是正确修正。最终仍为 22 场训练师全胜、78 场野战，总计 100 场，结束在
`spyder_route3@4,6`。

### 4.2 Wanda 中途败 tape

旧 tape 为 65,500 frames，新 tape 为 65,515 frames；新 `tapeSha256` 为
`135c4a1e7759cdf38ddaea7dab5d975be61567c0dd9f82044baec1988d6e54d3`，终态 hash 为
`2e76caf07b19e4b01baac2e3d52deaafc73b3bd915ceb9e6c79826dac3371d51`。

新增的 15 帧让 Wanda 的战后页在昏厥传送前完整执行：窗口为 61,897–65,224，经过
27 turns，出现 `Here, you can have my Fishing Rod.` 与道具提示，并令
`fishing_rod === 1`。生成器和 verifier 都新增严格断言，replay 只兼容同一 modal 在生成与
回放间允许的一至两帧采样差，文本内容、顺序和次数仍逐项相等。这是 `worldIdle` 修正此前
全局昏厥页抢跑、销毁 Wanda 源地图 fiber 的真实语义改善。

短 `data/g6-journey.json` 与首战败 `data/gb6-first-loss-journey.json` 相对基线均无 diff；
首战败仍只靠公共 `worldIdle` 保证 Paper Town 剧情先完成，没有重新加入地图特例。

## 5. 验收

| 门禁 | 结果 |
| --- | --- |
| `bun run import` 连跑两次 | 两次 exit 0，第二次 tracked diff 为 0；`dist/project.json` SHA-256 `2db9e8e8…`，报告 `61fda3aa…`，assets report `ee21f6e9…` |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 |
| `bun run build:wasm` | exit 0；WASM 289,758 bytes |
| `bun test` | 171 pass / 0 fail / 0 skip；71,144 assertions，36 files，162.23 s |
| `bun test tests/gw1-world-idle.test.ts` | 3 pass / 0 fail；84 assertions；Radiotower 与五个 evolution 边界均通过 |
| `bun run verify:g6:locks` | 333 dynamic checks；327 unlocked / 2 transferred；0 unresolved / 0 errors |
| `bun run verify:g6:determinism` | PASS；4,636 files / 61,209,639 bytes；SHA-256 `eb0e6d0fa6552f7c0edea797601db7596f6b97c0504aef900e0d911b7d46ca83` |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks / blocking fibers / errors |
| `bun run verify:gb6:mainline` | PASS；109,983 frames / 100 battles；22 trainer wins / 78 wild battles；终点 `spyder_route3@4,6` |
| `bun run verify:gb6:failures` | PASS；首败既有断言通过；later-loss 65,515 frames，Wanda gift 完整，终点 `spyder_leather_town@23,10` |
| `verify:gb6:stateful` 与 `GB6_VERIFY_MODE=rate-{60,30,20}` | 四项分别 PASS，终态一致 |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；4 个 state/pixel checkpoint，0 console errors；终点 `spyder_route1@14,19` |

`verify:gb6:full` 的组合 shell 在 stateful 已通过、rate-60 跑到 75,000 帧后超过单命令五分钟
上限；随后按 `package.json` 原样拆开执行其四个组成项。rate-30 首次被外部 SIGTERM（exit 143）
中断于 50,001 帧，立即重跑通过；这两次中断都不是断言失败，其余组成项一次通过。

浏览器验收生成的 `dist/web-journey/end.png` 已实际打开检查：Route 1 地图、玩家 sprite、
地形和画面裁切均正常，不只依赖像素 hash。

## 6. 提交与洁净度

实现分成五个可复核提交：

- `2e6516d chore: upgrade rpgkit for world idle conditions`
- `c429d05 chore(data): refresh rpgkit schema hash`
- `658f61b fix(importer): map WorldState to world idle`
- `8d12833 test: validate imported world idle gates`
- `21be9e7 test: refresh world idle journey tapes`

`bun.lock` 未改；`vendor/` 相对基线只变更 `pocket-rpgkit` gitlink，嵌套 PocketJS 工作树为空；
没有 push、PR 或外部仓库写入。

PASS
