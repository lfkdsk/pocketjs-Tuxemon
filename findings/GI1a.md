# GI-1a：地图动画、屏幕效果与运行时外观/图层导入

## 结论

GI-1a 已完成并通过验收。导入器现在把钉住的 Tuxemon 内容中的地图动画、屏幕淡入淡出、
脚本镜头、气泡、全屏背景、运行时叠层、角色外观、瓦片通行属性以及相关条件映射到
RPG Kit 的 KA1、KS1、KV1 原生命令。资源由同一条全量导入管线自动生成并进入 pak；没有逐图
手改产物，也没有修改 `vendor/` 或 `bun.lock`。

最新 `origin/main` 已合并，包含 D1 时间/天气和 J2 医院主线续录。GI-1a 保留 D1 的
`time_is`/`update_time` 形状，但用 KV1 原生 `layer` 取代了旧的 `tux.set_layer` 兼容空操作。
J2 合入后也已用原生产驱动重放并通过。

## 1. 映射与语义

下表中的 `N/D/P/X` 分别表示 Native、Degraded、Placeholder、Dropped。基线取本任务开始时的
`43ab2d2` 覆盖率；最终值取两次字节稳定全量导入后的 `reports/G1-coverage.md`。

| Tuxemon 源规则 | 用量 | 基线 → 最终 | RPG Kit 映射与边界 |
| --- | ---: | --- | --- |
| `play_map_animation` | 276 | `276X` → `276N` | KA1 `mapAnim`；在命令执行时采样角色格，`follow=false`，保留 loop/noloop，位于角色上层 |
| `play_tile_animation` | 1 | `1X` → `1N` | KA1 `mapAnim`；固定地图格、上层、保留 loop/noloop |
| `screen_transition` | 25 | `25D` → `25N` | KS1 阻塞式 `screenFade out` + `screenFade in`；上游秒数直接作为参考时钟时长，保留 RGBA |
| `camera_position` | 6 | `6X` → `6N` | KS1 `camera`；有坐标时立即定位固定格，无坐标时恢复跟随 player |
| `set_bubble` | 16 | `16X` → `16N` | KS1 `balloon`；有图标时持久显示，无图标时清除 |
| `change_bg` | 15 | `15X` → `15N` | KS1 `screenBackdrop`；背景和可选前景在构建期做一次 source-over 合成，空参数关闭背景 |
| `change_bg_char` | 4 | `4X` → `4N` | KV1/KS1 组合：从角色 combat sheet 取正面帧并放进阻塞式 backdrop |
| `set_layer` | 79 | `79X` → `77N + 2X` | KV1 `layer`；支持清除、RGBA 色层和 PNG 层。2 条 Dropped 都属于固定假守卫下永远不会物化的源事件，不是资源缺失 |
| `set_template` | 24 | `24X` → `17N + 6D + 1X` | KV1 `appearance`；运行时切换/恢复 walking sprite；6 条 race 选择保存 walking baseline，但 combat sheet 仍归战斗模块；1 条 Dropped 为固定假守卫 |
| `update_tile_properties` | 2 | `2X` → `2N` | KV1 `tileProperty`；把完整 Tiled surface label 展开为精确逐格 passage override |
| `is tile_property_updated` | 4 | `4X` → `4N` | 空 label 保留上游 `all([]) == true`；有格 label 使用原生 passage 条件 |
| `not tile_property_updated` | 2 | `2X` → `2D` | 用一个代表格读取。钉住语料的所有 `surfable` 初值均为 0，且仅有两个 writer、每次原子更新完整 label，因此所有可达状态与上游 `not all(cells)` 等价 |
| `is/not char_sprite` | 66 | `66X` → `37N + 29X` | KV1 `appearance` 条件读取有效 walking appearance；29 条 Dropped 全部位于固定假守卫事件中，所有可达用例均原生 |

