# 审查 G1（task 1797 + 续做 1816）：Tuxemon 事件导入器

审查人：task 1819（claude-p）。被审分支 `fleet/task-1797` @ `9bbdda8`（基线 `55358c1`，7 个提交）。
规格：`game-G1-importer.md`、`game-G1-continue.md`、`reviewer-generic.md`、`review-G1-extra.md`。
临时脚本与日志都在 `/var/tmp/fleet/1819/`（`gates.sh`、`mutations.log`、`probe/*.ts`）。

## 结论先行

导入器本身工程质量不错：263 张图 0 schema 错误，两次导入逐字节一致（哈希与报告一致），门禁全绿，
Spyder 开场在 60/30/20 Hz 下复跑通过，S1 §4/§7 的大部分规则照做了。但有四个问题必须修：

1. **覆盖率口径错**：报告里的「S1 T1 45.9% 达标」是个恒真式，和导入结果无关。实际 Native 只有 40.0%。
2. **覆盖率分类不反映真实转换**：`coverage.ts` 是一张按类型写死的静态表，和 `project.ts` 实际做的事对不上，
   「可执行 82.2%」被高估。用户把这份覆盖率报告定为验收指标，所以它必须和实际转换一致。
3. **卡死**：Tuxemon 里没有条件的事件永远不启动，导入器却把它变成无条件的 autorun。
   结果是进 `spyder_cotton_cafe`（Spyder 线 Cotton Town 的咖啡馆）后玩家永久不能动。
4. **传送修正造出死格**：通用夹取把 `leather_town → flower_city (59,0)` 夹到 `(39,0)`。
   这一格四面都走不出去，玩家落地即卡死。

另外规格第 5 条「对 K1/K2 的新构造留好开关」没有交付。

判定：**FAIL**（阻断项见下）。

## 阻断项

### B1 覆盖率 T1 口径是恒真式（专项 1）

- `importer/coverage.ts:204`：`if (entry.tier1) tier1Uses++`，只看**类型**是否在 T1 集合里，不看它被导入成了什么（disposition）。
  随后 `:215`、`:230` 由它算出 `percent` 和 `meetsBaseline`。
  `importer/index.ts:49-50` 再把这个数写成「This import records 45.9%」。
  这个数是源数据的性质，导入器把所有东西都丢掉，它也还是 45.9%。
- **变异 M1**：把 `actionDisposition`/`conditionDisposition` 改成恒返回 `"dropped"`，
  `bun test -t "all maps pass schema"` 仍然 **1 pass 0 fail**（`/var/tmp/fleet/1819/mutations.log`）。
  验收指标完全没被测到。
- 实际数字（`dist/import-report.json`）：动作 Native **5,448 / 13,617 = 40.0%**，低于 S1 的 6,246。
  条件 Native 4,589 / 8,663 = 52.97%，比 S1 的 4,591 少 2 次（两处 `money_is` 的比较值是变量），四舍五入后才是 53.0%。
- **S1 映射表里是 T1、但导入结果不是 Native 的动作**（逐个核对 `findings/scout-S1-mapping.json` 的 19 个 T1 类型）：

  | 动作 | S1 次数 | Native | Degraded | Dropped | 去向 / S1 自己的说明 |
  |---|---:|---:|---:|---:|---|
  | `unlock_controls` | 330 | 0 | 330 | 0 | 空操作；S1：「T1 (T2-8)」，27 个事件解的是别的事件加的锁 |
  | `lock_controls` | 323 | 0 | 323 | 0 | 空操作；S1：21 个事件只锁不解 → T2-8 |
  | `char_stop` | 88 | 0 | 88 | 0 | 空操作；S1：「(none) no-op」 |
  | `char_wander` | 33 | 0 | 33 | 0 | 生成守卫里 → `moveType: random`；频率与边界（5 处）忽略 |
  | `translated_dialog_choice`（>4 项） | 10 | 139/149 | 10 | 0 | 用「Next >」分页；S1：T2-9 |
  | `load_yaml` | 7 | 0 | 7 | 0 | 导入期合并 + 门控变量 |
  | `remove_collision` | 5 | 0 | 5 | 0 | 带 key 的碰撞矩形 → 可开的阻挡事件 |
  | `add_item`（NPC 背包） | 1 | 117/118 | 0 | 1 | S1：NPC 背包丢弃（T3） |
  | `modify_money`（金额来自变量） | 1 | 18/19 | 0 | 1 | S1：T2-16 |
  | **合计** | **798** | | **796** | **2** | |

  这 798 次全都符合 S1 自己对 T1 的定义（「映射到现有词汇，**可能经导入器降级**」），也和 S1 表里的备注一致。
  所以没有 T1 动作被**错误地**降级或丢弃，问题在口径。
  按 S1 的 T1 定义可比的指标是「T1 类型中原生或降级后能执行的次数」= 5,448 + 796 = **6,244 / 13,617 = 45.85%**，比 S1 的 6,246 少 2 次，即上表那两次 S1 也标了不能用 T1 表达的丢弃。
