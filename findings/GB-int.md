# GB-int：战斗规则改读 GB1 battle-db

Fleet task 1881，游戏仓分支基于 GB2（`fleet/task-1866`，HEAD `f2cf162`）。目标：让 GB2 的战斗 reducer 停止吃 Python oracle 导出的开发夹具，改吃 GB1 生成的 `data/battle-db.json`（唯一生产数据源），中间经一层纯函数适配层。本任务在游戏仓内完成；没有修改 `vendor/pocketjs`、没有 push，也没有改动 `bun.lock`。

## 结论

`data/battle-db.json`（GB1，`bun run import` 自动生成）现在是战斗规则唯一的生产数据源。`battle/from-battle-db.ts` 提供纯函数 `battleDbToTuxemonBattleDb(db: BattleDb): TuxemonBattleDb`，把它转成 GB2 reducer 的输入形状。同一套 8,560 场 Spyder 差分语料在**适配后的 GB1 数据**上跑出 `{"cases":8560,"identical":8560,"different":0}`——和 GB2 原先直接吃 oracle 夹具时完全一致。`battle/data/tuxemon-battle.json`（oracle 导出）已移到 `tools/battle-oracle/tuxemon-battle.json`，退出生产路径，只作为差分诊断/QuickJS 基准的开发夹具保留。

## 1. 合并 GB1

`git merge fleet/task-1867`（GB1，已过审 PASS）到 GB2 分支，自动合并无冲突（提交 `f3f096b`）。合并后 `bun run import` 需要先补三步环境准备（子模块未初始化、镜像 404、wasm 产物缺失，均沿用既有 worktree recipe），随后：

- `bun run import` 两遍字节一致。
- `bunx tsc --noEmit` exit 0。
- `bun test`：52 pass（含 built-bundle golden replay，非跳过）。

## 2. 补三处数据缺口（提交 `7274fff`）

按 `findings/GB2.md`「Switching to the GB1 battle database」一节列出的三处缺口：

1. **`elementOrder`**：GB1 原先没有导出上游 `db.database["element"]` 的插入顺序（文件名字母序 ≠ Python dict 插入序，会让 `switch`/`switch_type` 的随机选元素结果偏离 RNG 流预期）。核对 oracle 导出的 `element_order` 字段，固定为 `frost, heroic, normal, wood, sky, earth, shadow, venom, water, lightning, metal, cosmic, fire`；`importer/battle.ts` 新增 `ELEMENT_ORDER` 常量并在导入时断言它与 `elements` 表是同一个集合的排列（表结构变了会硬失败，不会静默过期）。`importer/battle-schema.ts` 新增 `BattleDb.elementOrder: string[]` 字段与对应校验。
2. **状态 `modifiers`**：GB1 原先没有导出 `status.modifiers`（火免疫灼烧、冰系加倍灼烧、毒属性免疫中毒等类型免疫/加成表）。新增 `BattleStatusModifier` 类型与 `statusModifiers()` 导入辅助，写入每个 `statuses[slug].modifiers`；上游只有 `burn`/`poison` 两个状态定义了非空 `modifiers`（分别是 fire immunity/fire extra damage、poison immunity），其余 33 个状态显式声明 `modifiers: []`。
3. **`statModifiers` 默认值**：GB1 原先直接透传 YAML 里的压缩形（只有 `step` 或 `value`/`operation`），缺 `max_deviation`、`overridetofull`、`max_step_limit`、`scaling_mode` 等上游 `StatModel`（`tuxemon/db.py:1440-1468`）字段的默认值。新增 `BattleStatModifier` 类型、`STAT_MODIFIER_DEFAULTS` 常量（仿 `ITEM_BEHAVIOR_DEFAULTS` 写法：`value:0, step:null, max_deviation:0, operation:"+", overridetofull:false, max_step_limit:6, scaling_mode:"nonlinear"`）与 `expandStatModifiers()`，用于 techniques/items/statuses 三处。`battle-schema.ts` 新增 `validateStatModifiers()` 校验每个字段的类型/范围。

`bun run import` 两遍字节一致；`bun test` 全绿。

