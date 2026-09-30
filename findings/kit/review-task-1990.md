# Review task 1990 — KC1：扩展驱动的动态选择框（extChoice）

- 被审分支：`fleet/task-1990`（组件仓 worktree `/home/tangollvm/.fleet/worktrees/task-1990`），基线 `4bba234`，7 个提交 `4562192..e763468`。
- 规格：`/var/tmp/fleet-specs/pocket-tuxemon/kit-KC1-ext-choices.md`；被审报告：`findings/KC1.md`。
- 审查方式：4 个 subagent 并行（语义+变异 / UI / Tuxemon 上游 / 兼容静态检查），主 agent 逐行读核心 diff、肉眼核对两张 PNG、串行复跑全部门禁。

## 总结论

**PASS**。规格「要做的」4 条与「验收」全部成立；语义契约 12/12 成立；2 个变异均按预期变红；门禁全绿（数字见下）；无阻断项。

## 一、规格逐条核对

### 要做的

| 规格条目 | 判定 | 证据 |
| --- | --- | --- |
| 1. 能力设计先写进报告再实现（通用命令、扩展给选项、结果写变量/交扩展处理、纯 reducer、确定性、存档策略说明、倒带/多 hz、worldIdle 模态） | 成立 | `findings/KC1.md:3-111` 为实现前冻结的设计（`4562192 docs: design` 先于 `a78284e feat(engine)`）；契约实现于 `src/engine/extensions.ts:48-76`（`ExtensionChoiceOption/Result/Handler`）、`src/engine/types.ts:228-237`（`extChoice` 命令）、`src/engine/interpreter.ts:2042-2104, 2284-2306` |
| 2. UI 复用现有选择框/列表，支持滚动、不可选项变灰、取消；480×272 与 960×544 | 成立 | `src/ui/DialogBox.tsx:192,200`（disabled 优先于 selected 的 dim，光标前缀保留）；复用 4 行滚动窗口；两张核对图 + 双分辨率 sim 断言（见第四节） |
| 3. 测试用本仓夹具覆盖动态变化/不可选/取消/写回/扩展改状态/存档/倒带/多 hz + UI 语义像素断言 | 成立 | `tests/extensions.test.ts:242-760`（8 行 fixture 列表、revision 并行刷新、disabled、cancel 哨兵、resolver 改 ext、拒存/restore、rewind、60/30/20/4 Hz）、`tests/ui-theme-sim.test.ts:382-404`、`tests/interpreter.test.ts:920-946`、`tests/world-idle.test.ts:108-117` |
| 4. Tuxemon 接入说明（choice_monster / choice_npc / open_shop 怪物交易 / remove_monster），不改游戏仓 | 成立（一处补充见下） | `findings/KC1.md:170-223`；diff 中无游戏仓/`vendor/pocketjs` 改动；四个动作的映射经上游源码逐条核实（第五节） |

### 验收

| 验收项 | 判定 | 证据 |
| --- | --- | --- |
| 先 `bun run build:example` 再 `bun test` 全绿不跳过 | 成立 | 主 agent 复跑：build exit 0；`bun test` **960 pass / 0 fail / 469,446 expect / 62 files**（与被审报告数字一致）；UI sim 23 个测试无 skip |
| `bunx tsc --noEmit` 0 | 成立 | 主 agent 复跑 exit 0 |
| `tools/pr1-equivalence.sh` 通过 | 成立 | 主 agent 复跑：`PR1_EQUIV PASS scenarios=37 states=12376`（与报告一致） |
| goldens 不变（新增的除外） | 成立 | `git diff --name-status 4bba234..HEAD` 中无 `tests/goldens/` 下任何文件；唯一新增文件是 `findings/KC1.md` |
| schema/validator/README/CHANGELOG（v1 修订）同步 | 成立 | `src/data/schema.json:583-606` 与 `editor/engine/projects.ts:612-635` 的 extChoice 块逐字节相同；`src/engine/save-validate.ts:24,450-475,671-696`；`src/data/CHANGELOG.md:322-355`（v1 amendment 2026-09-30）；`README.md:355,418-484`；`src/engine/README.md:24-29,239-270` |
| `bun.lock` 不改 | 成立 | 不在 diff 中；门禁复跑后 `git status --short` 为空 |
| 无 fleet 任务号 | 成立 | `git diff 4bba234..HEAD \| grep -nE '1990\|fleet/task'` 无匹配；7 条提交信息均为英文 conventional 格式、无 AI 尾注 |
| 每步提交 | 成立 | design → feat(engine) → feat(ui) → test(engine) → docs → test(budget) → docs(report) 共 7 个小步提交 |

