# GB6：确定性自动战斗与 Spyder Route 3 主线真打验收

## 结果

GB6 已加入不读取随机源、不修改战斗状态的自动战斗策略，并把它用于一条只含按键 mask 的
Spyder 主线 journey。冻结 tape 从开场走到 Route 3 北段完成，共 109,981 个 60 Hz source
frames（30 分 33.017 秒）、100 场真实战斗，其中 22 场训练师战和 78 场野战；所有训练师战
均进入 Battle Processing、以 `won` 结束并写回对应的 `battle_outcome`。最终位置为
`spyder_route3 @4,6`，canonical state SHA-256 为
`bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0`。

规格列出的 19 场全部完成。本 tape 选择了经过 Wayfarer Inn 的路线，因此 Morningstar、Bravo、
Victor 三场额外训练师战也会触发，实际总数是 22，而不是把这三场从验收记录中隐藏。是否存在
绕行路线未证明——静态与按状态的两次必经证明尝试都因建模不完整被审查否定，见
`findings/review-task-1976.md`、`findings/review-task-2001.md`。原有 3,793 帧短 tape
`data/g6-journey.json` 保持字节不变，继续承担网页与快速回放。

## 1. 自动战斗策略

`battle/autoplay.ts` 提供两个纯函数层级：`chooseBattleAutoplayAction` 从只读
`RuntimeBattleState` 选完整动作，`battleAutoplayInput` 再把动作确定性地展开为根菜单、子菜单
和确认键边沿。策略优先级是：

1. 当前怪 HP 不高于 35% 时，选实际有效治疗量最大的回复道具；相同时先消耗标称回复量较小者，
   再按源顺序稳定决胜。
2. 野战目标 HP 不高于 40% 且符合 `uncaught` 或显式物种清单时，选捕获修正最大的球；主线练级
   可用 `capture:"never"` 禁止捕获。
3. 当前怪 HP 不高于 20%、健康后备怪至少多 25 个百分点，或当前没有正期望伤害招式时换怪；
   候选先比较其对当前目标的最大期望伤害，再比较 HP 比例。
4. 其他情况选择生产规则 `calculateDamage`（已含属性相克）乘命中率所得期望伤害最大的可用技能；
   相同时保留菜单中最早的技能。
5. 学习第 5 招时固定遗忘 `power × accuracy` 最低的旧招，同分遗忘最早一招。

所有 tie-break 都依赖稳定菜单/队伍顺序，策略本身不访问战斗 RNG。六个单元测试分别覆盖最大期望
伤害且状态不变、低血治疗、无药换怪、按需捕获、菜单边沿展开和第五招遗忘。journey 驱动直接
调用同一导出 API；它也保持为可由后续闲置自动玩驱动直接调用的逐帧接口。

第一战选择 Nut，对手 Billie 选择 Budaye。Scout S4 的真实 Tuxemon oracle 在这一组合的 40 个
种子上记录 40/40 胜，而 Rockitten 对 Budaye 为 0/40；因此胜线选 Nut，第一战故意败线选
Rockitten。

## 2. 主线 tape 与训练路线

主线先复用已维护的 3,793 帧开场 tape，再由寻路器、剧情选择器和自动战斗策略只产生按键 mask。
Cotton Scoop 教程后允许捕获未收录野怪；Route 2 在草丛练到队伍最高等级至少 12，每场后返回
Cotton Cafe 回血。City Park 使用现场治疗点，Route 3 每个主要对手后返回 Leather Center 找
护士回血。后段主力为捕获并练级的 Arthrobolt，最终战前达到 L32。

冻结产物：

| 项 | 结果 |
| --- | --- |
| 文件 | `data/gb6-mainline-journey.json` |
| frames / 60 Hz 时长 | 109,981 / 1,833.017 s |
| tape SHA-256 | `9ad84ea49587e3b29a4872d57a52fdfc1eb79b52e07a592b7c6868c48843b2a3` |
| 文件 SHA-256 | `507daa8f4c10d2c904d5e9c06703609a4cd57e2d289cc4afec990960349df043` |
| 战斗 | 100（22 trainer + 78 wild） |
| 终点 | `spyder_route3 @4,6` |
| 终态 SHA-256 | `bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0` |
| 原短 tape SHA-256 | `7d46671d52088ec83f7a8b5223a626d6a447dbddbe31669db4960703e80cde95`（未变） |

### 2.1 训练师战明细

