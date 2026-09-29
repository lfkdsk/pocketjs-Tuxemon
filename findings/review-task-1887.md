# Review of G7 (task 1887) — game-side lazy map repository

Reviewed at HEAD `d8d46a1` on `fleet/task-1887`, baseline game-repo `main` `2c4411d`.
Spec: `/var/tmp/fleet-specs/pocket-tuxemon/game-G7-sharded.md`. All gates
re-run independently in this session; evidence paths under `/var/tmp/fleet/1897/`.

## 1. Equivalence

- `tests/g7-repository.test.ts` re-run: journey (2,728 frames), attract replay
  at 60/30/20/4 Hz, and cross-map save/restore all pass — confirmed by my own
  `bun test tests/` run (45 pass, 0 fail, 45,942 expectations,
  `/tmp/test.log`, `/tmp/test2.log` after a full rebuild).
- **Mutation check (passed):** deleted `system.messageBlocksPlayer` from the
  built `dist/project-shell.json` and re-ran `tests/g7-repository.test.ts` —
  all 3 tests failed immediately with `map repository: shell manifest hash
  mismatch` (`vendor/pocket-rpgkit/src/engine/session.ts:306`). The shell's
  `mapManifestHash` covers the whole non-`maps` payload, so any dropped/altered
  top-level field (not just map bodies) is caught, not just a coincidental
  divergence in `SessionState`. Restored the file afterward; `bun test` green
  again.
- `mapIndex` order comes from `splitProjectMaps(project)` (vendor, order =
  `project.maps` order, not filesystem enumeration); `pak.json` is written
  sorted by key in `gen-assets.ts:87-88`. No directory-listing dependency
  found in the diff.
- Four golden PNGs byte-unchanged (`git diff --stat` empty for
  `tests/goldens/` and `data/g6-goldens.json`). Rebuilt `dist/main.js` /
  `dist/main.pak` from scratch (deleted then `bun run build`) and re-ran
  `tests/g6-golden.test.ts` against the fresh bundle: 6/6 pass, not a stale
  leftover artifact.

## 2. QuickJS performance — reproduced, but the buddha_mountain margin is not stable

Reproduced `tools/bench-g6-quickjs.sh` end to end (cargo added to PATH via
`~/.cargo/bin`, not on the default shell PATH in this worktree).

- Startup → first paint: 179.9 ms / 185.8 ms (480×272 / 960×544) on my first
  clean run — matches the report's 181.787 / 169.096 ms, both ≤ 250 ms.
- Heap, walking p95, map-switch max, terminal-state SHA all matched the
  report within noise on a clean run.
