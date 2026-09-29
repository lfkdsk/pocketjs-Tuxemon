# 审查 GB-int（task 1881）

审查对象为 `fleet/task-1881` 当前 `55c89ee`；GB-int 自身提交为
`7274fff..04aeb71`，其后合入游戏仓 `main`。依据
`game-GBint-battle-db.md`、`reviewer-generic.md`、GB1/GB2 报告及前序审查，
本审查独立复跑导入、差分、变异、QuickJS、构建和全部门禁。

## 裁决

主体适配和数据导入是正确的：适配后 8,560 场全部一致，字段级测试确实把
GB1 生成库和独立 Python oracle 导出相比较，`elementOrder`、状态 modifier、
`StatModel` 默认值、等级选招及 `empty`/`hawk` 闭包均有正确结果；QuickJS
性能也没有回退。但是有三项明确违反本任务规格，其中 `scope` 还是可达内容的
功能缺失，因此不能通过。

## 阻断项

1. **`scope` 没有实现上游唯一有意义的语义，定向测试把 no-op 当成正确结果。**
   上游 `ScopeEffect` 读取目标的 armour/dodge/melee/ranged/speed，格式化
   `combat_scope`，并把文本放入 `TechEffectResult.extras`
   （`/var/tmp/tuxemon-src/tuxemon/core/effects/scope.py:37-48`；英文模板是
   `AR:{AR} DE:{DE} ME:{ME} RD:{RD} SD:{SD}`，见
   `/var/tmp/tuxemon-src/mods/tuxemon/l18n/en_US/LC_MESSAGES/base.po:1721-1722`）。
   当前实现只执行 `result.success = true`，事件里没有 readout、`extras` 或结构化
   stats（`battle/tuxemon.ts:821-825,834-844`）。用适配后的 GB1 数据实际执行，
   最后事件只有 technique/hit/success/damage/HP/status 字段，没有五项侦察结果。
   定向测试只断言成功、零伤害、hit=false、目标对象未变
   （`tests/battle-effects.test.ts:68-90`），所以没有对照上游真正的可观察行为。
   该技能由已导入的 `tm_scope` 可达，不是死数据。应把五项数值作为可渲染事件
   输出（或等价的本地化消息）并按上游具体值断言。

2. **“测试战斗数据只来自 GB1”不成立。** 生产/基准 bundle 已经正确只包含
   `data/battle-db.json`：本审查生成的 metafile 输入只有 `data/battle-db.json`、
   适配层和 reducer，完全没有 oracle；真实 `dist/main.pak` 也只有
   `game:battle-db`，没有旧 JSON。`battle-golden`（差分诊断）和
   `battle-db-adapter`（字段等价）引用 oracle 符合例外。但普通规则单测
   `tests/battle-effects.test.ts:14-17` 仍直接把
   `tools/battle-oracle/tuxemon-battle.json` 当 reducer 数据库，包括本任务新增的
   `scope` 定向测试。它既不是两份数据的等价比较，也没有经过 GB1 适配层，违反
   “运行时与测试只来自 GB1，oracle 仅用于诊断/等价”的明确要求，也让规则测试
   无法证明 GB1 管线本身能驱动这些效果。应与 benchmark 一样构造
   `battleDbToTuxemonBattleDb(validateBattleDb(battleDb))`。

3. **新增可执行脚本写入了 fleet 任务号。** `tools/bench-battle-quickjs.sh:5-8`
   把 scratch、Cargo target 和 bundle 写死为 `/var/tmp/fleet/1881/...`；差异 grep
   恰好命中这三行。规格明确要求代码和提交信息不含 fleet 任务号。提交主题本身
   都合规，但脚本应使用可覆盖的通用 scratch 根（或 `mktemp -d`）而不是任务号。

## 逐条对照规格

