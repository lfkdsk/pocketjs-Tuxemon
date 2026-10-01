# GI-2a names, Tuxepedia, and journal

## Result

The imported Spyder campaign now executes every authored player-name prompt,
both monster-name prompts, all Tuxepedia writes, and all direct journal opens.
They use Pocket RPG Kit's saved, rewindable game-scene lifecycle rather than a
game-specific modal loop. The production game registers three scene IDs:

- `rpgkit.nameInput` for the kit-provided character grid;
- `tux.monsterPicker` for choosing one party member by stable instance ID;
- `tux.journal` for the Tuxepedia list and monster detail view.

The implementation is deliberately generated at the event boundary. There are
no map-specific edits: the importer recognizes the upstream action patterns,
the game extension owns durable monster state, and the scene reducer and Solid
view are registered once for every imported map.

Pocket RPG Kit is pinned at `d4353ee`. After the upgrade, the PocketJS web core
was rebuilt (357,528 bytes). Linux desktop builds probe for ALSA and fall back
to `--no-default-features` when its development package is absent; copied-host
QuickJS benchmark builds always use that flag. The benchmark host also mounts
the current PocketJS audio surface, matching the upgraded desktop runtime.

## Upstream behavior and lowering

The four action families were checked against Tuxemon's Python implementations.

| Source action | Uses | Result | Lowering and compatibility |
| --- | ---: | --- | --- |
| `rename_player` | 5 | Degraded | For the five player targets, opens `rpgkit.nameInput`, writes `playerName`, starts empty, accepts the explicit Tuxemon English character set plus space, caps the value at 15 characters, and consumes cancel. Upstream also supports NPC targets and an optional random-name button; neither is present. |
| `get_player_monster` + `rename_monster` | 2 pairs | Degraded + Native | The adjacent pair is fused into `tux.monsterPicker` -> prepared localized species name -> non-cancellable name input -> nickname writeback. Selection and writeback use the monster IID, not a party index, so identity remains stable. The other 15 general `get_player_monster` uses remain dropped. |
| `set_tuxepedia` | 6 | Degraded | Calls `tux.set_tuxepedia`. Player `seen` and `caught` state persists, is duplicate-free, and is monotonic: caught wins and removes a seen-only entry. NPC-owned journals, repeat counters, and `unseen` removal are intentionally not retained. |
| `open_journal` | 14 | Degraded | Opens `tux.journal` on the requested monster with `reveal: true`. This is a read-only preview: it shows that entry even when unknown, labels it `PREVIEW`/`P`, does not mutate seen/caught state, disables directional browsing, and returns on confirm or cancel. A future menu can open the same reducer without a target for normal browsing. |

Upstream player input starts empty, monster input starts with the localized
species name, both use the shared 15-character limit, and both disallow escape.
The imported scene flow preserves those points. The production charset is
`A-Z`, `a-z`, `1-9`, `0`, `.`, `-`, `!`, and space. Empty names cannot complete
the kit input scene.

Nicknames are optional fields on the persistent monster snapshot. Validation
accepts 1–15 characters, battle hydration and writeback retain them, battle UI
prefers them over the species name, and evolution copies them to the evolved
snapshot. Older version-1 extension saves migrate with an empty `seen` list;
`seen` and `caught` are validated as disjoint known-species sets. Captures and
evolutions promote their species to caught status.

## Journal and picker UI

The journal catalog is generated from all imported monsters and sorted by
Tuxemon number. Known or explicitly revealed rows resolve the corresponding
lazy monster shard; unknown rows remain `???` without loading their details.
The detail panel uses imported front art, localized name and description,
types, height, and weight. The picker shows up to all six current party members,
prefers nicknames, initializes from an existing selected IID, writes that IID
on confirm, and makes no write on cancel.

Both scenes use the shared Tuxemon theme and a 480×272 logical canvas. The
960×544 view is the same composition at exact 2× panel/sprite scale, with only
the host's target-rasterized glyph edges allowed to differ. The visual test
also verifies more than 1,000 opaque front-sprite pixels, including over 100 in
the far-right source quarter, so a blank, substituted, shifted, or cropped
monster cannot satisfy the golden hash alone. A full six-member picker has a
separate instruction footer and cannot paint its final selection through it.

The two committed journal images were opened at original resolution. The
480×272 view is legible and balanced; the 960×544 view preserves its layout and
crisp pixel art. The dependent battle, route, daylight, J1/J2, and browser
density images were also opened after the scene-aware tapes were regenerated.
The intended hospital-password darkness remains the upstream torchlight scene,
and its semantic assertions still pass.

