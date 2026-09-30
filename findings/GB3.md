# GB3：捕获、战斗道具、逃跑、成长进化与双打

## 结果

GB3 在既有纯 reducer 与 GB4 Battle Processing 接线上补齐了捕获、战斗道具、
逃跑、换怪、经验升级、学招、实际进化和双打。每一块规则都先由固定 Tuxemon
revision `9e6258ff` 的 Python oracle 生成 golden，再由 TypeScript reducer 对照；
新增语料及原有 8,560 场 Spyder 语料均为零个未豁免差异。

玩家现在可在最简战斗画面中选择 `Fight / Item / Capture / Run / Swap`，双打时可
选择具体目标。结果会把库存与奖金写回内建 `SessionState.items` / `gold`，并把累计
逃跑次数、持久队伍、kennel、经验、等级、招式、进化和 `battle_last_result` 写回各自
的会话字段。8 场玩家双打已原生接线；
上游语义不属于当前“玩家持久队伍”边界的 5 场 NPC 对 NPC 战斗继续显示明确的
`[BATTLE]` 占位，没有伪装成 native。

本任务没有手改导入产物，没有改 `bun.lock`，也没有 push。修复 1 只把
`vendor/pocket-rpgkit` 升到含 KB5 的 `a124186`；嵌套 `vendor/pocketjs` 仍为
`76ae741f`。

## 1. Oracle-first 差分语料

三个 GB3 生成器均直接调用固定上游实现，gzip 使用固定时间戳并提交为离线 golden；
正常测试不依赖 Python 或 pygame。

| Golden | 覆盖 | 字节 | SHA-256 | 差异 |
| --- | --- | ---: | --- | ---: |
| `tests/goldens/gb3-rules.json.gz` | 216 捕获、25 普通道具、88 逃跑 | 7,959 | `c513c4b2a4a020a15f95793323feeb1deb1e63095b00bf7428ab8fe6ed2b7a8a` | 0 |
| `tests/goldens/gb3-progression.json.gz` | 33 奖励、18 成长、122 进化条件、2 次实际进化 | 11,384 | `7826823f895c47c3ead5c74fc3b1f19a679334fe0f1ed010191be4465b6918e0` | 0 |
| `tests/goldens/gb3-double-traces.ndjson.gz` | 5 个队伍定义、8 个事件、200 场双打 | 85,996 | `248ecf76dfaa1faad87874296d972f32fa54051b27c417f17f5215ef4ee465d1` | 0 |

原 GB2 corpus 也继续在生产 runtime DB 上通过：`8,560 / 8,560 identical`，
`different=0`。GB3 没有为掩盖 reducer 缺陷而修改旧预期。

## 2. 捕获、道具、逃跑与换怪

### 捕获

`battle/tuxemon.ts` 实现上游捕获率、HP 项、物种 catch rate、状态与球修正、
catch resistance、1--4 次摇晃及完全相同的随机数消费。语料覆盖全部 27 种常规战斗
捕获设备、4 个种子、成功/失败、状态和各球特例；同时保留上游可观察怪癖，包括
crusher 的比较错误、gender fallback 重复应用、hardened 失败不消耗和 candy 对只读
level 赋值时抛出的 `AttributeError`。

成功捕获会设置 acquisition、捕获球和初始 bond，清除不跨战斗的状态，结束战斗并
写入 `battle_last_result=captured`。BattleRules 随后把怪物按稳定顺序放入上限为 6 的
party 或上限为 30 的 kennel。

### 战斗道具

25 个非捕获战斗道具逐个进入 oracle，覆盖固定/比例回血（含复活路径）、状态恢复、
战斗属性变化和属性类型切换；同时执行 usable-in、库存、目标阵营、野怪、HP、状态和
lockdown 条件。目标由菜单显式选择，消耗品按上游成功/失败规则扣减，所有 golden case
的效果、最终库存和 RNG 游标都一致。

### 逃跑与换怪

逃跑严格使用：

```text
random() <= 0.4 + 0.15 * (run_attempts + 我方等级 - 对方等级)
```

