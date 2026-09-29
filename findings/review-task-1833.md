# 审查 G6（task 1833）：第一个可玩里程碑

审查人：task 1838（claude-p）。被审分支 `fleet/task-1833`，提交 `ea41b09..1852615`（6 个），基线 `ba8800f`。
子模块 `vendor/pocket-rpgkit` 仍是 `7cf590c`，未改动。
规格：`game-G6-playable.md`、`review-G6-extra.md`、`reviewer-generic.md`（`/var/tmp/fleet-specs/pocket-tuxemon/`）。
临时脚本、日志、构建产物在 `/var/tmp/fleet/1838/`。关键证据图和可复用探针拷贝在 `findings/review-task-1833/`。

## 结论先行

1. **阻断 B1：游戏里所有 NPC 都画在当前地图的原点 (0,0)，不在它们的实际位置。**
   - 走路、说话、剧情的逻辑都对（reducer 里 NPC 的位置和对话都正确），但画面上 NPC 不在该在的地方。
   - 维护中的 journey 里，和妈妈说话（`spyder_downstairs`）、Dante 的第一只怪兽场景（`spyder_paper_town` 第 1060 帧，Dante 在 (19,13)）时，NPC 都不在自己的格子上。妈妈一直画在左上角的楼梯口。
   - 根因在组件仓 `GameView.tsx:505`：它在 NPC 列表的 `map` 回调里直接读 `npcHeight()`。
     - Tuxemon 的 NPC 刚出生时是「无精灵、高 16」，第一次换成 16×32 行走图时，高度信号一变，所有地图的 NPC 容器整体重建。
     - 而 `onMount` 里预编译的位置批处理（`GameView.tsx:264-267`）还指着已销毁的旧节点。
     - 实测：批处理写的节点 id 全在 6..1560，现存 NPC 节点是 1560..2854（妈妈是 1854），新节点从没收到过 translate。
   - 在组件仓源码的临时副本里只改这一行（改成在 style 里读高度），重建后妈妈、Paper Town 的 NPC 都回到正确格子上，因果成立。
   - builder 的三张 golden 都没把原点拍进画面，也没有任何针对 NPC 的断言。它的「与原作对照」明说**不比较**人物叠层，所以没发现。
2. **其余交付大体成立，数字都能复现**：
   - 导入两遍无 diff；完整资源树两遍一致，2,388 个文件、46,435,818 字节、`e654c20f…`，与报告一致。
   - `bunx tsc --noEmit` exit 0。
   - `bun test` 32 pass / 0 fail / 40,148 个断言。
   - 覆盖率前后对照逐项相等。
   - 冻结扫描 263 张图 0/0/0。
   - 在**真正的 G6 工程**上复跑 journey：60/30/20/4 Hz 各 12/12，42 个剧情节拍一致，60 Hz 结果哈希等于维护中的 tape（`67e9ed90…`）。
   - 网页版 headless Chrome PASS；desktop `--build-only` 通过。
   - QuickJS 数字在 ±10% 内复现。
   - 4 个变异都会打红对应测试。
3. **额外核对**：
   - (1) golden 里「看不见玩家」：是被上层（便利店屋顶）遮住的，相机对准了、渲染也没缺，而且 Tuxemon 在这一格画出来也一样（见 §4.1）。但抽样的 13 个位置里还有两类与原作不一致：遮挡模型、人物前后顺序。另外 B1 使 NPC 的遮挡关系没法与原作比。
   - (2) 「只有锁没有解锁就补解锁」只影响 1 张图 1 个事件。原作里这个锁本来就解不开（Tuxemon 换图不清锁）；补了也不改变实际体验。这条规则可以保留，但它**不足以**保证「任何锁都有解锁路径」：Xero 线 `route1` 仍有一处永久锁死（非阻断 N1）。
   - (3) 18 MB 的 JS 和约 1 s 启动都能复现。其中 58.6% 是空白：工程 JSON 被打包成缩进的对象字面量。QuickJS 开机堆 41 MiB。数据应该挪进 pak、按图加载（给后续性能任务）。
   - (4) 四项都已复跑，结果见上。
   - (5) 没有逐图、逐角色补丁；`vendor/` 未改。

