# GM1（含前移）音乐与音效审查

## 结论

审查基线为 `b832794`，被审提交为 `5d28b9084ac58eb7f1adf57601e316a32a25da7a`。
结论为 **FAIL**。素材导入、绝大多数动作映射、前移后的主线录像和常规门禁均可复现，
但仍有许可标注错误、一个会让淡出永不完成的实际事件语义错误，以及验证工具、文档和
提交卫生方面的硬性问题。

## 阻断项

### B1. `coinecho.wav` 被错误标成 CC0

`licenses/AUDIO-ATTRIBUTIONS.md:32` 把提交的
`assets/audio/sounds/coinecho.wav` 写成 NenadSimic 的 “Click”、CC0；但音效数据库
`/var/tmp/tuxemon-src/mods/tuxemon/db/sounds/setting.yaml:7-8` 明确把 `coinecho`
绑定到 `setting/coinecho.wav`，而项目携带的上游原文
`licenses/TUXEMON-ATTRIBUTIONS.md:2183` 明确将该文件标为 “picked-coin-echo-2”、
NenadSimic、**CC BY 3.0**。CC0 的 Click 是另一份文件
`interface/NenadSimic_Click.ogg`（数据库见
`/var/tmp/tuxemon-src/mods/tuxemon/db/sounds/interface.yaml:7-8`）。

因此 11 个已提交音频虽然都有表项，逐文件许可准确性不成立。必须改正作品名、来源链接和
许可证，按 CC BY 3.0 履行署名。

### B2. 唯一的 `fadeout_music` 事件会永久重置淡出

上游 `fadeout_music` 调用 `current_music.stop(duration)`
（`/var/tmp/tuxemon-src/tuxemon/event/actions/fadeout_music.py:34-36`）；上游 `stop`
启动物理淡出后会立即把逻辑状态改成 `STOPPED` 并清空 `current_song`
（`/var/tmp/tuxemon-src/tuxemon/audio.py:103-109`）。因此下一次
`is music_playing` 已经为假。

本分支把正向 `music_playing` 直接映射为 `bgmPlaying`
（`importer/project.ts:983-990`），把正时长 `fadeout_music` 映射为
`fadeoutBgm`（`importer/project.ts:2079-2088`）。唯一使用点
`/var/tmp/tuxemon-src/mods/tuxemon/maps/37707_tower.tmx:91-95` 恰好是
`is music_playing music_mystic_island` 守卫的并行页。导入结果是一个仍由
`bgmPlaying` 守卫的 `parallel` 页面；kit 在淡出完成前保留 BGM
（`vendor/pocket-rpgkit/src/engine/audio.ts:78-94`），且每次执行
`fadeoutBgm` 都把 `leftTicks` 重置为总时长
（`vendor/pocket-rpgkit/src/engine/interpreter.ts:2320-2324`）。

针对真实导入的 `37707_tower` 做 65 帧复现后输出：

```text
{"frame":65,"map":"37707_tower","bgm":{"id":"music_mystic_island","volume":100,"pitch":100,"positionTicks":65,"fade":{"totalTicks":60,"leftTicks":60}},"parallelCount":0}
```

即淡出计数一直停在 60，曲目永不停止；主线录像没有经过该地图，所以现有长录像没有发现它。
修复后应增加直接覆盖这个导入页面、并断言 60 帧后 BGM 消失的回归测试。

### B3. 三个用于证明验收性质的工具不可直接给出其声称的保证

1. `bun run verify:audio` 会重新转码到临时目录，然后只比较“新转码 SHA”和
   “已提交 manifest 中的 SHA”（`tools/transcode-audio.ts:171-204`）；它从未读取并
   哈希 `assets/audio/{music,sounds}` 中准备实际打包的 blob。于是提交音频被损坏或被
   替换时仍可能 PASS。这也使 `docs/architecture.md:116-120` 所称的“复查已提交 blob”
   不成立。审查另行直接哈希了 11 个 blob，当前快照结果是
   `files=11 bytes=7207422 bad=[]`，但工具本身仍须修复。
