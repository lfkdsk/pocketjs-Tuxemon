# 复审 KF1 修复 1（task 1857）

审查人：task 1861（claude-p）。被审分支 `fleet/task-1854`，修复提交 5 个：`2c7652a`、`cd2f81a`、`708a012`、`75ac3f4`、`891d0f1`。上一轮审查的提交是 `3dbe965`（判 FAIL）。
规格：`kit-KF1-fix1.md`、`review-KF1-fix1.md`、`reviewer-generic.md`，以及原规格 `kit-KF1-characters.md`（均在 `/var/tmp/fleet-specs/pocket-tuxemon/`）。
临时工程、构建产物、日志在 `/var/tmp/fleet/1861/`。探针、变异脚本、原始输出和证据图拷贝在 `findings/review-task-1857/`。

## 结论先行

1. **阻断 1（池节点被帧末 sweep 销毁）修掉了。** 上一轮的三个探针全部复跑。
   - 上一轮的数字先原样复现，说明探针有效：KF1 与基线 852 帧不同；打到已销毁 id 的原生操作 370 次，第一次在 f830。
   - **G6 journey**（遮掉角色框）：修复版与基线只有 115 帧不同，全在 Paper Town。再把基线画在原点的那个 NPC 框也遮掉（基线自己的 B1），**0/1684 帧不同**。与上一轮「KF1 + retain」副本逐帧一致，0/1684。
   - **Paper Town 上下各滚 400 帧**：第 1 行（屏幕 y 16–31）与基线 0 px 差异。KF1 在这一行差 1,081 px。
   - **打到已销毁 id 的原生操作**：journey、Paper Town 滚动、Route 1 滚动三种情况都是 0。
   - **retain/release 成对，没有泄漏**：
     - journey 全程 retain 2 次，池最大 2，retained 集合最大 2。
     - 每一帧都满足：retained 集合 = 池里的节点，且都处于摘下状态（0 次违反）。
     - 卸载 GameView 后 retained 归 0，两个池节点被 sweep 销毁，retain 2 次 = release 2 次。
2. **阻断 2（Sunstone 渲染预算）修掉了。**
   - 先 `bun run build:example`，再 `bun test`：**622 pass / 0 fail / 0 skip**。数目 = 615 + KF1 新增 5 + 本次新增 2。
   - 走路帧：Sunstone 是 1 个 `setPropBatch[18 条]`，没有别的操作（测试预算没改）。G6 journey 里 696 个移动帧**每帧恰好 1 个** batch（KF1 有 312 帧是 2 个）；写 zIndex 的移动帧从 696 帧降到 49 帧。
   - 切图帧：`createNode + destroyNode == 0`，`insertBefore + removeChild == 0`。
   - `setImage` 23 次，逐个节点核对：14 个上层行切片、1 个 ground、7 个 NPC 槽位、1 个玩家。与测试注释的推导「14 × 1 + 1 + 8」一致。注释里有一处归因写错了（非阻断 N3）。
3. **13 个遮挡位置与 pyscroll 参考仍然一致。**
   - 14 张（含花店店员），加 4 个 NPC 同屏的一帧：整个 480×272 视口都是 0 px 差异。输出与上一轮逐字相同。
   - 不遮角色、对整帧哈希：G6 journey 与「KF1 + retain」在 480×272 和 960×544 下都是 **0/1684 帧不同**。所以换成常驻槽位、按签名更新深度之后，角色的画面与上一轮核过的实现完全一样。
4. **QuickJS G6 基准达标**（960×544，release 宿主）。
   - 走路 p95：0.667–0.781 ms（6 次）。切图最大：3.17–4.45 ms。
   - reducer 终态仍是 2,058 B，哈希 `f146882ce7e66055`。
5. **规矩都守住了**：`bun.lock`、`vendor/pocketjs` 没有改动；代码和注释里没有任务号；作者 lfkdsk，没有 AI 尾注。
6. **非阻断项，共 6 条，最要紧的两条：**
   - **N1：G6 每张图都挂着 500 个 NPC 节点。** 修复把角色槽位改成常驻，数量取全项目最大的一张图。G6 里有张测试图 `test_npcs`，500 个角色，所以每张图都挂 500 个 NPC 图片节点。和上限取 17 的对照版相比：
     - QuickJS 堆多 2.4 MiB。
     - 走路 p95 多约 25%。
     - 切图最大时间约为 2 倍。
     - 仍在阈值内。
   - **N2：新写的「只在跨行带或先后改变时才更新深度」没有回归测试。** 变异 M4 把行带从签名里去掉，测试全绿，但 G6 journey 有 200 帧画错。