判定：**FAIL**（阻断 B1）。

## 阻断项

### B1：NPC 与静态物件都画在地图原点，不在实际位置（组件仓 `GameView` 缺陷，G6 未发现）

- **现象**：
  - 从 `spyder_downstairs` 开局 40 帧：reducer 里妈妈在 (6,6)，画面上她在 (0,0)，头伸出地图上沿。
  - Paper Town 开局：reducer 里 Dante 在 (15,8)、摇滚猫在 (24,2)，这两处什么都没有；左上角原点叠着一个 NPC。
  - journey 第 1060 帧（Dante 对话场景）：Dante 在 (19,13)，画面上那一格是空的。
  - 证据图：`findings/review-task-1833/npc-origin-bug.png`（左：journey f1060，红框是 Dante 的 reducer 位置；右：妈妈，黄框是实际画出的位置）。
- **根因**：
  - `vendor/pocket-rpgkit/src/ui/GameView.tsx:501-515` 的 NPC 列表在 `map` 回调里读 `npcHeight()`。第 505 行 `const h = npcHeight()[slot.key] ?? 16`。
  - 任一 NPC 高度从 16 变成 32（Tuxemon 生成器的 NPC 都是「第 0 页无精灵 → 第 1 页 16×32 行走图」），263 个 NPC 容器的子节点就全部重建。
  - 位置批处理 `createJumpBatch` 只在 `onMount` 编译一次（`:256-281`），此后一直写旧节点 id。
  - 插桩结果（`findings/review-task-1833/probe/batchlog.ts`）：每帧批处理 2,580 条记录，节点 id 范围 6..1560；妈妈的现存节点 1854 只收到初始 style（`insetT=-16`），从未收到 translate。
- **因果验证**：
  - 把组件仓 `src` 拷到临时目录（没动 `vendor/`），只改第 505/510 两行：`const h = () => npcHeight()[slot.key] ?? 16`，style 里用 `h()`。
  - 重建后，同样的开局下妈妈画在 (6,6)，Paper Town 原点不再有 NPC，NPC 出现在各自格子上。
  - 对比图：`findings/review-task-1833/npc-fix-compare.png`（左：现状；右：一行修复）。
- **为什么是 G6 的阻断**：
  - 规格要「NPC 在场会说话会走」「角色：玩家与 NPC 用 16×32 行走表」「画面必须肉眼核对、与原作对照」。
  - 报告写「places Tuxemon NPC/player art」「visual acceptance …」，但 golden 选的三帧都拍不到原点；`tests/g6-golden.test.ts` 没有一条 NPC 断言；与原作对照时明说「expected difference is the runtime's player/NPC overlay」。
  - 结果是一个肉眼一看就不对的里程碑，却全部测试通过。
- **修复路径**：
  - 缺陷在组件仓，应在组件仓开任务：`GameView` 不在列表映射里读会变的信号，或在节点重建后重编批处理。
  - 加回归测试：NPC 从无精灵页切到 32 px 行走页之后，节点位置仍等于它的格子；用 sim 像素或树检查。
  - 合并、bump 子模块之后，G6 再补一张拍到 NPC 的 golden（例如 journey f1060 的 Dante），加像素断言。

## 1. 规格逐条