普通尝试消费一次随机数；失败让 `runAttempts += 1`，成功清零并写
`battle_last_result=run`。`grabbed` / `stuck` 时不可逃且不消费随机数；累计值保存在
扩展状态中，因此会跨战斗延续。换怪校验存活后备、field、阵营、排队重复目标及同样的
束缚状态，再进入 reducer 的稳定 action order。

## 3. 经验、升级、学招与实际进化

成长实现上游的 L³ 阈值、acquisition multiplier、Python ties-to-even 舍入、参战者
分摊、100 级边界、属性/当前 HP 同步增长、训练点和 bond 奖励。语料覆盖 8 种
acquisition、单人/双人分摊、跨多级与跨多招、精确等级边界及满级后总经验继续累积；
成长规则本身消费 0 个随机数。

升级会按跨过的完整区间学习全部合资格招式。出现第 5 招时当前确定性策略遗忘 slot 0；
`MoveForgetSelector` 已是可注入接口，未来 UI 可提交任意合法槽位而不改经验规则。

导入器保留从 257 个根怪物可达的完整进化闭包。oracle 逐一覆盖 93 个源物种的 122 条
进化记录，包含 level、bond、element、gender、inside、item、party、stats、tech 和
variables 条件，并分别检查满足与不满足上下文。世界事件中的 2 个 `evolution` 和
2 个 `check_evolution` 已接成扩展命令/条件及 Yes/No 选择。

实际进化由两条上游 case 锁定完整快照和 RNG。目标形态先按上游消费 13 次随机抽取，
然后复现 `transfer_properties_from` 的反直觉顺序：即时 base 用目标随机 IV 和零 TP
计算，再复制旧 IV/TP。因此即时 base 与保存重载后的 base 可以不同。旧 iid、性别、
口味、生日、HP、经验、TP、状态、招式和捕获球按上游转移；stage1/stage2 bond 下限
分别为 20/40，进化专属招式也会加入。

## 4. 双打

8 个 `start_double_battle`（`spyder_route5` 6 个、`spyder_dragonscave` 2 个）现以
`fieldSize: 2` 原生进入 Battle Processing。reducer 的两个 active slot 都参与决策、
速度排序、击倒替补和奖励分摊；菜单先选动作，再在所有合法己/敌目标中选择具体槽位。

聚焦 oracle 对 5 个不同敌方队伍各跑 20 seeds × 2 policies，共 200 场；每场双方开局
均至少两只。语料包含超过 1,000 次明确选择第二槽以及 15 次真实 spread-damage 事件。
对多个敌方目标的 `damage` / `splash` 逐目标应用上游 `×0.75` 并取整，200 场轨迹全部
一致。

5 场 NPC 对 NPC 的单打仍是可见占位。上游在这些事件中没有玩家队伍，而当前
BattleRules 的持久状态、失败处理和奖励写回都以玩家为边界；在没有独立 NPC 战斗
session 所有权模型前，保留占位比伪造玩家参与更忠实。

## 5. BattleRules、存档与画面

`battle/runtime.ts` 将五项主菜单及分层目标选择映射为 reducer decision。结束时原子写回：

- 消耗后的库存到 `SessionState.items`，奖金及技能金钱到 `SessionState.gold`；
- 跨战斗 `runAttempts` 到 Tuxemon 扩展状态；
- 玩家 HP、状态、经验、等级、属性、训练点、bond、招式及待进化标记；
- 捕获怪物到 party/kennel、caught species 与稳定 iid；
- `battle_last_result` 的 `run` / `captured` 取值及既有战斗历史。

`battle/extension.ts` 新增 `tux.check_evolution`、`tux.evolution` 和
`tux.cancel_evolution`，实际进化仍通过完整扩展状态 codec 校验，可保存、恢复和倒带。

验收图 `findings/GB3-battle.png` 为 480×272、26,801 bytes，SHA-256
`8bfcfad82b903501ae1e809b236104810c4f0bd680ba8580194944434fd1747d`。已实际打开核对：
森林背景、Budaye/Nut HUD 和 `Fight / Item / Capture / Run / Swap` 均清楚、无裁切。
PNG 测试除固定字节与尺寸外，还用 8 条断言检查面板和五项菜单的语义像素，不只依赖
哈希。