- **要改**：(a) `coverage.ts` 的 T1 占比改成只数 disposition ∈ {native, degraded} 的 T1 类型使用；`meetsBaseline` 用它判定，并加一个会被 M1 打红的测试。
  (b) `G1.md` / `G1-coverage.md` 改正口径：写明 Native 40.0%，「T1 可执行」45.85%（6,244 对 6,246），条件同理（4,589 对 4,591）。
  如果想让 Native 本身达到 45.9%，可以把语义确实等价的子集改记为 Native（例如同一事件里成对的 `lock_controls`/`unlock_controls`，S1 §4.5 说有 301 个事件），但必须按实例判定，不能按类型。

### B2 覆盖率分类是静态表，和实际转换不一致（专项 1 延伸）

`coverage.ts:77-148` 按类型写死分类。`project.ts` 自己的转换日志（`import-report.json` 的 `rows`）说的是另一回事：

| 类型 | 覆盖率报告 | 导入器实际做的（日志 / 代码） |
|---|---|---|
| `char_face`（2,027） | 全部 Degraded | 目标是别的 NPC → 丢弃（532）；朝向某个角色 → 丢弃（167）（`project.ts:498-502`）。约 1/3 是空操作 |
| `char_move`（77） | 全部 Degraded | 目标是别的 NPC → 丢弃 64（`project.ts:507`） |
| `is char_facing`（1,008） | 全部 Degraded | 触发器上的朝向过滤被整个丢掉（`cond:is char_facing(player) T2-dropped 1003`） |
| `set_monster_health/status`（83+83） | Placeholder | 日志记为 `T3-dropped`，是空操作。S1 §7 允许它们在 P1 空操作，但两处标注互相矛盾 |
| 被恒假守卫整个丢掉的事件里的动作 | 照常计为 Native/Degraded | 2,478 个事件实例（物化视图）在 `project.ts:670` 直接 `continue`，一条命令都没生成。<br>例：`translated_dialog` 物化 2,629 次里有 465 次在这类事件中；`set_variable` 1,472 次里 226 次；`add_monster` 1,282 次里 497 次 |

`import-report.json` 的 `rows` 键还被 `k.split(":").slice(0, 2)` 截断（`project.ts:1052`）。
`touch:facing`、`touch:on`、`touch:step` 于是都变成了 `trigger:touch`，同一个键重复出现（`trigger:action T1` 出现 3 行）。

**要改**：覆盖率应该由转换过程本身记账：每条源动作/条件在 `convertActions`/`clauses` 的实际分支里记一次 disposition，
整个事件被丢弃时它的全部动作/条件记为 Dropped，而不是再按类型查一次表。按文件视图还是物化视图要写明。
`rows` 的键不要截断。

### B3 无条件事件被导入成无条件 autorun → `spyder_cotton_cafe` 卡死

- Tuxemon：`tuxemon/event/eventengine.py` 的 `_evaluate_and_queue_event` 里有 `if not all_conditions: return`，
  没有条件（含行为展开的条件）的事件和 init **永远不会启动**。S1 §2 也写了这一条。