| # | 要求（`game-G6-playable.md`） | 判定 | 证据 |
|---|---|---|---|
| 0.1 | 非阻断 1：开 `areas` 时保持同格叠放的「先锁存各自匹配、再依次执行」 | 成立 | `importer/project.ts:1270-1348`：按成员签名分区，多成员区先写 `local.area.*` 标记再执行各自 body。测试 `importer.test.ts` "partitions overlaps…"；变异 M1 变红（§3）。journey 断言 "the overlapping Paper Town strip kept mom's quest" 在 G6 工程上 4 个频率都过 |
| 0.2 | 非阻断 2：`tuxe_mart_taba` "professor pls" 截断修好；任何锁都有解锁路径 | 部分 | 截断修好：`project.ts:1136-1158`，阻塞型 spawn 页不再把守卫放在页条件上；测试 "a blocking spawn cutscene…" 两句台词都出现、`v.proftalk2` 已写、`inputLocked=false`；变异 M2 变红。「任何锁都有解锁路径」不成立：`route1` "battle!" 永久锁死（N1，Xero 线，不在 G6 可达范围） |
| 0.3 | 非阻断 4：默认字节测试改成真对比 | 成立 | `tests/importer.test.ts:234-240` 钉 SHA-256 `36fa563f…`。变异 M4（默认 `areas:true`）变红 |
| 0.4 | smoke 在出口垫上先转向；按 frozenk1 方法全图冻结扫描 0 永久锁死 | 成立（有保留） | `tools/smoke-spyder.ts:218,240`。`tools/frozen-k1.ts` 复跑：263 张图，0 锁、0 阻塞、0 错误（61 s）。我的更严版本（任意地图上最后 6,000 帧从没拿到控制权）也是 0。保留：这类扫描只从一个落点乱走，碰不到大多数锁点，也数不出无限对话循环（N1、N7） |
| 1 | `applyTerrain` 接进管线；14 个带 label 的碰撞格物化为可移除事件，接上 `remove_collision`；一条命令产出全部；两遍无 diff | 成立 | `gen-assets.ts:19-27`；`bun run import` 和 `gen-assets` 都是 `bun gen-assets.ts`。测试 "all 14 labelled collision cells…"：14 个事件，第 0 页阻挡，第 1 页不阻挡，受 `local.collision.*` 控制；`remove_collision` 5 次都算 native。两遍导入 `dist/project.json` 都是 `8c388b45…`，受版本控制的树干净；`verify:g6:determinism` PASS，2,388 个文件、46,435,818 字节、`e654c20f…` |
| 2 | 打开 K1 六个开关（`routes` 关）；覆盖率前后对照 | 成立 | `project.ts:83-91`（`K1_IMPORT_OPTIONS`）；`gen-assets.ts:20`。我复算两套配置，与报告表格逐项相等（§2） |
| 3 | 玩家与 NPC 用 16×32 行走表；动画瓦片接 R2 `animated` | 部分 | 素材烘焙成立：152 张行走表、22 个静态物件、1 个缺图占位；5,785 处动画、86 张图集。玩家 16×32 成立：卧室 golden 里玩家图与 `player-adventurer-idle-2.png` 在 (216,128) 逐像素相等。动画成立：Paper Town 第 5 帧与第 47 帧相比，花和便利店招牌在变。**NPC 画错位置**（B1） |
| 4 | `pocket.json`、`main.tsx`、`tools/build.ts`、`tools/desktop.ts`；desktop 能开窗；web 能出页；开局直接进 Spyder | 部分 | 文件都在。`bun run desktop --build-only` exit 0（需要把 `~/.cargo/bin` 放进 PATH）。无显示器，开窗没法验证，builder 也没验证。`bun run web` 加 `web:verify` 都 PASS。开局直接进 `spyder_bedroom`，报告写明了跳过选剧本菜单 |
| 5 | 确定性 sim：卧室到 Route 1，覆盖对话、传送、第一场战斗占位、商店（可占位）；60/30/20/4 Hz 一致；两遍哈希一致；golden 加语义断言，肉眼看 | 部分 | 在 G6 工程上复跑 4 个频率都成立，两遍哈希一致也成立（§2）。但 `bun test` 里的多频率测试跑的是 G1 工程（N2）。商店没有占位：`open_shop` 28 次全丢，journey 里只有 Paper Scoop 的剧情对话（N5）。golden：Paper Town 那张没有玩家断言，三张都没有 NPC 断言（B1、N3） |