## 3. 适配层 `battle/from-battle-db.ts`（提交 `1ff89d4`，另见 §4 的两处前置修复）

纯函数 `battleDbToTuxemonBattleDb(db: BattleDb): TuxemonBattleDb`，只转换 reducer 实际读取的七张表（`monster`、`technique`、`technique_speed`、`element`、`element_order`、`taste`、`shape`、`status`——不含 `item`/`npcs`/`encounters`/`trainerParties`/`environments`/`ui`，这些是 GB2 reducer 明确不读的字段，`item` 动作在 reducer 里直接 `throw "reserved for GB3"`）：

- 字段名转换：`healingPower→healing_power`、`method→learning_method`、`level→level_learned`、`positiveTransition→on_positive_status` 等驼峰/下划线映射；`BattlePlugin{type,parameters?,operator?}` → `DbRule{type,parameters:string[],operator?}`（`parameters` 从可选 `unknown[]` 收窄为必需 `string[]`）。
- `technique_speed` 由 `rules.actionOrder.speedTiers[technique.speed]` 逐条推出（不是查表复制）。
- 元素相克表从 GB1 的 `{against: multiplier}` map 转回 oracle 形状的 `{against, multiplier}[]` 数组（顺序按 `against` 排序；reducer 用 `.find()` 查找，顺序对结果无影响）。
- `taste.modifiers` 从 GB1 压缩的单条 `{stat, multiplier}` 包回数组形状 `[{values:[stat], multiplier}]`；核对上游全部 12 个口味都恰好只有一条 modifier，这个"只取第一条"的假设在当前钉住的源码版本下不丢数据（见 `tests/battle-db-adapter.test.ts` 的显式断言）。
- **怪物 moveset 命名陷阱**：GB1 的 `monster.moveset` 和 `TuxemonBattleDb.monster[slug].moveset` 其实都是"升级学习表"（不是"当前已学招式"平铺列表），字段形状同构，适配层只做改名，不做等级筛选——真正的等级筛选（`learnedMoves()`，`battle/stats.ts:180-187`）留给"把 `trainerParties` 变成战斗用 `MonsterSnapshot`"这一步（尚未有消费者，属于后续 P2 世界联动任务），本文件的顶部注释记录了这个区分，避免未来实现者踩上审查（`review-task-1866.md` §6）已经指出的那个坑。

## 4. `scope` 效果与两处技能完整性缺口（提交 `1b3f275`、`ea4a205`）

在把适配后的 GB1 数据接进 8,560 场差分比对器时发现三个此前不可见的问题（GB1 自己的内部一致性校验和 GB2 直接吃 oracle 夹具都不会触发它们）：

1. **`scope` 效果未实现**：`review-task-1866.md` §6 已指出 GB1 有 GB2 不支持的第 19 种效果 `scope`。核对：Spyder 库里唯一使用它的技能就叫 `scope`（怪物无一学习，只能通过道具 `tm_scope` 的 `learn_tm` 效果习得，属于真实可达内容）。上游 `ScopeEffect`（`tuxemon/core/effects/scope.py`）只格式化一条战斗内文本、不掷命中、不改状态。按此在 `battle/tuxemon.ts` 加了对应 `case "scope"`（`result.success = true`，不调用 `setHit`，命中位保持之前的值），并在 `tests/battle-effects.test.ts` 加了定向测试断言无状态变化。
2. **合成技能 `empty` 缺失**：`confused`/`flinching`/`noddingoff`/`wild` 四个状态的 `on_tech_use` 都指向技能 `empty`（GB2 reducer 在这些状态生效时把它当替代招式执行），但没有任何怪物的 moveset 会"学会" `empty`，GB1 原先按 moveset 可达性选技能的启发式因此永远选不到它。修了 `importer/battle.ts` 的 `buildSelection()`：无条件扫描全部（不分 scope）状态的 `on_tech_use`/`on_item_use`，只要该值命中 `technique` 表（不是 `status` 表——`chargedup`/`charging`/`exhausted` 三个状态的这两个字段其实指向别的**状态**，不是技能，reducer 里对应走 `applyStatus()` 不是 `db.technique[...]`，两者用同一字段名但语义不同，已用上游 `StatModel.on_tech_use` 校验器"`status` 或 `technique` 二选一"的定义核实），就无条件收进 `techniques`。
3. **`disappear` 效果的后续技能缺失**：`altitude`（`disappear` 效果，parameters 是 `hawk`）在 Spyder 差分语料的 143/8,560 场里被使用，但 `hawk` 技能本身没有任何怪物学习，只作为 `disappear` 的"下一回合落地技能"参数存在，GB1 原选择逻辑同样漏了它。修了同一函数：对已选技能做不动点扫描，把每条 `disappear` 效果的 `parameters[0]` 技能也收进来（Spyder 库里另外三条 `disappear` 技能——`burrow_blast`/`oven`/`rift_dash`——的落地技能已经可达，只有 `altitude→hawk` 需要这条修复）。