| Golden | PNG SHA-256 |
| --- | --- |
| `tests/goldens/gi2a-journal.480x272.png` | `102e4a9a16797147c90778baf7288ef897f1b83d2663a3036206c221283a4ce7` |
| `tests/goldens/gi2a-journal.960x544.png` | `83e3632a36bb21254ceb61d39ac1f92588412376bec03de91660b2234e0a9e3a` |
| `tests/goldens/web-density-paper-dialog.2x.png` | `630c51a61836a55605364eacc0de0d9afd8413e2f761b97c746a171b3dfc0957` |

## Import coverage

The generated coverage report now classifies the requested action uses rather
than silently dropping them:

- `rename_player`: 5 degraded;
- `rename_monster`: 2 native;
- `open_journal`: 14 degraded;
- `set_tuxepedia`: 6 degraded;
- adjacent rename-form `get_player_monster`: 2 degraded; 15 unrelated uses
  remain dropped.

Across the unchanged source corpus of 13,617 action and 8,663 condition uses,
the generated profile contains 12,124 native, 655 degraded, 19 placeholder,
and 819 dropped actions (94.0% executable), plus 7,986 native, 2 degraded,
1 placeholder, and 674 dropped conditions (92.2% executable).

## Journey re-record and terminal-state audit

Name input is a real blocking scene, so every maintained tape that crosses the
opening prompt was re-recorded. Scene autoplay deterministically enters `A`,
selects the currently highlighted party member, completes monster naming, and
closes direct journal previews. The new tapes preserve all route, story, battle,
loss/recovery, multi-rate, stateful, and rewind assertions.

| Tape | Previous -> current frames | Other moved anchors |
| --- | ---: | --- |
| Opening G6 | 3,793 -> 3,342 | rewind 3,237 -> 2,786; target 2,658 -> 2,462 |
| First-loss | 3,254 -> 3,127 | rewind 2,613 -> 2,486; target 2,334 -> 2,300 |
| Later-loss | 65,515 -> 65,004 | mainline prefix 61,898 -> 61,507; battle window 61,897..65,224 -> 61,506..64,713 |
| GB6 | 109,983 -> 108,618 | 100 battles retained |
| J1 segment | 12,162 -> 12,606 | combined endpoint 122,145 -> 121,224 |
| J2 segment | 49,915 -> 49,759 | combined endpoint 172,060 -> 170,983 |

The GB6 terminal comparison was performed field by field, not accepted as a
hash-only change:

- The terminal remains `spyder_route3 @4,6`, with the same story checkpoints,
  100 battles, gold, RNG state, calendar epoch/day, and weather schedule.
- `sw.playerName` changes from `Player` to `A`. `tuxeball` changes from absent
  to 1; the other item counts are unchanged. The interpreter's mirrored switch
  bank changes consistently and still ends unlocked with no active modal,
  transfer, route, or fiber.
- The extension now carries explicit `seen: []`. `caught` drops `eyenemy` and
  ends as `nut, aardorn, bolt, cardiling, cataspike, arthrobolt, pawsand`;
  `nextMonsterId` changes from 9 to 8.
- Party length changes from six to five. Cardiling changes from level 8 / 58 HP
  to level 6 / 50 HP; the old slot-five Eyenemy at level 5 / 83 HP is replaced
  by Pawsand at level 21 / 233 HP, and the old sixth Pawsand is absent. These
  party, capture, item, and RNG-derived stat differences are consequences of
  the fully re-recorded deterministic battle route, not nickname persistence.
- The reference clock envelope changes with the tape: tick 63,895 -> 66,063,
  minute-of-day 557 -> 558, and sub-minute ticks 2,695 -> 1,263. Its epoch/day
  and weather fields are unchanged.

J1 inherits the five-member GB6 party and ends with Cardiling level 6 / 50 HP
and Pawsand level 21 / 233 HP instead of the former Cardiling level 8 / 58 HP,
Eyenemy level 5 / 83 HP, and sixth Pawsand. J2 inherits those changes; its final
slot changes from Pawsand level 22 / 241 HP to Sampsack level 35 / 307 HP. Both
segments retain their terminal maps, positions, story checkpoints, and battle
counts. The current canonical terminal hashes are:

