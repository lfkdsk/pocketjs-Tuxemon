# GB6-F2 收窄并前移（forward-port 到公开 main）

分支 `fleet/task-1976-fwd`，基线公开 main `588f60b`。把旧分支（已重写历史）上 GB6-F2
被审查接受的部分前移，放弃被否定的 Wayfarer 必经证明。

## 移植的提交（4 个代码 + 1 个文档）

| 新提交 | 内容 | 旧提交 |
| --- | --- | --- |
| `5a62af1` | test(battle): pin autoplay threshold boundaries and tie-break conventions | `6ecb17b` |
| `b7b3fa9` | test: bucket QuickJS battle frames by party size, event, and menu mode | `c288a00` |
| `453ad94` | test: assert the QuickJS frame budget on thread CPU time, not wall clock | `d8978d6` |
| `2873458` | test: inject sleep to prove the CPU-time frame budget ignores descheduling | `35ce751` |
| `bae5be6` | docs: narrow the Wayfarer claim to a tape route choice and port GB6-F2 | — |

移植方式：`git diff <父>..<提交> -- <文件> | git apply -3`。main 的 `g6-quickjs-bench.rs`
与旧基线有注释级漂移（公开仓卫生删掉了注释里的 findings 引用），三方合并干净落地。
三个 bench 提交注释里的审查任务号引用（`review-task-1976 §4`）在移植时去掉，代码逻辑零改动。

## 未移植（按 commander 决定）

- `tools/wayfarer-inn-proof.ts` + `tests/wayfarer-inn-proof.test.ts`（静态 BFS 证明）
- `tools/wayfarer-state-reach.ts` + `tests/wayfarer-state-reach.test.ts`（按状态重算）

两次证明都被审查判定建模不完整（`findings/review-task-1976.md`、`findings/review-task-2001.md`），
保留工具会暗示被否定的结论仍成立。`findings/GB6.md` 与 `findings/GB6-F2.md` 的表述收窄为
「tape 选择了经过 Wayfarer Inn 的路线（3 场额外训练师战）；是否存在绕行未证明」。

## 验收（全部通过）

| 门禁 | 结果 |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` / `build:wasm` | exit 0；pak 4,623 entries / 62,742,928 bytes；wasm 289,808 bytes |
| `bun test` | 193 pass / 0 fail / 0 skip，71,217 assertions，37 files |
| `verify:gb6:mainline` | PASS；109,983 帧，100 场（22 trainer + 78 wild），终态 `d62d1465…` |
| `verify:gb6:failures` | PASS；首战败线 3,254 帧 + Wanda 败线 65,515 帧 |
| `bun run import` ×2 | tracked 文件 0 diff（字节稳定） |
| `bun tools/desktop.ts --build-only` | exit 0；release host 构建成功 |
| `bench-g6-quickjs.sh` 两视口 | 480×272 battle-entry CPU 22.180 ms、960×544 27.103 ms，均 PASS；终态 `5653f011…`；map_first_visits 263 图 non_exempt_max 46.063 ms |
| 注入复验 | sleep 120 ms @f2091：墙钟 22.2→142.5 ms、CPU 22.4 ms 不变、PASS；CPU 80 ms @f2091：CPU 102.540 ms、断言变红 exit 101 |
| 分桶模式 | `G6_BATTLE_BUCKETS=1`：9 组 1,132 帧，technique p95 11.952 ms（默认关闭） |
| 卫生 | 代码/测试/非 findings 文档/提交信息无任务号、本机路径；`bun.lock`、`vendor/` 无改动 |

帧号注记：短 journey 的 battle-entry 帧重新推导为 f2091（注入自证）。长 journey tape 在公开
main 上整体 +2 帧（109,981→109,983），印证 review-task-2001 的「帧号写死漂移」——未移植的
Wayfarer 工具正坐这个病。

## subagent 使用

0 个。本任务是线性的移植 + 门禁串行链，重活（build/test/bench）按规矩只能主 agent 串行跑，
无可并行切块；侦察（diff 面、文档对照）主 agent 直接做更快。
