# GB6-F1：第一战失败时 Teleport Faint 与失败剧情的上游顺序

## 结论

上游 Tuxemon 的真实可见结果是：第一战失败后，`First Fight - Lose` 在 Paper Town
原地先完整执行并治愈 Rockitten；全局 `Teleport Faint` 一次也不执行。玩家不会在战后被送回
bedroom，也看不到 `heal_before_leave`。因此 `findings/GB6.md` §4 所写的“先回 bedroom、再返回
Paper Town 看失败剧情”不是上游行为，本报告以真实 60 Hz 上游 trace 取代那项旧结论。

游戏侧已在导入器中恢复这项互斥：Paper Town 的 `Teleport Faint` 额外要求
`firstfightdue=no` 且 `firstfightend=no`，而 `First Fight - Lose` 不再等待玩家已被别处治愈。
新失败 tape 在 60/30/20/4 Hz 都保持相同可见顺序；原 3,793 帧短 tape 和 109,981 帧主线长
tape 均保持字节不变。

## 1. 上游真实运行

### 1.1 方法

`tools/upstream-first-loss-oracle.py` 直接加载只读 Tuxemon checkout
`9e6258ff726b786040a267e8bdbbf037b560285e`，使用已有
`/var/tmp/fleet/gb2-oracle-venv`，并以 60 Hz 调用上游 `LocalPygameClient.update()`。驱动从开场
走到 Paper Town，选择 Rockitten，让 Billie 的 Budaye 打赢第一战；没有注入战果或修改玩家、怪物、
事件状态。每 tick 记录完整 state stack、目标事件的逐条件求值与启动、已执行 action、地图/坐标、
对话、剧情变量及队伍 HP。

复现命令为：

```sh
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  /var/tmp/fleet/gb2-oracle-venv/bin/python \
  tools/upstream-first-loss-oracle.py "$TRACE_OUT"
```

源 checkout 删去了字体和音乐，因此 harness 只加了系统字体 fallback，并让音频播放为空操作；
数据库仍按要求通过 `db.load(validate=False)` 加载。名字、开场怪物和菜单选项由确定性 UI 驱动选择，
地图、移动、事件调度、状态栈和战斗全部是钉住的上游代码。两次独立运行都在 5,985 ticks 结束，
输出逐字节相同：

```text
95b66f78bb186d43462e1539176b7e3f800c0a7ded4f517cda7619c79eefd8d9  upstream-first-loss-trace.jsonl
95b66f78bb186d43462e1539176b7e3f800c0a7ded4f517cda7619c79eefd8d9  upstream-first-loss-trace.rerun.jsonl
```

完整 trace 位于 `/var/tmp/fleet/<task>/upstream-first-loss-trace.jsonl`。

### 1.2 决定顺序的 ticks

| tick | 上游状态与事件结果 |
| ---: | --- |
| 2,749 | `First Fight - Start` 启动；此前的 `lock_controls` 将 `SinkState` 压在 `WorldState` 上。 |
| 3,114 | `start_battle player,spyder_billie`；栈顶变成 `CombatState`，其下仍是 `SinkState`。 |
| 5,339 | `battle_last_result=lost`，Rockitten `0/66`；`First Fight - Lose` 尚缺 `firstfightend=yes`，`Teleport Faint` 的 `current_state WorldState` 为 false。 |
| 5,570 | 战斗状态已经退出，栈为 `SinkState → WorldState → BackgroundState`；玩家仍在 `spyder_paper_town.tmx @23,10`。虽然玩家已全倒且地图不是 clinic，`Teleport Faint` 仍因栈顶不是 `WorldState` 而失败。 |
| 5,571 | `First Fight - Start` 写入 `firstfightdue=no`、`firstfightend=yes`；栈顶仍为 `SinkState`，所以全局传送仍不能启动。 |
| 5,572 | `First Fight - Lose` 启动，显示 `As expected! Old models can't compare to new ones!`；栈为 `DialogState → SinkState → WorldState → BackgroundState`。 |
| 5,799 | 同一事件显示 `I'll heal you up this time, but I'm not a charity. Rest up at home next time your monsters get worn out.`。 |
| 5,984 | 同一 tick 内执行移除 NPC、`unlock_controls`、恢复 HP/状态和 `firstfightend=no`。tick 结束时栈顶恢复为 `WorldState`，Rockitten 为 `66/66`，玩家仍在 Paper Town `@23,10`。 |

