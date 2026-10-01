# Review task-2234：DW-G 游戏仓战斗性能 + PSP 构建

审查对象：worktree `fleet/task-2234`（HEAD `304f8ca`，基线 `origin/main` = `bf79f29`，8 个提交）。
规格：`/var/tmp/fleet-specs/pocket-tuxemon/dw/game-DW-G.md`；builder 报告：`findings/DW-G.md`。
审查方法：3 个只读 subagent 并行核对（移植对照 / 战斗实现 / PSP+CI），主 agent 亲自复跑全部门禁、变异、基准、PSP 回放与截图。

## 结论

战斗性能移植与 PSP 构建本身质量高：8,560 场 Python 对照、六帧双分辨率 golden、倒带像素、纹理生命周期测试全绿；我独立复跑 QuickJS 两档基准（最慢帧 32.64 / 47.03 ms，均 < 50 ms）；我独立构建 journey EBOOT 并用 PPSSPPHeadless 复现终态哈希 `dd83a4af…`（与报告逐字一致）；战斗与 PSP 截图肉眼核对正确。

但 **PSP CI job 在 stock ubuntu-latest 上必挂**（缺 `llvm-ar`），builder 报告称「可行」与实测不符——见阻断项。

## 阻断项

### B1. PSP CI job 缺少 `llvm-ar`，`bun run bootstrap` 必失败

`.github/workflows/ci.yml` 的 `psp` job（L149-179）在 `ubuntu-latest` 上跑 `bun run bootstrap`（pocketjs 目录）再 `bun run build:psp --skip-assets`。证据链：

1. `vendor/pocket-rpgkit/vendor/pocketjs/tools/psp-toolchain.ts:336` `resolveLlvmBin`：无 `POCKETJS_LLVM_BIN` 时要求 PATH 中**同目录**有 `clang` 与 `llvm-ar`，否则返回 `undefined`。
2. `vendor/pocket-rpgkit/vendor/pocketjs/tools/bootstrap.ts:175` 记录 `LLVM fail`，`:271-276` 任一 fail 即 `process.exit(1)`。
3. `tools/psp.ts:54-59` 的 realpath 技巧（`/usr/bin/clang` → `/usr/lib/llvm-18/bin`）随后检查同目录 `llvm-ar`；`tools/psp.ts:80` 缺任一工具即 `throw "PSP LLVM tool is missing"`。
4. GitHub `ubuntu-24.04` 镜像 **x64 不装 `llvm` 元包**：`actions/runner-images` 的 `install-clang.sh` 仅在 arm64 装 `llvm-$version`；`toolset-2404.json` 无任何 llvm 包。
5. `clang-18` 依赖的 `llvm-18-linker-tools` 只含 5 个文件（LLVMgold/LLVMPolly/libLTO + docs），**不含 `llvm-ar`/`llvm-ranlib`/`llvm-objcopy`**（packages.ubuntu.com 文件清单确认）。
6. 本机旁证：`which clang` = `/usr/bin/clang`，`which llvm-ar` 为空；本机能构建是因为装了完整 `llvm-18` 包（runner 没有）。

即 job 会在「Install and verify the pinned PSP toolchain」步 `exit(1)`。`findings/DW-G.md:21` 称 ci.yml「可行」错误。修复一行：job 内加 `sudo apt-get install -y llvm`（或 `llvm-18`），或把 `POCKETJS_LLVM_BIN` 指向含 clang+llvm-ar 的目录。该 job 从未在 GitHub 上跑过（分支未 push），builder 未实测即判定可行。

## 逐条规格对照

