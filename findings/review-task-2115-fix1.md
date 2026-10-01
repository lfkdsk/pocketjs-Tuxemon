# GM1 修复 1 复审

被审分支 `fleet/task-2115`，HEAD `37e1fd4`；上一轮审查 `findings/review-task-2139.md`（FAIL，B1–B4）；
修复记录 `findings/GM1.md`「修复 1」节。所有命令在 `TUXEMON_SRC=/var/tmp/tuxemon-src` 下串行运行，
临时文件在 `/var/tmp/fleet/2223/`。

## 结论

代码层面的修复全部成立：B1 许可更正经原始来源（含音频内容比对）核实；B2 淡出语义在真实导入的
`37707_tower` 上复现为正确，变异后回归测试变红；B3 三个工具都能给出它们声称的保证；全部门禁复跑
通过（`verify:chapters` 例外，原因来自 main，见 R2）。但 B4 要求的报告/文档项仍未完成：
`findings/GM1.md` 的成本节没有给出 GM1 本身的同机前后对照，并把旧数据标成同机测量；章节快照重烘焙
的原因没有写；测试里有本机路径。均为小的文档/卫生修复，但属于规格的必做项，判 **FAIL**。

## 阻断项

### R1. `findings/GM1.md` 成本节不是同机前后对照，且结论不成立（B4 未完成）

- 「Cost (post-merge, same machine)」（`findings/GM1.md:383-406`）的「pre-merge」列
  `2.451 / 3.791 / 20.721`、`12.574 / 18.185 / 58.339`、`6.003 / 15.461 / 58.339` 与原 GM1 成本节
  `findings/GM1.md:129-132` 逐字相同。那组数据是前移 GI-1a 之前（状态哈希 `b4e6fe98`）测的，
  不是这次同机测的。「pre-merge startup 176.790 ms」则取自上一轮审查的 3,793 帧
  `bench:g6`（`findings/review-task-2139.md:185`），和表里其余数据不是同一个基准。
- 比较对象也不对。pak 用的是 73,815,328 → 74,397,072，自己写明增量是「D2's daylight runtime」，
  量的是 D2 的成本。GM1 规格 §4 与修复规格 B4 要的是 GM1 自身的增量（main 对本分支）。
- 74.4 ms 那一帧被说成「pre-merge 也有 >50 ms 帧（58.3 ms）」，不能这样解释：基准的门槛看的是
  线程 CPU（`qjs_core_max_cpu`），而 58.3/74.4 是 wall-clock `qjs_max`。原 GM1 那次运行门槛是通过的。
  我在 HEAD 上复跑 `bench:gb6:quickjs` exit 0，`BUDGET kind=all qjs_core_max_cpu=33.493ms`，
  `qjs_max=57.493ms`，状态 `80b067c7…` 一致。所以 74.4 ms 那次大概率是机器竞争导致的，不是回退。
  报告里应该写复跑结果，而不是错误的对比。
- 原「Cost」节（`findings/GM1.md:118` 的 70,055,360 B，`:138-139` 的「comfortably met」）还留着，
  和新节互相矛盾。

审查实测的正确数字（同一台机器；main 拷贝 `29ad5a1` 与 HEAD 都从源码重新导入并构建；交错顺序
main → HEAD → HEAD → main；`bench:g6:quickjs`，3,793 帧，480×272；机器负载 9.7–15，记在下面）：

| 运行 | walking mean / p95 / max | map-switch mean / p95 / max | startup-to-first | CPU max (all) | 状态 |
| --- | --- | --- | ---: | ---: | --- |
| main-1 | 1.347 / 1.887 / 3.047 ms | 0.875 / 2.483 / 5.146 ms | 202.046 ms | 27.184 ms | `dd83a4af` |
| HEAD-1 | 1.321 / 1.864 / 2.463 ms | 0.845 / 2.244 / 5.269 ms | 184.657 ms | 25.250 ms | `cf3d902a` |
| HEAD-2 | 1.330 / 1.877 / 2.725 ms | 0.837 / 2.277 / 5.171 ms | 176.551 ms | 27.767 ms | `cf3d902a` |
| main-2 | 1.260 / 1.769 / 2.412 ms | 0.827 / 2.258 / 5.159 ms | 167.219 ms | 25.390 ms | `dd83a4af` |