判定：**PASS**（两个阻断都已修复，验收条件全部满足。非阻断项建议由 commander 另开任务处理）。

## 阻断项

无。

## 1. 规格逐条

### 1.1 `kit-KF1-fix1.md`

| # | 要求 | 判定 | 证据 |
|---|---|---|---|
| B1.1 | 用 `retain`/`release` 保住入池节点，丢弃时 `release`；或者让池节点保持挂载 | 成立 | 两条路都用了。**行和切片**改成按视口大小的取模环，始终挂着（`OccludingUpperLayer.tsx:466` 用 `rows[y % rows.length]` 取行，`:489-494` 挂载时建 `ceil(h/16)+3` 行，`:479` 不用的行只清源、不摘）。**动画节点**摘下前 `retain`（`:187`），出池 `release`（`:414`），卸载时全部 `release`（`:508`）。`node-trace` 显示 20 行、80 个切片（id 511–610）在 1,684 帧里从未被 `destroyNode`，也从未从 root 上摘下（§4.1） |
| B1.2 | 回归测试：Paper Town 式的上下滚 400 帧后第 1 行上层仍在；跨图复用后像素正确；已销毁 id 上的原生操作数为 0 | 成立 | `tests/r2-ui-sim.test.ts:361`（滚 400↓400↑，断言像素）、`:387`（跨图、停 3 帧、回来，断言像素），两条都用 `traceStaleNativeOps`（`:185`）断言 stale 为 0。变异 M1、M2 都能让它们变红（§3） |
| B2.1 | 先 `build:example` 再 `bun test`，不跳过 | 成立 | 622 pass / 0 fail，455,098 个断言，39 个文件，输出里没有 skip（§2） |
| B2.2 | 走路帧只提交一次位置批处理，预算不改；深度只在先后顺序真正改变时更新；相机和角色合进一个批处理 | 成立（有测试缺口 N2） | `steady walking…` 这条测试与基线 `7cf590c` 相同，没改（`git diff 7cf590c..891d0f1` 只动了切图那条）。批处理里依次是相机、玩家、当前图的 NPC（`GameView.tsx:182-191`）。深度签名 = 各角色的「脚底行带」加上 (y, x) 排序（`:102`），签名变了才重写 zIndex（`:256`、`:261`、`:268`）。实测见 §4.3。M3 变红；M4 **不变红**（N2） |
| B2.3 | 切图帧：行和切片保持挂载，只换源；`createNode + destroyNode == 0`；新的 `setImage` 和 counted-ops 上限按实测给出，写明「可见行 × 区块列」的推导 | 成立（注释有一处归因错误，N3） | `tests/sunstone-game-sim.test.ts:337-347`：`setImage` 在 14–23 之间，`createNode + destroyNode == 0`，`insertBefore + removeChild == 0`，total ≤ 33。逐节点核对见 §4.3：23 = 14 + 1 + 7 + 1，33 = 23 + 5 + 4 + 1。M5（按图重挂角色）会让 `createNode + destroyNode` 那条变红 |
| B2.4 | 其余现有测试照旧通过，总数 615 + 新增 | 成立 | 622 = 615 + KF1 的 5 + 本次的 2（`r2-ui-sim` 7→9）。golden 没改（`git diff --stat 3dbe965..891d0f1 -- tests/goldens` 为空）。测试文件里没有 `.skip`/`.only`/`.todo` |
| 验收 | G6 journey QuickJS 不回退：走路 p95 ≤ 1 ms 级，切图最大 ≤ 10 ms | 成立 | §4.5：走路 p95 0.667–0.781 ms，切图最大 3.17–4.45 ms。与同一会话里 KF1 的 0.62 ms 相比，走路 p95 多了 13–25%，全部来自 N1 |
| 验收 | 13 个遮挡位置与 pyscroll 参考仍然一致 | 成立 | §4.4 |
| 验收 | `bun.lock` 不改；`findings/KF1.md` 加「修复 1」一节；每步提交；不 push | 成立 | §4.6；`KF1.md:128` 有「修复 1」一节；本地分支没有 upstream |

### 1.2 `review-KF1-fix1.md`（本次审查的额外核对）