| Replay | SHA-256 |
| --- | --- |
| G6 | `e42e78b02de5ed71aa021b0281924fce606ac5f723ee32efe53e0d66919ca4bf` |
| GB6 | `f303bc39ce39fa12484156975a15af9c1a411f4dcd9427afc7b0e6b5abdec380` |
| First-loss | `7a08fb1506a3191af592ad58112e3aea95538c3bb276db6f8e26c7d16c942592` |
| Later-loss | `d6ea2b5b966184857d775b1810bfe59109c2b46f4ebd85b55750c1fa72f93d59` |
| J1 | `7090d514f38915ef6daf9ab192918cfc335ae752bd40acadfb50c5d72dec82a1` |
| J2 | `64a941e0a81159c9aeab4aed8364156c793f76f44dd5e833d25bd9744d1ecb93` |

## Verification

All heavy gates were run serially against the upgraded kit and rebuilt wasm.

| Gate | Result |
| --- | --- |
| Two maintained-tree imports | byte-identical aggregate SHA-256 `17e4541401bbca344b1f6dcc7250683120375e0efe1b776e90670c3923bb974a` |
| Terrain determinism | 961 files and 33,214,931 bytes per run, identical |
| Collision oracle | 56,176 directed steps, 0 mismatches |
| Full G6 determinism | 4,742 files and 66,881,993 bytes per run, identical |
| Freeze scan | 263 maps, 0 permanent locks, blocking fibers, or interpreter errors |
| Dynamic lock scan | 334 checks: 328 unlock, 2 transfer, 0 unresolved, 0 errors |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` and `bun run build:wasm` | exit 0; wasm 357,528 bytes |
| `bun run test` | 283 pass, 0 fail, 0 skip; 49 files; 102,483 assertions |
| GB6/J1/J2 standalone, stateful, rewind, 60/30/20 Hz, and both loss paths | all PASS with the hashes above |
| `bun run web` and browser journey | PASS; 0 browser console errors |

The short native QuickJS replay covers both target viewports and the separate
263-map first-visit probe. The full 108,618-frame/100-battle GB6 gate is the
documented 480×272 long run; it matches the canonical terminal state and every
CPU maximum remains below the 50 ms budget.

| QuickJS case | Startup to first frame | All-frame CPU max | Other result |
| --- | ---: | ---: | --- |
| G6 480×272 | 157.399 ms | 28.453 ms | canonical state matched |
| G6 960×544 | 172.095 ms | 29.211 ms | canonical state matched |
| 263 first map visits | — | 16.686 ms max | p95 3.336 ms |
| GB6 480×272 | 159.905 ms | 40.582 ms | battle entry 21.093 ms; exit 14.696 ms; canonical state matched |

The dependency lockfile is unchanged. A final tracked-file scan found no
workstation path, internal URL, or task-number residue.

## Interface for PC storage, trading, daycare, and kennel

The follow-up should extend `createTuxemonScenes` instead of creating another
modal subsystem. A scene command parks the calling event fiber; `SceneRules`
receives only JSON extension/arguments/context, folds input into JSON scene
state, and returns one atomic `SceneCompletion`. `GameView.sceneViews` maps the
same namespaced ID to a Solid view. This keeps save/restore, rewind, multi-rate
replay, input blocking, and event `onDone`/`onCancel` behavior automatic.

- **PC storage:** add a `tux.pc` reducer whose draft rows carry stable monster
  IIDs and an origin of `party` or `kennel`. On completion, return an updated
  extension with the reordered arrays, enforcing the existing party limit 6,
  kennel limit 30, unique-IID validation, and any rule that prevents an empty
  active party. Reuse the journal catalog for names/art and the Tuxemon theme.
- **Trading:** use `tux.monsterPicker` whenever an event only needs one local
  selection. Its completion variable already contains the IID. An `onDone`
  extension command can validate that IID again and atomically remove the sent
  snapshot/add the received snapshot. Network or host negotiation must stage a
  deterministic offer before opening the scene; it must not run inside the
  pure reducer.
- **Daycare:** use the same IID selection, then an extension command to move a
  snapshot into a dedicated daycare record. Time/experience advancement stays
  in deterministic extension commands; the scene only displays and commits a
  choice. Nickname and all generated stats travel with the snapshot unchanged.
- **Kennel:** a `tux.kennel` list can share the PC reducer/view with a restricted
  mode. Returning `SceneCompletion.ext` commits party/kennel transfers in one
  frame, while cancel returns no replacement state.

All four views should consume the existing lazy catalog rather than embedding
the complete monster database, register their rule IDs in production and their
views in `main.tsx`, and add inert IDs to map-only probes that validate authored
commands without executing scenes.

## 前移到当前 main（SLIM-G / DW-G / GM1）

### 合并策略与依赖基线

The forward merge uses game `main` commit `87f16bea` as the rendering and
platform authority. Pocket RPG Kit is now pinned at `58ee4684` and its
PocketJS submodule at `b07d017b`; the rebuilt web core remains 357,528 bytes.
SLIM-G's compact maps and indexed battle textures, DW-G's incremental battle
paint/cache and PSP build, and GM1's reducer-owned audio all remain intact.

The old GI-2a battle files were not restored wholesale. Nickname persistence,
the three utility scene reducers and the journal view were reapplied to the
current battle runtime. In particular, journal art now follows the production
`BattleImageRef -> TileImageSource -> LazyImage` path. Unknown rows do not read
a monster shard, while seen, caught and explicit previews acquire the indexed
front image through the shared lazy repository. Combat continues to use the
current incremental painter and releases its battle textures on scene exit.

One merge-only performance defect was found during the long benchmark: the
QuickJS harness mounted `AudioSurface` twice on the same guest. Removing the
second mount restored the expected GC profile without changing production
runtime behavior.

### Deterministic import and coverage

Two complete maintained-tree imports were byte-identical: 7,296 files,
345,464,605 bytes, aggregate SHA-256
`65034d66f7aaba7f9ce58d3b5f5bf5f3d920d4410c26e1c1d29630e8eb75c0b1`.
The isolated CI-style determinism gate independently produced 4,742 files and
62,046,240 bytes in each root, SHA-256
`fbac3ec12f6ab57d989d03e744773a2205b1a9eda68fafba769b950d2ede993b`.
The two totals differ because the former includes the maintained generated
tree and reports, while the latter compares the isolated import contract.

Merged coverage is:

| Kind | Native | Degraded | Placeholder | Dropped | Executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actions (13,617) | 12,324 | 655 | 19 | 619 | 95.5% |
| Conditions (8,663) | 8,183 | 2 | 1 | 477 | 94.5% |

### Journey replay and terminal-field audit

The forward re-record retained every input mask: frame counts and tape hashes
are byte-identical to the original GI-2a tapes. What changed is the terminal
state contract supplied by current main. Both revisions were replayed in
isolated worktrees and recursively compared, rather than inferring the change
from hashes.

| Replay | Frames | Original GI-2a terminal | Forward terminal |
| --- | ---: | --- | --- |
| G6 opening | 3,342 | `e42e78b0…` | `6d84498e…` |
| First loss | 3,127 | `7a08fb15…` | `106b7e03…` |
| GB6 | 108,618 | `f303bc39…` | `bf570990…` |
| Later loss | 65,004 | `d6ea2b5b…` | `1402a8f4…` |
| J1 | 12,606 / 121,224 combined | `7090d514…` | `097964c6…` |
| J2 | 49,759 / 170,983 combined | `64a941e0…` | `99ae90a5…` |

The field-level differences are exhaustive:

- G6 adds only `interp.audio.bgm`: `music_town_theme`, volume/pitch 100,
  position 1,924 ticks.
- First loss adds only `interp.audio.bgm`: `music_town_theme`, volume/pitch
  100, position 1,709 ticks.
- GB6 adds `music_the_wild_places` at 30 ticks. Twenty-seven generated event
  actor keys move forward by one ordinal because GM1 materializes a preceding
  audio event; each renamed actor has the same page, position and presentation
  fields.
- Later loss adds `music_town_theme` at 10 ticks and has the same ordinal-only
  shift for 21 generated actor keys.
- J1 adds `music_jester_theme` at 2,264 ticks, shifts 13 generated actor keys,
  and moves the matching `interp.touched` key from
  `e012_captain_returns_r020` to `e013_captain_returns_r020`.
- J2 adds `music_cathedral_theme` at 1,081 ticks and shifts nine generated
  actor keys.
- No replay changes its extension payload, party, seen/caught sets, battle
  history, map/position, player movement, story variables, switches, items,
  gold, RNG, clock/weather state, scene closure or frame. J1 and J2 also keep
  their recorded party rows exactly. Thus every changed terminal hash is fully
  explained by GM1 audio state and importer-generated event ordinals.

The accepted forward terminal hashes in full are:

| Replay | SHA-256 |
| --- | --- |
| G6 | `6d84498eb06a590d7b89a0a1e5a618af2bce8bca1bdb62aa2704a92e2cbde3c8` |
| First loss | `106b7e03681c1defa71d9b5a381158ddf7cbf23c6c77ba8de4239eea2a72ead0` |
| GB6 | `bf570990738c248ace3f4014bcd1652d298f3f8b71d2af03efe2cc3163c8df08` |
| Later loss | `1402a8f42177fe2177911b86cf4248b9da59030f597104f5e91b24864c7716de` |
| J1 | `097964c6600ebc98d437e6d4d085515e757006c308cfe8b7da3328cab5b42360` |
| J2 | `99ae90a5a673174877576f7819c257bcf42fce7085809bd10af42437830b1caf` |

### Visual re-pin and inspection

The GI-2a visual manifest now pins twelve production screenshots. Each row
was rendered at both target viewports and the two six-image contact sheets
were opened at 3×. The unknown state keeps art/details hidden; seen reveals
the indexed image without claiming capture; caught exposes the full entry;
preview shows the requested species without mutating discovery; the six-row
picker leaves its footer clear; and name input retains the grid, cursor and
15-character limit. Text remains readable and 960×544 is the exact 2×
composition apart from native target-rasterized glyph edges.

| Scene | 480×272 RGBA FNV-1a | 960×544 RGBA FNV-1a | Re-pin reason |
| --- | --- | --- | --- |
| Unknown | `32a5aab2` | `e65ccb14` | production indexed-art repository; no shard read |
| Seen | `c68243a6` | `ab48eb1a` | indexed front art plus seen-only copy |
| Caught | `71a29c2a` | `9d7eaebb` | full caught details and description |
| Direct journal preview | `0fd798a2` | `a7fbc0c0` | explicit `PREVIEW` state, discovery unchanged |
| Monster picker | `e22321cf` | `431d458e` | current six-member party and nickname-aware labels |
| Name input | `8d4ea2ec` | `af682cd8` | current kit scene renderer and merged theme |

Dependent battle, route, daylight, J1/J2 and browser-density goldens were
also replayed on the merged renderer. J2's six hashes changed because its
checkpoints now retain the continuous afternoon tint (`rgba(255,216,128,12)`),
not because the layouts moved. The semantic test now applies PocketJS's exact
integer source-over blend before checking player/Looten composites and map
landmark colours. All six J2 images were opened side by side; the only visual
delta is the restrained global grade, including the authored Hospital 2
torchlight below it.

### Forward verification

| Gate | Result |
| --- | --- |
| `bunx tsc --noEmit` | PASS, exit 0 |
| `bun run build:wasm` | PASS, 357,528 bytes |
| `bun run build` | PASS; `main.pak` 46,412,192 bytes, `main.js` 1,518,406 bytes |
| `bun run test` | PASS; 312 tests, 0 failures, 116,478 assertions across 54 files |
| `verify:audio` | PASS; all 11 committed audio blobs match |
| `verify:g6:determinism` | PASS; two isolated roots match |
| `verify:g6:locks` | PASS; 334 checks, 328 unlock, 2 transfer, 0 unresolved/errors |
| `verify:g6:frozen` | PASS; 263 maps, 0 locks, blocking fibers or errors |
| GB6, both loss paths, J1 and J2 | PASS with the frame counts and hashes above |
| Web build and browser journey | PASS; 46,766,928-byte game pak, 3,342 frames, four pixel/state checkpoints, 2× density and 0 console errors |
| Chapter re-bake and `verify:chapters` | PASS; 13 snapshots/thumbnails are byte-identical, all 13 suffix replays reach `99ae90a5a673…`, and the combined tape is 170,983 frames |

The full QuickJS GB6 gate replayed 108,618 frames and 100 battles at both
viewports. Both runs matched `bf570990…` and stayed below the 50 ms frame
budget:

| Viewport | Startup to first | Slowest CPU frame | Battle entry max | Battle exit max |
| --- | ---: | ---: | ---: | ---: |
| 480×272 | 139.954 ms | 37.663 ms | 19.416 ms | 4.546 ms |
| 960×544 | 140.861 ms | 43.475 ms | 19.748 ms | 4.875 ms |

The chapter bake was deliberately the final generated-data step. Its 13-image
contact sheet was opened at 3× scale; all maps, actors, dialogue, and chapter
composition were intact after the scene-aware tape refresh.

`bun.lock` is unchanged.

Subagent usage: 4 read-only subagents checked battle reintegration, verification surfaces, documentation/gates, and indexed Tuxepedia assets in parallel. This shortened the initial merge audit; every result was independently exercised by the main integration and serial gates.

PASS
