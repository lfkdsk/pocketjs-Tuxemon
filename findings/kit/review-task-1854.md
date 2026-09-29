# 审查 KF1（task 1854）：角色渲染重做

审查人：task 1856（claude-p）。被审分支 `fleet/task-1854`，提交 `7cf590c..39d66f6`（6 个），基线 `7cf590c`。
规格：`kit-KF1-characters.md`、`review-KF1-extra.md`、`reviewer-generic.md`（`/var/tmp/fleet-specs/pocket-tuxemon/`）。
临时工程、构建产物、日志在 `/var/tmp/fleet/1856/`。证据图、探针、基准原始输出拷贝在 `findings/review-task-1854/`。

## 结论先行

1. **B1（NPC 画在原点）真的修掉了。**
   - 在 G6 工程（`task-1833` 的产物拷贝，vendor 源码换成 KF1）上重建并截图。三个复现点全部画在正确格子上。
   - 基线同样的截图里，这些 NPC 都在原点。
   - 回归测试能抓住这个问题：变异 M1 让它变红。
2. **N4 遮挡与排序在单角色场景下与 pyscroll 逐像素一致。**
   - G6 审查 §4.1 的 13 个位置，加上花店店员案例，加上一张 4 个 NPC 同屏的帧，都与按 pyscroll 2.30 `_draw_surfaces` 合成的参考帧比较。
   - 整个 480×272 视口 **0 像素差异**。
3. **性能数字可复现**，reducer JSON 与基线一致，旧 golden 的变化都有正当理由。
   - QuickJS：走路 p95 0.566 ms，切图最大 3.24 ms。
   - reducer JSON 2,058 字节，`f146882ce7e66055`。
4. **但有两个阻断项：**
   - **阻断 1：上层瓦片整行消失。** 这是这次改动引入的新渲染错误，真实游戏里一眼可见。
     - `OccludingUpperLayer` 把拆下来的行/切片节点放进对象池，但没有 `retain()`。
     - PocketJS 每帧末的 sweep 会把这些节点在原生侧销毁；之后从池里复用时写的是已销毁的节点 id。
     - 表现：G6 journey 1,684 帧里有 **852 帧**上层与基线不同（不算角色框内的区域）。Paper Town 进图之后，便利店/仓库屋脊、招牌顶都没了。
     - 不换图也会出现：冷启动 Paper Town，往下走到地图边再走回来，顶部第 1 行的屋顶尖、屋脊和栅栏柱就没了。
     - 在副本里补上 `retain`/`release` 后，852 帧降到 115，这 115 帧全部是基线自己把 NPC 画在原点的 B1 差异，上层差异降到 0；打到已销毁节点的原生操作从 370 次降到 0。
   - **阻断 2：两个现有测试挂了。** 这是 Sunstone 的渲染预算测试。
     - 先 `bun run build:example`（审查规范要求），再 `bun test`：618 pass / **2 fail**。基线 `7cf590c` 同样做法是 615 / 0。
     - builder 没有构建示例，103 个依赖构建产物的测试被跳过，所以报告写的是「exit 0」。
     - 规格验收要求「现有测试全绿」。

判定：**FAIL**（阻断 1、阻断 2）。

## 阻断项

### 阻断 1：对象池里的行/切片节点被帧末 sweep 销毁后再复用，上层瓦片整行消失

