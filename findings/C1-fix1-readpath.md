# C1 修复 1：buddha_mountain 首访按读取通路重新归因

基线 `main` = `fe74f41`（C1 + review 之后）。本任务只测量与写结论，
不改实现。评审 B2 指出 C1.md §3 把 43–50 ms 归因给 `JSON.parse` 是错的；本报告把首访拆成
8 段实测，给出正确归因、斜率与改法收益。

## 1. 结论（TL;DR）

buddha_mountain（212,567 B，4 个 64 KiB 分块）首访 `read_parse` 中位 **48.160 ms**（21 reps，
QuickJS 桌面宿主，机器负载 1-min ≈ 15）。去向：

| 阶段 | 中位 ms | 占 read_parse |
| --- | ---: | ---: |
| JS base64 解码（`base64ToBytes`，4 块） | **34.350** | **71.3%** |
| JS ASCII 解码（`decodeMapEntryBytes`） | **12.018** | **24.9%** |
| `JSON.parse`（整文档） | 1.382 | 2.9% |
| 其余（ABI 传输 + 信封解析 + 拼接，含宿主 handler） | 0.750 | 1.6% |

（分解和 48.500 ms，比生产 48.160 高 0.7%。）`JSON.parse` 不是瓶颈（1.4 ms，与评审对照的
1.564 ms 一致）；**瓶颈是 JS 侧两段逐字节循环：base64 解码（34 ms）与 ASCII 解码（12 ms）**。
宿主侧诊断量：整文件读盘 0.089 ms、宿主 handler（盘读 + base64 编码 + 信封 JSON）0.339 ms、
JS 侧观测传输（handler + ABI 跨越）0.444 ms——宿主侧合计不到 1.2 ms。

斜率（最小二乘，4 张图 9.2–212.6 KB）：base64 解码 **0.1654 ms/KB**、ASCII 解码
**0.0577 ms/KB**、`JSON.parse` 0.0067 ms/KB、read_parse 全段 0.2323 ms/KB。

改法收益估算（详见 §5）：

- **组件仓 + 导入器（不改引擎）**：紧凑 ground 编码（`number[]` 紧凑 JSON 实测 32,704 B），
  buddha read_parse 48.2 → ~7.5 ms（−84%）；全图普遍受益。
- **PocketJS 小补丁（走 PR）**：新增 `fs.readText` 类 op，宿主直接返回 JS 字符串，跳过
  base64 编解码与 JS 侧 ASCII 解码，buddha read_parse 48.2 → ~2 ms（−96%）；所有文本文件受益。
- 两者叠加：~0.5 ms。

## 2. 方法

- 探针（已提交，随本报告）：
  - `tools/c1-readpath-entry.tsx`：QuickJS bench bundle，暴露 `__c1ReadBench`，每段一个 eval；
    用的全是生产代码（`readFileSync`、`base64ToBytes`、`decodeMapEntryBytes`、
    `validateMapDefStructure`、`createWorld`、`buildPassage`、`prepareSessionMapStep`、
    `acquireSessionMap`），不是重写。
  - `tools/c1-readpath-bench.rs`：`include!` 进桌面宿主的测试模块；Rust `Instant` 包 eval；
    宿主侧直接调 `FsMount`（与 `globalThis.fs` 闭包共享同一个 `FsModule`）量宿主 handler。
  - `tools/bench-c1-readpath.sh`：驱动（自有 `C1_BENCH_ROOT`，不碰官方 bench 目录）。
  - `tools/c1-readpath-report.py`：聚合 median/p90/min、交叉校验、斜率。
- 地图（大/中/小）：buddha_mountain 212,567 B、taba_town 153,355 B、spyder_paper_town
  61,514 B、spyder_bedroom 9,204 B。
- 21 reps/图；每 rep 前 `JS_RunGC`；session 创建（一次性公共事件编译）在 rep 循环外预热。
- 阶段定义（对应规格）：
  - `disk`：Rust `std::fs::read` 整文件（页缓存下限）；
  - `host`：`FsModule::read` 逐块（盘读 + base64 编码 + 信封 JSON 构造）；
  - `transfer`：JS 侧 `globalThis.fs.read` 逐块（= host + ABI 字符串跨越）；
  - `env_parse`：`JSON.parse` 信封；`b64`：`base64ToBytes`；`concat`：拼接；
  - `ascii`：`decodeMapEntryBytes`（生产走的 ASCII 快路）；`parse`：整文档 `JSON.parse`；
  - `validate`/`world`/`passage`：编译/派生；
  - `commit`：`acquireSessionMap`；`frame1`/`frame2`：commit 后首两帧。