walking 均值 main 1.304 → HEAD 1.326 ms（+1.7%，落在 main 自身 1.260–1.347 的波动内）；map-switch
0.851 → 0.841 ms。看不出可归因于 GM1 的帧耗回退。Linux pak：main 67,113,808 B → HEAD
74,397,072 B，增加 7,283,264 B（+10.9%），其中 11 个音频 blob 占 7,207,422 B。
日志：`/var/tmp/fleet/2223/bench-{main-1,head-1,head-2,main-2}.log`、`benchgb6-head.log`。

**修复**：把 `findings/GM1.md` 的成本节换成 GM1 对 main 的同机对照（上表即可），删除或标注旧的
「Cost」节，74.4 ms 一段改为复跑结论。

### R2. 章节快照重烘焙的原因没有写，`verify:chapters` 的 PASS 不可复现

- `findings/GM1.md:365-366` 只写了「Chapter snapshots re-baked …; verify:chapters passes」，没有写原因。
  修复规格明确要求说明。审查子代理把 main `29ad5a1` 与 HEAD 的 13 个快照逐字段解码对比，
  变化只有三处：12 个快照的 `/checksum`；`/state/interp/audio/bgm/{id,volume,pitch,positionTicks}`
  （GM1 的音频状态进入存档）；1 处 `interp/touched/spyder_mansion/e012_captain_returns_r020 → e013_…`
  （GM1 插入音乐事件导致的事件 ID 顺延）。没有 `sys.music_fading`，D2 状态在 main 上已有。
  这些内容应写进报告。
- 我复跑 `bun run verify:chapters`，结果 **exit 1**（`CHAPTERS STALE: a chapter snapshot or thumbnail
  hash in data/chapters.json changed`）。逐字段比对：13 个快照全相同，13 个 `thumbnailSha256` 全部不同。
  像素比对显示整幅色调变化（例如 (64,176,128) → (73,178,128)）。
  原因是 `tools/bake-chapters.ts` 用 `bootWorld` 跑构建产物时没有设
  `__pocketTuxemonInitialCivilTime`，`main.tsx:44-52` 就读本地时钟，D2 的昼夜色调随实际时间变化。
  在内存里把时间钉在 10:40（builder 烘焙的时间）重烘焙，`data/chapters.json` **逐字节相同**
  （`/var/tmp/fleet/2223/chpin.ts`：`chapters fully equal: 13/13 JSON BYTE-EQUAL`）。
  这个缺陷来自 main（`bake-chapters.ts` 与 main 相同，main `bf79f29` 也没修），不算 GM1 的问题，
  但报告里写的「verify:chapters PASS」只在烘焙当时成立，应注明。CI 的 `chapters` job
  （`.github/workflows/ci.yml:108`）同样会随时间变红。已提议另开任务修 main。

### R3. 测试里写了本机路径

`tests/audio-verify.test.ts:90`：`TUXEMON_SRC: process.env.TUXEMON_SRC ?? "/var/tmp/tuxemon-src"`。
这违反公开仓「代码/测试里不写本机路径」的硬规矩，也和工具默认的 `.tuxemon-src` 不一致。
应改用与工具相同的默认值，或缺源时跳过。

## 逐项核对

### 1. B1 许可：成立（有建议项）

由子代理对照原始来源，我抽查后确认。`cmp /var/tmp/tuxemon-src/ATTRIBUTIONS.md
licenses/TUXEMON-ATTRIBUTIONS.md` 结果相同，因此行号两边通用。