“我方”是开战前完整队伍及 HP；帧区间为左闭右开。前 18 行对应规格的 Paper Town、Cotton
Town、Route 2、City Park 与 Route 3 前九名，最后的 QQQ 是规格中 Route 3 第十名；19–21 行是
本 tape 路线经过 Wayfarer Inn 时触发的三人（路线选择，非地理必经）。

| # | 对手 | 对方队伍 | 我方队伍（开战前） | 回合 | 帧区间 | 结果 |
| ---: | --- | --- | --- | ---: | ---: | --- |
| 1 | `spyder_billie` | budaye L5 | nut L5 101/101 | 7 | 2091–3225 | won |
| 2 | `spyder_confusedperson` | pairagrin L2, capiti L2 | nut L7 66/117 | 3 | 6869–7524 | won |
| 3 | `spyder_billie` | budaye L6, eyenemy L6, cardiling L3 | nut L7 117/117, aardorn L4 79/79 | 11 | 11134–13016 | won |
| 4 | `spyder_route2_roddick` | spighter L8 | arthrobolt L12 88/88, aardorn L4 79/79, cardiling L6 50/50, cataspike L3 70/70 | 3 | 35476–36030 | won |
| 5 | `spyder_route2_marion` | aardorn L7, aardorn L7 | arthrobolt L12 81/81, aardorn L4 79/79, cardiling L6 50/50, cataspike L3 70/70 | 6 | 37643–38603 | won |
| 6 | `spyder_route2_graf` | cardiling L7, cataspike L5, cataspike L5 | arthrobolt L13 81/85, aardorn L4 79/79, cardiling L6 50/50, cataspike L3 70/70 | 4 | 42031–42803 | won |
| 7 | `spyder_citypark_frances` | shybulb L8, shybulb L8 | arthrobolt L15 82/93, aardorn L4 79/79, cardiling L6 50/50, cataspike L3 70/70 | 5 | 45092–45946 | won |
| 8 | `spyder_citypark_bobette` | aardorn L10 | arthrobolt L16 98/98, aardorn L4 79/79, cardiling L6 50/50, cataspike L3 70/70 | 2 | 47416–47794 | won |
| 9 | `spyder_citypark_edith` | squabbit L8, squabbit L8 | arthrobolt L17 68/102, aardorn L4 79/79, cardiling L6 50/50, cataspike L3 70/70 | 4 | 50088–50806 | won |
| 10 | `spyder_route3_novak` | elofly L13 | arthrobolt L18 93/106, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83 | 2 | 56655–57013 | won |
| 11 | `spyder_route3_curie` | propellercat L13 | arthrobolt L19 109/110, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83 | 2 | 58754–59140 | won |
| 12 | `spyder_route3_wanda` | nudiflot_male L8, nudiflot_female L8, nudiflot_male L8, nudiflot_female L8, nudiflot_male L8, nudiflot_female L8 | arthrobolt L20 114/114, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83 | 6 | 61895–63023 | won |
| 13 | `spyder_route3_weaver` | pythwire L12, squabbit L12 | arthrobolt L23 127/127, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83 | 2 | 67340–67770 | won |
| 14 | `spyder_route3_twig` | aardorn L11, tumblequill L11 | arthrobolt L23 127/127, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83 | 2 | 68061–68475 | won |
| 15 | `spyder_route3_roxby` | rockitten L13, ignibus L13 | arthrobolt L26 140/141, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L9 137/137 | 3 | 77162–77716 | won |
| 16 | `spyder_route3_surat` | rockat L12, grintot L12 | arthrobolt L27 116/145, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L9 137/137 | 3 | 84520–85070 | won |
| 17 | `spyder_route3_zoolander` | eruptibus L14, rockat L14, forturtle L16, grinflare L16 | arthrobolt L28 149/149, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L9 137/137 | 11 | 91898–93928 | won |
| 18 | `spyder_route3_connor` | weavifly L12, cataspike L8 ×5 | arthrobolt L29 150/153, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L22 241/241 | 6 | 100674–101766 | won |
| 19 | `spyder_wayfarer1_morningstar` | cairfrey L12 ×2 | arthrobolt L30 158/158, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L22 241/241 | 2 | 107664–108076 | won |
| 20 | `spyder_wayfarer1_bravo` | elofly L12, flacono L12 | arthrobolt L31 162/162, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L22 241/241 | 2 | 108317–108729 | won |
| 21 | `spyder_wayfarer1_victor` | squabbit L14 | arthrobolt L31 162/162, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L22 241/241 | 1 | 108849–109095 | won |
| 22 | `spyder_route3_qqq` | cardiling L16 | arthrobolt L32 167/167, aardorn L4 79/79, cardiling L8 58/58, cataspike L3 70/70, eyenemy L5 83/83, pawsand L22 241/241 | 1 | 109159–109409 | won |