| 条目 | 结论 | 独立证据 |
| --- | --- | --- |
| 合并已过审 GB1 | 成立 | 历史含合并 `f3f096b`；当前 GB1 数据、美术与前序 PASS 审查都在树中。 |
| 显式 `elementOrder`，不得依赖对象键序 | 成立 | `importer/battle.ts:63-84,817-832` 生成并校验显式顺序；适配层用 `db.elementOrder`（`battle/from-battle-db.ts:137`）。变异为 `Object.keys(db.elements)` 后，元素等价测试 exit 1，直接显示字母序与源顺序差异。 |
| 状态 `modifiers` | 成立 | GB1 中仅 burn/poison 非空，值分别是 fire→0、frost→2、venom→0，与上游 YAML 及独立 oracle 一致；把适配结果强制改为空数组后 status 等价测试 exit 1，并在 burn 首项变红。 |
| `StatModel` 默认值与 schema | 成立 | `importer/battle.ts:75-84` 与上游 `tuxemon/db.py:1440-1468` 一致；当前 techniques/items/statuses 的 30 个 modifier 全都有七个字段，默认 `max_deviation=0`、`max_step_limit=6`、`scaling_mode=nonlinear`、`overridetofull=false`。schema 在 `importer/battle-schema.ts:287-298` 校验。 |
| 纯 `BattleDb → TuxemonBattleDb` 适配 | 成立 | `battle/from-battle-db.ts:33-151` 只构造新对象；字段级测试分别读取 `data/battle-db.json` 与独立 oracle。oracle 文件是旧文件的 100% rename，前后 SHA-256 均为 `241fcb4328c180dc7fd3b3a60b56543d0284cd9645d2253ea98a85ab345590f3`，不是由适配结果生成。 |
| speed tier、元素、状态、口味、shape、technique 字段等价 | 成立 | `bun test tests/battle-db-adapter.test.ts`：8 pass、0 fail、3,789 次断言；字段等价逐表通过。 |
| moveset 按等级选招 | 成立（当前边界） | 适配层保留升级表，`learnedMoves()` 在 `battle/stats.ts:180-186` 过滤 `level_up && level_learned <= level` 并取末四招；独立探针给 Rockitten L1/L5/L10/L50 分别得到 2/3/4/4 招，L50 为 `ice_claw,surge,stampede,earthquake`。当前尚没有 trainerParty→MonsterSnapshot 的生产消费者。 |
| `empty` / `hawk` 导入修复 | 成立于钉住数据；规则没有写死两个 slug | `importer/battle.ts:489-518` 按 `disappear` 参数做不动点，再扫描所有 status hook；当前关系审计为 `techniques=230,statuses=35,missing=[]`。旧 228 技能库补回 `empty` 后独立重放得到 `identical=8417,thrown=143`，与报告的 hawk 缺失数字一致；当前补齐二者后 8,560 全部一致。实现是按关系字段而非实体名选择。 |
| `scope` 对照上游实现 | **不成立** | 见阻断项 1。把当前 `success=true` 变异为 false 时现有测试会红，但它只覆盖成功位，完全不覆盖上游 stat readout。 |
| oracle 退出生产数据路径 | 生产路径成立，测试路径不成立 | benchmark metafile 无 oracle，pak 只含 `game:battle-db`；但 `battle-effects.test.ts` 仍直接载入 oracle，见阻断项 2。 |
| 适配后 8,560 场 0 差异 | 成立 | 独立一行比较器输出 `{"cases":8560,"identical":8560,"different":0}`。 |
| 提交 QuickJS 基准且性能同量级 | 成立 | `bash tools/bench-battle-quickjs.sh` 在真实 PocketJS QuickJS 中 exit 0：2,750 round samples，mean `0.630319 ms`、p95 `0.863925 ms`、max `2.235509 ms`，250 场均值 `7.042391 ms`；与 GB2 的约 0.6/0.86 ms 同量级。脚本的任务号另见阻断项 3。 |
| GB1 PSP/内存风险补记 | 成立且数字准确 | 当前 build 为 2,891 entries、50,765,072 B；battle-only 24,498,560 B、terrain 21,575,296 B。PSP host 确在 `build.rs:218-246` 用 `include_bytes!` 嵌入整 pak，`pak.rs:1-18,28-50` 直接安装并按 entry 取数据；约 5.8 MB 混合 CLUT8 估算与前序审查一致。 |
| GB2 不再写死 scratch 路径 | 成立 | `rg '/var/tmp/fleet|run-a|run-b' findings/GB2.md` 无输出；原路径改成 “separate scratch directories”。 |
| 自动导入、不逐图特判、不改 PocketJS | 成立 | 两次完整 import 都从钉住的 Tuxemon 源生成相同输出；GB-int 差异没有逐图内容特判，`vendor/pocketjs` 无改动。 |

## 独立门禁

| 命令 | 结果 |
| --- | --- |
| `bun run import` ×2 + 每次 `git status --short` | 两次 exit 0、两次 clean；均为 214 monsters、230 techniques、511 textures、24,498,560 battle-only pak bytes；六个关键生成文件 SHA-256 两次逐项相同。 |
| 独立适配后差分一行脚本 | `{"cases":8560,"identical":8560,"different":0}`。 |
| `bunx tsc --noEmit` | exit 0，无输出。 |
| `bun test` | 63 pass、0 fail、48,111 次断言、12 files；built bundle replay 与两套 8,560 corpus 都实际运行。 |
| `bun run verify:g6:locks` | 323/323 dynamic checks；unresolved=0、error=0。 |
| `bun run verify:g6:determinism` | PASS；isolatedRoots=2、2,902 files、49,350,838 B、SHA-256 `edd2e4d5e7aa26cbbe93fd88b84118f5f6dd5a85879cdf1395cf54c4abfa68b4`。 |
| `bun run build` | exit 0；2,891 pak entries、50,765,072 B，`dist/main.js` 19,330,894 B。 |
| `git diff --name-only ... -- bun.lock vendor/`、`git ls-files` pycache scan | 均无输出；worktree clean。 |

## 变异检查

1. `element_order` 从 `db.elementOrder` 改为 `Object.keys(db.elements)`：定向测试
   exit 1，清楚显示 `cosmic,earth,fire,...` 字母序不等于
   `frost,heroic,normal,...` 源顺序。
2. 适配状态的 `modifiers` 强制改成 `[]`：定向测试 exit 1，burn 的 fire 免疫
   与 frost×2 两条规则都显示为缺失。
3. `scope` 的 `result.success` 改为 false：定向测试 exit 1（expected true,
   received false）。该变异也暴露测试盲区：它只守住 success 位，并不守住上游
   readout；当前实现即使完全不产生侦察信息仍然全绿。

三项变异均已还原，随后全量测试与 clean 检查通过。

## 画面肉眼核对

已按原始 768×288 打开 `findings/GB1-preview.png`：左侧草地战斗构图中玩家背面
怪、对手正面怪、两块 HP HUD 与站台位置合理；右侧训练师、四帧技能白色闪光、
球、属性/怪物图标接触表都可见。没有紫块、错页或明显裁切。该图来自已过审
GB1，本任务没有新增渲染画面。

FAIL
