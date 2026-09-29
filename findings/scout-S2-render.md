# Scout S2：263 张地图怎么画、怎么打包（测量 → 两方案对比 → 推荐 → 原型）

任务 1783。所有数字都是本机实测（脚本与日志在 `findings/scripts/`、`findings/s2-bench/`，截图在 `findings/s2-shots/`，原型在 `findings/s2-proto/`）。QuickJS 数据来自桌面宿主的真实 `Runtime`（`findings/scripts/s2_bench.rs`，方法同 `/var/tmp/kit-scrub-scratch/run-bench.sh`），密度 1。

## 0. 结论

1. **按图烘焙（现状 ChunkLayer 路线，A）不可行**：263 张图 = 910 张 512² 4444 图片 = **477.1 MB** pak（紧贴 pow2 画布也要 179.0 MB），而且三个宿主都在启动时把全部 `ui:img.*` 上传成贴图（桌面 `pocket-ui-surface/src/surface.rs:194`、PSP `hosts/psp/src/pak.rs:10`、wasm `hosts/web/wasm-ops.js` `uploadPackImages`），网页/PSP 直接出局。
2. **图集 + 节点池（wander 路线，B）能画但代价在节点**：PocketJS 的 image 节点没有图集子矩形（sprite 节点只会自动轮播帧，`engine/core/src/draw.rs:1350-1355`），所以每个唯一瓦片必须是一张独立贴图：5,044 张 → pak **2.89 MB**、启动多花 6 ms，这部分很便宜。贵的是节点：960×544 下 taba_town 要 **4,692 个可见节点**、QuickJS 堆 **27.6 MiB / 22 万对象**、换图一帧 **106–159 ms**、强制 GC 20 ms；480×272 下换图也要 4–16 ms、堆 4–10 MiB。
3. **推荐 H：把现有"烘焙"流水线的产物改存为 CLUT8+RLE 的 `TILESET` pak 条目，运行时按视口流式 `loadTileTexture`，动画瓦片用原生 sprite 节点**。全部地图 pak **≈21.5 MB**（gzip 后 ≈7%，≈1.5 MB 传输），每帧 QuickJS **0.02–0.07 ms**，换图一帧 **0.2–1.3 ms（最坏 3.4 ms）**，堆 **≤1.8 MiB**，常驻贴图 ≤2.1 MB，**像素与 Tuxemon 原作逐点一致**（4 张图 × 2 种视口，除玩家标记外 0 像素差异）。零框架改动：`loadTileTexture / freeTexture / uploadImgEntry` 三个宿主都已原生实现（桌面 `surface.rs:493-516`、PSP `ffi.rs:278,1303-1304`、wasm `wasm-ops.js:157-160` + JS 回退）。
4. **PSP 的瓶颈不是贴图而是 pak 本身**：PSP 宿主把 pak `include_bytes!` 进 .rodata（`hosts/psp/src/pak.rs:1-2`），整个 EBOOT 载入 32 MB 内存，21.5 MB 的地图数据放不下。给了两条路（§3）：瓦片表 + 运行时拼块（QuickJS 桌面实测 1.1–1.9 ms/块，PSP 估 20–50 ms/块）或 PocketJS 加一个原生"拼块"op。**P1 先在桌面 + 网页落地，PSP 单独立项。**

## 1. 素材测量（`findings/scripts/analyze_tmx.py`，31 s 跑完 263 张图）

### 1.1 图层与绘制顺序（这是导入器必须遵守的规则）

- Tuxemon 用 pyscroll 画图，精灵层固定 `SPRITE_LAYER_INDEX = 2`（`tuxemon/map/tuxemon.py:164`）。pyscroll `_draw_surfaces` 按 `(layer, priority)` 排序，瓦片 priority 0、精灵 priority 1，所以 **pytmx 索引 ≤ 2 的瓦片层在角色下面，索引 > 2 的层画在角色上面**（`pyscroll/orthographic.py:441-530`）。
- pytmx 的索引数的是 `<map>` 下所有层类子元素（包括隐藏层与对象层）。263 张图里瓦片层全部排在对象层之前（`Collisions`/`Events` 都在最后），所以索引就是文件里的瓦片层序号；但 **5 个隐藏层照样占索引**。
- **按名字判断会错 48 层**（`findings/s2-bench/tmx-summary.json` `aboveRuleDisagreements`）：五层图里的 "Tile Layer 4"（索引 3）画在角色上面，名字里没有 "Above"。
- 可见瓦片层 1,098 个：每图 3–6 层（中位 4；217 张 4 层、43 张 5 层、2 张 6 层、1 张 3 层）；其中角色下 787 层、角色上 311 层。2 层带 opacity≠1，全部瓦片集都是 16×16（无例外）。

