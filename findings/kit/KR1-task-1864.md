# KR1 — on-demand map repository

## Result

Large projects can now ship as a small `ProjectShell` plus independently
addressable map entries. Inline `project.maps` remains the default and all
existing examples still use it unchanged. A shell session synchronously loads
and compiles only its starting map, then acquires a transfer destination and
deterministically retains exactly the current map.

The 263-map Tuxemon fixture confirms that map payload size is no longer startup
size: the JavaScript bundle fell from 18,199,571 to 1,086,501 bytes, median real
QuickJS startup-to-first-frame fell from 857.327 to 166.520 ms, and first-frame
QuickJS live heap fell from 34.562 to 6.197 MiB. The complete deterministic test
gate passes.

## Design delivered

### Project and repository contract

- `ProjectSource` is either the existing inline `Project` or a `ProjectShell`.
  The shell replaces `maps` with `mapIndex` entries containing `id`, dimensions,
  entry name and canonical JSON SHA-256. The normative v1 schema accepts either
  shape, but not a document with neither.
- `MapRepository` exposes `meta`, synchronous `acquire`, deterministic
  `releaseExcept`, and optional asynchronous `prepare`. The standard
  `createJsonMapRepository` verifies entry bytes against SHA-256, parses JSON,
  validates the map schema and row-major/index bounds, and verifies manifest
  metadata before caching a `MapDef`.
- `createSession(project, hz, repository?)` preserves the old call shape. An
  inline project eagerly creates the same caches as before. A shell requires a
  repository and acquires only `project.start.map`.
- A transfer compiles the destination `World` and `PassageTable` into locals
  before publishing them, enters the new map, and then releases all other
  parsed maps/worlds/tables. A failed acquire therefore leaves reducer state
  and the live cache usable.

### Derived data, saves, and asynchronous loading

- Repository bytes, parsed `MapDef`s, compiled interpreter worlds, passage
  tables, render slot lists, textures and nodes remain outside `SessionState`.
  Events cannot inspect them; canonical reducer hashes and snapshots contain
  only the map id and authored state.
- A sharded session computes a manifest identity for the shell and uses a
  pinned hash of the normative map schema. Save envelopes carry these two
  values as metadata. Restore rejects a missing/different identity with a
  typed `SaveError("content")` before reading a map, or reacquires and compiles
  the saved map when it has been evicted. Inline saves retain their old shape.
- A web-backed source returns `undefined` until `prepare(entry)` has made bytes
  resident. `GameView` catches `MapNotReadyError`, stops consuming input and
  ticks, prepares and compiles outside the reducer, then retries the exact
  input frame. The barrier also checkpoints and rolls back an attract
  controller's complete host-frame bookkeeping, including a 4 Hz frame that
  would otherwise fold 15 reference ticks. `onMapLoading` is a display-only
  notification; network completion order never enters reducer state.

### View and build integration

- `GameView` derives NPC slots only from resident/current maps and drops slots
  for evicted maps. Shell dimensions provide camera/occlusion bounds without
  retaining map payloads. `GameAssets.maxActors` reserves a stable native node
  pool sized by the importer for the largest drawable map; the cooker ignores
  event pages whose sprite does not paint.
- `splitProjectMaps` emits a canonical shell and maps sorted by id. Its `files`
  array is package-agnostic and can be written as independent files or
  addressable pak data entries. The caller may override shell and map entry
  names. Duplicate ids/paths are rejected.
- All component examples continue to embed `project.maps`. README and the v1
  format changelog document the opt-in large-project path.

## Correctness coverage

`tests/map-repository.test.ts` uses 24 maps and covers:

- startup reads exactly one map;
- transfer eviction, all-map traversal, revisit/reacquisition, and deterministic
  release sets;
- a cross-map save restored after its map was evicted;
- manifest/schema content mismatch rejected before a map read;
- checksum, schema, dimensions and row-major corruption rejected before entry;
- two runs and 60/30/20/4 Hz yielding the same semantic hash;
- an asynchronous live frame and a 4 Hz attract frame pausing and retrying
  exactly.

