# DW-G：doodlewind PR #1 游戏仓移植

## 结论

doodlewind 的游戏仓性能与 PSP 构建改动已按当前 `main` 的语义重写并集成。运行时补丁没有复制进游戏仓；游戏仓改为锁定已经包含对应能力的 RPG Kit `58ee4684519938d13210dad591dc5aca49c5253d`，其 PocketJS 为 `b07d017b968160605b5ce8cdb4d64cfa555dad22`。最新上游游戏仓 `main` `bf79f29545a48321a74042d2afb17e850a31cbfa`（含紧凑地图和索引色战斗图）已经合入。

战斗结果、序列化状态和像素输出保持不变；8,560 条 Tuxemon Python 对照仍全部通过。PSP 现在产出小型内嵌启动 pak 和可索引读取的完整 sidecar pak；PPSSPP 软件渲染器走完 3,793 帧开局旅程并通过双精度 ABI、终态和构建回执校验。

## 移植对照

| PR #1 文件 | 处置 |
| --- | --- |
| `patches/rpgkit-performance.patch` | 不复制。对应能力已进入 RPG Kit `697ef59d`，本仓通过子模块升级取得；最终指针 `58ee4684` 还包含当前 `main` 所需的紧凑资源和 DW-K 后续提交 |
| `patches/pocketjs-psp.patch` | 不复制。sidecar pak、PSP 纹理同步/切片和帧统计已经在 RPG Kit 所锁的 PocketJS `b07d017b` 中 |
| `tools/apply-vendor-patches.ts`、仅服务 patch 的 `.gitattributes` | 删除补丁机制后无用途，未移植 |
| `battle/tuxemon.ts`、`runtime.ts`、`stats.ts`、`presentation.ts`、`extension.ts` | 按当前完整战斗、物品、捕获、双打、升级和音频语义重写为持久化/COW 状态；保留历史追加共享和规则不可变契约 |
| `ui/battle-layout.ts`、`battle-paint.ts`、`battle-scene.tsx` | 移植稳定节点和增量 paint；与当前索引色 `LazyImage` 缓存合并。稳定战斗帧不再创建或销毁节点，离场仍释放所有延迟纹理 |
| 三个战斗测试文件 | 移植冻结快照、增量投影、回退与生命周期辨识力；同时保留当前 GB3、音频、选择框、改名和图鉴覆盖 |
| `main.tsx`、`tools/verify-gb6-mainline.ts` | 启用引擎不可变快路，并保留当前 scene、天气、音频和完整旅程语义 |
| `tools/psp.ts`、`tools/verify-psp-journey.ts`、`package.json`、`.gitignore` | 移植并扩展为 sidecar pak、构建回执、session/build-id/ABI/新鲜度校验；Linux 使用 Clang 加固定 PSP sysroot，macOS 保留固定 GCC 路径 |
| `.github/workflows/ci.yml` | 可行，按当前并行结构增加独立 `psp` job；固定工具链 bootstrap 后构建 release，并上传 EBOOT、sidecar、PRX 和回执。Pages deploy 等待该 job |
| `README.md`、`docs/status.md`、`docs/ci.md` | 按当前命令、实测体积、CI 结构、硬件与模拟器证据边界重写 |
| `importer/source.ts`、`importer/terrain.ts` | 未取 PR 的旧路径改动；保留当前仓内 `.tuxemon-src` 默认值与显式 `TUXEMON_SRC` 覆盖规则 |

组件升级后地图准备由三步变为四步。游戏仓的 QuickJS 冷启动基准同步拆分 `world_compile_ms` 和 `passage_compile_ms`，分别按帧计时；263 图 p95 为 11.724 ms，最慢 39.846 ms，仍低于 50 ms。

## PSP 结果

最终 journey 构建包含：

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `assets.pak`（sidecar） | 39,021,296 | `a36b82ea32ed6bfdb2d0f0cb0511068bd3b4d084b27e9b2efa6e8fb59612f8aa` |
| 内嵌 boot pak | 992,608 | `c511715077a067f3786ab5bb00d0ad0d48f45325f4eca67d9ddb62a77940b760` |
| `EBOOT.PBP` | 4,821,872 | `dfa958992a345e85eeb0e5aee76981dd62240cc644f0bcb53179a1b5a128cb11` |
| `pocket-tuxemon.prx` | 4,821,540 | `aef09990930c481a0de21fcb74284964af3628f5d0c0f32b658fa1e70d37074a` |

PPSSPPHeadless 使用软件渲染器执行当前 journey EBOOT，3,793 帧到达 `spyder_route1@14,19`，终态 SHA-256 为 `dd83a4af085f2beaef27e8e06c9832aba76e2a6b3d98fa31c608bede20c3cb8b`。校验同时确认回执中的构建 ID、源码身份、sidecar/内嵌 pak 哈希与 PSP double ABI 探针。

另用 capture EBOOT 导出第 23 帧并肉眼查看：480×272 画面中卧室、床、玩家、完整对话框和 “Do you want to skip” 文本均正常。语义像素断言固定了青色边框 `srgb(101,213,195)`、深色纸面 `srgb(16,43,58)`、文字 `srgb(245,241,215)`、卧室墙面和玩家头发，全部通过。

