# SLIM-G: compact maps and indexed battle artwork

## Result

Pocket Tuxemon now uses Pocket RPG Kit `2e1043627443c7ca7e631e3d592f95f18b385be9`.
All 263 map repository entries select the self-describing `rpgkit-map/1`
encoding, and all 578 battle images are deterministic single-tile
CLUT8+PackBits entries loaded through one reference-counted battle cache.
The generated Web game pak fell from 66,791,328 B to 38,770,624 B (−42.0%).

The full import, typecheck, build, wasm build, 257-test suite, GB6/J1/J2
mainlines, GB6 failure paths, lock/freeze/determinism checks, browser replay,
and native QuickJS benches pass. The committed battle goldens are unchanged at
both viewports and three consecutive battle scopes balance every indexed
texture load with a detach-before-free operation.

## Asset pipeline

### Maps

`gen-assets.ts` asks the kit map splitter to choose the smaller representation
with `entryEncoding: "auto"`; it does not force compact encoding. For the
current corpus every map chooses `rpgkit-map/1`. `MapRepository` reconstructs
the ordinary `MapDef`, so the reducer and UI do not need a compact-format code
path of their own. There are no residual JSON map entries in the pak.

Two complete imports produced identical 5,419-line SHA-256 manifests. The
independent two-root determinism gate also passed over 4,742 files and
59,594,122 B with aggregate SHA-256
`574836a42d06c622e00d54dd324366b227e0f51e6ef1ec475ad66f02bc8a4d84`.

### Battle images

The importer first normalizes source pixels to the legacy RGBA4444 display
precision, then encodes one `ui:tile.battle/...#0` CLUT8+PackBits entry per
image. This preserves the framebuffer produced by the old eager image path:
all 578 decoded entries compare byte-for-byte, with zero quantized files,
colours, remapped pixels, or squared error. PNGs remain in the repository only
as preview/golden inputs and are absent from the runtime eager-image graph.

The battle scene shares one cache. Its first visible borrower loads an entry,
subsequent borrowers share the handle, and scope exit detaches nodes before
freeing textures. The cache reopens synchronously when the persistent battle
subtree is entered again. The acceptance fixture exercised three complete
enter/exit cycles and found the unique load and free handle sets equal in each
cycle.

## Size results

All sizes are raw bytes from like-for-like generated artifacts.

| Artifact | Before | After | Change |
| --- | ---: | ---: | ---: |
| Desktop `main.pak` | 66,558,960 | 38,538,256 | −28,020,704 (−42.1%) |
| Web game pak | 66,791,328 | 38,770,624 | −28,020,704 (−42.0%) |
| Map repository entries | 8,676,277 canonical JSON | 3,708,056 compact | −4,968,221 (−57.3%) |
| Project shell | 83,232 | 82,969 | −263 (−0.3%) |
| Battle art plus battle database in pak | 26,440,560 | 3,392,752 | −23,047,808 (−87.2%) |
| All battle image payloads | 25,192,464 PSM4444 texture bytes | 2,158,468 encoded bytes | −23,033,996 (−91.4%) |

The complete generated Web directory is 40,565,747 B, including the game JS,
game pak, wasm, player shell, HTML, preview, CSS, and audio worklet. The game
pak is the dominant first-load artifact and is the directly comparable number
retained above.

Current generated entry groups are:

| Group | Entries | Bytes | Meaning |
| --- | ---: | ---: | --- |
| Compact maps | 263 | 3,708,056 | `rpgkit-map/1` shards |
| Terrain tiles | 430 | 21,575,296 | Existing streamed TILESET payloads |
| Battle images | 578 | 2,158,468 | CLUT8+PackBits `.pkts` files |
| Battle database repository | 650 | 776,792 | Lazy battle data shards; shell is 188,345 B |
| Animated repository | 48 | 505,687 | Lazy animation metadata |
| NPC-source repository | 183 | 125,878 | Lazy NPC source data |

The legacy all-resident battle textures required 25,192,464 B. Decoding every
new indexed image simultaneously would require 13,185,792 B, but the runtime
keeps only the current battle's referenced working set resident and releases
it on exit.

## QuickJS performance

The short journey was measured at both supported viewports on the real desktop
QuickJS host. The previous values are the documented pre-change measurements;
walking did not have a prior published p95.

| Metric | Before 480×272 / 960×544 | After 480×272 / 960×544 |
| --- | ---: | ---: |
| Startup through first frame | 151.897 / 155.168 ms | 131.888 / 144.089 ms |
| Walking p95 | — | 1.883 / 1.834 ms |
| Journey map-switch maximum | 15.9 / 14.7 ms | 9.211 / 9.228 ms |
| Battle entry | 22.2 / 22.6 ms | 25.276 / 29.406 ms |
| Battle exit | 34.4 / 38.5 ms | 7.358 / 7.750 ms |