| # | 核对项 | 判定 | 证据 |
|---|---|---|---|
| 1 | 用上轮探针复跑：G6 journey 遮掉角色后与基线逐帧一致；Paper Town 滚动后第 1 行仍在；已销毁 id 上的原生操作为 0；retain 与 release 成对，没有泄漏（统计池大小上限和 retained 节点数） | 成立 | §4.1、§4.2。「逐帧一致」要把基线的 B1 原点框也遮掉才严格成立（0/1684）。只遮角色框时是 115 帧不同，全部是基线把 NPC 画在原点 |
| 2 | 构建后 `bun test` 全过、不跳过；走路一次批处理；切图 create+destroy 为 0；放宽的上限有实测推导和注释 | 成立 | §2、§4.3 |
| 3 | 13 个遮挡位置；QuickJS 复跑一组 | 成立 | §4.4、§4.5（复跑了 12 次） |
| 4 | `bun.lock`、`vendor/pocketjs` 没有改动；没有任务号 | 成立 | §4.6 |

## 2. 门禁复跑（KF1 worktree，HEAD `891d0f1`）

- `bun run build:example`：exit 0，6.9 s。之后 `git status --short` 为空。
- `bun test`：**622 pass / 0 fail**，455,098 个断言，622 个测试，39 个文件，78.8 s。输出里没有 skip。所有变异还原并重新构建后又跑了一次全量：77.99 s，结果相同（`results/bun-test-final.txt`）。
- `bunx tsc --noEmit`：exit 0，3.9 s。加入本报告的 `findings/review-task-1857/probe/*.ts` 之后仍是 0，因为 `findings/` 不在 tsconfig 的 include 里。
- builder 报告的数字全部对得上：622 个测试、455,098 个断言、`dist/sunstone.js` 344,994 B。

## 3. 变异检查

做法：改 worktree 的 `src`，`bun tools/build-example.ts r2-ui sunstone`，跑 `tests/r2-ui-sim.test.ts`、`tests/sunstone-game-sim.test.ts`、`tests/occlusion-depth.test.ts`，然后 `git checkout -- src` 并重新构建。每次还原后 `git status` 都是空的。脚本、diff 和失败摘录在 `mut/`。

| # | 改动 | 结果 |
|---|---|---|
| M1 | `releaseAnimationNode` 去掉 `retain(node)`（`:187`） | **2 条变红**：`keeps pooled upper rows alive…`、`reuses an upper-row pool across maps…` |
| M2 | 在环里重新引入阻断 1：不用的行 `detachNode` 摘下（不 retain），再用时 `insertNode` 挂回 | **5 条变红**：Sunstone 像素哈希、切图预算、产物大小，以及上面两条新测试 |
| M3 | 每个移动帧都重写深度（`reorder ||= …` 改成 `reorder = true`） | **1 条变红**：`steady walking commits one position batch per moved frame` |
| M4 | 深度签名去掉「脚底行带」，只看角色之间的先后顺序（`GameView.tsx:107`） | **全绿（27 pass）**。但把同样的改动编进 G6，journey 有 **200/1684 帧**与修复版不同（f1179–1194、f1197–1380，全在 Paper Town）。例如 f1185，玩家从便利店屋顶后面走过时，整个身子画在了屋顶上面（`crop-m4-1185.png`：左边修复版只露帽子，右边 M4）。见 N2 |
| M5 | 角色子树按图重挂：`<Show keyed when={mapId()}>{(key) => key && <CurrentMapActors…/>}</Show>` | **3 条变红**：切图预算（这一帧 `createNode` 8、`destroyNode` 8）、`rebinds stable actor slots…`、产物大小。第一次我写成零参数的 child，Solid 不会重挂，切图帧的操作与修复版完全相同，所以那次不算数（diff 留在 `mut/m5-invalid-zero-arg-child.diff`）。上一轮的 M1 踩过同一个坑 |

## 4. 额外核对

### 4.1 阻断 1：用上轮探针复跑

**准备。**
- G6 工程拷贝与上一轮相同：`task-1833` 的产物加 `review-main.tsx`。
- `vendor/pocket-rpgkit/src` 分别指向四份用 `git archive` 取出的源码快照：
  - `891d0f1`（fix1）；
  - `3dbe965`（kf1，即修复前）；
  - `7cf590c`（base）；
  - `3dbe965` 加上一轮的 `retain-fix.diff`（kf1r）。与 `/var/tmp/fleet/1856/fix-src` 逐文件相同。
- 用 `tools/build.ts` 重建。之所以用快照，是为了让后面对 worktree 做变异时不会影响这些构建。

**探针。**
- 从 `findings/review-task-1854/probe/` 拷贝，只把 `S` 改成 `/var/tmp/fleet/1861`。
- `journey-masked.ts` 多输出一个 `hashO`：在原来遮掉角色框的基础上，再遮掉世界原点那一个角色框（20×36）。