## 6. 导入覆盖率与稳定性

全量 263 图重导入后的覆盖率：

| Kind | Native | Native rate | Executable rate |
| --- | ---: | ---: | ---: |
| Actions（13,617 uses） | 11,547 | 84.8% | 89.8% |
| Conditions（8,663 uses） | 7,666 | 88.5% | 89.6% |

本次新增的相关逐类结果为：`start_double_battle` 8/8 native、`evolution` 2/2 native、
`is check_evolution` 2/2 native。`start_battle` 仍为 325 native、5 个 NPC-vs-NPC
placeholder、1 个未实例化源事件 dropped。

`bun run import` 连跑两次后，生成物无第二次差异，关键内容哈希两次一致：

| 生成物 | SHA-256 |
| --- | --- |
| `dist/project.json` | `6bcf190e89ce8779375454f3ba09053851b12cdac7c727357a66b8af1c536ee2` |
| `dist/project-shell.json` | `708775e67811433db7411f17284669f2a7222768edd7718608c2c16e1e213f90` |
| `data/battle-db.json` | `881814d8a162ceabd9c6ab6a89d666d12592fa8aa05ec215cd90ad87c7dfb161` |
| `data/battle-runtime-db.json` | `cc8414bd3115c7720d822fba94eb6238addc387f48e5e40b69bb131c2be99ffc` |
| `dist/import-report.json` | `c1acea296d645de09e0e8d7c42b13e6e0ebfcb9729f3ed2f17a36bda69bd2e39` |

独立根 determinism 检查也通过：2 roots、3,234 files、59,455,087 bytes，统一
SHA-256 `068fa2966bf3206643266ab087f258fd5ba3cc7f8466eedee2588380a7319c7d`。

## 7. Journey、倒带与 QuickJS

增加 Fight 主菜单后重录了维护 tape，没有改动路线语义。胜线与败线均在
60 / 30 / 20 / 4 Hz 到达 `spyder_route1 [14,19]`：60 Hz 胜线 2,788 frames，败线
2,893 frames。8 组重放全部逐帧满足 inline 与 sharded runtime 相等；每组都在战斗后
按 L 倒带回 active battle，再重放得到与未倒带基线 reducer-identical 的状态。胜线
canonical state SHA-256 为
`7fdc130b0b90fece5f3814d886dad0a4513417ce31e2d59019dd0ce310d8dd64`。

裸 QuickJS reducer 基准使用成长规则生效后的真实 12-turn Spyder fixture。20 场预热后
测 250 场，共 3,000 个 round samples：

| Metric | 结果 |
| --- | ---: |
| Round mean | 0.689605 ms |
| Round p95 | 0.926741 ms |
| Round max | 8.782297 ms |
| Samples over 1 ms | 30 / 3,000 |
| Complete battle mean | 8.395896 ms |

目标“回合结算 mean 与 p95 ≤ 1 ms”满足；偶发最大值如实保留。

最新 PocketJS desktop host 整机 QuickJS 重放中，480×272 与 960×544 的 battle p95
分别为 `6.507 ms` 与 `6.795 ms`，全帧 total p95 分别为 `2.475 ms` 与 `2.543 ms`；
两档终态 SHA 均与上述 journey 相同。全地图首访保持 263/263，最近一次非豁免最慢图
为 `buddha_mountain 46.743 ms`；`test_npcs 56.889 ms` 仍是既有显式豁免。

## 8. 明确兼容性决定

本次只有一项新增的有意 gameplay 偏离：

1. **捕获成功仍执行正常战后清理。** 固定上游会从捕获路径提前返回；Pocket Tuxemon
   按 commander 已批准的规则执行正常 cleanup，再把捕获怪物写入持久队伍/kennel。
   该项明确写在 GB3 rules golden header 中。

以下不是新增 gameplay 偏离：

- `stable-active-field-multitarget-order` 是 GB2 已声明的 oracle normalization：上游
  Python UUID set 的多目标顺序会跨进程变化，oracle/reducer 使用稳定 active-field
  顺序。双打 golden 继续显式声明它。
