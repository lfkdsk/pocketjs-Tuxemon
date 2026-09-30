# Review of task 1956 (KP1: trust declared map manifest hash + QuickJS SHA-256 rewrite)

Component repo worktree `~/.fleet/worktrees/task-1956`, branch `fleet/task-1956`,
baseline `b778aa0`, HEAD `7b2ce8d`. Reviewed against
`/var/tmp/fleet-specs/pocket-tuxemon/kit-KP1-mount.md` and
`/var/tmp/fleet-specs/pocket-tuxemon/reviewer-generic.md`.

## Summary

The performance work is real, correctly measured, and reproducible: I rebuilt
the actual Pocket Tuxemon game from a fresh worktree pinned to this branch and
independently reran the QuickJS mount/startup benchmark, getting numbers in
the same range as the report with identical native node counts (671 / 830).
The SHA-256 rewrite is algorithmically correct — I differential-tested it
against `node:crypto` for 309+ vectors in a real QuickJS interpreter and in
Bun, with zero mismatches. All required gates (`tsc`, `bun test`,
`build:wasm`, `pr1-equivalence.sh`, `bun.lock`) reproduce cleanly.

However, item 1 of the review spec ("信任声明哈希的安全边界") is explicitly
marked blocking if a build/test-time freshness check is missing, and it is
missing. I built a concrete reproduction (below) showing that a `ProjectShell`
whose content changed after the manifest hash was computed is accepted
silently by `createSession` today, and that an old save round-trips against
the new, different content without detection. Nothing in this PR, the
component repo, or the downstream game repo (`pocket-tuxemon` at `ba32513`,
which is what actually ships this code path) asserts that a real, on-disk
project-shell.json's declared hash still matches its content. Per the review
spec's own wording, this gap is blocking.

## 1. Trust boundary for the declared manifest hash — BLOCKING GAP FOUND

### Where `ProjectShell` is constructed/loaded

- `tools/lib/map-project.ts:73-79` (`splitProjectMaps`) — the only place in
  either repo that *writes* a `mapManifestHash`. It always computes the hash
  fresh, in the same process, immediately before returning the shell, so the
  splitter's own output is always internally consistent at generation time.
- `tools/pr1-equivalence.ts:416` — calls `createSession(split.shell, ...)`
  immediately after splitting in the same process. Always fresh, no risk.
- Pocket Tuxemon `main.tsx:12-19` (production entry point, read-only checked
  in this review from `/var/tmp/oss/pocket-tuxemon`) — `rawProject` is
  `import`ed from `./dist/project-shell.json` and cast to `ProjectShell`,
  then handed straight to `GameView`/`createSession` with **no**
  `verifyMapManifest`. This is the actual shipped path for desktop, web and
  console builds.
- Pocket Tuxemon `tools/generated-project.ts:21-29` (`readShardedProject`) —
  reads the same `dist/project-shell.json` from disk for test tooling
  (`tests/g7-repository.test.ts:56`, `tests/g6-locks.test.ts:9`), again with
  no verification.
- The component repo's own editor (`editor/engine/*.ts`) only ever operates
  on inline `Project` objects (`editor/engine/model.ts`'s `mapIndex` is a
  numeric array index, unrelated to `ProjectShell.mapIndex`); it never
  constructs or loads a `ProjectShell`, so the "editor should default to
  verify" requirement doesn't apply to it — there is no editor code path to
  fix. But that also means **nothing exercises `verifyMapManifest: true` in
  a way a human editing content would notice.**

### The gap

Before this PR, `createSession` always recomputed the shell hash and threw on
mismatch (`session.ts` diff, old code: `mapManifestHash(project)` then
compare). This had a side effect: every place that called `createSession` on
a real, disk-loaded `ProjectShell` — including Pocket Tuxemon's own
`tests/g7-repository.test.ts`, which reads the *actual shipped*
`dist/project-shell.json` — was an implicit, unconditional freshness check.
Any drift between the declared hash and the real content (a bad partial
rebuild, a hand patch, a future importer bug that mutates the shell after
hashing) would fail that test immediately.