修复前：GB1 Spyder 库 228 个技能，适配后跑 8,560 场差分语料，143 场因 `hawk` 缺失直接崩溃（`sortKey` 里 `db.technique[undefined]`）。修复后：230 个技能（`empty`、`hawk`），`bun run import` 两遍字节一致；`bun test`（含更新后的 `techniques: 230` 断言）全绿。

## 5. 切换（提交 `2cbede4`、`b56f425`）

- `tools/battle-oracle/bench-entry.ts` 改成从 `data/battle-db.json` 经适配层构造 reducer 输入（原先直接 `import` oracle json）。
- `battle/data/tuxemon-battle.json` 移到 `tools/battle-oracle/tuxemon-battle.json`，`tools/battle-oracle/README.md`、`tests/battle-golden.test.ts`、`tests/battle-effects.test.ts`、`tests/battle-db-adapter.test.ts` 同步改引用路径；`tests/battle-golden.test.ts` 顶部加注释说明它现在是"oracle 夹具差分诊断"，生产路径的等价测试在 `tests/battle-db-adapter.test.ts`。
- 新增 `tests/battle-db-adapter.test.ts`（提交 `1ff89d4`），两部分：
  - 用同一套 `compareGoldenCase`/8,560 场语料在**适配后的 GB1 数据**上重放，`{cases:8560, identical:8560, different:0}`。
  - 字段级等价断言：`element`/`shape`/`taste`/`status` 是完整表（两边键集合相同，逐字段相等，taste/status 的 modifiers 剥掉 oracle 多出的解析器噪声字段 `name`/`condition_name`/`priority`/`stacking`/`source`/`turns_remaining`/`max_stacks`/`can_be_forgotten` 后比较）；`monster`/`technique` 是 GB1 Spyder 的子集（oracle 无 scope 过滤，411 怪物/274 技能 vs GB1 的 214/230），逐 slug 断言 `shape`/`types`/rule-used 字段相等，`monster.moveset` 断言是 oracle moveset 的子集（scope 过滤是预期行为，不是缺陷）。

## 6. 补齐（提交 `cb21968`、本报告提交）

- **QuickJS 基准**：新增 `tools/battle-quickjs-bench.rs` + `tools/bench-battle-quickjs.sh`（仿 `tools/g6-quickjs-bench.rs` / `tools/bench-g6-quickjs.sh` 的裸 `pocket_mod::Guest` + 独立 `Cargo` scratch 拷贝写法，而不是 G6 那套整机 `Runtime::boot`——`review-task-1866.md` §5 确认过 GB2 基准本来就是"打包成 IIFE 后在裸 Guest 里 eval"这个更轻量的模式）。脚本自动 `bun build` 出 `battle-bench.js`（内容即 §5 提到的、已切到 GB1+适配层的 `bench-entry.ts`），跑在真实 QuickJS 里三次：

  | 指标 | Run 1 | Run 2 | Run 3 |
  | --- | ---: | ---: | ---: |
  | Round mean | 0.609 ms | 0.608 ms | 0.632 ms |
  | Round p95 | 0.852 ms | 0.848 ms | 0.869 ms |
  | Round max | 1.244 ms | 1.649 ms | 1.798 ms |
  | Rounds over 1 ms / 2,750 | 4 | 14 | 14 |
  | Complete-battle mean | 6.806 ms | 6.788 ms | 7.060 ms |

  和 `findings/GB2.md` 报告的原始数字（round mean 0.598–0.636 ms、p95 0.839–0.867 ms）基本落在同一区间，切换数据源没有引入性能回归；max/over-1ms 略高属于共享机器噪声（`review-task-1866.md` §5 独立复现时也观察到同样的方差，2.6 ms 的极值都出现过）。
