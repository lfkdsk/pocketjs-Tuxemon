# DOC-G1: game-repo documentation (README + architecture/importer/verification/ci)

Docs-only task. Updated `README.md` and added four pages under `docs/`. Every
command mentioned in the docs was run in this worktree unless noted below.

Mid-task, `main` advanced from `43ab2d2` to `4d6fb73` (the D1 clock/weather
importer). The branch was rebased onto the new baseline and every number in
the docs was re-verified against it; the sections below report the
new-baseline runs.

## What was written

### README.md

- **Status:** the World line now follows the campaign to the Captain's return
  (Route 4, Flower City, Mansion; 122,145 frames for the full mainline). The
  Battles line now counts 117 real battles across both tapes (100 on GB6, 17
  on J1). The Performance line replaces the unsourced "walking stays near 1
  ms per frame" with measured worst cases (map switch 15.9/14.7 ms, battle
  entry 22.2/22.6 ms, battle exit 34.4/38.5 ms, from the GP1 measurement on
  2026-09-30) and states the bench budgets (250 ms startup, 50 ms per-frame
  CPU); the bundle size is corrected from 1.1 MB to 1.29 MB (measured build).
  Added an Import coverage line (85.8%/89.6% native, 91.1%/91.1% executable)
  linking `reports/G1-coverage.md`.
- **Running:** expanded to one line each for setup, fetch:tuxemon, import,
  build, build:wasm, desktop, web, tsc, test, and the three headline verify
  scripts.
- **Documentation:** new section linking the four docs pages.
- Fixed a stale screenshot caption ("northernmost point of the current
  journey" — the journey now continues past Route 3).

### docs/architecture.md

Repository layout (every top-level entry, per-file roles for `importer/` and
`battle/`), the import data flow with committed-vs-gitignored outputs, the
20 `tux.*` extension calls (10 commands, 10 conditions, including the D1
`update_time`/`set_layer`/`time_is` placeholders) with what each does and
where they register, and the component-repo boundary with a kit-bump
checklist. Sources: the code itself, `main.tsx`, `battle/extension.ts`,
`.gitmodules`, `findings/kit-bump-b778aa0.md`, and the CI gate.

### docs/importer.md

Source checkout (`fetch:tuxemon.sh`, pinned `9e6258ff`, `TUXEMON_SRC`), how
events become kit commands (trigger-shape classification, the 35-op kit
vocabulary, 18 emitted by the importer), the four dispositions with concrete
examples each (native/degraded/placeholder/dropped — with the D1
clock/weather placeholders in their own subsection), how to read and
regenerate the coverage report (G6 vs default profile), and a five-step
recipe for adding a mapping. Sources: `importer/project.ts`,
`importer/coverage.ts`, `reports/G1-coverage.md`, `tests/importer.test.ts`.

### docs/verification.md

A table of all eight `verify:*` scripts with what each proves, its inputs and
measured durations; the mode matrix of the two big verifiers (ci/segment/
stateful/rates/full); the QuickJS benches; the five tapes with frames, routes,
battle counts and terminals; how to re-record each tape; the golden updaters
and the visual-inspection rule; multi-Hz/save-restore/rewind semantics; and a
failure-triage section. Sources: the verifier sources, the committed tapes,
and this task's runs (below).

### docs/ci.md

The prepare action, the five jobs (import, test with its four groups, journey
with its five legs, web, deploy), the two caches, per-job local reproduction
commands, and the conventions for adding a journey leg or rebalancing a test
group. Sources: `.github/workflows/ci.yml` and
`.github/actions/prepare/action.yml`, read in full.

## Commands run in this worktree (baseline 4d6fb73)

All with `TUXEMON_SRC=/var/tmp/tuxemon-src` (the checkout is at the pinned
`9e6258ff`).

| Command | Result |
|---|---|
| `git submodule update --init --recursive` | kit `df2d1c3`, pocketjs `9eda4b5` |
| `bun install --frozen-lockfile` (public registry) | 488 packages, no lockfile change |
| `bun run import` | 12.7 s; `git status --porcelain` empty afterwards |
| `bunx tsc --noEmit` | exit 0 |
| `bun run verify:g6:determinism` | PASS (pre-rebase run on 43ab2d2: 4,637 files, sha256 `c7821ebf…`, 24.9 s) |
| `bun run build:wasm` | PASS, 3.6 s |
| `bun run build` | PASS, 30.6 s; `dist/main.js` 1,290,440 B |
| `bun run test` | 244 pass / 0 fail across 42 files, 80,531 assertions, 177 s |
| `bun run verify:g6:locks` | PASS, 330 pages / 334 checks (328 unlocked, 2 transferred), 15.1 s |
| `bun run verify:g6:frozen` | PASS (pre-rebase: 263 maps, 0 locks/fibers/errors, 65.4 s) |
| `bun run verify:gb6:mainline` | PASS, 109,983 frames, 100 battles (22 trainer + 78 wild), end `spyder_route3@4,6`, hash `df7c996e…`, 57.0 s |
| `bun run verify:gb6:failures` | PASS (pre-rebase: first loss 3,254 frames; later loss 65,515 frames, 40.3 s) |
| `bun run verify:j1:mainline` | PASS, 122,145 combined frames, 17 battles (10 trainer + 7 wild), hash `88c3c691…`, 67.2 s |
| `bun run verify:terrain:determinism` | PASS (pre-rebase, 15.4 s) |
| `bun run verify:terrain:collision` | PASS (pre-rebase, 56,176 directed steps / 11 maps / 0 mismatches, 0.3 s) |
| `bun run web` + `bun tools/verify-web-journey.ts` | PASS, 14.3 s build + 2.5 s journey; 4/4 checkpoints (state + pixel hashes), 0 console errors |
| `bun tools/desktop.ts --build-only` | PASS (pre-rebase, 65 s incl. 47 s cargo release build) |

Runs marked "pre-rebase" were executed on the original baseline `43ab2d2`
before `main` moved; the rebase changed only docs files in this branch, and
the new baseline's own commit states every journey replays to the same end
state. The three journey verifies that the tape/data changes could affect
(locks, GB6 mainline, J1 mainline) were re-run on `4d6fb73` and pass; the GB6
terminal hash changed (`d62d1465…` → `df7c996e…`) because the clock/weather
extension state is now part of the serialized session, while the J1 terminal
hash is unchanged.

Not run: the `goldens:*` updaters (they rewrite committed golden fixtures;
the golden tests in `bun run test` already prove the committed PNGs match the
current build, so regeneration would be a no-op or an unintended change),
`bun run fetch:tuxemon` (the pinned checkout already exists and was verified
at `9e6258ff`), and the `:stateful`/`:rates`/`:full` verify modes (release
gates, ~10 min each; documented from source). `bun run desktop` itself needs
a display; this machine has none, so only `--build-only` was run.

## Implementation issues found (not fixed, per task scope)

1. **`tools/bench-gb6-quickjs.sh:9` pins a stale terminal hash.** It sets
   `G6_STATE_SHA256=bd3616c7…`, but the committed GB6 tape declares
   `df7c996e…` on the current baseline (it was `d62d1465…` before the D1
   commit, and `bd3616c7…` before that re-record). The bench's final state
   comparison would fail against the current tape. `bench:g6:quickjs` is
   unaffected (its hash `5653f011…` matches the g6 tape).
2. **`play_map_animation` is dropped despite native kit support.** All 276
   uses (plus 1 `play_tile_animation`) hit the default case
   (`importer/project.ts:1556-1558`, "presentation / meta"), but the kit at
   the current pin documents `mapAnim`/`stopAnim` as Tuxemon
   `play_map_animation` parity (`vendor/pocket-rpgkit/src/engine/types.ts:339`).
   This is the largest droppable-vs-supported gap in the coverage report.
3. **`data/g6-performance.json` is orphaned** — no reader or writer anywhere
   in the current tree.
4. **`tools/update-g6-goldens.ts:1` says "three maintained G6 journey
   keyframes"** — there are four (bedroom, downstairs-mom, paper-town,
   route-1).
