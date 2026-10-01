# Verification

This repository verifies the imported world two ways: by replaying
deterministic input recordings ("tapes") through the runtime and checking the
final state, and by comparing rendered keyframes against committed golden
images. CI runs the fast subset on every push (see [ci.md](ci.md)); the full
multi-rate, save/load and rewind checks are release gates you run locally.

## The verify scripts

All scripts read the committed data files; none of them need a build except
where noted. Set `TUXEMON_SRC` first (or keep a repo-local `.tuxemon-src`).

| Script | What it proves | Input | Rough duration |
|---|---|---|---|
| `verify:g6:determinism` | Two full imports into isolated roots produce byte-identical output (4,637 files). | Tuxemon source | ~25 s |
| `verify:terrain:determinism` | The terrain corpus alone is byte-stable across two runs. | Tuxemon source | ~15 s |
| `verify:terrain:collision` | Imported collision matches an independent Python oracle that mirrors Tuxemon's own movement code, cell by cell and direction by direction (default: 11 maps, 56,176 directed steps; `--all` for every map). | `data/terrain.json`, Tuxemon source, PyYAML | under a second for the default set; minutes for `--all` |
| `verify:g6:locks` | Every imported `lockInput` page releases its lock, either through `unlockInput` or a map transfer (330 pages, 334 checks). | imported project | ~15 s |
| `verify:g6:frozen` | No imported map can permanently freeze the player: every map is entered and driven for 12,000 frames, flagging held input locks, blocking fibers and interpreter errors. | imported project | ~65 s |
| `verify:gb6:mainline` | The 109,983-frame mainline tape replays at 60 Hz to the frozen terminal state, with every map checkpoint, all 100 battles (22 trainer, 78 wild) and the trainer win counts intact. | `data/gb6-mainline-journey.json` | ~72 s |
| `verify:gb6:failures` | Both committed defeat tapes (the first loss against Billie, and the later Route 3 loss) replay with their visible recovery order: faint-point teleport, heal-before-leaving block, nurse recovery. | `data/gb6-first-loss-journey.json`, `data/gb6-later-loss-journey.json` | ~40 s |
| `verify:j1:mainline` | The Captain-return continuation, concatenated with the GB6 tape and replayed from frame zero (122,145 frames), ends at the mansion with the captain's return and all 17 battles (10 trainer, 7 wild) intact. | `data/gb6-mainline-journey.json`, `data/j1-captainreturns-journey.json` | ~67 s |
| `verify:j2:mainline` | The hospital-cure continuation, concatenated with GB6 and J1 and replayed from frame zero (172,060 frames), ends in the Candy Town hospital with the cure granted and all 56 battles (50 trainer, 6 wild) won. | `data/gb6-mainline-journey.json`, `data/j1-captainreturns-journey.json`, `data/j2-hospitalcure-journey.json` | ~130 s |

Durations are wall-clock measured on a current developer machine; the CI
machines fold the mainline tapes in about a minute each.

### Modes of the two big verifiers

`verify-gb6-mainline.ts` and `verify-j1-mainline.ts` share a mode switch:

| Mode (GB6 / J1) | What it adds |
|---|---|
| default (`:mainline`) | One 60 Hz replay of the frozen tape against the production reducer. This is the CI leg. |
| `:segment` (J1 only) | Replays just the J1 segment from a rebuilt GB6 terminal snapshot. |
| `:stateful` | Saves mid-journey, restores the snapshot, and continues to the frozen terminal. |
| `:rates` (`:rate-60`, `:rate-30`, `:rate-20`) | Replays the same 60 Hz-authored tape at a lower host tick rate and compares the full session state against an independent 60 Hz fold, source frame by source frame. |
| `:full` | Standalone/merged replay plus save/load, rewind and all three rates. The release/acceptance gate; about ten minutes for GB6. |

### The QuickJS benches

