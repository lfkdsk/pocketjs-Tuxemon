# Review R1（task 1793）：流式瓦片块——构建期编码 + 运行时按视口加载

审查对象：组件仓 worktree 分支 `fleet/task-1793`，单提交 `4472bbd feat(ui): stream map chunks by viewport`，基线 `5dd48ef`。
规格：`/var/tmp/fleet-specs/pocket-tuxemon/kit-R1-stream.md`；builder 报告：`findings/R1.md`。
审查方法：通读全部 22 个改动文件后，独立复跑门禁、3 项变异检查、两档 QuickJS bench，并肉眼打开两张 golden。

## 一、规格逐条对照

### 要做的

| # | 要求 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | `tools/lib/stream.ts`：RGBA 块 → CLUT8+RLE TILESET 条目，CHUNK_PX 参数化默认 256，透明=索引 0，>256 色按块拆条目，同层相同像素流共享字节，输出 pak 清单与 `GameAssets.stream` 字面量源码 | 成立 | `tools/lib/stream.ts:12`（`STREAM_CHUNK_PX=256`）、`:101-136`（频次优先+ABGR 平局+RGBA 最近色量化）、`:183`（`split = colours > 256`）、`:214-256`（按块拆分，相同 chunk base64 签名共享整条 entry/ref）；同条目内相同索引流共享字节由 pocketjs 既有 `encodeTilesetEntry` 完成（`vendor/pocketjs/framework/compiler/pak.ts:333-368`，streamByContent 去重）；`pakManifest` `:351-368` 按 UTF-16 码位确定性排序，`streamManifestSource` `:298-333` 输出字面量。 |
| 2 | `src/engine/chunk-window.ts`：纯函数算块窗口，可单测 | 成立 | `src/engine/chunk-window.ts:24-64` 半开相机矩形→clamp 后 inclusive 窗口，`:66-89` contains/expand；无 host/UI import；`tests/chunk-window.test.ts` 4 个用例覆盖半开边界、世界边界 clamp、空视口/格网、滞回扩张。 |
| 3 | `StreamedChunkLayer.tsx`：节点池 + load/free，滞回 1 块，每帧上传预算默认不限可配，ground/upper 两层 | 成立 | `src/ui/StreamedChunkLayer.tsx:150-168` 节点池（pool.pop 复用，created 只计新建）；`:191` retention = `expandChunkWindow(nextWindow, 1)`；`:217-224` budget 默认 `Infinity`、可配、0 暂停；`:233`/`:120` loadTileTexture/freeTileTexture；ground/upper 两个实例在 `GameView.tsx` 中分别挂在角色容器之下（`:382-395`）与之上（`:437-450`）。 |
| 4 | game-assets 可选 `stream`；有 stream 用新层，否则旧路径，现有行为/goldens 完全不变 | 成立 | `src/ui/game-assets.ts:40-41` `stream?` 可选；`src/ui/GameView.tsx:382/437` 三元分支，旧 `ChunkLayer` JSX 原样保留；`bake.ts`/`chunks.ts`/`ChunkLayer.tsx` 零改动；既有 golden 文件零改动（`git diff --name-only 5dd48ef..HEAD -- tests/goldens/` 仅两个新增文件）；全量 558 测试通过。 |
| 5 | >512px 地图的测试夹具，sim golden + 语义像素断言，滚动与切图正确 | 成立 | 夹具两张图：wide-field 64×40 tile=1024×640px、violet-harbor 40×36=640×576px（`tests/fixtures/streamed/fixture-data.ts:10-11`），双向 transfer（`:32-58`）；`tests/streamed-game-sim.test.ts:63-97` 对滚动三色块带、magenta 屋顶遮玩家（z 序）、harbor 切图色、玩家可见做 RGBA 像素断言，并额外比整帧 golden/FNV；`:84-85,95-96` 断言滞回/池化/纹理字节；`:100-118` 断言 loadBudget=1。 |

### 验收

| 要求 | 结论 | 证据 |
| --- | --- | --- |
| stream.ts 单测：解码回环、字节稳定、>256 色拆分 | 成立 | `tests/stream.test.ts` 4 用例；解码助手 `:23-47` 真实解析 header/directory 并 PackBits 解回 RGBA（不是自证）；字节稳定我独立复跑（见下）；>256 色用 401 色双层夹具验证拆成两个精确条目。 |
| QuickJS bench：960×544 与 480×272 每帧 JS、切图最坏帧、常驻贴图字节，与 S2 对照 | 成立（含一处噪声差异，见第四节） | 我在真实桌面宿主 Runtime/QuickJS 上复跑两档；harness 为宿主 crate 拷贝 + include 测试（`/var/tmp/fleet/task-1793/host-bench/src/stream_bench.rs`，path 依赖指回本子模块 worktree，未改子模块），预热 8 帧、idle 240、walk 360、30 次双向切图，`guest.frame` 与 `surface.tick` 分别计时，堆读 `JS_ComputeMemoryUsage`。 |
| 现有测试全绿、goldens 不变、tsc 0；README 补节 | 成立 | 见第二、三节；README 新增「Large-map streamed rendering」一节（README.md:314-377）。 |
| 渲染结果自己打开 PNG 看 | 成立 | builder 报告声明已逐张看；我也独立打开两张 golden，见第五节。 |

## 二、门禁复跑（审查者亲自执行）