- 导入器：`project.ts:741-742` 在 `!live.length` 时直接生成**不带条件**的 autorun/parallel 页，没有区分「源里本来就没有条件」和「条件都被折叠成常量真」。
- 实例：`spyder_cotton_cafe.tmx:244-255` 的 `"Rand facing"`（4 个 `wait` + NPC 转向，没有 `cond*`）变成
  `e013_rand_facing {trigger:"autorun", 无条件, 4×wait}`，跑完立刻重启，**永久占着阻塞 fiber**。
  实测（`probe/cafe.ts`）：从 (8,10) 按 600 帧方向键，**位置不变，599/600 帧有阻塞 fiber**；删掉这个事件后能走到 (5,3)，0/600。
  入口是 `spyder_cotton_town.tmx:166` 的传送，在 Spyder 线的 Cotton Town。
- 全图扫描（`probe/frozen.ts`）：263 张图，从落点进入并驱动 900 帧，只有 3 张图被标出。
  `spyder_cotton_cafe` 是真卡死；`taba_ba_br_2/3` 是很长的正当独白（用 `br2.ts` 核对过台词序列），不是循环。
- 源里共 6 个无条件、无行为的事件（按文件视图：`scoop4`/`spyder_scoop4` "Play Music"、`spyder_cotton_cafe` "Rand facing"、
  `taba_ba_stairwell_2` "set music"（init）、`water_end_of_desert` "Player Spawn"、`witcher_route_7` "Guarding"）。
  其余 5 个因为动作全被丢弃碰巧没有输出，只有 "Rand facing" 出了事。
- **要改（通用规则）**：源事件 `conds` 为空且没有行为时直接丢弃，覆盖率记 Dropped（原因：Tuxemon 不启动）。
  再加一条测试：每张图从落点进入，N 帧内玩家必须能动，也就是 `frozen.ts` 的做法。

### B4 越界传送的「确定性修正」造出死格（专项 2）

- **是通用规则，不是按地图名特判**：`project.ts:536-541` 对所有 `transition_teleport` 按目标图尺寸把 x、y 夹到 `[0, size-1]`，
  `grep` importer 找不到这 3 张图的名字。三处上游数据确实越界：
  `leather_town.tmx:259`、`:267` → `flower_city.tmx,59,0`（目标 40×40）；
  `water_volcano_path.tmx:187` → `water_volcano_village.tmx,20,0`（目标 20×30）。
- **但夹取的结果不可玩**：`flower_city (39,0)` 四个方向 `canStepFrom` 都是 false。
  实测 1,200 帧方向键只到过 1 格（`probe/clampland.ts`），**落地即卡死**。
  `flower_city` 里通往 `leather_town` 的出口在底边 (12..14, 39)（`flower_city.tmx:194,202,226`），右上角显然不是作者的本意。
  `water_volcano_village (19,0)` 能走（到过 10 格），但离对面的回程出口 (0,0) 也很远。
- 「落点在图内」的验收字面上成立，但 P1「传送能走」不成立。
- **要改（仍然通用）**：夹取后如果落点不可走，按确定性 BFS 找最近的可走格。
  更好的做法是优先落在目标图里「传回源图」那个出口旁边的可走格。
  再加一条断言：所有传送落点都可走、且至少能走出一步。

### B5 规格第 5 条「对 K1/K2 的新构造留好开关」没有交付

`grep -n -i "K1\|K2\|option\|flag" importer/*.ts` 找不到任何开关或选项。所有降级都硬编码在 `project.ts` 的各个分支里：
区域展开（`:712`）、朝向过滤丢弃（`:710`）、派生开关（`:752-764`）、NPC 路线（`:498-507`）、`local.*` 不重置。
组件仓合并 K1/K2 后，切换需要改导入器代码，而不是翻开关。
**要改**：一个 `ImportOptions`（例如 `{ areas, facing, condAll, localReset, routes }`，默认全关 = v1），
在上述降级点按开关二选一，用 `bun run import -- --kit=v2` 之类的参数切换。本任务仍然只实现 v1 分支。

## 专项核对

1. **覆盖率口径**：是**口径写错**，不是导入器漏了 T1 规则。逐项列表和数字见 B1，分类失真见 B2。报告和 `coverage.ts` 都要改。
2. **无手改**：传送修正是通用夹取，不是特判（B4）。整个 `importer/` 里只有这几处硬编码：
   - `DEFAULT_MAPS`（`--sample` 用）；
   - 起点 `spyder_bedroom`；
   - `start_tuxemon.yaml` Spyder 分支的 4 个开局选择（`project.ts:994-1003`，`scenario_choice=spyder_campaign` 等）；
   - `PLAYER_NAME = "Red"`（`project.ts:36`）；
   - `.po` 坏行容错是通用的，不认 key。

   开局选择和玩家名相当于「开局菜单的答案」，不算改地图内容，但应该从 `start_tuxemon.yaml`/`mod.yaml` 读或做成参数（非阻断）。
   产物由 `bun run import` 生成，两遍一致，没有手改痕迹。