Both short viewport runs ended at canonical state SHA-256
`5653f0110656dd4e0a930ff1908c833c9f9fc221c9cfd3a90d22b138ef8d4827`.
The battle-entry increase is the expected cost of loading the active indexed
working set; it remains well below the 50 ms frame budget and is recovered at
exit instead of being paid as permanent startup/resident cost.

For cold first visits across all 263 maps, the slowest pipeline-stage p95/max
changed from 4.040/14.184 ms for canonical JSON to 12.046/45.090 ms for compact
maps. Three repeat compact runs measured p95 12.221, 11.968, and 11.453 ms,
with maxima 41.553, 46.089, and 41.578 ms. This is the explicit decode-time
tradeoff for the 57.3% shard-size reduction.

The full GB6 QuickJS run completed all 109,983 frames and 100 battles at
480×272. It reported map-switch p95/max 4.264/8.965 ms, battle-entry p95/max
16.858/24.074 ms, battle-exit p95/max 14.662/16.256 ms, and a worst measured
QuickJS/core CPU frame of 45.694 ms against the 50 ms budget. Its terminal
state SHA-256 was
`cedface0462df16d087a4cbae3585e972ca1cfea4b2afed99e041862f90cdbec`.

The standalone benches also passed:

- C1 read every compact map 11 times through the real QuickJS/data-fs path.
- Terrain ran 600 stable frames and 789 map switches per viewport. Worst
  switch totals were 1.806 ms at 480×272 and 3.139 ms at 960×544, with zero
  frames over 16.7 ms.
- The battle reducer ran 250 battles and 3,250 active frames. Complete-battle
  p95/max were 9.151/13.370 ms and active-frame p95/max were 0.929/4.237 ms.

All four shell harnesses that copy the desktop host (`g6`, C1, terrain, and
battle) compile it with `cargo test --no-default-features`. The terrain harness
now stages its lazy shards under the host's app-scoped data root. The desktop
launcher delegates feature selection to the kit and successfully built a
silent host on this machine without ALSA development metadata.

## Compatibility and visual verification

The frozen mainline outcomes remained unchanged:

| Replay | Frames | Result | Terminal state SHA-256 |
| --- | ---: | --- | --- |
| GB6 | 109,983 | 100 battles; ends `spyder_route3@4,6` | `cedface0462df16d087a4cbae3585e972ca1cfea4b2afed99e041862f90cdbec` |
| J1 | 122,145 combined | 17 segment battles | `670a85f7bffb39728c3a1d2c8c3762c0db958e089feb1764e1b79e6519a15f07` |
| J2 | 172,060 combined | 56 segment battles | `933c8a78b28edb8ac12cd046254cda9adebd3dc0f02ba152513140809d01c60d` |

GB6's two maintained loss paths passed, all 334 dynamic lock checks resolved,
and the 263-map frozen scan found zero permanent input locks, blocking fibers,
or errors. The browser replay passed 3,793 frames with four exact logical-pixel
checkpoints, exact 2× nearest-neighbour output, the expected native-density
dialog hash, and zero console errors.

The battle presentation suite matched all six committed checkpoints at
480×272 and 960×544, including semantic HP, selection, capture, and animation
pixels plus exact rewind restoration. I also opened the 480×272 capture-shake
and 960×544 hit goldens: the battlefield, monsters, HUD, text, and effect
placement are visibly intact with no palette corruption or stale textures.

## Gates

| Command | Result |
| --- | --- |
| Two `bun run import` runs plus manifest comparison | Identical, 5,419 files |
| `bunx tsc --noEmit` | Exit 0 |
| `bun run build && bun run build:wasm` | Exit 0; wasm 357,528 B |
| `bun run test` | 257 pass, 0 fail, 0 skipped, 111,249 assertions across 44 files |
| `bun run verify:gb6:mainline` | PASS |
| `bun run verify:j1:mainline` | PASS |
| `bun run verify:j2:mainline` | PASS |
| `bun run verify:gb6:failures` | PASS |
| `bun run verify:g6:locks` | 334/334 resolved, 0 errors |
| `bun run verify:g6:determinism` | PASS |
| `bun run verify:g6:frozen` | 263 maps, 0 locks/fibers/errors |
| `bun run web && bun tools/verify-web-journey.ts` | PASS |
| Full GB6, short G6, C1, terrain, and battle QuickJS benches | PASS |
| `bun tools/desktop.ts --build-only` | PASS with silent host |

`bun.lock` is unchanged. No PocketJS source change was required.

Subagent use: 5 — map pipeline, battle asset import, battle runtime integration,
benchmark/tooling, and documentation/review; parallel work shortened the
implementation phase, while the primary agent integrated the branches and ran
all heavy gates serially.

PASS