| 文件 | 数据库条目 | 上游署名行 | 我方表行 | 许可 | 判定 |
| --- | --- | --- | --- | --- | --- |
| music_home.qoa | db/music/music.yaml:3-4 `All of Us.ogg` | TA:2090 Eric Skiff | AA:17 | CC-BY-SA 4.0 | 符合 |
| music_cathedral_theme.qoa | music.yaml:33-34 `JRPG_royalCourt_loop.ogg` | TA:2109 Yubatake | AA:18 | CC BY 3.0 | 符合 |
| music_town_theme.qoa | music.yaml:35-36 | TA:2109/2117 | AA:19 | CC BY 3.0 | 符合 |
| music_the_wild_places.qoa | music.yaml:47-48 `peasant_kingdom.ogg` | TA:2102 Spring | AA:20 | CC BY 3.0 | 符合 |
| music_city_park.qoa | music.yaml:7-8 `back34.mp3` | TA:2107 Tom Peter | AA:21 | CC-BY-SA 3.0 | 符合 |
| music_10_empire.qoa | jrpg-ostr2.yaml:17-18 | TA:2126 AVGVSTA | AA:22 | CC BY 3.0 | 符合 |
| music_07_town.qoa | jrpg-ostr2.yaml:11-12 | TA:2126 AVGVSTA | AA:23 | CC BY 3.0 | 符合 |
| music_jester_theme.qoa | music.yaml:55-56 | TA:2104 Hydrogene | AA:24 | CC0 | 符合 |
| japanese_temple_bell_small.wav | db/sounds/setting.yaml:1-2 | TA:2155 Mike Koenig | AA:30 | CC BY 3.0 | 符合 |
| sound_confirm.wav | db/sounds/interface.yaml:1-2 `interface/confirm.ogg` | TA:2143-2145 Kelvin Shadewing Soundpacks Vol.1–3 | AA:31 | CC BY 3.0 | 符合 |
| coinecho.wav | setting.yaml:7-8 `setting/coinecho.wav` | TA:2183 NenadSimic picked-coin-echo-2 | AA:32 | CC BY 3.0 | 符合 |

（TA = `licenses/TUXEMON-ATTRIBUTIONS.md`，AA = `licenses/AUDIO-ATTRIBUTIONS.md`）

- coinecho：作品名、作者、OpenGameArt 链接、CC BY 3.0 都与 TA:2183 一致。
- sound_confirm：上游没有逐文件写明 confirm.ogg 的出处，归属是推断的，但证据很强。
  - `git log --follow` 显示该文件随 2015-12-14 `2f8e3a3d3`「Add Kelvin's sound pack」加入。
  - 从作者站下载的 `kssp_02.zip` 里有 `Confirm.wav`。两者样本数同为 12525，零延迟对齐，SNR 31 dB，差异来自 Vorbis 有损压缩。
  - 上游在 `a90e4a0d5`（2025-08）把该包改标为 CC BY 3.0，作者页面也写 CC-BY-3.0。
  - broumbroum 的条目对应的是另一个文件 `interface/originals/50561__broumbroum__sf3-sfx-menu-select.ogg`（slug `sound_menu_select`）。
  - builder 的更正成立。
- 内容一致性：3 个 SFX 解码成 22.05 kHz 单声道后，PCM 与上游源逐字节相同；8 首 QOA 的样本数与源相同。
- 11 个 blob 与 11 行一一对应，没有多余也没有缺失。`README.md:172-174` 链接到 AA。
- **建议（不阻断）**：
  - AA 表里没有许可证 URI，CC BY 3.0 §4(a) 要求附许可证副本或 URI；TA:2183 也没有许可证链接。
  - AA:10-11「audio content otherwise unchanged」与 QOA 有损转码不符。
  - CC BY-SA 的两首最好明确写「派生文件同样按 CC BY-SA 提供」。
  - AA:31 的作品名可以写原名「Confirm」（Soundpack Vol. 2）。

### 2. B2 fadeout_music：成立（有建议项）

