# Review：K1 事件模型扩展（task 1792 起头 + task 1815 续做），提交 `6105544`

审查任务 1821。对象：worktree `~/.fleet/worktrees/task-1792`，`HEAD = 6105544`，
merge-base `5dd48ef`（组件仓 `main`）。单个提交 `feat(engine): extend RPG event model`，
作者 `lfkdsk <lfkdsk@gmail.com>`，无 Co-Authored-By；20 个文件 +1956/−72。
规格：`kit-K1-events.md`、`kit-K1-continue.md`、`reviewer-generic.md`。

## 0. 结论

PASS。六项能力（T2-1 区域、T2-2 `all`、T2-3 朝向 + 转身重触发、T2-6 `local.`、
T2-7 `place` + 页 `dir`、T2-8 输入锁）全部实现且与 Scout S1 §4–§6 的语义一致；S1
§10 原型实锤的缺口①②③在真实 reducer 上用我自己写的探针复核通过；三道门禁自己复跑
全绿；QuickJS 复测两次，300 个区域事件每帧 p95 ≈ 0.03 ms，远低于 1 ms 目标；旧 v1
工程与基线引擎生成的旧存档照常加载；新增行里没有 fleet 任务号；`vendor/pocketjs`
未被提交。非阻断问题 5 条（§9），主要是 sim 旅程对 T2-2 / T2-3 没有判别力。

## 1. 方法

- 读全部 diff（`git diff 5dd48ef HEAD`）与 `findings/K1.md`。
- 复跑 `bun run build:example`、`bun test`、`bunx tsc --noEmit`。
- 8 处变异：每处改坏实现 → 重建 `event-model` fixture bundle → 跑
  `tests/k1-events.test.ts tests/k1-events-sim.test.ts`（或 save 测试）→ `git checkout` 还原。
- QuickJS bench 用 builder 的宿主 crate 拷贝（`/var/tmp/fleet/1815/host-bench`，未提交的
  任务临时物）复跑两次，bundle 指向我自己的拷贝以免与变异重建冲突。
- 自写探针 8 个（S1 缺口①②③、锁生命周期、基线存档跨版本读取、越界放置、锁住时存档）。
- 肉眼看 builder 渲染的最终帧 PNG。
- 临时文件全部在 `/var/tmp/fleet/1821/`（`mutate.sh`、`mutations.log`、
  `qjs-bench-run{1,2}.log`、`s1-gaps.test.ts`、`cross-version-save.test.ts`、
  `robustness.test.ts`、`base/`）。

## 2. 门禁（自己复跑）

```text
$ bun run build:example        exit 0（4 examples + editor + ui-theme + event-model）
$ bun test                     584 pass / 0 fail / 454800 expect() calls
                               Ran 584 tests across 31 files. [78.61s]
$ bunx tsc --noEmit            exit 0
```

- 584 = 基线 548 + 新增 36（`tests/k1-events.test.ts` 22、`tests/k1-events-sim.test.ts` 4、
  `tests/save.test.ts` 新增 10）。无 skip。
- goldens：`git diff --name-only 5dd48ef HEAD | grep -iE 'golden|\.png$'` 为空；跑完测试
  `git status --short` 仅 `T vendor/pocketjs`（既有软链接类型变更，未暂存）与 `?? node_modules`。
- fixture 字节稳定：我干净构建的 `dist/event-model.js` / `.pak` sha256 =
  `0da83e3071cec08df469b106b9262923480b2271092e23cc734f337777136747` /
  `fd0806daa59dc5e9953f2c852fbdb1123ba1b40d2543dc5021afbebba4cafaf7`，与 `findings/K1.md`
  报告的一致；变异脚本末尾再次重建仍是这两个值。

## 3. 原规格逐条对照

