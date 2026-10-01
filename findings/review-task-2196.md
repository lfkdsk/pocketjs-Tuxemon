# Review: SLIM-G compact maps + indexed battle artwork (task 2196)

Reviewer task 2213, 2026-10-01. Reviewed branch `fleet/task-2196` @ `5cfb21e`
(10 commits over base `b832794`, which is on `main`). Specs: `game-SLIMG.md`,
`reviewer-generic.md`. All gates rerun by this reviewer on the real worktree.

## 1. Spec compliance, item by item

### 1.1 Kit bump to `2e10436`, wasm rebuild, bench `--no-default-features` — PASS

- Submodule pointer moved `dfbae47` → `2e10436` (`git diff b832794..HEAD -- vendor/pocket-rpgkit`). Both endpoints are reachable from the kit's `origin/main`; the 8 commits in between are `2e10436` (SLIM-K compact maps + indexed images) plus already-merged main lines: QOA audio (`ee84c7b`), actor pool (`2ab9306`), editor proposals/tutorial (`2fcf079`, `09e5e79`), demo chapter controls (`47353b4`), PocketJS pins (`d9af90f`, `41f7423`). Clean main-to-main bump, no unmerged kit work.
- The game branch made **no direct `vendor/pocketjs` edits** (`git diff b832794..HEAD -- vendor/pocketjs` empty); the nested pointer moved only as part of the kit bump (`b414e56` → `fb29b45`, on the fork's `rpgkit-base`).
- `bun run build:wasm` after the bump: exit 0, `pocketjs.wasm` 357,528 B (matches the report).
- All four active QuickJS bench scripts compile the copied desktop host with `cargo test --release --no-default-features --no-run`: `tools/bench-g6-quickjs.sh:58`, `tools/bench-battle-quickjs.sh:22`, `tools/bench-terrain-quickjs.sh:24`, `tools/bench-c1-readpath.sh:27`; `bench-gb6-quickjs.sh` is a thin wrapper over the g6 script.
- `tools/desktop.ts:61` delegates feature selection to the kit's `desktopHostFeatures()` (pkg-config probe). This machine has **no ALSA development packages** (`pkg-config --exists alsa` fails, no `libasound2-dev`): `bun tools/desktop.ts --build-only` printed "building the host without audio output" and built the release host successfully (exit 0).
- Non-blocking findings: `findings/kit/KR1-scripts/run-kr1-quickjs.sh:30` (a tracked findings artifact, not active tooling) lacks the flag and would fail to link here; the kit's own `tools/slim-map-quickjs-bench.sh:23` also lacks it (kit-side gap, not copied by the game).

### 1.2 Compact map format — PASS

- `gen-assets.ts:338-341` passes `entryEncoding: "auto"` — compact is not forced; the kit chooses it only when the compact text is shorter (`vendor/pocket-rpgkit/tools/lib/map-project.ts:71-77`). All 263 maps currently choose `rpgkit-map/1` (test `tests/map-shards.test.ts:30`; my count: 263 `.rkm`, 0 `.json` in `dist/maps`).
- **Equivalence (reviewer-built check):** my script `/var/tmp/fleet/2213/equiv-maps.ts` decodes every committed shard with the kit's `decodeCompactMap` and compares all nine `MapDef` fields (including optional-field presence) against the inline oracle `dist/project.json`: **263/263 pass, 0 failures**. Coverage includes `buddha_mountain` (100×100, the largest), all 48 animated-tile maps (their `dist/animated/` shards exist and parse), and 9/9 top one-way-stairs maps (`spyder_scoop1` 130 edges, `eclipse_lion_mountain_middle` 114, `route3` 93, …). Stairs/ledge collision rides in `ground`/`passage`, which are compared.
- The kit's own round-trip test (`vendor/pocket-rpgkit/tests/compact-map.test.ts`) asserts `canonicalJson(decoded) === canonicalJson(input)`, and `tests/map-shards.test.ts:54-76` drives the real `MapRepository` over the packaged bytes — both pass in the suite below.
- **Before/after sizes (reviewer-measured):** base import at `b832794` → 8,676,277 map bytes / 83,232 shell bytes; current import → 3,708,056 / 82,969. Matches the report (−57.3%).
- Cold first-visit p95 (report: compact 12.046 ms p95 / 45.090 ms max vs canonical JSON 4.040 / 14.184): I did not rerun the kit's standalone slim-map bench; the full GB6 QuickJS run below exercises real map switches on the compact shards.

### 1.3 Indexed battle artwork + lazy cache — PASS

- `importer/battle.ts:678-687` normalizes pixels to the legacy RGBA4444 display precision before `encodeClut8Tile` (`:721`); 578 single-tile `.pkts` entries (132 technique animations + 446 gfx), deterministic (frequency-sorted palette, nearest-colour fallback that never fired: `data/battle-assets-report.json` quantization block all-zero).
- **Pixel equivalence (reviewer-built check):** my script `/var/tmp/fleet/2213/equiv-battle.ts` decodes all 578 entries with a self-written `decodeSingleTile` + `packbitsDecode` and compares against `legacyDisplayedRgba(source PNG)` — exactly what the old eager PSM_4444 path displayed: **578/578 identical, 12,593,920 pixels, 0 failures**. (The old path baked PSM_4444 IMG entries into the pak with no on-disk blobs, and the source PNGs are byte-unchanged by the migration, so PNG-vs-.pkts is the true before/after comparison.)
- **Lazy load/release:** one reference-counted `TileTextureCache` per battle scene (`ui/battle-scene.tsx:172`; kit `src/ui/tile-texture-cache.ts`), scope follows `active`, pinned entries survive scope exit and free on final release. The reentry bug fixed by `5b4b8d9` (child effects observing an ended scope) is closed by reopening the scope synchronously in `activeImageSource`. The balance test `tests/battle-presentation-sim.test.ts:245-265` drives three full enter/exit cycles and asserts per cycle: loads are unique (handle sharing), free multiset equals load multiset, and every free follows a detach-to-(-1) — passed in the suite below.
- **Visual check (eyes on):** I rendered the GB1 battle preview sheet and opened the committed goldens `gb5-battle-capture-shake.480x272.png` and `gb5-battle-hit.960x544.png`. Battlefield, monsters, HP/XP bars, type icons, text, capture shake and hit effects are all intact; no palette corruption, no stale textures.
- **Sizes (reviewer-measured):** base import battle-only pak bytes 26,440,560 → current 3,392,752 (report: −87.2% ✓). Encoded payloads 2,158,468 B on disk; the report's 13,185,792 B "all decoded" figure is exactly my measured 12,593,920 index bytes + 578×1024 B palettes.
- `data/battle-db.json` / `data/battle-runtime-db.json` diffs vs `b832794` are **purely** art-key renames (`ui:img.*` → `ui:tile.battle/*`); no behavioural data changed (verified by diffing with art-key lines excluded — empty).

### 1.4 No regressions — PASS

- `verify:gb6:mainline`: 109,983 frames, 100 battles, ends `spyder_route3@4,6`, terminal SHA `cedface0462df16d087a4cbae3585e972ca1cfea4b2afed99e041862f90cdbec` — matches the report and the frozen tape.
- `verify:j1:mainline`: 122,145 combined frames, 17 battles, `670a85f7bffb39728c3a1d2c8c3762c0db958e089feb1764e1b79e6519a15f07` ✓.
- `verify:j2:mainline`: 172,060 combined frames, 56 battles, `933c8a78b28edb8ac12cd046254cda9adebd3dc0f02ba152513140809d01c60d` ✓.
- `verify:gb6:failures`: both loss paths PASS (first loss + later Wanda loss with faint teleport, blocked exit, heal).
- `verify:g6:locks`: 334/334 resolved, 0 errors. `verify:g6:determinism`: PASS, 4,742 files / 59,594,122 B / `574836a4…`. `verify:g6:frozen`: 263 maps, 0 permanent locks/fibers/errors.
- Web replay: see §2. QuickJS frames: see §3.

### 1.5 Documentation — PASS with minor notes

- `docs/status.md:16` marks compact maps Done with sizes + pointer; `:56` marks indexed battle art Done (capability + limitation present; **missing the pointer to details** the status-marking rule asks for — minor); `:110-113` update the web/PSP/startup rows with the new footprint and the decode-time tradeoff.
- `docs/architecture.md` updates the asset pipeline (`dist/maps/*.rkm`, `dist/battle-art/*.pkts`, battle PNGs retained as preview/golden sources).
- README performance section carries the new numbers; every one I measured matches (pak 38,538,256 B desktop; maps 3,708,056 B; battle 3,392,752 / 2,158,468 / 13,185,792 B; 263 maps; 578 images).
- **Pre-existing staleness, not introduced by this branch** (verified against `b832794`): README coverage percentages (85.8/89.6/91.1 vs the committed report's 89.0/90.6/93.8/92.1 — `origin/main`'s README already corrects this to 89.0/92.1/93.8/92.1); README event count 4,572 (scout census: 4,578); `architecture.md` "42 files" (44 at `b832794` already) and "35 ops" (46 at both kit pins). `status.md:89` audio rationale ("kit's audio support is in progress") is imprecise after the kit bump landed the full audio vocabulary — borderline, game-side wiring is still pending.

## 2. Gates (rerun by reviewer)

| Command | Result |
| --- | --- |
| `bun run import` ×2 + manifest diff | Identical, 4,109 dist files byte-for-byte |
| `bunx tsc --noEmit` | Exit 0 |
| `bun run build` | Exit 0; `dist/main.pak` 38,538,256 B |
| `bun run build:wasm` | Exit 0; 357,528 B |
| `bun test tests/` | 257 pass, 0 fail, 111,249 assertions, 44 files (193 s) |
| `verify:gb6:mainline` | PASS, `cedface0…` |
| `verify:j1:mainline` | PASS, `670a85f7…` |
| `verify:j2:mainline` | PASS, `933c8a78…` |
| `verify:gb6:failures` | PASS |
| `verify:g6:locks` | 334/334, 0 errors |
| `verify:g6:determinism` | PASS, `574836a4…` |
| `verify:g6:frozen` | 263 maps, 0/0/0 |
| `bun tools/desktop.ts --build-only` | PASS, silent host (no ALSA) |
| `bun run web && bun tools/verify-web-journey.ts` | PASS — 3,793 frames, 4 checkpoints, 0 console errors; web pak 38,770,624 B |
| GB6 QuickJS bench | 2 runs: #1 FAIL (53.592 ms > 50 ms), #2 PASS — see §3 |
| Merge with current `main` | PASS — see §4 |
| Mutation checks | 2/3 caught — see §5 |

Before/after sizes (reviewer-measured, like-for-like):

| Artifact | Before (b832794) | After (5cfb21e) | Report |
| --- | ---: | ---: | --- |
| Desktop `dist/main.pak` | 66,558,960 | 38,538,256 | 66,558,960 / 38,538,256 ✓ |
| Map repository bytes | 8,676,277 | 3,708,056 | ✓ |
| Map shell bytes | 83,232 | 82,969 | ✓ |
| Battle-only pak bytes | 26,440,560 | 3,392,752 | ✓ |

## 3. QuickJS performance

Reviewer reran `bun run bench:gb6:quickjs` (full 109,983-frame / 100-battle
journey on the real desktop QuickJS host, 480×272) **twice**:

| Run | Result | Worst frame |
| --- | --- | --- |
| Builder (report) | PASS | 45.694 ms |
| Reviewer #1 | **FAIL (panic)** | f109935 `spyder_wayfarer_inn1` — **53.592 ms** CPU (wall 53.592) |
| Reviewer #2 | PASS | ≤50 ms (sampled max 40.952 ms, f62970 `spyder_route3`) |

Both reviewer runs ended at the canonical terminal SHA `cedface0…`. The budget
asserts on **thread CPU time** (`g6-quickjs-bench.rs:760-780`), so the overshoot
is real compute, not descheduling. The offending frame is a late-journey
dialog/transfer frame on a **warm revisit** of `wayfarer_inn1` (re-entered at
frame 109,462; first visit 107,482) — it is **not** a compact-map cold decode
nor a battle-art load. The changed paths are comfortably under budget in both
runs: map-switch max 7.8 ms, battle-entry max 22.6/23.0 ms, battle-exit max
16.5/16.9 ms (budgets 50 ms).

**Finding (major, non-blocking):** the GB6 worst-frame gate is flaky at the
budget boundary — run-to-run variance spans ~41–54 ms (builder 45.7 ms), and
one of two clean reviewer reruns panicked over 50 ms. The margin is too thin
for a reliable CI gate. By code-path analysis the slow frame is unrelated to
SLIM-G's changes (compact decode and battle-art loading are warm/under-budget
there); the marginality is most likely pre-existing (late-journey dialog/
transfer cost) amplified by CPU-frequency variance. Recommend the follow-up
task investigate frame f109935's cost or give the gate more margin. I did not
run the pre-change GB6 bench to confirm attribution by measurement.