钉住的上游动作目录只有 `play_map_animation` 和 `play_tile_animation`，语料和动作实现都没有
stop 类地图动画动作，因此本次没有可导入的 `stopAnim` 用例。若将来上游新增 stop 动作，应按动画
实例 id 映射到 KA1 `stopAnim`，而不是猜测当前两个 play 动作的隐含停止语义。

实现还做了以下完整性约束：

- 动画名、帧表、正帧时长、loop mode、目标角色和地图边界都先验证；无有效源图时不会造图。
- `screen_transition` 的秒数不经过宿主帧率换算，由 reducer 按参考 tick 换算；因此多 Hz 结果一致。
- presentation 资源在触发裁剪之前登记。今天被固定假守卫挡住的 swimmer/night 等外观资源仍会进
  完整项目，未来守卫变为可达时无需手工补资产。
- 48×64 dragonbirth 帧按最近邻补成 pak 接受的 64×64 RGBA 纹理，但 animation definition 仍保留
  48×64 的逻辑帧几何；没有拉伸或插值。

## 2. 资源与覆盖率

全量生成结果：

| 项目 | 结果 |
| --- | ---: |
| 地图 animation definitions / frames / PNG bytes | 5 / 67 / 17,509 |
| screen layers / variants / image variants / PNG bytes | 2 / 10 / 7 / 24,927 |
| 新增运行时 walking frame | 96（8 个模板 × 12 个方向/步态帧） |
| map repository | 263 entries；8,676,277 map bytes |
| runtime actor pool | 216（排除专用 `test_npcs` 压测图） |
| NPC source repository | 183 entries；125,878 bytes |
| `dist/project.json` SHA-256 | `c24ea238b3bc84588ba8996a6b1d7ef8b7b73216319446ecf854b1c9a28023dd` |

GI-1a 范围内的 448 条动作从 `0N + 25D + 423X` 变为
`439N + 6D + 3X`；72 条条件从 `72X` 变为 `41N + 2D + 29X`。
剩余 X 都是导入器已经证明无法启动的固定假守卫事件；没有可达 GI-1a 规则因为缺图而丢弃。

合并 D1 后的全项目覆盖率如下。D1 把 `time_is` 记为显式 P1 placeholder，所以全项目汇总不能只
归因于 GI-1a；上面的逐类表才是本任务的净变化。

| Kind | Uses | Native | Degraded | Placeholder | Dropped | Native % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Actions | 13,617 | 12,122 | 628 | 19 | 848 | 89.0% |
| Conditions | 8,663 | 7,850 | 2 | 127 | 684 | 90.6% |

## 3. Journey 与冻结 tape

新命令会把 animation、appearance、layer 和 tile-property 状态纳入 reducer 的规范状态，因此
已有旅程的终态哈希变化。先不改冻结文件，分别用原 GB6/J1/失败路径/J2 驱动和同一自动战斗策略
重放；结构化比较确认按键、检查点、战斗、剧情、队伍和端点不变后，才只更新父/终态哈希。

| Journey | 输入帧 | Tape SHA-256 | 结构化比较 | 当前 terminal SHA-256 |
| --- | ---: | --- | --- | --- |
| GB6 mainline | 109,983 | `ce6b28fa4fe502a0e5aa88881da7e1854db5d0072b1a5aedca9cb1bf6ff48221` | 除 terminal hash 外全部相同；100 场战斗仍全胜 | `cedface0462df16d087a4cbae3585e972ca1cfea4b2afed99e041862f90cdbec` |
| J1 segment | 12,162 | `21022dffcd3c19e62fc24d6ae7f94bb4c55668562c64d42114d881f28ad5a0bd` | segment/combined tape、17 场战斗、剧情、队伍、地图检查点、端点均相同 | `670a85f7bffb39728c3a1d2c8c3762c0db958e089feb1764e1b79e6519a15f07` |
| GB6 later-loss | 65,515 | `135c4a1e7759cdf38ddaea7dab5d975be61567c0dd9f82044baec1988d6e54d3` | 除 terminal hash 外全部相同；Wanda 败北、恢复点和阻挡检查不变 | `28b8ac0c20fd13b2cb35022d81fef6253c4d5f5c2748871c6d935c1903139fe2` |
| J2 segment | 49,915 | `91f5a9091acfe42672975d094e65807eed2c85a7955d35698a156cdeb2eb126d` | 48 个地图检查点、56 场战斗、剧情、队伍和按键逐字节相同；只更新父 J1 与终态 hash | `933c8a78b28edb8ac12cd046254cda9adebd3dc0f02ba152513140809d01c60d` |

