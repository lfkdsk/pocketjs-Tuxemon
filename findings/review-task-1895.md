# 复审 GB-int 修复 1（task 1895）

审查对象为 `fleet/task-1881` 的 `0979e79..1d0240e`。本次按
`reviewer-generic.md`、`game-GBint-fix1.md` 和上一轮
`findings/review-task-1881.md` 逐项复核，并独立跑了真实 Tuxemon oracle、
三项 `scope` 变异、可覆盖根目录的 PocketJS QuickJS benchmark、双次导入、
构建、全测、8,560 场差分和 G6 门禁。

## 裁决

**FAIL。** GB1 测试管线、oracle 文件隔离、benchmark 脚本和全部运行门禁均已
修好，但 `scope` 测试仍使用双方全 10、无战斗修正的对称夹具，规格点名的三类
错误都无法使测试变红；此外，本轮新增提交信息仍含 fleet 任务号。两项都是明确
验收要求，故不能通过。

## 阻断项

### 1. `scope` 定向测试对三类关键错误均无辨识力

当前测试把唯一的 `BASE` 定义成六项全 10（`tests/battle-effects.test.ts:18`），
`snapshot()` 又把同一个对象同时给攻击方和目标（`:20-22`）。`scope` 用例没有给
目标设置任何 `stages` 或 `statusBoosts`（`:68-82`），最后只断言五项全 10
（`:96-103`）。因此它无法区分字段位置、攻击方/目标，也无法区分
`combatStats(target)` 与 `target.base`。

本审查逐项改坏 `battle/tuxemon.ts:829-830`，每次只保留一个变异并运行
`bun test tests/battle-effects.test.ts`：

| 变异 | 预期 | 实际 |
| --- | --- | --- |
| `armour` 与 `dodge` 对调 | scope 测试失败 | `3 pass / 0 fail / 8 expect()` |
| `combatStats(target)` 改成 `combatStats(user)` | scope 测试失败 | `3 pass / 0 fail / 8 expect()` |
| `combatStats(target)` 改成 `target.base` | scope 测试失败 | `3 pass / 0 fail / 8 expect()` |

三次测试都以 exit 0 结束，变异均已用 `apply_patch` 还原；随后
`git diff -- battle/tuxemon.ts` 无输出。该结果直接触发本复审规格的
“若现有测试抓不住，判阻断”。

独立 oracle 探针也证明现夹具不是有效替代。用已配置的 oracle venv 和钉住的
Tuxemon 源，`RNG.seed(1899)` 后实际创建 Spyder 数据库中的 `nut` L17 目标、
`rockitten` L13 攻击方，再直接调用 `ScopeEffect.apply_tech_target`，输出为：

```text
target nut L17 base/current-without-stage:
AR=199 DE=101 ME=109 RD=194 SD=107
attacker rockitten L13:
AR=88 DE=146 ME=163 RD=86 SD=151
extras=['AR:199 DE:101 ME:109 RD:194 SD:107']
```

五项互不相同，且攻击方也与目标不同。把相同目标快照交给 reducer，未加 stage
时得到同一组五项，说明当前实现的普通路径可以对上 oracle；欠缺的是把这个真实、
非 1 级、非对称事实固化进测试。

还有一个必须在修测试时明确的上游语义差异：给真实 `nut` 加 armour `+1` stage
和 speed `-1` stage 后，`target.get_combat_stats()` 是
`298/101/109/194/71`，但钉住源码的 `ScopeEffect` 仍输出基础值
`199/101/109/194/107`，因为它直接读 `target.armour` 等属性
（`/var/tmp/tuxemon-src/tuxemon/core/effects/scope.py:40-47`），而这些属性返回
`base_stats`（`/var/tmp/tuxemon-src/tuxemon/monster/monster.py:350-372`）。当前 reducer
在相同 stage 下输出 `298/101/109/194/71`。这与本复审规格要求“改成基础值的
变异应红”存在张力；无论最终选择严格复刻上游基础值还是保留战斗当前值，现有
全 10、无 stage 测试对两种语义都没有覆盖，必须先修正并记录决定。

### 2. 新增提交信息仍含 fleet 任务号

代码差异本身已清除任务号：

```text
$ git diff -U0 0979e79..HEAD -- battle tests tools importer | rg '^\+.*(1881|1895|/var/tmp/fleet/[0-9]+)' | wc -l
0
```

但同一范围的提交信息仍有三处命中：

```text
$ git log --format='%h%x09%s%n%b' 0979e79..HEAD | rg -n '(1881|1895|/var/tmp/fleet/[0-9]+)'
1:1d0240e  docs: record the review-1881 fix-1 pass in the GB-int report
3:review-task-1881.md was addressed: the scope technique's structured
9:bench-battle-quickjs.sh hardcoded /var/tmp/fleet/1881 for its scratch
```