| 规格项 | 结论 | 证据 |
| --- | --- | --- |
| T2-1 事件区域 `w`/`h`，touch 进区域任一格、action 面向区域任一格 | 成立 | `src/engine/types.ts` `GameEvent.w/h`；`interpreter.ts:707` `eventRect`；`:848-870` action 用面前格或所在格、touch 每进一格一次；`createWorld` 把区域编进 per-cell 索引（`triggerCandidates` `:731`）；schema `w`/`h` `minimum: 1`；单测 `tests/k1-events.test.ts:107`（3 宽条带 3 次 + 折返 3 次）；sim fixture `strip` w=2 → `area-hits = 2` |
| T2-2 `all: [...]` AND，元素为现有条件，单条件写法仍有效 | 成立 | `interpreter.ts:183`；`Condition` 联合含 `switch value:false`；schema `condition.all` `$ref #/$defs/condition`；单测 `:205`（每个子句都成立才激活）、"the flat fields AND with all" |
| T2-3 玩家朝向条件 + 原地转身是否重评估 playerTouch | 成立 | `interpreter.ts:141` `facing` 条件；`:868` `turnEdge = turned && !moved && pageReadsFacing(page)`（只对 `all` 里含 facing 的 touch 页）；`session.ts:361/410` `prevFacing` 按参考 tick 采样（多 hz 一致）；单测 `:261` 侧向穿过不触发、转身触发、转开再转回再触发 |
| T2-6 `local.` 每次进图清零 | 成立 | `session.ts:196` `clearLocalBank`，`:216` `enterMap`（含同图 transfer），`:163` `startSession(sw0)`；单测 `:365`；sim 的 `initial-locals-cleared` / `transfer-cleared-locals` |
| T2-7 `place`（setEventLocation）+ 页 `dir` | 成立 | `interpreter.ts:1068` `place` → `placements`（本次访问持久）+ `pendingPlacements`；`session.ts:466` `placeChar`，被顶掉的 wait 路线 waiter 被恢复；`chars.ts:161` 出生朝向 `placed.dir > page.dir > down`，`:201` 换页重设朝向；单测 `:403/426/435`（含"尚无角色的事件在新格出生"） |
| T2-8 `lockInput`/`unlockInput` 跨事件；锁住不能移动/不能 action；autorun/parallel 照常 | 成立 | `interpreter.ts:848` action 在锁住时不启动；`session.ts:364` mover 冻结；parallel/autorun 不看锁；单测 `:477`；sim 首个测试（像素级不动 + 确认被吞 + parallel 解锁） |
| 同步改 types / schema / CHANGELOG / interpreter / session / movement / 存档与校验 | 成立 | `schema.json` 与 `editor/engine/projects.ts` `PROJECT_SCHEMA` 同步（`tests/editor-model.test.ts:64` 相等断言）；`src/data/CHANGELOG.md:47` v1 amendment；`save-validate.ts:82/239/395/512-526`；`save.ts:323` 旧存档补默认；锁的判断放在 `session.ts` 而非 `movement.ts`（纯 mover 不必改，可接受） |
| 每项 ≥1 单测 + ≥1 sim；多 hz（60/30/20/4）与两遍哈希一致 | 部分 | 单测：每项都有；sim：4 个测试存在（`k1-events-sim.test.ts:135/150/166/174`）且对 T2-1/T2-6/T2-7/T2-8 有判别力，但对 T2-2/T2-3 **无判别力**（§6 M1、M2） |
| 548 全绿、goldens 不变、tsc exit 0 | 成立 | §2 |
| QuickJS 100×100 / 300 区域事件每帧耗时，p95 ≤ 1 ms | 成立 | §5 |
| README / `src/engine/README.md` 补说明 | 成立 | `README.md:238` "The 18 commands"、`:257`；`src/engine/README.md:80-104` |
| 报告 `findings/K1.md` | 成立 | 已提交，数字与我复跑一致 |

续做规格（`kit-K1-continue.md`）：

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 存档中途读档一致的 sim | 成立 | `k1-events-sim.test.ts:174`（读档后状态序列与帧哈希序列相等；M3/M5/M6/M6b 都能让它变红） |
| 清掉代码/文档里的任务号 | 成立 | `git diff 5dd48ef HEAD \| grep '^+' \| grep -nE 'task[- ]?[0-9]{3,4}\|\b1792\b\|\b1815\b\|fleet'` 无命中（exit 1）；`K1`/`T2-x` 仅出现在 CHANGELOG 说明与测试文件名/注释，规格允许 |
| `vendor/pocketjs` 不提交类型变更 | 成立 | `git ls-tree HEAD vendor/pocketjs` = `160000 commit 76ae741f…`，与 `5dd48ef` 相同；工作区的 `T vendor/pocketjs` 未暂存 |
| 提交风格 / 作者 | 成立 | `feat(engine): extend RPG event model`，`lfkdsk <lfkdsk@gmail.com>`，无尾注 |

## 4. 额外核对

### 4.1 与 Scout S1 的一致性；缺口①②③

探针 `/var/tmp/fleet/1821/s1-gaps.test.ts`（`bun test` → 4 pass / 0 fail）：

- **缺口①**（侧向走过 1 格宽出口垫就出了门）：出口垫页条件 `all:[{kind:"facing",dir:"down"}]`，
  在完整 `stepSession` 里按住 RIGHT 沿底行穿过垫子 → 仍在原图；走回垫上停下，按 DOWN（下方越界，
  mover 只转身）→ 下一帧已 transfer。修掉了。变异 M1 证明 `tests/k1-events.test.ts:261` 守住它。