| 规格条目 | 判定 | 证据 |
| --- | --- | --- |
| 升级组件仓子模块到 main 最新（含 DW-K） | 成立 | 指针 `2e10436→58ee468` 纯升级无夹带；区间含 `697ef59d`（DW-K 不可变会话状态）、`b5bf642a`、`a46f1933`（锁 PSP PocketJS）。`bun run build:wasm` PASS |
| golden 变化逐张看、写原因 | 成立 | 13 张章节 PNG + `data/chapters.json` + `g6-assets-report.json`。我对比 route-1 新旧：几何完全一致，差异仅 09:00 暖色昼光色阶（kit `3758d292` 隔离 sim 启动后昼光层一致合成）。`verify:chapters` PASS |
| 战斗性能移植（6 文件 + 2 新文件 + 3 测试） | 成立 | `battle/runtime.ts`/`stats.ts`/`presentation.ts` 与 PR 逐字一致；`tuxemon.ts` COW 加深、`extension.ts` 适配 main 新语义（音频/选择框/改名/图鉴）、`battle-scene.tsx` 稳定节点+增量 paint 与 LazyImage 缓存合并；新 `ui/battle-paint.ts`。无 PR 关键能力丢失（SA2 逐行审查） |
| 8,560 场与 Tuxemon Python 一致保持 | 成立 | 两处对照（`battle-golden.test.ts` 用 oracle fixture、`battle-db-adapter.test.ts` 用生产适配数据）各跑 8,560 例；golden 由 `generate_spyder.py`（真 Python 引擎，钉 9e6258ff）产出。`bun test` 全绿 |
| 每组改动一个提交，Yifeng 署名，无 AI 尾注 | 成立 | 4 个移植提交 author = Yifeng "Evan" Wang（committer lfkdsk）；3 个跟进提交 + merge 为 lfkdsk 自著（正确归属）；8 个提交均无 Co-Authored-By/任务号 |
| PSP 构建（tools/psp.ts + verify-psp-journey + package.json + gitignore + README） | 成立 | sidecar pak 按索引读取（pak_external.rs 二分查找+seek）、构建回执、session/buildId/ABI/新鲜度校验齐全；`.gitignore` 加 `.pocket-build/`；README PSP 节与实现一致 |
| CI 加 PSP job 并评估可行性 | **不成立** | 见阻断项 B1。job 结构本身合理（独立 job、缓存、上传 artifact、deploy 依赖），但工具链缺 `llvm-ar` 跑不起来 |
| QuickJS 战斗进入/退出/回合帧前后对比，GB6 最慢帧 < 50 ms | 成立（960 档裕量小） | 见性能节。480 档 32.64 ms 与报告 32.489 ms 一致；960 档 47.03 ms 达标但一次噪声跑 63 ms |
| 桌面基准脚本保持 `--no-default-features` | 成立 | `tools/g6-quickjs-bench.rs` 与 bench 脚本未改该 flag |
| docs/status.md PSP 行改实际状态、性能行更新 | 成立 | PSP Planned→Partial（EBOOT/sidecar/3,793 帧 journey/硬件 43-60fps/限制写清）；性能行更新为 0.265 ms p95 / 32.489 ms 等新数字 |
| 交付前再合一次 main | 成立（main 未前进） | `origin/main` 仍在 `bf79f29`，分支已含 main（merge 92771c6）；临时副本 merge「Already up to date」 |
| `bun run import` ×2 字节一致 | 成立 | 两次 exit 0，第二次后 `git status` 为空 |
| `bun.lock` 不改 | 成立 | `git status` 全程干净，无 bun.lock 改动 |
| 提交信息不写任务号与本机路径 | 成立 | 8 个提交信息均为 conventional-commit 单行，无任务号/路径 |

## 门禁复跑（主 agent 亲自跑，TUXEMON_SRC=/var/tmp/tuxemon-src）

| 命令 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | PASS（5.3 s，exit 0） |
| `bun run import` ×2 | PASS；第二次后无工作树差异 |
| `bun run build` | PASS；pak 39,021,296 B（与报告一致） |
| `bun run build:wasm` | PASS（wasm 已最新） |
| `bun run test` | PASS；285 pass / 0 fail / 115,751 assertions（132 s） |
| `verify:chapters` | PASS；13 chapters / 172,060 帧 / 终态 52daead6527d |
| `verify:gb6:mainline` | PASS；109,983 帧 / 100 战 / 终态 a252d05f… |
| `verify:gb6:failures` | PASS；首次与 Route 3 后期失败路径均正确 |
| `verify:j1:mainline` | PASS；122,145 combined frames |
| `verify:j2:mainline` | PASS；172,060 combined frames |
| `verify:g6:locks` | PASS；334/334 动态检查，0 unresolved |
| `verify:g6:determinism` | PASS；2 隔离导入 4,742 文件 / 61,678,333 B 一致 |
| `verify:g6:frozen` | PASS；263 图，0 永久锁 / 0 阻塞 fiber / 0 error |
| `bun run web` + web journey | PASS；3,793 帧 / 0 console error / 像素哈希一致 |

## 变异测试（隔离副本 /var/tmp/fleet/2244/mut-1，已还原删除）

| 变异 | 改法 | 结果 |
| --- | --- | --- |
| (a) 战斗绘制缓存不失效 | 删 `ui/battle-paint.ts:68` 的 `state.eventCursor !== prior.eventCursor` 条件 | `battle-presentation.test.ts`「incremental battle paint matches full projection at every tick and on rewind」**变红**（4 pass / 1 fail） |
| (b) 队伍图标不按槽更新 | `partyIcon` 恒取 `parties[side][0]` | `battle-presentation-sim.test.ts`「six checkpoints match committed pixels」与「README battle screenshot exact 2x」**变红**（5 pass / 2 fail，exactRatio 1→0.9887） |

另发现一个测试盲区（非阻断）：更弱的变异「增量路径图标恒用 previous」不变红——fixture 的图标变化都落在 cursor 边界（边界已全量重算），HP 补间跨 0 的中段图标翻转未被覆盖。建议补一个在 technique HP 窗口内击杀的 fixture。

## 画面核对（主 agent 自己截图、3 倍放大查看）