2. `tools/gm1-audio-diff.ts:52-72` 只重放当前工程、只删除当前状态的
   `interp.audio`，却把已经重钉的当前 golden 标成 `pre-GM1`；它既不读取基线，也不
   比较或规范化角色 ID，并且即使比较为假也以 0 退出。原样复跑得到：

   ```text
   full hash:      f02f0e7317c4ceea15cd4cdf0cd7649ab2912751dd20f51235d679bf27bcaa48
   stripped hash:  ade9630777cb4c95bff195d6b5950558a87ad975efab60d2731190cb897b6045
   golden (pre-GM1): f02f0e7317c4ceea15cd4cdf0cd7649ab2912751dd20f51235d679bf27bcaa48
   stripped == golden: false
   full == golden:     true
   exit=0
   ```

3. README 推荐的 `bun run bench:g6:quickjs` 仍默认期待旧终态
   `5653f011…`（`tools/bench-g6-quickjs.sh:11-13`）。当前提交无覆盖参数运行完
   3,793 帧后以 1 退出：

   ```text
   STATE MISMATCH viewport=480x272 expected=5653f011... actual=7425955a...
   ```

   显式传入当前正确 hash 后同一基准通过。这是重钉遗漏，不是性能失败。

这些问题不会否定下文的独立字段 diff 或当前 blob 哈希结果，但会让仓库内声称可复现这些
性质的命令给出假绿或假红，必须在验收前修正。

### B4. 前移后的文档与提交卫生不符合要求

- `docs/importer.md:11-16` 仍说 sparse checkout 排除全部音乐；实际上
  `tools/fetch-tuxemon.sh:20-34` 会取 8 首音乐。
- `docs/importer.md:144-149` 和 `README.md:57-60` 仍列旧覆盖率；当前生成报告
  `reports/G1-coverage.md:10-27` 是 Native 90.5% / 92.9%、Executable 95.2% /
  94.4%。`docs/status.md:24` 已正确同步，音频两项也已在
  `docs/status.md:84-89` 标成 Partial 并写明限制。
- `docs/architecture.md:19` 仍写 42 个测试文件，实际为 44；同文档第 119 行还错误
  声称 `verify:audio` 会复查已提交 blob。
- 前移后的 `findings/GM1.md:118-138` 仍保留前移前的 70,055,360-byte pak 和单边
  QuickJS 数字，没有给规格要求的同机前后对照；实际当前 Linux pak 为
  73,815,328 bytes。
- 合并提交 `dd36711` 的主题为
  `Merge remote-tracking branch 'origin/main' into fleet/task-2115`，泄漏内部任务号，
  违反“提交信息不写任务号”的公开仓卫生规则。变更文件本身未发现本机路径或任务号。

## 逐项核对