### 1.2 数量

| 项 | 数值 | 备注 |
| --- | --- | --- |
| 地图 / 格子 | 263 / 175,093 | 与 commander 一致 |
| 唯一 16×16 瓦片（按像素去重） | **4,773** | 不透明 1,846，含 alpha 2,927 |
| 含翻转位的唯一变体 | **5,044** | 不透明 1,969 / alpha 3,075；1,031 个格子用了翻转（0.6%） |
| 角色下非空瓦片 / 角色上非空瓦片 | 239,838 / 13,691 | 上层占非空瓦片 5.4% |
| 有上层内容的格子 | **13,320 = 7.6%** | 有地面内容的格子 168,186 = 96.1% |
| 一格里叠 ≥2 层下层瓦片 | 51,325 = 30.5% 的地面格 | 逐格合成去重后：地面 **7,524** 种、上层 **781** 种 |
| 动画瓦片定义（实际用到） | **79**（421 帧，243 个唯一帧瓦片） | 引用到的 .tsx 里定义了 285 个；其中 **156 个"自身贴图 ≠ 第一帧"**，10 个各帧时长不等 |
| 动画格子 | 2,606 = 1.49% | 分布在 206 个 256px 块里；单视口最多 546 格（32×19）/ 924 格（62×36），出现在 tt_searoute1（969 格）、manhattan_beach（643） |
| 每图颜色数 | 252/263 张 ≤ 256 色 | 11 张超（最多 2,713 色，spyder_cotton_artshop）；按 256px 块统计只有 14/1,120 个地面块超 256 色，上层块没有 |
| 512² 块 / 256² 块 | 455（93 张图不止 1 块）/ 1,120（173 张不止 1 块） | 每图 2 层 |

节点数窗口统计（analyzer 对每张图滑动 32×19 与 62×36 格窗口取最大）：按层数节点最多 **1,665 / 4,723**，逐格合成（每格 ≤2 节点）最多 **1,204 / 3,513**。

## 2. 两条路都量了（加上推荐的混合 H）

### 2.1 A：按图烘焙（现状 `tools/lib/chunks.ts` + `ChunkLayer.tsx`）

| 指标 | 数值 | 来源 |
| --- | --- | --- |
| 全部地图 pak（512² 4444 块，与今天相同） | **477,102,080 B** | 910 张 512 KB 图片 |
| 每图紧贴 pow2 画布（最好情况） | 178,978,816 B | 20×20 图 = 320px → 512 |
| 4444 + PackBits RLE | 91,694,774 B | RLE 对 16 位像素几乎不起作用 |
| 构建时间 | PNG 编码 8.17 ms + pak 转换 13.16 ms / 512² 块 → **≈19.4 s**（910 块，不含合成） | `findings/scripts/planA-bench.ts`，Sunstone 3 张图实测 1.8 s |
| 切图 upload | **0 B**（换图只换 `src`），代价是启动时上传全部 477 MB 贴图 | `ChunkLayer.tsx`、三宿主的 feed_pak |

### 2.2 B：图集 + 节点池（wander 路线，原型 `mode=nodes`）

- **"图集"在 PocketJS 里不存在**：image 节点整张贴图就是一帧；sprite 节点由核心按 `(frame - start)/step % frames` 自动轮播，不能钉在某一帧。所以每个唯一瓦片 = 一张 16×16 贴图。若将来有子矩形，按 1,024 瓦片/张算：不透明 1,969 → **2 张 5650**，alpha 3,075 → **4 张 4444**，共 3,145,728 B。
- 现实版 pak：5,044 个 IMG 条目 **2,894,192 B**（573.8 B/瓦片，`findings/scripts/pack-alltiles.ts`）；桌面启动上传这 5,044 张贴图多花 **6.0 ms**（15.3 → 21.3 ms）。
- 节点数（环 = 视口格数 + 3 格 overscan，每层一个环，`s2-proto.tsx` `Ring`）：