trace 汇总中 `First Fight - Lose` 启动 1 次，两个失败剧情文本各显示 1 次；`Teleport Faint`
启动 0 次，`You should heal your monsters before heading off.` 显示 0 次。最后变量为
`battle_last_result=lost`、`firstfightdue=no`、`firstfightend=no`。关键在于上游检查的是状态栈顶，
不是“栈中是否包含 WorldState”：`SinkState` 一直覆盖到失败事件自己的收尾 tick，而该 tick 又在
恢复 `WorldState` 前治好了队伍，因此全局昏厥传送从未获得可执行窗口。

## 2. 对齐修复

根因有两部分：

1. 导入器把 `current_state` 按“P1 只有 WorldState”折叠成编译期常量；包含 `WorldState` 就是 true。
2. Pocket RPG Kit 的 `inputLocked` 只阻止移动和 action 触发，autorun/parallel fiber 仍继续折叠。

旧实现因此让全局传送与首败事件同时可见，又给 `First Fight - Lose` 加了“玩家必须已治愈”的
合成条件，最终产生了先回卧室的错误顺序。此次不在没有更多上游样本时改变通用运行时，而是在
导入器中只对已证实的 `spyder_paper_town::Teleport Faint` 显式补回源剧情互斥：

- `firstfightdue=no` 挡住战斗结束到 `First Fight - Start` 发布结果门的窗口；
- `firstfightend=no` 挡住整个胜/败收尾 cutscene；
- 收尾把 `firstfightend` 关掉时队伍已经治愈，因此之后原始 `char_defeated` 条件自然为 false；
- 删除旧的 `First Fight - Lose` “玩家未倒下”合成 guard，让败线直接执行源事件。

导入器测试检查两个新变量 guard 及旧合成 guard 的消失。真实 journey 测试又在
60/30/20/4 Hz 分别确认：两句文本有序且各一次、没有战后 bedroom transfer、没有 faint warning、
仍在 Paper Town 战斗地点治愈，随后才继续去 Route 1。这里断言的是“留在各自战斗地点”；上游脚本
从 `@23,10` 进入战斗，本地 journey 从 `@21,9` 进入战斗，地理入口不同不属于语义差异。

`verify:g6:locks` 的冻结报告也随真实 guard 更新：第一战页现在无需注入
`e025_first_fight_win` 即可完成，`resolvedAt` 从 258 变为 524；总结果仍是 329 pages / 333 locks、
327 unlocked / 2 transferred、0 unresolved / 0 errors。

## 3. 重录的失败 tape

| 项 | 结果 |
| --- | --- |
| 文件 | `data/gb6-first-loss-journey.json` |
| schema | `pocket-tuxemon/gb6-first-loss/v1` |
| frames | 3,254 @ 60 Hz |
| tape SHA-256 | `7007799c3a6a1dbf4fe6ffdfd0fde6b4fb6fc6050bf7ad9f0138daf8f0344556` |
| payload SHA-256 (`sha256` 字段) | `0dac3f3daa942764253cc13f218bc22a253445b11d172edbd29ed5c142d3a81d` |
| 文件 SHA-256 | `091fe28e9556bbe2a819797a0790f28f58209a43dcf1d15697991472209dfd6b` |
| 终态 SHA-256 | `d321b2173aca055d0e0fdc39df6127f57ebad93a4cd3e758d7695c04e44f7aab` |
| 终点 | `spyder_route1 @14,19`（失败剧情后继续走完短 journey） |

新增了审查所指出缺少的 `format` 与 `tapeSha256`。文件内开场阶段仍有正常的 bedroom checkpoint；
验收禁止的是 Billie 战斗结束后的 bedroom detour。

两个受保护 tape 均未重录、字节不变：

