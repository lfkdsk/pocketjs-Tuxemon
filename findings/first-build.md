# First clean build: `styles.generated.ts` resolution failure

**Task:** fleet/1964 — fix the first-clean-build failure where PocketJS's
`framework/src/styles.generated.ts` could not be resolved, and remove CI's
`bun run build || bun run build` retry workaround.

**Fix:** PocketJS commit `2d2b333b` on branch `fix/first-build-styles` (based
on `origin/rpgkit-base` = `d48962e8`, the pinned PocketJS). Game-repo CI
change: commit `4f32a69` on `fleet/task-1964`. Not pushed — the commander
owns the fork → component-repo → game-repo lock chain.

## Reproduction

Fresh clone under `/var/tmp/fleet/1964/game` (game repo at `449d916`,
submodules `vendor/pocket-rpgkit` @ `03533e36`, nested `vendor/pocketjs` @
`d48962e8`), `BUN_CONFIG_REGISTRY=https://registry.npmjs.org/ bun install
--frozen-lockfile`, `bun run import` (byte-stable), then `bun run build`.

`framework/src/styles.generated.ts` is **gitignored** (PocketJS `.gitignore`),
so a clean checkout does not have it. The failure mode is reproduced directly
by bundling the real framework root with the file absent and the in-memory
table provided — the exact condition pass 2 hits on a vulnerable Bun:

```
$ bun test tests/styles-generated-virtual.test.ts   # plugin WITHOUT the fix
32 | import { STYLE_IDS as DEFAULT_STYLE_IDS } from "./styles.generated.ts";
                                                    ^
error: Could not resolve: "./styles.generated.ts"
    at .../pocketjs/framework/src/index.ts:32:48
```

This is the CI error: `Could not resolve: "./styles.generated.ts"` originating
at the framework root's import (source line `framework/src/index.ts:55`).

On the local Bun (`1.3.14`) the full `tools/build.ts` flow does **not** fail,
because Bun 1.3.14 does not share pass 1's negative `Bun.resolveSync` cache
with pass 2's `Bun.build` resolver. The CI runner's Bun did (the workaround
commit `ed3958b` and `findings/G8.md` both record the first build failing and
the immediate re-run succeeding). The bug is therefore Bun-version-dependent,
but the build was structurally wrong: pass 2's correctness depended on a disk
file written mid-run and on Bun not caching the miss. The fix removes that
dependency, so the first build succeeds on every Bun version.

## Root cause — call chain

1. `bun run build` → game `tools/build.ts:16-22` spawns PocketJS
   `tools/build.ts main.tsx --project-root --outdir` (framework defaults to
   **solid**, `jsx-plugin.ts:199`).
2. **Pass 1** (`tools/build.ts:299`) walks the import graph from `main.tsx`.
   It reaches `framework/src/index.ts:55`:
   `import { STYLE_IDS as DEFAULT_STYLE_IDS } from "./styles.generated.ts";`
   `resolveImport` (`tools/build.ts:266-280`) calls
   `Bun.resolveSync("./styles.generated.ts", …/framework/src)`. The file is
   absent on a clean checkout → the resolve **throws** and is cached as a
   miss; the walk skips the module (`tools/build.ts:281` also skips visiting
   it). `resolveSolidAotModel`/`resolveSolidAotMock` do not intercept — they
   bail on extension'd specifiers / `.ts` importers
   (`microts/compiler/aot-solid-browser.ts:116,127`).
3. Styles compile and `tools/build.ts:333` writes the real
   `framework/src/styles.generated.ts`.
4. **Pass 2** (`tools/build.ts:519-550`) runs `Bun.build` with `jsxPlugin`.
   The plugin's `onLoad` (`framework/compiler/jsx-plugin.ts:675-678`) **can**
   serve this build's in-memory `generatedStyles` — but only if resolution
   first reaches `onLoad` with `args.path === GENERATED_STYLES_PATH`. The
   solid `onResolve` for relative imports returns `undefined` for this
   specifier, so resolution falls through to Bun's default resolver — which,
   on the CI Bun, returns the **cached miss** from step 2. `onLoad` never
   fires; the build dies with `Could not resolve: "./styles.generated.ts"`.
