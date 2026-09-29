# KR1 map first-visit performance

## Result

The 263-map Tuxemon fixture now meets the desktop QuickJS target. Five-run
medians show a 12.736 ms worst frame across the complete 1,684-frame journey,
and no production map has a deterministic preparation unit above 50 ms. The
largest production entry, `buddha_mountain` (212,567 bytes), tops out at
47.560 ms. The only entry over the line is the explicitly non-production
`test_npcs` test map at 66.248 ms.

| Acceptance item | Result |
| --- | --- |
| Journey worst frame | 12.736 ms median (five complete runs) |
| Production maps over 50 ms | 0 / 262 |
| All entries over 50 ms | 1 / 263: `test_npcs` only |
| Largest production map | `buddha_mountain`: 47.560 ms largest unit |
| Startup through first frame | 168.408 ms median |
| First-frame QuickJS heap | 6.209 MiB |
| Journey state hash | `f146882ce7e66055` in all five runs |
| Full tests | 698 pass, 0 skip, 0 fail; 462,570 assertions |
| TypeScript | `bunx tsc --noEmit` exit 0 |

Raw five-run results are in
`/var/tmp/fleet/1875/quickjs-final-journey.txt`,
`/var/tmp/fleet/1875/quickjs-final-frame-max.txt`, and
`/var/tmp/fleet/1875/quickjs-final-all-maps.txt`. The per-map median table is
`/var/tmp/fleet/1875/quickjs-final-all-maps.csv`; the compact machine-readable
summary is `/var/tmp/fleet/1875/quickjs-final-summary.txt`.

## Implementation

### A. Optional runtime checksum verification

`createJsonMapRepository` now takes `verify`. Synchronous package sources skip
SHA-256 by default; a source with asynchronous `prepare` verifies by default,
and either policy can be explicitly overridden. The manifest still contains
the build-time entry hashes and the save content identity is unchanged
(`src/engine/map-repository.ts:313-335`, `:358-361`). Tests cover all four
default/override combinations (`tests/map-repository.test.ts:118-145`).

### B. Build-time full schema validation, runtime structural validation

`splitProjectMaps` runs `validateMapDef` on every map before emitting anything
(`tools/lib/map-project.ts:43-51`). Runtime loading defaults to the smaller
compilation-safety check: id/dimensions, exact ground length and element types,
sparse-layer bounds, and event/page/command arrays
(`src/engine/map-repository.ts:149-221`). `{ validate: "full" }` retains the
full normative schema path (`src/engine/map-repository.ts:313-321`, `:363-364`).
Tests prove the splitter rejects an invalid command and exercise every
structural guard (`tests/map-repository.test.ts:294-335`).

### C. Byte reads and stable ASCII entries

Map canonicalization escapes every non-ASCII UTF-16 code unit as `\uXXXX`, so
the JSON remains equivalent and byte-stable (`src/engine/map-repository.ts:99-108`).
The repository accepts `Uint8Array`, decodes ASCII in bounded 8 KiB
`String.fromCharCode` chunks, and strictly falls back to UTF-8 on any high byte
(`src/engine/map-repository.ts:248-310`). Split checksums cover the bytes that
are actually emitted (`tools/lib/map-project.ts:54-69`). Tests cover BMP text,
a surrogate pair, a payload larger than one chunk, invalid UTF-8, stable bytes,
and byte-backed acquisition (`tests/map-repository.test.ts:170-215`).

### D. Deterministic staged work during non-zero fades

The standard synchronous repository exposes `acquireStep`: unit 1 reads,
decodes and parses; unit 2 verifies when requested, structurally validates and
checks metadata (`src/engine/map-repository.ts:327-380`). Session unit 3 builds
the interpreter world and passage table. Partially prepared data lives only in
`Session.preparingMap`, outside `SessionState`, saves and hashes, and is not
published until the original transfer boundary
(`src/engine/session.ts:180-182`, `:203-260`). Fade-out advances at most one
unit per reference tick (`src/engine/session.ts:531-543`).

Zero-fade transfers still use the all-at-once synchronous path. Repositories
with asynchronous `prepare` do not expose the synchronous staged path, so their
existing pause/retry contract is unchanged. Tests pin the exact three units,
the original swap tick, unpublished caches, and the zero-fade behavior
(`tests/map-repository.test.ts:218-292`).

## Determinism and parity

The imported 24-map parity suite compares canonical inline and sharded state
on every frame through eviction and revisit, restores a save after its map was
evicted, and verifies 60/30/20/4 Hz equivalence
(`tests/map-repository-parity.test.ts:98-184`). Its transfer has a non-zero
fade, so it exercises staged preparation. Normal execution passes all three
cases. A temporary mutation that wrote a repository cache-hit flag into
reducer state made two of the three cases fail immediately (inline `true`,
sharded `false`); removing the mutation restored 3/3 passing tests. No mutation
remains in the worktree.

