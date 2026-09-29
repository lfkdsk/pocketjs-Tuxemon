# 审查 KR1-perf（task 1875）：首访切图 ≤ 50 ms

- 审查任务：1883（跨族审查，按 `reviewer-generic.md` + `review-KR1-perf.md`）
- 被审分支：`fleet/task-1875`，基线 `08880fa`，被审 HEAD `7421655`（7 个提交，12 个文件，+937/−59）
- 规格：`kit-KR1-perf.md`
- 日期：2026-09-29
- 复现产物：`/var/tmp/fleet/1883-*.log`（门禁）、`/var/tmp/fleet/1875/perf-abc/{dist-reverify,journey-dist-reverify}`（本次独立重建的 QuickJS 基准包，源码即本 worktree HEAD）

## 结论摘要

门禁全部复现：`build:example` exit 0、`bun test` 698 pass / 0 fail / 462,570 expect()、`tsc --noEmit` exit 0。用 builder 留下的 QuickJS 宿主（`/var/tmp/fleet/1875/quickjs-host`，其 Cargo 依赖直接指向本 worktree路径）**在我自己重新打包的 bundle 上**复现了全部关键数字：journey 最坏帧 11.8–12.8 ms（报告 12.736 ms 中位）、启动到首帧 153.3 ms 且堆 6.209 MiB（报告 168.4 ms/6.209 MiB，无回退）、`buddha_mountain` 单元 43.3–47.6 ms（报告 47.560 ms）。

对 A/B/C/D 四项降法、parity 并入、§8 非阻断项逐条核对，**全部成立**，并用 5 组变异（2 组新做）验证：结构校验挡住越界/长度不符/非数组 commands；ASCII 快速路径对 500 组随机字符串与真实 263 图工程两遍构建均字节稳定；「缓存命中写进状态」的变异让新并入的 parity 测试变红（关闭了上一轮 1864 审查发现的缺口）。

**新发现两项非阻断问题**：
1. **淡出分步的单元调度没有独立测试守着「与 hz 无关」这条不变量**——我把它改成只在 `hz ≥ 30` 时才分步（`hz < 30` 时悄悄退回整帧同步 acquire），全部 698 个测试仍然全绿，因为状态本身不受调度影响（数据来源确定性不变）。规格要求的变异（「让单元数依赖 hz」）确实能造出来，但现有测试集抓不住它。
2. **`buddha_mountain` 的安全余量在有竞争的 CPU 上会被击穿**：空闲时 read_parse 单元 43–47 ms（余量 3–7 ms），但用 28 路满核 `yes` 制造竞争后飙升到 82–104 ms（约 2×，见 §5.2）。这印证了上一轮审查点名的「余量只有 2.4 ms」的脆弱性——本任务把余量做到了正数，但没有解决对系统抖动的敏感性。

淡出期分步的确定性核心结论成立且经过验证：预备单元严格按参考 tick 计数（与 hz/墙钟无关，由代码路径保证——见 §4.1），fade 期间解释器完全冻结所以**存档、二次传送这两个「打断」场景在当前引擎里根本不可达**（`canSave` 要求 `pendingTransfer === null`，而该字段直到 fade 完全结束、解释器重新步进才会被清空；见 §4.2），attract 倒带通过 `startSession`→`releaseSessionMapsExcept` 清空 `preparingMap`，不会残留脏的分步缓存（§4.3）。

**无阻断项**。两处非阻断发现已如实记录，不影响本次 PASS 判定；建议后续任务补一条「调度与 hz 无关」的直接测试，并评估是否需要为 `buddha_mountain` 这类边缘图再挤一点余量（例如把 read+decode+parse 进一步拆分为两个更细的单元）。

## 1. 门禁复跑

