# GI-1b 移动控制与扩展选择框导入审查

审查对象为 `fleet/task-2081`，被审 HEAD
`902ba4b53d6fc0d5886ef90bed8b2d84cf3ec108`。规格基线是 `43ab2d2`；本轮另在临时
worktree 中把指定的 `main` 提交
`b832794d6b6ad6e6a8557ed77afabf3b8ba8b497` 合到被审 HEAD，未改动被审分支。
所有需要 Tuxemon 源的命令均设置 `TUXEMON_SRC=/var/tmp/tuxemon-src`。

## 结论

FAIL。被审分支本身的导入、编译、测试、J2 重录、跨频率重放、存档/倒带以及
玩家队伍中的真实删除都能通过；J2 的 56 场胜利和医院终点也保持不变。但是，
数项被报告为 Native 的映射并不等价于上游，其中 `choice_npc` 在唯一真实用例中
无法区分六个选项，`char_position` 后紧跟 `char_face` 的真实剧情序列会丢失朝向。
此外，必需的状态文档与实现相反，性能报告使用 JSC 外推 QuickJS，且与指定
`main` 的语义合并仍有一个 web journey 检查点失败。因此不满足规格验收。

## 阻断项

### B1 — `choice_npc` 的唯一真实菜单不可用，却被标为 Native

上游 `choice_npc` 的可选 `label` 本来就是所有按钮共享的文字，选项身份由各自的
NPC 立绘表达：`choice_npc.py:64-67` 把共享文字写到每项，
`states/choice_npc.py:75-103` 为每个 slug 加载不同正面图再加按钮。唯一内容用例
`mods/tuxemon/maps/start_tuxemon.yaml:16` 正是六种玩家外观配共同的 `menu_select`。

导入器只保留共同文字，`importer/project.ts:1141-1145` 因而生成六个 label 都为
`Select` 的行；组件 UI 在
`vendor/pocket-rpgkit/src/ui/DialogBox.tsx:181-204` 只画 label，不画 option 图像。
`tests/importer.test.ts:563-570` 甚至把六行全部相同锁成了期望。玩家看到的六个
选项没有可辨别信息，不能完成原作的外观选择。需要为扩展选择框提供并显示 NPC
预览（或等价的可辨识文字）；在此之前至少应记为 Degraded/Placeholder，不能记
Native。

### B2 — `char_run` 不是上游等价的 Native 映射

上游 `CharRunAction` 调用 mover 的 `running()`
（`tuxemon/event/actions/char_run.py:33-39`），而 mover 仅在 body 已经移动时把速度
绝对设为全局 `player_runrate`（`tuxemon/entity/entity.py:118-129`）。被审实现把
`running=true` 永久写进 runtime override
（`vendor/pocket-rpgkit/src/engine/move-control.ts:128-130`），随后把当前速度 grade
提高一级（同文件 `:171-182`）。两者既不是同一速度规则，也不是同一生存期。

真实内容 `mods/tuxemon/maps/route1.tmx:771-772` 先执行 `char_run christie`，再开始
`pathfind`；Christie 当时未移动时，上游调用可无效果，被审实现却会加速之后的
路线。`importer/project.ts:1626-1629` 和覆盖率把这两次都记为 T1/Native 不成立。
应重做成与当前移动状态和上游绝对 run rate 相符的命令，或按真实差异降级。

### B3 — `remove_monster` 只删玩家容器，不满足上游全局 IID 语义

上游先全局按 IID 找 monster，再找 owner，最后从该角色队伍删除
（`tuxemon/event/actions/remove_monster.py:37-60`），所以目标可以属于 NPC。
当前 handler 只查玩家 `party`，没找到才查玩家 `kennel`
（`battle/extension.ts:670-688`）。真实 Nimrod 事件先执行
`get_party_monster spyder_nimrod_argon`，再执行 `remove_monster iid_slot_0`
（`mods/tuxemon/maps/spyder_nimrod_middle.tmx:350-351`）；前一个动作目前仍被 Dropped，
而即使变量被注入 NPC monster IID，后一个 handler 也不会删除它。

玩家 party/kennel 的“真删”实现和测试有效，但不能据此把四次存活用例全部写为
Native。需要支持 NPC owner，或把不支持的调用按可达上下文准确降级/丢弃。

### B4 — 真实 `char_position` → `char_face` 序列丢失朝向