**G6 journey，遮掉角色框**（`results/jm-compare.txt`）：

| 对比 | 不同的帧 | 说明 |
|---|---:|---|
| kf1 vs base（`hash`） | 852 / 1684 | 复现上一轮：f831–f1683，Paper Town 843 帧、Route 1 9 帧 |
| **fix1 vs base（`hash`）** | 115 / 1684 | 只在 Paper Town，f840–f1673 |
| **fix1 vs base（`hashO`，再遮原点框）** | **0 / 1684** | 剩下的 115 帧全是基线的 B1（NPC 画在原点） |
| kf1 vs base（`hashO`） | 852 / 1684 | KF1 丢行，不是原点问题 |
| fix1 vs kf1r（上一轮「KF1 + retain」） | 0 / 1684 | |
| fix1 vs builder 的 `/var/tmp/fleet/1857/shots/current-journey-masked-480.json` | 0 / 1684 | builder 报告的 SHA-256 `65e56ffe…` 与 `/var/tmp/fleet/1856/shots/fix-journey-masked-480.json` 相同，我核过（`results/journey-json-sha256.txt`） |

**第 900 帧，看了图。**
- `crop-f900-roofs.png`，三张依次是基线、KF1、修复版：
  - KF1 丢了便利店蓝色屋顶最上面一行、「M」招牌顶和仓库屋脊，露出下面的草地和红花。
  - 修复版与基线一样完整。
- `crop-f900-actors.png`：修复版与基线的差异只有金发女孩和桥上的路障。这两个是有精灵的角色，基线把它们画在原点（B1），KF1 和修复版都画在各自的格子上。

**Paper Town (15,5)，按下 400 帧、按上 400 帧**（`results/scroll-edge.txt`，三个版本的路径和镜头完全相同，终点 cam (8,0)）：
- **fix1 vs base 共 453 px**：
  - 屏幕 y 0–15 的 x 0–7 有 111 px，这是原点那个 NPC（B1），镜头 x=8 时它露在左边缘。
  - 其余都在女孩和路障两个角色框里。
  - **第 1 行（y 16–31）0 px。**
- kf1 vs base：第 1 行差 1,081 px，复现上一轮。
- `crop-scroll-pt-row1.png`：KF1 丢了左边房子的屋顶尖、烟囱顶，右边房子的屋脊，右上的栅栏柱；修复版与基线相同。

**打到已销毁 id 的原生操作**（`results/stale-ops.txt`）：

| 场景 | fix1 | kf1（复现上一轮） |
|---|---|---|
| G6 journey | 销毁过 101 个 id，**stale 0** | 销毁 154 个，stale 370（setProp 218、insertBefore 73、removeChild 43、setImage 36），第一次在 f830 |
| Paper Town (15,5) 400↓400↑ | 销毁 0，**stale 0** | stale 48，第一次在 f424 |
| Route 1 (14,10) 400↓400↑ | 销毁 0，**stale 0** | stale 24，第一次在 f432 |

**`node-trace.ts`，环上 100 个节点，1,684 帧**（`results/node-trace-fix1-ring.txt`）：
- 节点是 20 个行 view 加 80 个切片，id 511–610。
- 挂载之后，打到它们的操作只有：
  - `setImage` 284 次；
  - 另有 4 次以行节点为父：f830 两个动画子节点挂到第 10、11 行（`insertBefore(561|566, …)`），f1674 摘下（`removeChild(561|566, …)`）。
- 没有 `destroyNode`，也没有任何环节点被从 root 上摘下。

### 4.2 retain/release 账目（插桩副本）

**插桩。**
- 在 fix1 的构建产物副本里（`probe/instrument.ts`），把以下对象挂到 `globalThis`：PocketJS 的 `retained`、`sweepSet`，上层的 `rows`、`spritePool`，以及 retain/release 的调用计数。
- 我 diff 过，除插桩行以外与原产物字节相同。

**不变式。** `probe/lifecycle.ts` 每帧检查：
- retained 集合 = `spritePool` 里的节点，且都是摘下状态；
- 环上每一行都挂着；
- 每个切片都挂在自己那一行下；
- 挂着的动画节点都没有被 retain。

**结果**（`results/lifecycle.txt`）：