- `draw-as-player-defeat` 是 GB2 既有的真平局崩溃处理，原 8,560 场 header 保持不变。
- 5 场 NPC 对 NPC 是覆盖率中明确可见的 placeholder，不计作 native，也没有差分豁免。

## 9. 最终门禁

- `bunx tsc --noEmit`：exit 0。
- `bun run build && bun run build:wasm`：exit 0；wasm 289,758 bytes。
- `bun test tests/`：128 pass、0 fail、60,143 assertions、26 files；无需 Python。
- GB2 差分：8,560 identical、0 different；GB3 三组 golden 均 0 difference。
- `bun run verify:g6:locks`：329 pages、333/333 dynamic checks、327 unlocked、
  2 transferred、0 unresolved、0 errors。
- `bun run verify:g6:frozen`：263 maps、0 permanent locks、0 blocking fibers、0 errors。
- `bun run verify:g6:determinism`：PASS。
- 两次全量 importer 输出字节稳定，聚合 SHA-256 均为
  `1910dfcc3f1113d76660c09dda907612297df116cc40ab4e40fd43032aa2864a`。
- `bun tools/desktop.ts --build-only` 及两视口 QuickJS 重放均通过。
- `bun.lock` 无变化；`vendor/pocket-rpgkit` 有意升级到 `a124186`，嵌套 PocketJS 未变。
- 源码与提交信息扫描没有 fleet/task 编号、AI 或 `Co-Authored-By` 尾注。

实现按 oracle、各机制、接线、视觉、journey 和性能/锁审计拆成可回退的本地提交；
没有 push。

## 10. 修复 1：商店与战斗共用背包、钱包

审查发现商店操作内建 `SessionState.items` / `gold`，而战斗曾读写扩展状态中的
`inventory` / `money` 镜像，导致两边互不可见。修复先把 Pocket RPG Kit 升到
`a124186`，使用 KB5 的 `BattleRules.start(..., context)` 和 `BattleCompletion.items` /
`gold` 契约：战斗开始从会话上下文取得背包与钱包快照，结束时以替换语义把完整库存
和 `startingGold + reward` 写回会话。战斗 reducer 内的 `battle.inventory` 只是当前战斗
的确定性快照，不再是另一份持久库存。

`TuxemonExtensionState` 已删除 `inventory` / `money`，只保留队伍、kennel、战斗历史、
逃跑次数、环境和昏厥点等组件仓没有的领域状态。codec 读取旧 v1 存档时会丢弃这两个
旧镜像字段而保留其余扩展数据。导入器的 `add_item` 现在只生成组件仓原生 `item`
命令，`has_item` 只生成原生 item condition；全量生成物及 desktop staging 中都不再
含 `tux.change_item` / `tux.has_item`。

新增的真实导入工程会话测试使用 Cotton Scoop 与 Taba Town 内容，验证完整闭环：

- 用 140 gold 买 2 个 potion 与 2 个 tuxeball，下一场战斗的 Item/Capture 菜单立即
  显示相同数量；各消耗 1 个后，回店卖出列表均显示 owned 1。
- 训练师战斗奖励 20 gold 回到同一钱包，可立即购买另一个 potion；导入的
  `potion >= 2` 条件随后成立。
- 存档恢复后 `sw` 与 `ext` 均相等；按 L 倒带到 frame 0 后，背包恢复为空、钱包恢复
  为 140，再按同一输入重放得到字节相同终态。

状态形状变化只来自删除扩展镜像，以及奖金从 `ext.money` 迁到会话 gold。相应地，
默认 importer hash 从 `688635be…` 变为 `29f6aa1e…`，维护 journey 的 canonical state
从 `e47eb756…` 变为 `7fdc130b…`，map entries 从 7,892,187 bytes 降为 7,869,652
bytes；覆盖率计数未变。GB2 的 8,560 场、GB3 三组 golden、胜/败 journey、L 倒带、
存档往返、locks、frozen、determinism 和两档 QuickJS 门禁均继续通过。