5. Second run: the file exists from the start, no miss is cached, resolution
   succeeds.

The design comment at `tools/build.ts:316-318` already states pass 2 "receives
this build's source directly through jsxPlugin" — but only `onLoad` was
virtual; **resolution still read the path from disk**. That gap is the bug.

## Fix — PocketJS `2d2b333b` (`fix/first-build-styles`)

`framework/compiler/jsx-plugin.ts`: add an `onResolve` that maps the
framework's own `./styles.generated.ts` import to the canonical
`GENERATED_STYLES_PATH` (pure path math, no disk I/O), so pass 2 is fully
virtual — `onLoad` then serves this build's in-memory table. Same-named app
modules resolve to a different path and fall through to normal resolution.
When no `generatedStyles` is provided (other plugin callers), the handler is
a no-op. Also exports `GENERATED_STYLES_PATH` for the test.

```ts
build.onResolve({ filter: /(^|[\\/])styles\.generated\.ts$/ }, (args) => {
  if (opts.generatedStyles === undefined) return undefined;
  const resolved = args.path.startsWith(".")
    ? resolvePath(dirname(args.importer), args.path)
    : args.path;
  return resolved === GENERATED_STYLES_PATH ? { path: GENERATED_STYLES_PATH } : undefined;
});
```

This is the task's suggested "引用改走 jsxPlugin 的虚拟模块" option. It is
minimal (one handler + one export) and output-neutral: the resolved module is
the same canonical path and `onLoad` serves the same in-memory content as
before — only the resolution route changes.

**Regression test** `tests/styles-generated-virtual.test.ts` (registered as
its own stage in `tools/test.ts`, running before any prep build emits the
mirror): bundles the real framework root with `styles.generated.ts` **absent**
and a unique in-memory marker, and asserts the build succeeds and the marker
is in the bundle. On the old plugin it fails with the exact CI error above;
with the fix it passes. The stage is single-test so the test's temporary
rename of an existing mirror cannot race a parallel framework import.

## Verification

All on the fresh clone, fixed PocketJS (`2d2b333b`), Bun 1.3.14:

| Step | Result |
|---|---|
| `bun run import` then `git status --porcelain` | clean (byte-stable) |
| `bun run build` (fresh: no `styles.generated.ts`, no `.cache`, no `dist`) | **exit 0** — pass 1: 137 modules; pass 2: `dist/main.js` 1,145,029 B |
| `bun run build:wasm` | exit 0 — `hosts/web/pocketjs.wasm` 289,542 B |
| `bun test tests/` | **156 pass, 0 fail** (70,920 expects) |
| second `bun run build` (file now exists) | exit 0, `main.js`/`main.pak`/`battle-runtime-shell.json` **byte-identical** (sha256 match) |
| PocketJS `bunx tsc --noEmit` | exit 0 |
| PocketJS `bun test tests/test-suite.test.ts` | 9 pass (stage addition valid) |
| PocketJS `bun test tests/styles-generated-virtual.test.ts` | 1 pass; **fails without the fix** with the CI error |

Game-repo CI (`.github/workflows/ci.yml`) now runs a single `bun run build`
(commit `4f32a69`); the `|| bun run build` retry and its comment are gone.

`bun.lock` untouched in all three repos. No fleet task numbers in any commit.
Nothing pushed.

## Files

- PocketJS worktree: `/var/tmp/fleet/1964/pocketjs` (branch
  `fix/first-build-styles`, commit `2d2b333b`) — the fix + regression test.
- Pristine reference: `/var/tmp/fleet/1964/pocketjs-pristine` (d48962e8).
- Reproduction clone: `/var/tmp/fleet/1964/game` (nested `vendor/pocketjs`
  pointed at the fix worktree for verification).
- Logs: `/var/tmp/fleet/1964/{build1,build2,verify-build,verify-wasm,verify-test}.log`,
  hashes `build1.sha`/`build2.sha`.