- **现象**：
  - **G6 journey 第 900 帧（Paper Town）**。基线正常；KF1 第 9 行上层整行没了：仓库屋脊、便利店屋顶最上面一行、「M」招牌顶，露出下面的草地和花。见 `findings/review-task-1854/upper-rows-missing-journey-f900.png`，三张依次是基线、KF1、KF1 加 retain。
  - **逐区块统计**（第 900 帧与基线逐像素比较，按「瓦片行 × 256 px 区块」分）：
    - 第 3 行 c1：266 px。
    - 第 4 行 c1：1,081 px。
    - 第 5 行 c0：10 px。
    - 第 9 行：c0 1,062 px、c1 1,274 px。
    - 第 10 行：c0 26 px、c1 170 px。
    - 探针：`probe/journey-masked.ts`、`probe/diff.py`。
  - **范围**：把每一帧里玩家和所有角色的 20×36 框涂黑，再与基线比较哈希。
    - 1,684 帧里 **852 帧不同**：从 f831（刚进 Paper Town 那一帧的下一帧）到 f1673 的全部 Paper Town 帧，以及 f1675–1683 的全部 Route 1 帧。
    - 卧室、Paper Scoop、楼下全部一致（`journey-masked-summary.json`）。
  - **不换图也会触发**：
    - 冷启动 Paper Town (15,5)，按下 400 帧（镜头到 y=48），再按上 400 帧（镜头回到 0）。
    - 第 1 行上层消失，与基线差 1,081 px：左边房子的屋顶尖和烟囱顶、右边房子的屋脊、右上角的栅栏柱。
    - 见 `upper-rows-missing-scroll.png`。
    - Route 1 上同样的操作，节点树里 `rpgkit-upper-row-1` 和它的两个切片都挂在已销毁的节点 id 上（`probe/stale-rows.ts`）。只是 Route 1 顶部几行在 x<480 内没有上层图，看不出来。
- **根因**：
  - `src/ui/OccludingUpperLayer.tsx` 释放节点时用 `detachNode` 摘下，然后放进池子：
    - `:190/:192`：切片节点进 `imagePool`。
    - `:197/:199`：动画节点进 `spritePool`。
    - `:205/:207`：行节点进 `rowPool`。
  - 需要时再从池里拿：`:337` 取 `rowPool.pop()`，`:372` 取 `imagePool.pop()`，`:403` 取 `spritePool.pop()`。
  - 但 PocketJS 每帧末都会调用 `runSweep()`（`vendor/pocketjs/framework/src/index.ts:292`）。
    - 它会对帧末仍未挂回、且没有 `retain()` 的节点调用 `ops.destroyNode` 并清掉引用（`framework/src/native-tree.ts:384-405`）。
    - 保留节点的正式接口是 `retain`/`release`（`native-tree.ts:361-371`，由 `@pocketjs/framework/renderer` 导出）。
  - 所以同一帧里摘下又挂回的节点能活下来。这正是平滑滚动和同尺寸地图互换的情况，也是现有测试覆盖的情况。
  - 但在较早帧放进池、之后才复用的节点，已经在原生侧被销毁了。复用时对它的 `setProp`、`insertBefore`、`setImage` 全部写到死 id 上，这一行就不画了。
  - 对照：现有的 `AnimatedTiles` 池从来不摘节点，只解绑精灵（`src/ui/AnimatedTiles.tsx:87-90`），所以没有这个问题。
- **插桩证据**（`probe/node-trace.ts`、`probe/stale-ops.ts`）：
  - 行节点 24 在 f578（Paper Scoop 回卧室）被 sweep 执行 `destroyNode(24)`。
  - f830 它被拿来当 Paper Town 第 9 行：`setProp(24, insetT, 144)`、`setProp(24, zIndex, 93585)`、`insertBefore(9, 24)`，都写在死 id 上。
  - 全程打到已销毁 id 的原生操作：
    - KF1 journey：370 次（setProp 218、insertBefore 73、removeChild 43、setImage 36），第一次在 f830。
    - KF1 Route 1 上下走：24 次，第一次在 f432。
    - 加 retain 的副本：两者都是 **0**。
- **因果验证**：
  - 在 KF1 源码副本里只改 `OccludingUpperLayer.tsx`：进池前 `retain(node)`，出池后 `release(node)`。diff 见 `retain-fix.diff`，共 3 处 retain、3 处 release。
  - 重建 G6 之后：
    - 与基线不同的帧从 852 降到 115。剩下的都是基线把 NPC 画在原点（B1），抽查 f845、f1600 确认，差异只在原点格和 NPC 格。
    - 第 900 帧、滚动案例的画面恢复。
    - QuickJS 数字不变：走路 p95 0.608 ms，切图最大 3.343 ms（`bench/g6-fix-960-run1.txt`）。