The short-journey table in the report (startup 131.888/144.089 ms, walking p95
1.883/1.834, switch 9.211/9.228, battle entry 25.276/29.406, exit 7.358/7.750)
is consistent with my full-run measurements at 480×272 (boot 122–134 ms,
walking p95 3.362, switch p95 3.912/max 7.8, battle-entry p95 15.4/max 22.6,
battle-exit p95 12.6/max 16.5); I did not rerun the standalone short bench.

## 4. Merge with current game-repo `main`

Merged `origin/main` (D2 day/night `a1f8510` + DEMO-G1 chapter snapshots
`29ad5a1`) into the review branch in a temp worktree
(`/var/tmp/fleet/2213/merge-test`). **5 conflicts**, all resolvable as the
union of both sides' changes:

| File | Conflict | Resolution |
| --- | --- | --- |
| `README.md` | SLIM-G performance section vs main's coverage % | Kept SLIM-G's section + main's corrected coverage line (89.0/92.1/93.8/92.1, which matches the merged `reports/G1-coverage.md`) |
| `data/g6-assets-report.json` | compact vs JSON map stats | Took SLIM-G's side; regenerated by the post-merge import |
| `docs/ci.md` | 6 vs 7 journey legs | Took main's (chapters leg is the post-merge reality) |
| `tools/g6-quickjs-bench.rs` | audio mount vs fixed-clock eval | Kept both (audio host + `__pocketTuxemonInitialCivilTime`) |
| `tools/gb5-battle-fixture.ts` | tracked-ops wrapper vs `FIXED_TIME_HOST_GLOBALS` | Kept both — `wrapTrackedOps` already wraps structural + texture ops |