| 地图 | 480×272 可见节点 / 创建过 | 960×544 可见 / 创建过 |
| --- | --- | --- |
| classic_gym_pyra 20×20 | 380 / 403 | 403 / 403 |
| taba_town 64×60 | 1,330 / 1,433 | 4,692 / 4,927 |
| buddha_mountain 100×100 | 791 / 806 | 2,798 / 2,799 |

  节点复用：600 帧步行 + 600 帧快滚后"创建过"只比"可见"多 0–8%（槽位按 `x mod W` 复用，只改 translate/src，不建不删）；但**换图要把每个槽重同步**（`ringCells` 2,077–3,942 次 `set`），这就是换图那一帧的代价。
- QuickJS（`findings/s2-bench/nodes-*.log`）：

| 用例 | 480×272（gym / town / buddha） | 960×544（gym / town / buddha） |
| --- | --- | --- |
| 空闲 mean | 0.016 / 0.020 / 0.021 ms | 0.016 / 0.029 / 0.022 ms |
| 步行 1px/帧 mean (p95, max) | 0.021 (0.024, 0.94) / 0.078 (0.35, 5.77) / 0.043 (0.15, 1.50) | 0.016 (0.02, 0.03) / 0.101 (0.05, 4.49) / 0.058 (0.06, 2.00) |
| 快滚 4px/帧 mean (max) | 0.022 (0.17) / 0.157 (1.60) / 0.077 (3.33) | 0.019 (1.56) / 0.175 (4.92) / 0.116 (2.42) |
| **换图那一帧** mean (max) | 4.3 (11.4) / 11.2 (16.0) / 10.4 (17.4) ms | **23.5 (77.8) / 105.9 (159.4) / 89.4 (150.9) ms** |
| 首帧 | 15 / 45 / 25 ms | 17 / 161 / 104 ms |
| QuickJS 堆 / 对象数（结束时） | 4.3 MiB 29k / 9.5 MiB 72k / 6.8 MiB 50k | 13.7 MiB 107k / **27.6 MiB 220k** / 23.7 MiB 187k |
| 强制 GC 一次 | 1.6 / 4.6 / 3.0 ms | 5.8 / 19.3 / 13.7 ms |

- 画质：B 的瓦片贴图是 4444，与原作逐通道最多差 15（`findings/s2-shots/nodes-taba_town-480x272.png` 与 T8 版 126,188 像素不同，平均差 6.1）；要一致得用 8888（pak 翻倍到 ≈5.5 MB）。

### 2.3 H（推荐）：流式烘焙块 + 动画 sprite 节点（原型 `mode=chunks`）

构建：把每图"角色下"各层合成一张地面、"角色上"各层合成一张上层（和今天 `bakeMapChunks` 一样），切 256×256，每图每层一个 `TILESET` pak 条目（CLUT8，共享 256 色调色板，PackBits RLE，全透明块记 absent；>256 色的层拆成每块一条目）。运行时：`loadTileTexture(key, index)` 只解码视口 + 16px 边距内的块，退出视口一块以外才 `freeTexture`（滞回），每个常驻块一个 image 节点；动画格子用 `sprite` 节点（核心自己轮播，JS 每帧不碰）。

| 指标 | 数值 |
| --- | --- |
| 全部地图 pak（像素流） | **21,453,416 B**（256 块）；512 块 22,668,972 B；条目头 + 调色板 + 目录另加 ≈0.6 MB |
| 原型 4 张图 | taba_town 492,339 + 39,429 B；buddha_mountain 718,206 + 1,448 B；taba_house1 8,442 + 2,194 B；classic_gym_pyra 54,286 + 1,088 B；整包 1,685,552 B（含 336 张 B 用瓦片、10 个动画图集、字体） |
| gzip -9 | 1,317,432 → 92,904 B = **7.05%**（xz/zstd 更小）→ 全部地图传输 ≈1.5 MB |
| 构建时间 | T8 索引 + RLE **1.3 ms / 256² 块** → 2,240 块 ≈ 2.9 s（合成 263 张图 Python 31 s） |
| 常驻贴图 | 4–31 块（2 层，含滞回），每块 65 KB，最坏 32 块 = 2.13 MB |
| 节点 | 块 4–31 个 + 动画 sprite 18–59 个（taba_town）；最坏地图 546/924 个 sprite |
| QuickJS 堆 / 对象 | 0.90–1.76 MiB / 2.0k–9.2k |

QuickJS（`findings/s2-bench/chunks-*.log`）：