| 验收数字 | builder 报告 | 我复跑 | 判定 |
|---|---|---|---|
| 地形 pak / gzip | 21,575,296 / 2,358,327 | 同（`gen-assets` 输出） | 成立 |
| 应用 pak / gzip -9 | 26,266,544 / 2,541,521 | 26,266,544 / 2,545,623（zlib level 9） | 成立 |
| `pocket-tuxemon.js` | 18,153,966 | 18,153,966 | 成立 |
| 启动到首帧 480×272 / 960×544 | 913.6 / 914.0 ms | 1,032.7 与 980.3 / 964.5 与 974.9 ms | 成立（约 +5–13%） |
| 走路 QuickJS p95 / max（480） | 18.01 / 22.76 | 17.41 / 25.61；17.35 / 22.54 | 成立 |
| 走路 QuickJS p95 / max（960） | 18.20 / 22.90 | 17.89 / 21.84；17.88 / 24.50 | 成立 |
| 切图 QuickJS p95 / max（480） | 22.16 / 227.54 | 25.35 / 242.70；22.91 / 227.83 | 成立 |
| 切图 QuickJS p95 / max（960） | 19.36 / 230.74 | 23.15 / 226.81；21.66 / 252.06 | 成立 |
| 覆盖率前后 | 见报告表 | 逐项相等 | 成立 |
| journey 检查点 | 12 条断言、3 个关键帧 | 同 | 成立 |
| 网页 headless Chrome | PASS | PASS（30 个请求，控制台干净，子路径在跑） | 成立 |

## 2. 门禁复跑（命令与输出）

- `bun run import`，跑两遍：
  - 两遍 `git status` 都干净。
  - `dist/project.json`、`import-report.json`、`variable-enums.json`、`ui/game-assets.ts`、`ui/terrain-assets.ts`、`assets/**` 的哈希两遍相同。
  - 项目哈希 `8c388b4566ab…`。
- `bun run verify:g6:determinism`：`G6 determinism: PASS files=2388 bytes=46435818 sha256=e654c20f181f…`。
- `bunx tsc --noEmit`：exit 0，10.2 s。
- `bun test tests/`：`32 pass / 0 fail / 40148 expect() calls`，30.4 s。
- `bun tools/frozen-k1.ts`：`263 maps; 0 permanent input locks; 0 permanent blocking fibers; 0 errors`。
  - 我的 `probe/frozen2.ts`（16 分片）：flagged 0。
- G6 工程上的 journey（`gen-assets` 之后跑 `HZ=… bun tools/smoke-spyder.ts`）：

  | Hz | 帧数 | PASS | 结束位置 |
  |---|---:|---:|---|
  | 60 | 1,684 | 12/12 | `spyder_route1 @14,19` |
  | 30 | 946 | 12/12 | 同上 |
  | 20 | 688 | 12/12 | 同上 |
  | 4 | 334 | 12/12 | 同上 |

  - TEXT、PICK、MAP 节拍 42 条，4 个频率完全相同；`story` 字段相同。
  - 60 Hz 结果 `sha256 67e9ed90…`，等于 `data/g6-journey.json`，masks 完全相同。再跑一遍 60 Hz，哈希不变。
- `bun run desktop --build-only`：exit 0。`bun run web`、`bun run web:verify`：`web-verify: PASS`。
- 覆盖率（`probe/coverage.ts`，两套配置都 `buildProject(availableMapIds())`）：
  - 默认：动作 native 6,161（45.2%）、degraded 2,822、占位 433、丢弃 4,201；条件 native 3,529（40.7%）、degraded 1,238、占位 850、丢弃 3,046；可执行比例 69.1% / 64.8%。
  - K1：动作 native 8,346（61.3%）、degraded 637、占位 433、丢弃 4,201；条件 native 5,749（66.4%）、degraded 12、占位 850、丢弃 2,052；可执行比例 69.1% / 76.3%。
  - 两套 schema 错误都是 0。