## 二、语义契约核对（12 项，全部成立）

主 agent 逐行阅读 `src/engine/interpreter.ts` 的 extChoice 全部路径（compile `:508-525`、run-mode `:2284-2306`、choices-mode `:2042-2104`、`extensionChoiceOptions :1813-1860`、`extensionChoiceDirectWrites :1862-1883`、`resolveExtensionChoice :1885-1908`、`runExtensionMutation :1755-1776`、`applyExtensionResult :1676-1752`、`modalChanged :666-677`、`cloneModal :1030-1039`），与 subagent 逐项核对一致：

1. **每 tick 动态刷新**：choices-mode 每 tick 调 `extensionChoiceOptions`（`interpreter.ts:2044`），read context 读 live `ext`/variables/items/gold（`:1659-1670`）。测试：`tests/extensions.test.ts:242`（并行 fiber 翻 revision，下一 tick 列表重建为 `["Beta live","Alpha live","Locked live"]`）。
2. **stable key 光标保持 + displaced 抑制**：键命中 `findIndex`（`:2059`），键消失 clamp + `displaced=true`（`:2061`），空列表首次出现行同样抑制一帧（`:2062-2067`），确认受 `!displaced` 门控（`:2083`）。测试：`tests/extensions.test.ts:304`。
3. **禁用行可停留不可确认**：上下键不看 enabled（`:2068-2071`），确认需 `options[index]?.enabled`（`:2083`）。测试：`tests/extensions.test.ts:274-282`（disabled index 2 上确认后 modal 仍在、ext 不变、无写回）。
4. **取消哨兵**：`cancel:true` 才生效（`:2091`）；select 写 index/key/0，cancel 写 -1/""/1（`:1862-1883`），三个字段每次全量覆盖、无旧值残留。测试：`tests/extensions.test.ts:325`。
5. **write 目标校验**：编译期（`:508-518`）与运行时（`:1874-1879`）双重校验非空且互异；save decoder 同样要求（`save-validate.ts:458-473`）。测试：`tests/extensions.test.ts:474`。
6. **resolver 原子性**：`applyExtensionResult` 先校验 ext/writes/directWrites/items/gold 再发布（`:1683-1752`）；resolver 写与 direct write 冲突直接抛错而非后者覆盖（`:1710-1712`）。测试：`tests/extensions.test.ts:484`（冲突抛错且 open 状态 JSON 不变）、`:507`（resolver 返回非对象抛错）。
7. **纯 reducer/确定性**：`options` 无 random 入参（`extensions.ts:66-69`）；只有 resolver 的 `random()` 推进存档 RNG 游标（`interpreter.ts:1763-1774`）；无 Promise/时钟/UI 本地状态。多 hz 测试：`tests/extensions.test.ts:709`（60/30/20/4 Hz 终态 JSON 一致）。
8. **存档/倒带**：持久存档统一 safe-point 拒绝 modal 打开中（`src/engine/save.ts:67,98-100`，decoder `save-validate.ts:805`）；attract rewind 快照保留 modal/fiber/ext/变量/RNG 并逐 tick refold。测试：`tests/extensions.test.ts:581`（打开中 `createSessionSnapshot` 抛 `/no modal or scene open/`；关闭后 save/restore 字节一致）、`:673`（rewind 跨已解决选择恢复 modal/光标/ext/RNG）。
9. **worldIdle 模态**：`isWorldIdle` 要求 `modal === null`（`interpreter.ts:930`）；d-pad 捕获（`session.ts:1076`）；back action 仅 cancellable 时暴露（`src/ui/GameView.tsx:501-505`）。测试：`tests/world-idle.test.ts:108-117`、`tests/extensions.test.ts:263-265`（RIGHT 不移动玩家）。
10. **preview allowUnknown**：未注册 `extChoice` 两模式均 no-op 跳过（`interpreter.ts:1818-1820, 2045-2049, 2290-2293`）。测试：`tests/extensions.test.ts:363`。
11. **handler 输出校验**：数组/非空唯一 key/非空 label/布尔 enabled/有限 JSON data/不可取消列表必须有可用行（`interpreter.ts:1823-1858`）。8 个场景测试：`tests/extensions.test.ts:392-454`。
12. **无 Tuxemon 专用代码**：fixture 为通用 `demo.party`（Alpha/Beta/Locked），`src/` 与测试无 tuxemon/物种名。