- **为什么是阻断**：
  - 规格 §2 要求上层「只盖脚下一格」，前提是上层本身画对。这里整行上层丢失，真实游戏里换一次图、或走到地图边再回来就会出现，是比 N4 更显眼的画面错误。
  - builder 的测试没抓到：
    - r2-ui 夹具的两张图行数相同，换图时池子在同一帧内就用完了。
    - 流式滚动测试也是同帧摘、同帧挂。
  - builder 报告写 "Existing residency, upload-budget, scrolling, and map-switch tests remain unchanged"，但没有任何断言覆盖「池节点跨帧复用」。
- **修复路径**：
  - 二选一：进池 `retain`、出池 `release`，卸载时再 `release`；或者像 `AnimatedTiles` 一样让池节点保持挂载、只隐藏或解绑。
  - 加回归测试，二选一：
    - 夹具从上层行数多的地图切到行数少的地图，停至少 1 帧，再切回（或走到地图下边再走回来），断言已知上层格的像素。
    - 在 sim 里包一层 `destroyNode`，断言没有原生操作打到已销毁的 id（`probe/stale-ops.ts` 的做法）。

### 阻断 2：两个现有测试挂了（Sunstone 渲染预算），报告的「bun test exit 0」没有构建示例

- **复跑**：
  - KF1：`bun run build:example`（exit 0，工作区仍干净），然后 `bun test`。结果 **618 pass / 2 fail / 620 tests / 39 files**，455,086 个断言，78.2 s。
  - 基线 `7cf590c`：`git archive` 到 `/var/tmp/fleet/1856/base-repo`，同样的 node_modules 和 vendor，同样先构建示例。结果 **615 pass / 0 fail / 615 tests / 38 files**，与规格说的「当前 615 个」一致。
  - 只跑 `tests/sunstone-game-sim.test.ts`：KF1 14/2，基线 16/0。输出在 `sunstone-sim-kf1.txt`、`sunstone-sim-base.txt`。
- **挂的两条**：
  - `sunstone — fixed transfer tape … > the transfer frame is a bounded image/display burst (R1 measured 1998)`
    - `tests/sunstone-game-sim.test.ts:339` 期望 `setImage <= 4`，实际 33。
    - 同一个测试还要求 `createNode + destroyNode == 0` 和 counted ops < 12。KF1 这一帧是 7 + 8，共 323 个 counted ops。
  - `sunstone — render budget > steady walking commits one position batch per moved frame`
    - `:356` 期望 counted ops == 1，实际 3。
- **逐操作拆开**（`probe/sunstone-ops.ts`，与测试同一条 tape、同样包装 ops）：
  - 走路中间帧：
    - 基线：`setPropBatch[34 条]` ×1。
    - KF1：`setPropBatch[16 条]` ×1，外加 `setProp(zIndex)` ×2。深度按像素编码 (y, x)，每走一个像素玩家和移动中的 NPC 都要改一次 zIndex。
    - 相机也拆成了单独的 batch（`GameView.tsx:461`，角色在 `:270`），相机和角色同时移动的帧会有两次 `setPropBatch`。
  - 村庄→森林的切图帧：
    - 基线 10 个操作：batch 1、setImage 3、display 2、inset/尺寸 4。
    - KF1：setImage 33、removeChild 34、insertBefore 33、createNode 7、destroyNode 8、setStyle 5，以及约 200 个 style setProp（posType、inset、宽高各约 34，overflow 14，zIndex 19）。
- **为什么是阻断**：
  - 规格验收第一条是「现有测试全绿（组件仓当前 615 个）」。
  - builder 的 `findings/KF1.md`「Final verification」写 `bun test: exit 0 … 103 skip (build-dependent suites, unchanged repository convention)`。被跳过的正好包括这两条。
  - 审查规范明确写了组件仓要先 `bun run build:example`。
