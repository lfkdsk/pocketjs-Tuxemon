# GK: pocket-rpgkit KB1/KB2 upgrade

Date: 2026-09-29

## Result

The game now pins `vendor/pocket-rpgkit` at
`4e5d880dcd2922a476ec13a820b7467ca4812603`. The target contains the KB1/KB2
extension-state and Battle Processing change; it does not contain K4. The P1
`[SHOP]` stock-summary placeholder is intentionally unchanged. Its focused
importer regression and the full suite both pass.

The upgrade preserves gameplay and generated content. The importer emits only
literal transfers, so every tool that reads a transfer now narrows `map`, `x`,
and `y` before treating them as a string and numbers. Story-variable readers
similarly reject an unexpected string before using a value numerically. No
`as any` was introduced.

## Changes and commits

| commit | change |
| --- | --- |
| `1c76e6d` | only the pocket-rpgkit submodule pointer, `b28d83b` → `4e5d880` |
| `77dda90` | literal-transfer and numeric-variable narrowing in importer, tests, freeze scan, and journey driver |
| `aaee3c8` | regenerated component schema hash |
| `b73e6f0` | terminal `SessionState` hash repin with explanatory comments |

The regenerated corpus changed only `data/g6-assets-report.json.schemaHash`,
from `c8ca2ce7…` to `462299c3…`. Map counts, map bytes, manifest hash, terrain,
characters, and battle data remained unchanged.

## Import stability

Two consecutive imports reported the same corpus:

```text
G6 assets: 263 maps, 430 TILESET entries, 152 NPC walkers + player, 86 animated atlases, 14 removable collision bodies
map repository: 263 entries, 61846 shell bytes, 7374469 map bytes
terrain pak: 21575296 bytes (2358327 gzip)
battle spyder: 214 monsters, 230 techniques, 511 textures, 24498560 battle-only pak bytes
import_diff_before=32e0f644e3a4b2ff007424da1d79cc8fbb9c1f756bff5ed60cfb3c99e4b92a28
import_diff_after=32e0f644e3a4b2ff007424da1d79cc8fbb9c1f756bff5ed60cfb3c99e4b92a28
```

The identical before/after diff digest proves the second import made no byte
change.

## Terminal-state hash proof

The one-time checker is `/var/tmp/fleet/1906/hash-proof.ts` (fleet artifact
26542). It replays the maintained 2,728-frame journey, hashes the complete new
state, then removes exactly the three KB1/KB2 default fields: top-level `ext`,
top-level `scene`, and `interp.pendingBattles`. Its complete output was:

```text
terminal=spyder_route1@14,19
added_defaults=ext:null,scene:null,pendingBattles:0
new_state_sha256=ce3ec0ac665936c0c6388d5a890c3d9e1f463ab816ba0fea3a0075275d38e5f1
stripped_state_sha256=937ca7f719f79d2a1de6c6d22b7a4827ef9cae378904c254e7bcf592be56eb48
old_expected_sha256=937ca7f719f79d2a1de6c6d22b7a4827ef9cae378904c254e7bcf592be56eb48
stripped_matches_old=true
```

Therefore the terminal-state change is exactly the new default state shape,
not a gameplay change. `tests/g7-repository.test.ts` and the QuickJS gate now
pin `ce3ec0ac665936c0c6388d5a890c3d9e1f463ab816ba0fea3a0075275d38e5f1`.
The maintained journey result hash remains
`496365020783604da13fa153a71e50ad1d51f5595cf219d25d0c9d0a8db9f17f`;
the four PNG golden hashes are also unchanged.

## Verification

| gate | result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0; `dist/main.js` 1,126,442 B and `dist/main.pak` 58,154,768 B |
| `bun run build:wasm` | exit 0; `pocketjs.wasm` 289,758 B |
| `bun test` | 69 pass, 0 fail, 54,652 assertions; the two-run built-bundle replay executed and passed |
| `bun run verify:g6:locks` | 319 pages, 323 lock commands, 317 unlocked, 2 transferred, 0 unresolved, 0 errors, 0 exceptions |
| `bun run verify:g6:determinism` | two isolated roots; 3,166 files, 56,812,838 B; SHA-256 `8cb6f12572f403f55c60d4594dcf8203efff95b41d92f7617e69d376e70164ec` |
| `bun run verify:g6:frozen` | 263 maps; 0 permanent input locks, 0 permanent blocking fibers, 0 errors |
| focused G7 repository suite | 3 pass, 0 fail; inline/sharded every-frame equality and attract 60/30/20/4 Hz equality |

The adaptive journey driver also passed independently at every required host
rate:

| Hz | host frames | terminal | story/result |
| ---: | ---: | --- | --- |
| 60 | 2,728 | `spyder_route1 @14,19` | all seven story assertions pass; maintained result hash `49636502…` |
| 30 | 1,441 | `spyder_route1 @14,19` | all seven story assertions pass |
| 20 | 1,009 | `spyder_route1 @14,19` | all seven story assertions pass |
| 4 | 382 | `spyder_route1 @14,19` | all seven story assertions pass |

The QuickJS script needs the desktop package staged first, so after
`bun tools/desktop.ts --build-only`, `bun run bench:g6:quickjs` passed both
journeys and the 263-map first-visit scan:

| viewport | startup → first | walking total p95 / max | map-switch total p95 / max |
| --- | ---: | ---: | ---: |
| 480×272 | 207.748 ms | 1.083 / 1.908 ms | 2.944 / 13.764 ms |
| 960×544 | 199.153 ms | 0.970 / 1.664 ms | 2.481 / 12.260 ms |

Both runs completed 2,728 frames and five transfers at Route 1 with the new
canonical hash. The corpus first-visit worst-stage p95 was 16.713 ms. The
non-exempt maximum was `buddha_mountain` at 47.192 ms, within the 50 ms limit;
the specified `test_npcs` exception was 61.401 ms. Startup remains below the
250 ms budget, walking stays around the prior 1 ms p95, and map switching is
below the prior 14.282 ms recorded maximum.

## Visual and hygiene checks

I opened all four maintained 480×272 PNGs. The bedroom has the compact room,
rug, furniture, and centered 16×32 player; downstairs shows the player and mom
at adjacent live tiles; Paper Town shows roads, water, forest, buildings, the
blue mart, NPC, and player; Route 1 shows water, crop rows, forest, signs, and
the player. There are no blank, uniformly colored, displaced, or visibly
corrupt frames. The golden suite also checks semantic player/NPC/building/
terrain/water/crop pixels and passed all six tests including built replay.

`bun.lock` is byte-identical to the baseline (SHA-256
`8ccfa9937302846daca5f829c3ef706f1cfa7d3e521c2fad9076842f6ab306e2`).
The final implementation diff contains no fleet identifier, AI attribution,
or `as any`, and no PocketJS source was changed.

PASS
