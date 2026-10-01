# DEMO-G1 修复 1 复审

## 结论

**FAIL。** 前两项阻断已经实质修好：章节恢复合同带入全局
`timelineFrame` 后，抽查四章（含 Greenwash）都与 172,060 帧整段回放到达同一
完整状态哈希；245 个可用出生点也全部避开所有静态事件区域，另 18 张确实没有
可站立且无事件覆盖的格子，诚实标为 `blocked`。全部构建、测试、journey、章节与
浏览器门禁也通过。

但上一轮 B3「文档一致性」仍未关闭。`findings/DEMO-G1.md` 的现行结论和正文仍
保留 10 章、旧 warp 分布、只避开 blocking 事件等旧说法，文件末尾追加的“修复 1”
段与其直接冲突；README / importer 文档的覆盖率也已落后生成报告；新改的验证文档
又把三个实际不同的环境变量误写成统一的 `MODE`。规格明确把“文档与实现一致”列为
本次阻断重放项，因此不能判 PASS。

审查 tip 为 `08c03d61afc1d99e85b17ffac06295c687294de3`，修复提交为
`bc9f247`、`6e0031b`、`e4a6e57`、`08c03d6`。

## 阻断项

### B3 仍失败：现行文档没有与实现和生成数据对齐

1. **交付报告在同一文件内互相矛盾。** 顶部已经称 13 章，但紧接着仍称 warp 为
   `246 transfer / 16 fallback / 1 blocked`（`findings/DEMO-G1.md:7-11`）；正文仍称
   tape 只有 GB6+J1、总计 122,145 帧并只列 10 章（`:18-35`），随后继续写 10 张
   缩略图、只避开 `blocks:true`、仅 1 张 blocked、CI 第六条 journey（`:48-76`）。
   当前产物实际为 172,060 帧（`data/chapters.json:15-21`），warp 测试钉死
   `135 / 110 / 18`（`tests/warp-spawns.test.ts:100-107`）。文件末尾的修复段才给出
   当前数字（`findings/DEMO-G1.md:201-228`），没有把顶部的现行结论和正文改正。
2. **覆盖率文档仍分裂。** `README.md:57-60` 写 native `85.8% / 89.6%`、
   executable `91.1% / 91.1%`，`docs/importer.md:140-145` 仍写 native
   `11,679 / 7,765`；两次本地导入生成的 `reports/G1-coverage.md:11-27` 实际为
   native `12,122 / 13,617`、`7,850 / 8,663`（`89.0% / 90.6%`），executable
   `93.8% / 92.1%`。`docs/status.md:24` 使用的是后者，所以 README、importer、
   status 三处没有一致。
3. **新增说明给错了可执行命令合同。** `docs/verification.md:34-36` 称三个 verifier
   都由 `MODE` 选择模式；实现分别读取 `GB6_VERIFY_MODE`、`J1_VERIFY_MODE`、
   `J2_VERIFY_MODE`（`tools/verify-gb6-mainline.ts:39-42`、
   `tools/verify-j1-mainline.ts:33-37`、`tools/verify-j2-mainline.ts:34-39`），
   `package.json:23-38` 也按这三个名字传值。照文档设置 `MODE` 不会切换模式。
   同时 `docs/status.md:103` 把 60/30/20 Hz 证明指向只跑默认 60 Hz 的
   `verify:gb6:mainline`，实际多 Hz 脚本是 `verify:gb6:rates/full`。

`docs/ci.md` 的 13 runners、7 条 journey、38 个 rest 测试文件以及本地命令，
README 的 J2 命令，`docs/verification.md` 的 13 章恢复合同和 warp 全事件区域合同，
这些上一轮点名项已经修正；但不能抵消以上仍在现行文档中的相反说法。

## 三项阻断重放

### B1：章节快照 + 后缀续播 — 成立

实现不是只做存档往返自洽检查：`tools/bake-chapters.ts:516-562` 对提交的每个
envelope 执行 decode → map-aware restore → 注入 `timelineFrame` → 从 `frame`
偏移续播，并对完整 `canonicalJson(SessionState)` 做 SHA-256；
`tools/verify-chapters.ts:70-84` 把它接进 CI 门禁。整段独立回放输出：

```text
FULL frames=172060 terminal=spyder_candy_hospital3@5,7
hash=933c8a78b28edb8ac12cd046254cda9adebd3dc0f02ba152513140809d01c60d
pinned=933c8a78b28edb8ac12cd046254cda9adebd3dc0f02ba152513140809d01c60d matchesPin=true
```

