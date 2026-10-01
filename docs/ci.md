# CI

CI is a single workflow, `.github/workflows/ci.yml`. Four jobs run in
parallel from the shared prepare action — `import`, `test` (four matrix
legs), `journey` (five matrix legs) and `web`, eleven runners in all — and
`deploy` publishes Pages once they all pass. A run takes about three
minutes. It runs on pushes to `main`,
on pull requests, and on manual dispatch.

## The prepare action

`.github/actions/prepare/action.yml` is the common setup every job uses:

1. install Bun and the Rust wasm target;
2. restore the wasm-core build cache and the pinned Tuxemon source cache;
3. fetch the pinned Tuxemon checkout (`.tuxemon-src/`) and point
   `TUXEMON_SRC` at it;
4. `bun install --frozen-lockfile`;
5. `bun run import`;
6. unless called with `build: "false"`, `bun run build` and
   `bun run build:wasm`.

The wasm core is a build artifact, not a checked-in file, which is why the
Rust toolchain and the build step are part of prepare.

## Jobs

### import — Import, typecheck and determinism

Prepare with `build: "false"`, then:

- `git status --porcelain` must be empty after the import: the committed
  project, maps, art and battle data are exactly what the importer produces
  from the pinned Tuxemon commit;
- `bunx tsc --noEmit`;
- `bun run verify:g6:determinism` — two imports into isolated roots must be
  byte-identical.

### test — the suite in four parallel groups

The suite is split into explicit groups of roughly a minute each, because
bun's own sharding cuts the sorted file list into contiguous runs and would
bunch the slow battle and replay suites together:

| Group | Files |
|---|---|
| `importer` | `tests/importer.test.ts` |
| `replays` | `tests/g7-repository.test.ts`, `tests/g6-golden.test.ts` |
| `locks, battle data and terrain` | `tests/g6-locks.test.ts`, `tests/battle-db-adapter.test.ts`, `tests/battle-golden.test.ts`, `tests/terrain.test.ts` |
| `rest` | every other `tests/*.test.ts` (35 files), selected by an exclusion grep over the seven files above |

New test files land in `rest` automatically — no workflow edit is needed.
If a new file is slow enough to deserve an explicit group, add it to that
group's `files:` list **and** to the exclusion grep in the same change, or
it runs twice.

### journey — the maintained tapes

Five parallel legs, one `bun run verify:*` script each:

| Leg | Script | What it proves |
|---|---|---|
| Route 3 battle journey at 60 Hz | `verify:gb6:mainline` | the 109,983-frame mainline tape replays to the frozen terminal state with every map and battle checkpoint intact. |
| Captain-return journey from frame zero at 60 Hz | `verify:j1:mainline` | the J1 continuation, concatenated with the GB6 tape and replayed from frame zero, ends at the Captain's return. |
| Battle defeat and recovery journeys | `verify:gb6:failures` | both committed defeat tapes replay with their visible recovery order. |
| Every imported input lock is executed to its unlock | `verify:g6:locks` | every `lockInput` page releases its lock. |
| No map can freeze the player | `verify:g6:frozen` | a corpus-wide stuck/lock scan over all 263 maps. |

The full 60/30/20 Hz alignment, save/load and rewind checks stay in
`bun run verify:gb6:full` and `bun run verify:j1:full` as release gates; they
are too slow for every push. See [verification.md](verification.md).

### web — the site and a real browser

`bun run web` builds the static site into `dist/web`, then
`bun tools/verify-web-journey.ts` plays the opening journey (bedroom through
the first battle to Route 1) in headless Chrome against the built site,
comparing checkpoint states and framebuffer hashes against the committed
goldens; any console error fails the run. The site is uploaded as the
`web-site` artifact (14-day retention), and the journey screenshots as
`web-journey`. On pushes to `main` the site is also staged as the Pages
artifact.

### deploy — GitHub Pages

Runs only on pushes to `main`, after every other job (every matrix leg) has
passed, and deploys the staged Pages artifact.

## Caches

The prepare action defines two caches:

- the wasm-core build, keyed on the wasm `Cargo.lock`, the engine `Cargo.toml`
  files and the wasm/core sources;
- the pinned Tuxemon source, keyed on `tools/fetch-tuxemon.sh` (the pinned
  commit lives in that script).

There is no dependency cache: `bun install --frozen-lockfile` is fast enough
that the lockfile is the cache key.

## Reproducing a job locally

Common setup (Bun, the Rust wasm target, and the Tuxemon checkout):

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
sh tools/fetch-tuxemon.sh .tuxemon-src   # or point TUXEMON_SRC at an existing checkout
export TUXEMON_SRC=.tuxemon-src
bun run import
```

Then, per job:

```sh
# import job
git status --porcelain                     # must be empty
bunx tsc --noEmit
bun run verify:g6:determinism

# test job (one group per line, or run the whole suite with `bun run test`)
bun test tests/importer.test.ts
bun test tests/g7-repository.test.ts tests/g6-golden.test.ts
bun test tests/g6-locks.test.ts tests/battle-db-adapter.test.ts tests/battle-golden.test.ts tests/terrain.test.ts
bun test $(ls tests/*.test.ts | grep -v -E '(importer|g7-repository|g6-golden|g6-locks|battle-db-adapter|battle-golden|terrain)\.test\.ts$')

# journey job (one leg per line)
bun run verify:gb6:mainline
bun run verify:j1:mainline
bun run verify:gb6:failures
bun run verify:g6:locks
bun run verify:g6:frozen

# web job (needs Chrome or Chromium)
bun run web
bun tools/verify-web-journey.ts
```

The deploy job is a single GitHub Actions call and has no local equivalent.

## Adding a new long check

- **A new maintained journey:** add an entry to the journey matrix in
  `.github/workflows/ci.yml`:

  ```yaml
  - name: <human-readable name>
    run: bun run verify:<script>
  ```

  The script must exist in `package.json` and be self-contained. Nothing else
  in the workflow needs to change.
- **A new slow test file:** new files are picked up by the `rest` group
  automatically. If a file is too slow for `rest` (the groups are meant to
  stay around a minute each), move it to an explicit group's `files:` list
  and add its basename to the `rest` group's exclusion grep in the same
  commit.