3. **v1 降级正确性**：抽了 10 个含 Degraded 项的事件，逐个对照 Tuxemon 源码，见下表。
4. **复跑**：`bun run import` 两遍，哈希都是
   - `project.json` `0c58a1ef…2be`
   - `variable-enums.json` `5f301e89…481`
   - `import-report.json` `89102ee1…686`
   - `G1-coverage.md` `4bf6fee7…cb9`

   与 G1.md 报告的一致，工作区保持干净。无头开场由 `bun test` 在 60/30/20 Hz 复跑通过，
   三份 `dist/smoke-spyder-*hz.log` 与 builder 留下的逐字节相同。

### 专项 3：10 个 Degraded 事件的行为差异

| # | 事件（源） | 降级项 | Tuxemon 语义（源码） | 我们的产物 | 行为差异 |
|---|---|---|---|---|---|
| 1 | `spyder_downstairs` "Go Outside" (4,6) | `is char_facing player,down` 被丢 | `char_at` + `char_facing` 都是每帧求值的电平条件（`conditions/char_facing.py`、`char_at.py`）：只有站在出口垫上**且朝下**才出门，站上去再转身朝下也会触发 | `e006_go_outside` `playerTouch`，没有朝向条件 | 从左右两侧踩上出口垫也会出门（S1 §10 缺口①，smoke 为此专门绕开触发格）；站在垫上转身不会触发 |
| 2 | `spyder_paper_town` "First Fight - Start" | `lock_controls` 只锁不解；过场 `create_npc`；`pathfind`×2、`char_face`×2 被丢；NPC 的 `add_monster`、`set_teleport_faint` 被丢 | Billie 在 (13,14) 生成，走到 (25,13)，玩家被拉到她身边，两人面对面，对话，开战；`SinkState` 一直锁到后续事件解锁（`lock_controls.py`） | 设 `local.npc.spyder_billie=1` → Billie 出现在 (13,14) 后不动；文本 + 战斗占位 + 变量照写 | 过场里没人走位、没人转身；两个 autorun 之间玩家有一个参考帧能动（没有跨事件输入锁，T2-8）。剧情变量正确，主线能推进 |
| 3 | `spyder_candy_town` "Entry Candy"（22×1 区域） | 区域展开成 22 个事件；`char_stop`/`lock`/`unlock` 成空操作；`pathfind_to_char` 被丢；`char_face henrik,up` 被丢 | Henrik 在 (21,4) 生成，玩家被拉过去；换图时 NPC 全部清除（`map/transition.py`），所以 Henrik 只活这一次到访 | 22 个 `playerTouch` 格事件，页条件 `v.confiscation_candy != 1`；`local.npc.spyder_candy_henrik=1` | 玩家不走位；Henrik 之后**每次来都还在**（`local.*` 不按到访清零，T2-6）；本图另一处生成守卫把 Henrik 放在 (30,0)（`spyder_candy_town.tmx:527`），我们仍把他画在第一个 `create_npc` 的 (21,4)（T2-7 place） |
| 4 | `spyder_citypark` "Talk Nurse"（talk） | `screen_transition 1` → `wait 2`；治疗成空操作；talk 自带的转向玩家被丢 | 淡出 1 s、再淡入 1 s（`screen_transition.py` 的 `update` 在 2×time 时 stop），然后回满血；NPC 先转向玩家 | `npc_spyder_citypark_nurse` 的动作页：text、`wait 2`、`wait 0.5`、text | 没有黑屏淡入淡出，只是停 2.5 s；护士不转身（物化 554 处 `talk(char_face npc,player)` 丢弃）；回血没意义（P1 没有血量） |
| 5 | `spyder_candy_hospital1` "Choice Floor 2nd"（8 选项密码） | `translated_dialog_choice` 超过 4 项 | 一个菜单列出全部 8 项（`translated_dialog_choice.py`） | 嵌套 `choices`：[Red\|Orange\|Yellow\|Next >] → [Green\|Blue\|Indigo\|Next >] → [Violet\|Black]，枚举码都保留 | 只能往后翻，不能回上一页；多一次按键。S1 说模拟器在这个谜题前卡住，所以这是可达性风险点，但选项都在 |
| 6 | `spyder_flower_city` "Talk Captain - Candy"（5 个目的地） | 5 项分页；多个 talk 守卫同时成立 | 按 INTERACT 的那一帧，所有守卫成立的 talk 事件**同时**启动（`eventengine.py` 逐个 `start_event`） | 匹配标志链：先锁存 3 个 talk 守卫，再**依次**执行；目的地分成 [Paper Town\|Leather Town\|Flower City\|Next >] → [Timber Town\|Candy Port] | `seentimber` 与 `seencandy` 都设了时，我们按作者顺序连续问 2–3 次「Where would you like to go?」，最终 `rivergoto` 取最后一次选择；Tuxemon 在同一帧把这几个 talk 事件都启动，各自推自己的对话状态。两边的先后与交错不同（S1 已记录「顺序执行代替并发」） |
| 7 | `spyder_cotton_artshop` "Make Barmaid" | `char_wander barmaid,0.7` | `WanderBehavior(frequency=0.7)`，可带边界（`char_wander.py`） | 生成守卫 parallel 页 + NPC 页 `moveType: "random"` | Kit 的页没有频率字段（`types.ts:105` 只有 `moveType`），0.7 被忽略；带边界的 5 处（S1）可能走出边界。其余等价 |
| 8 | `spyder_dragonscave` "Remove Drokoro" | `remove_collision drokoro` | `check_collision_zones(collision_map, label)` 找不到 key 为 `drokoro` 的区域 → 什么都不做（`remove_collision.py`） | 写 `local.collision.spyder_dragonscave.drokoro=1`，但图里没有对应的阻挡事件 | **等价**（上游 TMX 没有这个 key，builder 已如实记录）。有 key 的 4 处（如 `spyder_candy_hospital3` "Remove Screen"）变成可开的阻挡事件，也等价 |
| 9 | `spyder_candy_center` "Create Nurse" | `load_yaml spyder_cathedral`（在生成守卫里） | 本次到访把 `spyder_cathedral.yaml` 的事件追加到列表末尾，同名去重（`load_yaml.py`）；换图后消失，下次进图生成守卫再跑一遍 | 导入期合并，门控用全局变量 `v.__loaded_yaml.spyder_candy_center.spyder_cathedral` | 门控变量跨到访保留，而 Tuxemon 每次到访都会重新加载，**实际等价**；追加顺序也一致 |
| 10 | `taba_house1` "Husband Talk / Feb12 / Sep30" | `time_is date,equals,…` 固定答案 | 按真实日期选台词（`conditions/time_is.py`） | `is time_is date…` → 常量假 → Feb12/Sep30 两个版本整个丢弃；`not …` → 真 → 默认版本始终可用 | 2 月 12 日、9 月 30 日的特别台词永远看不到；`stage_of_day` 固定为白天，夜间版本同理丢弃。P1 可接受 |