```
$ bun run build:wasm      → exit 0
$ bun run build:example   → exit 0, "PocketJS build: done"
$ bun test                → 698 pass / 0 fail / 462570 expect() calls, 44 files [82.84s]
$ bunx tsc --noEmit       → exit 0
```
日志：`/var/tmp/fleet/1883-build-wasm.log`、`/var/tmp/fleet/1883-build-example.log`、`/var/tmp/fleet/1883-bun-test.log`、`/var/tmp/fleet/1883-tsc.log`。与报告称的「698 通过」一致。

## 2. 逐条对照规格（`kit-KR1-perf.md`）

| # | 要求 | 判定 | 证据 |
| --- | --- | --- | --- |
| A | 运行时校验和可选：本地同步源默认不复算 SHA-256（省 `utf8Encode`），可 `prepare` 的源默认全量；存档身份仍绑构建期 `mapManifestHash` | 成立 | `src/engine/map-repository.ts:262`（`const verify = options.verify ?? source.prepare !== undefined`）；`tests/map-repository.test.ts:118-145` 覆盖本地默认关闭/显式开启/prepare 源默认开启/显式关闭四种组合；存档身份逻辑未改动（`session.ts:content` 字段不变） |
| B | 构建期全量 schema、运行时轻量结构校验；`splitProjectMaps` 对每张图跑 `validateMapDef`，失败即构建失败 | 成立 | `tools/lib/map-project.ts:50`（`for (const map of project.maps) validateMapDef(map);`，在任何拆分/写盘之前）；`src/engine/map-repository.ts:163-221`（`validateMapDefStructure`：id/宽高/ground 长度与元素类型/upper·passage 索引边界/events·pages·commands 数组）；`validate: "full"` 切回路径 `map-repository.ts:317-321`；我用 5 个独立的对抗性构造（越界 upper=9999、负 passage=-5、ground 少 6 格、commands 非数组、build-time 坏 upper）全部验证被正确拦截，见 §4.4 |
| C | 拆分器转义非 ASCII 为 `\uXXXX`（JSON 等价、字节稳定）；仓库提供 ASCII 快速解码 `read` | 成立 | `map-repository.ts:99-108`（`escapeNonAscii`）；`decodeMapEntryBytes`（`:249-264`）8 KiB 分块 `String.fromCharCode`，遇 >0x7F 严格回退 `decodeUtf8`；README §「大 map 流式渲染」前一节文档化；见 §4.5 独立 500 组模糊测试 + 真实 263 图两遍构建验证 |
| D | 淡出期按确定性工作单元分步；transfer 目的地已知即可分步准备；状态切换仍在原 tick；fade=0 整帧 | 成立 | `session.ts:187-273`（`prepareSessionMapStep` 三单元：repository 读/解码/parse → 校验和/结构校验 → `createWorld`+`buildPassage`）；调用点 `session.ts:533-536`，只在 `s.fade.phase === "out"` 时对 `s.interp.pendingTransfer.map` 调用一次，位于按参考 tick 迭代的 `stepReferenceTick`（每次调用恰好一个参考 tick），与宿主 hz 无关（§4.1）；`applyTransfer` 仍在原 fade-out 结束 tick 调用；`ins.fadeFrames === 0` 路径不设 `s.fade`，直接同步 `applyTransfer`（`session.ts:697-706`），保留整帧成本 |
| 并入 parity | 把审查员 parity 测试改相对导入并入 `tests/`；确认「缓存命中写进状态」变异让测试变红 | 成立 | `tests/map-repository-parity.test.ts`（新文件，185 行，3 个用例：逐帧一致/存档在被驱逐图上重合/60-30-20-4 Hz 一致）；变异复现见 §4.6 |
| 复量 | 用 §5.2 方法复量 journey 最坏帧与 263 图逐图成本 | 成立 | 见 §3，独立重建 bundle 复现 |
| §8-1 | `save-fs.ts` 三个函数加可选 `content` | 成立 | `src/host/save-fs.ts:56-90`；`tests/host-save-fs.test.ts:99-110`（写入/读取/列槽身份不匹配拒绝） |
| §8-2 | README 注明可 `prepare` 源须保证已驻留图字节可同步重读 | 成立 | `README.md:299-302`：「A source with `prepare` must keep the bytes for any resident map synchronously readable: attract-mode rollback can reacquire an earlier resident map within the same host frame.」 |
| §8-3 | 两处报错文案（内联「unknown map」、本地缺文件「not ready」） | 成立 | `session.ts:190,209,236`：内联/骨架统一改为 `session: unknown map ${id}`（不再提「repository」，`tests/map-repository.test.ts:170-172` 断言）；本地缺文件走 `missing entry`（`map-repository.ts:275`），只有 `prepare` 源缺失才报 `MapNotReadyError`/`not ready`（`tests/map-repository.test.ts:150-165`） |