| 场景 | retain 调用 | release 调用 | retained 最大 | 池最大 | 同时挂着的动画节点最大 | 行 / 切片 | 不变式违反 | stale |
|---|---:|---:|---:|---:|---:|---|---:|---:|
| G6 journey | 2 | 0 | 2 | 2（f1674） | 2 | 20 / 80 | 0 | 0 |
| Paper Town 滚动 | 0 | 0 | 0 | 0 | 2 | 20 / 80 | 0 | 0 |
| Route 1 滚动 | 0 | 0 | 0 | 0 | 0 | 20 / 80 | 0 | 0 |

- journey 里池只在 f1674（Paper Town → Route 1）变化一次：两个「above」动画节点入池。Route 1 没有 above 动画，所以 journey 里没有 release。池的上限就是某一帧同时挂着的动画节点数。
- **卸载**（`probe/review-unmount.tsx` + `probe/unmount.ts`：外面套一层 `<Show>`，中途翻转，`results/unmount.txt`）：
  - 在 f1680 卸载（池里 2 个）：
    - retained 从 2 降到 0；
    - 两个池节点都被 `destroyNode`；
    - retain 2 次 = release 2 次；
    - `sweepSet` 为空，stale 0。
  - 在 f900 卸载（两个动画节点挂在行上）：`onCleanup` 先 retain 再 release，也是 2 = 2，retained 为 0。

### 4.3 阻断 2：预算逐操作拆开

**Sunstone**（`probe/sunstone-ops.ts`、`sunstone-window.ts`、`sunstone-transfer-nodes.ts`，与测试同一条 tape、同样包装 ops）：

- **走路中间帧 2**：`setPropBatch[18 条]` ×1，counted ops = 1。
  - 18 条 = 相机 2 + 玩家 2 + 村庄 7 个 NPC × 2。
  - 基线是 `[34 条]` ×1；KF1 是 `[16 条]` 加 2 次 zIndex。
- **切图帧 f87（village → forest）** 共 33 个 counted ops：
  - `setImage` 23：
    - 14 个 `rpgkit-upper-row-N-chunk-K`：森林 18×14 格，整张图只占一个 512 px 区块，14 行 × 1 列；
    - 1 个 ground 图；
    - 7 个 `rpgkit-npc-*` 槽位：村庄 7 个换成森林 4 个，另外 3 个清空；
    - 1 个 `rpgkit-player`。
  - `zIndex` 5：4 个 NPC 加玩家。
  - 4 次几何写入，全都落在 `rpgkit-world-frame`：`insetL=96`、`insetT=24`、`width=288`、`height=224`。这是较小的森林地图居中和改尺寸。**不是**测试注释说的「一个换高度的槽位」（N3）。
  - `setPropBatch[12 条]` ×1。
  - `createNode`、`destroyNode`、`insertBefore`、`removeChild` 都是 0。
  - 切图帧前后几帧：f86 有 1 个 batch 和 4 次 zIndex（角色先后顺序变了）；f88–f90 没有任何操作。
- Sunstone 的角色槽位：村庄 7、森林 4、洞穴 4，所以槽位数是 7（`results/sunstone-slots.txt`）。

**G6 journey 逐帧统计**（`probe/walk-ops.ts`，`results/walk-ops-{fix1,kf1}.txt`）：

| | fix1 | kf1 |
|---|---|---|
| 玩家移动的帧 | 696 | 696 |
| 每个移动帧的 `setPropBatch` 数 | **1 个：696 帧** | 1 个：384 帧；2 个：312 帧 |
| 有 zIndex 写入的移动帧 | **49** | 696 |
| 玩家没动、却写了 zIndex 的帧（NPC 在走） | 31 | 343 |
| 5 次切图的 create / destroy | 0/0、0/0、0/0、**14/0**、0/0 | 16/1、1/16、2/1、49/2、4/11 |

- f830（进 Paper Town）新建的 14 个节点（`results/f830-creates.txt`）：
  - 3 个 `rpgkit-ground-chunk-*`（流式 ground 层）；
  - 9 个 `rpgkit-anim-below-tile-*`（下层动画）；
  - 2 个 `rpgkit-anim-above-tile-*`（第一次用，池是空的）。
- 前两类属于 KF1 没碰的图层，都是池第一次增长。上层环和角色槽位在 5 次切图里都没有新建节点。

### 4.4 遮挡、B1 与整帧对照