- 交叉校验：重构 `readAll`（transfer+env_parse+b64+concat）对生产 `readFileSync`；重构
  `read_parse`（+ascii+parse）对生产 `prep_parse`；`world`+`passage` 对生产 `prep_compile`。

## 3. 读取通路代码定位

生产路径（桌面宿主，`fsHost()` 非空）：

1. `main.tsx:44` — `readEntry = (entry) => fsHost() ? readFileSync(entry) : pakGet(entry)`。
2. `vendor/pocket-rpgkit/vendor/pocketjs/framework/src/fs-api.ts:232-237` — `readFileSync` →
   `readAll`；`:91-110` `readAll` 按 `FS_MAX_IO_BYTES=65536` 循环 `ops.read(path, offset, 65536)`，
   每块 `JSON.parse` 信封 + `base64ToBytes`，再拼接。
3. `vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/fs.ts:240` — `FS_MAX_IO_BYTES = 65536`；
   `:147` `FS_BLOB_KEY = "$b"`。
4. `vendor/pocket-rpgkit/vendor/pocketjs/engine/crates/pocket-fs/src/lib.rs:127-160` —
   `FsModule::read`：`dir_read` 盘读一块 → `BASE64.encode` → `json!({"data":{"$b":...}})` 信封。
5. `vendor/pocket-rpgkit/src/engine/map-repository.ts:407-419` — `acquireStep`：
   `source.read(entry)` 得字节 → `:359-371` `decodeMapEntryBytes`（8 KiB 块 ASCII 扫描 +
   `String.fromCharCode.apply`）→ `JSON.parse`。
6. `vendor/pocket-rpgkit/vendor/pocketjs/framework/src/bytes.ts:24` — `base64ToBytes`
   （逐 4 字符 `B64_INV` 查表循环）。

**为什么 base64/分块**：fs spec 刻意把 9 个 op 全定为 string/number（`contracts/spec/fs.ts:48-50`
"Signatures (authoritative; hosts marshal them however they like)"），让 sim 宿主（JS）与 MCU
宿主（ESP-IDF/LittleFS）只用字符串 marshalling 就能实现；字节载荷统一用 `{"$b": base64}`
（与 db 模块同一拼写，`fs.ts:131-138`）；64 KiB 上限是为了让单次载荷在小堆设备上放得下
（`fs.ts:236-240`）。QuickJS 没有 `TextDecoder`/`btoa`，编解码全在 JS 侧（`bytes.ts`）。

**有没有现成二进制/直传文本通道没用上**：

- rquickjs 绑定本身支持 `TypedArray<u8>`/`ArrayBuffer` 零拷贝（JS→host）：ui 的
  `uploadTexture`/`loadStyles`/`loadFontAtlas`/`uploadImgEntry`（`engine/crates/pocket-ui-surface/
  src/surface.rs:351-361,463-476,512-517`）、`net.start(meta, body: ArrayBuffer)`
  （`engine/crates/pocket-net/src/lib.rs:375-383`）、`audio.writePcm`。
- **唯一 host→JS 原始字节通道**是 `net.take(handle, into: ArrayBuffer)`：guest 按 JSON 通告的
  字节数分配恰好大小的 `ArrayBuffer`，host 用 `as_raw()` + unsafe 切片直接写入
  （`pocket-net/src/lib.rs:388-399`）。
- **没有任何 host 函数返回字节**——所有模块的返回都是 String/number/bool。fs 模块完全没有
  二进制通道。桌面宿主也不装 `globalThis.__pak`（pak 只在 host 侧喂给 surface，guest 看不到）。
- 即：**现成的 `net.take` 调用方提供缓冲区先例可以直接套用到 fs**，但目前没有任何 fs op 用它。

## 4. 测量结果

### 4.1 分段中位（ms，21 reps；buddha 关键段括号内为 min / p90）

全部阶段的 min / median / p90 逐图数据见 artifact `aggregated.txt`（fleet artifact 27432）。