- `findings/GB1.md` 补了「PSP / 内存风险」一节（源自 `review-task-1867.md` §3：战斗 `ui:img.*` 24,498,560 字节按 4444 量化，PSP 宿主 `include_bytes!` 整包塞 `.rodata` 没有流式/压缩，和地形的 21.5 MB 加起来远超 32 MB；CLUT8+RLE 混合方案预计 ≈5.8 MB，但需要给组件仓通用 `ui:img.*` pak 入口加 `PSM_T8` 分支，是与 S2 同量级的独立后续任务）。
- `findings/GB2.md` 去掉了写死的 `/var/tmp/fleet/1873/run-a`/`run-b` 路径引用。

## 验证

| 命令 | 结果 |
| --- | --- |
| `bun run import` 连续两次，`git status --short` | 两次 exit 0；均 clean；均报 `214 monsters, 230 techniques, 511 textures, 24498560 battle-only pak bytes` |
| `bunx tsc --noEmit` | exit 0，无输出 |
| `bun test tests/` | 61 pass，0 fail，48,075 次断言，11 个文件；built-bundle golden replay 非跳过 |
| `bun run build` | exit 0；真实 PocketJS pak 2,891 entries、50,765,072 B |
| `bun run verify:g6:determinism` | PASS；隔离根 2，2,902 文件，49,352,699 B，SHA-256 `0aa1712d2d0e12705e3366d750f6c6c23aa1a6156f91e1a5ce6a33e9de616708` |
| 8,560 场差分语料 vs. 适配后 GB1 数据（`tests/battle-db-adapter.test.ts`） | `{cases:8560, identical:8560, different:0}` |
| 8,560 场差分语料 vs. oracle 夹具（`tests/battle-golden.test.ts`，诊断用） | 同样 0 differences（未回归） |
| `bash tools/bench-battle-quickjs.sh` × 3 | 见 §6 表格 |
| `git diff --name-only -- bun.lock vendor/` | 无输出 |
| `__pycache__` | 无匹配 |

本地提交（HEAD `4b74587`，共 8 个提交叠在合并提交上）：`f3f096b`（合并 GB1）、`7274fff`（补三处数据缺口）、`1b3f275`（scope 效果）、`ea4a205`（技能完整性修复）、`1ff89d4`（适配层 + 等价测试）、`2cbede4`/`b56f425`（切换运行时/基准/测试到 GB1）、`cb21968`（QuickJS 基准）、本报告提交。不 push。

## 修复 1（`review-task-1881.md` 判 FAIL 后按其三项阻断项修，提交 `9fa0d43`、`924796c`、`0b73561`）

`review-task-1881.md` 独立复跑后判 FAIL，列出三项阻断项，逐条修复如下：