## 3. 变异检查（改坏、跑对应测试、还原；还原后 `git status` 干净）

| # | 改动 | 结果 |
|---|---|---|
| M1 | 多成员区改成「逐个守卫、逐个执行」，不先锁存（`project.ts` 分区分支） | "partitions overlaps…" **变红** |
| M2 | `const blocking = hasBlocking(cmds) && false`（撤掉阻塞型 spawn 修复） | "a blocking spawn cutscene…" **变红** |
| M3 | `if (mapHasLock && !mapHasUnlock && false)`（撤掉补解锁） | "K1 appends a safety unlock…" **变红** |
| M4 | 默认配置 `areas: true` | "defaults preserve the v1 output…" **变红**（上一轮这条是恒真式） |
| 反例 | 现状本身：NPC 全在原点（B1） | 32 个测试全绿。golden 和语义断言都覆盖不到 NPC |

## 4. 额外核对

### 4.1 玩家可见性与遮挡

- **golden `g6-paper-town.1373.png`**：
  - 我用构建出的包重放 tape 到第 1373 帧，fnv `f8b80b35` 与 golden 相同。
  - 玩家在 (21,9)，px (336,144)，相机 (104,16)，所以画在屏幕 (232..248, 112..144)。
  - 行走图上 9 行透明，人物在 y 121..142。(21,9) 格的上层有便利店屋顶（`Above Player` 层，253 个不透明像素），盖住 y≥128 的部分；(21,8) 的栅栏在下层。
  - 结果只露出 7 px 高的帽顶（52/177 个精灵像素）。
  - 所以是**被上层遮挡**，相机对准了，渲染也没缺。
  - 原作：(21,9) 在碰撞区外，可以站；Tuxemon 用 `pyscroll.BufferedRenderer(tall_sprites=2)`（`tuxemon/map/tuxemon.py:309-317`），pyscroll 2.31 只在精灵**底部 2 px 所在的那一格**把上层瓦片重画到精灵上面（`orthographic.py:461-520`）。按这个模型合成，这一格同样只露 52 px。**与原作一致**。
  - 问题在于选了这一帧当关键帧，而且 Paper Town 的语义断言根本不检查玩家（`tests/g6-golden.test.ts:74-80`）。
- **13 个位置对比**：
  - 取真实 G6 帧，对比按 pyscroll 模型合成的 Tuxemon 参考帧。我的合成器画 G6 模型时与真实帧一致。
  - 图：`findings/review-task-1833/occlusion-compare-pt.png`、`occlusion-compare-2.png`；数据在同名 `.json`。
  - 一致的位置：
    - 室外开阔处 (5,7)、(14,12)：212/212，一致。
    - 建筑门口 (10,7)、(19,13)：222/222，一致。
    - Route 1 树后 (12,15)、(34,9)：216、177，一致。
    - 仓库屋顶后 (7,9)：106，一致。
  - **不一致一**：脚下没有上层、头顶那一格有上层的格子。G6 用上层把人物**整张 16×32** 盖住；原作只盖脚下那格，头画在上层之上。
    - (24,5)：栅栏压住头，180 vs 212。
    - (20,16)：206 vs 212。
    - 房屋屋顶后 (8,3)、(9,2)：G6 完全看不见（0），原作露出帽顶（46、49）。
    - 这类格子在 Paper Town 可走的 514 格里有 35 格（6.8%）；Route 1 有 2/410，Route 2 有 8/566，Cotton Town 有 12/925，卧室和楼下 0。
    - 统计脚本：`probe/occl_stats.py`。
  - **不一致二**：人物前后顺序。G6 的层级是 NPC 容器在前、玩家在后，所以玩家永远盖在 NPC 上面（`GameView.tsx:495-528`）。pyscroll 同层精灵按 (x, y) 排序，靠下（离镜头近）的后画。
    - 用一行修复的包验证：玩家站在花店店员 (10,14) 正上方 (10,13) 时，G6 是玩家的脚压住她的头发（`depth-north-of-silver.png`）；原作应当是她的头压住玩家的脚。
  - NPC 与上层的遮挡规则与玩家相同（同一层、同一套上层）。但在 B1 修好之前 NPC 不在自己的格子上，无法逐位置比较。
  - 这两类不一致都属于组件仓的渲染规则，不阻断这一轮，记为 N4。