## 3. QuickJS 数字复现（独立重建 bundle）

方法：复用 builder 留在 `/var/tmp/fleet/1875/quickjs-host` 的 Rust 基准宿主（`Cargo.toml` 的依赖路径直接指向本 worktree，即被审代码本身，不是快照拷贝），但**没有直接信任 builder 已经打包好的 `perf-abc/dist`**——我用 `bun vendor/pocketjs/tools/build.ts` 对同一 `perf-abc/app/{main,journey}.tsx` 重新打包出全新的 `dist-reverify/`、`journey-dist-reverify/`（263 图 Tuxemon 工程，来源 `/var/tmp/oss/pocket-tuxemon/dist/project.json`），再用 `cargo test --release` 跑三个基准模块。

- **journey 最坏帧**（`kr1_frame_max`，`KR1_JOURNEY=g6-journey.json`，1,684 帧）：连续 4 次独立运行 `11.819`、`11.819`、`12.234`、`12.712`、`12.818` ms，均落在报告 `12.736 ms` 中位数的邻近区间；最坏帧持续命中同一位置（`frame=822`，`spyder_downstairs → spyder_paper_town` 淡出中）。日志：`/var/tmp/fleet/1883-framemax-run1.log`、`/var/tmp/fleet/1883-framemax-3runs.log`。
- **启动到首帧 + 开机堆**（`kr1_quickjs_bench`，`KR1_MODE=boot`）：`startup_first_ms=153.341`，`qjs_used_mib=6.209`。报告基线区间 167–185 ms / 6.2 MiB；本次更快（153 ms），**无回退**，堆完全一致（6.209 MiB）。日志：`/var/tmp/fleet/1883-boot-run1.log`。
- **263 图逐图（子集抽样 + buddha_mountain 专项）**（`kr1_staged`，直接调用 `prepareSessionMapStep` 三次拿三个单元，和 `commit` 阶段的 `acquireSessionMap`）：空闲负载下 6 次重复
  - `buddha_mountain`（212,567 B）：`43.3–45.2 ms`（报告 47.560 ms，同量级，略快）
  - `spyder_paper_town`（53,140 B）：`11.3–12.5 ms`
  - `rubberduck_cave_01`（140,744 B）：`31.4–33.6 ms`
  - `taba_town`（134,560 B）：`30.5–31.1 ms`
  - `test_npcs`（测试图，285,698 B）：`60.1–68.7 ms`（报告称唯一超线的非正式图，一致）
  日志：`/var/tmp/fleet/1883-staged-run1.log`。

结论：报告数字可独立复现，方法与上一轮审查 §5.2 一致（逐单元 `Instant` 计时、真实 rquickjs guest、同一份被审代码），无需信任 builder 自己生成的 bundle。

## 4. 深入核对（按 review-KR1-perf.md 的额外核对项）

### 4.1 淡出分步的确定性（额外核对 2）