`a5dc58f` removes that implicit check by making `resolveMapManifestHash`
trust `shell.mapManifestHash` whenever it is present and looks like a SHA-256
(`src/engine/map-repository.ts:161-171`), without ever comparing it to the
actual content unless a caller explicitly opts in with
`verifyMapManifest: true`. I confirmed by grep that **no caller in either
repo passes `verifyMapManifest: true`** outside of the new unit test itself
(`tests/map-repository.test.ts:200-202`) and a game-repo unit test that
constructs a synthetic mismatch (`tests/g7-repository.test.ts:157-169`, game
repo, unrelated to real disk artifacts). `GAME_OPTIONS` in
`tests/g7-repository.test.ts:31` (game repo) is `{ extensions, battle }` —
no manifest option — so that test's implicit freshness guarantee on the real
shipped shell is now gone and nothing replaces it.

### Reproduction (ran against this branch's actual code)

```
$ bun run /var/tmp/fleet/1956/save_risk.ts
saved with content: {"manifest":"d341...729cf","schema":"c27e..."}
new session content: {"manifest":"d341...729cf","schema":"c27e..."}
declared hash unchanged despite content mutation: true
content identity unchanged too (so no drift detected): true
ACCEPTED: old save silently loaded against mutated shell content.
verifyMapManifest:true correctly rejects the same mutation: map repository: shell manifest hash mismatch
```

The script splits a fixture project, creates a session/save from the
original shell, then builds a second shell that differs only in `title`
(simulating any shell mutation that didn't go through the splitter again —
e.g. a broken partial rebuild) while keeping the stale declared
`mapManifestHash`. `createSession` on the mutated shell reuses the stale
declared value as `session.content.manifest`, so the old save's content
identity matches the new (different) content and loads with **no error**.
Passing `verifyMapManifest: true` does correctly catch it — the opt-in works
— but nothing in the shipped pipeline uses it.

### Per-map entry checksums — still checked, but only for async sources

`src/engine/map-repository.ts:399` (`sha256Text(staged.input)/sha256Bytes !==
meta.sha256`) still runs, unconditionally, only when
`createJsonMapRepository`'s own `verify` option is true, and that option
**defaults to `false` for synchronous sources**
(`src/engine/map-repository.ts:369`: `const verify = options.verify ??
source.prepare !== undefined`). Pocket Tuxemon's production `main.tsx:14-19`
builds its repository with a plain synchronous `read` and no `prepare`, so
per-map checksums are *also* not verified by default in the shipped path.
This is pre-existing behavior, **not changed by this PR** (confirmed: the
diff only renames the inline regex to `SHA256_HEX`, it doesn't touch the
`verify` default or its call sites). But it means the shell-level manifest
hash was, in practice, the *only* remaining default-on content-integrity
check for the whole shipped package, and this PR turns that off too, with no
compensating check added anywhere.

### What's required and missing

The review spec requires "有构建期或测试期的强制检查（声明哈希 == 实算哈希，
覆盖示例工程与游戏仓产物）" and states the absence is blocking. I found none:

- No test in this component repo round-trips a `ProjectShell` through disk
  and asserts the declared hash matches a recompute (the new unit test only
  compares in-memory objects from the same `splitProjectMaps` call).
- No test/build step in Pocket Tuxemon (`gen-assets.ts`, `tools/build.ts`,
  `tools/verify-g6-*.ts`, `tests/g7-repository.test.ts`,
  `tests/g6-locks.test.ts`) asserts `dist/project-shell.json`'s declared
  `mapManifestHash` still matches a fresh recompute of its actual bytes.
  `gen-assets.ts:154` only records `split.shell.mapManifestHash` into a
  report file; it doesn't independently re-verify it against anything.
- This component repo's own example apps (Sunstone, Wander) don't use
  `ProjectShell`/sharding at all (`tools/build-example.ts` has zero
  references to `splitProjectMaps`/`ProjectShell`), so "示例工程" coverage
  isn't applicable here, but that just means the *only* place this check
  could matter — the Pocket Tuxemon game repo — has no such check either.

This is fixable without giving back the performance win (e.g., a `bun test`
in Pocket Tuxemon reading `dist/project-shell.json` and asserting
`mapManifestHash(withoutDeclared) === shell.mapManifestHash`, or a
`gen-assets.ts` self-check right after writing the file), but it does not
exist today. Per the spec, this is a blocking gap.

## 2. SHA-256 rewrite correctness — VERIFIED CORRECT

Differential-tested `sha256Bytes`/`sha256Text` against `node:crypto` (ground
truth) in two independent JS engines:

- **Bun/JSC**: 316 checks — NIST vectors (empty, `"abc"`), all byte lengths
  0–300 (covers the 55/56/63/64/119/120 block-boundary cases) with
  deterministic pseudo-random content, random buffers at 500/1000/4096/81950
  bytes, and 5 UTF-8 strings including a surrogate-pair emoji. 0 failures.
  (`bun run /var/tmp/fleet/1956/sha_diff.ts` → `checks=316 failures=0`)