`bench:g6:quickjs` and `bench:gb6:quickjs` measure real-frame CPU performance
inside the actual desktop host's QuickJS guest (not Bun's JavaScriptCore):
they build the vendored Rust host with a benchmark harness, boot the built
game, replay a tape frame by frame, and assert a 250 ms startup-to-first-paint
budget and 50 ms per-frame CPU budgets per frame class (walking, map switch,
battle entry/exit/steady). The final terminal state must hash to the pinned
tape value. Use these for any performance claim; Bun/JSC timings are not
representative of the desktop or PSP targets.

Build the matching desktop bundle before either benchmark. The benchmark
checks that its embedded map-manifest hash matches the generated project shell
and stops before compiling the harness when the bundle is missing or stale:

```sh
bun run build
bun run build:wasm
bun tools/desktop.ts --build-only
bun run bench:g6:quickjs
bun run bench:gb6:quickjs
```

The short G6 benchmark replays 3,793 frames at 480×272 and 960×544, then
measures the first visit to all 263 maps. The long GB6 benchmark replays all
109,983 frames and 100 battles; it defaults to 480×272, while
`GB6_BENCH_VIEWPORT="960 544" bun run bench:gb6:quickjs` selects the larger
viewport. A clean long run takes roughly 11 minutes per viewport on the
reference workstation. GB6 reads its expected terminal SHA-256 from the tape,
so re-pinning the tape cannot leave a second stale literal in the wrapper.
JavaScript compile/evaluation failures include the original message and stack.

These are manual release and performance gates, not CI jobs. Their Rust host
build and long replay are too expensive for the normal push pipeline, and
startup plus all-map first-visit measurements still contain wall-clock
sensitivity on shared runners.

## The tapes

A tape is a JSON document holding the input masks (one per 60 Hz frame), the
expected story variables, map checkpoints, battle checkpoints, and the
terminal state's SHA-256. The verifiers recompute the tape's own hash and
fail on any mismatch, so a silently corrupted tape is a red build.

| Tape | Frames | Route | Battles | Terminal |
|---|---:|---|---:|---|
| `data/g6-journey.json` | 3,793 | bedroom -> Paper Town -> first battle -> Route 1 | 1 | `spyder_route1 @14,19` |
| `data/gb6-mainline-journey.json` | 109,983 | Route 1 -> Cotton Town -> Paper Town -> Route 2 -> City Park -> Leather Center -> Route 3 -> Wayfarer Inn -> back to Route 3 | 100 (22 trainer, 78 wild) | `spyder_route3 @4,6` |
| `data/gb6-first-loss-journey.json` | 3,254 | the opening, deliberately losing the first Billie fight | 1 | `spyder_route1 @14,19` |
| `data/gb6-later-loss-journey.json` | 65,515 | the mainline prefix to Wanda, a deliberate loss, then the recovery path | 1 loss + prefix | `spyder_leather_town @23,10` |
| `data/j1-captainreturns-journey.json` | 12,162 (122,145 combined with GB6) | Wayfarer Inn -> Route 4 -> Flower City -> Route A -> Mansion -> basement -> the captain's return | 17 (10 trainer, 7 wild) | `spyder_mansion @1,13` |
| `data/j2-hospitalcure-journey.json` | 49,915 (172,060 combined) | Mansion -> Candy Town -> Greenwash -> hospital password -> the cure | 56 (50 trainer, 6 wild) | `spyder_candy_hospital3 @5,7` |

Terminal state hashes and per-checkpoint expectations live in the tapes or
their verifiers (`tools/verify-gb6-mainline.ts`, `tools/verify-j1-mainline.ts`,
`tools/verify-gb6-failures.ts`) and are asserted on every run.

### Re-recording a tape

Tapes are recorded by driving the game with the same deterministic driver the
verifiers use:

```sh
# J1 and J2 continuations
bun run record:j1:mainline        # writes data/j1-captainreturns-journey.json
bun run record:j2:mainline        # writes data/j2-hospitalcure-journey.json

# GB6 mainline
GB6_JOURNEY_OUT=data/gb6-mainline-journey.json bun tools/gb6-journey.ts

# First-loss path (choose the starter that loses to Billie)
HZ=60 GB4_OUTCOME=lose GB4_JOURNEY_OUT=data/gb6-first-loss-journey.json bun tools/smoke-spyder.ts

# Later-loss path
GB6_LATER_LOSS_OUT=data/gb6-later-loss-journey.json bun tools/gb6-later-loss.ts
```