结论：这 10 个里 #8、#9 等价；#1、#2、#3、#4、#6 有 S1 已记录、需要 T2 才能消除的可见差异（朝向、过场走位、跨事件锁、`local.*` 到访重置、生成位置、转向玩家）；
#5、#7、#10 是展示层或时钟上的差异。builder 的降级**方向正确**，但 B2 说明报告把其中一部分真正的丢弃算成了 Degraded。
另外在「无条件事件」这一类上发现了真实的语义错误（B3）。

## 逐条对照规格（`game-G1-importer.md`）

| 条目 | 判定 | 证据 |
|---|---|---|
| 1 读全部 TMX + 同名 YAML + 剧本 YAML + `load_yaml`，按守卫形状选触发 | 成立（有 B3 例外） | `source.ts:183-228` 按 TMX → `<map>.yaml` → scenario → loaded（去重）的顺序合并；`shapes.ts` 的 `triggerClass` 照抄 S1；按文件视图分类：touch:facing 933 / guard 905 / talk 787 / spawn 732 / touch:step 454 / touch:on 349 / action:facingTile 338 / action:standingOn 75 / 其他 5，与 S1 §4.1 一致 |
| 2 变量枚举表：全局、稳定排序、生成文件 | 成立 | `project.ts:71-135` 值集合排序，码 = 1 基序号；`dist/variable-enums.json` 493 个键（486 个源变量 + 7 个 `load_yaml` 门控），19 个空取值表保留（测试 `importer.test.ts:25-26`） |
| 3 动态 NPC / 传送折叠 / 文本 `.po` 分页；en_US 先行、结构留多语言 | 部分 | NPC（`:661-686`、`:790-825`）、传送折叠（`:517-547`）、分页（`:336-345`）都照 S1 做了。多语言：`project.ts:42` 把 en_US 路径写死，产物里不保留 msgid，没有 locale 参数（非阻断，建议加 `--locale`） |
| 4 P1 战斗占位严格按 S1 §7 | 成立 | `project.ts:384-396` 与 S1 §7 的伪代码逐行一致（`party_size>=1` 守卫、`bo`/`defeated`/`boc`、`battle_last_*` 三个变量）；`random_encounter` 不做事（`:606-608`）；玩家 `add_monster`/`random_monster` → `sys.party_size+1` + `mon.<slug>`；NPC 队伍丢弃；`party_infected none` 为真；`char_defeated player` 为假 |
| 5 v1 降级版（17 op）+ K1/K2 开关 | 部分 / 不成立 | v1 版本成立（schema 0 错）；开关不存在（B5） |
| 6 覆盖率报告（json + md，四类计数，与 S1 对照） | 部分 | 文件和四类计数都有，但 T1 对照是恒真式（B1），分类不反映实际转换（B2） |
| 7 地形占位 + 给 G5 留接口（id、宽高、碰撞层、上下层分界） | 部分 | 占位成立（`:862-883`：单格可走图块 + 碰撞矩形，带 key 的矩形改为事件）；上/下层分界规则没有任何接口（非阻断，G5 自己读 TMX） |
| 验收：263 张图 schema 0 错；传送目标存在且落在图内 | 成立（字面） | 复跑 `Imported 263 map(s); schema errors: 0`；测试遍历全部 `transfer`；但有一个落点是死格（B4） |
| 验收：字节稳定（有测试） | 成立 | 复跑两遍哈希一致；`importer.test.ts:73-78` 在同一进程里构建两次比较 |
| 验收：Spyder 开场 60/30/20 Hz 通过、节拍一致 | 成立（有保留） | `bun test` 3 pass。保留：① 最后一拍接受「请求了传送但失败」（M4：删掉 `spyder_route1` 后 smoke 仍然 PASS），应改成必须 `st.mapId === "spyder_route1"`（S1 原型只有 4 张图时的遗留）；② 比较节拍时过滤掉了 `CHOICE` 行，60 Hz 日志里第二个「CHOICE [Yes \| No]」在 20/30 Hz 中缺失（日志按弹窗 key 去重造成的，`PICK` 行一致），所以 G1.md 说的「text/choice…序列完全一致」不准确 |
| 验收：覆盖率 T1 占比不低于 S1（45.9% / 53.0%） | **不成立（口径）** | B1：Native 40.0%；T1 可执行 45.85%（6,244 对 6,246）；条件 52.97%（4,589 对 4,591） |
| 验收：`tsc` 0、`bun test` 全绿 | 成立 | 见下 |
| 续做规格：分步提交；不提交 `vendor` | 成立 | 7 个提交，顺序与续做规格一致，作者 `lfkdsk`，没有 AI 尾注；`git diff 55358c1..HEAD -- vendor` 为 0 行 |