- `data/g6-journey.json`：`7d46671d52088ec83f7a8b5223a626d6a447dbddbe31669db4960703e80cde95`
- `data/gb6-mainline-journey.json`：`507daa8f4c10d2c904d5e9c06703609a4cd57e2d289cc4afec990960349df043`

## 4. 全图同机制审计

源地图共有 78 个 `current_state` 条件：73 个 `WorldState`，以及
`MainCombatMenuState`、`MainCombatMenuState:WorldMenuState`、
`MainCombatMenuState:WorldState` 各 1 个和 `TeleporterState` 2 个。公共 YAML 展开后是 182 张地图
中的 1,487 个实例；现行折叠让其中 1,129 个为 true、358 个为 false。导入后仍活跃的主要公共页是
94 个 `Teleport Faint` 和 179 个 `Evolution all`；`Check Max Moves`、游泳状态变更及游泳遇敌页因
其他未支持 guard 而在当前产物中被移除，不构成本轮可执行并发。

审计结论按风险排序如下：

1. **明确的后续真跑候选：`spyder_radiotower::Stop!`。** 源事件在
   `spyder_radiotower.tmx:105` 锁输入，`:120` 开玩家战斗，`:121-135` 继续长段战后剧情，直到
   `:136` 才解锁。若玩家输掉，这与首战具有同一结构：上游 `SinkState` 会压住全局
   `Teleport Faint`，本运行时则可能让全局传送提早销毁源地图 fiber。
2. **结构性“过早进化”候选：** `spyder_route1`、`spyder_paper_town`、
   `spyder_radiotower`、`taba_ba_br_1`、`taba_ba_br_2` 都有锁跨越玩家战斗的路径。战斗产生待进化
   状态后，上游的 `Evolution all` 仍受 `WorldState` 栈顶门控；当前导入页可能在本地 cutscene
   解锁前启动。这里是静态候选清单，尚未宣称可见结果一定不同。
3. **不是玩家同类风险：** `spyder_nimrod_middle`、`spyder_scoop3`、
   `taba_ba_br_3` 的锁跨 battle 片段是 NPC-vs-NPC 战斗，不会让玩家全倒，也不会产生玩家进化
   pending 状态。
4. 绝大多数普通训练师事件在 `start_battle` 前已经 `unlock_controls`，不具备“锁跨越玩家战斗”
   的必要结构，不能仅凭每张图存在公共 `Teleport Faint` 页就判为缺陷。

因此本轮只修已由真跑定案的首战，不对 1,129 个 true-fold 实例做猜测性批量改写。已提议后续加入
通用的“world idle / 无阻塞状态”页条件，让导入器把 `current_state WorldState` 映射到运行时对
input lock、modal、battle、fade 等阻塞状态的统一判断，再以 Radiotower 失败和上述进化候选做
oracle 验收。该提议只登记，未假定已排期；本轮未修改组件仓。

## 5. 验收

| 门禁 | 结果 |
| --- | --- |
| 上游 oracle 连跑两次 | exit 0；各 5,985 ticks；trace 逐字节相同，SHA-256 `95b66f78…` |
| `bun run import` 连跑两次 | 两次 exit 0；每次后 tracked diff 为 0 |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 |
| `bun run build:wasm` | exit 0；289,798 bytes |
| `bun test` | 167 pass / 0 fail / 0 skip；71,051 assertions |
| `verify:g6:locks` | 329 pages / 333 locks；327 unlocked / 2 transferred；0 unresolved / errors |
| `verify:g6:determinism` | PASS；4,636 files / 61,130,652 bytes；SHA-256 `7e010e985bda919d5326b6c099b25be0b5f7ac0d43ebcbec6093dd0a4bf258b7` |
| `verify:g6:frozen` | 263 maps；0 permanent locks / blocking fibers / errors |
| `verify:gb6:mainline` | PASS；109,981 frames / 100 battles；终态 `bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0` |
| `verify:gb6:failures` | PASS；首败 3,254 frames，终态 `d321b217…`；后续 Wanda 败线不变 |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；0 console errors |
| `bun.lock` / `vendor/` | 相对基线无 diff |