The splitter was also run twice over the real fixture. Recursive diffs of both
shell/map output trees were empty. Both shells had SHA-256
`cd066106afb3f4ca8162e1b704c342ebd37da6624566ff0101dbd77e9b03ec4a`;
the first sorted map entry matched at
`b5daec41094cf43c8ae841da10f4b5f4fe3ef8fc2da46bf31a85a4c7a2b7ed24`.

## QuickJS A/B

### Method

`findings/scripts/run-kr1-quickjs.sh` creates two equal-content apps from the
S3 Tuxemon fixture, builds both with PocketJS, copies the desktop host, includes
`kr1-quickjs-bench.rs`, and runs its release `rquickjs` `Runtime` plus real
`UiSurface`. This is QuickJS, not Bun/JSC.

- Content: 263 maps; source inline JSON 12,054,460 bytes; canonical map entries
  7,100,149 bytes; shell 59,910 bytes; unchanged render pak 26,266,544 bytes.
- The map index itself is 42,686 bytes, or 162.3 bytes/map. Canonical map data
  averages 26,997 bytes/map; the largest entry is 285,698 bytes.
- Local sharded reads use synchronous PocketJS `data.fs`, matching the local
  package boundary. A browser can use the async `prepare` barrier described
  above.
- Startup is five fresh processes per variant; the table reports medians.
  Heap is `JS_ComputeMemoryUsage` immediately after the first frame and after
  three explicit `JS_RunGC` passes.
- Journey is three fresh processes per variant, 1,684 frames and five
  transfers. “Worst transfer” is the median of each run's slowest complete
  QuickJS + surface frame.

Raw output: `/var/tmp/fleet/kr1-map-repository-final/results.txt`.

| Metric | Inline 263 maps | Sharded | Change |
| --- | ---: | ---: | ---: |
| JavaScript bundle | 18,199,571 B | 1,086,501 B | −94.0% (16.75× smaller) |
| Startup → first frame, median | 857.327 ms | 166.520 ms | −80.6% (5.15× faster) |
| First-frame QuickJS live heap | 34.562 MiB | 6.197 MiB | −82.1% |
| First-frame retained heap after GC | 33.566 MiB | 6.064 MiB | −81.9% |
| Repository reads at first frame | 0 | 1 | start map only |
| Worst transfer frame, median | 3.670 ms | 109.516 ms | synchronous load cost |
| Retained heap after journey + GC | 33.651 MiB | 6.421 MiB | current-map scale |

The sharded startup samples were 178.100, 172.327, 164.560, 160.568 and
166.520 ms. Its three worst-transfer samples were 109.516, 93.108 and 110.079
ms. The largest transfer includes synchronous filesystem read, SHA-256, JSON
parse, schema validation, interpreter compilation and passage construction.
This is an explicit local-package tradeoff; a web miss performs preparation
and compilation while simulation is paused, then resumes on the same logical
frame.

All six journey runs ended on `spyder_route1` with reducer-state FNV-64
`f146882ce7e66055`. The sharded run performed six reads: the start map plus one
per transfer, including a revisit after eviction. Its pre-GC end heap was
7.813 MiB and retained heap was 6.421 MiB, so the released-map parse/validation
temporaries are collectible rather than retained cache growth.

This is already the target Tuxemon scale, not a five-map extrapolation. Total
map payload contributes only the sidecar storage; startup carries the 59.9 KB
shell (including 42.7 KB of index metadata) plus one map. With the observed
entry names, adding maps costs about 162 bytes/map of startup manifest rather
than about 27 KB/map of parsed payload.

## Verification

Required order and final outputs:

```text
$ bun run build:example
PocketJS build: done                         # all examples/editor/fixtures, exit 0

$ bun test
684 pass
0 fail
457103 expect() calls
Ran 684 tests across 43 files. [83.74s]

$ bunx tsc --noEmit
tsc_exit=0
```

The committed streamed-map-switch and tall-actor occlusion PNGs were opened
and visually checked after the run: both are non-degenerate, the switched map
and player are visible, and actor/upper-layer depth is coherent. Their sim
tests also retain semantic pixel assertions and pinned golden comparisons.

`bun.lock` and `vendor/pocketjs` are unchanged. The worktree is clean.

PASS
