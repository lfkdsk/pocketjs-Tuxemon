# 复审 GB-int 修复 2（task 1901）

审查范围为 `edaf626..6495b67`，按 `reviewer-generic.md`、
`game-GBint-fix2.md` 和上一轮 `findings/review-task-1895.md` 复核。本次独立
重跑了真实 Tuxemon oracle、项目侧基础值计算、三项定向变异、双次导入、构建、
全测、8,560 场差分与两个 G6 门禁。

## 裁决

**FAIL。** `scope` 的上游语义、真实非对称夹具、stage 用例和三项变异能力均已
修正，所有运行门禁也通过；但新增的 TypeScript 测试和 Python 探针仍硬编码
`/var/tmp/fleet/1879/...`。这直接违反本复审规格“新代码无 fleet 任务号”的
明确验收项，因此不能判 PASS。

## 阻断项

### 1. 新增源文件仍硬编码 fleet 任务号

新增测试注释在 `tests/battle-effects.test.ts:30`，新增探针的可执行说明在
`findings/review-task-1901/probe_scope.py:11`，两处都写死了
`/var/tmp/fleet/1879/gb2-oracle-venv/bin/python`。独立扫描新增源码的实际输出：

```text
$ git diff -U0 edaf626..HEAD -- '*.ts' '*.py' '*.sh' '*.rs' | \
    rg -n '^\+.*(review-task-[0-9]+|/var/tmp/fleet/[0-9]+)'
17:+++ b/findings/review-task-1901/probe_scope.py
29:+      /var/tmp/fleet/1879/gb2-oracle-venv/bin/python \
30:+      findings/review-task-1901/probe_scope.py
110:+//     /var/tmp/fleet/1879/gb2-oracle-venv/bin/python \
111:+//     findings/review-task-1901/probe_scope.py
```

其中报告/探针的规定文件名本身带被审任务号并非本阻断项的核心；明确违规的是两份
源文件都引用了另一 fleet task 的临时 venv 路径。应改成不含任务号的可复现路径
（仓库 oracle README 已使用 `/var/tmp/fleet/gb2-oracle-venv`），或以环境变量表示
Python 解释器，再重跑定向测试与源码扫描。

提交信息本身已修好；以下扫描无输出：

```text
$ git log --format='%h%x09%s%n%b' edaf626..HEAD | \
    rg -n '(review-task-[0-9]+|fleet[^[:alnum:]]*[0-9]+|/var/tmp/fleet/[0-9]+)'
```

## `scope` 语义与真实夹具

### 上游与 reducer 的字段对应成立

- 上游 `ScopeEffect` 直接读取目标的 `armour/dodge/melee/ranged/speed`
  （`/var/tmp/tuxemon-src/tuxemon/core/effects/scope.py:40-47`）；这些 property
  直接返回 `base_stats`（`/var/tmp/tuxemon-src/tuxemon/monster/monster.py:350-372`）。
- 上游 `get_combat_stats()` 才在 `base_stats` 上叠加临时 stage
  （`/var/tmp/tuxemon-src/tuxemon/monster/monster.py:574-591`）。
- 项目中的 `BattleMonster.base` 与 `stages`、`statusBoosts` 是分开的字段
  （`battle/types.ts:118-129`）；`calculateBaseStats` 用物种 shape、等级、IV、
  口味和 TP 算出基础值（`battle/stats.ts:40-68`），而 `combatStats` 才叠加
  stage/status（`battle/stats.ts:71-81`）。快照进入战斗时 `base` 被独立复制，
  两类修正初始化为空（`battle/stats.ts:149-158`）。因此这里的 `target.base`
  是上游 `base_stats` 的对应字段，不是物种 shape 的裸属性值。
- 修复实现确实读 `target.base`（`battle/tuxemon.ts:825-834`），没有再调用
  `combatStats(target)`。

项目公式用 oracle 输出的 IV/口味重算，实际得到：

```text
$ bun -e '<用 battle-db、calculateBaseStats 与 monsterFromSnapshot 重算>'
{"rockitten_L13_base":{"armour":88,"dodge":146,"hp":115,"melee":163,"ranged":86,"speed":151},"nut_L17_base":{"armour":199,"dodge":101,"hp":195,"melee":109,"ranged":194,"speed":107},"nut_combat_with_stages":{"armour":298,"dodge":101,"hp":195,"melee":109,"ranged":194,"speed":71},"nut_stored_base":{"armour":199,"dodge":101,"hp":195,"melee":109,"ranged":194,"speed":107}}
```

### oracle 独立复跑成立

命令：

```text
TUXEMON_SRC=/var/tmp/tuxemon-src \
  /var/tmp/fleet/1879/gb2-oracle-venv/bin/python \
  findings/review-task-1901/probe_scope.py
```

关键实际输出：