- **自己的探针**（`/var/tmp/fleet/2223/b2probe.ts`，读取真实 `dist/project.json`）：从 `37707_town`
  出发，由导入的 `not music_playing` 页播放 `music_mystic_island`，向上走进 `37707_tower`。
  - 输出 `{"enterTower":22,"fadeStart":38,"goneAfterFrames":60,"resets":0,"bgmEnd":null}`。
  - 淡出计数逐帧为 `60,59,…,1`，之后为空。淡出开始后又观察了 120 帧，没有一次重置（并行页不再触发，即正向 `music_playing` 为假），BGM 在 60 帧后消失。
- **变异**（隔离副本 `/var/tmp/fleet/2223/mut-1`）：
  - 删掉正向分支的 `{k:"sw", id: MUSIC_FADING_SWITCH, on:false}`（`importer/project.ts:1009`）后，`tests/music-fadeout.test.ts` 由 2 pass 变成 2 fail（`Expected: < 60, Received: 60`）。还原后 2 pass。
  - 再删掉 `play_music` 的清标志（`importer/project.ts:2113-2115`），回归测试仍然 2 pass，只有 `tests/importer.test.ts` 的字节钉变红。也就是说这条路径没有语义测试（建议补）。
- **5 个使用点对照上游**（上游：`audio.py:56` 同曲 PLAYING 时 no-op，`:103-111` stop 立即 STOPPED 并清空 current_song）：

  | 使用点 | 导入结果 | 判定 |
  | --- | --- | --- |
  | `37707_town.tmx:114-118`，否定式入图守卫 | `bgmPlaying negate` → `[if 标志→清, playBgm]` | 无淡出时一致 |
  | `37707_tower.tmx:91-95`，正向守卫 + fadeout | `bgmPlaying ∧ ¬sys.music_fading` → `[fadeoutBgm 1, 标志=真]` | 一致，只触发一次 |
  | `route2.tmx:64-70`，否定式 + `not variable_set sadsong:yes` | 否定 + 变量 → `[清, playBgm, v.sadsong=1]` | 一致 |
  | `route2.tmx:125-128 / 163-184`，对话里换曲 | `[…, 清, playBgm the_princess]` | 一致 |
  | `water_end_of_desert.tmx:285-297`，autorun 片头 | `[…, 清, playBgm music_town_theme]` | 一致；同曲重播会重启，这是修复前就有的已记录限制 |

  199 个 `playBgm` 前面都有守卫过的清标志（jq：`[{"k":"if:sys.music_fading:true","n":199}]`）。主线上不会写入该开关：GB6 终态与 main 的差异只有音频（见第 5 项）。
- **建议（不阻断）**：
  - 否定式在淡出期间与上游不同。从塔里立刻走回 `37707_town`（第 60 帧回到，剩余 38 帧淡出），城镇音乐要等淡出结束（第 98 帧）才重新开始；上游会立即开始。最多 60 帧，可自行恢复。
  - `docs/status.md:89` 写「matching upstream」说过了头，应写明这个例外。
  - `docs/importer.md:73,76` 的映射表没有提到这个开关；`importer/project.ts:991-994` 的注释「Every map use is the `not music_playing X` guard」已经过时。
  - `docs/status.md:89` 的「13 used tracks are declared but silent」：这些 ID 并不在 `Project.audio` 里，只作为 `playBgm` 的 id 出现。

### 3. B3 校验工具：成立

- `verify:audio`（在副本里操作）：
  - 原样运行 exit 0，输出「all hashes match」。
  - 把 `coinecho.wav` 第 5000 字节改成 0，exit 1，输出 `sha256 mismatch: sounds/coinecho.wav`。
  - 用 sound_confirm 替换 `music_home.qoa`，exit 1，输出 `byte count mismatch … (manifest 1585808, on disk 25094)`。
  - 实现见 `tools/audio-manifest.ts:41-69`、`tools/transcode-audio.ts:183-190`。