| 阶段 | bedroom 9.2 KB | paper_town 61.5 KB | taba 153.4 KB | buddha 212.6 KB |
| --- | ---: | ---: | ---: | ---: |
| disk（宿主读盘） | 0.033 | 0.199 | 0.218 | 0.089 (0.077/0.100) |
| host（盘读+base64 编码+信封） | 0.024 | 0.107 | 0.237 | 0.339 (0.295/0.359) |
| transfer（ABI 跨越） | 0.046 | 0.183 | 0.334 | 0.444 (0.404/0.539) |
| env_parse（信封 JSON.parse） | 0.017 | 0.073 | 0.193 | 0.279 (0.249/0.315) |
| **b64（JS base64 解码）** | 1.506 | 10.044 | 24.913 | **34.350** (33.780/35.641) |
| concat | 0.004 | 0.005 | 0.026 | 0.027 |
| **ascii（decodeMapEntryBytes）** | 0.533 | 3.515 | 8.644 | **12.018** (11.884/12.597) |
| parse（JSON.parse） | 0.179 | 0.985 | 1.901 | 1.382 (1.329/1.412) |
| validate | 0.022 | 0.128 | 0.503 | 0.725 |
| world（createWorld） | 0.251 | 0.877 | 1.165 | 0.197 |
| passage（buildPassage） | 0.033 | 0.287 | 1.222 | 2.027 |
| prod_read（生产 readFileSync） | 1.552 | 10.343 | 25.521 | 34.772 |
| **prep_parse（生产首段）** | 2.238 | 14.790 | 36.171 | **48.160** (47.073/50.022) |
| prep_validate | 0.079 | 0.310 | 0.698 | 0.776 |
| prep_compile | 0.259 | 1.154 | 2.355 | 2.221 |
| commit（acquireSessionMap） | 0.009 | 0.013 | 0.017 | 0.016 |
| frame1 / frame2 | 0.025 / 0.012 | 0.054 / 0.012 | 0.058 / 0.012 | 0.059 / 0.012 |

buddha 的 p90 = 50.022 ms，正好压在 50 ms 门禁线上（机器忙时；安静窗口会更低）。

### 4.2 交叉校验（中位 ms，全部 <1% 误差）

| map | readAll 重构 | 生产 prod_read | read_parse 重构 | 生产 prep_parse | world+passage | 生产 prep_compile |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bedroom | 1.573 | 1.552 | 2.285 | 2.238 | 0.284 | 0.259 |
| paper_town | 10.305 | 10.343 | 14.805 | 14.790 | 1.164 | 1.154 |
| taba_town | 25.466 | 25.521 | 36.011 | 36.171 | 2.387 | 2.355 |
| buddha | 35.100 | 34.772 | 48.500 | 48.160 | 2.224 | 2.221 |

### 4.3 斜率（ms/KB，最小二乘 over 4 图中位）

| 阶段 | 斜率 | 阶段 | 斜率 |
| --- | ---: | --- | ---: |
| disk | 0.0002 | ascii | **0.0577** |
| host | 0.0016 | parse | 0.0067 |
| transfer | 0.0019 | validate | 0.0037 |
| env_parse | 0.0013 | world | 0.0002 |
| **b64** | **0.1654** | passage | 0.0101 |
| concat | 0.0001 | **read_parse 全段** | **0.2323** |

base64 解码占 read_parse 斜率的 71%，ASCII 解码占 25%，`JSON.parse` 只占 3%。

### 4.4 首帧挂载

session 层 commit 0.016 ms、首帧 0.059 ms、稳态帧 0.012 ms——首帧比稳态只多 ~0.05 ms，
session 层没有挂载成本。真实游戏的 UI 挂载在游戏层（本 bench bundle 是空 `View`，量不到）；
GP1 量的真实游戏 map-switch worst 15.857 ms 包含了 switch 内的 read_parse 段，不是帧挂载本身。

## 5. 改法建议与收益估算

### 5.1 组件仓 + 导入器（不改引擎）：紧凑 ground 编码

方向与 C1.md §3.3 一致（评审也认可方向，只是否定了错误的体积/收益数字）。评审 A/B 实测：
buddha 的 `groundPalette + ground:number[]` 紧凑 JSON 完整文档 = **32,704 B**（不是 13–21 KB；
13–21 KB 只可能对应另行设计的 nibble/RLE/二进制字符串编码）。

按 §4.3 斜率外推（read_parse 截距 ~0.10 ms + 0.2323 ms/KB）：buddha 212,567 B → 32,704 B，
read_parse 48.2 → **~7.5 ms（−84%）**。全图普遍受益（评审量的 ground 占文档字节中位 42.9%、
p90 76.3%），同时减 pak 体积与内存。组件仓需改 `MapDef` schema、`validateMapDefStructure`、
compile 三处；导入器发射侧等组件仓落地后再跟。**注意**：这减的是字节，base64/ASCII 两段
逐字节循环仍在，只是按比例变短。

