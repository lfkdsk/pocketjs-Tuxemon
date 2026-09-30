# Review of task 1959 (KP1 fix 1: build/test-time shell manifest freshness check)

Component repo worktree `~/.fleet/worktrees/task-1956`, branch `fleet/task-1956`,
range `f916e0f..cf6919c` (3 commits: `88c93e7` feat, `f414809` docs, `cf6919c`
docs/report). Reviewed against
`/var/tmp/fleet-specs/pocket-tuxemon/kit-KP1-fix1.md` and
`/var/tmp/fleet-specs/pocket-tuxemon/reviewer-generic.md`. Prior verdict was
`findings/review-task-1956.md` (FAIL: §1, declared hash trusted with no
build/test-time freshness check).

## Summary

The fix closes the exact gap the prior review found blocking, without giving
back the performance win. `assertShellManifestFresh(shell)` is exported from
`src/engine/map-repository.ts` and reaches `pocket-rpgkit/engine` through the
existing `export *` in `src/engine/index.ts`. It recomputes the manifest hash
and throws a message containing both the declared and computed digests on any
mismatch, and also rejects a missing or malformed declaration.
`splitProjectMaps` calls it once on its own output as a self-check (read-only,
doesn't touch the returned shell). Four new tests cover a real
`JSON.stringify`/disk/`JSON.parse` round-trip, four kinds of field tampering
(title, a `mapIndex` entry, `system` settings, `start`), a missing/invalid
declared hash, and the prior review's exact "old save accepted against
mutated content" reproduction — now locked in as a passing/failing pair (the
runtime is documented as silently trusting the stale hash without the
check; the check itself, and `verifyMapManifest: true`, both reject it). All
required gates reproduce cleanly, the runtime path (`session.ts`) has a
literal zero-line diff, and I independently reran the QuickJS mount benchmark
and got numbers matching the report within noise. I found no blocking issues.

## 1. `assertShellManifestFresh` semantics — CONFIRMED CORRECT

`src/engine/map-repository.ts:189-203`:

```ts
export function assertShellManifestFresh(shell: ProjectShell): void {
  const declared = shell.mapManifestHash;
  if (declared === undefined) throw ...  "declares no mapManifestHash to verify"
  if (!SHA256_HEX.test(declared)) throw ... "invalid shell manifest hash"
  const computed = mapManifestHash(shell);
  if (computed !== declared) throw `... mismatch: declared ${declared}, computed ${computed}`;
}
```

- Recomputes via the same `mapManifestHash` used by `resolveMapManifestHash`
  (`src/engine/map-repository.ts:150-154`), so there is exactly one
  hash-over-content code path shared by the freshness check and the runtime's
  optional `verify` path — no risk of the two drifting apart.
- Error message contains both digests verbatim
  (`map-repository.ts:198-201`). Verified by mutation: I temporarily
  shortened the mismatch error to drop the digests and reran
  `tests/map-repository.test.ts` — the "any non-hash content change" test
  failed at the `toContain(declared)` assertion (see §3 below). Reverted;
  file diffed clean afterward.