1. **`scope` 只有 `success=true`，没有上游真正的可观察行为。** 上游 `ScopeEffect`（`/var/tmp/tuxemon-src/tuxemon/core/effects/scope.py:37-48`）读取目标的 `armour`/`dodge`/`melee`/`ranged`/`speed`，用 `combat_scope` 模板（`base.po:1721-1722`：`AR:{AR} DE:{DE} ME:{ME} RD:{RD} SD:{SD}`）放进 `extras`。`battle/tuxemon.ts` 的 `case "scope"` 现在额外调用 `combatStats(target)`，把五项数值存进事件的结构化 `scope` 字段（`battle/tuxemon.ts:825-853`），供 UI 以后用本地化模板渲染，reducer 本身不产出文本。该字段只在 scope 效果真正执行时才出现在事件对象上（`...(result.scope ? { scope: result.scope } : {})`），其余技能事件形状不变，8,560 场差分语料因此保持 0 differences（`scope` 本来就不在训练师语料里，见下方验证表）。

   为了拿到"上游具体值"而不是自证，直接对 GB1 pinned 的 Tuxemon 源跑了一段独立 Python 探针（复用已有 `/var/tmp/fleet/gb2-oracle-venv`，`tools/battle-oracle/boot.py` 的引导逻辑）：构造一个只有 `armour/dodge/melee/ranged/speed` 五个属性的假目标对象，直接调用 `ScopeEffect().apply_tech_target(...)`。对 `{armour:10, dodge:10, melee:10, ranged:10, speed:10}`（与 `tests/battle-effects.test.ts` 的 `BASE` fixture 相同）得到 `extras=['AR:10 DE:10 ME:10 RD:10 SD:10']`；对一组非平凡值 `{armour:231, dodge:415, melee:471, ranged:233, speed:406}` 得到 `extras=['AR:231 DE:415 ME:471 RD:233 SD:406']`——确认了字段集合、顺序、模板占位符都和我们往事件里塞的五个字段一一对应。定向测试（`tests/battle-effects.test.ts:68-104`）现在断言 `event.scope` 恰好等于 `{armour:10, dodge:10, melee:10, ranged:10, speed:10}`，并在注释里记录了这条 oracle 探针的来源和输出。

2. **规则单测直接吃 oracle JSON，没走 GB1 管线。** `tests/battle-effects.test.ts` 原先 `readFileSync(tools/battle-oracle/tuxemon-battle.json)` 直接当 reducer 数据库。改成和 `tests/battle-db-adapter.test.ts`/QuickJS 基准一致的 `battleDbToTuxemonBattleDb(validateBattleDb(battleDb))`，`battleDb` 来自 `data/battle-db.json`（`tests/battle-effects.test.ts:1-18`）。GB1 的 Spyder 范围库里 `rockitten`/`nut`/`panjandrum`/`neutralize`/`scope`/`beam` 全部存在（技能槽用效果类型逐一核对过：`prop_damage→panjandrum,tooth_for_tooth`、`reverse→neutralize`、`scope→scope`），三个既有定向测试改库后原样通过。`grep -rl "tuxemon-battle.json" --include=*.ts .`（排除 node_modules）现在只命中 `tests/battle-golden.test.ts`（差分诊断）和 `tests/battle-db-adapter.test.ts`（字段等价），符合"oracle 仅用于诊断/等价"的规矩。

3. **`tools/bench-battle-quickjs.sh` 写死了 `/var/tmp/fleet/1881/...`。** 改成 `BATTLE_BENCH_ROOT`（默认 `/var/tmp/fleet/pocket-tuxemon/battle-bench`）派生 scratch/target/bundle 三个路径，脚本开头 `mkdir -p "$bench_root"`（`tools/bench-battle-quickjs.sh:4-10`）。`git diff` 里唯一命中 `1881` 的是被删掉的旧行，新增代码和三条提交信息里都没有任务号。

### 验证

| 命令 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0，无输出 |
| `bun run import` 连续两次，`git status --short` | 两次 exit 0，均 clean，均报 `214 monsters, 230 techniques, 511 textures, 24498560 battle-only pak bytes` |
| `bun test` | 63 pass，0 fail，48,112 次断言，12 个文件 |
| `bun tools/battle-oracle/compare-golden.ts tests/goldens/gb2-spyder-traces.ndjson.gz <适配后 GB1>` | `{"cases":8560,"identical":8560,"different":0,...}`，确认新增的可选 `scope` 字段没有改变训练师语料里任何一场战斗的事件序列 |
| `bun run verify:g6:locks` | `{"pages":319,"lockCommands":323,"dynamicChecks":323,"outcomes":{"unlocked":317,"transferred":2,"unresolved":0,"error":0},"exceptions":0}` |
| `bun run verify:g6:determinism` | `PASS isolatedRoots=2 files=2902 bytes=49350838 sha256=edd2e4d5e7aa26cbbe93fd88b84118f5f6dd5a85879cdf1395cf54c4abfa68b4`（与 `review-task-1881.md` 记录的哈希一致） |
| `bun run build` 后 `bun test`（built bundle replay 未跳过） | `pak: 2891 entries, 50765072 bytes`；随后 `bun test` 仍 63 pass / 0 fail |
| `bash tools/bench-battle-quickjs.sh`（`BATTLE_BENCH_ROOT` 用默认值） | exit 0；`roundSettlementMs.mean≈0.610ms, p95≈0.846ms`，`completeBattleMs.mean≈6.82ms`，与修复前/`GB2.md` 同量级，无回归 |
| `git status --short`、`git diff --name-only -- bun.lock vendor/` | 均无输出 |
| `grep -rn "1881" --include=*.ts --include=*.sh --include=*.rs tools/ battle/ importer/ tests/` | 无输出 |

