# Importer

All game content is imported, never hand-authored: maps, terrain, events,
NPCs, dialogue, shops, items, monsters and battle data come from a pinned
Tuxemon checkout by running `bun run import`. When an import is wrong, the
fix goes into the importer (or into a missing engine capability), and the
whole import is re-run.

## Source checkout

`bun run fetch:tuxemon` checks out Tuxemon at the pinned commit
(`9e6258ff`, recorded in `tools/fetch-tuxemon.sh`) into the repo-local
`.tuxemon-src/`. The checkout is blobless and sparse: fonts and docs are
excluded, but the eight mainline music tracks and the three used SFX are
included (see [verification](verification.md) for the audio pipeline). To
reuse an existing checkout instead, set `TUXEMON_SRC` to its path; the
importer reads it from `importer/source.ts` and the art cookers, and
battle art and events always come from the same checkout.

## How Tuxemon events become kit commands

Tuxemon events live in TMX object layers and in per-map scenario YAML. Each
event is an ordered list of rules; every rule has conditions (`is`/`not`
checks) and actions. The converter in `importer/project.ts` turns each event
into a kit event page:

1. The page's trigger is chosen from the guard shape (`importer/shapes.ts`):
   a position/facing guard becomes `playerTouch`, an action-key guard becomes
   `action`, an unconditional page becomes `autorun` or `parallel`.
   Conditions such as `char_at`, `char_facing`, `button_pressed` and
   `char_moved` are consumed by this choice — the kit trigger *is* the
   predicate.
2. The remaining conditions become kit `if` clauses. Story state maps to
   switches and variables; battle state maps to `tux.*` extension calls (see
   [architecture.md](architecture.md)).
3. The actions become kit commands. The dispatch is the `switch` over
   action names in `convertActions`; each branch records its disposition in
   the coverage report (see below).

The kit's event vocabulary at the current pin is 35 command ops (text,
choices, switch, variable, transfer, moveRoute, lockInput, place, shop,
battle, ext, and so on) and 10 condition kinds. The importer emits 18 of
those ops plus the `tux.*` extensions.

## Mapping categories

Every converted rule is recorded with one of four dispositions. The
definitions below are the report's own:

- **Native** — represented by current kit commands without gameplay loss.
- **Degraded** — runs in the kit with a documented limitation or importer
  lowering.
- **Placeholder** — deliberate stand-in behavior for legacy content and the
  fixed clock/weather runtime.
- **Dropped** — no equivalent output, including rules inside events the
  converter proves cannot start.

### Native examples

