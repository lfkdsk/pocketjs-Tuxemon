# Review C1（task 1992）：游戏仓收尾

审查基线 `15f4519`，被审 HEAD `0ac7e4f`。结论为 **FAIL**：README、截图、功能性
guard 变异和全部门禁都通过，但有两个规格中的实质要求未满足。

## 阻断项

### B1：新测试没有断言“逐字节不变”

测试确实构造了规格要求的异常反序列化状态：训练师战把 `menuIndex` 直接放到不可用的
`forfeit`（`tests/battle-runtime.test.ts:187-190`），野战把它放到不可用的 `replacement`
（`:198-201`），然后发送 `confirmEdge`。删除 `battle/runtime.ts:864` 的 guard 后，聚焦测试
以 `menuIndex: 3 -> 0` 变红；两个定向变异也分别证明 trainer 和 wild 断言有辨识力：

- guard 只拒绝 `forfeit` 时，wild 用例在 `:201` 变红，状态从 `root/menuIndex=1` 进入
  `swap/menuIndex=0`；
- guard 只拒绝 `replacement` 时，trainer 用例在 `:190` 变红，`menuIndex` 从 3 变成 0。

但两处最终断言都是 `.toEqual(staleState)`。本文件的 `json()` 只是类型转换
（`tests/battle-runtime.test.ts:62-64`），并没有冻结或序列化状态；`.toEqual` 只验证深层语义相等，
不验证 JSON 字节。直接反例：

```text
$ bun -e '... expect({a:1,b:2}).toEqual({b:2,a:1}) ...'
{"a":1,"b":2} != {"b":2,"a":1}; toEqual passed
```

仓库已有正确模式：先保存 `const before = JSON.stringify(state)`，再以
`expect(JSON.stringify(state)).toBe(before)` 比较（`tests/battle-autoplay.test.ts:80-87`、
`tests/battle-gb3-reducer.test.ts:286-289`）。C1 报告在 `findings/C1.md:30-42` 声称已经逐字节
断言，强于实际测试。应对 trainer/wild 两个状态各保存调用前序列化文本，并对返回状态序列化后
使用 `.toBe(before)`。

### B2：buddha_mountain 的瓶颈归因错误，数值外推混用了编码方案

`findings/C1.md:95-97` 把 43–50 ms 归因于解析 10,000 个 ground 字符串。但官方基准没有把
文件读取与 JSON 解析拆开：`tools/g6-quickjs-bench.rs:959-976` 把第一次完整 `step(id)` 计作
`read_parse_ms`，而该 step 在 `map-repository.ts:407-419` 内依次执行 source read、字节转字符串、
`JSON.parse` 和 pending bookkeeping。

PocketJS 文件读取本身也不是一次廉价内存读取。`framework/src/fs-api.ts:91-109` 按
`FS_MAX_IO_BYTES=65,536`（`contracts/spec/fs.ts:235-240`）循环跨 host 调用、解析每个 JSON/base64
信封、base64 解码并拼接；212,567 B 的 Buddha 文档需四次调用。之后
`map-repository.ts:356-369` 还扫描并按 8 KiB 块构造 ASCII 字符串。

已有保留的同路径 QuickJS 分解探针 `/var/tmp/fleet/1869/breakdown-full2.txt:33-37` 对这张同为
212,567 B 的图给出五次直接测量：

| 阶段 | 范围 |
| --- | ---: |
| filesystem `read_bytes` | 32.134–34.553 ms |
| 当前 ASCII decode 等价路径 | 10.760–12.136 ms |
| 文档 `JSON.parse` | **1.441–1.573 ms** |

本审查又用当前 PocketJS `pocket-mod::Guest`/QuickJS、Rust `Instant`、25 组交替顺序样本做了同图
A/B；每个样本新建 realm、样本外注入字符串并先 GC，候选在 Rust 中验证展开后的 10,000 个 cell
逐项等于原图：

```text
GROUND_PALETTE_QJS reps=25 original_bytes=212567 palette_bytes=32704 cells=10000 palette=11
GROUND_PALETTE_QJS original_parse_ms min=1.467 median=1.564 p95=1.601 max=2.250
GROUND_PALETTE_QJS palette_parse_ms min=0.884 median=0.944 p95=1.080 max=1.242
GROUND_PALETTE_QJS palette_parse_expand_ms min=1.893 median=1.948 p95=2.356 max=2.395
test result: ok. 1 passed; 0 failed
```

因此 `JSON.parse` 不是 43–50 ms 的主导项；解析后立即展开调色板甚至比原始 parse 更慢约
0.38 ms。正确结论是：大文档导致的 **host 文件分块传输/base64 marshaling/字节拼接/文本解码**
主导该阶段，最终文档 parse 只约 1.5 ms。缩小 ground 仍会显著改善总阶段，但收益机制写错了。

结构统计本身正确：`buddha_mountain` 为 212,567 B，ground 200,105 B（94.1%）、10,000 格、
11 个唯一值、passage 11,803 B。可是 `findings/C1.md:113-118` 把
`groundPalette + ground:number[]` 与 13–21 KB / 3–5 ms 的估计并列，也不成立：实际紧凑 JSON
`number[]` 完整文档是 **32,704 B**（每格至少还有数字和逗号），不是“每格 1 byte”；13–21 KB
只可能对应另行设计的 nibble/RLE/二进制字符串编码。当前 A/B 的 numeric palette parse 中位数为
0.944 ms，若先展开则为 1.948 ms；组件方案还必须计入 palette 校验和下游读取/展开成本。