## 门禁复跑

```text
$ bunx tsc --noEmit                      → exit 0（2.3 s）
$ bun run import   ×2                   → Imported 263 map(s); schema errors: 0（每次约 1.65 s），两遍 4 个产物哈希一致
$ bun test tests/                        → 3 pass, 0 fail, 28226 expect() calls（5.8 s）
```

（`/var/tmp/fleet/1819/{tsc,import1,import2,test}.log`、`hashes-run{1,2}.txt`）

## 变异检查（改完都已还原；还原后重新导入，哈希复核一致）

| # | 改坏的地方 | 预期 | 结果 |
|---|---|---|---|
| M1 | `coverage.ts` 两个 disposition 函数恒返回 `"dropped"` | 覆盖率测试应该变红 | **仍然绿**（1 pass）→ 验收指标没被测到（B1） |
| M2 | `project.ts` 去掉传送夹取 | 测试变红 | 红：`all maps pass schema and reference valid transfer destinations` 失败 |
| M3 | `battle()` 不写 `bo.<opp>.won` | smoke 变红 | 红：`smoke: the first fight ran the battle placeholder` |
| M4 | 从 `dist/project.json` 删掉 `spyder_route1` 后直接跑 smoke | smoke 应该变红 | **仍然 PASS**（exit 0，「(Error: transfer: unknown map spyder_route1)」）→ 最后一拍的断言太松 |