- **缺口②**（叠在同一区域上的两个守卫互补的 touch 事件，第一个的 `if` 吃掉触发）：`a`（`met==1`）
  与 `b`（`met==0`）叠同一 3×3 区域；首次进入启动 `b`（虽然 `a` 的 id 排前，`activePage` 为 null 被跳过），
  `b` 置 `met=1` 后下一步进入启动 `a`。修掉了，不再需要 S1 §4.1 的合并降级。
- **缺口③**（派生开关每两帧更新一次导致 autorun 重跑）：autorun 页条件 `all:[chapter, seen==0]`，
  守卫不成立时不空转也不挡旁边 sign 的 action；成立后恰好跑 1 次、自己把 `seen` 置 1，`interp.main`
  归零不重跑。T2-2 让 autorun 页条件装下全部守卫，派生开关及其滞后问题不再存在。
- S1 T2 清单逐项：T2-1 "faced tile or own tile / every entry into a cell of the rect" 一致；
  T2-2 含 `switch value:false` 一致；T2-3 "re-fires when the player turns while standing in it" 一致
  （限定为 `all` 含 facing 的 touch 页，合理）；T2-6 一致；T2-7 `{op:"place", target, x, y, dir?}` +
  `page.dir` 一致；T2-8 命名按 K1 规格用 `lockInput`/`unlockInput`（S1 草案写的是 `{op:'lock', value}`，
  以规格为准）。

### 4.2 向后兼容

- 旧 v1 工程：新增字段/命令全部可选；4 个 examples、editor、ui-theme 照常构建，其 sim / golden /
  schema 测试都在 584 里；`tests/editor-model.test.ts:64` 断言编辑器内置 schema 与 normative
  `schema.json` 相等。
- 旧存档：`git archive 5dd48ef src/engine` 取出基线引擎，用它生成 envelope（确认 JSON 里没有
  `inputLocked` / `placements` / `pendingPlacements`），新引擎 `decodeEnvelopeText` 读取成功，
  `validateSnapshot` 返回 null，补出 `false` / `{}` / `[]`；中途存档里的 `local.*` 值保留（读档不是
  进图，正确）。探针 `/var/tmp/fleet/1821/cross-version-save.test.ts` 1 pass。变异 M7 去掉
  `hydrateLegacyV1` 后它与 `tests/save.test.ts:289` 同时变红。
- 锁住时存档：`canSave` 为 true，读档后仍锁住、按方向键不动（`robustness.test.ts`）。

### 4.3 sim 是否真的覆盖新能力 —— 见 §6

### 4.4 任务号 / `vendor/pocketjs` —— 见 §3 续做表

## 5. QuickJS bench（复跑两次）

harness：`/var/tmp/fleet/1815/host-bench`（桌面宿主 crate 拷贝 + `src/event_model_bench.rs`，
release 构建，QuickJS guest，480×272），`POCKETJS_DIST` 指向我复制的 bundle。

```sh
BENCH_FRAMES=10000 BENCH_WARMUP=1000 POCKETJS_DIST=/var/tmp/fleet/1821/dist \
  cargo test --release event_model_bench::area_scan -- --ignored --exact --nocapture
```

| run | case | mean | p50 | p95 | p99 | max |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | empty (0 events) | 0.0256 ms | 0.0236 | 0.0303 | 0.0392 | 2.2130 |
| 1 | 300 area events | 0.0324 ms | 0.0298 | 0.0378 | 0.0510 | 2.6203 |
| 2 | empty (0 events) | 0.0251 ms | 0.0233 | 0.0273 | 0.0358 | 2.1378 |
| 2 | 300 area events | 0.0314 ms | 0.0297 | 0.0317 | 0.0411 | 2.2705 |

area-minus-empty p95：0.0075 ms / 0.0044 ms（builder 报 0.0037 ms）。目标 p95 ≤ 1 ms 成立。
注意两点：max 2.2–2.6 ms 在空图同样出现，是 QuickJS GC / 宿主抖动，不是扫描；bench 场景是玩家
静止在 `area-000` 内，每帧只有 1 个空间候选，靠 `createWorld` 的 per-cell 索引做到 O(候选) 而非
O(事件)；被 `place` 过或正在移动的事件每帧都进候选（`triggerCandidates`），这条路径未单独量过，
按代码是 O(placed + moving)，对 Tuxemon 的量级（每图几十个 NPC）不构成风险。

## 6. 变异检查