`game-GBint-fix1.md` 的验收明确要求“新代码与提交信息无 fleet 任务号”，所以即使
脚本内容已经修正，当前提交历史仍不成立。需重写这些提交主题/正文，并同时避免把
未经复审通过写成 `pass`。

## 三项修复逐条复核

| 修复项 | 结论 | 独立证据 |
| --- | --- | --- |
| `scope` 事件携带五项结构化数值 | 部分成立 | `battle/tuxemon.ts:825-854` 调用 `combatStats(target)` 并仅在 scope 时附加 `scope`；真实无 stage 的 `nut` L17 oracle 与 reducer 都给出 `199/101/109/194/107`。但测试的三类变异全部漏检，见阻断项 1。 |
| 普通规则测试走 GB1 管线 | 成立 | `tests/battle-effects.test.ts:3-17` 从 `data/battle-db.json` 经 `validateBattleDb`、`battleDbToTuxemonBattleDb` 构造 DB；定向测试 `3 pass / 0 fail`。 |
| oracle JSON 只供差分与字段等价 | 成立 | `rg -l 'tuxemon-battle.json' --glob '*.ts' --glob '!node_modules/**' --glob '!vendor/**' .` 只输出 `tests/battle-golden.test.ts` 与 `tests/battle-db-adapter.test.ts`。QuickJS entry 和普通规则测试均走 GB1。 |
| benchmark 脚本无任务号、根目录可覆盖 | 成立 | `tools/bench-battle-quickjs.sh:4-11` 由 `${BATTLE_BENCH_ROOT:-/var/tmp/fleet/pocket-tuxemon/battle-bench}` 派生 scratch/target/bundle；新增代码任务号 grep 为 0。 |
| benchmark 能在真实 QuickJS 跑通 | 成立 | 以 `BATTLE_BENCH_ROOT=/var/tmp/fleet/pocket-tuxemon/review-battle-bench` 执行脚本：250 battles、2,750 rounds，round mean `0.594529 ms`、p95 `0.835739 ms`、max `1.292585 ms`，Rust test `1 passed / 0 failed`。 |
| 三项修复分别提交 | 成立 | `9fa0d43`（GB1 测试管线）、`924796c`（scope readout）、`0b73561`（benchmark 路径）各自独立；另有 `1d0240e` 报告提交。提交信息任务号违规另见阻断项 2。 |
| `findings/GB-int.md` 有“修复 1”记录 | 成立 | `findings/GB-int.md:88-116`。其中 oracle 夹具和验证结论没有发现本次三项变异盲区。 |

## 独立门禁

| 命令 | 结果 |
| --- | --- |
| `bun run import` 连续两次，并在每次后运行 `git status --short`、`git diff --exit-code` | 两次 exit 0；两次均 `status-lines=0`；每次均报告 263 maps、430 TILESET entries、214 monsters、230 techniques、511 textures、24,498,560 battle-only pak bytes。 |
| `bunx tsc --noEmit` | exit 0，无诊断。 |
| `bun run build` | exit 0；2,891 pak entries、50,765,072 bytes；`dist/main.js` 19,330,894 bytes。 |
| build 后 `bun test` | 63 pass、0 fail、48,112 assertions、12 files；`G6 built bundle deterministic replay` 实际运行并通过，未跳过。 |
| 适配后的 GB1 数据独立重放差分 | `{"cases":8560,"identical":8560,"different":0}`。 |
| `bun run verify:g6:locks` | 323/323 dynamic checks；unresolved=0、error=0、exceptions=0。 |
| `bun run verify:g6:determinism` | PASS；isolatedRoots=2、files=2,902、bytes=49,350,838、SHA-256 `edd2e4d5e7aa26cbbe93fd88b84118f5f6dd5a85879cdf1395cf54c4abfa68b4`。 |
| `git diff --name-only 0979e79..HEAD -- bun.lock vendor/` | 无输出；`bun.lock` 与 `vendor/` 未改。 |
| `git ls-files` 扫描 `__pycache__` / `.pyc` | 0。 |
| `git diff --check 0979e79..HEAD` | exit 0，无输出。 |
| 最终 `git status --short`（写审查报告前） | 0 行；所有临时变异均已还原。 |

## 画面与导入原则

本修复只改变 reducer 事件数据、规则测试和 benchmark scratch 路径，没有新增或
修改渲染产物，因此没有新的 PNG 可做肉眼验收。双次完整自动导入均 clean；本轮
没有逐图手改、没有把 Tuxemon 专用实现写入组件仓，也没有改 `vendor/pocketjs`。

FAIL