| 规格项 | 判定 | 证据与说明 |
| --- | --- | --- |
| 固定上游与最小 sparse checkout | 成立 | `tools/fetch-tuxemon.sh:13,20-38` 仍固定 `9e6258ff`，只额外纳入列出的 8 首音乐；本机 checkout 的 `HEAD` 也是 `9e6258ff`。 |
| 8 首主线音乐 + 实际使用的 3 个 SFX | 成立 | `tools/transcode-audio.ts:35-53` 列出 8+3；`git ls-files assets/audio` 为 manifest + 11 blob；8 个文件头均为 `qoaf`，3 个 WAV 经 `ffprobe` 均为 `pcm_s16le / 22050 Hz / mono`。 |
| 每个音频的来源与许可 | 不成立 | 表项数量完整，但 B1 的 `coinecho.wav` 来源和许可写错。其余 10 项与随仓库保存的上游 attribution/GM0 逐项表相符，且都属于允许的 CC0、CC-BY 或 CC-BY-SA。 |
| 转码记录与构建隔离 | 部分成立 | manifest 记录 ffmpeg `9.0.2`、采样率、声道、每文件大小/SHA；`importer/audio.ts:33-54` 和 `gen-assets.ts:350-370` 只读提交物；CI 中没有转码步骤。`verify:audio` 的 blob 完整性缺口见 B3。 |
| 工程音频表与 pak | 成立 | `dist/project.json` 有 11 个逻辑 ID，`pak.json:194-236` 有对应 8 个 QOA + 3 个 WAV 条目；无素材曲目仍发 `playBgm` 而不进入 `Project.audio`，保持静音但保留状态。 |
| `play_music` / pause / resume / `play_sound` | 成立（已知限制） | `importer/project.ts:1478-1488,2066-2097` 的命令与单位换算符合规格；源数据没有带 volume/loop/fade 参数的 `play_music`，pause/resume 也无实际用例。全局音量、同曲 no-op、切歌 crossfade 和未提交曲目静音均已标为限制。 |
| `music_playing` / `fadeout_music` 联动 | 不成立 | 普通 196 个否定式入图守卫可工作，但唯一正向条件触发 B2 的永久淡出循环，因此不能把 197 处全部记为无损 Native。 |
| 前移冲突与自动生成 | 成立 | 当前导入器同时保留 GI-1a 展示分支和音频分支；连续两次 `bun run import` 后 `git diff --exit-code` 为 0。未见逐图手改产物。 |
| 录像重钉 | 成立（由审查独立证明） | 见下一节；输入 tape 未变，差异仅为音频状态和编译器角色编号。所有主线 trainer checkpoint 均为 `won`。仓库自带 `gm1-audio-diff.ts` 本身仍有 B3 的问题。 |
| 成本 | 成立（报告需更新） | 审查完成同机基线/当前 QuickJS 对照和 Linux/web pak 差值；结果在“成本”节。默认短基准命令的 stale hash 见 B3。 |
| 功能状态清单 | 成立 | `docs/status.md:84-89` 将音乐、音效标为 Partial，并准确写出 8 首、3 个 SFX、其余静音及宿主限制。其他用户文档仍有 B4 的矛盾。 |
| 仓库边界 | 部分成立 | `git diff --exit-code b832794..HEAD -- bun.lock vendor` 为 0；没有改组件仓或 PocketJS，也没有 Tuxemon 专用代码下沉。提交主题泄漏任务号，见 B4。 |

## 终态字段级复核

审查在干净的精确基线 `b832794` 和当前 `5d28b90` 分别构建工程，并用同一份
GB6 tape 从 frame 0 重放。两边均为 109,983 帧，终点都是
`spyder_route3@(4,6)`：

```text
b832794 sha256=cedface0462df16d087a4cbae3585e972ca1cfea4b2afed99e041862f90cdbec
current  sha256=f02f0e7317c4ceea15cd4cdf0cd7649ab2912751dd20f51235d679bf27bcaa48
tape     sha256=ce6b28fa4fe502a0e5aa88881da7e1854db5d0072b1a5aedca9cb1bf6ff48221 (identical)
```

递归比较结果：只有顶层 `chars`、`interp` 不同；两边均有 67 个角色且逻辑名集合相同，
27 个角色的 `e###_` 前缀顺延，无重名；基线无 `interp.audio`，当前为
`music_the_wild_places / volume=100 / pitch=100 / positionTicks=30`。删除
`interp.audio` 并规范化角色 ID 前缀后，整个终态完全相等。原 tape 未重录，
`git diff b832794..HEAD -- data/*journey.json` 只显示终态/快照 hash 字段变化。

审查状态 dump 保存为：

- `/var/tmp/fleet/2184/gb6-b832794-state.json`
- `/var/tmp/fleet/2184/gb6-current-state.json`

## 门禁复跑

全部重活均串行执行，`TUXEMON_SRC=/var/tmp/tuxemon-src`：