```text
target nut L17 base (property) stats:
  AR=199 DE=101 ME=109 RD=194 SD=107 HP=195
  taste_cold/warm: bland peppy
  individual_values: {'armour': 7, 'dodge': 5, 'hp': 13, 'melee': 13, 'ranged': 2, 'speed': 1}
attacker rockitten L13 base (property) stats:
  AR=88 DE=146 ME=163 RD=86 SD=151 HP=115
  taste_cold/warm: dry hearty
  individual_values: {'armour': 0, 'dodge': 2, 'hp': 15, 'melee': 3, 'ranged': 6, 'speed': 11}
ScopeEffect.apply_tech_target extras: ['AR:199 DE:101 ME:109 RD:194 SD:107']
target get_combat_stats() after +1 armour / -1 speed:
  BasicStats(armour=298, dodge=101, hp=195, melee=109, ranged=194, speed=71)
ScopeEffect extras with active stage boosts: ['AR:199 DE:101 ME:109 RD:194 SD:107']
target property stats with active stage boosts: AR=199 DE=101 ME=109 RD=194 SD=107
```

测试常量与两组 oracle 数值逐项一致（`tests/battle-effects.test.ts:21-39`）。无
stage 用例明确断言目标五项（`:116-138`）；stage 用例先证明 battle-current 值
变为 `298/101/109/194/71`，再断言 scope 仍为基础值
`199/101/109/194/107`（`:141-171`）。还原后的定向测试为：

```text
$ bun test tests/battle-effects.test.ts
4 pass
0 fail
12 expect() calls
```

## 三项变异复验

每次只改 `battle/tuxemon.ts:833`，运行定向测试后立即用反向 patch 还原；每次
随后 `git diff --exit-code -- battle/tuxemon.ts` 均为 exit 0。

1. 对调 `armour`/`dodge`：测试显示收到 `armour:101, dodge:199`，预期为
   `armour:199, dodge:101`；两个 scope 用例都失败。

   ```text
   2 pass
   2 fail
   10 expect() calls
   Ran 4 tests across 1 file.
   TEST_EXIT 1
   RESTORE_EXIT 0
   ```

2. 将 `target.base` 改成 `user.base`：测试收到攻击方 rockitten 的
   `88/146/163/86/151`，而非目标 nut 的 `199/101/109/194/107`；两个 scope
   用例都失败。

   ```text
   2 pass
   2 fail
   10 expect() calls
   Ran 4 tests across 1 file.
   TEST_EXIT 1
   RESTORE_EXIT 0
   ```

3. 将 `target.base` 改成 `combatStats(target)`：无 stage 用例仍通过，stage
   用例收到 `armour:298, speed:71` 而非 `199/107`，准确命中语义差异。

   ```text
   3 pass
   1 fail
   11 expect() calls
   Ran 4 tests across 1 file.
   TEST_EXIT 1
   RESTORE_EXIT 0
   ```

三类上一轮漏检错误现在都会让测试变红，变异验收成立。

## 其余规格与门禁

| 项目 | 复审结果 |
| --- | --- |
| `findings/GB-int.md` 增加“修复 2” | 成立；记录位于 `findings/GB-int.md:117-153`。 |
| 两次 `bun run import` | 两次均 exit 0；每次都是 263 maps、430 TILESET entries、214 monsters、230 techniques、511 textures、24,498,560 battle-only pak bytes；每次 `status-lines=0` 且 `git diff --exit-code` 为 0。 |
| `bun run build` | exit 0；`pak: 2891 entries, 50765072 bytes`，`dist/main.js` 19,330,894 bytes。 |
| build 后 `bun test` | 64 pass、0 fail、48,116 assertions、12 files；exit 0。 |
| `bunx tsc --noEmit` | exit 0，无诊断。 |
| 8,560 场差分 | `{"cases":8560,"from":0,"identical":8560,"different":0,...}`，exit 0。 |
| `bun run verify:g6:locks` | 323/323 dynamic checks；unresolved=0、error=0、exceptions=0，exit 0。 |
| `bun run verify:g6:determinism` | `PASS isolatedRoots=2 files=2902 bytes=49350838 sha256=edd2e4d5e7aa26cbbe93fd88b84118f5f6dd5a85879cdf1395cf54c4abfa68b4`。 |
| `bun.lock` / `vendor/` | `git diff --name-only edaf626..HEAD -- bun.lock vendor/` 无输出；子模块在基线和 HEAD 均为 `b28d83b`。 |
| 提交信息 | `8d7cff0`、`647d674`、`6495b67` 的主题与正文扫描任务号无命中。 |
| 工作树与补丁卫生 | 写报告前 `git status --short` 无输出；`git diff --check edaf626..HEAD` exit 0；没有追踪 `.pyc`/`__pycache__`。 |

本修复没有新增或修改渲染逻辑/PNG，故没有新的画面可肉眼验收；规格也没有新增
QuickJS 性能指标。双次导入保持工作树干净，改动范围仅 reducer、测试、探针和
报告，没有手改导入产物、没有把专用代码写进组件仓，也没有改 `vendor/pocketjs`。

FAIL