没有重录或手改任何按键 mask。GB6/J1/J2 在最终树上分别通过 109,983、122,145、172,060
帧合并重放；J2 的 50 场 trainer 和 6 场 wild battle 全部保持胜利。失败旅程仍同时覆盖首战败北与
后期 Wanda 败北。

## 4. 画面证据

`tests/gi1a-visual.test.ts` 直接加载生产 `dist/main.js` 与 pak，不使用替身 renderer。三张
480×272 RGBA PNG 均已人工打开核对，并由语义像素断言约束：

| Golden | 肉眼结果与语义断言 | SHA-256 |
| --- | --- | --- |
| `tests/goldens/gi1a-appearance.png` | bedroom 中 player 变为 adventurer walking appearance；16×32 源图在正确 tile anchor 上，超过 80 个源 opaque pixels 精确匹配 | `3e63b2f4c0e4ac5215d04834dfb41e8ba113400c1af001b1c87cad95ece12c67` |
| `tests/goldens/gi1a-map-animation.png` | grass frame 精确覆盖 player 当前格上层；16×16 box 内恰有 28 个像素变化，box 外为 0，28 个 opaque source pixels 全匹配 | `8eb99cfe01623b40d1bd9536fa0f5f54d41fc7cbaa2eb5406d209816517e3f47` |
| `tests/goldens/gi1a-screen-fade.png` | 1 秒黑色 fade-out 的 30/60 tick 中点；地板探针由 `[167,140,75]` 变为 `[83,70,37]`，全屏无变亮或非 opaque 像素 | `76390b37d219d550386f58e3b698bc052421b4de61afa880601d88703a53ec3b` |

独立 visual 测试结果为 `1 pass, 0 fail, 262 expect()`；它也包含在最终 256 项全测中。

## 5. QuickJS 成本

使用桌面宿主 QuickJS 的正式 benchmark，基线和结果都重放同一条 3,793 帧 G6 journey，并验证
两个 viewport 的规范终态 SHA-256 都是
`5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827`。

| 指标 | 任务起点 | GI-1a + D1 合并后 | 变化 | 门限 |
| --- | ---: | ---: | ---: | ---: |
| startup-to-first-paint 480×272 | 186.099 ms | 180.871 ms | -5.228 ms (-2.81%) | 250 ms |
| startup-to-first-paint 960×544 | 170.094 ms | 195.062 ms | +24.968 ms (+14.68%) | 250 ms |
| 263-map first-visit stage p95 | 4.247 ms | 3.882 ms | -0.365 ms (-8.59%) | 50 ms/map |
| 263-map first-visit stage max | 17.717 ms | 17.188 ms | -0.529 ms (-2.99%) | 50 ms/map |

地图首访的 p95 和 max 都改善。两种 viewport 的启动都通过 250 ms 硬门限；480 改善，960 的
单次宿主编译/挂载样本增加 24.968 ms，但仍留有 54.938 ms 余量，没有地图流送或每帧热路径回退。
计时期间没有运行 subagent 或其它本任务重命令。后续在宿主约 95% CPU 忙、load 接近核心数时的
复测样本按隔离规则丢弃，没有混入上表。

## 6. 最终门禁