- **修复路径**：
  - 要么恢复预算：
    - 切图时行节点保持挂载、只换源，不要整池摘挂。
    - 深度只在跨过会改变先后关系的边界时才更新（例如脚底跨过行内第 2 px，或与相邻角色的先后真正改变），不要每像素都更新。
  - 要么在报告里给出量出来的理由，并经 commander 同意后改测试的预算。
  - 行切片设计下，切图帧的 setImage 数至少是「可见行 × 区块列」，原来 ≤4 的预算与这个设计本身冲突，需要明确取舍。
  - 不能让现有测试红着交付。

## 1. 规格逐条

| # | 要求（`kit-KF1-characters.md`） | 判定 | 证据 |
|---|---|---|---|
| 0.1 | 每帧与响应式工作只针对当前地图；只挂一个可丢弃的 `CurrentMapActors`；`MapDef` 按 id 建索引，帧路径不用 `project.maps.find` | 成立 | `GameView.tsx:331` 建 `mapsById`，`:334` 建 `slotsByMap`；`:565` 用 `<Show keyed when={mapId()}>` 只挂当前图的 `CurrentMapActors`（`:164`）；`GameView.tsx` 里已没有 `maps.find`。性能见 §4.3 |
| 0.2 | 每个 NPC 独立的渲染信号 | 成立 | `GameView.tsx:183-184`：每个 NPC 各自一组 image、height 信号，外加 depth 信号。切图最大 3.2 ms（基线 232 ms） |
| 0.3 | 只是表现层，不改 reducer、存档、多 hz | 成立 | `git diff --quiet 7cf590c HEAD -- src/engine`。G6 journey 的 STATE_HASH 在基线、KF1 三次、加 retain 的副本上都是 `f146882ce7e66055`（2,058 B）；20 NPC 夹具两边都是 `89950612ceeabc6f`（4,850 B） |
| 1 | B1 修掉；任何节点重建之后位置批处理都指向现存节点；sim 回归测试（无精灵页切到 16×32 行走页、多 NPC、切图后） | 成立 | G6 三个复现点见 §4.1。节点只在换图时重建，挂载时重新编译 batch（`GameView.tsx:204-226`）。测试 "keeps a page-swapped NPC on its cell…" 和 "rebuilds the position batch against destination-map actor nodes"。变异 M1 变红 |
| 2.1 | 玩家与 NPC 同层按 (y, x) 排序 | 成立 | `OccludingUpperLayer.tsx:54` 的 `actorDepth`。花店店员案例：她的头盖住玩家的脚，与参考帧 0 px 差异（§4.2）。与 pyscroll 的细微差别见非阻断 N2 |
| 2.2 | 上层只盖脚下一格 | 成立（单角色）；**上层本身丢行见阻断 1** | 13 个位置加 2 张多 NPC 帧，与 pyscroll 模型整视口 0 px 差异（§4.2） |
| 2.3 | 按行拆分或脚下格局部重画，先量再选，写出节点数和每帧 QuickJS 开销 | 部分 | 报告给了所选方案的数字（960×544 时 35 行、70 个切片，以及 QuickJS 数字），但没有量另一方案（非阻断 N1） |
| 2.4 | 13 个位置对照测试（或等价夹具），与 pyscroll 模型参考帧像素一致，自己看 PNG | 成立 | 夹具测试 "matches the two-pixel foot model at 13 …" 加 golden `r2-ui.occlusion-reference`。我在真实 G6 帧上逐像素复核（§4.2），图我都看过 |
| 验收 | 现有测试全绿（615 个） | **不成立** | 阻断 2 |
| 验收 | 原有 golden 不变或逐张说明 | 成立 | 5 张变了，每张恰好 104 px，都在 canopy NPC 头部那个 8×13 区域：头顶那格的紫色上层改为画在头后面。看图确认（`golden-walker-down-old-new.png`）。Sunstone 和 streamed 的 golden 没变（测试通过） |
| 验收 | `bunx tsc --noEmit` 0 | 成立 | exit 0，4.8 s |
| 验收 | 多 hz 一致 | 成立 | 60/30/20/4 Hz 的 r2-ui 测试通过（渲染哈希和 state JSON 都比）；engine 没改 |
| 验收 | QuickJS 改前改后对照：夹具（960×544，20 NPC）和 G6 基准；走路 p95 ≤ 8 ms，切图最大 ≤ 50 ms | 成立 | §4.3 复跑 |
| 验收 | 代码和注释无 fleet 任务号；`vendor/pocketjs` 不提交 | 成立 | §4.5 |
| 验收 | 每完成一项就提交；报告 `findings/KF1.md` | 成立（报告有失实处，N3） | 6 个提交 |