- `gm1-audio-diff`：
  - 用真实的 main `29ad5a1` GB6 终态（我自己重放导出，哈希 `a252d05f…`，与 main 钉的值一致）作基线：exit 0，「audio-only — normalized states are identical」。不带 `--current`、走重放路径的结果也一样。
  - 把基线的 `frame` 加 1：exit 1，`extra diffs beyond audio at: frame`。
  - 在基线里塞一个 `sys.music_fading`：exit 1，`… at: sw`。
- `bench:g6:quickjs` 不带覆盖参数：HEAD 两次都 exit 0，状态 `cf3d902a…`，CPU max 25.3 / 27.8 ms。

### 4. B4 文档：部分成立

| 项 | 判定 | 证据 |
| --- | --- | --- |
| 覆盖率 | 成立 | `reports/G1-coverage.md` 与 `dist/import-report.json`：动作 Native 90.5% / Executable 95.2%，条件 94.3% / 94.4%（D2 的 `time_is` 有 126 次从占位转为原生，所以条件从 92.9% 升到 94.3%）。`README.md:57-58`、`docs/status.md:24`、`docs/importer.md:149-150` 一致。 |
| 音乐取数 | 基本成立 | `tools/fetch-tuxemon.sh:23-34` 取 8 首；`docs/importer.md:13-14` 已改。小误差：`sounds/` 整棵树（193 个文件）都会取出，并非只取 3 个；`:15` 说音频流水线见 verification.md，实际写在 `docs/architecture.md`「Audio pipeline」。 |
| 测试文件数 | 成立 | `docs/architecture.md:19` 写 52；`bun run test` 显示 `Ran 301 tests across 52 files`。 |
| verify:audio 复查 blob | 成立 | 见第 3 项。 |
| pak 字节与 QuickJS 前后对照 | **不成立** | 见 R1。 |
| `docs/status.md` 音频两行 | 基本成立 | Partial、8 首、3 个 SFX、宿主限制都对；问题见第 2 项建议（「matching upstream」「declared」）；两行都没有指向详细说明的链接（建议指向 `docs/architecture.md#audio-pipeline`）。 |

### 5. 合并 main 与重钉：部分成立

- 合并本身：重算 `git merge-tree be588c3 29ad5a1` 有 14 个冲突文件。合并提交 `747660b` 当时取了 main 一侧，
  丢掉了 GM1 的 `audio` 资产块、status 音频行和覆盖率钉；之后 `55327d8`、`f82b996` 都补回来了。
  HEAD 上两边的逻辑都在。builder 写的「Conflicts were terminal-state hash pins and coverage numbers」
  少报了冲突文件（`main.tsx`、`docs/status.md`、`g6-assets-report.json` 的 audio 块）。
- `be588c3` 本身 tsc 不过：`k: "sw"` 在展开里被放宽成 string，`da5ea1f` 修了。HEAD 的 tsc 为 0。
- 重钉的字段级理由（子代理三方逐叶比对，我抽核）：
  - 动作/条件计数是两边之和（4,161 + 197 + 18 = 4,376）。
  - actor 槽 502→503、217→218：两边各加一个并行事件。
  - `entryBytes` 多出的 26,974 B 来自 B2 给每个 `play_music` 加的守卫清标志，提交信息没有提到（建议补）。
  - 终态哈希：用 `gm1-audio-diff` 证明 GB6 终态相对 main 只差音频和角色 ID 前缀（第 3 项）。tape 未变（`git diff 29ad5a1..HEAD -- data/*journey.json` 只改了哈希字段）。
  - `bun.lock`、`vendor/` 与 main 相同。
- 章节快照：重烘焙原因没有写，见 R2。时间钉住后 `chapters.json` 逐字节可复现。

### 6. 门禁复跑（HEAD `37e1fd4`）