- **战斗 480×272**（main-menu/hit/faint/level-up 四帧）：敌我怪物、HP 条、队伍图标盘（1 实+5 空槽）、Fight/Swap/Item/Forfeit 菜单、Bullet 特效与伤害、faint 下沉淡出、升级 Lv6/HP 上限 101→109/XP 条——全部正确。
- **战斗 960×544**：480×272 的精确 2x 构图，文字按目标尺度光栅化（与 `twoXSimilarity` 设计一致）。
- **PSP 开局**（capture EBOOT 第 23 帧）：卧室、床、电脑、玩家、完整对话框、"Do you want to skip" 文本正常。
- **PSP Route 1**（把 journey tape 烤进 capture EBOOT，窗口 3700-3731）：Paper Town 夜景、房屋、NPC、玩家行走、昼夜光照正确。

## 性能（QuickJS 桌面宿主，主 agent 复跑）

| 工作负载 | 报告（升级后） | 我复跑 | 判定 |
| --- | --- | --- | --- |
| GB6 480×272 全回放最慢 CPU 帧 | 32.489 ms | 32.640 ms（干净重跑；首次 48 ms 系编译干扰） | 一致 |
| GB6 960×544 全回放最慢 CPU 帧 | （报告只给短旅程 24.038 ms） | 47.029 ms（< 50 ms；一次噪声跑 63 ms 触发预算 panic） | 达标，裕量小 |
| 战斗稳定帧 mean/p95（480） | 0.146 / 0.265 ms | 0.156 / 0.299 ms | 同量级（较基线 12.5 ms 降 ~98.8%） |
| 战斗进入 mean/p95/max（480） | 5.430 / 7.642 / 19.552 ms | 6.277 / 9.999 / 18.662 ms | 同量级 |
| 战斗退出 mean/max（480） | 2.538 / 3.718 ms | 2.980 / 4.972 ms | 同量级 |
| 终态 sha256 | a252d05f… | a252d05f… | 一致 |

测量时无 subagent 在跑命令。960×544 的冷首战帧（f2091）是瓶颈，两次跑分别 26.5 / 31.2 ms（battle-entry 桶），全回放桶最大 47-63 ms 波动；480×272 是 PSP 实机目标分辨率，达标且与报告一致。

## PSP（主 agent 独立构建 + 回放）

- `bun run build:psp --journey`：EBOOT 4,821,872 B、sidecar assets.pak 39,021,296 B、boot pak 992,608 B——与报告字节数逐字一致。
- PPSSPPHeadless（软件渲染器）跑我自己的全新构建：3,793 帧到 `spyder_route1@14,19`（`defeated.spyder_billie=true`），`verify:psp:journey` 输出 **PASS**，终态 `dd83a4af085f2beaef27e8e06c9832aba76e2a6b3d98fa31c608bede20c3cb8b` 与报告逐字一致；session/abi 标记、double ABI 探针、buildId 校验均通过。
- 模拟器只证明功能/渲染/确定性，不作为帧率证据——报告对此边界诚实。
- 注：`--journey` 隐含 benchmark，与 `--capture` 互斥（builder 设计）；为截 Route 1 我把 journey tape 烤进 `POCKETJS_CAPTURE_INPUT` 单独构建，属审查手段，未改被审代码。

## 组件仓升级

见对照表。子模块纯指针升级；golden 变化逐项有理由（昼光色阶，几何不变）。

## merge main

`origin/main` 未前进（仍 `bf79f29`），分支已含 main；临时副本 merge「Already up to date」，无冲突，门禁全绿（即分支自身门禁）。

## 次要发现（非阻断）

1. `docs/ci.md:6-8` 仍称「最慢的 journey leg 决定墙钟」——加入无 target 缓存的 psp job（冷 25-40 min）后已过时。
2. `README:177` 未说明 macOS 默认 GCC 路径仅支持 Apple Silicon（SDK 内 `psp-gcc` 是 arm64 Mach-O，Intel Mac 不可用）。
3. 增量 paint 测试盲区（见变异节）。
4. 960×544 冷首战帧裕量小（47 ms，噪声跑曾 63 ms）。
5. 代码质量（SA2）：`battle-scene.tsx:299` 死参数 `monster`；`battle-paint.ts:69` swap 硬编码 `22` 与同文件 `SEND_OUT_RELEASE_TICK` 常量不一致；`messageTick` 阈值与 `eventMessage` 重复维护。

## subagent 使用

3 个 / SA1 移植对照与提交卫生（25 文件处置表、署名、尾注、忠实度抽查）、SA2 战斗实现逐行审查与变异点定位、SA3 PSP 工具链与 CI 可行性分析（发现 B1 阻断项）/ 并行只读核对节省了前期对照时间，主 agent 核实了全部关键结论（CI 阻断项经 runner-images 源码 + packages.ubuntu.com + 本机三重确认）并完成所有重门禁、变异、基准、PSP 回放与截图。

FAIL