- `bunx tsc --noEmit` → **exit 0**。
- 字节稳定：连跑两次 `bun tests/fixtures/streamed/gen-assets.ts`，3 个 manifest + 4 个生成资产 SHA-256 与提交版**逐项一致**（hashes 记录在 `/var/tmp/fleet/task-1802/hashes-before.txt` 等三份）。
- `bun run build:example` → exit 0；streamed：3 个 TILESET 原始条目 **18,820 B**、完整 pak **148,528 B**、bundle **297,593 B**，与报告一致。
- `bun test` → **558 pass / 0 fail / 454,618 assertions**（基线 548 + 新增 10），与报告数字一致。
- 新增三文件单跑：`tests/stream.test.ts` + `tests/chunk-window.test.ts` + `tests/streamed-game-sim.test.ts` = **10 pass / 78 assertions，无 skip**（preflight 真实通过，非 describe.skip 兜底）。
- `git diff --check 5dd48ef..HEAD` → clean。

## 三、变异检查（改坏 → 红 → 还原，工作树最终 clean）

1. 滞回 1 块改成 0（`StreamedChunkLayer.tsx:191`）→ sim 测试变红：`created 8→6、frees 2→4、resident 6→4、textureBytes 399360→266240`，精确命中池化/滞回断言。
2. 强制 `split=false`（`stream.ts:183`）→ `stream.test.ts` 2 红：`split` 收到 false（401 色用例与共享块用例）。
3. 半开边界 `ceil(x/s)-1` 改成 `floor(x/s)`（`chunk-window.ts:53-54`）→ `chunk-window.test.ts` 1 红：相机 (256,256) 视口 256² 的精确边界窗口 x1/y1 被多算成 2。

三处均已还原，`git status` clean；断言能抓住对应行为，不是摆设。

## 四、QuickJS 性能复跑

| 指标 | 480×272 报告 | 480×272 复跑 | 960×544 报告 | 960×544 复跑 |
| --- | ---: | ---: | ---: | ---: |
| idle JS mean / p95 / max | 0.081/0.090/0.133 | 0.082/0.088/0.115 | 0.076/0.083/0.099 | 0.085/0.090/0.096 |
| walk JS mean / p95 / max | 0.095/0.109/0.254 | 0.095/0.112/0.255 | 0.092/0.106/0.153 | 0.102/0.112/0.120 |
| switch JS mean / p95 / max | 0.217/0.239/0.242 | 0.240/0.259/0.262 | 0.290/0.363/0.366 | 0.324/0.375/0.378 |
| switch core mean / max | 0.008/0.012 | 0.008/0.016 | 0.013/0.029 | 0.011/0.026 |
| 常驻纹理峰值 | 599,040 B（9 块） | 465,920 B（7 块） | 865,280 B（13 块） | 865,280 B（13 块） |
| 结束 QuickJS 堆 / 对象 | 1.57 MiB / 5,154 | 1.56 MiB / 5,070 | 1.59 MiB / 5,330 | 1.59 MiB / 5,330 |

稳定帧与切图帧 JS 时间两次运行同量级（mean 偏差 ≤0.034 ms），两档最坏帧 0.262 / 0.378 ms 均远低于 S2 原型最坏 1.00 / 3.44 ms，结论成立。

**如实记录的一处差异**：480 档我这次峰值是 7 块/465,920 B，报告是 9 块/599,040 B。原因是 bench 的 walk 段按墙上时间折叠宿主 tick（宿主真实行为，见 context「性能以 QuickJS 为准」），本机负载不同时 360 帧内走到的相机位置不同（终态相机也从 builder 日志的 x=544 变为本次 x≈更靠后但 STATE 记录 x=60 循环态），峰值块数随之变化；960 档两跑逐位一致。这不影响任何每帧 JS 数字与规格结论，报告也已明确声明夹具比 S2 的 23 块最坏用例简单、不代表真实 Tuxemon 地图。

## 五、画面肉眼核对

- `tests/goldens/streamed.scroll.png`（480×272）：深绿竖带（chunk 0，屏幕左 0–40px）+ 亮绿主带（chunk 1）+ 右侧蓝带（chunk 2），符合相机 x=216 时三块并存；中心偏右有 magenta 64×48 屋顶矩形且**盖住玩家位置**，证明 upper 层在角色之上，与 `expectPixel(240,136,ROOF_COLOUR)` 语义断言一致。
- `tests/goldens/streamed.switch.png`：左紫（92,44,132）右青（44,108,148）两个 harbor 块；白色 16×16 玩家（1px 深色边框）在 (40,136) 可见；magenta upper 已随切图释放。与 harbors 像素断言一致。

两张图内容与测试断言、builder 描述三者吻合，不是只钉哈希。

## 六、原则检查

- **通用能力**：`src/`、`tools/lib/` 新代码无 tuxemon/Tuxemon 字样，无夹具地图名/颜色特判（grep 命中仅在 findings 与测试自身）。
- **vendor/pocketjs**：子模块仍钉 `76ae741f`，`git -C vendor/pocketjs status` 干净，父仓提交未触碰 vendor/。
- **提交规范**：作者 `lfkdsk <lfkdsk@gmail.com>`，无 Co-Authored-By / AI 尾注，信息 `feat(ui): …` 符合仓库风格；单提交、未 push。
- 本任务为组件仓通用能力，不涉及导入器/手工产物问题。

## 七、非阻断观察（不影响 PASS，记录给后续任务）

1. `StreamedChunkLayer` 对 `loadTileTexture` 返回 -1 的块会放入 live 且不再重试（`stream.ts` 运行时侧 `:233-240`）。-1 只在 pak 缺条目时发生（构建期错误），静态 pak 下不会自愈需求，可接受；未来若做按需下载 pak 再考虑重试。
2. bench 480 峰值块数随宿主墙上时间波动（第四节），后续真实地图 bench 建议固定帧折叠数或记录相机轨迹，让峰值字节可逐位复现。

## 阻断项

无。

PASS