## 3. 重放、存读档、倒带与剧情序列

`tools/verify-gb6-mainline.ts` 的 CI 模式从第 0 帧重新折叠整条 tape，并逐场重建敌我队伍、回合数、
帧区间和结果，再与冻结的 100 条 battle checkpoints 做 canonical 比较。60/30/20 Hz 模式用
AttractController 的 60 Hz source timeline 对齐：每当 source frame 前进，就将完整
`SessionState` 与独立 60 Hz reference fold 逐字节比较，三个频率最终 SHA-256 相同。

状态验收在 Connor 战前和战后各取一个合法存档，分别从存档恢复并走完剩余 tape；两条终态都与
基线相同。倒带验收在 Novak 战后按 L，退回战斗开始前的 source frame，再重放后缀；恢复点状态和
最终状态都逐字节相同。

关键剧情状态为：`firstfightdue=yes → no`、`firstfightend=yes → no`、
`confusedchoice=yes`、`visitedcottoncafe=yes`、`route2billiefought=yes → no`、
`shaftscheme=yes`，并记录 Zoolander 胜利。运行时枚举将源字符串编码成稳定数字，因此冻结终态中
对应值为 `1, 1, 2, 1, 1, 1`。它们与 P1 自动胜利模拟器的局部因果转换一致。P1 模拟器是“任何
可达事件立即执行”的全图贪心上界，会先拿到 `shaftscheme` 再触发 Route 2 Billie；真实 journey
遵守地图地理顺序，先打 Route 2 Billie 再推进 Route 3，所以不要求两者的全局 trace 顺序相同。

长 tape 超过组件仓最初预分配的十分钟输入日志，但当前 `AttractController` 会以 2 倍扩容，完整
109,981 帧使用 432,000 bytes（u16 mask + u8 timeline），没有截断。一次从 Novak 战后回到战前的
“从第 0 帧重折叠”实测为 23,629.312 ms，已经不适合交互式倒带。建议后续组件任务按固定 source
间隔（例如 3,600 帧）并在地图/战斗边界保存 `SessionSnapshot + held mask + controller timeline`
关键帧；倒带从最近关键帧恢复并只折叠后缀，使最坏重折叠从约 110k 帧降到不超过 3,600 帧。
GB6 不修改组件仓。

## 4. 两条失败路径

第一战败线沿用真实输入 journey，选择 Rockitten 对 Billie/Budaye，3,357 帧后到达
`spyder_route1 @14,19`。战斗 history 与 `bo.spyder_billie.lost` 都为 lost；按上游可见顺序，
全局 Teleport Faint 先把玩家送回 bedroom `(3,4)`，同图恢复只显示一次
`heal_before_leave`，随后玩家回 Paper Town 时 `First Fight - Lose` 只显示一次并关闭
`firstfightdue` / `firstfightend`。这保留了两个并发上游事件的可见效果，而不是把两个 fiber 的
偶然调度顺序或重复文本当成规范。

后续败线重放主线前 61,896 帧，在 Route 3 对 Wanda 故意以 26 次换怪、1 次最低伤害技能输掉
27 回合，战斗区间 61,895–65,222。它验证了：

- `bo.spyder_route3_wanda.lost=true`；
- 传送到昏厥点 `spyder_leather_center @6,7`，队伍仍为全倒状态；
- 第一次尝试从 `(6,10)` 离开时 “You should heal your monsters before heading off.” 拦截，
  地图不变；
- 找护士选择 Yes 后全队 HP 恢复到 max，第二次可正常离开到 `spyder_leather_town @23,10`。

两条失败 tape 分别为 `data/gb6-first-loss-journey.json` 与
`data/gb6-later-loss-journey.json`；后者 tape SHA-256 为
`2310ba6b0fab4f05c41344a02b214bdc9d503dcee1bb9ea57a3acbe44d2f5afd`，终态 SHA-256 为
`d87ba6c0b379d6f198abed2b033376455132b6aac0725c35223fd430cd1d4c99`。

## 5. 覆盖率

导入器现在自动在 `findings/G1-coverage.md` 生成 P2 battle/monster Placeholder 审计。玩家对训练师、
双打、固定/随机野战、战果、队伍数量、持有怪物、进化、环境、昏厥传送和实时全队倒下条件都为
Native。剩余为 20 次、6 类：