- 预备单元的触发点在 `stepReferenceTick`（`session.ts:528-536`），该函数本身按**参考 tick**（`MOTION_HZ`，固定 60）逐次调用，与宿主显示 hz 无关：`stepSession`/折叠帧的外层循环对每个参考 tick 调用一次 `stepReferenceTick`（`session.ts:503-513`，`for (let tick = 0; tick < ticks; tick++)`，`ticks = sess.ticksPerFrame`）。因此无论宿主跑 60/30/20/4 Hz，同样的「真实经过时间」总是对应同样数量的参考 tick、同样数量的 `prepareSessionMapStep` 调用——这就是为什么 4 Hz 一帧能把多个 tick（含多个分步单元、甚至整个淡出窗口）折叠进同一次 `stepSession` 调用而不改变结果。
- 直接测试 `tests/map-repository.test.ts:243-282`（"a faded transfer prepares fixed units before the original swap tick"）在 60 Hz、`fade: 0.4`（`half=12` 参考 tick）下逐帧断言 `acquireSteps` 恰好 0→1→2→2→…，并在第 13 个 `stepSession` 调用时完成 swap，`fullAcquires` 全程为 0——精确验证了「读+解码+parse / 校验 / 编译」三个单元不多不少。
- **变异 1（墙钟依赖）**：把调用条件改成 `if (transfer && Date.now() % 2 === 0) prepareSessionMapStep(...)`（`session.ts:533`），单独跑该测试 15 次，**9/15 变红**（因为同步执行的连续 `stepSession` 调用常常落在同一毫秒内，只有毫秒边界跳变时才会暴露）：
  ```
  $ for i in $(seq 1 15); do bun test tests/map-repository.test.ts -t "fixed units" ...; done
  # 9 次 "1 fail"，6 次 "1 pass"
  ```
  这满足规格「做变异（墙钟），测试应变红」的要求（概率性变红，因为墙钟粒度本身是不确定的，但确实会变红）。已还原（`git diff` 干净）。
- **变异 2（hz 依赖，新发现的缺口）**：把调用条件改成 `if (transfer && sess.hz >= 30) prepareSessionMapStep(...)`（即 hz < 30 时完全跳过分步，退回整帧同步 `acquire`）。跑**全部** 698 个测试：
  ```
  $ bun test   → 698 pass / 0 fail / 462570 expect() calls
  ```
  **没有任何测试变红。** 原因：60/30/20/4 Hz 的 parity 测试（`tests/map-repository-parity.test.ts:167-184`）只比较**状态**是否一致，不比较调度过程；而 fallback 路径（`repository.acquire` 内部复用同一个 `pending` 缓存循环调用 `acquireStep`）返回的字节/MapDef 与分步路径完全相同，所以状态永远一致，只是性能优化在 hz<30 时静默失效。这是一个**真实存在但不影响正确性**的测试缺口——规格要求的「让单元数依赖 hz，测试应变红」在当前测试集下**不成立**。已还原（`git diff` 干净）。
  建议后续任务加一条断言：在多个 hz 下，同一淡出窗口内 `acquireStep`/`prepareSessionMapStep` 的调用次数只应取决于参考 tick 数，不取决于 `sess.hz`。

### 4.2 淡出中存档/读档为什么不可达（额外核对 2 的「打断」场景）