### 4.2 「只有锁没有解锁时自动补解锁」

- **受影响范围**：只有 1 张图 1 个事件：`taba_ba_br_master_foyer:e003_stop_and_talk_r001`（"Stop and talk"）。`dist/import-report.json` 里 `trigger:orphan input lock repair` 计 1。
- **原作语义**：
  - `lock_controls` 压入 `SinkState`（`tuxemon/event/actions/lock_controls.py:27`）。
  - 只有 `unlock_controls`（`unlock_controls.py:28-31`）和钓鱼、露营、无人机几种道具效果会移除它。
  - 传送和换图用的是 `MovementManager` 的锁（`tuxemon/world/transition.py:108-118`），**不清** `SinkState`。
  - 所以原作换图不清锁；K1 反而在每次进图时清锁（`interpreter.ts:523-526`「Per map visit」），比原作宽松。
- **这个事件在原作里本来就是死路**：
  - 踩上去后，锁定、上移 3 格、寻路到 (9,8)，把 `foyer_talk` 设成 `start`。
  - 之后 "wait up"（条件 `foyer_talk:start`，永远不清）会无限重复 `tabawaitup`。`tabawaitup2`、`tabawaitup3` 在 `.po` 里有，但没有地图用到。这是没做完的剧情。
- **G6 的实际行为**（`probe/locktrace.ts`）：补上的解锁在第 29 帧生效，但 "wait up" 自动事件每约 4 帧重放一次「Hey! Red! Wait up!」。体验与原作相同，都卡在这段对话里。
- **判断**：
  - 这条规则按语料统一执行，不是逐图补丁；对唯一受影响的事件没有造成实际的语义损失，可以保留。
  - 但它只处理「整张图都没有解锁」这一种情况，不能保证「任何锁都有解锁路径」。
  - 更贴近原作的做法：把这类原作死路当作「上游软锁」写进报告（像 1828 对 `has_kennel` 的处理），并对每个跨事件的锁做可达检查（见 N1），而不是只看整张图有没有 unlock。
- **全量锁点核对**（`probe/lockfire.ts`）：
  - 对 319 个带 `lockInput` 的页逐个构造满足页条件的状态，触发它，看不按键能不能解锁或传送。
  - 按一只怪兽的队伍：284 个能解锁；25 个我的探针没触发到；5 个在上锁前就传送走了；3 个找不到起点格；2 个锁死。
  - 锁死之一 `taba_ba_br_2` "battle redo" 是探针造的：补上真实前置 `talkedonce=1` 后能正常解锁。
  - 另一个 `route1` "battle!" 是真问题，见 N1。
  - 结果：`findings/review-task-1833/lockfire-party1.json`。

### 4.3 体积与启动

- **可复现**：
  - `dist/linux-app/pocket-tuxemon.js` 18,153,966 字节。
  - 启动到首帧：480×272 为 1,032.7 / 980.3 ms，960×544 为 964.5 / 974.9 ms；builder 是 913.6 / 914.0 ms。
  - 其中 `Runtime::boot`（读入、解析、执行包）占 948–1,017 ms，首帧只有约 15 ms。
