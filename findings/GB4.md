# GB4：真实战斗接线、逐位一致怪物生成与第一战 journey

## 结果

GB4 已把 Tuxemon 的战斗事件接到 Pocket RPG Kit 的 Battle Processing：玩家选择初始怪后会得到持久化的真实怪物快照，Billie 的队伍进入 GB2 reducer，技能菜单驱动真实回合，胜负、HP、经验、训练点、金钱和战斗历史写回 `SessionState.ext`，原剧情再按上游的 `battle_outcome` 分支继续。维护的胜线选择 Nut，真实击败 Billie 后到 Route 1；独立败线选择 Rockitten，战败后按昏厥点回卧室、回血，再走 “First Fight - Lose” 分支到 Route 1。

这次没有手改任何地图或事件产物。事件、队伍、遇敌表、战斗数据库和 runtime 投影仍全部由 `/var/tmp/tuxemon-src` 的固定 revision `9e6258ff` 自动生成。`bun.lock` 与 `vendor/` 相对基线 `d74222f` 均未改变，也没有 push。

## 1. 怪物生成与上游逐字段一致

`battle/spawn.ts` 复现 `Monster.spawn_base` 的抽取顺序和数值语义：性别、冷/热口味、身高、体重、六项 IV 与生日每只固定消费 13 次随机抽取；随后设等级、基础属性、经验修正、金钱修正，并按等级和进化阶段筛选最后四个可学招式。浮点舍入单独实现了 Python `Decimal` 的 ties-to-even 行为。

Golden 由固定的 Python oracle `tools/battle-oracle/generate_spawn.py` 生成，覆盖全部 213 个已导入 Spyder 训练师定义、12 种代表性野怪和三个种子 `1 / 0x12345678 / 0xffffffff`：

| 指标 | 结果 |
| --- | ---: |
| Golden cases | 675 |
| 怪物快照 | 1,431 |
| RNG draws | 18,603 |
| 每只怪抽取 | 13 |
| 逐字段 / 最终 RNG 游标差异 | 0 |
| Golden SHA-256 | `8ac41a86e700ded139b7f74289f8bed301351cc4492c5e3be9cbb649c249344b` |

生产环境不读取 Python oracle 夹具。导入器从完整 `data/battle-db.json` 自动投影出 reducer-only 的 `data/battle-runtime-db.json`；生产投影经过 schema 校验后，与完整数据库经 `battleDbToTuxemonBattleDb` 得到的结果完全相等。怪物生成 golden 和既有 8,560 场差分都直接对生产投影执行：

| 数据 | 字节 | SHA-256 |
| --- | ---: | --- |
| 完整 battle DB | 1,038,121 | `afaaefff6189f0dbe6639f7b88f72bbaaa2843ebe92a6c0380245e93cf36b2fd` |
| runtime battle DB | 552,088 | `a2080457b19f2df2397f861e20cda4c959a51d46b82b5fcefccc3e42d44cd0a7` |

8,560 场 Spyder 差分结果保持 `identical=8560, different=0`。

## 2. 持久队伍与扩展状态

`battle/extension.ts` 注册 `tux.*` 的纯函数命令、条件与 codec。扩展状态包含：

- 玩家队伍（上限 6）与 kennel（上限 30）；
- 已捕获物种、NPC 临时队伍、稳定怪物 iid；
- 双向战斗历史、战斗奖励金钱；
- 当前战斗环境与按角色保存的昏厥点；
- 下一怪物 id，所有计数和写回都受有限数 / safe-integer 校验。

支持的命令是 `tux.add_monster`、`tux.set_monster_health`、`tux.set_monster_status`、`tux.set_environment`、`tux.set_faint_point` 与 `tux.prepare_faint_transfer`。`billie_choice` 这类变量怪名先通过导入器保存的候选枚举解析，再生成怪物；NPC 的 `add_monster` 暂存到 `npcParties`，紧邻的训练师战斗启动后原子消费。

支持的条件是 `tux.party_size`、`tux.has_monster`、`tux.char_defeated`、`tux.battle_outcome`、`tux.battle_outcome_count`、`tux.environment_is` 与 `tux.has_faint_point`。其中 `char_defeated player` 读取当前队伍是否全倒，不再借用战果开关。

存档 codec 使用版本化 envelope `pocket-tuxemon/ext/v1`。运行态把完整状态包装为不可变、版本化 JSON 字符串，并对每个不同值做完整验证；普通世界帧复用已验证解码，避免 Kit 的防御性 clone 每帧递归复制整个队伍。测试覆盖 checksum save/restore、malformed state 拒绝、倒带恢复、容量边界和越界后的固定 RNG 消费。

## 3. BattleRules 适配

`battle/runtime.ts` 实现 Kit 的 `BattleRules`：