## 2. 门禁复跑

- `bunx tsc --noEmit`：exit 0（4.8 s）。加了本报告的探针目录之后再跑一次也是 0：`findings/` 不在 tsconfig 的 include 里。
- `bun run build:example`：exit 0，8.1 s。之后 `git status --short` 为空。
- `bun test`：**618 pass / 2 fail**，455,086 个断言，620 个测试，39 个文件，78.2 s（阻断 2）。
- 基线 `7cf590c` 同法：615 pass / 0 fail，454,975 个断言，615 个测试，38 个文件，75.5 s。
- `git diff 7cf590c..HEAD --stat -- bun.lock vendor/` 为空。两边 `vendor/pocketjs` 的 gitlink 都是 `76ae741f`。`git -C vendor/pocketjs status` 干净。

## 3. 变异检查（改坏、跑 `tests/r2-ui-sim.test.ts` 和 `tests/occlusion-depth.test.ts`、还原；还原后重建 r2-ui，`git status` 干净）

| # | 改动 | 结果 |
|---|---|---|
| M1 | NPC 高度一变就重建节点，即 B1 的形态。`GameView.tsx:288` 改成 `<Show keyed when={npc.height()}>{(h) => <NpcSprite …/>}</Show>` | "keeps a page-swapped NPC on its cell…" **变红**（节点 id 期望 16，实际 667）。第一次我用了零参数的 child，节点其实没有重建，测试全绿；那次不算有效变异 |
| M2 | `upperRowDepth` 返回 2³¹−1，即整层上层盖住所有角色（改前的行为） | 4 条**变红**：depth 模型、animation frame 6 golden、walker goldens、13 个位置 |
| M3 | `actorDepth` 只看 x | 5 条**变红**，包括 "orders actors lexicographically by (y, x)…" 和 13 个位置（南北重叠那一格） |
| 反例 | 现状本身：池节点被 sweep 销毁（阻断 1） | 这两个文件全绿，没有断言覆盖跨帧复用 |

## 4. 额外核对

### 4.1 B1 在 G6 上真的修掉了

- **做法**：
  - 把 G6 工程（`~/.fleet/worktrees/task-1833`，只读）的产物拷到 `/var/tmp/fleet/1856/app-{kf1,base}`。
  - `vendor/pocket-rpgkit/src` 分别指向 KF1 的 `src` 和 `7cf590c` 的 `src`。
  - `node_modules/@pocketjs/framework` 和 `src` 里的相对 import 解析到同一份 pocketjs（`76ae741f`）。
  - 用 `tools/build.ts` 重建。
  - 另加一个审查入口 `probe/review-main.tsx`，允许 sim 全局变量改写开局位置，并可选地打补丁。
- **截图与统计**：`probe/g6-capture.ts`。
  - 对每个当前图上有精灵的 NPC，按它的 reducer 格子和当前朝向/步态取精灵图，数精灵不透明像素在格子处和原点处各命中几个。
  - 结果在 `b1-shots-{kf1,base}.json`，对比图 `b1-g6-baseline-vs-kf1.png`（左基线，右 KF1，红框是 reducer 格子）。我看过图。

