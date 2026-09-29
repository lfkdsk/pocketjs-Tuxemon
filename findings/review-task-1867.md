# 审查 GB1（task 1867）

被审分支基线 G6 `3111ac9`，规格 `game-GB1-battle-data.md` + `review-GB1-extra.md`，依据 Scout S4 `~/.fleet/worktrees/task-1865/findings/scout-S4-battle.md`。本审查复跑了全部门禁，并派了 3 个只读子代理分别核对（1）主线训练师战逐场对照上游、Spyder 子集是否真自动导入，（2）字段是否够 GB2 用、与 GB2 自带数据是否冲突，（3）战斗美术格式/体量。三份子报告的结论已逐条用 `fleet_claim` 记录证据；本文汇总裁决。

## 1. 逐条对照规格

### 1.1 `game-GB1-battle-data.md`「要做的」

| 条目 | 结论 | 证据 |
|---|---|---|
| 导入战斗数据 → 精简 battle-db.json，Spyder 子集默认，`full` 开关切全库 | 成立 | `bun run import` 输出 `battle spyder: 214 monsters, 228 techniques, 511 textures, 24491344 battle-only pak bytes`；`BATTLE_DB_SCOPE=full` 输出 `411 monsters, 274 techniques, 799 textures, 36484608 bytes`，两组数字均与 `findings/GB1.md` 完全一致（本审查独立复跑） |
| 字段含义与 S4 §2 对齐 | 基本成立，1 处缺口 | 见 §2 |
| 战斗美术进 pak，pow2 ≤ 512，字节稳定 | 成立 | schema 校验强制 `isPow2` 且 `≤512`（`importer/battle-schema.ts:367-368`）；两次 `bun run import` 后 `git status --short` 均为空 |
| schema/校验 + 关系测试（队伍引用怪物/技能存在、遭遇权重合法、美术引用在 pak 里） | 成立 | 见 §4 变异测试 |

### 1.2 验收

| 验收项 | 结论 | 证据 |
|---|---|---|
| `bun run import` 两遍无 diff | 成立 | 本审查独立跑两遍，`git status --short` 均为空 |
| 新测试全绿 | 成立 | `bun test tests/`：`43 pass 1 skip 0 fail 44258 expect() calls`，与 builder 自述完全一致（1 skip 是既有 G6 built-bundle golden，非本任务新增） |
| `bunx tsc --noEmit` 0 | 成立 | 本审查独立跑，exit 0，无输出 |
| `bun.lock` 不改 | 成立 | `git diff --name-only 3111ac9..HEAD -- bun.lock vendor` 无输出 |
| 报告字节数/覆盖率/对 S4 逐项对照 | 成立 | `findings/GB1.md` 有完整对照表；且报告主动指出并修正了 S4 自身的两处笔误（见 §1.3） |
| 每步提交、不 push | 成立 | 5 个本地提交（`0c03ac8`→`96f3488`），逐步可测；未 push（远端无对应分支） |

### 1.3 额外核对第 1 条：全自动导入、无白名单

**成立。** 子代理逐行读了 `importer/battle.ts` 的 `buildSelection`：Spyder 范围来自地图自身的 TMX 属性 `scenario=spyder`（`importer/battle.ts:295`），本审查独立验证了 206 个上游 `.tmx` 带 `<property name="scenario" value="spyder"/>`（`spyder_paper_town.tmx` 等），不是硬编码地图名单；`spyder_test_map` 按 slug 显式排除。训练师队伍靠"同一事件里紧挨在 `start_battle`/`start_double_battle` 前面的 `add_monster`"这一通用规则折叠（`actionsForOpponent`，找不到同事件就退到同图其它事件），变量怪名（`billie_choice` 等）靠全局扫 `set_variable`/`choice_monster`/`set_random_variable` 解析，不是逐个训练师写死。

子代理另外独立复现了 19 场主线战（覆盖首战 Billie、`billie_choice` 多次复现、3 次双打 `spyder_route5`）逐项核对种族/等级/经验倍率/金钱倍率/双打配对，19/19 与上游 TMX 一致。

对 S4 两处更正：
- **怪位 601→611**：独立加总 S4 自己的 `spyder_subset.json`（285 条战斗记录）得到 615 个怪位，减去仅存在于 `spyder_test_map` 的 2 条记录（4 个怪位）= 611，与 GB1 一致；S4 正文的 601 确系少算。
- **Cleo 队伍 213 vs 214**：S4 第 214 个"不同队伍"记录只存在于 `spyder_test_map`（`memnomnom L5 ×2`），真实 `spyder_route5.tmx` 三处双打均为 `memnomnom L25 ×2`；GB1 排除测试图后得到的 213 是对的。

**唯一瑕疵（不阻断）**：`billie_choice` 的候选物种列表是对全剧本做一次性全局并集（10 个物种：5 只初形 + 5 只进化形），而不是按每场战斗在剧情中的可达进度收窄——玩家在等级 5 的首战不可能遇到进化形。数据没有错误/缺失，只是候选集合偏宽，建议 GB2/GB4 消费时注意这一点或后续用剧情进度收紧。