1. `start` 验证 setup 和玩家队伍；空队、全倒、无招、无有效环境或空敌队返回 `null`，事件 fiber 立即继续。
2. `trainer` 使用导入器折叠的 inline party 与扩展状态中的 staged NPC party；`wild` 生成固定野怪；`random` 先做上游形状的 `uniform(0,100) > probability` 判定，再按权重选 encounter row、按闭区间选等级。
3. 所有生成只消费 Battle Processing 得到的会话派生 seed；创建 battle 后 reducer 接手剩余 RNG 游标。
4. `step` 把上下键和确认键映射到最多四个技能。事件演出每项固定 12 reference ticks，因此 60/30/20/4 Hz 在相同虚拟时间得到同一 reducer 状态；终局事件显示完才允许 `done`。
5. `done` 写回玩家快照（HP、状态、经验、训练点、bond）、奖励金钱、双向历史、`v.battle_last_*`、`boc.<npc>.<outcome>`、`bo.<npc>.<outcome>` 和 `defeated.*`。

战败本身不会在 BattleRules 内擅自传送。导入后的 `set_teleport_faint` 保存地图与坐标，源剧情里的 `teleport_faint` 再通过变量传送；上游“到同图时回血并清状态”的行为由 `tux.prepare_faint_transfer` 保留。

生产入口 `battle/production.ts` 注册自动生成的 runtime DB、扩展处理器与规则；`main.tsx` 同时把这些规则和 `TuxemonBattleScene` 交给 `GameView`。世界在战斗期间继续使用 Kit 的默认冻结语义。

## 4. 导入器接线与覆盖率

下列源动作现在原生导入：单打 `start_battle`、`wild_encounter`、`random_encounter`、玩家/NPC `add_monster`、`set_monster_health`、`set_monster_status`、`set_environment`、`set_teleport_faint` 与 `teleport_faint`。下列条件读取实时扩展状态：`party_size`、`has_monster`、`char_defeated`、`battle_outcome`、`battle_outcome_count` 和 `environment_is`。

覆盖率由全量 263 图重新导入自动统计：

| Kind | 基线 native | GB4 native | 增量 | 基线 executable | GB4 executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actions（13,617 uses） | 9,619（70.6%） | 11,537（84.7%） | +1,918 | 78.7% | 89.8% |
| Conditions（8,663 uses） | 5,757（66.5%） | 7,664（88.5%） | +1,907 | 76.4% | 89.6% |

主要战斗动作的逐类结果：

| Source op | Native / total | 非 native 原因 |
| --- | ---: | --- |
| `add_monster` | 785 / 792 | 7 个固定 false guard |
| `start_battle` | 325 / 331 | 5 个 NPC-vs-NPC 可见占位，1 个未实例化源事件 |
| `wild_encounter` | 20 / 20 | — |
| `random_encounter` | 438 / 476 | 38 个固定 false guard |
| `set_monster_health` | 82 / 83 | 1 个固定 false guard |
| `set_monster_status` | 82 / 83 | 1 个固定 false guard |
| `set_teleport_faint` | 27 / 29 | 2 个固定 false guard |
| `teleport_faint` | 11 / 11 | — |

8 个 `start_double_battle` 仍是明确、可见的占位；GB2 reducer 尚未实现双打，报告没有把它们伪装成 native。固定 false guard 和未被任何地图实例化的源事件仍按导入器既有规则记为 dropped。

## 5. 最简战斗画面

`ui/battle-scene.tsx` 是只读场景投影，显示导入的环境背景、双方前/后怪物图、名字、等级、按比例和阈值着色的 HP 条、当前演出消息、最多四项技能及选择光标。布局以 480×272 为基准，在 960×544 精确放大 2 倍；输入、计时和战果均由 reducer 持有，组件本身不藏状态。

验收图为 `findings/GB4-battle.png`（480×272，26,795 bytes，SHA-256 `d63c955e4365e84df1649a22098a1aafd822f52a2ed4fa05948bd01af7f10e50`）。已实际打开核对：草地背景、Nut 后图、Budaye 前图、双方名字/等级、HP 条、`CHOOSE A TECHNIQUE`、`BULLET`、`STATIC FIELD`、`SHURIKEN` 均可读。预览文字使用固定 3×5 像素字形，因此 fixture 不受系统字体影响。

`tests/battle-scene.test.ts` 同时断言 480×272 与 960×544 布局，并从 PNG 解码后验证 HP fill 末端像素与 `hpBarWidth(current,max)` 一致；预览字节也与提交的 PNG 完全相等。

## 6. 第一战真实 journey

维护 tape 已从 P1 战斗占位切到真实选择/技能输入：

| 路线 | 初始怪 | 60 Hz frames | 战果与恢复 | 最终位置 |
| --- | --- | ---: | --- | --- |
| Win | Nut | 2,774 | history `won`，`bo.spyder_billie.won=true` | `spyder_route1 [14,19]` |
| Lose | Rockitten | 2,887 | history `lost`，卧室 `[3,4]` 昏厥恢复后完成 lose 分支 | `spyder_route1 [14,19]` |

