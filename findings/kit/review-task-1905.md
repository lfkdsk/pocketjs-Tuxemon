# K4 修复 3（task 1905）复审

审查范围：K4 修复前 `a267abb`，合并的组件仓 main 为 `4e5d880`，被审
HEAD 为 `50e7c05`（合并提交 `0306793`、回归提交 `3318d04`、报告提交
`50e7c05`）。结论为 **FAIL**。main 四批能力、保存门禁、构造/恢复、
ext/battle 写回、schema/hash、bundle 与仓库卫生基本正确；但规格明确要求
`cloneInterp` 复用规范化复制，本实现刻意保留原样复制。独立变异证明这不是
只有注释层面的偏差：一个含 `1e308` 的 bank 可以经 `cloneInterp` 被
`canSave` 判为可保存，`createSnapshot` 也会产出 envelope，而该 envelope 随后
被本仓自己的 decoder 拒绝，仍存在“写得出、读不回”的公开 API 路径。

## 阻断项

### B1 — `cloneInterp` 原样复制可让非安全整数进入“可保存”快照

规格要求 `createSwitchState(init)` 规范化四个 bank，并让 `cloneInterp` 复用
同一规范化复制。当前构造器的确在
`src/engine/interpreter.ts:131`–`:147` 夹取四个 bank，但
`cloneInterp` 在 `src/engine/interpreter.ts:904`–`:927` 明确逐字段原样复制
`items`、`variables`、`shopStock`、`gold`。保存门禁
`src/engine/save.ts:61`–`:74` 只检查移动/纤程/modal/外部工作/scene，不检查
bank；`createSnapshot` 又在 `src/engine/save.ts:80`–`:102` 通过这个原样 clone
建立快照。

独立把正常 `createInterpState()` 的四个 bank 变异为 `1e308`，再走
`cloneInterp` → `canSave` → `createSnapshot` → `encodeEnvelope` →
`decodeEnvelopeText`，实际输出：

```text
{"safe":[false,false,false,false],"canSave":true,"snapshotCreated":true,
 "createError":null,
 "decodeError":{"name":"SaveError","code":"shape",
 "message":"SaveError: save state is invalid: state.interp.sw.items.potion: safe integer required"}}
```

也就是说，`canSave === true` 且公共保存构造器成功，但它刚生成的存档无法读回。
`restoreSessionSnapshot` 在 `src/engine/save-restore.ts:114`–`:120` 的二次规范化
只能保护进入 restore 的对象，无法修复这个在 snapshot 创建侧已经暴露的路径。

保留逐帧原样 clone 的动机成立：我把 `cloneInterp` 临时改成
`createSwitchState(s0.sw)` 后运行：

```text
bun test tests/extensions.test.ts \
  -t 'a non-integer coordinate variable becomes a frozen fatal state instead of throwing'
0 pass / 1 fail
Expected content error, received undefined
```

这证明如果所有逐帧 reducer 也直接用规范化 clone，非整数传送坐标会先被 floor，
确实会掩盖内容错误。但当前实现把两种用途绑在一个导出函数上，因此“保留内容错误”
不能同时推出“保存入口安全”。建议拆成内部的逐帧 raw clone 与对外/保存用 normalized
clone（让导出的 `cloneInterp` 满足原规格），或至少在 `canSave`/`createSnapshot` 边界
拒绝或规范化四个 bank，并新增上述变异的往返回归；同时保留现有非整数传送 fatal
测试。当前 `clampVarRecord` 的注释还称它由 `createSwitchState` 和 `cloneInterp` 共用
（`src/engine/interpreter.ts:1205`–`:1208`），与实际实现相反，应随修复校正。

## 1. 合并正确性：成立

- `0306793` 的两个 parent 正确为 `a267abb` 与 `4e5d880`；
  `git diff 4e5d880..HEAD -- . ':!findings'` 为 26 个文件、2819 insertions、
  62 deletions，内容归属于 K4 shop/choices/variable、合并适配与本轮有限整数回归。
- main 的关键回归文件
  `tests/map-repository-parity.test.ts`、`tests/message-blocks-player.test.ts`、
  `tests/extensions.test.ts`、`tests/battle.test.ts`、
  `tests/battle-scene-sim.test.ts` 相对 `4e5d880` 无差异。定向复跑连同 save、K4
  economy 与移动碰撞共 11 个文件：`244 pass / 0 fail / 9844 expect()`。