## 三、变异测试（隔离副本，主 agent 核实流程与结果）

subagent 在 detached 副本 `/var/tmp/fleet/1997/mut-a`（symlink node_modules）中各做一个变异、跑 `bun test tests/extensions.test.ts`、还原、删除副本：

| 变异 | 变红的测试 | 结论 |
| --- | --- | --- |
| A：删掉确认条件里的 `options[index]?.enabled`（允许选禁用行） | 「a live choice refreshes every tick…」（`:278`，disabled 行被确认、modal 关闭）+「an extChoice journey has the same semantic state at 60/30/20/4 Hz」（`:724`，选到 index 2/key "x" 而非 0/"b"） | 有辨识力 |
| B：删掉 `applyExtensionResult` 的 `writeIds.has(id)` 冲突抛错（resolver 失败不回滚） | 「resolver writes cannot collide with direct sinks and a failed resolution publishes nothing」（`:499`，未抛错、direct write 静默覆盖 resolver 的 "shadow"） | 有辨识力 |

副本已 `worktree remove --force` 删除，被审 worktree `git status --short` 为空。

## 四、画面与像素断言

主 agent 与 subagent 分别打开两张 PNG，所见一致：

- `ext-choice-480.png`：面板右下锚定，实测边框 bbox **x 220..467 × y 78..173（248×96）**，右边距 12、下边距 98；五行文字 `Choose your live route / Scholar route / > A label far too long to… / Hermit route / Wanderer route`；第 2 行带光标且明显比可用行暗（dim 50px、accent 0），长标签省略号截断在面板内；右下 `ok back` 图例。
- `ext-choice-960.png`：内容与逐行颜色计数完全相同，面板保持 **248×96 逻辑尺寸**（bbox x 700..947 × y 350..445），不随视口放大，无裁切错位。

像素断言是语义的、有辨识力（`tests/ui-theme-sim.test.ts:390-391` 与 960 对应 `:403-404`）：禁用行带内 `dim > 15` 且 `accent === 0`——灰显优先级回归会让两条同时变红；滚动窗口由 `treeHasText` 断言（Scholar/Hermit/Wanderer 在、Mercenary 不在，`:382-385`）；截断断言长标签在、51 字符全文不在（`:386-387`）；960 帧几何由 `expectFrame {x0:700,x1:948,y0:350,y1:446}` 钉死（`:400-401`）。静态 choices 无 `enabled` 数组时 `undefined === false` 为假，输出与旧逻辑逐字节一致（既有 hash pin `b48e4476` 仍过）。

## 五、Tuxemon 映射核对

对照 `/var/tmp/tuxemon-src`（钉 `9e6258ff`）Python 源码与 `mods/tuxemon/maps` 实际 callsite，报告 `findings/KC1.md:170-223` 的结论全部准确：

- **choice_monster = 静态参数列表**：`tuxemon/event/actions/choice_monster.py:49-63` 从冒号分隔参数出选项、写回所选 slug；两个 callsite（`maps/manhattan_beach.tmx:224`、`maps/spyder_paper_scoop.yaml:84`）均为写死的初始怪列表。成立。
- **动态选怪是 get_player_monster**：`get_player_monster.py:152-159` 从 live party 出 `MonsterMenuState`，成功写 `instance_id.hex`（`:144`），取消/无候选写 `no_choice`/`no_options`（`:172-174`）。成立。
- **choice_npc = 静态参数列表**：`choice_npc.py:57,65` 冒号分隔、可选 `label` 让所有行显示同一译文；唯一场景 `maps/start_tuxemon.yaml:16` 为静态外观列表。成立。
- **怪物交易用 extChoice**：`open_shop.py:49-58,92-135` 八种模式；怪物买卖的行来自 live party（卖，`economy/applier.py:186-187`）与 NPC 经济库存（买，`:175-185`），成交增删 party 实例（`economy/transaction.py:66-102`）——动态列表 + resolver 一次性成交的映射语义忠实。成立。
- **remove_monster = 即时 ext**：`remove_monster.py:35-60` 参数是存 UUID 的变量名，校验 UUID、找怪与 owner、从 owner 的 party 删除，无选择 UI。成立。
- 视觉降级承认属实：choice_monster 上游 UI 有动画头像与图鉴入口（`tuxemon/states/choice_monster.py:96-110,163-174`），choice_npc 有 NPC 立绘（`states/choice_npc.py:88-93`），文字列表都复现不了。