## 2. 字段与规则对齐（额外核对第 2 条）

**基本够用**，子代理逐项核对了 S4 §2 提到的能力值来源、六维 stage 表（`rules.statStages`，一开始怀疧会缺，实际在 `importer/battle.ts:966-967`/`battle-schema.ts:73` 完整存在）、技能排序/命中/伤害的 `range_map`（与上游 `range_map.yaml` 逐字节一致）、效果/条件插件参数（原样透传，未做有损解析）、状态转移规则、捕获公式常数、经验倍率、13×13 属性相克表（169 对，28×2/107×1/34×0.5 与 S4 完全一致），均在 `data/battle-db.json` 中确认存在且取值正确。

**发现 1 处具体缺口**：`statModifiers` 是对上游 YAML `stat_modifiers` 字典的**原样透传**（`importer/battle.ts:833/854/882`），没有补 Tuxemon `StatModel`（`tuxemon/db.py:1439-1467`）的隐式默认值（`scaling_mode`、`max_step_limit`、`overridetofull`、`max_deviation`、`step`）。举例 `statuses.blinded.statModifiers.speed` 在生成产物里只有 `{value:0.5, operation:"*"}`，缺 `scaling_mode` 等字段——GB2 若照抄这个 JSON 会读到 `undefined` 而不是上游引擎实际用的默认值，必须自己再硬编码一份默认值表，产生第二个真相源、有漂移风险。**建议**：仿照 `importer/battle.ts:48-60` 已有的 `ITEM_BEHAVIOR_DEFAULTS`/`CAPTURE_DEVICE_DEFAULTS` 套路，给 `statModifiers` 也加一个 `STAT_MODIFIER_DEFAULTS` 合并再写出。不阻断本次验收，但建议在下一次小提交里补上。

**GB2 冲突：确认存在，需要人工拍板合并策略。** GB2（task 1866，并行开发）已经有一份独立的、Python/pydantic 直接从 Tuxemon `db.database[table][slug].model_dump_json()` 导出的 `battle/data/tuxemon-battle.json`（802,725 字节，`element/element_order/monster/shape/status/taste/technique/technique_speed`），被 GB2 的 `battle/tuxemon.ts`/`createBattle()` 直接当生产输入消费，字段命名与 GB1 不同形状（如 `learning_method` vs `method`、`level_learned` vs `level`、`DbRule{name,parameters,type}` vs GB1 的 `BattlePlugin{type,parameters,operator}`），而且 GB2 那份数据反而**已经**带了 GB1 缺的 `StatModel` 默认值。反过来，GB1 有而 GB2 完全没有的：npcs/encounters/trainerParties/items/capture/美术资源引用。**合并建议**：不是简单去重，而是——(a) GB1 的 `statModifiers` 缺口先补上（同 GB2 的默认值口径对齐），(b) 让 GB2 的规则引擎改吃 GB1 的 `battle-db.json`（需要一层字段名适配层），只保留 GB2 的 Python 导出管线作为"与 Tuxemon 逐位对照的独立 oracle"用途（差分测试裁判），不再作为生产数据源；npc/遭遇/训练师队伍/道具/美术这些 GB1 独有的表，GB2 无论如何都得从 GB1 拿。这个决定超出 GB1 本身的整改范围，建议 commander 另开一个衔接任务。

## 3. 美术格式与体量（额外核对第 3 条，重点）

- **(a) 4444 量化确有可见损失，但幅度不大**：抽样 4 张真实战斗纹理（怪物前/后图 2 张、战斗背景 2 张），8888→4444→8888 往返后平均每通道误差 0.74–5.28/255，多达 94.5% 像素在某通道上有 >4/255 的偏差，主要集中在抗锯齿边缘（8× 放大差异图已存 `/var/tmp/fleet/1867-review-scratch/`）。上游是低色数像素画（怪物图 23–91 种 RGBA），条带感存在但不算严重。**GB1.md 完全没提这项风险**，是报告的一个疏漏（不是产物错误）。
- **(b) CLUT8+RLE 确实能省，但不是配置项，是架构缺口**：对全部 511 张真实纹理字节做 CLUT8 模拟——498 张（怪物/图标/HUD/球/训练师/站台图）都在 256 色以内，纯索引流 + PackBits 只要现有 4444 体积的 6.3%（含 TILESET 容器开销 8.6%）；13 张战斗背景（4/8 张 Spyder 在用的环境背景，如 `sand_background.png` 13,339 色）超过 256 色。混合方案（498 张转 CLUT8+RLE、13 张背景维持 4444）预计 **5,825,507 字节**，是当前 24,491,344 字节 battle-only pak 的 **4.2 分之一**，且不产生新的画质损失。但组件仓的 pak 编译器 `encodeImageEntry`（通用 `ui:img.*` 入口）**根本没有 `PSM_T8` 分支**——CLUT8+RLE 只存在于地形用的 `TILESET` 流式容器里，要给战斗美术用等于要把它接到 `loadTileTexture` 那套按视口加载的机制上，这是和 S2（地形渲染架构 scout）同量级的框架工作，不是本任务能顺手做的。
- **(c) 平台影响——PSP 按现状是硬性装不下，报告未提及**：PSP 宿主 `include_bytes!` 把整个 `.pak` 原样塞进 `.rodata`，没有任何流式/压缩（`hosts/psp/src/pak.rs`、`build.rs:218-246`）；本审查自己跑 `bun run build` 产出真实 `dist/main.pak`（2,891 entries、50,757,856 字节），其中地形 `ui:tile.*` 21,544,996 字节（S2 已经判定这块对 32 MB 设备很吃紧）、战斗 `ui:img.*` 23,414,264 字节——两块加起来远超 32 MB。网页端没问题：battle 字节区间 gzip -9 后只剩 670,836 字节（2.87%），下载体积不是瓶颈，瓶颈是常驻内存/显存。桌面端不受影响。