The five production QuickJS journey runs all finish on `spyder_route1` with
state FNV-1a-64 `f146882ce7e66055`, identical to the pre-optimization KR1
result. The staged cache therefore changes scheduling cost, not simulation
state or transfer timing.

## QuickJS measurement

The fixture is the generated 263-map Tuxemon project. Bundles were rebuilt
against this worktree, then run in the release PocketJS desktop host backed by
rquickjs. Rust `Instant` surrounds the real guest frame or individual fixed
work unit; Bun is used only to generate/build inputs and aggregate results.

For each map, the repository/session cache is released, QuickJS GC runs, and
five cold visits measure read/decode/parse, validation, compilation, and final
publication separately. Each CSV value is the median of its five samples.

| Map | Bytes | Read/decode/parse | Validate | Compile | Commit | Largest unit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `test_npcs` (test-only) | 285,698 | 66.248 | 0.499 | 8.245 | 0.026 | 66.248 |
| `buddha_mountain` | 212,567 | 47.560 | 0.804 | 1.989 | 0.018 | 47.560 |
| `rubberduck_cave_01` | 140,744 | 31.327 | 0.636 | 1.539 | 0.015 | 31.327 |
| `taba_town` | 134,560 | 30.875 | 0.532 | 1.780 | 0.017 | 30.875 |
| `rubberduck_city_01` | 116,513 | 26.287 | 0.568 | 1.429 | 0.015 | 26.287 |

The largest-frame samples across all 1,684 journey frames were 11.594,
12.771, 11.307, 12.756 and 12.736 ms (median 12.736 ms). The original
fully-black transfer boundary itself is cheaper—4.292 ms median—because the
expensive work has already run during fade-out.

Startup-through-first-frame samples were 169.426, 168.408, 169.959, 161.754
and 161.319 ms (median 168.408 ms); first-frame QuickJS heap was 6.209 MiB in
every run. Both remain within the KR1 baseline band of 167–185 ms and about
6.2 MiB.

Before staging, A+B+C had reduced the journey transfer maximum to roughly
23–25 ms, but `buddha_mountain` still had a 50.800 ms median cold acquire.
That remaining production-map violation is why D was implemented.

## Save helpers, errors and documentation

The filesystem helpers now accept the optional shell content identity for
save, load and slot listing (`src/host/save-fs.ts:56-90`). The matching test
proves that the right identity loads/lists and a different manifest is rejected
(`tests/host-save-fs.test.ts:100-110`). A synchronous source with a missing
entry now reports `missing`, while only a source with `prepare` reports
`MapNotReadyError`; inline missing maps report `session: unknown map`
(`src/engine/map-repository.ts:339-347`, `src/engine/session.ts:194-196`).

README documents byte reads, verification/validation defaults, fixed-unit
fade preparation, zero-fade behavior, asynchronous-source residency, and the
save helper identity argument (`README.md:270-303`, `:383-388`). The v1
amendment records the same contract (`src/data/CHANGELOG.md:125-137`).

## Validation and visual check

Final commands, in the required order after building the wasm core:

```text
bun run build:example  -> exit 0, PocketJS build: done
bun test               -> 698 pass, 0 fail, 462570 expect() calls
bunx tsc --noEmit      -> exit 0, no output
```

The complete logs are `/var/tmp/fleet/1875/build-example-final.log`,
`/var/tmp/fleet/1875/bun-test-final.log`, and
`/var/tmp/fleet/1875/tsc-final.log`. There are no skipped tests. No golden file
changed relative to the baseline. The streamed-map tests retain semantic pixel
assertions for both chunk colours and the player, and the upper-occlusion suite
retains representative actor/head/foot assertions.

I opened both critical images at original resolution:

- `tests/goldens/streamed.switch.png`: intact purple/blue split map with the
  white player square at the expected left-side position; no blank or stale
  frame.
- `tests/goldens/r2-ui.occlusion-reference.png`: intact dark grid, multiple
  magenta walkers/upper slices and the central coloured walker; depth examples
  are visible and non-degenerate.

`bun.lock` and `vendor/` have no diff. The Sunstone bundle is 380,639 bytes;
the size guard was updated to 395,000 bytes to account for the shared on-demand
repository/staged loader while retaining about 3.8% headroom
(`tests/sunstone-game-sim.test.ts:397-416`).

## Commits

```text
a0dba75 perf(engine): make map checksum verification optional
71225dd perf(data): validate split maps before lightweight loads
333179f perf(data): decode ASCII map entries from bytes
2cf81ed test: enforce inline and sharded state parity
1679908 perf(engine): stage map loads during transfer fades
0cf0cf0 fix(host): preserve map identity in save slots
ef607a7 test: budget staged map loading code
```

The branch is local only; nothing was pushed.

PASS