模拟器只证明功能、渲染和确定性，不作为 PSP 帧率证据。硬件数字沿用 PR 作者在 firmware 6.61、333/166 MHz 设备上的实测：各 300 帧窗口为 43.03–59.84 displayed fps；地图切换和首次纹理读取仍会停顿，完整 100 战主线尚未在实体 PSP 上运行。

## QuickJS 前后对比

基线为游戏提交 `29ad5a1b75745eb9c4ff9f67e6111808cada143d`；结果为合入当前 `main`、RPG Kit/PocketJS 和本次游戏仓改写后的同机 release QuickJS。三个宿主脚本都以 `cargo test --release --no-default-features` 构建，测量时没有并发重任务。

| 工作负载（480×272） | 升级前 | 升级后 | 变化 |
| --- | ---: | ---: | ---: |
| 独立 reducer，回合 mean（3,000 回合） | 0.793 ms | 0.185 ms | -76.7% |
| 独立 reducer，整场 mean（250 场） | 9.660 ms | 2.332 ms | -75.9% |
| 短旅程，稳定战斗帧 mean | 8.327 ms | 0.145 ms | -98.3% |
| 短旅程，回合帧 mean | 8.229 ms | 0.248 ms | -97.0% |
| 短旅程，进入战斗 total max | 23.935 ms | 19.395 ms | -19.0% |
| 短旅程，退出战斗 total max | 6.872 ms | 1.393 ms | -79.7% |
| 109,983 帧 GB6，稳定战斗帧 mean / p95 | 12.530 / 18.941 ms | 0.146 / 0.265 ms | -98.8% / -98.6% |
| GB6，100 次进入 mean / p95 / total max | 11.628 / 18.962 / 27.228 ms | 5.430 / 7.642 / 19.552 ms | -53.3% / -59.7% / -28.2% |
| GB6，100 次退出 mean / p95 / total max | 10.762 / 15.246 / 23.842 ms | 2.538 / 3.155 / 3.718 ms | -76.4% / -79.3% / -84.4% |
| GB6，全回放最慢 CPU 帧 | 34.368 ms | 32.489 ms | -5.5% |

短旅程的 960×544 最终门禁也通过：稳定战斗帧 mean 0.142 ms，进入/退出 CPU max 24.038 / 1.328 ms，全程 CPU max 24.038 ms。该尺度的单个冷进入帧比未含紧凑索引资源的旧基线高约 10%，但稳定帧下降约 98%，且仍有 25.962 ms 的 50 ms 预算余量。完整 GB6 的终态仍为 `a252d05f4f7922e7ff36f6ff11dfa81d538cf0d133915ef28dc8db009d21d982`。

## 视觉与确定性

RPG Kit 升级后的 PocketJS 隔离重复 sim 启动，旧章节 PNG 因此前缺少一致的昼光合成而失效。重新烘焙的 13 张图均逐张检查：地图几何、遮挡、NPC、玩家、对话与地标未移动；差异是当前 09:00 暖色 daylight layer 被一致合成。`verify:chapters` 证明 13 个快照、缩略图和 172,060 帧组合 tape 字节一致，所有后缀回放抵达终态 `52daead6527d`。

六张战斗 golden、同场景倒带像素和三轮延迟纹理释放均通过。完整 Tuxemon 对照覆盖 8,560 场战斗，冻结 trainer/policy 快照未改变。

## 验收

| 命令 | 结果 |
| --- | --- |
| `bun run import`（连续两次） | PASS；第二次无工作树差异 |
| `bunx tsc --noEmit` | PASS |
| `bun run build` | PASS；1× pak 39,021,296 B |
| `bun run build:wasm` | PASS |
| `bun run test` | PASS；285 tests，115,751 assertions |
| `bun run verify:chapters` | PASS；13 chapters，172,060 frames |
| `verify:gb6:mainline` | PASS；109,983 frames，100 battles |
| `verify:j1:mainline` | PASS；122,145 combined frames |
| `verify:j2:mainline` | PASS；172,060 combined frames |
| `verify:gb6:failures` | PASS；首次和 Route 3 后期失败路径均正确 |
| `verify:g6:locks` | PASS；334/334 动态检查，0 unresolved |
| `verify:g6:determinism` | PASS；两份隔离导入的 4,742 文件、61,678,333 B 完全一致 |
| `verify:g6:frozen` | PASS；263 maps，0 永久锁、0 永久阻塞 fiber、0 error |
| `bun run web` + web journey | PASS；3,793 frames、4 个关键帧、2× nearest-neighbour、0 console error |
| PSP build + PPSSPP journey + capture | PASS；sidecar 索引读取、3,793-frame terminal、double ABI 和语义像素均通过 |
| `bench:g6:quickjs` | PASS；两种分辨率和 263 图 staged cold path 均低于 50 ms |
| `bench:gb6:quickjs` | PASS；109,983 帧最慢 CPU 帧 32.489 ms |

`bun.lock` 未修改。没有 push、PR 或远端写操作。

subagent 使用：3 个 / 分别只读核对战斗差异、PSP/CI 差异、门禁与基准设计 / 并行审阅节省了前期对照时间，最终集成、视觉检查和所有重门禁均由主 agent 完成。

PASS