| Kind | Source type | 次数 | 保留原因 |
| --- | --- | ---: | --- |
| Action | `choice_monster` | 2 | 已确定性映射枚举选项，但不是通用队伍选择 UI |
| Action | `choice_npc` | 1 | 嵌套选择保留全部选项，尚无通用 NPC 选择 UI |
| Action | `open_shop` | 7 | 怪物交易商店保持可见占位 |
| Action | `remove_monster` | 4 | 旧 P1 `party_size` 降级仍可见，未伪装成完整 party remove |
| Action | `start_battle` | 5 | NPC-vs-NPC 不适用玩家 BattleRules，显示 skip notice |
| Condition | `is party_infected` | 1 | 当前没有 plague 子系统，固定 none=true |

目标玩家主线没有战斗/怪物 Placeholder；20 次都属于全局遗留 UI/子系统或 NPC-vs-NPC，不影响本次
玩家 P2 验收，也没有静默丢弃。全局长期目标仍是 0。

## 6. Route 关键帧

真实长 tape 在淡入结束、非 battle scene 的四个检查点捕获两种分辨率，共 8 张：Cotton Town
f6603、Route 2 f11117、City Park f43120、Route 3 终点 f109980；每处均有 480×272 和
960×544。测试固定 PNG SHA-256 与 RGBA FNV，并逐像素验证 reducer 推导位置上的玩家精灵，还按
地图验证地形/地标颜色。全部图片已逐张以原始分辨率打开核对：角色、道路、建筑、水体、植被和
Route 3 终点位置正常；960×544 是更大的逻辑视口，不是机械 2× 放大。

manifest 为 `data/gb6-route-goldens.json`，PNG 位于
`tests/goldens/gb6-mainline-{cotton-town,route-2,city-park,route-3-end}.{480x272,960x544}.png`。

## 7. QuickJS 性能

数据全部来自桌面宿主（rquickjs `Guest` + `UiSurface`，Xeon w5-3435X，Linux 6.8），不是 Bun/JSC。
长 journey 用 `tools/bench-gb6-quickjs.sh`（`bench-g6-quickjs.sh` 加 GB6 环境：`G6_FAST_BENCH=1`、
`G6_SKIP_MAP_BENCH=1`、`G6_HASH_EVERY=10`）重放完整 109,981 帧主线，两个视口；结构操作用不带
`G6_FAST_BENCH` 的同一 harness 重放 3,793 帧维护 journey（实时状态分类 +
`ui.createNode/destroyNode/insertBefore/removeChild` 计数）；回合结算另用
`tools/bench-battle-quickjs.sh` 在 bare QuickJS guest 里跑 250 场 × 12 回合的 reducer 微基准。
所有数字取自无并发 CPU 负载的干净复跑。

### 7.1 全主线帧分布（109,981 帧，100 场战斗，110 次切图）

| 类别 | n | 480×272 qjs p95 / max | 960×544 qjs p95 / max | 480 total p95 / max | 960 total p95 / max |
| --- | ---: | --- | --- | --- | --- |
| walking | 6,340 | 1.697 / 26.647 | 1.055 / 24.034 | 1.445 / 26.470 | 1.079 / 22.505 |
| map-switch | 1,760 | 2.549 / 6.293 | 3.144 / 7.264 | 2.619 / 6.364 | 3.247 / 7.472 |
| battle | 44,108 | 20.030 / 32.662 | 20.455 / 41.456 | 20.337 / 31.764 | 20.776 / 41.559 |
| battle-steady | 44,008 | 20.011 / 32.662 | 20.423 / 41.456 | 20.086 / 31.764 | 20.534 / 41.559 |
| battle-entry | 100 | 27.666 / 30.750 | 33.507 / 36.693 | 27.770 / 31.485 | 33.979 / 36.997 |
| battle-exit | 100 | 29.690 / 31.995 | 35.878 / 43.611 | 33.882 / 36.546 | 41.183 / 49.648 |
| all | 109,980 | 17.246 / 38.679 | 17.527 / 43.611 | 17.205 / 38.703 | 17.678 / 49.648 |

≤50 ms 预算（`assert_frame_budget`）在两个视口全部通过：map-switch 6.3 / 7.5 ms、battle-entry
31.5 / 37.0 ms、battle-exit 36.5 / 49.6 ms、all 38.7 / 49.6 ms。960×544 的 battle-exit 与 all
总帧 max 为 49.648 ms，距预算仅 0.4 ms，记为已知紧张点（最坏帧是 f93927 的战斗退出）。