**13 个位置加花店店员，对照 pyscroll 模型**（`probe/occl-capture.ts`、`probe/occl-model.py`，与上一轮同一个模型，`results/occl-model-fix1*.txt`）：
- 14 张帧用两种排序键（pyscroll 的 (x, y) 和规格的 (y, x)），**整个视口 0 px 差异，48×64 窗口也是 0**。
- 4 个 NPC 同屏的 Paper Town 帧（`papertown-spawn-40`）也是 0。
- 输出与 `findings/review-task-1854/occlusion-vs-pyscroll.txt` 逐字相同，与 builder 的 `occl-model.txt` 也相同。
- 14 张截图的帧哈希与上一轮 KF1 的截图 14/14 相同，spawn 那帧也相同。
- 我看过 `fix1-occl-vs-pyscroll.png`（每组依次是实帧、模型、差异，差异全黑）：
  - `pt-behind-roof`、`pt-trees-both` 只露帽顶；
  - `pt-headonly-*` 头画在栅栏上面；
  - `depth-north-of-silver` 店员的头盖住玩家的脚；
  - `r1-open` 里走动的 Bjorn 也一致。

**B1**（`probe/g6-capture.ts`，`results/b1-capture-fix1.txt`）：

| 场景 | NPC | 格子处可见 / 不透明像素 | 原点处 |
|---|---|---|---|
| 楼下开局 | 妈妈 (6,6) | 202 / 202 | 0 |
| Paper Town 开局 | Dante (15,8) | 234 / 234 | 0 |
| 同上 | 摇滚猫 (25,3.875) | 24 / 99（被栅栏挡住，与模型一致） | 0 |
| 同上 | 路牌 | 138 / 138 | 0 |
| 同上 | 店员 | 204 / 204 | 0 |
| journey 第 1060 帧 | Dante (19,13) | 234 / 234 | 0 |

与上一轮 KF1 的数字相同。我看过 `fix1-papertown-40.png`，NPC 都在各自格子上，原点没有 NPC，屋顶完整。

**不遮角色，对整帧哈希**（`probe/journey-full.ts`）：
- fix1 与 kf1r（KF1 + retain）比，**480×272 下 0/1684 帧不同，960×544 下 0/1684 帧不同**。
- 所以常驻槽位换源、深度按签名更新、相机并进角色 batch 这三处改动，画面与上一轮核过的实现逐帧相同，包括 5 次切图之后。

### 4.5 性能（QuickJS）

- 宿主：S3 的 release `rquickjs` 宿主 `/var/tmp/fleet/1839/quickjs-target/release/deps/pocket_desktop_host-4c8f15b5cbdc9e3e`，`g6_quickjs_bench::journey`，960×544。
- 构建产物是我自己重建的（`/var/tmp/fleet/1861/variants/*`）。
- 每次都是 1,684 帧，600 个走路样本、119 个切图样本，5 次传送，终点 `spyder_route1`。STATE_HASH 都是 `f146882ce7e66055`（2,058 B）。
- 原始输出在 `results/g6-*.txt`。

| 实现 | 走路 p95 | 走路最大 | 切图 p95 | 切图最大 | 启动时 QuickJS 堆 / 对象数 |
|---|---:|---:|---:|---:|---|
| fix1，第一组（与 kf1 交替跑） | 0.723 / 0.707 / 0.667 ms | 1.734 / 1.339 / 1.367 | 2.138 / 1.199 / 1.081 | 3.750 / 3.172 / 4.450 | 34.58 MiB / 242,220 |
| fix1，第二组（与 fix1cap 交替跑） | 0.781 / 0.771 / 0.771 | 1.638 / 1.546 / 1.517 | 1.105 / 1.229 / 1.210 | 3.685 / 3.775 / 3.895 | 同上 |
| kf1（修复前，同一会话） | 0.634 / 0.623 / 0.622 | 2.523 / 1.339 / 1.324 | 0.940 / 0.838 / 0.836 | 3.648 / 3.609 / 3.637 | 31.13 MiB / 211,538 |
| **fix1cap**（仅审查用：槽位数上限 17） | 0.616 / 0.609 / 0.629 | 1.523 / 1.188 / 1.410 | 0.654 / 0.630 / 0.672 | 1.863 / 1.831 / 1.799 | 32.16 MiB / 221,451 |
| builder 报告 | 0.792 / 0.685 / 0.752 | 1.914 / 1.268 / 1.850 | 1.802 / 1.088 / 1.307 | 3.764 / 3.646 / 3.691 | — |