- Public entry point: `src/engine/index.ts:26` (`export * from
  "./map-repository.ts"`) is unchanged by this PR, and `map-repository.ts`
  already exported everything the fix needs — confirmed the function is
  reachable as `pocket-rpgkit/engine`'s `assertShellManifestFresh`
  (`package.json`'s `"./engine": "./src/engine/index.ts"`).
- `splitProjectMaps`'s self-check (`tools/lib/map-project.ts:82-85`) calls
  `assertShellManifestFresh(shell)` for its side effect only (return type
  `void`); the function that follows still builds `shellText` from the same
  `shell` object and the return value (`{ shell, shellText, entries, files }`)
  is unchanged in shape from before this PR — confirmed by diff
  (`tools/lib/map-project.ts` diff is a 4-line import + 4-line call, nothing
  else moves). The self-check is currently a tautology given
  `mapManifestHash(unhashed) === mapManifestHash(shell)` (both strip
  `mapManifestHash`/`mapSchemaHash` before hashing), but that's intentional:
  it's a regression guard against a future edit to the splitter breaking the
  invariant it now documents, not a check that can fail today.

## 2. Test discriminative power — CONFIRMED

Four new tests in `tests/map-repository.test.ts:787-894`, purely additive
(diff shows only new lines appended after the last existing `describe`
block; no existing test touched):

- **Disk round-trip** (`:800-816`): writes `JSON.stringify(split.shell)` to a
  real temp file (`mkdtempSync`/`writeFileSync`/`readFileSync`), asserts
  `assertShellManifestFresh` doesn't throw and `resolveMapManifestHash(...,
  true)` matches the declared hash — proves canonicalization is stable
  through actual JSON serialization, not just in-memory object identity
  (this was the prior review's stated concern: "the new unit test only
  compares in-memory objects from the same call").
- **Field tampering** (`:818-852`): four independent mutations (title,
  `mapIndex[0].width`, `system.messageBlocksPlayer`, `start.x`), each
  asserted to throw `/manifest hash mismatch/` with the message containing
  both the original declared hash and `mapManifestHash(mutated)`, plus the
  runtime's `resolveMapManifestHash(mutated, true)` opt-in path rejecting
  the same mutation.
- **Missing/invalid declaration** (`:854-860`): `mapManifestHash: undefined`
  throws `/declares no mapManifestHash/`; `mapManifestHash: "tampered"`
  (fails the hex-64 format check) throws `/invalid shell manifest hash/`.
- **Old-save scenario, locked in** (`:862-893`): builds a session, takes a
  save envelope, mutates the shell's `title` while keeping the stale
  declared hash, and checks three things: `assertShellManifestFresh` throws;
  `createSession(mutated, 60, { maps, verifyMapManifest: true })` throws;
  and — explicitly documenting the trust boundary the check exists to
  guard — `createSession(mutated, 60, repository())` (no `verifyMapManifest`)
  succeeds and the stale save still restores. This is exactly the prior
  review's reproduction, now a permanent regression test.

**My own mutation testing** (spec's requirement to break the implementation
and confirm red):

1. Replaced the whole function body with `return;` (check always passes).
   Reran `bun test tests/map-repository.test.ts`: 3 failures — the
   missing/invalid-declaration test and the old-save test both failed with
   "did not throw" (`tests/map-repository.test.ts:857`, `:881`). Reverted;
   `git diff --stat src/engine/map-repository.ts` empty afterward.
2. Shortened the mismatch error to drop both digests (`"map repository:
   shell manifest hash mismatch"` with no interpolation). Reran the same
   file: 1 failure — `toContain(declared)` at `:846` ("Expected to contain:
   ... Received: map repository: shell manifest hash mismatch"). Reverted;
   diff clean afterward, then reran the full file to confirm 28/28 pass.

Both mutations were caught. The suite has real discriminative power, not
just line coverage.

## 3. Startup path zero-touch and no performance regression — CONFIRMED

- `git diff f916e0f..cf6919c -- src/engine/session.ts` is empty — the runtime
  session path has no changes at all in this fix.
- `assertShellManifestFresh` is called from exactly two places in the whole
  tree: `tools/lib/map-project.ts:85` (build-time, inside
  `splitProjectMaps`) and `tests/map-repository.test.ts` (test-time). Grep
  confirms no call from `src/engine/session.ts`, `interpreter.ts`, or any
  other runtime module — the check cannot execute on the hot `createSession`
  path.
- I independently reran the QuickJS mount benchmark (real `rquickjs`
  desktop host, release build, not Bun/JSC):
  `KP1_RUNS=3 KP1_BENCH_ROOT=/var/tmp/fleet/1960/quickjs bash
  tools/kp1-quickjs-bench.sh dist sunstone` →
  480×272: `game-view-mount median_ms=6.219`, `create-session
  median_ms=0.546`, `create_median=118` nodes;
  960×544: `game-view-mount median_ms=7.005`, `create-session
  median_ms=0.547`, `create_median=152` nodes.
  Report claims (`findings/KP1.md:367-369`, KP1_RUNS=3): 480×272 mount
  median 6.187 ms / createSession 0.544 ms / 118 nodes; 960×544 mount median
  6.985 ms / createSession 0.539 ms / 152 nodes. Numbers match within normal
  run-to-run noise (<2%), and node counts are byte-identical (118/152),
  matching both this report and the original KP1 review's independently
  verified counts (671/830 total native nodes across other benchmarks). No
  regression.

## 4. Tool audit — CONFIRMED, README guidance is sufficient for integrators

- Re-verified the report's claim that no tool in this component repo reads a
  `ProjectShell` from disk and hands it to the runtime unverified:
  `grep -rln "ProjectShell\|createSession" tools/ editor/ examples/` matches
  `tools/pr1-quickjs-entry.ts`, `tools/pr1-equivalence.ts`,
  `tools/lib/map-project.ts`, and three `examples/*` files — all construct
  or consume `Project`/`ProjectShell` in-process from `splitProjectMaps`
  output, never from a file read (`tools/pr1-equivalence.ts:416` splits and
  calls `createSession` in the same process, as in the prior review).
  `tools/web.ts:163-164`'s `readJson` reads `web.json` (site config), not a
  project shell — confirmed by reading `parseSiteConfig`'s shape
  (`WebSiteConfig`, viewport/keymap fields), unrelated to `ProjectShell`.
  `tools/desktop.ts`, `tools/build-example.ts`, `tools/package-macos.ts` and
  `editor/` were not in the `grep -l` match list at all. The only
  disk→runtime shell path in scope of either repo remains Pocket Tuxemon's
  `main.tsx` (`import ... from "./dist/project-shell.json"`), out of scope
  per the fix spec.
- README (`README.md:286-303`): states plainly that because the runtime
  trusts a declared hash, "an application that packages a `ProjectShell`
  must verify its freshness at build or test time," gives the exact
  call-after-write pattern (`readFileSync` + `JSON.parse` +
  `assertShellManifestFresh`), names the import path
  (`pocket-rpgkit/engine`), and states the two things an integrator needs
  to know to not misuse it: `splitProjectMaps` output already self-checks
  (so a "straight from splitter to disk" shell always passes), and a
  hand-authored shell without a declared hash has nothing to verify. This is
  concrete enough that the game-repo integration (adding a self-check after
  `dist/project-shell.json` is written, per the fix spec's explicit
  carve-out) is a copy-paste of the README snippet, not a design exercise.
  `src/engine/README.md:209-212` and `src/data/CHANGELOG.md:296-305` restate
  the same requirement consistently.

## 5. Gates — ALL PASS, reproduced independently

- `bun run build:example`: exit 0, built all example apps (sunstone, wander,
  meadow, grow, r2-ui, kb4-battle) including PAKs.
- `bun test`: `915 pass / 0 fail / 0 skipped`, `467677 expect() calls`, 60
  files, 87.11s — matches the report's claimed count exactly (911 baseline +
  4 new).