- **构成**：
  - `main.tsx` 直接 `import rawProject from "./dist/project.json"`，打包器把它写成**带缩进的对象字面量**：705,447 行，空白字符 10,632,119 个（58.6%）。
  - 压缩后的工程 JSON 只有 7,117,333 字节：`maps` 7,100,281，其中地面 id 数组 3,503,409、事件 2,693,323、通行 868,085。
  - 包 gzip -9 后 788,364 字节。
  - QuickJS 开机堆：used 41.37 MiB、malloc 58.04 MiB、289,406 个对象；走完 journey 后 54.15 / 76.54 MiB、400,954 个对象。
- **建议（给后续性能任务，本轮不阻断，规格没有门槛）**：
  - 应该把工程数据挪出 JS：每张图一个 pak 条目，换图时 `JSON.parse` 字符串（QuickJS 解析字符串比解析字面量快，也不用常驻 263 张图的对象）。
  - 地图 `ground` 数组运行时只用来查通行；可以在烘焙期直接产出通行位图，免掉 3.5 MB 的 id 数组。
  - 常驻数据只留当前图加全局表（items/sprites/commonEvents）。
  - 对 PSP 这是必要条件：41 MiB 的 JS 堆放不进去。
  - 另外 `GameView` 每帧遍历全部 1,288 个 NPC 槽，不在当前图的槽每次都 `events.find`（`GameView.tsx:289-297, 345-352`）。可能是走路 p95 超过 16.7 ms 的原因之一，**未量**，留给性能任务去 profile。

### 4.4 复跑四项

覆盖率前后对照、全图冻结扫描、多 Hz journey、两遍哈希，全部复跑，结果见 §2。
多 Hz 是在 G6 工程上跑的；`bun test` 里的版本跑的是 G1 工程，见 N2。

### 4.5 逐图补丁与 vendor

- `git diff ba8800f..HEAD -- vendor` 为空。两个子模块工作区都干净（`git -C vendor/pocket-rpgkit status`、`git -C …/pocketjs status` 都没有输出）。
- 导入器和生成器的改动里没有地图名或角色名的特判。在 `importer/`、`gen-assets.ts`、`main.tsx` 的 diff 里搜 `spyder_|taba_|tuxe_|mom|dante|billie`：只有测试和基准里的 `spyder_route1` 终点断言，以及玩家外观 `sprites/adventurer.png`（`importer/characters.ts:181`）。
- 后者是 Tuxemon 角色创建菜单的第一个选项（`db/npc/appearance_options.yaml` 的 `white_male`），属于合理的默认值，不是补丁；建议改成从 db 读（N8）。

## 5. 非阻断项

- **N1 `route1` 永久锁死（Xero 线）**。
  - 锁链："battle!" 上锁（`lockInput`）→ "beatomni" 把 `threemusketeers` 设成 yay。
  - 原作里四个 "omnigrunt*move" 事件同时启动。G6 的自动事件一次只跑一个，而 "omnigruntmove" 的 `pathfind` 被丢掉，变成同一帧把 `threemusketeers` 改成 done。
  - 于是 "omnigrunt3move" 永远起不来，`completethis`、`begone`、`left` 一路断掉，"remove xerogrunts2" 的 `unlock_controls` 永远不执行（`probe/locktrace.ts route1 31 25 down action '{"v.whoartthou":5}'`）。
  - `route1` 从 `spyder_bedroom` 按传送不可达（可达 99/263），所以不影响本里程碑，但违反「任何锁都有解锁路径」。
  - 建议：导入器把「条件同时成立的自动事件」建模为并发（例如各自一个 parallel fiber），或在报告里列为已知缺口；把 `lockfire` 式的逐锁检查加进测试。