| 命令 | 结果 |
| --- | --- |
| `bun run import` ×2 | exit 0；dist/assets/data/ui 哈希两次都是 `16b8a0a8…`；无已跟踪文件 diff |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | PASS，pak 74,397,072 B |
| `bun run build:wasm` | PASS，290,031 B |
| `bun run test` | 301 pass / 0 fail / 52 files（184.5 s） |
| `verify:audio` | PASS |
| `verify:chapters` | **FAIL**（随时钟变化，见 R2）；钉 10:40 后逐字节相同 |
| `verify:g6:locks` | PASS：330 pages，0 unresolved，0 error |
| `verify:g6:determinism` | PASS：4,742 files，66,969,683 B，`f2537854…` |
| `verify:g6:frozen` | PASS：263 maps，0 permanent locks |
| `verify:gb6:mainline` | PASS：109,983 frames，100 battles，22 trainers，`80b067c7…` |
| `verify:gb6:failures` | PASS：first `4e532690…` |
| `verify:j1:mainline` | PASS：122,145 frames，`c8d9b88e…` |
| `verify:j2:mainline` | PASS：172,060 frames，`eb627a3d…` |
| `bench:g6:quickjs`（无覆盖） | PASS ×2 |
| `bench:gb6:quickjs` | PASS，CPU max 33.5 ms |

### 7. 临时副本再合并当前 main `bf79f29`（被审分支未改动）

- 在临时 worktree 里 `git merge bf79f29`，3 个文本冲突：
  - `README.md`：性能与覆盖率段落；
  - `data/g6-assets-report.json`：`mapRepository`；
  - `docs/architecture.md`：`assets/` 一行。
- 冲突的解决方式：README 取 main 一侧，架构文档两边合并，报告由导入重新生成。
- 子模块随 main 前进到 kit `2e104362` / PocketJS `fb29b45b`，先执行了 `build:wasm`（357,256 B）。
- 合并后的结果：
  - import ×2 字节一致（`b68415ab…`）；
  - tsc 0；
  - build 后 pak 46,291,888 B；
  - test 301 pass / 1 fail，唯一失败是 `default import output remains byte-pinned`，这是预期内的重钉；
  - verify:audio / g6:locks / g6:determinism / g6:frozen / gb6:mainline / gb6:failures / j1 / j2 全 PASS，终态哈希与本分支钉的值相同；
  - verify:chapters 仍因时钟失败，钉住时间后逐字节相同。
- 合并后需要跟进的事项：
  - 新 kit 的 schema 接受 QOA，`audioQoaPending` 变为空；
  - `g6-assets-report.json` 重新生成（compact 编码 entryBytes 4,253,489）；
  - `docs/status.md` 的「desktop host has no audio module yet」将过时（main 已有 ALSA 桌面音频）。
- 临时副本用完已删除。

### 8. 原则与状态清单

- 没有手改导入产物；组件仓和 `vendor/` 没有改动。
- 提交信息里没有任务号（`ab7a4b7..HEAD`）。本机路径见 R3。
- `docs/status.md` 已把音乐/音效标为 Partial（建议见第 4 项）。

## 建议修复顺序

1. R1：`findings/GM1.md` 成本节改成 GM1 对 main 的同机对照（可直接用本报告的表），删除或标注旧节，74.4 ms 一段改为复跑结论。
2. R2：在 `findings/GM1.md` 写明章节快照变化的原因（音频状态进入存档，加一处事件 ID 顺延），并注明 `verify:chapters` 依赖时钟。
3. R3：去掉 `tests/audio-verify.test.ts:90` 的本机路径。
4. （可选）status/importer 文档措辞；`play_music` 清标志的语义测试；音频署名表补许可证 URI。

subagent 使用：4 个，前台并行运行。
- SA1：音频许可对照原始来源，包括作者站音频包和 git 历史。
- SA2：B2 语义与 5 个使用点，含往返探针。
- SA3：文档一致性与公开仓卫生。
- SA4：合并与重钉的字段级核对、章节快照解码、预测合并冲突。

它们约 5–6 分钟内并行完成，大约省下 20 分钟串行阅读。所有门禁、变异、基准、探针和临时合并都由主 agent 串行执行，基准运行时没有 subagent 在跑。

FAIL