- **达标**：走路 p95 ≤ 0.781 ms，切图最大 ≤ 4.45 ms。builder 的数字可以复现。
- `total`（QuickJS 加原生 core 和 draw）的走路 p95：fix1 约 0.74–0.87 ms，fix1cap 约 0.64–0.66 ms，kf1 约 0.64–0.65 ms。
- 终点时的 QuickJS 堆：fix1 37.12 MiB / 264,617 个对象；fix1cap 34.71 MiB / 243,848；kf1 34.12 MiB / 237,702。
- fix1cap 只改了一处：构建产物里 `actorSlotCount` 取 `Math.min(17, …)`。journey 不去 `test_npcs`，所以行为不变，哈希相同。
- fix1cap 走路和 KF1 持平，切图最大还比 KF1 快一倍。**环加换源这个设计本身是更快的。修复版相对 KF1 多出来的开销，全部来自 500 个常驻槽位**（N1）。

### 4.6 规矩

- `git diff --stat 3dbe965..891d0f1 -- bun.lock vendor/` 为空，`7cf590c..891d0f1` 也为空。
- `vendor/pocketjs` 的 gitlink 两边都是 `76ae741f`。子模块 HEAD `76ae741f`，状态干净。
- 新增的代码和注释里没有任务号（`git diff 3dbe965..891d0f1 -- . ':!findings'` 的新增行里 grep 不到）。`findings/KF1.md` 标题里的 task 号属于报告。
- 5 个提交作者都是 `lfkdsk <lfkdsk@gmail.com>`，没有 trailer，提交信息里没有 AI 字样。有一个 `wip:` 提交（`cd2f81a`），规矩允许。
- 本地分支 `fleet/task-1854` 没有 upstream，也没有远端跟踪引用。
- 组件仓里没有 Tuxemon 专用代码。唯一提到 pyscroll/Tuxemon 的仍是 `OccludingUpperLayer.tsx:4` 的来源注释。

## 5. 非阻断项

- **N1 角色槽位按全项目最大的地图常驻；G6 里是 500 个，每张图都挂着，内存和时间开销可观。**
  - `GameView.tsx:336`：`actorSlotCount` = 各图槽位数的最大值。`:153`：挂载时一次建这么多 `image` 节点，之后不再销毁。`:232`：切图帧遍历全部槽位。
  - G6 共 263 张图、1,288 个槽位。`test_npcs`（40×40）一张图就有 **500** 个，第二大的 `route1` 只有 17（`results/g6-slots.txt`）。所以真实游戏里任何一张图都挂着 500 个 NPC 节点（外加 20 行、80 个切片）。
  - 与只改了上限的 fix1cap 对比，同一会话交替跑三次：
    - 启动时 QuickJS 堆 **+2.42 MiB**（+7.5%），**+20,769 个对象**；
    - 走路 qjs p95 约 0.77 ms 对 0.62 ms（**+25%**）；
    - 原生部分（total − qjs）约 0.09 ms 对 0.03 ms；
    - 切图最大约 3.8 ms 对 1.8 ms（**约 2 倍**）。
  - 阈值仍然满足，但 PSP 和网页的内存更紧。
  - 原规格 §0.1 写的是「只挂一个**可丢弃的** `CurrentMapActors` 子树」。修复改成了常驻子树，这是 commander「切图帧 `createNode + destroyNode == 0`」要求的直接后果。可是**按全局最大值、连一张 500 个 NPC 的测试图也算进去**，并不是那条要求逼出来的。
  - builder 报告只写了「批处理不再包含隔离的 500-NPC 压力地图槽位」，没写这 500 个节点常驻的内存和时间成本。
  - 建议改成按需增长的高水位池：开局按起始图建，进更大的图时再补。Sunstone 起始的村庄就是最大的图，那条测试仍是 0；G6 只有进 `test_npcs` 那一次才付 500 个节点。
- **N2 新的深度更新条件缺回归测试。**
  - 深度签名 = 各角色的脚底行带 `floor((y−2)/16)` + (y, x) 排序（`GameView.tsx:102-108`）。其中「行带」这一半没有任何测试覆盖：M4 把它去掉，三个渲染测试文件全绿。
  - 同样的改动放进 G6，journey 有 200 帧画错（§3 M4，`crop-m4-1185.png`）。
  - 13 个位置的测试都是冷启动截图，覆盖不到「走着穿过行边界」。
  - 现在的实现是对的（§4.4 整帧对照 0/1684），但这是本次新引入、专门为省 zIndex 写入加的逻辑，应该补一条测试。例如在 r2-ui 里让玩家向北走进有上层的格子，在跨过行带之后的那一帧断言脚下格被盖住、头露在上面。