| 用例 | 480×272（gym / town / buddha） | 960×544（gym / town / buddha） |
| --- | --- | --- |
| 空闲 mean | 0.020 / 0.016 / 0.016 ms | 0.018 / 0.019 / 0.016 ms |
| 步行 1px/帧 mean (p95, max) | 0.020 (0.030, 0.04) / 0.040 (0.114, 0.63) / 0.027 (0.033, 0.35) | 0.017 (0.020, 0.06) / 0.034 (0.043, 0.87) / 0.028 (0.040, 0.50) |
| 快滚 4px/帧 mean (max) | 0.021 (0.04) / 0.068 (1.72, 2 帧 GC) / 0.031 (0.35) | 0.016 (0.04) / 0.044 (1.75) / 0.035 (0.61) |
| 换图那一帧 mean (max) | 0.23 (0.34) / 0.38 (0.49) / 0.47 (1.00) ms | 0.42 (0.97) / 0.86 (1.14) / **1.28 (3.44)** ms |
| 换图上传 | 4 / 8 / 4 块 | 4 / 23 / 20 块 → ≈0.06 ms/块（原生解码 + 上传） |
| 首帧 | 0.4 / 1.3 / 0.4 ms | 0.6 / 3.3 / 1.0 ms |
| 强制 GC 一次 | 0.1–0.5 ms | 0.1–0.5 ms |

wasm/网页宿主没有原生 `loadTileTexture`，走框架的 JS 回退（`framework/src/tiles.ts:95-129`：解析条目 + JS PackBits 解码 + `uploadImgEntry`）：Bun(JSC) 里首帧 11 块 7.8 ms、23 块 14.3 ms，即 ≈0.6 ms/块，之后每帧 0.13–0.26 ms。

## 3. 目标预算判断

| 目标 | A 烘焙 | B 节点池 | H 流式块（推荐） |
| --- | --- | --- | --- |
| 网页首包 | 477 MB，出局 | pak 2.9 MB（8888 则 5.5 MB）+ 数据表 1.5 MB；首帧 15–161 ms | pak ≈22 MB 在内存、传输 ≈1.5 MB（gzip）；wasm 用 JS 回退解码 ≈0.6 ms/块。**可用**；若嫌 22 MB 内存，可按地区拆 pak（框架的 `loadPack` 只能整包替换，需要小改） |
| 桌面 960×544 | 477 MB 内存，勉强能跑 | 换图 24–159 ms，堆 14–28 MiB，GC 6–20 ms，**不推荐** | 每帧 ≤0.07 ms，换图 ≤3.4 ms，堆 ≤1.8 MiB。**推荐** |
| PSP 480×272（32 MB） | 出局 | 换图 4–16 ms×(PSP 慢 15–25 倍) ≈ 60–400 ms，堆 4–10 MiB，GC 2–7 ms×倍数。**危险** | 贴图 ≤2.1 MB、堆 ≤2 MiB 都好，但 **pak 21.5 MB 随 EBOOT 进内存放不下**（`hosts/psp/src/pak.rs:1-2`、`main.rs:554-556`）。需要 §4.4 的第二种"块来源" |

PSP 备选块来源的数字：瓦片表 = 5,044 张 T8 瓦片 1.29 MB + 每层稠密格表 1.49 MB（u16，1,098 层）≈ **2.8 MB**；运行时把 256 个瓦片拼成一个 256² CLUT8 块再 `uploadTexture`：桌面 QuickJS 实测 **1.12 ms/块**（只地面）、**1.87 ms/块**（含带透明的上层，`findings/scripts/compose-bench.js`），Bun 0.33 ms。PSP 按 15–25 倍慢估 **20–50 ms/块**：换图 8 块 160–400 ms（藏在淡入淡出里勉强可接受），滚动进新一行 3 块 60–150 ms（需要 1 块/帧预算 + 更大边距）。干净的做法是 PocketJS 加一个原生 `composeTiles(dst, tiles, cells)` op，那是框架改动，本任务不做，只提案。

## 4. 推荐方案与接口草案

### 4.1 放哪

**通用能力放组件仓**（大地图 / 多地图流式渲染与动画瓦片对任何 rpgkit 游戏都有用）；**Tuxemon 专用的 TMX 解析、图层规则、合成瓦片表放游戏仓导入器**。数据格式 `rpgkit-project/v1` 本身**不用为 P1 改**：导入器把每格"角色下"堆叠合成为合成瓦片（7,524 种）写进 `ground`，上层堆叠（781 种）写进 `upper`，合成瓦片切成 9 张 32×32 格的合成 sheet PNG；现有 `bakeMapChunks` 就能吃。动画需要一个新的、只影响渲染的附加信息（见 4.3）。