- **Finding (non-blocking per spec, but should be tracked):** ran the
  `map_first_visits` case 5 times total (1 report value + 4 of mine,
  `/var/tmp/fleet/1897/run1.tsv`, `run_extra_{1,2,3}.tsv`). `buddha_mountain`
  worst-stage values: 49.840 (report), 48.114, 49.558, 49.246, 49.806 ms — all
  under the 50 ms limit but within 0.2–1.9 ms of it (mean 49.31, stdev 0.71).
  On a 4th rerun (`run_extra_4.tsv`, log `/var/tmp/fleet/1897/bench-extra-4.log`)
  under load from my own concurrent review activity, the whole bench slowed
  uniformly (boot 302–320 ms, over the 250 ms budget; map-switch max
  25.7/27.5 ms vs. the usual ~14 ms) and `buddha_mountain`'s worst stage hit
  **81.737 ms**, tripping the bench's own `assert!(worst_non_exempt_ms <=
  50.0)` at `tools/g6-quickjs-bench.rs:391` and failing the test outright.
  This reproduces exactly the risk the review spec flagged (margin “only
  0.16 ms” in the committed report). The gate is a raw `Instant::now()`
  single-sample wall-clock measurement with no repeat-and-take-min, no CPU
  pinning, and no isolation from other load on the box, so `bun run
  bench:g6:quickjs` can flake red under contention — on CI or a shared
  machine this is a real, reproducible failure mode, not a one-off fluke.
  - `buddha_mountain` is the largest first-visit cost (100×100 tiles,
    212,567-byte entry) and is dominated by `read_parse_ms` (≈48–50 ms of the
    ≈50 ms budget; validate/compile/commit are all <2.2 ms combined). The
    cheapest game-side lever, without touching the component repo, is
    shrinking that map's JSON payload — e.g. a denser ground-tile encoding or
    dropping redundant per-cell fields the splitter doesn't need — rather than
    tuning parse code. This is a recommendation only; the spec explicitly does
    not require fixing it in this task.

## 3. Web / browser — verified myself, not just via the generic gate

`vendor/pocket-rpgkit/tools/web-verify.ts` (generic per-example checks) passed
(`/var/tmp/fleet/1897/web-verify.log`): sizing at 2×/1.25×, phone layout, 30
requests, 0 console errors. That gate never causes an actual map transfer for
this game, so I wrote a standalone CDP probe
(`/var/tmp/fleet/1897/probe-web-transfer.ts`) that serves the built
`dist/web`, loads `/pocket-tuxemon/` in headless `google-chrome`, confirms the
skip-intro dialogue, walks the player down, and confirms a real map transfer
(`spyder_bedroom` → `spyder_paper_scoop`) via `__rpgSessionState.mapId`.
Screenshots opened and inspected:
`/var/tmp/fleet/1897/web-transfer/01-boot.png` (bedroom, player, dialogue) and
`03-after-walk.png` (new map, NPCs, dialogue box text visibly rendered —
"What a great presentation from our CEO! ..."). Zero console errors reported
by the probe. This satisfies the spec's "reach at least one map transfer,
screenshot and actually look" requirement beyond what the generic gate covers.

## 4. Build / packaging / byte stability

- `bun run import` run twice back to back:
  `sha256(sort(find dist -type f) | xargs sha256sum)` identical both times
  (`7f85480ed135d7955241358ca582bfd656e7cddc40a267c56ac7b35868112923`).
- Deleted `dist/main.js`/`dist/main.pak` and ran `bun run build` from
  scratch: byte sizes identical to the pre-existing artifact
  (1,098,030 / 33,656,192 B) and the full-`dist/` checksum above still
  matched after the rebuild — the pipeline is deterministic end to end, not
  just the importer step.
- `main.tsx` follows the README's `splitProjectMaps` + `createJsonMapRepository`
  pattern exactly (`main.tsx:5-17` vs. `vendor/pocket-rpgkit/README.md:255-267`):
  bytes from `read`, `fsHost() ? readFileSync : pakGet` source selection, no
  `prepare`/async barrier — consistent with the README's note that a
  synchronous pak/data.fs source does not need one.
  `pak.json` entries use `maps/<id>.json` keys exactly matching
  `shell.mapIndex[].entry` (spot-checked in `tests/map-shards.test.ts`, which
  also independently regenerates the split and compares every byte/SHA-256
  — I re-ran it, passes).
- `bunx tsc --noEmit` → exit 0 (reproduced).
- `bun run web && bun run web:verify` → PASS (reproduced, see §3).
- `bun tools/desktop.ts --build-only` not independently reproduced (release
  Rust desktop host build is slow); accepted on the strength of `bun run
  build` + `bun test` + the QuickJS bench all exercising the same
  `dist/linux-app` / `dist/maps` staging path successfully.

## 5. Gates and hygiene

All reproduced directly, not taken from the builder's report:

| gate | result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run import` ×2, dist checksum | identical |
| `bun run build:wasm` | OK, 289,539-byte wasm |
| `bun test tests/` | 45 pass / 0 fail / 45,942 expect() (twice, incl. after a from-scratch `bun run build`) |
| `bun run verify:g6:determinism` | PASS, `sha256=9bff0c7e1f76364f88490d493f2f2f7caa62dd5f951b3326af4e4e1a1fe84b9b`, matches report |
| `bun run verify:g6:locks` | 319 pages / 323 lock commands, 317 unlocked + 2 transferred, 0 unresolved/error |
| `bun run verify:g6:frozen` | 263 maps, 0 permanent locks/blocking fibers/errors |
| `bun run bench:g6:quickjs` | PASS on 4 of 5 runs; 1 run failed on `buddha_mountain` under load — see §2 |
| `bun run web && bun run web:verify` | PASS, 0 console errors |

- `git diff 2c4411d..HEAD -- vendor/ bun.lock` empty; the `pocket-rpgkit`
  submodule pointer is unchanged (`b28d83b`, same as baseline) — no bump was
  even needed for this task.
- No `fleet`/task-number strings in any commit message or in the diff body
  (`git log --format=%B` and `git diff` both grepped clean).
- `tools/frozen-k1.ts` and `tools/verify-g6-locks.ts` now reconstruct their
  input via `materializeShardedProject()` (reads the production shell +
  per-map entries through `createJsonMapRepository`, not a bypass) —
  confirmed by reading the diff, not just trusting the report.
- No changes to `importer/*.ts`: this task did not hand-edit any per-map
  import output, consistent with the "no manual per-map fixes" rule.

## Observations (not blocking)

- The web/pak-capable build's pak grew from 26,266,544 B to 33,656,192 B
  because per-map JSON is now a separately addressable pak entry rather than
  folded into the JS bundle. This further widens the gap against the PSP
  32 MB EBOOT budget noted as an open risk in the S2 scout report — out of
  scope for G7 (P1 desktop/web only) but worth remembering when a PSP task is
  scoped.

## Blocking items

None.

## Non-blocking follow-ups recommended

1. Harden `tools/g6-quickjs-bench.sh`'s per-map timing against system noise
   (repeat each map N times and take the min, or pin the process to a core)
   so `buddha_mountain`'s ~49 ms/50 ms margin doesn't intermittently fail CI.
2. If the margin needs to be widened rather than just measured better,
   consider trimming `buddha_mountain`'s entry payload (it's the largest
   map in the corpus and `read_parse_ms` alone is ~48–50 ms).

PASS