启动到首帧 480×272 136.1 ms、960×544 148.3 ms（预算 250 ms）。总回放 wall time 480×272
661,998 ms（11 分 02 秒）、960×544 670,987 ms（11 分 11 秒），其中 QuickJS+core 合计
660,235 / 668,428 ms。结束时 QuickJS 占用 6.21 / 7.86 MiB，110 次切图，两视口终态
canonical SHA-256 均为 `bd3616c750f5aa2b76ba105713c4e921f434d397ab5a0618845e382df62fa0d0`。

### 7.2 战斗稳态结构操作与回合结算

3,793 帧维护 journey（含首战 Billie，1,132 个 battle-steady 帧）：

| 视口 | battle-steady 结构操作 | battle-round p95 / max | battle-decision p95 / max |
| --- | --- | --- | --- |
| 480×272 | 0（1,132 帧） | 11.829 / 11.829 | 12.345 / 12.345 |
| 960×544 | 0（1,132 帧） | 11.562 / 11.562 | 12.406 / 12.406 |

steady battle 不创建/销毁/插入/移除任何 UI 节点；结构操作只发生在进出战斗的场景切换本身
（480×272 entry 98/4/98/4、exit 184/1/184/1）。独立 reducer 微基准（bare QuickJS，250 场 ×
12 回合，3,000 个 round 样本）：回合结算 mean 0.724 ms、p95 0.957 ms、max 3.870 ms；整场结算
mean 8.818 ms、p95 9.384 ms、max 12.984 ms。宿主内 battle-round 的 ~11.8 ms 主要是演出/UI
提交，不是 reducer。

### 7.3 测量伪影说明

第一次长 journey 复跑与 cargo 编译、Bun 验收并发，480×272 在 f35830（`technique:sting` 演出帧）
录得 63.5 ms、960×544 在 f3187 录得 55.6 ms 的离群值并触发预算断言；无并发负载的干净复跑中这两帧
分别落到 32.7 ms 以下与 26.6 ms 以下，全部预算通过。离群值是调度伪影，不是 tape 的确定性属性。

### 7.4 CI 时长

本机（32 核）实测：`verify:gb6:mainline`（60 Hz ci 模式）77.98 s、`verify:gb6:failures` 34.82 s、
`verify:g6:locks` 约 10 s、`verify:g6:frozen` 58.1 s、`verify:g6:determinism` 23.7 s、
`bun test` 160 s、`bun run web` 13.5 s、`verify-web-journey` 2.7 s。两个新增长 tape 步骤均远低于
3 分钟门槛，无需分片。CI 只跑 60 Hz `ci` 模式 mainline（完整 109,981 帧折叠 + 100 条 battle
checkpoint 比对）；`verify:gb6:full`（stateful 存读档/倒带 + 60/30/20 Hz 对齐，本机 10 分 21 秒）
按既有设计只在本地/发布验收跑，不进 CI。估计 CI 总时长约 15–20 分钟（GitHub runner 核少，按本机
2–3 倍估）。

### 7.5 战斗 p95：12 ms → 20 ms 是样本差异，不是回退（GB6-F2）

GB5 短 journey 的战斗稳态 p95 ~12 ms，GB6 长 journey ~20 ms。用同一基准
（`g6-quickjs-bench.rs` 的 `G6_BATTLE_BUCKETS=1` 模式，480×272）分别重放两条 journey 并按
`(我方队伍规模, 敌方队伍规模, 战斗事件, 菜单状态)` 分桶后：

- **1v1 帧在两个 journey 上几乎相同**：technique p95 11.779 ms（短，n=673）vs 11.667 ms（长，n=2,071）；
  status/sendOut/faint/end 各桶差都在 ~1 ms 噪声内。若有回退，1v1 桶会先涨。
- **长 journey 的 20 ms 来自大队伍帧**：technique p95 随我方队伍规模单调上升（pp=1→6：11.7→18.5 ms）；
  pp=6/ep=4 的 technique/faint/sendOut 桶 p95 24–29 ms。长 journey 后期是 6 只怪、L32 的队伍
  （Wanda 6 只、Zoolander 4 只、Connor 6 只），每帧场上精灵更多、sendOut/faint 事件更多、高等级
  招式演出更长，battle-steady 的 p95 落在这些大队伍帧上。