### 5.2 PocketJS 小补丁（走 PR）：消灭 base64 往返

**推荐：新增 `fs.readText(path, offset, maxBytes) -> string` op**，宿主直接把文件字节做成
JS 字符串返回（rquickjs 从 Rust `String` 构造 JS 字符串是 C 层 UTF-8→UTF-16，快）。理由：

- 仍然是 string-only ABI（不引入 TypedArray），sim/MCU 宿主都能实现，符合 fs spec 的设计哲学；
- 一次消灭：宿主 base64 编码、信封 JSON、ABI 传 base64 串、JS `JSON.parse(信封)`、JS
  `base64ToBytes`、JS 拼接、JS `decodeMapEntryBytes`——共 7 段；
- 收益（buddha）：48.2 → 盘读 0.09 + 宿主 UTF-8 校验/构串 ~0.2 + ABI 传 212 KB 串 ~0.5
  + `JSON.parse` 1.38 ≈ **~2 ms（−96%）**。

补丁范围（小而聚焦，一个问题一个分支）：

- `contracts/spec/fs.ts`：新 op code（append-only，不复用号）；签名与错误/EOF 约定
  （op 形状——裸串返回 vs 信封——需要一个小设计 pass，本报告不锁死）；
- `engine/crates/pocket-fs/src/lib.rs`：`read_text` 实现（读块 + UTF-8 校验 + 返回 `String`）；
- `framework/src/fs-api.ts`：`readTextAll` 循环；`readFileSync(path, "utf8")` 改走它；
- 宿主：桌面（pocket-fs 共享，直接受益）、sim 宿主（JS）、psp、esp-idf（若实现 fs）；
- 测试：pocket-fs 单测 + 桌面宿主往返。

备选 `fs.readInto(path, offset, buf: ArrayBuffer) -> bytesRead`（套 `net.take` 先例）：消灭
base64 但保留 JS 侧 ASCII 解码（12 ms），buddha → ~14 ms（−71%）；且要求宿主支持
TypedArray，MCU 不友好。readText 收益更大、兼容性更好，推荐 readText。

### 5.3 叠加

紧凑 ground 编码 + readText：buddha read_parse → ~0.5 ms，50 ms 预算余量 49+ ms。

## 6. 对 C1.md §3 的更正

- 删除「QuickJS 解析一万个重复字符串 token 就是 43–50 ms 的去向」——错误归因；
- 删除「按 ~0.20–0.24 ms/KB 的 parse 比率外推」——那是 read_parse 全段斜率，不是 parse 斜率；
- 删除「buddha 文档可降到约 13–21 KB，read_parse 降到 ~3–5 ms」——`number[]` 紧凑 JSON 实测
  32,704 B，read_parse 按正确斜率外推 ~7.5 ms；13–21 KB / 3–5 ms 只对 nibble/RLE 等另行设计的
  编码成立；
- 改为本报告 §1/§4 的测量表与 §5 的收益估算。

## 7. 门禁

| 门禁 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun test` | 168 pass / 0 fail / 0 skip，71,055 assertions，35 files，166.6 s（首次跑在负载 15 时 `importer.test.ts` 的 G6 cook 子进程 30 s 超时抖动 1 次，单独复跑通过；降负载后全量复跑全绿） |
| `bun.lock` / `vendor/` | `git diff --exit-code fe74f41..HEAD -- bun.lock vendor/` 为空 |
| fleet 任务号 | 新增探针/报告文件 grep 零命中（findings 里的分支名同基线 C1.md 惯例） |

## 8. 提交

探针四文件 + 本报告 + C1.md §3 更正。未 push。

subagent 使用：1 个 / Explore 只读勘察 PocketJS 宿主↔guest 数据通道（fs/db/ui/net/audio 的
marshalling、`net.take` 先例、fs spec 的 string-only 理由）/ 省了时间——勘察与主 agent 读
bench 工具链并行，主 agent 亲自核实了 subagent 引用的每个 file:line（fs.ts:48-50/131-138、
pocket-net/lib.rs:388-399、surface.rs:351-361）后才写进报告；性能测量按规矩由主 agent 串行
独占，测量期间无 subagent 在跑命令。
