# WEBTXT-G — native-density web text for Pocket Tuxemon

## Result

PASS. The web build now explicitly renders its 480×272 logical scene at a
2× raster density (960×544 physical pixels). Fonts are baked and drawn at
native 2× density, while the imported Tuxemon tiles, walkers, monsters and
battle art remain nearest-neighbour pixel art. The maintained browser journey
finishes with no console errors and retains every existing 1× map golden.

The game vendors Pocket RPG Kit `dfbae47`, which contains the browser density
support. `web.json` pins `rasterDensity: 2` instead of relying on the kit's
default, so the game's intent remains stable if that default changes later.

## Browser verification

`tools/verify-web-journey.ts` still replays all 3,793 frames and checks the
four committed logical map hashes and states. It now additionally proves the
physical rendering contract:

- the browser reports a 480×272 logical viewport, density 2 and a 960×544
  backing canvas;
- all four text-free map checkpoints have zero pixels that differ from an
  exact 2× nearest-neighbour expansion, so the map art stays hard-edged;
- the complete Paper Town dialog at frame 1,537 matches the committed
  960×544 golden by SHA-256 of decoded RGBA
  `f15eb46178229cab37c8fd9aa4d34b0f361a940ada21c8eb6fbbd3c003faea1c`;
- the texture-only map area above that dialog has zero nearest-neighbour
  mismatches, while the dialog text ROI has 3,591 mismatching physical pixels.
  This makes the test reject an implementation that merely scales a 1× font;
- the final canvas and core framebuffer have zero byte mismatches;
- at the test browser's DPR 1, the 960×544 CSS size and backing size are equal:
  every raster sample occupies exactly one device pixel;
- the complete replay reports `console errors: 0` and `WEB JOURNEY PASS`.

The new golden is `tests/goldens/web-density-paper-dialog.2x.png` (960×544,
PNG SHA-256 `43dcb4a44890669cac4280ba56670ab72663d0f4953bcc1d17aee7ab2d1abb59`).

## Visual inspection

I opened both comparison images at original resolution:

- [`web-density-paper-dialog.png`](../docs/screenshots/web-density-paper-dialog.png)
  places the 1× Paper Town dialog, nearest-neighbour enlarged to the same
  physical size, above the native 2× frame. The 1× glyphs visibly contain
  enlarged grey edge blocks; the 2× glyph curves and diagonals have finer,
  cleaner coverage. The town terrain and sprites retain the same pixel edges.
- [`web-density-battle-menu.png`](../docs/screenshots/web-density-battle-menu.png)
  makes the same comparison for the first battle root menu. Monster/background
  texels remain square and unsmoothed, while names, HP text, prompt and menu
  labels are visibly clearer at 2×.

Both comparisons are 960×1168 RGBA PNGs, with the two captures shown at equal
physical size. Their SHA-256 values are respectively
`f26f65d1d2e50b971823ccde1449c58ec07cae7b4aac9adff58b68bfac1014f9`
and `7b6daf28521d7c443ead0f34fc935df869d3104ac515c38106ef07eb9a770ec0`.
`docs/status.md` links both images from the Web platform row and documents the
2× text / nearest-neighbour art behavior.

## Headless Chrome cost

The cost comparison uses two complete production web builds, one compiled at
1× and one at 2×. A headless Chrome instance replays the 3,793-frame first
journey with real `step()` plus `paint()` on every frame, so each sample
includes the reducer/core step, incremental WASM raster, framebuffer copy and
`putImageData`. Runs alternate 1×/2× order; 11 runs were made with no other
agent commands active, the first warm-up run was discarded, and the remaining
10 runs produced these totals:

| frame class | samples per density | 1× mean / p50 / p95 / max | 2× mean / p50 / p95 / max |
| --- | ---: | ---: | ---: |
| walking | 830 | 1.19 / 0.50 / 2.50 / 4.20 ms | 4.08 / 1.70 / 8.80 / 15.10 ms |
| map transfer | 50 | 2.80 / 2.40 / 5.30 / 5.80 ms | 6.21 / 4.50 / 11.90 / 12.20 ms |
| battle entry | 10 | 10.02 / 10.50 / 14.10 / 14.10 ms | 13.33 / 13.00 / 16.80 / 16.80 ms |
| battle exit | 10 | 3.79 / 4.00 / 4.10 / 4.10 ms | 9.22 / 8.90 / 11.50 / 11.50 ms |

The 2× framebuffer has four times as many bytes, so raster/copy cost is
expected to rise. Walking, transfers and battle exit remain below 16.7 ms even
at their observed maxima. Battle entry reaches 16.8 ms once per measured run
class—on the 60 Hz boundary, but not materially beyond it—and its mean is
13.33 ms. This does not justify a scene-specific density switch. The kit's
density is build-wide; a constrained browser can still opt down to 1× globally.

The 2× pak is 63,031,424 bytes versus 62,799,056 bytes at 1×: a 232,368-byte
(0.37%) increase from the higher-density font/vector resources.

## Test robustness found during the gate

The first complete test run exposed an unrelated timeout-only flake: the
four-rate attract replay completed its state comparisons in 37.94 s but had a
30 s timeout. In isolation the same test passed in 19.17 s. Its neighboring
full-journey repository replay already has a 60 s budget, so the attract test
now uses the same budget. A subsequent complete run passed all 249 tests.
No behavioral assertion or journey data changed.

## Final gates

| command | result |
| --- | --- |
| `bun run import` twice + `git diff --exit-code` after each | exit 0; generated output stable and clean |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 |
| `bun run build:wasm` | exit 0; 289,981-byte wasm |
| `bun run test` | 249 pass, 0 fail, 0 skipped; 89,311 expectations |
| `bun run verify:gb6:mainline` | PASS; 109,983 frames, 100 battles, `spyder_route3@4,6` |
| `bun run verify:j1:mainline` | PASS; 122,145 combined frames, 17 segment battles |
| `bun run verify:j2:mainline` | PASS; 172,060 combined frames, 56 segment battles |
| `bun run verify:gb6:failures` | PASS; first and later loss/recovery paths |
| `bun run verify:g6:locks` | 334/334 checks resolved; 0 unresolved/errors/exceptions |
| `bun run verify:g6:determinism` | PASS; 4,638 files, 61,926,051 bytes, two isolated roots identical |
| `bun run verify:g6:frozen` | 263 maps; 0 permanent locks, blocking fibers or errors |
| `bun run web && bun tools/verify-web-journey.ts` | PASS; 960×544 physical canvas, native 2× dialog golden, 0 console errors |

`bun.lock` is unchanged. The worktree and both submodules are clean, and the
changed production files, tests, documentation and commit messages contain no
machine-local paths or task identifiers.

subagent 使用：3 个；分别只读审查网页验证器辨识力、稳定截图帧与 Chrome 性能口径；并行核对发现了文字门禁缺口并缩短了方案探索，所有构建、性能复测、画面检查和最终门禁均由主 agent 串行完成。

PASS