- `Session.worldOptions` 在 `src/engine/session.ts:437`–`:442` 同时保留
  `messageBlocksPlayer`、`extensions`、item catalog 与 inventory；内联建世界
  (`:489`–`:490`)、按需 acquire (`:342`–`:350`) 和淡出分步 prepare
  (`:377`–`:394`) 都把同一个对象交给 `createWorld`。分步路径在 `:383`–`:384`
  同时执行 ext 与 battle 注册校验。另造一个只在第二张 map 出现 battle 命令的 sharded
  project，直接分步 prepare，实际得到：

  ```text
  Error: createSession: project uses battle commands but no BattleRules were registered
  ```

- KR1 parity 的三项测试、淡出分步首访、KF2 的 12 项对话冻结、`blocks` 碰撞、
  KB1/KB2 的扩展、队列、冻结、fatal state、倒带均在上述定向复跑通过。
  通用解释器仍在 `src/engine/interpreter.ts:1874`–`:1888` 先跑排序后的 parallel、
  后跑 main，并只把 battle 发布重排成 main-first；世界默认冻结在
  `src/engine/session.ts:921`–`:926`。裸 repository 第三参数兼容仍由
  `src/engine/session.ts:422`–`:432` 识别，KR1 parity 测试实际沿用该调用形态。
- 重名 `VariableRef` 的修复正确：传送引用仍是 `{variable}` 的
  `VariableRef`（`src/engine/types.ts:26`–`:33`），K4 算术引用改为 `{op, from}` 的
  `VariableOpRef`（`:134`–`:143`）。合并后的 `ProjectSystem` 同时含
  `messageBlocksPlayer` 与 `inventory`（`:355`–`:375`）；把二者同时放进一个项目后，
  normative/editor 两份 schema 的校验结果都是 `[]`。
- 独立 AST 扫描结果：`schema duplicate keys: 0`、
  `duplicate static object-literal keys: 0`、
  `duplicate same-scope interface declarations: 0`、
  `duplicate same-scope test helpers: 0`。仓库也没有残留 conflict marker。

## 2. `canSave` 四类反例：成立

`src/engine/save.ts:61`–`:74` 同时要求 `modal === null`、scene 为 null、
`pendingBattles.length === 0`，且 transfer/moveRoute/place/aborted route 均已排空。

- 已提交的 modal 与外部 transfer 反例在 `tests/save.test.ts:123`–`:147`；
- queue 非空但 scene 已空的反例在 `tests/battle.test.ts:155`–`:172`；
- scene 活跃且 queue 为空的反例在 `tests/battle.test.ts:207`–`:216`。

已有 modal 测试打开的是普通对话。为单独覆盖题目点名的商店 modal，我构造了
`ShopModal`，并与另外三类条件同测，实际输出：

```text
{"baseline":true,"shopModal":false,"activeScene":false,
 "battleQueue":false,"externalPending":false}
```

因此检查本身对 modal kind 无分支，商店同样不能保存。

## 3. 有限安全整数的其余入口：成立；整体因 B1 仅部分成立

- `createSwitchState` 对 items/variables/shopStock/gold 分别经
  `clampVarRecord`、`clampVariableRecord`、非负 clamp 与 `clampFiniteVar`
  （`src/engine/interpreter.ts:131`–`:147`）；`createInterpState` 又在
  `:775`–`:793` 复用该构造器。直接种入 `1e308/-1e308` 的新增回归覆盖四个 bank。
- `restoreSessionSnapshot` 在 raw clone 后显式调用 `createSwitchState`
  （`src/engine/save-restore.ts:106`–`:120`）。绕过 decoder、把四个 bank 直接改坏
  再调用该入口，输出为：

  ```text
  {"values":[9007199254740991,9007199254740991,9007199254740991,0],
   "safe":[true,true,true,true],"shopStockNonNegative":true}
  ```

- `save-validate.ts` 的 items、numeric variables、shopStock、gold 分别在
  `src/engine/save-validate.ts:546`–`:587` 要求 safe integer，库存还要求非负。
  对四个 bank 分别写入 `1e308` 并重算正确 checksum，四次均得到 typed
  `SaveError(code="shape")`，错误分别为 `safe integer required`、
  `string or safe integer required`、`non-negative safe integer required`。