四个自选章节（早 / 中 / 晚，含 Greenwash）实跑结果：

| 章节 | suffix 起点 | restore 原始 frame | 注入 frame | suffix 帧 | 终态 |
| --- | ---: | ---: | ---: | ---: | --- |
| bedroom | 0 | 0 | 0 | 172,060 | `933c8a78…`, match |
| city-park | 43,116 | 0 | 43,116 | 128,944 | `933c8a78…`, match |
| captain-returns | 122,145 | 192 | 122,145 | 49,915 | `933c8a78…`, match |
| greenwash-aardant | 170,670 | 1,037 | 170,670 | 1,390 | `933c8a78…`, match |

这也准确复现了旧缺陷：后两章单靠 envelope 分别恢复到 per-map frame 192 / 1,037，
必须按新章节合同注入全局 frame。组件演示菜单接线尚未完成，接线时必须消费
`timelineFrame`；`docs/status.md:91-97` 仍标 Partial，符合本任务的数据侧范围。

### B2：出生点避开所有事件区域 — 成立

`importer/warp.ts:48-68` 无条件把每个 event 的 `x/y/w/h` 纳入覆盖集合；
`:155-185` 先尝试安全 transfer，继而找离首个落点最近的 event-free standable 格，
没有合法格才标 blocked。全量测试检查全部 263 条、重建字节一致，并穷举证明每张
blocked 图没有合法格（`tests/warp-spawns.test.ts:57-113`）：

```text
bun test tests/warp-spawns.test.ts
4 pass / 0 fail / 2,095 expect() calls
分布：135 transfer / 110 fallback / 18 blocked（245 个可用项）
```

另外从 transfer 和 fallback 各作 10 张等距抽样，独立用 `buildPassage` 和事件矩形
求交核对，20/20 都是 `solid=0`、事件命中为空：

```text
37707_tower transfer @12,21                 solid=0 events=- PASS
cotton_cafe transfer @1,10                  solid=0 events=- PASS
eclipse_crystal_center transfer @6,7        solid=0 events=- PASS
manhattan_beach transfer @27,38             solid=0 events=- PASS
routea transfer @6,13                       solid=0 events=- PASS
spyder_candy_inn1 transfer @3,2             solid=0 events=- PASS
spyder_greenwash_level2 transfer @1,4       solid=0 events=- PASS
spyder_paper_rival_downstairs transfer @7,9 solid=0 events=- PASS
taba_ba_br_4 transfer @4,1                  solid=0 events=- PASS
taba_town transfer @40,4                    solid=0 events=- PASS
azure_town_hall fallback @20,18             solid=0 events=- PASS
classic_gym_pyra fallback @10,18            solid=0 events=- PASS
classic_route_8 fallback @1,16              solid=0 events=- PASS
eclipse_obsidian_town_house fallback @4,6   solid=0 events=- PASS
player_house_downstairs fallback @1,2       solid=0 events=- PASS
sphalian_town fallback @21,14               solid=0 events=- PASS
spyder_cotton_scoop fallback @5,9           solid=0 events=- PASS
spyder_leather_gym fallback @1,9            solid=0 events=- PASS
spyder_scoop4 fallback @9,20                solid=0 events=- PASS
taba_house4 fallback @7,5                   solid=0 events=- PASS
SAMPLE 20 bad 0 transfer 10 fallback 10
```

18 条 `from:"blocked"` 是不可用 marker，不是安全出生点；测试逐格证明它们确实无
standable event-free cell。状态页最好把“one spawn per map, standable and clear”
改成“one record per map; every non-blocked spawn ...”，避免把 marker 也读成可用 spawn。

### B3：文档一致 — 不成立

见“阻断项”。本次新增/修改的四份主文档里，CI 与章节/warp 主合同基本对齐，
但交付报告仍保留上一轮明确点出的旧正文，且覆盖率、模式变量与状态页脚本引用仍错。

## 变异辨识力

两个变异都在 `/var/tmp/fleet/2177/mutants/repo` 的独立副本完成，随后已删除该
679 MB 临时副本；被审工作树从未被改坏。