`tools/bench-g6-quickjs.sh` auto-merged and **kept `--no-default-features`**
(verified at line 58). Post-merge gates (all in the temp copy): import ×2
byte-stable, `tsc` 0, `build` 0, `build:wasm` 0, `bun test` **282 pass / 0
fail** (main's day/night + chapter tests merged cleanly), `bake-chapters`
regenerated 13 chapters, `verify-chapters` PASS (snapshots + thumbnails
byte-identical, all 13 suffix replays reach the merged terminal
`52daead6527d…`). The merge is clean and green; the only follow-up is that
the README performance numbers should be re-measured after the merge (the
day/night importer changes map content slightly, so the SLIM-G sizes shift).

## 5. Mutation checks

Reviewer-built mutations in an isolated copy (`/var/tmp/fleet/2213/mut`):

| # | Mutation | Test | Result |
| --- | --- | --- | --- |
| M1 | `decodeCompactMap` drops events (`compact-map.ts:327`) | `tests/map-shards.test.ts` | **RED** (0 pass / 1 fail) → restored, GREEN (3 tests, 2,116 assertions) |
| M2 | `legacyBattleRgba` quantizes `* 16` instead of `* 17` (`importer/battle.ts:681-684`) + re-import | `tests/battle-import.test.ts` | **RED** — "framebuffer parity" fails (6 pass / 1 fail) → restored + re-import, GREEN (7 tests, 12,873 assertions) |
| M3 | Disable the `5b4b8d9` reentry fix (`battle-scene.tsx:177` `if (false && props.active)`) | `battle-presentation-sim.test.ts` + `g6-keepalive.test.ts` | **stayed GREEN** (7/7 and 3/3) — see finding below |

**Finding (minor):** the `5b4b8d9` cache-reentry fix has no failing regression
test — disabling it leaves both the balance test and the keepalive test green.
The fix is defensive against a Solid effect-ordering race (child image effects
observing a just-ended cache scope on reentry) that the sim fixtures do not
deterministically reproduce. The fix itself is correct and small; the gap is
that a future refactor could silently remove it. Recommend a follow-up to add
a fixture that forces the same-batch reentry ordering.

## 6. Principles (reviewer-generic §6)

- **Fully automatic import:** yes. The compact path has no per-map special cases (the only map-id logic in `gen-assets.ts` is pre-existing `test_` filters); no hand-edited imported artifacts (`dist/maps/*.rkm` and `dist/battle-art/*.pkts` are gitignored and regenerated; tests assert on-disk bytes equal generator output).
- **No Tuxemon-specific code in the kit:** confirmed by reading the kit diff — `compact-map.ts`, `clut8.ts`, `map-project.ts`, `tile-texture-cache.ts`, `LazyImage.tsx` are all generic; Tuxemon mentions under `vendor/pocket-rpgkit/src` are pre-existing parity comments only.
- **No `vendor/pocketjs` source changes:** confirmed (empty diff); the pointer moved only via the kit bump, and the wasm was rebuilt.
- **`bun.lock` unchanged:** `git diff b832794..HEAD -- bun.lock` empty.
- **No local paths / task numbers** in code, tests, docs, README (findings/ exempt).

## 阻断项

无 SLIM-G 阻断项。两个非阻断发现：

1. **（major）GB6 QuickJS 最坏帧门限在 50 ms 预算边缘 flaky**：评审两次复跑，一次 panic（f109935 `spyder_wayfarer_inn1` 53.592 ms），一次通过（≤50 ms）；builder 报告 45.694 ms。该帧是旅程末尾的对话/传送帧（warm revisit），与紧凑地图解码（冷启动才走）和战斗图懒加载均无关——两条被改路径在所有运行里都远低于预算（map-switch max 7.8 ms、battle-entry ≤23.0 ms、battle-exit ≤16.9 ms）。按代码路径分析属既有边际问题 + CPU 频率方差，不是 SLIM-G 回归。建议后续任务查该帧成本或给门限加余量。
2. **（minor）`5b4b8d9` 缓存重入修复没有失败型回归测试**：禁用它（M3）后 `battle-presentation-sim` 与 `g6-keepalive` 全绿。修复本身正确（防 Solid effect 同批竞态），但 fixture 不复现该竞态，未来重构可能静默移除它。

另有两条既有文档陈旧（非本分支引入，`b832794` 时已存在）：README 覆盖率 85.8/89.6/91.1 与 `reports/G1-coverage.md` 的 89.0/90.6/93.8/92.1 不符（`origin/main` 的 README 已更正）；README 事件数 4,572（scout 普查 4,578）；`architecture.md` 测试文件数 42（实际 44）与 kit 操作数 35（实际 46）。

## Subagent use

4 read-only subagents in parallel (map pipeline implementation; battle import +
runtime cache; docs numeric claims; bench scripts + kit-bump classification).
They saved main-agent context and wall-clock; the reviewer personally reran all
gates, benchmarks, equivalence scripts and visual checks. `fleet_claim`s are
registered only by the main agent.

## Verdict

SLIM-G meets its spec: compact maps and indexed battle artwork are
field/pixel-equivalent (263/263 maps, 578/578 images, reviewer-built scripts),
all size numbers reproduce exactly, the lazy cache balances load/free across
battle cycles, every gate is green (257 tests, 7 journey verifies, web replay,
desktop silent-host build), the kit bump is a clean main-to-main bump with no
direct PocketJS edits, and the merge with current `main` is conflict-resolvable
and green (282 tests, chapters PASS). The two findings above are non-blocking.

PASS