- 两个数字本就不是同一桶：~12 ms 是 1v1 首战的 battle-round/decision 桶；~20 ms 是全部 battle-steady
  帧（含所有演出阶段）。

结论：无需定位回退提交——没有回退。完整分桶数据与方法见 `findings/GB6-F2.md` §3。

## 8. 最终验收

| 门禁 | 结果 |
| --- | --- |
| `bun run import` 连跑两次 | 两次 exit 0；tracked 文件 0 diff（工作树仅剩未跟踪的本报告） |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；pak 4,622 entries / 62,192,144 bytes，JS 1,146,318 bytes |
| `bun run build:wasm` | exit 0；289,758-byte wasm |
| `bun test tests/` | 167 pass / 0 fail / 0 skip，71,037 assertions，35 files，160.07 s |
| GB2/GB3/GB5 golden 与 differential | 包含在上行 167 个测试中（battle-gb3-*、battle-golden、gb6-route-golden 等），0 fail |
| `verify:g6:locks` | 329 pages / 333 locks；327 unlocked、2 transferred、0 unresolved、0 errors、0 exceptions |
| `verify:g6:determinism` | PASS；2 isolated roots，4,636 files，61,130,404 bytes，SHA-256 `0550ca5e6fdf77ba22cfe3c0db0b740c3851be2c41ad1f2a7c68c18313435b59` |
| `verify:g6:frozen` | 263 maps；0 permanent locks、0 blocking fibers、0 errors |
| `verify:gb6:mainline` | PASS；109,981 帧，100 场（22 trainer + 78 wild），终态 `bd3616c7…`，77.98 s |
| `verify:gb6:failures` | PASS；首战败线 3,357 帧 + Wanda 败线 65,500 帧，34.82 s |
| `verify:gb6:full` | PASS；stateful 存读档（f100670 / f101770）终态一致、倒带 f57073→f56655 恢复；60/30/20 Hz 分别 109,981 / 55,297 / 36,953 次逐状态对齐，终态均为 `bd3616c7…`；10 分 21 秒 |
| `bun run web && bun tools/verify-web-journey.ts` | `WEB JOURNEY PASS`；boot 367 ms，3,793 帧 1,798 ms，4/4 状态与像素检查点命中，0 console errors |
| `bun.lock` / `vendor/` | 无改动 |
| 代码与提交信息无 fleet 任务号 | 无 |

## 9. 提交

实现按自动策略、journey 驱动与 tape、完整验收器、失败路径、覆盖率/golden、QuickJS 性能和最终
报告拆分提交。本分支（`fleet/task-1963`，基线 `449d916`）共 11 个提交：

| 提交 | 内容 |
| --- | --- |
| `4fb30b6` | feat(battle): 确定性自动战斗策略 |
| `07d0819` | feat(importer): 世界破坏道具 |
| `ff5908a` | test: 记录 Route 3 战斗 journey |
| `5df7be3` | test: 验证长战斗 journey |
| `8e45184` | test: 覆盖战斗败线 journey |
| `48351bf` | test: Route 3 journey golden |
| `16ba49f` | perf: 限制重复战斗切换开销 |
| `6068ad0` | test: QuickJS 全 GB6 journey 基准 |
| `0f15970` | test: 败线 journey 入 CI |
| `d1f5b8a` | chore: 按真首战重生成 G6 lock 报告 |
| 本提交 | docs: GB6 最终报告（§7 性能、§8 验收、§9 状态） |

没有修改 `bun.lock` 或 `vendor/`，没有 push。

## 10. 跟进（GB6-F2）

review-task-1963 的跟进项（自动战斗边界、Wayfarer 路线、p95 解释）已全部完成，详见
`findings/GB6-F2.md`：

1. **自动战斗边界测试**：`battle/autoplay.ts` 的四个阈值（回血 0.35、捕获 0.4、换怪 0.2、后备优势
   严格 +0.25）与五个并列分支（技能/道具/后备/捕获球/遗忘招式）补齐边界值测试。四次变异
   （`<=`→`<`、并列取末个）全部变红；策略行为零改动，`verify:gb6:mainline` 终态不变。
2. **Wayfarer Inn 路线**：本 tape 选择了经过 Wayfarer Inn 的路线（3 场额外训练师战）；是否存在
   绕行未证明——静态与按状态的两次必经证明尝试都因建模不完整被审查否定，见
   `findings/review-task-1976.md`、`findings/review-task-2001.md`。
3. **战斗 p95 解释**：见 §7.5——12 ms → 20 ms 是样本差异（大队伍帧），不是回退。

PASS