| 变异 | 期望 | 实际 |
| --- | --- | --- |
| `standable()` 忽略 `events.has(index)` | warp 门禁必须拒绝修复前语义 | `warp-spawns.test.ts`: 3 pass / 1 fail；逐字节重建断言列出 event-covered transfer 回归 |
| Greenwash 恢复时用 `timelineFrame - 1` | suffix 完整状态哈希必须失败 | exit 1：`chapter greenwash-aardant: snapshot + suffix did not reach the full-replay terminal state` |

第一项中安全性断言读取的是已提交索引，因此直接抓回归的是“导入器重建 == 已提交
数据”断言；第二项直接证明全局时间轴不能漏一帧。两项均有辨识力。

## 画面肉眼检查

`verify:chapters` 已重新渲染并逐字节比较全部 13 张。本次又按原始 480×272 打开：

- `greenwash-aardant`：窄室内图两侧黑边对称，木地板、紫色机器区、柜台、盆栽、
  玩家和 NPC 均清晰，没有黑屏或异常裁剪；
- `hospital-cure`：浅蓝实验室、书架、中央扫描设备与玩家完整，窄图黑边正常；
- `candy-town`：河道、树林、道路、雕像、花草与顶边玩家可见，视口构图正常。

## 门禁复跑

全部在被审 tip 串行运行，`TUXEMON_SRC=/var/tmp/tuxemon-src`：

| 命令 | 实际结果 |
| --- | --- |
| `bun run import` ×2 + 每次 `git diff --exit-code` | 两次均为 263 maps / 430 TILESET entries；无 diff |
| `bunx tsc --noEmit` | exit 0，无输出 |
| `bun run build && bun run build:wasm` | exit 0；pak 4,801 entries；wasm 289,981 bytes |
| `bun run test` | 260 pass / 0 fail / 0 skip；104,706 assertions；45 files |
| `bun run verify:gb6:mainline` | PASS；109,983 帧，100 战（22 trainer / 78 wild），终点 Route 3 |
| `bun run verify:j1:mainline` | PASS；122,145 合并帧，17 战（10 / 7） |
| `bun run verify:j2:mainline` | PASS；172,060 合并帧，56 战（50 / 6），终态 `933c8a78…` |
| `bun run verify:gb6:failures` | PASS；两条失败恢复线（3,254 / 65,515 帧） |
| `bun run verify:g6:locks` | 330 pages / 334 checks；328 unlocked / 2 transferred / 0 unresolved / 0 error |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks / 0 blocking fibers / 0 errors |
| `bun run verify:chapters` | PASS；13 chapters / 172,060 帧；JSON、缩略图逐字节一致；13 suffixes 全达 `933c8a78…`；exit 0 |
| `bun run web && bun tools/verify-web-journey.ts` | WEB JOURNEY PASS；3,793 帧，4 个状态/像素检查点，0 console error |

`verify:chapters` 本机实际约 21 分钟，明显高于 `docs/verification.md` 的约 12 分钟，
建议后续按 CI/开发机实测更新 rough duration；这不影响门禁正确性。

## 自动生成、范围与仓库卫生

- warp 由 `gen-assets.ts:386-389` 统一调用 `buildWarpIndex(project)`，实现遍历全部
  map/event/page/command；没有逐图手改产物或 Tuxemon 地图 id 特判。
- 修复提交相对 `8bbcc11` 没有 `bun.lock` 或 `vendor/` diff；`git diff --check` 为 0；
  重跑导入、构建、web 后工作树仍干净。
- 四个修复提交均为 `lfkdsk <lfkdsk@gmail.com>`，无 Co-Authored-By；增量代码、测试、
  用户文档与提交信息未发现本机路径、内网地址或 fleet task id。
- 没有修改 PocketJS 或组件子模块。全局 frame 进入通用 `SaveSnapshot` 的改进已在
  `findings/DEMO-G1.md:194-199` 交给 commander；当前数据侧合同用 `timelineFrame`
  等价补足，符合本修复规格“不在本任务改子模块”的限制。

## 非阻断建议

- `gen-assets.ts:386-387` 的注释仍写 fallback 是 “first standable cell”，应更新成
  “nearest event-free standable cell”。
- 组件演示菜单真正接线前，必须让 chapter loader 注入 `timelineFrame`，否则直接
  restore Greenwash 仍从 per-map frame 1,037 开始。

subagent 使用：3 个 / 分别只读审查章节续播、出生点全量语义、文档与状态清单；并行
核对显著节省时间，所有长门禁、20 图抽样、肉眼观图、隔离变异和最终判定由主代理完成。

FAIL