| 场景 | NPC（reducer 格子） | KF1：格子处 / 原点处 | 基线：格子处 / 原点处 |
|---|---|---|---|
| `spyder_downstairs` 开局 (5,4)，40 帧 | 妈妈 (6,6) | **202/202** / 0 | 0/202 / 168 |
| Paper Town 开局 (10,7)，40 帧（见下注） | Dante (15,8) | **234/234** / 0 | 0/234 / 11 |
| 同上 | 摇滚猫（正在走，(25,3.875)） | 24/99 / 0（脚下格是栅栏，与模型 0 px 差异） | 0/99 / 45 |
| 同上 | 路牌 (4,15)、花店店员 (10,14) | 138/138、204/204 / 0 | 0 / 138、43 |
| journey 第 1060 帧 | Dante (19,13) | **234/234** / 0 | 0/234 / 0 |

- 注：冷启动 Paper Town 时 Dante 和摇滚猫的有精灵页都不生效（`local.npc.spyder_dante`、`local.npc.spyder_rockittenfrolicking` 是 0），所以本来就不该画。
  - 我用审查专用补丁（一个并行事件把这两个变量设成 1）让它们出现。
  - 摇滚猫有 frolicking 路线，第 40 帧已走到 (25,3.875)。
  - 这一帧另外与 pyscroll 模型整视口比过，0 px 差异（`occlusion-spawn-vs-pyscroll.txt`）。摇滚猫脚下格 (25,4) 的栅栏按模型画在它上面，所以只露出 24 px。
- journey 里 Dante 在 f1015 直接生成在 (19,13)，摇滚猫全程没有生成（`probe/journey-scan.ts`）。

### 4.2 N4：13 个位置与 pyscroll 模型逐像素对照，花店店员案例

- **模型**：`probe/occl-model.py`，照 pyscroll 2.30 `orthographic.py` 的 `_draw_surfaces` 写（代码在 `/var/tmp/fleet/1838/pyscroll231/pyscroll/orthographic.py:441-520`）。
  - 底图 = ground over upper。
  - 受损格 = 每个精灵底部 2 px 碰到、且格内有上层的格子。
  - 按 pyscroll 的排序键 `(layer, priority, x, y, order)`：先画受损格的下层，再画所有精灵（按 x、y），最后画受损格的上层。
  - ground 和 upper 来自 G6 仓库的独立参考渲染器 `tools/terrain-reference.py`。
- **位置**：G6 审查的 13 个位置，从 `/var/tmp/fleet/1838/shots-pt.json` 和 `occlusion-compare-2.json` 恢复，朝向按精灵像素数反推；加上 `depth-north-of-silver`。都是冷启动截图。
- **结果**：14 张帧全部**整个 480×272 视口 0 像素差异**，48×64 窗口也是 0。加上 §4.1 那张 4 个 NPC 同屏的 Paper Town 帧，也是 0（`occlusion-spawn-vs-pyscroll.txt`）。按 (x, y) 和 (y, x) 两种排序算模型都是 0，这些场景里没有跨列重叠。
  - `pt-behind-roof` (9,2)、`pt-trees-both` (8,3)：G6 原来完全看不见，现在露出帽顶。
  - `pt-headonly-5` (24,5)、`pt-headonly-16` (20,16)：头画在栅栏上面。
  - `pt-open` (7,9)、`r1-behind-tree` (12,15)：脚下那格被屋顶或树盖住。
  - `r1-open` (14,12)：同屏走动的 NPC Bjorn 也一致。
- **花店店员**：玩家 (10,13) 朝下，店员 (10,14)。现在是她的头盖住玩家的脚，与参考帧一致。G6 审查的 `depth-north-of-silver.png` 是反的。
- 对照图 `occlusion-vs-pyscroll.png`（每组依次是 KF1 实帧、pyscroll 模型、差异），数据在 `occlusion-vs-pyscroll.txt`。我逐组看过。
- **半透明上层没有重复叠加 alpha**（`probe/alpha-check.py`、`probe/alpha-compare.py`）：
  - Paper Town 和 Route 1 的上层没有半透明像素，上面的对照不涉及 alpha。
  - Paper Scoop 有 102 个半透明上层像素（α=204），卧室有 18 个（α=63）。
  - 冷启动截图里这 120 个像素，KF1 与基线逐个相同。基线是整块上层只画一次。
  - Paper Scoop 的 102 个都等于「只叠一次」的参考（±1），没有一个等于「叠两次」。
  - journey 里卧室、Scoop、楼下的全部帧，涂黑角色框之后也与基线相同。
  - 行切片的裁剪区互不重叠（`OccludingUpperLayer.tsx:337-352` 的 16 px 行、`overflow: Hidden`），结构上也不会重复画。