**建议**：格式改 CLUT8+RLE（13 张高色背景维持 4444/8888 或专门降色），预计 Spyder battle-only pak ≈ 5.8 MB（不降背景色）或 ≈ 3.0 MB（背景也降色，但有画质代价）。这件事应该拆一个独立后续任务（类似当年 S2 之于地形渲染），因为需要动组件仓的 pak 编译器与战斗渲染的加载路径，超出 GB1"导入器产出精简数据+进 pak"这一任务范围。**不作为本次 GB1 验收的阻断项**（GB1 的写死任务书里只要求"给出字节数"，没有要求已经落地 PSP 可用的格式），但报告应当明确写出这个风险——目前 `findings/GB1.md` 完全没提 PSP/内存，是本审查认为最值得纠正的报告缺口。

## 4. 确定性与测试（额外核对第 4 条）

- `bun run import` 独立复跑两遍：两次输出数字相同，`git status --short` 均为空。
- `bun run verify:g6:determinism`：本审查独立复跑，`sha256=a5311215fdee257dd2c37ce113a4d5b14e09ab205e7a5c6eff8e564585d87b18`，与 `findings/GB1.md` 报告的哈希完全一致。
- **schema 校验变异测试**（本审查直接对 `validateBattleDb` 跑，非 builder 自述）：
  1. 删除被 `dinoflop` 引用的技能 `ram` → 抛 `monster dinoflop references missing technique ram`。
  2. 把 `encounters.spyder_route1.monsters[0].weight` 改成 0 → 抛 `encounter spyder_route1 has non-positive weight`。
  3. 传一个不含真实美术 key 的 `pakKeys` 集合（模拟删掉一个 pak key）→ 抛 `art ui:img.....is absent from pak manifest`。
  三项全部正确变红。
- **像素断言不是自证**：`tests/battle-import.test.ts` 里用来做语义像素比对的 `assets/battle/gfx/sprites/battle/rockitten-sheet.png`、`assets/battle/gfx/ui/combat/grass_background.png` 是导入器从上游复制来的中间产物（不是最终 pak 里的 4444 纹理，也不是测试自己生成的东西）。本审查独立解码这两张图与 `/var/tmp/tuxemon-src` 里的原始 PNG 逐像素比对：可见区域内 0 处偏差，唯一区别是画布被透明填充到最近的 2 次幂（128×88→128×128、256×108→256×128）。因此这些像素断言确实是在对照独立于导入器输出的上游真值，不是产物对产物的自证。

## 5. 任务纪律（额外核对第 5 条）

- 提交主题、`importer/`、`ui/`、`tools/` 新增代码中未见任何 fleet 任务号；测试文件与工具脚本里出现的 `/var/tmp/fleet/1867` 是硬规矩明确要求的临时文件目录约定（"临时文件放 `/var/tmp/fleet/<task>`"），不是违规。`findings/GB1.md` 报告正文提到"Fleet task 1867"属于报告自身的任务归属声明，与 G1/G6 等既有报告的写法一致。
- `git diff --name-only 3111ac9..HEAD -- bun.lock vendor` 无输出，`bun.lock`/`vendor/` 均未改动。

## 阻断项

无。

## 后续建议（不阻断，供 commander 派后续任务参考）

1. 补 `statModifiers` 的 `StatModel` 隐式默认值（小改动，建议下一提交顺手做）。
2. `findings/GB1.md` 应补一段 PSP/内存风险说明（目前完全缺失）。
3. 另开一个"战斗美术 CLUT8/T8 流式化"任务，量级与 S2 相当（改组件仓 pak 编译器 + 加载路径），预计把 Spyder battle-only pak 从 24.5 MB 压到约 5.8 MB。
4. GB1 与 GB2（task 1866）各自独立产出了一份 Tuxemon 战斗规则数据（monster/technique/status/element/shape/taste），字段形状不兼容；需要 commander 拍板：GB2 的规则引擎改吃 GB1 的 `battle-db.json`（需要一层字段适配），GB2 现有的 Python 导出管线降级为差分测试用的 oracle，不再是生产数据源。
5. （极小）`billie_choice` 等变量怪的候选物种集合是全剧本并集，未按战斗发生的剧情进度收紧；首战候选集里混入了尚不可能遇到的进化形，建议 GB4 事件接线或后续小修时注意。

PASS