两条路线各在 60、30、20、4 Hz 重放，关键文本、选择、地图序列、checkpoint 与最终语义一致。4 Hz 一帧折叠 15 个 reference ticks，败线中两个并行 fiber 的日志行可换序，因此验收比较事件语义和最终状态，而不要求没有意义的 console 行全序一致。

每种频率、每种胜负都在战斗结束后按 L 倒带回活动中的 battle scene，再重放保留后缀；恢复后的 `SessionState` 与未倒带基线逐字节 canonical JSON 相同。维护的 60 Hz 胜线结果记录 SHA-256 为 `aedba1e269f930a53e0108574b13d448a6c327a10917a266dd74ec6dcffb8941`；QuickJS 完整终态 canonical SHA-256 为 `fa06b6c6d379c889c5e51ba9356199e3e55845b20ef830f51c50d7c67a0d7993`。

## 7. 正确性、稳定性与回归门禁

最终验证：

- `bun run import` 连跑两次，工作树无第二次差异。
- `bun run verify:g6:determinism`：两个隔离输出根均为 `files=3167 bytes=58526345 sha256=7fbcce6e6181ed1344b3a1f4500b56698595ed4caf0b1609560d801b1a959855`。
- `bunx tsc --noEmit`：exit 0。
- `bun run build`：成功，3154-entry pak；`bun run build:wasm`：成功，289,758-byte wasm。
- `bun test`：91 pass，0 fail，54,901 assertions；没有跳过 built-bundle replay。
- 生产 runtime DB 上的 GB2 差分：8,560 identical，0 different。
- `bun run verify:g6:locks`：329 pages、333 lock commands / dynamic checks，327 unlocked、2 transferred、0 unresolved、0 errors。
- `bun run verify:g6:frozen`：263 maps，每图最多扫描 12,000 frames；0 permanent locks、0 permanent blocking fibers、0 errors。
- QuickJS 全地图首访：263 / 263 完成；262 张在预算内，唯一 `test_npcs` 是既有显式 exempt，最慢总耗时 67.852 ms，无运行错误。
- `bun run web && bun run web:verify`：30 requests 全为 200、0 failed request、0 console error，`web-verify: PASS`。
- `bun.lock` 与 `vendor/` 相对 `d74222f` 无变化。

## 8. QuickJS 性能

`bun run bench:g6:quickjs` 使用 PocketJS desktop host 内的 QuickJS，不是 Bun/JSC。它重放真实首战 tape，并校验两种视口最终状态都等于 canonical SHA-256 `fa06b6c6d379c889c5e51ba9356199e3e55845b20ef830f51c50d7c67a0d7993`。

| Viewport / metric | mean | p95 | max |
| --- | ---: | ---: | ---: |
| 480×272 walking | — | 1.250 ms | 2.040 ms |
| 480×272 map-switch | — | 3.856 ms | 13.712 ms |
| 480×272 battle | — | 6.830 ms | 12.473 ms |
| 480×272 battle entry/exit | — | — | 34.043 ms |
| 960×544 walking | — | 1.128 ms | 2.299 ms |
| 960×544 map-switch | — | 3.138 ms | 13.411 ms |
| 960×544 battle | — | 6.055 ms | 11.438 ms |
| 960×544 battle entry/exit | — | — | 34.058 ms |

启动到首帧分别为 315.880 ms 与 254.041 ms；所有重放帧的最大值分别为 34.043 ms 与 34.058 ms。普通步行没有保留早期“大对象 ext 每帧深拷贝”带来的约 2.5 ms 回退；版本化 opaque state 后保持约 1.1–1.3 ms p95。完整 runtime DB 也没有在首战时从 pak 冷解析；自动生成的静态 reducer 投影消除了实验方案曾出现的 245–451 ms 隐藏尖峰。

独立 reducer QuickJS 基准（250 场、2,750 个 round）为：round mean/p95/max `0.5751 / 0.8154 / 2.2480 ms`，完整 battle mean/p95/max `6.4258 / 7.2454 / 8.8978 ms`。

## 9. 明确保留给后续的范围

- 8 个双打仍是覆盖率报告中的可见 placeholder；需要先扩展 GB2 的 field/decision 规则再接线。
- 5 个 NPC-vs-NPC `start_battle` 仍是可见 placeholder；当前 BattleRules 的持久写回以玩家队伍为边界。
- GB4 画面只完成可玩的最简皮肤；完整过场动画、特效、音效和更完整的技能信息留给 GB5。
- 战斗奖励金钱先保存在 Tuxemon 扩展状态，尚未与 Kit 的通用钱包合并；不影响当前首战与上游战果条件。

## 提交

本任务的实现按可测批次提交：怪物生成、扩展状态、BattleRules、导入接线、场景、journey/golden、性能修正、冻结扫描与标注后的视觉 fixture。最终提交以本报告为准；没有 push。