After re-recording, update the verifier's pinned hashes and checkpoint lists,
regenerate the affected goldens (below), and re-run every verify script plus
the web journey. A re-recorded tape is a change to the game's contract, not a
test fixture refresh.

## Goldens

`tests/goldens/` holds the keyframe PNGs (480x272 and 960x544) and the
gzipped battle trace fixtures. The golden tests assert exact PNG SHA-256, a
decoded-RGBA hash, per-opaque-pixel sprite matches at the reducer-derived
positions, and semantic colour-region counts per map. There is no tolerance:
a single differing pixel fails.

| Command | Regenerates |
|---|---|
| `bun run goldens:g6` | The four opening keyframes and `data/g6-goldens.json`, by re-driving the opening tape (it runs the recorder first, because the PNGs are only valid for the current tape). Also rewrites `data/g6-journey.json`. |
| `bun run goldens:gb5:battle` | The six battle scenes (menu, technique menu, hit, faint, level-up, capture shake) at both viewports, plus `data/gb5-battle-goldens.json` and the battle screenshot in `docs/`. |
| `bun run goldens:gb6:route` | The four mainline route keyframes at both viewports and `data/gb6-route-goldens.json`. |
| `bun run goldens:j1` | The three Captain-return keyframes at both viewports and `data/j1-goldens.json`. |
| `bun run goldens:j2` | The hospital-cure keyframes (Aardant acquired, hospital password, the cure) at both viewports and `data/j2-goldens.json`. |
| `bun run goldens:daylight` | The same Paper Town checkpoint at fixed 09:00 and 21:00 starts, plus `data/daylight-goldens.json`. The test recomputes luminance, blue bias and per-pixel day/night differences from the decoded PNGs. |

Regenerate goldens only when the rendering change is intentional, and always
open the regenerated PNGs and look at them. A hash pins the bytes; it cannot
tell a correct picture from a consistently wrong one. Several past rendering
bugs (a same-tick resize that only extended black borders, a wrong depth
composite) were caught by eye, not by the assertions.

## Multi-Hz, save/restore and rewind

These are the properties the `:full`, `:rates` and `:stateful` modes check:

- **Multi-Hz.** The 60 Hz-authored tape is replayed at 30 and 20 Hz. The
  runtime folds the same number of reference ticks per host frame, and the
  entire session state must match an independent 60 Hz fold at every source
  frame. This proves the simulation is driven by a reference tick, not a wall
  clock.
- **Save/restore.** A snapshot is taken at a safe mid-journey frame,
  envelope-encoded, restored into a fresh session, and the continuation must
  reach the frozen terminal with identical history.
- **Rewind.** During a battle, the rewind input must land the history exactly
  at the battle's start frame with byte-identical restored state, and
  replaying the suffix must reproduce the frozen terminal. The J1 verifier
  additionally asserts the rewind refolded from a retained keyframe rather
  than from frame zero.

Battle scenes get the same treatment at the presentation layer: the
hit-frame rewind test clones the runtime state, steps back one event tick,
and asserts the framebuffer repaints byte-identically.

## When something fails

- **Determinism:** the output names the first differing file. That file's
  cooker (terrain, characters, battle, animated, project) is where to look;
  the usual cause is map-order-dependent iteration or a time-seeded RNG.
- **A journey verify:** the error label includes the diverging frame and
  position. Compare the run's checkpoint trace against the tape's checkpoints
  and the recorder's route in the corresponding `tools/*-journey.ts`.
- **A golden test:** diff the PNG against the committed one. If the change is
  intentional, regenerate with the matching `goldens:*` command, open every
  regenerated PNG, and commit the PNGs and the `data/*-goldens.json` manifest
  together.
- **Locks or frozen:** the JSON reports (`reports/G6-lock-report.json`,
  `dist/frozen-k1.json`) classify every failing page or map with the frame
  window where it stopped making progress.