- ext `result.writes` 在 `src/engine/interpreter.ts:1438`–`:1452`、
  `BattleCompletion.writes` 在 `src/engine/session.ts:785`–`:816` 对数字调用
  `clampFiniteVar`。其余写点为 variable 三种分支 (`interpreter.ts:1240`–`:1276`)、
  gold/item (`:1280`–`:1289`)、商店买卖/库存 (`:1603`–`:1624`) 与项目初始金币
  (`session.ts:538`–`:543`)，均已接入同一 clamp；未发现 ext/battle 直接写 gold、
  items 或 shopStock 的第二条路径。

## 4. 变异敏感度：成立

所有变异均只改一处实现，运行后用反向补丁还原；最后工作树恢复洁净。

| 变异 | 实际结果 |
|---|---|
| `createSwitchState.gold` 绕过 clamp | fix3 文件 `4 pass / 1 fail`，收到 `1e+308` 而非 `MAX_SAFE_INTEGER` |
| gold 的 save validator 从 safe integer 放宽成 finite | `4 pass / 1 fail`，checksum-valid 恶意 envelope 不再抛 `SaveError` |
| battle completion 写回绕过 clamp | `4 pass / 1 fail`，收到 `1e+308` 而非 `MAX_SAFE_INTEGER` |
| 让 `cloneInterp` 全面规范化（设计实验） | 指定的非整数传送内容错误测试 `0 pass / 1 fail`，说明需要拆分 clone 用途，而不是简单全局替换 |

还原后上述 11 文件定向复跑为 `244 pass / 0 fail`。

## 5. schema/hash、bundle、golden 与仓库卫生：成立（两项非阻断文档卫生除外）

- 独立计算结果：

  ```text
  {"declared":"c27e2e51e0256f25fc7c6850b83273dab8bab9664e249a72c0a38d8940939157",
   "computed":"c27e2e51e0256f25fc7c6850b83273dab8bab9664e249a72c0a38d8940939157",
   "hashEqual":true,"editorEqual":true}
  ```

  常量由 `tests/map-repository.test.ts:111`–`:116` 钉住，编辑器副本由
  `tests/editor-model.test.ts:61`–`:65` deep-equal 钉住。
- 当前 Sunstone 两次完整构建后均为 `sunstone.js = 424830 B`、
  `sunstone.pak = 3308384 B`，SHA-256 分别为
  `cb0919f04c4cc1aa60cc2b30c1ca2e6ceaef174d8f84e0b76ebeeb734d12e8fe` 与
  `a13b131a36d7d02bac3ce09e4230f176fe9a81e0987ae10b0f5767c2a8e052a8`。
  main `4e5d880` 工作树中的对应 JS 为 407318 B，故合并净增 17512 B；来源是
  main 的 extensions/battle 与 K4 shop/choices/variable 两侧代码同时进入同一 bundle，
  与 `tests/sunstone-game-sim.test.ts:405`–`:421` 的说明一致。434000 B 上界尚余
  9170 B；pak 仍在既有区间内。
- `git diff --name-only a267abb..HEAD` 对 K4 render artifacts、测试 golden PNG 的
  计数为 0。肉眼查看两张商店 PNG：买入页可见选中的 Iron Key `10g (3)`、
  Torch `5g (0)` 灰显；卖出页 Iron Key 为选中态、Rope `0g` 灰显，文字未裁切。
- `bun.lock`、`package.json`、`vendor/` 相对 main 无差异；子模块仍为
  `76ae741f`。三个被审提交作者均为 `lfkdsk <lfkdsk@gmail.com>`，标题/正文及
  fix3 新增代码无 fleet/task/review-task 编号；没有 push。
- 非阻断卫生：`git diff --check 4e5d880..HEAD` 只报告
  `findings/K4.md:398: new blank line at EOF`；另有上文指出的
  `clampVarRecord` 注释与实际 `cloneInterp` 行为不符。

## 6. 强制门禁与画面

严格按要求先后执行：

```text
bun run build:example
exit 0

bun test
843 pass
0 fail
465895 expect() calls
Ran 843 tests across 55 files. [82.36s]

bunx tsc --noEmit
exit 0
```

本规格没有新增 QuickJS 性能数字要求，因此未用 Bun 数字替代或声称 QuickJS 性能结论。

FAIL