## 性能（QuickJS）

G1 规格没有要求运行时性能数字，导入器是构建期的 Bun 脚本（约 1.65 s）。有两个运行时风险，记下来留给加载这份产物的任务：

- 产物是**一个 17 MB 的 JSON**（`dist/project.json` 17,077,622 字节），在 QuickJS/PSP 上一次性解析的耗时和内存没量过。
- `test_npcs/e001_npcs` 的守卫有 500 个子句，展开成 **499 层嵌套 `if`，JSON 嵌套深度 1004**（`probe/depth.ts`）。
  Python `json.dump` 在它上面已经触发 `RecursionError`。QuickJS 的递归 `JSON.parse` 或 Kit 解释器递归执行都可能碰到栈上限。
  建议 T2-2 `condition.all` 到位前把超长 AND 链拆平（例如用派生开关逐项累积），或者对测试图跳过。

我没能在本机跑 QuickJS：找到的唯一 `qjs` 在 `/tmp/qjs-build/qjs`，对我没有执行权限。这是没做到的部分，不是结论。

## 画面

G1 没有渲染产物：地形是占位图块，`sheets[0].pak = "placeholder"`，也没有生成 PNG，所以没有可以肉眼核对的画面。真实地形由 G5 负责。

## 原则

- **全自动导入**：成立。没有逐图特判（见专项 2），产物由 `bun run import` 生成，两遍一致。
- **没有往组件仓写 Tuxemon 专用代码**：成立。`vendor/pocket-rpgkit` 仍是 `5dd48ef`，工作区干净，diff 0 行。
- **没有改 `vendor/pocketjs`**：成立。仍是 `76ae741f`，工作区干净。

## 非阻断问题（建议一并修）

1. `import-report.json` 的 `rows` 键被截断（`project.ts:1052`），触发子类合并后同一个键出现多次（B2 已提）。
2. 宽高为 0 的 TMX 事件：Tuxemon 永远不会命中（`boundary.py` `MapConditionBoundary.is_within`，`tile_pos` 是整数）。
   导入器用 `Math.max(1, e.w)` 把它展开成 1 格（`project.ts:700-701`）。全库只有 1 处：`tt_paper_town` "Teleport to Sea Route"，不在主线上。
3. 开局选择和玩家名写死（专项 2），应该从 `start_tuxemon.yaml`/`mod.yaml` 读或做成参数。
4. 多语言没有 locale 参数（规格第 3 条）；G5 接口没有上/下层分界（规格第 7 条）。
5. `shapes.ts` 的文件头注释还写着「findings/scout-S1/shapes.ts … not product code」。

## 复现

```sh
/var/tmp/fleet/1819/gates.sh                       # tsc、import ×2（记录哈希）、bun test
cd /var/tmp/fleet/1819/probe                       # importer/ 的插桩副本 + vendor 软链接
bun analyze1.ts     # 每种类型的实际去向（含恒假守卫整事件丢弃）、按文件视图的触发形状、无条件事件
bun cafe.ts         # spyder_cotton_cafe 卡死对照
bun frozen.ts       # 263 张图的落点进入扫描
bun clampland.ts    # 夹取后落点能不能走
bun dump.ts <map> "<event name>"   # 源事件与导入产物对照
bun depth.ts        # 嵌套深度
```

FAIL
