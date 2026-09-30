# KB4 修复 2 复审（task 1925）

审查对象：组件仓分支 `fleet/task-1919`，修复前 HEAD `a77969c`，被审范围
`a77969c..9811835`（`3bda771` 回归修复、`5fdfbbf` 卫生修复、`9811835` 记录）。

结论：**PASS**。上一轮的 B1-R、B3-R、H1 三项均已关闭；两处关键实现变异都会让指定回归变红，最终代码恢复后完整构建、897 项测试、TypeScript 与真实 QuickJS 门禁全绿。四个共享示例 bundle 与上一轮逐字节相同，真实 L 倒带及动画中点的 60/30/20/4 Hz 画面一致仍成立。golden 中唯一新增文件是 `losemsg.png`；既有 `winmsg.png` 因夹具现在真实显示 `OK` legend 而同步更新。

## 阻断项

无。

## 逐条核对

| 要求 | 结论 | 证据 |
| --- | --- | --- |
| B1-R：夹具真实挂 `legend` | 成立 | `tests/fixtures/kb4-battle/scene.tsx:106-114` 的真实 `MessageBand` 传入 `legend="OK"`。 |
| B1-R：hit/faint 完成帧做结构计数断言 | 成立 | `tests/kb4-battle-sim.test.ts:481-516,518-552` 每帧清零并断言四种结构操作为 0，同时分别断言 hit 的 first/wrap/complete 和 faint 的 first/complete 都真实到达。 |
| B1-R：QuickJS 不是只打印 | 成立 | `tools/kb4-quickjs-bench.rs:260-273` 对每个 case 的 `totals.total()` 执行 `assert_eq!(..., 0)`，失败信息包含逐帧 churn。 |
| B3-R：真实失败路径及状态/语义像素 | 成立 | `tests/kb4-battle-sim.test.ts:157-185` 经 Guard 驱动玩家倒下；`:405-444` 断言 `You lost...`、玩家 HP 0、faint 终态、opacity 0，并扫描玩家矩形的语义像素。 |
| B3-R：`losemsg` golden | 成立 | `tests/kb4-battle-sim.test.ts:582-590,624-627` 对 PNG 做完整 RGBA 比较；`tests/goldens/kb4-battle.losemsg.png` 已提交。 |
| H1：代码/测试/工具无 Fleet 编号 | 成立 | 指定 `rg` 无命中（exit 1）；`tools/kb4-quickjs-bench.rs:68-72` 从 `KB4_BENCH_SCRATCH` 读取可覆盖根，默认路径无任务号。 |
| `findings/KB4.md` 有“修复 2” | 成立 | `findings/KB4.md:243-352`。 |
| 四个共享 bundle 不变 | 成立 | 本次构建的四个 SHA-256 与 `findings/review-task-1922.md` 记录逐字节相同，详见下文。 |
| 倒带、多 Hz 画面一致 | 成立 | 临时真实 L 探针和动画中点探针均通过，输出见下文；探针及临时 fixture 参数均已还原。 |
| golden 只新增 `losemsg` | 成立 | `git diff --diff-filter=A --name-only a77969c..9811835 -- tests/goldens` 只输出 `tests/goldens/kb4-battle.losemsg.png`。完整 A/M 状态另显示 `winmsg.png` 被更新，以匹配现在可见的 `OK` legend。 |
| `bun.lock`、`vendor/` 不改 | 成立 | `git diff --name-only a77969c..9811835 -- bun.lock vendor | wc -l` 输出 `0`。 |
| 无 Tuxemon 专用运行时代码/手改导入产物 | 成立 | 被审路径仅为 KB4 通用测试夹具、golden、基准工具和文档；没有导入产物或 `src/` 运行时代码改动，也没有修改 `vendor/pocketjs`。 |

## B1-R：legend 完成点与 QuickJS 断言

正向最终实现上，以可覆盖 scratch 根运行真实 PocketJS desktop/QuickJS：

```text
$ KB4_BENCH_SCRATCH=/var/tmp/fleet/pocket-rpgkit-kb4-review bash tools/kb4-quickjs-bench.sh
480x272 command-idle:       create/destroy/insert/remove=0/0/0/0, js_max=1.782ms
480x272 shake+hp-tween:     create/destroy/insert/remove=0/0/0/0, js_max=0.399ms
480x272 faint:              create/destroy/insert/remove=0/0/0/0, js_max=0.420ms
960x544 command-idle:       create/destroy/insert/remove=0/0/0/0, js_max=0.504ms
960x544 shake+hp-tween:     create/destroy/insert/remove=0/0/0/0, js_max=0.507ms
960x544 faint:              create/destroy/insert/remove=0/0/0/0, js_max=0.423ms
test result: ok. 1 passed; 0 failed
```

我只把 `src/ui/battle/MessageBand.tsx` 的 legend 表达式从
`orBlank(complete() ? props.legend! : "")` 临时改回
`complete() ? props.legend! : ""`，保留 message rows 的修复不动，重建后得到：