三个修复各自独立提交：`9fa0d43`（测试改走 GB1 管线）、`924796c`（scope 结构化 readout + 定向测试）、`0b73561`（基准脚本去任务号）。不 push。

## 修复 2（`review-task-1895.md` 判 FAIL 后按其两项阻断项修，提交 `8d7cff0`、`647d674`）

`review-task-1895.md` 独立复跑后判 FAIL，列出两项阻断项，逐条修复如下：

1. **`scope` 定向测试对三类关键错误均无辨识力，且 stage 语义未定。** commander 决定：`scope` 读**基础能力值**，与上游逐位一致——上游 `ScopeEffect`（`/var/tmp/tuxemon-src/tuxemon/core/effects/scope.py:40-47`）直接读 `target.armour`/`dodge`/`melee`/`ranged`/`speed`，这五个属性是 `Monster` 的只读 property，返回 `self.base_stats`（`/var/tmp/tuxemon-src/tuxemon/monster/monster.py:351-372`），**不含**战斗中 `temporary_stat_boosts`（stage）的加成——`get_combat_stats()`（`monster.py:574-589`）才会叠加 stage，而 `ScopeEffect` 从不调用它。因此把 `battle/tuxemon.ts:829` 的 `combatStats(target)` 改成 `target.base`（`battle/tuxemon.ts:825-834`），reducer 里 `BattleMonster.base`（`battle/types.ts:124`）就是本项目对上游 `base_stats` 的对应字段（等级/IV/口味/体型算出、不含 stage/status，见 `battle/stats.ts:38-66` 的 `calculateBaseStats`）。

   `tests/battle-effects.test.ts` 换成真实、非对称、非 1 级的夹具：用 oracle venv（`/var/tmp/fleet/gb2-oracle-venv`）在共享 mulberry32 流 `RNG.seed(1899)` 下、按 `Monster.spawn_base("rockitten", 13)` 后 `Monster.spawn_base("nut", 17)` 的构造顺序（与测试里"user 先于 target"一致）独立复跑（脚本见 `tools/battle-oracle/probe_scope.py`，命令：`TUXEMON_SRC=/var/tmp/tuxemon-src /var/tmp/fleet/gb2-oracle-venv/bin/python tools/battle-oracle/probe_scope.py`），得到目标 `nut` L17 `AR=199 DE=101 ME=109 RD=194 SD=107 HP=195`、攻击方 `rockitten` L13 `AR=88 DE=146 ME=163 RD=86 SD=151 HP=115`，与 `review-task-1895.md` 记录的五项互不相同的真实值完全一致。用本项目自己的 `calculateBaseStats` 对同一组 individual_values/taste 重算，六项全部 bit-exact 复现（临时脚本核对，未提交，因为它只是重述 `calculateBaseStats` 已有的 golden 覆盖）。这组值现在写死为 `ROCKITTEN_L13_BASE`/`NUT_L17_BASE` 常量（`tests/battle-effects.test.ts:21-40`），供两个新用例断言。

   第二个用例专门覆盖 stage 语义：给目标 armour 加 `+1` stage、speed 加 `-1` stage 后，探针显示上游 `target.get_combat_stats()` 变成 `298/101/109/194/71`，但 `ScopeEffect` 仍输出 `199/101/109/194/107`（探针输出见 `tools/battle-oracle/probe_scope.py` 运行记录）；测试里用同一 reducer 的 `combatStats(target)` 断言这一变化确实发生（`armour:298, speed:71`），再断言 `scope` 事件仍是未修正的基础值，且目标的其余状态（含刚设的 stages）不受影响。

   逐一复跑 `review-task-1895.md` 指出的三类变异，全部由绿转红：

   | 变异 | `bun test tests/battle-effects.test.ts` |
   | --- | --- |
   | `armour`/`dodge` 对调（`const { armour: dodge, dodge: armour, ... } = target.base`） | `2 pass / 2 fail`，两个 scope 用例都失败，diff 显示 `armour:101 dodge:199`（对调后的值），符合预期 |
   | 读攻击方而非目标（`target.base` → `user.base`） | `2 pass / 2 fail`，两个 scope 用例都失败，diff 显示 rockitten 的 `88/146/163/86/151`，不是 nut 的值 |
   | 读含 stage 的战斗值（`target.base` → `combatStats(target)`） | `3 pass / 1 fail`，第一个（无 stage）用例仍绿（此时两者恰好相等），但第二个（含 stage）用例转红，diff 显示 `armour:298 speed:71` |

   三次变异都用 `python3` 脚本原地替换后立即 `bun test`，测试完立刻用 `cp` 还原并以 `git diff --stat` 确认无残留（本报告的验证表有独立记录）。