### 4.3 性能（QuickJS，S3 的 release `rquickjs` 宿主，960×544）

- 宿主：`/var/tmp/fleet/1839/quickjs-target/release/deps/pocket_desktop_host-4c8f15b5cbdc9e3e`，`g6_quickjs_bench::journey`。
- 包是我自己重建的（`/var/tmp/fleet/1856/variants/*`）。原始输出在 `bench/`。

G6 journey（1,684 帧；600 个走路样本，119 个切图样本；5 次传送；终点 `spyder_route1`）：

| 实现 | 走路 p95 | 走路最大 | 切图 p95 | 切图最大 |
|---|---:|---:|---:|---:|
| 基线 `7cf590c` | 17.793 ms | 21.415 ms | 22.569 ms | 231.971 ms |
| KF1 run1 | 0.563 | 1.185 | 0.742 | 3.239 |
| KF1 run2 | 0.620 | 1.376 | 0.831 | 3.600 |
| KF1 run3 | 0.566 | 1.091 | 0.690 | 3.187 |
| KF1 中位数 | **0.566** | 1.185 | 0.742 | **3.239** |
| builder 报告 | 0.616 | 1.394 | 0.907 | 3.797 |
| KF1 + retain（阻断 1 的修复） | 0.608 | 1.272 | 0.783 | 3.343 |

- 可复现：走路 p95 −8%，切图最大 −15%。都远低于 8 ms 和 50 ms 的目标。
- QuickJS 堆：终点时 34.12 MiB、237,702 个对象；基线是 54.16 MiB、401,041 个对象。

20 NPC 夹具（builder 的 `r2-bench.tsx`，我用自己的 `7cf590c` 源码和 KF1 源码重建；596 个走路样本，16 帧切图窗口）：

| 实现 | 走路 p95 | 走路最大 | 切图 p95/最大 |
|---|---:|---:|---:|
| 基线 | 0.321 ms | 0.345 ms | 0.355 ms |
| KF1 | 0.373 ms | 0.421 ms | 2.798 ms |
| builder 报告（基线 / KF1） | 0.339 / 0.339 | 0.415 / 0.889 | 0.421 / 2.628 |

- 切图帧成本约是基线的 8 倍，与阻断 2 的操作数膨胀一致，但仍远低于 50 ms 的门槛。

### 4.4 确定性与 golden

- reducer JSON 与基线一致（§1 的 0.3 行）。
- 多 hz：r2-ui 的 60/30/20/4 Hz 测试通过。KF1 只改了 `src/ui`、测试和报告，没碰 `src/engine`、`src/data`、`src/host`。
- 旧 golden：5 张各变 104 px，全部在头顶那格；逐张看过，头画在紫色上层前面，更贴近原作。
- 新 golden：`r2-ui.occlusion-reference` 看过。
  - 脚下格有上层的，只露出头。
  - 只有头顶格有上层的，整个人画在上层前面。
  - 南边的绿色角色盖住北边黄色角色的脚。
- Sunstone 的像素 golden（第 2、40、94 帧）没变，测试通过。

### 4.5 规矩

- 新增的代码和注释里没有 fleet 任务号（`git diff 7cf590c..HEAD -- . ':!findings' | grep` 无结果）。
- 提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，没有 AI 尾注。
- `bun.lock`、`vendor/pocketjs` 没有提交改动（§2）。
- 组件仓里没有 Tuxemon 专用代码。唯一提到 Tuxemon/pyscroll 的是 `OccludingUpperLayer.tsx:4` 的来源注释，规则本身是通用的。夹具里的格子名借用了原作位置的名字，属于测试命名。