另外，`findings/C1.md:99-100` 若意指全 corpus 的 ground 占比为 90–98%，则统计不成立。直接遍历
263 个 `dist/maps` 得到 ground 占比 median 42.9%、p90 76.3%、max 97.8%，只有 12/263 张 ≥90%；
“唯一值 median 2 / p90 7 / max 16”和列出的高占比个例则正确。数字数组方案仍把所有 map 文档总量
从 7,890,051 B 降至 4,741,983 B（-39.9%），所以通用 palette 方向合理，只需修正根因、具体编码
与收益数字。

## 逐项核对

### 1. GB5 guard 测试：部分成立

- **成立**：两个用例都直接制造光标停在不可用项的状态并按确认；完整对象的语义相等断言存在。
- **成立**：删除 guard 的隔离变异为 0 pass / 1 fail（全文件为 13 pass / 1 fail）；上述两个
  定向变异分别杀死 trainer/wild 分支。所有变异仅在 `/var/tmp/fleet/1996/mut-review` 或独立
  subagent 副本执行，副本已删除，被审 worktree 未改。
- **不成立**：没有按规格逐字节比较序列化状态，见 B1。

### 2. README 与截图：成立

新增/修改的数值逐项可追溯：

- 终点、109,981 帧 / 1,833.017 s、100 = 22 trainer + 78 wild、每场 trainer `won` 且写回
  `battle_outcome`：`findings/GB6.md:5-14,49-57`；
- 60/30/20 Hz 逐状态一致：`findings/GB6.md:91-100,243-245`；
- Billie 与 Wanda 两条失败路径、昏厥点、离场拦截、护士恢复：`findings/GB6.md:116-137`；
- 10 次样本启动中位 151.897 / 155.168 ms：`findings/GP1.md:737-749`；
- map-switch worst 15.857 / 14.734 ms，故 “under 16 ms” 成立：`findings/GP1.md:770-776`。

`P2, complete` 与 GB6 的主线 P2 验收一致，没有“整个 Tuxemon 主线完成”之类夸大措辞。浏览器 URL
与 `15f4519` 完全相同。

两张新图与对应 golden 逐字节一致：

```text
00ac70ad...  docs/screenshots/cotton-town.png
00ac70ad...  tests/goldens/gb6-mainline-cotton-town.480x272.png
3286862a...  docs/screenshots/route-3-end.png
3286862a...  tests/goldens/gb6-mainline-route-3-end.480x272.png
```

两图均为 480×272 RGBA PNG。肉眼打开后，Cotton Town 可见玩家、喷泉、双雕像、红十字建筑、
蓝顶建筑、住宅、道路与花木；Route 3 北端可见玩家、房屋、岩拱/洞口、台地、长草、树界、NPC、
长凳与水晶。没有乱码、空白、错误场景或异常裁切。聚焦 golden 测试也为 2 pass / 0 fail，
78 assertions。

说明：README 中继承自基线的 4,572、8,560 和“0 differing pixels”在 GB6/GP1 中不逐字出现；
它们不是本任务新增或修改的数字，故不作为本次回归阻断。如果“每个数字”意指追溯整个 README，
后续应补对应旧报告链接。

### 3. buddha_mountain 分析：部分成立

- **成立**：三份实际 map-first-visit 记录分别为 49.743、46.322、42.781 ms 的 worst stage；
  `test_npcs` 之外 Buddha 最慢。官方门禁检查最大单 stage，而不是 total，见
  `tools/g6-quickjs-bench.rs:998-1018`，所以 total=52.801 ms 的 run 1 仍按既有规则 PASS。
- **成立**：Buddha 的大小、cell、唯一值和字段字节统计正确，payload 压缩是合理的通用方向。
- **不成立**：没有测量支持“JSON.parse 主导”，且直接 QuickJS 分解反驳它；numeric JSON 方案的
  13–21 KB / 3–5 ms 估计也偏乐观，见 B2。
- **部分成立**：组件仓需要扩展 schema/validation/consumer 才能采用 palette；但应先确定
  `number[]`、packed string、nibble 或 RLE 的真实线格式，再对完整 read/decode/parse/validate/
  compile 路径做 A/B，不能把一种编码的大小与另一种编码的解析估计混用。

### 4. 门禁与仓库卫生：成立

主审串行复跑：

```text
$ bunx tsc --noEmit
exit 0

$ bun run build && bun run build:wasm
exit 0
pak: 4,622 entries, 62,192,208 bytes
dist/main.js: 1,152,203 bytes
pocketjs.wasm: 289,758 bytes

$ bun test
168 pass
0 fail
71055 expect() calls
Ran 168 tests across 35 files. [164.70s]
```

Bun 没有报告 skip。`git diff --check 15f4519..HEAD` 通过；
`git diff --exit-code 15f4519..HEAD -- bun.lock vendor/ importer/` 为空；构建和测试后工作树仍干净。
产品/测试 diff 与三条提交信息均无 task 1992 / fleet 任务号。改动仅 README、两张截图、C1 报告和
战斗测试，没有手改导入产物、没有 Tuxemon 专用代码进入组件仓、没有改 PocketJS。

## 结论

功能 guard 覆盖、README、截图和门禁均合格，但明确要求的序列化字节断言缺失，且性能报告把
`read + marshal + decode + parse` 的总阶段错误归因给 `JSON.parse`，继而把 packed 编码的尺寸/收益
套到了 `number[]` 示例上。两项都需要修订后再审。

subagent 使用：3 个 / guard 隔离变异与断言语义、README 数字与截图、性能测量链路与历史分解证据 / 并行覆盖了三项互不依赖的审查并节省时间，主 agent 亲自复跑全部门禁、两项定向变异、截图肉眼核对和当前 QuickJS A/B。

FAIL