### 4.2 组件仓：`tools/lib/stream.ts`（构建期）

```ts
// 输入：bakeMapChunks 一样的 RGBA 块（改为 256px：CHUNK_PX 参数化），输出 TILESET 条目
export interface StreamedLayer { key: string; refs: (string | null)[] /* "ui:tile.<key>#<i>" 或 null=absent */ }
export function encodeStreamedLayer(name: string, chunks: Uint8Array[], cols: number, rows: number,
  opts?: { chunkPx?: number /* 256 */; maxColours?: number /* 256, 超出则按块拆条目 */ }):
  { entries: { key: string; blob: Uint8Array }[]; layer: StreamedLayer; report: { colours: number; split: boolean; absent: number } };
export function streamManifestSource(maps: { id; width; height; ground: StreamedLayer; upper: StreamedLayer }[]): string; // 写 GameAssets.stream 字面量
export function pakManifest(entries): { key: string; file: string }[]; // 写 pak.json（tools/build.ts 已支持）
```

调色板：每条目 256 色（透明 = 索引 0）；层 >256 色时每块一条目（1,120 个地面块里只有 14 个会走到这里）；同层内相同像素流共享字节（`encodeTilesetEntry` 已做）。

### 4.3 组件仓：运行时

```ts
// src/ui/game-assets.ts
export interface GameAssets {
  /* 现有字段不动；有 stream 时 GameView 用 StreamedChunkLayer 代替 ChunkLayer */
  stream?: { chunkPx: number; ground: Record<string, readonly (string | null)[]>; upper: Record<string, readonly (string | null)[]>; columns: Record<string, number> };
  /* 动画瓦片：只影响渲染，不进 reducer */
  animated?: Record<string, readonly { x: number; y: number; above: boolean; sprite: string /* sprites.json 里的图集字面量 */ }[]>;
}
// src/engine/chunk-window.ts（纯函数，可测）
export function chunkWindow(cam: {x; y}, vp: {w; h}, chunkPx, cols, rows, margin): { x0; y0; x1; y1 };
// src/ui/StreamedChunkLayer.tsx：节点池 + loadTileTexture/freeTexture + 滞回 1 块 + 每帧上传预算（默认不限，PSP 2/帧）
// src/ui/AnimatedTiles.tsx：视口 ±1 格内的动画格挂 sprite 节点（frameStep 来自 sprites.json）
```

GameView 的 z 序：ground(stream) → NPC/玩家 → upper(stream)，动画节点分 above=false/true 两个容器分别放在 ground 之上与 upper 之上。原型 `findings/s2-proto/s2-proto.tsx` 的 `ChunkStream` / `AnimOverlay` 就是这两个组件的雏形（含计数器）。

### 4.4 PSP 的"块来源"接口（后续任务）

```ts
export interface ChunkSource { acquire(mapId: string, layer: "ground" | "upper", index: number): number /* texture handle | -1 */; release(handle: number): void }
// 实现 1（P1）：TilesetChunkSource → loadTileTexture   实现 2（PSP）：ComposedChunkSource → 瓦片表 + JS/原生拼块 + uploadTexture(PSM_T8)
```

### 4.5 导入器要遵守的规则（给 S1 / importer）

1. 角色上/下按 **pytmx 索引 > 2**，索引要数上隐藏层；别看名字。
2. 动画格：烘焙进块里的应该是**动画第一帧**（156/285 个定义的自身贴图 ≠ 第一帧），或者干脆把该格留透明由 sprite 覆盖；帧时长不等的 10 个定义用第一帧时长。
3. 翻转位当作独立变体（1,031 格）。
4. 上层 alpha 边缘要保留（T8 索引 0 = 全透明；半透明像素按颜色进调色板，原型逐点一致）。

### 4.6 Builder 拆分与工作量

| # | 仓 | 内容 | 估计 |
| --- | --- | --- | --- |
| B1 | 组件 | `tools/lib/stream.ts` + 单测（解码回环 `packbitsDecode`，字节稳定，>256 色拆分） | 0.5 天 |
| B2 | 组件 | `chunk-window.ts` + `StreamedChunkLayer.tsx` + GameView 切换 + 一个 >512px 的 sim golden + QuickJS bench | 1 天 |
| B3 | 组件 | `AnimatedTiles.tsx` + `GameAssets.animated` + sprites.json 生成 | 0.5 天 |
| B4 | 游戏 | 导入器：TMX → project（合成 sheet、层规则、动画规则、翻转） | 在 S1/导入任务里 |
| B5 | 游戏 | `gen-assets`：263 张图 → TILESET + pak.json + 清单；跑两遍无 diff | 0.5 天 |
| B6 | 后续 | PSP 块来源（JS 拼块或框架原生 op 提案）+ 按地区拆包 | 立项再估 |