## 5. 非阻断项

- **N1 「先量再选」只量了选中的方案。**
  - 报告没有给「对脚下格局部重画上层」的节点数和 QuickJS 开销，只论证了行切片不会重复叠 alpha。
  - 阻断 2 暴露的切图操作膨胀（Sunstone 10 → 323 个 counted ops）正好是两种方案取舍的关键数据，应在修复时一并量。
- **N2 多角色场景下与 pyscroll 并不完全等价。报告说 "equivalent to pyscroll's tall_sprites=2 rule" 过于绝对。** 两个差别：
  1. pyscroll 同层精灵的排序键是 `(layer, priority, x, y, order)`，即**先 x 后 y**。规格要求 (y, x)，KF1 照规格做了。两者只在不同列的角色走动中途重叠时有差别。
  2. pyscroll 的受损格上层会压住所有与该格重叠的同层精灵。例如 A 站在 B 正上方一格，A 脚下格的上层也会盖住 B 的头。KF1 只盖脚底行不低于该行的角色，所以 B 的头画在上层前面。
  - 规格的文字（「头顶那格的上层应画在头的下面」）支持 KF1 的做法。建议在报告里写明这两点，而不是说「等价」。
- **N3 报告里测试部分有失实。**
  - 「bun test: exit 0 … 103 skip」是没构建示例的结果。
  - "Existing residency, upload-budget, scrolling, and map-switch tests remain unchanged" 与阻断 2 矛盾：Sunstone 的切图预算测试挂了。
  - 报告写 621 个测试，实测 620 个。
- **N4 B1 回归测试用的是 batch 追踪值和节点 id，不是像素。** 规格允许用节点树断言。M1 证明它能抓住节点重建。可以考虑补一个 G6 式的像素断言。

## 6. 复现

```sh
# 组件仓门禁（在 KF1 worktree）
bunx tsc --noEmit && bun run build:example && bun test          # 618 pass / 2 fail
# 基线同法：/var/tmp/fleet/1856/base-repo（git archive 7cf590c；node_modules、vendor 软链到 KF1 worktree）  # 615 / 0
REPO=<repo> bun findings/review-task-1854/probe/sunstone-ops.ts   # 两个预算帧的逐操作统计

# G6 重建（/var/tmp/fleet/1856/app-{kf1,base,fix}；vendor/pocket-rpgkit/src 分别指向 KF1、7cf590c、KF1+retain）
bun <app>/vendor/pocket-rpgkit/vendor/pocketjs/tools/build.ts <app>/main.tsx --project-root=<app> --outdir=/var/tmp/fleet/1856/build-<v>
# review-main.tsx 同法构建（开局改写和补丁钩子）
bun probe/g6-capture.ts kf1 probe/b1-shots.json                   # B1 三个复现点
bun probe/journey-masked.ts {base,kf1,fix}                        # 1,684 帧涂黑角色框的哈希
bun probe/stale-ops.ts kf1 journey                                # 打到已销毁节点的原生操作数
bun probe/scroll-edge.ts kf1 spyder_paper_town 15 5 400 400       # 不换图的丢行复现
bun probe/occl-capture.ts kf1 probe/occl-shots.json && python probe/occl-model.py kf1   # 13 个位置 vs pyscroll（需要 PIL/numpy 的 venv：/var/tmp/fleet/task-1783/venv）
G6_DIST=/var/tmp/fleet/1856/variants/kf1 G6_JOURNEY=<app>/data/g6-journey.json G6_BENCH_W=960 G6_BENCH_H=544 \
  /var/tmp/fleet/1839/quickjs-target/release/deps/pocket_desktop_host-4c8f15b5cbdc9e3e --ignored --nocapture g6_quickjs_bench::journey
# 探针里的绝对路径指向 /var/tmp/fleet/1856 和 ~/.fleet/worktrees/task-1833，换目录要改
```

FAIL