| 命令 | 实际结果 |
| --- | --- |
| `bun run import` 两次 + `git diff --exit-code` | PASS；无 tracked diff |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build && bun run build:wasm` | PASS |
| `bun run test` | 256 pass，0 fail，44 files，179.33 s |
| `bun run verify:g6:determinism` | PASS；4,742 files，64,726,233 bytes，SHA `6fa4aa2e…` |
| `bun run verify:g6:locks` | PASS；330 pages / 334 checks / 0 unresolved / 0 errors |
| `bun run verify:g6:frozen` | PASS；263 maps / 0 permanent locks / 0 active fibers / 0 errors |
| `bun run verify:gb6:mainline` | PASS；109,983 frames，100 battles，22 trainers，终态 `f02f0e73…` |
| `bun run verify:j1:mainline` | PASS；122,145 combined frames，17 battles，10 trainers，终态 `7f11a290…` |
| `bun run verify:j2:mainline` | PASS；172,060 combined frames，56 battles，50 trainers，终态 `074e2b7d…` |
| `bun run verify:gb6:failures` | PASS；first-loss `0f75240b…`，later-loss `5af94e2d…` |
| `bun run verify:audio` | 命令 PASS；但验证范围有 B3 的假绿缺口 |
| `bun run web && bun tools/verify-web-journey.ts` | PASS；3,793 frames，0 console errors，0 pixel mismatches |
| `verify:chapters` | N/A；`package.json` 没有该脚本 |

三个主线数据文件的 trainer 记录分别为 22、10、50 条，非 `won` 数均为 0。

## 成本复核

基线和当前均从各自源码重新构建。包体结果：

| 目标 | `b832794` | 当前 | 增量 |
| --- | ---: | ---: | ---: |
| Linux pak | 66,558,960 B | 73,815,328 B | 7,256,368 B |
| Web pak | 66,791,328 B | 74,047,696 B | 7,256,368 B |

11 个音频 blob 合计 7,207,422 B，另外 48,946 B 来自 pak 条目、工程/事件和 bundle
变化。两种目标首包均约增加 10.9%。

QuickJS 以同一台机器、同一 480×272、同一 3,793 帧真实 journey 串行测量；一组相邻
基线/当前结果如下（当前用正确终态 hash 覆盖后 exit 0）：

| 版本 | walking mean / p95 / max | map-switch mean / p95 / max | startup-to-first |
| --- | --- | --- | ---: |
| `b832794` | 1.212 / 1.801 / 2.606 ms | 0.795 / 2.166 / 6.751 ms | 191.885 ms |
| 当前 | 1.266 / 1.798 / 3.094 ms | 0.834 / 2.478 / 5.119 ms | 176.790 ms |

重复运行的波动区间为 walking mean 1.178–1.212 ms（基线）与
1.159–1.332 ms（当前），map-switch mean 0.771–0.813 ms（基线）与
0.764–0.841 ms（当前）。区间重叠，未见可归因于本改动的稳定帧耗回退，且所有观测 max
远低于 50 ms；但 builder 报告必须改成前移后的同机 A/B，而不能继续引用旧绝对值。

## 测试辨识力与画面

三个变异均在隔离 worktree `/var/tmp/fleet/2184/mut-hash` 中执行并在结束后删除：

- 把 `playBgm` 改成 `playSe`：`tests/importer.test.ts` 的 byte pin 从期望
  `4aaec379…` 变为 `3f80f8d1…`，测试失败。
- 丢掉 `music_playing` 的 `negate`：byte pin 变为 `1a325abb…`，测试失败。
- 把前移后的事件 ID `e029` 还原为 `e028`：对应测试以
  `missing imported event` 失败。

这些变异说明导入器整体 byte pin 和前移后的 fixture 能发现核心映射/编号变化；但现有测试
没有覆盖 B2 的正向 `music_playing` + 淡出完成，也没有覆盖 B3 的已提交 blob 完整性。

人工打开了三个实际 PNG：

- `dist/web-journey/end.png`：Route 1 的树林、水面、农田、角色与网页控制层均正常；
- `tests/goldens/gb5-battle-main-menu.480x272.png`：战斗双方、HUD 与主菜单清晰完整；
- `tests/goldens/gi1a-map-animation.png`：卧室场景及动画帧构图正常。

配合 web journey 的 0 像素差，未发现本次前移导致的可见渲染回退。

## 建议修复顺序

1. 修正 `coinecho.wav` 为 picked-coin-echo-2 / NenadSimic / CC BY 3.0。
2. 让 Tuxemon 的 `fadeout_music` 在逻辑上立即使对应 `music_playing` 为假，同时保留可听淡出，
   并加 37707 Tower 回归测试。
3. 让 `verify:audio` 逐个读取已提交 blob，校验 manifest 的 SHA 和 bytes；让字段 diff 真正读取
   指定基线并在额外差异时非零退出；更新短 QuickJS 基准默认 hash。
4. 同步 importer/README/architecture/GM1 报告的事实与前移后数字，并清理含内部任务号的提交主题。

subagent 使用：4 个；分别核对许可与音频资产、上游音乐语义、隔离变异与哈希证明、成本与文档；并行查证显著缩短了审查时间。

FAIL