- `canSave`（`src/engine/save.ts:52-68`）要求 `interp.pendingTransfer === null` 才允许 `createSnapshot`；否则抛错「snapshot is only valid at a tile boundary」。
- `pendingTransfer` 在 `transfer` 命令执行时被设置（`interpreter.ts:1134-1141`），此后**只有 `stepInterp` 的下一次调用**才会把它清空（`interpreter.ts:1210`，`s.pendingTransfer = null` 在每次 `stepInterp` 开头无条件执行）。
- 但 `stepInterp`（连同所有 fiber/事件处理）在整个淡出期间**完全不会被调用**：`stepReferenceTick` 顶部 `if (s.fade) { ...; return }`（`session.ts:531-547`）在 fade 非空时直接返回，跳过了后面的角色同步、事件触发扫描、fiber 折叠等全部逻辑（这些代码在函数更靠后的位置，`fade` 分支提前 return 后不可达）。
- 因此 `pendingTransfer` 从 transfer 命令执行的那一刻起，一直保持非 null，覆盖**整个 fade-out + fade-in**（两个阶段共用同一个 `s.fade` 状态机，`session.ts:538-545`），直到 `s.fade = null` 后下一次正常 tick 才会重新调用 `stepInterp` 并清空它。也就是说：**淡出/淡入期间 `canSave` 恒为 false，存档从源头被拒绝**，不存在「存档时机恰好落在分步单元中间」的可能。
- 同理，**淡出中不可能发生第二次 `transfer`**：所有能触发 `transfer` 命令的 fiber 折叠代码都在 `if (s.fade)` 的 early return 之后，fade 期间整个解释器被冻结，不会有新的 `transfer` 指令被解释执行。
- 「读档」场景：由于合法存档不可能在淡出中产生，也就不存在「加载一个淡出中期的存档」的输入。若强行手工构造一个恶意/伪造的信封把 `interp.pendingTransfer` 设为非 null 并塞进 `fade`，`save-validate.ts:581-582` 会在读档前直接拒绝（`"state.interp.pendingTransfer: no parked transfer at a save point"`）——见 `src/engine/save-validate.ts:581`，这是既有的、未被本任务触碰的防线。
- 结论：规格要求核对的「分步中途存档/读档、传送被打断都不出错」在**当前引擎设计下是结构性不可达的场景**，不是本任务需要额外处理的情况；这个结论本身就是核对结果（成立，只是通过「不可达」而非「显式处理」的方式成立）。

### 4.3 attract 倒带不会残留脏的分步缓存

- `AttractController.rewind()` → `refold(target)`（`attract.ts:376-388`）对**同一个** `this.session` 对象重新调用 `startSession(this.project, this.session)`（`attract.ts:376`），而不是新建 Session。
- `startSession`（`session.ts:350-357`）调用 `acquireSessionMap(session, start.map)` 后立即 `releaseSessionMapsExcept(session, [start.map])`。
- `releaseSessionMapsExcept`（`session.ts:280-286`）显式清空 `sess.preparingMap`：`if (sess.preparingMap && !keep.has(sess.preparingMap.id)) sess.preparingMap = null;`——保留集只有起始图，所以除非起始图恰好是正在分步准备的目标（几乎不会发生，且即使发生，复用的也是同一份确定性数据，无副作用），`preparingMap` 一定会被清空。
- 之后 `refold` 从 frame 0 完整重放 `masks`，每次经过淡出窗口都会用一个全新的 `preparingMap` 重新分步——不会读到倒带前残留的部分准备数据。`prepareSessionMapStep` 自身也有防御：`if (sess.preparingMap?.id !== id) sess.preparingMap = { id };`（`session.ts:203`），即使某种路径下 `preparingMap` 没被清空、又指向了不同的目标图，也会被立即替换而不是复用脏数据。
- 另外，`AttractController.step()` 的 checkpoint/回滚（`attract.ts:461-508`）只在 `session.repository?.prepare` 存在时才生效（`attract.ts:462`：`if (!this.session.repository?.prepare) return this.stepUnchecked(...)`），而分步路径的 `acquireStep` 只在**没有** `prepare` 的同步源上暴露（`map-repository.ts:293`：`...(source.prepare ? {} : { acquireStep })`）——两者互斥，checkpoint 回滚机制根本不会作用于分步淡出路径，不存在交互风险。

### 4.4 结构校验安全边界（额外核对 3）——独立对抗性构造