- **N2 `bun test` 的多 Hz 测试跑在 G1 工程上**。
  - `tests/importer.test.ts:406` 调 `writeImport(…, K1_IMPORT_OPTIONS)`，把 `dist/project.json` 覆盖成**没有地形、没有角色烘焙**的 G1 工程：`sheets` 只有 `tux`，60 Hz 是 1,516 帧，不是 G6 的 1,684 帧。
  - 跑完测试后 `dist/project.json` 就是这个 G1 版本，接着 `bun tools/frozen-k1.ts` 或 `goldens:g6` 就会拿错工程。
  - 我在 G6 工程上复跑 4 个频率都通过（§2），所以只是测试设计缺口。应改成对 `gen-assets` 的产物跑。
- **N3 golden 覆盖面**。
  - Paper Town 那张里玩家几乎看不见（与原作一致，但作为关键帧不合适），语义断言也不检查玩家。
  - 三张都没有 NPC。
  - 建议换成能看见玩家的帧，并加一张有 NPC 的帧（在 B1 修好之后）。
- **N4 遮挡与前后顺序和原作不一致**（§4.1）。
  - 上层盖住整张 16×32 精灵，原作只盖脚下那格，Paper Town 6.8% 的可走格受影响。
  - 玩家永远在 NPC 上面，原作按 y 排序。
  - 属于组件仓的渲染规则。
- **N5 商店没有占位**。
  - `open_shop` 28 次全部 Dropped（`import-report.json`），Paper Scoop 店员 `npc_spyder_shopkeeper` 两页命令都为空，对话没有任何反应。
  - 规格允许 K4 之前用占位，但要有占位，例如可见的「[SHOP] …」。报告如实写了，所以只判部分。
- **N6 性能**。走路 p95 约 17.4–18.2 ms，超过 16.7 ms；切图最坏约 230–250 ms；启动约 1 s。builder 已如实记为技术债。见 §4.3。
- **N7 扫描工具的口径**。
  - `tools/frozen-k1.ts:114-115` 只在玩家仍停在起始图时才算锁死，传送到别处后的锁不算。
  - 「无进展」判据把无限对话循环算作有进展。
  - 报告说「cooked twice in isolated roots」，但 `verify-g6-determinism.ts` 实际是在同一个根目录连续烘焙两次。只是措辞问题。
- **N8 玩家外观写死**为 `sprites/adventurer.png`，建议从 `appearance_options.yaml` 的第一项读。

## 6. 建议的后续任务

1. **组件仓：修 `GameView` NPC 节点与位置批处理脱钩（B1）**。
   - 一行修复已验证有效。
   - 回归测试：页从无精灵切到 32 px 行走图之后，节点位置等于格子。
   - 同时考虑 N4：按 y 给人物排序；上层只盖脚下那一格，或者按行拆分上层。
2. **游戏仓 G6 修复**：bump 子模块；补一张有 NPC 的 golden 并加 NPC 像素断言；多 Hz 测试改为跑 G6 工程（N2）；商店占位（N5）；逐锁检查进测试，并把 `route1` 列为已知缺口或修掉（N1）。
3. **性能任务**：工程数据挪进 pak、按图加载，烘焙期直接产出通行位图，profile `GameView` 每帧的 NPC 循环（§4.3）。

## 7. 复现

```sh
# 在 worktree 根目录；cargo 需要在 PATH 上
bun run import && git status --short          # 空
bun run verify:g6:determinism                  # PASS files=2388 …
bunx tsc --noEmit && bun test tests/           # 0 / 32 pass
bun run import && for hz in 60 30 20 4; do HZ=$hz bun tools/smoke-spyder.ts; done   # 在 G6 工程上跑
bun tools/frozen-k1.ts
bun run build   # dist/main.{js,pak}
# 探针：findings/review-task-1833/probe/。里面的绝对路径指向 /home/tangollvm/.fleet/worktrees/task-1833，换目录要改
bun findings/review-task-1833/probe/lockfire.ts /path/to/dist/project.json   # PARTY=1 表示一只怪兽的队伍
bun findings/review-task-1833/probe/batchlog.ts   # 需要先用 review-main.tsx（§B1 描述）构建出 /var/tmp/fleet/1838/rdist
```

FAIL