`spyder_paper_rival_downstairs.yaml:94-95` 先把 player 放到 `(6,8)`，随即要求向左。
导入器分别发出 `place`（`importer/project.ts:1649-1658`）和不等待的 face route。
session 先安装 pending route（组件仓 `src/engine/session.ts:1637-1665`），再处理
placement；player placement 会调用 `stopPlayerRoute`（同文件 `:1690-1699`）。

主审用该真实导入事件做 reducer 探针，触发后的输出是：

```text
{"position":[6,8],"facing":0,"playerRoute":null}
{"nextPosition":[6,8],"nextFacing":0,"playerRoute":null}
```

这里左向应为 facing `1`，下一帧仍保持 `0`，不是时序延迟。需要让 placement 不吞
后继 face，或把该相邻动作安全合并为带 `dir` 的 placement，并补真实内容回归测试。

### B5 — 必需的功能状态清单和导入文档与实现相反

`docs/status.md:34-36` 把上述 run/placement 以及“无冻结”写成 Done，`:62-63`
把三类选怪和所有 remove 语义写成 Done；这没有说明实际限制。
`docs/importer.md:76,80,93,95` 又仍说 `char_stop` 无输出、wander 无 frequency/bounds、
选择框仍为 placeholder、remove 只减计数，描述的是改动前行为。
`docs/status.md:100-102` 的三段 journey 帧数也仍是旧值。

`findings/GI1b.md:30-39` 还把上游 wander 误写成“每 NPC RNG”，并称
`char_position` 丢失平滑插值；实际上上游 wander 使用 Python 模块级 `random.choice`，
而 `CharPositionAction` 直接 `complete_tile_entry`，本身就是瞬时放置
（`tuxemon/event/actions/char_position.py:35-48`）。`:97-99,142-143` 把冻结扫描
的 0 锁进一步解释成“wanderer 不会堵死玩家”，也超出了扫描器断言范围。主审在
玩家四邻都放 blocking NPC 的合成图上运行同一扫描器，仍得到：

```text
permanentLocks=0 permanentBlockingFibers=0 errors=0 flagged=[]
```

这证明该扫描只排除解释器锁/fiber，不证明空间可达。用户要求落实的功能必须在
状态清单中写明能力和限制；当前文档既互相矛盾，也把 Degraded 写成 Native/Done。

### B6 — 规格要求的 QuickJS 成本依据没有成立

`findings/GI1b.md:128-140` 的边际数据来自 Bun/JSC，再用“QuickJS 大约慢十倍”外推
成最坏图约 `1.1 ms/frame`；这不符合“性能以 QuickJS 为准”，也不是实测的
`0.18 ms / wanderer / frame`。报告还只列 after 的启动/走路/首访数值，没有规格
要求的 before/after 对照。

主审用真实 rquickjs 桌面宿主、完整生产 UI 与 `spyder_scoop4`，在同一运行程序里
轮转启用 0/2/4/6 个真实 wander override；每档 5 次、每次 600 帧。三次独立运行
得到的 0→6 边际分别为 `0.020914`、`0.017017`、`0.024839`
ms/wanderer/frame。最后一次 0 个为 `0.750152 ms/frame`，6 个为
`0.899187 ms/frame`，总增量 `0.149035 ms/frame`。因此原外推没有复现，但实测
性能反而更好，约 `0.017–0.025 ms/wanderer/frame`，没有帧预算风险。

官方完整 app 的真实 rquickjs 复跑也通过 canonical state hash `1b46a8e5…`：
startup-to-first `203.713 ms`，walking mean/p95/max
`1.150/1.785/2.532 ms`，all-frame max `24.946 ms`。问题是报告口径与证据，
不是观测到性能回退。

### B7 — 与指定 `main` 的临时语义合并并非全绿

把精确提交 `b832794` 合入被审 HEAD 初始产生 10 个冲突：

```text
data/g6-assets-report.json
data/gb6-later-loss-journey.json
data/gb6-mainline-journey.json
data/j1-captainreturns-journey.json
data/j2-hospitalcure-journey.json
dist/import-report.json
importer/project.ts
reports/G1-coverage.md
tests/importer.test.ts
tools/bench-g6-quickjs.sh
```

主审在临时副本中做了语义合并：同时保留 `FacingMode`/`AnimationDef`、
`surfaceLabels`/`wanderControls` 和 benchmark stale-artifact preflight，并按合并后的
项目状态重新录制 GB6、later-loss、J1、J2。导入两遍稳定，生成内容 hash 为
`3482ee87d91b6b960d501999c10b33acbe5b40900e22d956686d2ff4adac3982`；typecheck、
build、wasm、271 项测试以及所有 CLI journey/锁/确定性/冻结门禁均通过。