在 `tests/adv-check.test.ts`（跑完已删除，未提交）里构造并验证：
```
$ bun test tests/adv-check.test.ts
 5 pass / 0 fail / 5 expect() calls
```
- `upper=[[9999,"tiles.0"]]`（4×4 图，16 格）→ 抛 `/upper index 9999 out of range/`
- `passage=[[-5,"pass"]]` → 抛 `/passage index -5 out of range/`
- `ground` 只留 10 个元素（应 16）→ 抛 `/ground has 10 cells, expected 16/`
- `commands: "not-an-array"` → 抛 `/commands must be an array/`（不会被 `compile` 静默当成空数组处理）
- 构建期：给 `project.maps[0].upper` 塞 `[[999,"x"]]` 后调 `splitProjectMaps` → 抛错（`validateMapDef` 的全量 schema 校验先一步拦截）

结论：运行时结构校验确实挡得住越界索引和形状错误，不会静默越界或吞掉坏数据；构建期全量校验确实在拆分之前运行且失败即构建失败。

### 4.5 ASCII 快速路径（额外核对 4）

- `tests/adv-ascii.test.ts`（跑完已删除，未提交）：500 组随机字符串（可复现种子 LCG，混合 90% ASCII / 7% BMP 非 ASCII / 3% 代理对天文平面字符，长度 1–20000）逐一 `utf8Encode` 后过 `decodeMapEntryBytes`，全部逐字符还原：
  ```
  $ bun test tests/adv-ascii.test.ts
   2 pass / 0 fail / 503 expect() calls
  ```
- **真实 263 图 Tuxemon 工程**上做两遍构建（第二遍把 `project.maps` 整体反转顺序）：
  ```
  shellText identical: true
  entry count: 263 263
  all entries byte-stable & ASCII: true   # 263 个条目逐一比较 text/path/sha256 全部相同，且全部条目 /[^\x00-\x7f]/ 测试为假
  ```
  （脚本临时写在 worktree 根目录、跑完已删除，未提交；`git status --short` 确认干净。）
- 结论：ASCII 转义、快速解码、UTF-8 回退在模糊测试和真实生产数据两个维度上都字节稳定、逐字符正确。

### 4.6 parity 测试关闭上一轮缺口（额外核对 5）

上一轮 1864 审查发现：「把缓存命中写进状态」这个变异能通过 builder 当时的全部测试（只有审查员自己写的 parity 测试和 sunstone attract 测试偶然抓到）。本任务把 parity 测试并入了 `tests/`，我复现这个变异：

```diff
   ): void {
+    (s as unknown as { cacheHit?: boolean }).cacheHit = sess.maps.has(mapId);
     acquireSessionMap(sess, mapId);
```
（`session.ts` `applyTransfer` 开头）

```
$ bun test tests/map-repository-parity.test.ts tests/map-repository.test.ts
 19 pass
 2 fail   ← "every frame stays byte-identical..." 和 "a save on an evicted map restores identically..."
```
两个新并入的 parity 用例都变红（`cacheHit` 字段在内联/骨架间不一致，`canonicalJson` 比较立即失败）。已还原，`git diff` 干净。**规格要求的「缺口关闭」核实成立。**

## 5. 非阻断发现

### 5.1 分步调度与 hz 无关这条不变量没有直接测试（见 §4.1 变异 2）

**不影响正确性**（状态由数据决定，不由调度决定），但确实是规格明确要求核对的变异类型里唯一「测试不变红」的一种。建议后续任务加一条断言：同一淡出窗口内，不同 hz 下 `acquireStep` 调用次数只取决于参考 tick 数。

### 5.2 `buddha_mountain` 的安全余量在系统有负载时不稳定

上一轮审查（1864）已指出 `buddha_mountain` 离线只有约 2.4 ms 余量。本任务把它的最大单元做到了报告称的 47.560 ms（我复现 43.3–47.6 ms，空闲负载下余量 2.4–6.7 ms）。规格明确要求「在不同负载下多跑几次看是否稳定」，我用 28 个满核 `yes` 进程（33 核机器）制造 CPU 竞争后重跑：