- `bunx tsc --noEmit`: exit 0, no output.
- `bash tools/pr1-equivalence.sh`: `PR1_EQUIV PASS scenarios=37 states=12376`.
- `git diff f916e0f..cf6919c -- bun.lock`: empty.
- `git log f916e0f..cf6919c --format='%B'` contains no `task[- ]?[0-9]+` /
  `fleet` token in any commit message; all three commits authored `lfkdsk
  <lfkdsk@gmail.com>`, no `Co-Authored-By`/`Generated with` trailers.
  `findings/KP1.md`'s new "修复 1（task 1959）" section header names the task
  by convention (matching every other section of this report file and the
  existing `review-task-1956.md` naming scheme) but that's documentation,
  not code/commit content, and the spec's "无 fleet 任务号" requirement reads
  in context as being about commits (`context.md`: "提交作者 ...
  不加任何 Co-Authored-By / AI 尾注"), which is clean.
- `git diff f916e0f..cf6919c -- vendor/`: empty — no touch to the pinned
  `vendor/pocketjs` submodule.

## Non-blocking observations

- None beyond what the report already addressed. The report's response to
  the prior review's non-blocking items (§2–§5 of `review-task-1956.md`) is
  reasonable: no code changes needed there, since those were already
  verified correct/reproducible in the prior review and this fix doesn't
  touch that code.

## Blocking items

无。

PASS