但最终 web journey 不是 PASS。命令
`bun run web && bun tools/verify-web-journey.ts` 的关键输出为：

```text
FAIL native-density dialog @1537: state spyder_paper_town,21,14,
physical sha256 4a7b2dc90183c1640fd379e816f401fad5f5abc659bd1d925c26125db2157910
(want f15eb46178229cab37c8fd9aa4d34b0f361a940ada21c8eb6fbbd3c003faea1c),
map nearest mismatches 0, text native-density mismatches 3591
console errors: 0
WEB JOURNEY FAIL
```

即 GI-1b 改变后的 G6 路径在 main 新增的原生密度对话固定帧到达不同位置/整帧，
需要重新选择稳定检查点并肉眼确认/更新 golden，不能声称当前合并全绿。

## 逐项语义核对

| 动作 | 审查结论 | 证据摘要 |
|---|---|---|
| `char_stop` | 成立，Native | `moveControl stop` 取消活动路线并停止 page patrol；导入器见 `importer/project.ts:1262-1268`，目标测试通过 |
| `char_wander` | 部分成立，Degraded 合理 | bounds、确定性 seed、frequency 最近 grade 均有实现；路径不追求 Python 全局 RNG 序列一致。报告的“per-NPC RNG”应改正 |
| `char_speed` | 部分成立，Degraded 合理 | tiles/s 到 MV 指数 grade 必然量化，见 `importer/project.ts:1612-1624` |
| `char_run` | 不成立为 Native | 见 B2；上游只在正在移动时设绝对 runrate，当前实现持久加一 grade |
| `set_facing_mode` | 成立，Native | `follow_movement`/`locked`/`scripted` 映射完整，显式 face 仍可工作，见 `importer/project.ts:1634-1647` |
| `char_position` | 部分成立但有真实 bug | 越界 clamp 相对上游抛错是如实 Degraded；与紧随的 player face 组合失败，见 B4 |
| `get_player_monster` | 功能可用，但应为 Degraded | live party、过滤、无选项和 cancel 的变量结果有效；上游 `MonsterMenuState` 的图像、详情、禁用项表现没有保留 |
| `choice_monster` | 功能可用，但应为 Degraded | TextFormatter、选项、枚举值保留；上游 `ChoiceMonster` 的动画头像与 journal/info 入口丢失（`states/choice_monster.py:82-173`） |
| `choice_npc` | 不成立 | 唯一用例六行不可区分，见 B1 |
| `remove_monster` | 部分成立 | 玩家 party/kennel 真删成立；NPC owner 语义缺失，见 B3 |

新 lowering 都由通用导入规则生成，没有逐地图手改导入产物；两次完整 import 字节稳定。
组件能力来自随 main 合入的子模块指针更新，GI-1b 没有直接改 PocketJS，也没有修改
`bun.lock`。

## J2 重录核对

`tools/j2-journey.ts:319-325` 解释 Frances 的动态 body 使 BFS 绕开 Blair 与 Richard，
然后明确先 `fightNpc("spyder_route6_richard")` 再打 Blair。`fightNpc` 是走到当前 live
NPC、交互并要求 win count 恰好加一，不直接写剧情开关或战斗结果。因此这两场从
偶然视线触发改成显式 driver 目标是合理的，且改动范围只在 Route 6。

主审在被审分支独立复跑结果：

| 校验 | 结果 |
|---|---|
| J2 mainline | PASS；segment 50,110 帧，combined 171,949 帧；56 战 = 50 trainer + 6 wild，全部胜利 |
| 60/30/20 Hz | PASS；三者终态 hash 都是 `50ecaa6a6796bb72c502b2bf89f6c089f05972be7bea0ccaab43233d7f54bc26` |
| stateful | PASS；在 combined frame 170,572 保存恢复；从 170,572 倒带到 169,651 后重放一致 |
| segment standalone | PASS |
| 终点/剧情 | `spyder_candy_hospital3@(5,7)`；cure、Nimrod、Candy 路线等终态断言不变 |

提交前后的可读 driver 与 tape 差异支持“wander 引发绕路”的解释；不过报告提到的
中间 48-trainer 失败 tape/日志没有作为可复跑 artifact 留存，因此这条因果链不能仅
靠报告中的历史数字独立重现。这不影响新 tape 的 56 胜和终点验收。