- **Real QuickJS** (standalone `qjs` interpreter at
  `/var/tmp/oss/qjs-oracle-cache/quickjs-2026-06-04/qjs`, not Bun/JSC): I
  extracted the exact `sha256Bytes` source from
  `src/engine/map-repository.ts:33-115` verbatim (stripping only TS type
  syntax that has no runtime effect: `: number`, `!`, `as const`) and ran it
  against 309 of those same vectors loaded via `std.loadFile`. 0 failures.
  (`/var/tmp/oss/qjs-oracle-cache/quickjs-2026-06-04/qjs --std
  /var/tmp/fleet/1956/run_vectors.js` → `QuickJS checks=309 failures=0`)
- The pre-existing known-answer test in `tests/map-repository.test.ts:114-115`
  (`sha256Text("")` / `sha256Text("abc")` against literal NIST digests) still
  passes.
- `utf8Encode` (`src/engine/save.ts:186-204`) is untouched by this PR — only
  the internal compression-loop variable layout changed (locals instead of
  an array, inlined rotates instead of a helper function), so text-encoding
  semantics (surrogate pairs, lone surrogates) can't have regressed
  independent of the differential above.

**Mutation testing** (spec's "变异检查"): I broke a rotate amount inside the
compression loop (`>>> 25) | (e << 7)` → `>>> 24) | (e << 8)`) and reran
`bun test tests/map-repository.test.ts`: the known-answer test failed
immediately (`sha256Text("")` produced a wrong digest). I separately removed
the `SHA256_HEX.test(declared)` format guard from `resolveMapManifestHash`
and reran the same file: the new "declared manifests are trusted..." test
failed (it expects `/invalid shell manifest hash/` to throw). Both mutations
were reverted and the file diffed clean against the original afterward.

Conclusion: the SHA-256 rewrite itself is not a correctness risk.

## 3. Measurement credibility — VERIFIED, NUMBERS REPRODUCE

I rebuilt Pocket Tuxemon from scratch, independently of the builder's run:

- Created a disposable `git worktree` of `/var/tmp/oss/pocket-tuxemon` at
  `ba32513` under `/var/tmp/fleet/1956/pocket-tuxemon-verify` (main workspace
  untouched), pointed its `vendor/pocket-rpgkit` submodule at this branch's
  HEAD (`7b2ce8d`, fetched directly from the local component repo — no push
  involved), ran `bun install`, `TUXEMON_SRC=/var/tmp/tuxemon-src bun run
  build`, then `bun run desktop --build-only`.
- Resulting `dist/linux-app/pocket-tuxemon.js` = 2,811,186 bytes and
  `pocket-tuxemon.pak` = 60,591,968 bytes — **byte-identical** to the sizes
  reported in `findings/KP1.md` ("2,811,186-byte JS; 60,591,968-byte PAK"),
  confirming the build is reproducible.
- Ran `KP1_RUNS=10 KP1_BENCH_ROOT=/var/tmp/fleet/1956/final-verify2
  tools/kp1-quickjs-bench.sh <that dist>/linux-app pocket-tuxemon <that
  dist>` from this worktree (component repo unmodified). Results (QuickJS,
  10 fresh-Guest samples per viewport; host `uptime` before/after: `up 54
  days, 11:02` both times, load average 6–13 on a loaded 32-core box):

  | Viewport | startup-to-first median/p90 | mount median/p90 | createSession median/p90 | native node create_median |
  |---|---:|---:|---:|---:|
  | 480x272 | 198.925 / 212.409 ms | 23.452 / 25.765 ms | 3.083 / 3.130 ms | 671 |
  | 960x544 | 190.539 / 211.569 ms | 25.623 / 28.357 ms | 2.750 / 3.122 ms | 830 |

  These are in the same range as the report's claimed 185.930/202.425 ms
  startup medians and 21.517/26.998 ms mount medians (the small gap is host
  load noise: my box's `uptime` load average was 6–13 during the run, well
  above idle). **Node counts are an exact match** to the report's 671 / 830,
  which independently proves no UI subtree was deferred to fake the speedup.
- Also reran the Sunstone example benchmark
  (`KP1_RUNS=10 tools/kp1-quickjs-bench.sh dist sunstone`): 118 / 152 native
  nodes, matching the report's Sunstone node counts exactly.

Conclusion: the reported speedup is real, the methodology is sound (fresh
QuickJS `Guest` per sample, real PAK/bundle, no wall clock in reducer state),
and node-count parity rules out a "defer work to fake it faster" shortcut.

## 4. Startup-profile marks — no reducer/determinism impact, no hot-path cost

`src/startup-profile.ts:12-14`: `startupProfileMark` is an optional-chained
call to `globalThis.__rpgkitStartupProfileMark`, which is `undefined` unless
a benchmark harness installs it. All 30+ call sites
(`src/engine/session.ts`, `src/engine/map-repository.ts`,
`src/ui/{GameView,DialogBox,ChunkLayer,AnimatedTiles,OccludingUpperLayer}.tsx`)
sit in one-time session-creation/mount code paths — `createSession`,
`acquireSessionMap` (called on session start and map transfer, not per
frame), `startSession`, and component bodies that run once per mount, not
inside `stepSession`/the interpreter's per-tick fold. I confirmed by
`grep -n startupProfileMark src/engine/*.ts src/ui/*.tsx` that none of the
call sites are inside the hot per-frame path. The new
`tools/pr1-equivalence.sh` run (12,376 states across 37 scenarios, including
multi-Hz scenarios) passing unchanged is corroborating evidence that no
determinism-affecting state was introduced. Every UI-side diff I inspected
(`DialogBox.tsx`, `ChunkLayer.tsx`, `AnimatedTiles.tsx`,
`OccludingUpperLayer.tsx`, `GameView.tsx`) adds only
`startupProfileMark(...)` calls around unchanged return values; no
structural/logic change. Not blocking.

The new benchmark scripts (`tools/kp1-quickjs-bench.sh/.rs`) default
`KP1_BENCH_ROOT` to `/var/tmp/fleet/1956/...` but are fully overridable via
env var and explicitly guard that the root must be under `/var/tmp/fleet`
(`tools/kp1-quickjs-bench.sh:17-18`) — consistent with this fleet's scratch
convention and not a portability defect.

## 5. Gates — all reproduce cleanly

Reran independently in this worktree (not trusting the builder's self-report):

| Gate | Result |
|---|---|
| `bun run build:example` | exit 0 |
| `bun run build:wasm` | exit 0, `pocketjs.wasm` 289,510 bytes (matches report) |
| `bunx tsc --noEmit` | exit 0 |
| `bun test` | 911 pass, 0 fail, 467,647 assertions, 0 skipped, 60 files (matches report exactly) |
| `bash tools/pr1-equivalence.sh` | `PR1_EQUIV PASS scenarios=37 states=12376` (matches report exactly) |
| `git diff --stat -- bun.lock` | empty — lockfile untouched |
| `git status` | clean before and after all mutation tests |

Commit messages (`perf(engine):`, `test(ui):`, `bench(ui):`, `docs:`) follow
repo convention; `git log b778aa0..HEAD` shows no fleet task numbers anywhere
in the diff or commit messages; all commits authored
`lfkdsk <lfkdsk@gmail.com>` with no `Co-Authored-By`/AI attribution lines.
README/CHANGELOG updates (`README.md`, `src/data/CHANGELOG.md`,
`src/engine/README.md`) accurately describe the new trust default and the
`verifyMapManifest` opt-in, including the caveat about untrusted/mutable
shells — the docs do not overclaim safety.

Goldens: the diff touches no golden PNG files (`git diff --stat` for this
range lists only `.ts`/`.tsx`/`.md`/`.rs`/`.sh` files), and the full `bun
test` run (which includes the golden-comparison tests) passed with 0
failures, so goldens are unchanged.

## Blocking items

1. **Missing build/test-time freshness check for the declared
   `mapManifestHash`.** `createSession` now trusts a shell's declared
   manifest hash by default with no compensating check anywhere in the
   pipeline that would catch a stale/hand-mutated `ProjectShell` before it
   ships (see §1). I demonstrated concretely that this lets an old save
   round-trip against genuinely different content with no error. The review
   spec marks this gap as blocking ("缺失的判阻断"). Fix: add a test in
   Pocket Tuxemon (or a self-check in `gen-assets.ts`) that recomputes
   `mapManifestHash` over the real `dist/project-shell.json` content and
   asserts it equals the declared value, and/or default
   `verifyMapManifest: true` for any non-splitter-adjacent load path.

## Claims filed

See `fleet_claim` calls for each conclusion above with file:line/command
evidence.

FAIL