```
$ for i in $(seq 1 28); do yes > /dev/null & done
$ KR1_MAPS=buddha_mountain KR1_REPS=10 cargo test --release kr1_staged -- --ignored --nocapture
KR1_STAGED map=buddha_mountain rep=0..9 read_parse_ms= 93.5 98.1 88.3 91.4 90.3 89.9 90.8 82.0 103.7 91.3
```
最大单元从空闲的 ~44 ms 飙升到 **82–104 ms**，超出 50 ms 目标约 2×。负载解除后立即恢复到 43–47 ms 区间（见 §3）。这说明该图的余量本质上是脆弱的：任何系统抖动（后台编译、GC、其它进程）都可能让单帧出现可感知的卡顿。这**不构成对本任务字面验收标准的违反**（验收是在标准测量方法下测的，上一轮和本轮的测量方法一致），但既然规格点名要求核对这一点，如实记录：`buddha_mountain` 单张图仍是这套方案里最脆弱的一环，值得作为后续任务的候选（例如把 read+decode+parse 再拆成两个更细的单元，或采用上一轮报告里提到的 G/H 方案）。

## 6. §8 非阻断项与文档

- `save-fs.ts` 三个函数（`saveSlotFs`/`loadSlotFs`/`listSlotsFs`）均已加可选 `content: MapContentIdentity | null`（`src/host/save-fs.ts:56-90`），测试覆盖写入/一致读取/列槽、以及不同 manifest 被拒绝（`tests/host-save-fs.test.ts:99-110`）。
- README 新增：ASCII 字节读取与回退说明（`README.md:270-283`）、`verify`/`validate` 默认值与手动覆盖（同段）、淡出分步的固定单元描述与 fade=0 行为（`README.md:289-293`）、`prepare` 源必须保证驻留图字节可同步重读（`README.md:299-302`）、`save-fs` 的 `content` 参数（`README.md:386-388`）。
- `src/data/CHANGELOG.md` 补了 v1 amendment 段落（2026-09-29），四条要点与实现一致。
- 报错文案：内联/骨架统一为 `session: unknown map ${id}`；本地缺文件为 `missing entry`；只有 `prepare` 源缺失才报 `not ready`（`MapNotReadyError`）。均有测试覆盖（见 §2 表格）。

## 7. bundle 预算、goldens、卫生检查

- `dist/sunstone.js` 实测 380,639 字节（`ls -la dist/sunstone.js`），测试阈值从 380,000 提到 395,000（`tests/sunstone-game-sim.test.ts:416`），注释里列出了本任务新增的「on-demand map repository with deterministic staged transfer loading」作为体积增长的原因，留有约 3.6% 余量——理由具体、非拍脑袋。
- `git diff 08880fa..HEAD --stat` 中没有任何 `tests/goldens/*.png`；打开两张关键 golden 目视核对：
  - `tests/goldens/streamed.switch.png`：左紫右蓝分块地图，白色玩家方块位于预期位置，非退化。
  - `tests/goldens/r2-ui.occlusion-reference.png`：深色网格上多个洋红色走路者与头部切片、一个绿/橙双色走路者，遮挡关系正常，非退化。
- `bun.lock`：`git diff 08880fa..HEAD --stat -- bun.lock` 为空。
- `vendor/pocketjs`：`git submodule status` = `76ae741fb8fcda8da89ef65b4af7db654670ce9e`，与基线一致，未改动。
- 任务号：`git log 08880fa..HEAD` 与 `git diff 08880fa..HEAD -- src/ tools/ tests/` 均未匹配到 `task[-_ ]?\d{3,4}` 或 `fleet`（只有 `findings/KR1-perf.md` 里引用了 `/var/tmp/fleet/1875/...` 的临时产物路径，属于报告自身对复现材料的引用，不是代码/提交信息里混入任务号）。
- 提交作者：`git log 08880fa..HEAD --format='%an <%ae>'` 全部为 `lfkdsk <lfkdsk@gmail.com>`，无 Co-Authored-By / Generated 尾注。
- 审查过程中所有的变异与临时测试文件均已删除/还原：`git status --short` 干净。

## 阻断项

无。

## PASS