| Tuxemon | Kit output |
|---|---|
| `translated_dialog` | `text` boxes, translated from the en_US message catalog and word-wrapped. |
| `set_variable` / `clear_variable` | `variable` commands; string values are enum-coded globally. |
| `lock_controls` / `unlock_controls` | `lockInput` / `unlockInput`. |
| `transition_teleport` (player, in bounds) | `transfer`; a trailing facing action folds into the transfer direction. |
| `start_battle` (player vs trainer) | `battle` with a trainer setup; literal trainer parties are folded in. |
| `random_encounter` / `wild_encounter` | `battle` with a random-table setup. |
| `create_npc` | a presence variable plus a `place` command for the walker. |
| `is battle_outcome` | `tux.battle_outcome` extension condition reading live battle history. |
| `add_monster`, `set_monster_health`, `set_monster_status`, `evolution` | the matching `tux.*` extension command. |
| `open_shop` (item economy) | the kit `shop` command with imported goods, prices and stock. |
| `play_music` | `playBgm`; the slug resolves through the `Project.audio` table to a committed QOA pak entry (eight mainline tracks) or stays silent (the other 13 used tracks). |
| `fadeout_music` | `fadeoutBgm` (ms → seconds); `0` becomes `stopBgm`. |
| `pause_music` / `unpause_music` | `pauseBgm` / `resumeBgm`. |
| `play_sound` | `playSe` with the authored volume carried through; resolves through `Project.audio` to a WAV pak entry. |
| `is music_playing` / `not music_playing` | `bgmPlaying` (with `negate`); Tuxemon's paused/combat inversion is safe for the map-enter guard idiom. |
| `screen_transition` | two blocking `screenFade` commands that retain each fade half's source duration and RGBA colour. |
| `play_map_animation` / `play_tile_animation` | `mapAnim` at the sampled character tile or fixed source tile. |
| `set_layer` | a native screen `layer` selecting or clearing a packaged RGBA or PNG overlay. |
| `camera_position`, `set_bubble`, `change_bg`, `change_bg_char`, `set_template` | native camera, balloon, backdrop and walking-appearance commands within the limits in [the status list](status.md#presentation). |

### Degraded examples

| Tuxemon | Lowering |
|---|---|
| `char_face player,<dir>` | one-step `moveRoute` (the kit has no face op). |
| `char_stop` | no output: blocking fibers already freeze the player. |
| `add_tracker` | a `switch`; step counters are not modeled. |
| `transition_teleport` with an out-of-range landing | coordinates clamped into the target map; an isolated landing is repaired to the nearest walkable cell by deterministic four-neighbour BFS. |
| `char_wander` | an NPC page with random movement; frequency and bounds are omitted. |
| `load_yaml` | a gating variable; the referenced events are merged at import time and unlock when the action runs. |

### Placeholder examples

The remaining stand-in behavior is explicit and reported by source type:

| Tuxemon | Stand-in |
|---|---|
| `start_battle` (NPC vs NPC, 5 uses) | a visible skip notice in the text box. |
| `choice_monster` / `choice_npc` | enum-coded `choices`; every option is retained, but there is no party-selection UI. |
| `open_shop` (monster trading, 7 uses) | a visible menu listing the stock. |
| `remove_monster` | the party counter decreases by one. |
| `is party_infected` | constant (there is no plague system). |

`time_is` now reads the deterministic saved calendar in all 126 materialized
uses. `update_time` writes the eight upstream time variables; its three source
uses sit in events dropped for other reasons, so the isolated importer fixture
exercises that command shape directly.

Earlier in the project, all battles were placeholders (a text line plus win
switches). Real battles replaced them: `start_battle`, `random_encounter`,
`wild_encounter`, `add_monster`, party and battle-outcome conditions,
faint-point actions and environment checks are now native.

### Dropped examples

| Tuxemon | Reason |
|---|---|
| `is environment_is` (outside battle content) | environment is a battle backdrop; the condition is constant false there. |
| `transition_teleport` targeting an NPC | only the player transfers. |
| `modify_money` with a variable amount | only literal amounts are supported. |
| rules inside structurally discarded events | the event never starts (inert, zero-size, fixed-false guard, trigger area outside the map, or over the 64-cell area cap), or it is not materialized by any map. |

Per-rule drop reasons are retained in `dist/import-report.json`.

## The coverage report

`bun run import` regenerates `reports/G1-coverage.md` (the only committed
file in `reports/`) and the machine-readable `dist/import-report.json`. The
report contains:

- a summary table per kind (actions, conditions): number of source types,
  uses, and the four disposition tallies, plus the S1 acceptance baselines;
- the "executable" share (native + degraded + deliberate placeholder);
- a per-source-type table with the four tallies, so a regression in any
  mapping shows up as a row change;
- audits: the remaining battle/monster placeholders, the economy and item
  catalog, the outdoor world index, and transfer repairs.

The committed report is generated with the full G6 import profile (all
maps, routes, input locks, battles). Running `importer/index.ts` directly
uses the smaller default profile, whose counts are pinned in
`tests/importer.test.ts`; a mapping change can require updating both.

Current coverage (G6 profile):

| Kind | Types | Uses | Native | Degraded | Placeholder | Dropped | Executable |
|---|---:|---:|---:|---:|---:|---:|---:|
| Actions | 98 | 13,617 | 12,322 | 628 | 19 | 648 | 95.2% |
| Conditions | 64 | 8,663 | 8,173 | 2 | 1 | 487 | 94.4% |

## Adding or changing a mapping

1. **Convert.** Add the action case to `convertActions` in
   `importer/project.ts` (conditions go in `clauses`). If the condition is
   trigger-shaped (position, facing, button), it belongs in the trigger
   classifier `importer/shapes.ts` instead.
2. **Record the disposition in the same branch** by calling `noteAction` /
   `noteCondition` with the fate code: `T1` (native), `T1-lowered`
   (degraded), `T3-placeholder` (placeholder), or `T2-dropped` /
   `T3-dropped` / `T4-dropped` (dropped). A branch that emits nothing must
   still record its disposition; unrecorded rules default to dropped. If the
   whole event must be discarded, call `dropAll` on the event coverage with
   the reason.
3. **Regenerate.** Run `bun run import` and read the new row in
   `reports/G1-coverage.md`. The import must leave `git status --porcelain`
   empty apart from the regenerated files, and two isolated imports must be
   byte-identical (`bun run verify:g6:determinism`).
4. **Pin it in tests.** `tests/importer.test.ts` pins the default-profile
   coverage counts, per-row tallies, and a sha256 of the generated output
   for two maps; update the pins. Add a focused test for the new mapping.
5. **Re-run the journeys** that exercise the area:
   - `bun run verify:g6:locks` for anything touching input locks or
     transfers;
   - `bun run verify:gb6:mainline` and `bun run verify:j1:mainline` for the
     mainline story;
   - `bun run verify:gb6:failures` for defeat and recovery paths.
   See [verification.md](verification.md) for what each proves.