## 5. 原型与截图（`findings/s2-proto/`，产物在 `/var/tmp/fleet/task-1783/`）

原型是一个 PocketJS 应用（Solid 入口 + 命令式节点），一个包同时含 `chunks` 与 `nodes` 两种模式，`globalThis.__s2Cmd` 切换模式/地图/滚动，`globalThis.__s2State` 发布计数器；wasm sim 渲染 PNG（`render.ts`），桌面 QuickJS 跑 bench（`s2_bench.rs`）。四张真实地图：室内 `taba_house1`（9×7）、`classic_gym_pyra`（20×20）、城镇 `taba_town`（64×60）、最大野外 `buddha_mountain`（100×100）。

截图（都看过）：

- `s2-shots/chunks-taba_town-480x272.png`、`chunks-taba_town-960x544.png`：城镇的房子、商店、篱笆、树、花田都对；`compare-taba_town-480x272.png` 是 [原型 | Tuxemon 参考 | 差异×8]，差异只有玩家标记那一格。
- `s2-shots/chunks-buddha_mountain-*.png`、`compare-buddha_mountain-480x272.png`：大草地、田、石路、佛像；同样只差标记。
- `s2-shots/chunks-taba_house1-480x272.png`、`compare-taba_house1-480x272.png`：小室内在黑框里居中（GameView 的 letterbox 语义）。
- `s2-shots/chunks-taba_town-occlusion-480x272.png`：玩家站在屋顶下（上层格 (31,8)），标记完全被盖住。
- `s2-shots/nodes-taba_town-480x272.png`：B 模式，肉眼一样，逐像素差在 4444 量化。

语义像素断言（`findings/scripts/compare.py`，参考图由 analyzer 按 TMX 直接合成）：

| 图 / 视口 | 与参考不同的像素 | 标记格以外 |
| --- | --- | --- |
| taba_town 480×272（第 0 帧） | 256 / 130,560 | **0** |
| taba_town 960×544 | 256 / 522,240 | 0 |
| buddha_mountain 480×272 / 960×544 | 256 / 256 | 0 / 0 |
| taba_house1 480×272 / 960×544 | 256 / 256 | 0 / 0 |
| classic_gym_pyra 480×272 | 256 | 0 |
| taba_town 480×272 跑 60 帧后 | 349 | 93（动画到了第 4 帧，正常） |
| 屋顶遮挡 | 标记可见像素 0 / 256（空地 256） | — |

一个坑：动画图集最初用 4444，第 0 帧就有 4,116 像素不一致（正好是挂出来的 18 个 sprite 的格子）；改成 8888（10 个图集各 8 KB）后归零。**块用 T8 是逐点精确的，瓦片/sprite 别用 4444。**

## 6. 复现

```sh
# 素材测量 + 参考图 + 原型导出（需要 venv: Pillow numpy）
S2_ALL_TILES=/var/tmp/fleet/task-1783/alltiles /var/tmp/fleet/task-1783/venv/bin/python findings/scripts/analyze_tmx.py
# 原型资产、包、渲染
bun findings/s2-proto/gen.ts && bun findings/s2-proto/build.ts
bun findings/s2-proto/render.ts --mode=chunks --map=taba_town --w=480 --h=272 --at=400,300 --frames=1 --out=/var/tmp/fleet/task-1783/shots/x.png
/var/tmp/fleet/task-1783/venv/bin/python findings/scripts/compare.py /var/tmp/fleet/task-1783/shots/x.png /var/tmp/fleet/task-1783/ref/taba_town.png 168 172 out.png 400,300
# QuickJS bench：把 findings/scripts/s2_bench.rs include 进桌面宿主 crate 的拷贝（同 run-bench.sh 的做法），然后
bash findings/scripts/run-matrix.sh
bunx tsc --noEmit -p findings/s2-proto/tsconfig.json   # exit 0；根 `bunx tsc --noEmit` 也是 0
```

原始数据：`findings/s2-bench/tmx-summary.json`（总表）、`maps.csv`（每图）、`layers.csv`（每层）、`chunks-*.log` / `nodes-*.log`（QuickJS）。