## 确定性、选择框边界与变异检查

- `vendor/pocket-rpgkit/src/engine/chars.ts:1-20` 明确按 reference tick 与保存态 RNG
  驱动，不使用 host clock/`Math.random`；源码搜索没有活动 `Math.random`。
- `km1-move-control.test.ts:482-503` 覆盖 60/30/20/4 Hz 相同轨迹，`:597-615`
  覆盖 save/restore 后 120 tick 一致，`:671` 起覆盖有/无 keyframe 的 rewind。
  主审复跑这些测试通过。
- frequency 0 经导入规则映射为上游默认 1 秒，再量化为 grade 3；不是 kit 中
  frequency grade 5 的零 cooldown，因此不会形成永久 0 锁。
- `get_player_monster` 的 importer guard 在无匹配项时写 `no_options`
  （`importer/project.ts:1734-1760`）；组件的真正空 provider 可 displaced 后再出现，
  confirm 在 displaced 时不关闭 modal。目标测试均通过。
- `battle/extension.ts:681-687` 确实按 IID 删除玩家 party 或 kennel 对象，而非只减
  `party_size`；范围缺失见 B3。

三项变异均在隔离 worktree 中进行并已还原，证明测试能杀死关键回退：

| 变异 | 目标测试结果 |
|---|---|
| 改坏 wander frequency 换算 | 0 pass / 1 fail |
| 禁用真实 `remove_monster` 删除 | 0 pass / 1 fail |
| 去掉 extChoice 的 `!displaced` confirm guard | 失败：modal 错误关闭，而期望仍为 `choices` |

被审 worktree 和变异副本最终均 clean。

## 独立门禁

所有重命令串行执行。

| 命令/检查 | 被审分支结果 |
|---|---|
| `bun run import` 两遍及 diff | PASS；生成结果字节稳定，worktree clean |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` / `bun run build:wasm` | exit 0 |
| `bun run test` | 264 pass / 0 fail / 0 skip，43 文件 |
| `bun run web && bun tools/verify-web-journey.ts` | PASS；四个 state/pixel checkpoint，0 console error |
| `verify:gb6:mainline` | PASS；109,654 帧，100 战 |
| `verify:j1:mainline` | PASS；combined 121,839 帧，segment 17 战 |
| `verify:gb6:failures` | PASS；首败和中途败/恢复路径 |
| `verify:g6:locks` | PASS；330 pages / 334 locks，0 unresolved/error |
| `verify:g6:determinism` | PASS；4,638 文件，两隔离根 hash `4f978a94…` |
| `verify:g6:frozen` | PASS；263 图，0 permanent lock/blocking fiber/error（仅限该断言） |
| J2 四种模式与 60/30/20 Hz | 全部 PASS；详见上一节 |

## 画面核对

主审以原始分辨率打开并肉眼检查了四张 J2 golden：

- `j2-aardant-acquired.480x272.png`：角色与路面清楚，取得 Aardant 的场景构图正常；
- `j2-hospital-password.480x272.png`：医院走廊/人物和对话层次正常；
- `j2-hospital-cure.480x272.png`：病房人物、床位和地形遮挡正常；
- `j2-hospital-cure.960x544.png`：是同一 cure 场景的更大视口，可见更广地图，不是
  把 480×272 错误裁切或模糊放大。

四帧内容彼此可辨，角色没有漂移到墙内或被错误图层遮没。相关 golden 测试通过。

## 临时合并的其余结果

在 B7 的语义冲突解决与四段 tape 重录后，临时副本得到：

- GB6/J1/J2 mainline、GB6 failures、G6 locks/determinism/frozen 全部 PASS；
- J2 CI/segment/stateful/60/30/20 全部 PASS，56 胜，终态
  `c8834891dac55ace0ea9ccc719c108188c2221c254a4db379929171e9591134d`；
- `bun run build` 后全量测试 271 pass / 0 fail，J1/J2/GI-1a targeted golden
  11 pass / 0 fail；
- 唯一剩余红项是 B7 所列 native-density web dialog 固定帧/golden。

因此合并是可解的，但有大量生成数据/tape 冲突，并且当前不能称“全绿”。这些改动
只存在临时副本，没有进入被审分支。

subagent 使用：3 个；分别核对确定性/测试辨识力、J2 合并与重录、上游动作语义；并行只读核对节省了时间，所有长门禁、变异隔离、QuickJS 实测、画面检查及最终判定均由主审复核。

FAIL