```text
$ bun run build:example kb4-battle >/dev/null && bun test tests/kb4-battle-sim.test.ts
tests/kb4-battle-sim.test.ts:508: Expected: 0, Received: 1
  hit beat ... legend completion ... no node lifecycle ops
tests/kb4-battle-sim.test.ts:545: Expected: 0, Received: 1
  faint beat's first typed frame and legend completion ...
13 pass
2 fail

$ KB4_BENCH_SCRATCH=/var/tmp/fleet/pocket-rpgkit-kb4-review bash tools/kb4-quickjs-bench.sh
KB4_QJS viewport=480x272 case=shake+hp-tween ... create=1 destroy=1 insert=1 remove=1 structural_max_per_frame=4
KB4_CHURN viewport=480x272 case=shake+hp-tween frames=38:1/1/1/1
test result: FAILED. 0 passed; 1 failed
exit=101
```

因此 sim 覆盖了 hit 与 faint 的完成点，QuickJS 的断言也确实会终止测试，而非仅打印计数。还原并重建后 focused suite 恢复为 `15 pass / 0 fail`。

## B3-R：失败路径、像素与 golden

我只把 `tests/fixtures/kb4-battle/rules.ts:354` 的 player 终态回退临时改为
`return NONE_EFFECT`。重建后的输出为：

```text
$ bun run build:example kb4-battle >/dev/null && bun test tests/kb4-battle-sim.test.ts
tests/kb4-battle-sim.test.ts:413
Expected: "faint"
Received: "none"
(fail) ... the player stays in its settled faint pose ... through the lose message beat
tests/kb4-battle-sim.test.ts:590
(fail) ... writes the lose-message frame as a PNG ...
13 pass
2 fail
```

这同时证明状态/语义像素断言和完整 `losemsg` RGBA golden 都有辨识力。还原、重建后为 `15 pass / 0 fail`。

我以原始 480×272 打开 `losemsg.png`：右上敌方仍在且 HP 满，左下玩家精灵完全消失，HP 显示 `0 / 1`，消息为 `You lost...`，右下显示 `OK`。同时打开 `winmsg.png`，看到镜像语义：玩家仍在、敌方消失、消息为 `You win!`。没有发现失败方重新出现或异常不透明像素。

golden 的 Git 状态和哈希为：

```text
$ git diff --name-status a77969c..9811835 -- tests/goldens
A tests/goldens/kb4-battle.losemsg.png
M tests/goldens/kb4-battle.winmsg.png

baseline winmsg  0388bd494402f02896b6cad67d483e0a96f89a7fd3dea6dbf245d3d99f7cda51
current winmsg   f5496334360860b3b87166094d2cf89bc0e3059dc43606cef219061b7a776551
current losemsg  1cfc7b73016133e38d08ba3de414063a5e34ffe6ce2b615fd2f252bb76b47324
```

唯一新增 golden 是 `losemsg`；`winmsg` 的修改与 `scene.tsx:110` 新增的可见 legend 对应，并由完整像素测试钉住。

## 倒带与多 Hz

临时给真实 fixture 传入空 `attractTape` 以启用同一 `GameView` 的 L 倒带，然后分别在动画中点留快照，前进 180 个 60 Hz 帧，再按 L 回到相同 tick。只从像素比较中排除 `GameView` 自己的 `REWIND 3 SEC` 提示带：

```text
KB4_REWIND hit+3 state=equal pixels=86303724/86303724
KB4_REWIND hit+12 state=equal pixels=dff0e760/dff0e760
KB4_REWIND faint+15 state=equal pixels=55dbfef9/55dbfef9
1 pass, 0 fail
```

另一个临时探针精确落在 effect elapsed tick 30，而不是 settled checkpoint：

```text
KB4_HZ hit@30=7ce0fc5f/7ce0fc5f/7ce0fc5f/7ce0fc5f
KB4_HZ faint@30=bd4647b9/bd4647b9/bd4647b9/bd4647b9
             rates=60/30/20/4 Hz
1 pass, 0 fail
```

两个临时探针和 `attractTape` 参数均已还原；最终 `git status --short --branch` 只输出 `## fleet/task-1919`。

## 门禁、bundle 与卫生

严格按要求先构建、后测试：

```text
$ bun run build:example && bun test
PocketJS build: done
897 pass
0 fail
467479 expect() calls
Ran 897 tests across 59 files. [88.42s]

$ bunx tsc --noEmit
(no output; exit 0)
```

四个共享示例 bundle：

```text
c0fcb11c148fa32d9572df9dff0e3e03be48b8f241a44d4b7ed8b3af42670d66  dist/meadow.js
c2aced0ba2785be65b193db56479edc8a7841ea78ccf9cb5088b0520a3382773  dist/sunstone.js
972169d3781827fc6c2f8f222a8b4a2bcead58d89c671253985b3330fff04613  dist/grow.js
ae4a2c4f4cc1b4911acaa3e89d5265ae473c37d24d35f7aa6140d84a32bacb2f  dist/wander.js
```

这四个值逐字匹配上一轮报告。最终卫生检查：

```text
$ rg -n "review-task-[0-9]+|/var/tmp/fleet/[0-9]+|task[- ]1[89][0-9]{2}" src tests tools README.md
(no output; exit 1)

$ git diff --name-only a77969c..9811835 -- bun.lock vendor | wc -l
0

$ git diff --check
(no output; exit 0)
```

三条新提交的作者均为 `lfkdsk <lfkdsk@gmail.com>`；提交正文没有 `Co-Authored-By` 或任务/审查编号。没有 push。

PASS