5. **`data/g6-journey.json`'s payload `sha256` field is unverified** — unlike
   the first-loss tape, no test checks it.
6. **Coverage asymmetry worth a manual check:** `is environment_is` shows
   dropped uses while `not environment_is` shows native ones, though both go
   through the same battle-profile branch. Likely structural drops, but
   unconfirmed without instrumenting the import.
7. **Upstream doc drift (not ours to fix here):** the kit README says "28
   commands" but the pinned `Command` union has 35 ops.
8. **Stale process docs:** `findings/GB6.md` cites an older tape
   (109,981 frames, `bd3616c7…`); the committed tape is 109,983 frames /
   `df7c996e…`. `findings/` is process documentation, so it was left alone.

## Self-checks

- `git diff --stat main` touches only `README.md`, `docs/*.md` and this
  report (verified after the rebase).
- No task numbers, review IDs, machine-local paths or intranet addresses in
  `README.md` or `docs/` (grep-verified); no emoji.
- Every number in the docs traces to either a file in the tree or a command
  run listed above; the kit op/condition/trigger counts (35/10/4) and the
  `tux.*` register (20 calls) were verified against the pinned sources.
- `bunx tsc --noEmit` exit 0 and `bun run test` 244/0 on the current
  baseline.

## Subagent usage

4 subagents (general-purpose, read-only, run in parallel): (1) repository
architecture — layout, data flow, `tux.*` extensions, kit boundary;
(2) importer mappings — dispositions, coverage mechanics, mapping recipe;
(3) verification — every verify script, tapes, goldens, multi-Hz/rewind;
(4) CI — workflow and prepare action read in full. All four returned
file:line-evidenced reports; every load-bearing claim was spot-checked by me
against the code before going into the docs, and the discrepancies they
found became the issues list above. Saved time: yes — roughly an hour of
reading was parallelized into ~9 minutes of wall time, and the docs were
drafted from verified notes instead of raw exploration.

PASS