2. **提交信息含 fleet 任务号。** 本轮修复的新提交信息不写任何任务号/审查号（既有的旧提交按规矩不重写，commander 合并时会压成一个提交）。

### 验证

| 命令 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0，无输出 |
| `bun run import` 连续两次，`git status --short` | 两次 exit 0，均无 `data/` 差异，均报 `214 monsters, 230 techniques, 511 textures, 24498560 battle-only pak bytes` |
| `bun test` | 64 pass，0 fail，48,116 次断言，12 个文件（较修复 1 时 +1 用例 / +4 断言） |
| `bun tools/battle-oracle/compare-golden.ts tests/goldens/gb2-spyder-traces.ndjson.gz tools/battle-oracle/tuxemon-battle.json` | `{"cases":8560,"identical":8560,"different":0,...}` |
| `bun run verify:g6:locks` | `{"pages":319,"lockCommands":323,"dynamicChecks":323,"outcomes":{"unlocked":317,"transferred":2,"unresolved":0,"error":0},"exceptions":0}` |
| `bun run verify:g6:determinism` | `PASS isolatedRoots=2 files=2902 bytes=49350838 sha256=edd2e4d5e7aa26cbbe93fd88b84118f5f6dd5a85879cdf1395cf54c4abfa68b4`（与修复 1、`review-task-1895.md` 记录的哈希一致，规则改动不影响资产字节） |
| `bun run build` 后 `bun test` | `pak: 2891 entries, 50765072 bytes`，`dist/main.js 19330894 bytes`；随后 `bun test` 仍 64 pass / 0 fail |
| `git status --short`、`git diff --name-only -- bun.lock vendor/` | 均无输出 |
| `find . -iname "__pycache__"`（排除 node_modules/vendor） | 只命中 `tools/battle-oracle/__pycache__`，在 `.gitignore` 里，未被追踪 |

本次修复分两个提交：`8d7cff0`（reducer 改成读 `target.base`）、`647d674`（测试换成真实非对称夹具 + 新增探针）。新增独立探针 `tools/battle-oracle/probe_scope.py`（构造真实 `nut`/`rockitten` 怪物、驱动 `ScopeEffect`，含 stage 场景），作为本节数值来源的可复跑证据。不 push。

## 后续建议（不阻断，供 commander 派后续任务参考）

- PSP 战斗+地形美术体积风险（§6 已记；建议参照 S2 先例另立任务，涉及组件仓 pak 编译器）。
- `battle/from-battle-db.ts` 目前只覆盖 reducer 直接读的七张表；一旦有真正的"从 `trainerParties`/`encounters` 触发一场战斗"P2 世界联动任务，需要另写一层用 `learnedMoves()` 做等级选招、生成 IV/口味的怪物实例化逻辑——本任务的适配层文档注释已经把这个边界写清楚，避免重蹈 `review-task-1866.md` §6 指出的"以为是纯改名"的坑。