**一处补充（非阻断）**：审查清单还列了 `tuxemon/event/actions/trading.py`，报告未覆盖。该 action 自身无选择 UI——读变量里的 UUID（`:47-49`）后要么用脚本怪替换实例（`trade_manager.py:205-216`），要么在两个 live 实例间交换（`:171-203`）。正确映射与 remove_monster 同型：先 `get_player_monster` 动态选择写 UUID 变量，再即时 `ext` 执行替换/交换；TradingTransition 动画记为视觉降级。KC1 规格本身未要求 trading，故不算规格缺失，建议游戏仓接入任务照此补充。

## 六、兼容与门禁细节

- **旧工程逐字节不变**：37 张 golden PNG 全部不在 diff 中；`tests/fixtures/ui-theme/scenes.ts` 纯追加 `choicesDynamic`；`vendor/pocketjs` 未动。
- **MAP_SCHEMA_HASH 正确**：`src/engine/map-repository.ts:134` = `96239876…0d5b`，即 schema.json 规范化 JSON（递归键排序、紧凑序列化）的 SHA-256，由 `tests/map-repository.test.ts:120` 钉死；subagent 用仓内 `canonicalJson/sha256Text` 与独立 Python 复算双双一致。
- **编辑器 schema 同步且字节稳定**：`bun editor/gen-assets.ts` 跑后 `git status --short` 为空。
- **Sunstone bundle 预算**：共享 JS 440,370 → 449,037 B（+8,667 B），预算上调为 `<456,000`（`tests/sunstone-game-sim.test.ts:418-424`）；battle UI 特征字符串缺席检查仍在（`tests/battle-ui-bundle-isolation.test.ts:55-71`）；增量与 interpreter/save-validate 约 500 行新增共享代码相称。
- **QuickJS 无新增每 tick 负担**：extChoice 路径只在 `f.mode === "choices"` 且当前指令为 extChoice 时到达；静态 choices 项目走 `if` 分支短路；`modalChanged` 新增比较只在 React UI 侧调用；`cloneModal` 新增为快照时一次性。打开中的每 tick provider 调用是设计本身，且 provider 无 RNG。
- **无 fleet 任务号、bun.lock 不改、不 push**：均核实。

## 七、阻断项

无。

## 八、非阻断观察（供后续任务参考）

1. `interpreter.ts:2062-2067` 的「空列表首次出现行 → displaced 一帧」分支无直接测试（键消失的 displaced 路径有覆盖）。
2. 报告缺 `trading.py` 映射（见第五节）；`get_player_monster` 的 MonsterMenuState 视觉降级未像 choice_monster/choice_npc 那样显式标注。
3. `choice_monster`/`choice_npc` 上游对选项参数做 `TextFormatter.replace_text` 后再拆分，接入时 provider/resolver 应保留这一步。
4. `modalChanged`（`interpreter.ts:666-677`）对 `keys`/`enabled` 只比内容不比长度；实践中两者长度恒等于 `options.length` 而 options 长度有比较，故无实际漏洞，仅属脆弱写法。
5. `findings/KC1.md` 为中文，与仓内其余英文文档风格不一致（不影响任何验收项）。

## 门禁复跑记录（主 agent 亲自执行）

| 命令 | 结果 |
| --- | --- |
| `bun run build:example` | exit 0（全部 examples、editor、fixtures 构建完成） |
| `bun test` | 960 pass / 0 fail / 469,446 expect / 62 files（92.06s） |
| `bunx tsc --noEmit` | exit 0 |
| `bash tools/pr1-equivalence.sh` | `PASS scenarios=37 states=12376` |
| `git status --short`（门禁后） | 空；`bun.lock` 未改 |

subagent 使用：4 个 / A=语义契约 12 项逐条核对 + 2 个隔离变异（均变红）、B=两张 PNG 肉眼+像素级测量与像素断言辨识力分析、C=Tuxemon 6 个 Python action 与 callsite 对照、D=goldens/schema hash/编辑器字节稳定/bundle 预算/卫生/QuickJS 每 tick 负担静态检查 / 并行节省了时间，主 agent 逐行读核心 diff、亲自复跑全部门禁并下最终判定。

PASS