| Gate | 最终结果 |
| --- | --- |
| `bun run import` 连跑两次 | exit 0；两轮 5 个代表性产物的 SHA-256 逐项相同；`dist/project.json` 为 `c24ea238…`，资产报告为 `f9d66d0e…` |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0；4,801-entry pak = 66,558,960 bytes；main JS = 1,316,519 bytes |
| `bun run build:wasm` | exit 0；290,031-byte wasm |
| `bun run test` | 256 pass；0 fail；0 skip；102,611 `expect()` |
| `bun run verify:gb6:mainline` | PASS；109,983 frames；100 battles；terminal `cedface0…` |
| `bun run verify:j1:mainline` | PASS；122,145 combined frames；17 battles；terminal `670a85f7…` |
| `bun run verify:j2:mainline` | PASS；172,060 combined frames；56 battles；terminal `933c8a78…` |
| `bun run verify:gb6:failures` | PASS；first-loss 3,254 frames；later-loss 65,515 frames，faint point / blocked exit / heal 均成立 |
| `bun run verify:g6:locks` | 330 pages；334 dynamic checks；328 unlocked + 2 transferred；0 unresolved/error |
| `bun run verify:g6:determinism` | PASS；4,742 files；64,579,020 bytes；SHA-256 `dab1d16ff57b676b655cac66168bdf0f66aa50e5b64749060214d32f1db3ec58` |
| `bun run verify:g6:frozen` | 263 maps；0 permanent locks/fibers/errors |
| `bun run web` + web journey | PASS；3,793 frames；4 个地图 checkpoint + 原生密度对话框；960×544 backing canvas；0 console errors |

## 7. 收尾

分支先合并了要求的 `origin/main@0b9b46b`；最终门禁期间 main 又前移到仅修改 benchmark 与文档的
`24e1038`，也已继续前向合并，最终合并提交为 `2b9ccc1`。第一次合并唯一冲突是生成文件
`data/g6-assets-report.json`；没有手工拼接其内容，而是在合并后用完整导入重建。最终报告恢复
GI-1a 的 216 runtime actors、5 个地图动画定义 / 67 帧、2 个屏幕层 / 10 个变体 / 7 个图片变体，
并通过第二次导入的同哈希检查。冻结 journey 的输入和终态均继续匹配，无需再次重钉。

审查提出的文档阻断已经关闭：`docs/status.md` 将每项 Presentation 能力拆开标为 Done 或 Partial，
并记录当前实现的边界。屏幕转场和 overlay 对当前语料完整；地图动画、固定镜头和 player 气泡在
跨图生命周期上仍与上游有潜在差异，但当前语料分别全是非循环动画，或会在换图前恢复/清除。
cutscene backdrop 在已显示时会替换而非像上游那样忽略，当前调用顺序不触发；walking appearance
可切换和恢复，但 6 个 race 选择不会动态改战斗 combat sheet。这些限制均在状态清单中显式标注。

旧的 `tux.set_layer` no-op handler、只服务于它的参数解析器与测试，以及 architecture/importer 中的
占位说法均已删除。真实 `set_layer` 路径仍由导入器发射原生 `layer` 命令；颜色、PNG、clear 和
77 Native / 2 fixed-false Dropped 的覆盖测试保留。除历史 findings 外，现行代码、测试、文档和
覆盖率报告中不再出现 `tux.set_layer`、`setLayerArg` 或相关 no-op 文案。

仓库卫生检查：已合并最新 `origin/main`（behind 0）；`git diff --check` 无错误；`bun.lock` 与
`vendor/` 相对主线无改动；无冲突标记、本机路径、内部地址或自动署名尾注。所有提交仅保留在本地
分支，未 push。

subagent 使用：3 个 / 分别核对 Presentation 状态与跨图边界、`tux.set_layer` 清理范围、收尾报告与门禁证据 / 并行只读核对节省了收尾时间；合并、修改、生成产物和全部重门禁均由主 agent 串行完成。

PASS