- **N3 预算注释和报告有一处归因错误；上限就是实测值，没有余量。**
  - `tests/sunstone-game-sim.test.ts:345-346` 和 `KF1.md` 都说「4 次高度几何写入 / four geometry writes for one height-changing slot」。实际这 4 次写的是 `rpgkit-world-frame` 的 inset 和尺寸，即小地图居中，基线里也有（§4.3）。
  - 「eight persistent actor slots」实际是 7 个 NPC 槽位加 1 个玩家图片。
  - 23 和 33 两个上限正好等于实测值。按规格「按实测给出」可以接受，但以后村庄里多一个 NPC 就得重新量。
- **N4 Sunstone 产物大小预算只剩 6 字节。**
  - `dist/sunstone.js` = 344,994 B，断言是 `< 345,000`（`:413`）。
  - 同一套路径规范下量的：基线 `7cf590c` 331,077 B（余量 13,923 B，约 4.2%）；KF1 343,762 B（+12,685）；`708a012` 344,924 B；修复版 344,994 B（+1,232）。结果在 `results/sunstone-bundle-sizes.txt`。
  - 测试注释说要「keeps a few percent of headroom so an accidental bundle-in still trips it」，这层用意已经没了。M2、M5 这种小改动都会先把它打红。
  - 没发现为了过线而压代码的痕迹（`75ac3f4` 只多了 70 B）。要不要重新定预算，需要 commander 决定。
- **N5 流式地图切图时有重复的 `setImage`。**
  - 过程是：`selectMap → clearTextures` 先对旧的使用者 `setImage(-1)`；`syncTextures` 装新贴图时，`setTexture` 又打给还登记在同一 index 下的旧节点；`syncRows` 做 rebind 时再设一次。
  - G6 f1674 一帧里，环上节点收到 106 次 `setImage`（切片只有 80 个）。
  - 画面正确，切图最大仍 ≤ 4.5 ms。可以在 `clearTextures` 时一并清掉 `textureUsers`。
- **N6 两条新测试的名字和注释还在描述旧的池子。**
  - `keeps pooled upper rows alive…`，以及 `:403` 的注释「Leave any surplus row/slice nodes detached across several sweeps」。环设计里行和切片从不摘下。
  - 这两条测试实际守的是 retain 过的动画节点池（M1）和环一直挂着（M2），两者都能抓到。建议改名，改注释。

## 6. 复现

```sh
# 组件仓门禁（KF1 worktree）
bun run build:example && bun test && bunx tsc --noEmit          # 622 pass / 0 fail / 0 skip
# G6 变体：/var/tmp/fleet/1861/app-{fix1,kf1,base,kf1r,m4}，vendor/pocket-rpgkit/src 指向 git archive 快照
/var/tmp/fleet/1861/build-all.sh fix1 kf1 base                  # main + review-main
bun probe/instrument.ts build-fix1/main.js build-fix1i/main.js  # 插桩副本（retained / 池 / 环）
bun probe/journey-masked.ts {base,kf1,fix1} && bun probe/jm-compare.ts
bun probe/stale-ops.ts fix1 journey; bun probe/stale-ops.ts fix1 scroll spyder_paper_town 15 5 400 400
bun probe/stale-ops.ts fix1 scroll spyder_route1 14 10 400 400
V=fix1 bun probe/node-trace.ts 1683 $(bun probe/ring-ids.ts)
bun probe/lifecycle.ts fix1i journey; bun probe/unmount.ts 1680
bun probe/scroll-edge.ts {base,kf1,fix1} spyder_paper_town 15 5 400 400
bun probe/occl-capture.ts fix1 probe/occl-shots.json && python probe/occl-model.py fix1   # PIL/numpy venv：/var/tmp/fleet/task-1783/venv
bun probe/g6-capture.ts fix1 probe/b1-shots.json
bun probe/journey-full.ts {fix1,kf1r}; W=960 H=544 bun probe/journey-full.ts {fix1,kf1r}
bun probe/walk-ops.ts {fix1,kf1}; bun probe/f830-creates.ts fix1 830
REPO=<worktree> bun probe/sunstone-transfer-nodes.ts
G6_DIST=/var/tmp/fleet/1861/variants/<v> G6_JOURNEY=/var/tmp/fleet/1861/app-fix1/data/g6-journey.json G6_BENCH_W=960 G6_BENCH_H=544 \
  /var/tmp/fleet/1839/quickjs-target/release/deps/pocket_desktop_host-4c8f15b5cbdc9e3e --ignored --nocapture g6_quickjs_bench::journey
mut/run-mutation.sh m1 mut/m1.py   # …m5；每次都会还原 src 并重新构建
# 探针里的绝对路径指向 /var/tmp/fleet/1861 和 ~/.fleet/worktrees/task-{1833,1854}，换目录要改
```

PASS