脚本 `/var/tmp/fleet/1821/mutate.sh`，日志 `/var/tmp/fleet/1821/mutations.log`。每处：改坏 →
`bun tools/build-example.ts event-model` 重建 bundle → 跑单测 + sim → `git checkout` 还原。

| # | 变异 | 单测（pure reducer） | sim（真实 bundle） |
| --- | --- | --- | --- |
| M1 | `turnEdge = false`（缺口①的转身重触发） | 红 1 | **绿**（无判别力） |
| M2 | 忽略 `condition.all` | 红 4 | **绿**（无判别力） |
| M3 | `enterMap` 不清 `local.` | 红 1 | 红 3（多 hz / 两遍哈希 / 中途读档） |
| M4 | mover 忽略 `inputLocked` | 红 1 | 红 1 |
| M5 | 区域退化为 1×1 | 红 3 | 红 3 |
| M6 | `place` 忽略 `dir` | 红 1 | 红 3 |
| M6b | `place` 不记 durable placement | 红 2 | 红 3 |
| M7 | 去掉旧存档 `hydrateLegacyV1` | `save.test.ts` 红 1 + 跨版本探针红 1 | — |

还原后 `git status --short` 仅 `T vendor/pocketjs` 与 `?? node_modules`，`git diff --stat` 只有
既有的 `vendor/pocketjs` 软链接类型变更，fixture 哈希复原为 §2 的两个值。

## 7. 画面

`/var/tmp/fleet/1815/event-model-final.png`（builder 用 `capture-event-model.ts` 从真实 bundle
渲染的最后一帧，480×272）我打开看了：黑底；青色 16×16 方块在像素 (16,32)–(32,48) 即格 (1,2)，
是玩家从 `return` 图传送回 `lab` 的落点；品红 16×16 方块在格 (9,7)，是 `scout` 在换图后回到作者
位置且页 `dir: up`；绿色 32×16 条在 (176,16)，是 `transfer-cleared-locals` 的完成色。与
`tests/k1-events-sim.test.ts` 里 `rgbAt` 的语义像素断言一致。

## 8. 原则

- 无 Tuxemon 专用代码：`grep -rni tuxemon src editor tools` 只有 `interpreter.ts:705` 一条注释
  （零尺寸区域永不匹配的出处说明）。
- 未改 `vendor/pocketjs`；未 push；无手改产物（本任务无导入产物）。

## 9. 非阻断问题与建议

1. **sim 旅程对 T2-2 / T2-3 没有判别力**（M1、M2）：fixture 里的 `all` / `facing` 子句在整个
   旅程中始终成立，删掉实现 sim 仍绿。规格要求"每项一个 sim 测试（真实 bundle 下的行为）"，这两项
   只是名义覆盖。建议小修：给 fixture 加"侧向穿过一个 facing 门垫不出图、转身出图"和"某个 `all`
   子句为假时页不激活"两段。因为 bundle 跑的就是同一套纯 reducer，而单测在 `stepSession` 层面已
   守住语义（含我的完整会话探针），不作为阻断。
2. **`touched` 锁存成了死代码**：`interpreter.ts:817` 任何移动都清空全部锁存，`:865` 的
   `stepEdge = moved && !s.touched[key]` 因而等价于 `moved`；`touched` 仍写进存档并被校验。行为
   正确（"每进一格一次"正是 S1 要的），但注释描述的机制已无效。建议改注释或清理（删字段涉及存档
   形状，可留到下次存档修订）。
3. **输入锁按图访问清零**（transfer 后 `inputLocked = false`，CHANGELOG 已写明）：Tuxemon 的
   `lock_controls` 是往状态栈压一个 `SinkState`，`transition_teleport` 不弹它，理论上可跨图。我
   统计 263 张 tmx + 62 份 yaml：**没有任何事件在锁住状态下 teleport（0 处）**；lock-only 19 个、
   unlock-only 21 个事件全是同图跨事件配对。P1 导入不受影响；若 G1 撞到跨图配对，由导入器在目标
   图的 autorun 开头补 `lockInput` 即可。
4. **同格多事件仲裁是既有限制，非 K1 引入**：两个守卫都成立的 touch 事件叠同一格时仍只启动 id
   靠前的那个（`scanTriggers` 的 `if (s.main) continue`）。T2-2 解决的是"互补守卫"那一类；S1 §4.1
   的"都成立就都启动"仍要导入器合并处理。
5. 小点：`place` 与存档里的 `placements` 不做地图边界校验（`x=999` 不崩，角色悬在图外）；
   `save-restore.ts` 的 `restoreProblem` 没把 `placements` 纳入地图感知校验。可在后续 hardening
   顺手补。

## 10. 阻断项

无。

PASS
