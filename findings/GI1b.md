# GI-1b: runtime movement control and extended choice boxes

This task wires the importer to the kit's KM1 `moveControl` and KC1
`extChoice` runtime capabilities, replacing the degraded/placeholder
lowerings for character movement and party selection. It is the
continuation of task 2081; the branch also merges the current `main`
(J2 hospital journey, time/weather importer, day/night runtime, chapter
snapshots, kit bump to `dfbae47`).

## Mapping table

Dispositions are read from the generated `dist/import-report.json`
(full import, all options on). "Before" is the pre-GI-1b state on this
branch's base.

| Tuxemon action | Uses | Before | After | Target |
|---|---:|---|---|---|
| `char_stop` | 88 | Degraded | **Native (88)** | KM1 `moveControl` stop |
| `char_wander` | 33 | Degraded (33) | **Degraded (32) + Dropped (1)** | KM1 `moveControl` wander |
| `char_speed` | 19 | Degraded | **Degraded (19)** | KM1 `moveControl` speed (nearest MV grade) |
| `char_run` | 2 | Degraded | **Dropped (2)** | upstream run rate is movement-scoped; the kit has no such speed |
| `set_facing_mode` | 2 | Degraded | **Native (2)** | KM1 `moveControl` facing-mode (locked / followMovement) |
| `char_position` | 1 | Degraded | **Degraded (1)** | clamped `place`; trailing `char_face` folds into `dir` |
| `get_player_monster` | 17 | Dropped | **Native (17)** | KC1 `extChoice` over the live party |
| `choice_monster` | 2 | Placeholder | **Native (2)** | KC1 static `extChoice` writing enum codes |
| `choice_npc` | 1 | Placeholder | **Degraded (1)** | KC1 static `extChoice`; per-option names distinguish the lines (no portraits) |
| `get_party_monster` | 9 | Dropped | **Native (1) + Degraded (7) + Dropped (1)** | `tux.get_party_monsters` dumps iids into `iid_slot_*`; only Nimrod's `Zircon Back` finds a party (修复 3 reclassified the other seven) |
| `remove_monster` | 5 | Placeholder (4) | **Native (4) + Dropped (1)** | deletes the iid from its owner (player party, kennel, or NPC party) |

Notes on the non-Native outcomes:

- `char_wander` stays **Degraded**, not Native: upstream Tuxemon wanders
  with the Python module-level `random.choice` (a single global RNG stream,
  not a per-NPC one); we use the kit's deterministic wander seed so the
  path is identical at 60/30/20 Hz, across save/restore and L-rewind. The
  one Dropped use is an event whose page cannot start.
- `char_speed` stays **Degraded**: Tuxemon expresses speed in tiles/s,
  the kit has discrete MV speed grades, so the importer picks the
  nearest grade (documented limitation).
- `char_position` is **Degraded**: it lowers to a clamped `place`. Upstream
  `char_position` is itself an instantaneous placement
  (`complete_tile_entry`), so there is no interpolation to lose; the
  degrade is only the out-of-bounds clamp (upstream raises). A `char_face`
  immediately following a `char_position` folds into the placement's `dir`
  so the facing is not swallowed by the placement's route stop.
- `remove_monster` has one Dropped use (an event that cannot start); the
  other four now delete the chosen monster from its owner — the player
  party, the kennel, or an NPC party — instead of decrementing `party_size`.

`trading`, `access_pc`, `open_journal`, `rename_*` and the other
interface actions are out of scope (they wait for the kit's game-scene
host).

## Coverage impact

Full-import summary after the merge and 修复 1 (actions / conditions):

| Kind | Uses | Native | Degraded | Placeholder | Dropped | S1 T1 |
|---|---:|---:|---:|---:|---:|---:|
| Actions | 13,617 | 12,244 | 560 | 12 | 801 | 6,155 / 6,246 (45.20%) |
| Conditions | 8,663 | 7,976 | 2 | 1 | 684 | 4,500 / 4,591 (51.95%) |

The import is byte-stable: two consecutive `bun run import` runs produce
identical `dist/import-report.json` and `reports/G1-coverage.md`.

## Tape changes and reasons

This table is a snapshot of the first merge (`8b76116`, J2 re-recorded in
`bc7182b`); later rounds re-recorded every tape again (see 修复 1–3).

The merge of `main` (time/weather importer + kit bump to `c93a1ec`)
changed generated project state, so every journey's terminal state hash
moved. The input tapes (masks) themselves are unchanged except for J2.

| Journey | Tape change | Hash change | Reason |
|---|---|---|---|
| G6 (3,820 frames) | none | golden PNGs re-captured | kit bump changed rendered pixels; checkpoints unchanged |
| GB6 mainline (109,654 frames) | none | `37c9cb0b…` → `0aaa2947…` | time/weather importer adds clock/weather state to every session |
| J1 (12,185 frames) | none (masks identical) | base hash → `0aaa2947…` | follows the GB6 base; J1's own terminal hash unchanged |
| GB6 later-loss (65,186 frames) | none | `ba8e54ca…` → `959a3afc…` | same time/weather state change |
| J2 (49,915 → 50,110 frames) | **re-recorded** | `519154d6…` → `50ecaa6a…` | see below |

### J2 re-recording

The J2 segment is driven from the J1 terminal state, which changed in the
merge. Re-driving the original autoplay against the new base produced a
segment that skipped two route-6 sight-line trainers, Blair and Richard
(48 trainers instead of the required 50). Root cause: `spyder_route6`
has a wandering NPC (Frances, `e021_create_frances`) whose deterministic
position differs on the new base; the driver's BFS pathfinding avoids
dynamic NPC bodies, so it reroutes around Blair's and Richard's sight
lines.

The fix keeps wandering on (per the upstream "player priority / block
and wait" rule, not a disable) and makes the two trainer fights
explicit in the J2 driver (`fightNpc`), matching how the driver already
handles Gunner, Looten and the dojo roster. The re-recorded segment is
50,110 frames, fights 56 battles (50 trainers + 6 wilds, all won), and
completes the hospital-cure storyline. The J2 goldens were re-captured
at both viewports.

## Determinism evidence

- `verify:g6:determinism` PASS: two full tape replays produce identical
  per-frame state (sha256 `9c9f29c5…`).
- `verify:g6:frozen` PASS: 263 maps, 0 permanent input locks, 0
  permanent blocking fibers. The scan only proves the interpreter holds
  no permanent lock or blocking fiber; it does not prove a wanderer can
  never spatially block the player.
- `verify:g6:locks` PASS: 330 pages, 334 lock commands, 0 unresolved.
- `verify:gb6:mainline` PASS: 109,654 frames, 100 battles (22 trainers
  all won), terminal `ad9717bb…`.
- `verify:gb6:failures` PASS: first-loss terminal `8424d9bc…`,
  later-loss terminal `f6eec2d4…`, including the faint-point teleport
  and recovery.
- `verify:j1:mainline` PASS: combined 121,839 frames, 17 battles,
  terminal `c8b62692…`.
- `verify:j2:mainline` PASS: combined 172,009 frames, 56 battles (50
  trainer, 6 wild), terminal `b17279fb…`.
- `verify:chapters` PASS: thirteen chapter envelopes resume at their
  `timelineFrame` and suffix-replay to the full-tape terminal state.
- `bun run web && bun tools/verify-web-journey.ts` PASS: the 60 Hz web
  replay reaches all four G6 checkpoints with matching pixels; the
  native-density dialog checkpoint moved to frame 1565 (the Gold Pass
  dialog at `spyder_paper_town@24,13`).
- `bun test`: all green (count in the 修复 1 section).

## Cost

Real QuickJS desktop host (rquickjs), 960×544 viewport, full production
app (`tools/bench-g6-quickjs.sh`: G6 journey replay + 263-map first-visit
sweep). The state hash matches the pinned `846ca161…`. Measured on the
same machine as the review; a concurrent `bun test` from another task was
running during the bench, so the wall-clock figures are slightly noisy
(the CPU-time figures, which the bench also reports, are not affected).

| Metric | QuickJS (this run) |
|---|---:|
| Boot to first frame | 180.1 ms (first QuickJS frame 1.61 ms; startup-to-first 182.3 ms) |
| Walking frame, before battle (397 frames) | mean 1.131 ms, p95 1.749 ms, max 2.258 ms |
| Walking frame, after battle (217 frames) | mean 1.630 ms, p95 1.988 ms, max 2.372 ms |
| Map switch (119 frames) | mean 0.853 ms, p95 2.302 ms, max 6.051 ms |
| Battle (1,133 frames) | mean 8.739 ms, p95 10.065 ms, max 20.664 ms |
| Map first-visit (263 maps) | p95 4.042 ms, max 17.969 ms (worst `spyder_routec`) |
| All-frame budget (50 ms) | max 20.664 ms (battle entry) — under budget |

The only per-frame cost GI-1b adds is the wander-NPC movement from
`moveControl`. The review measured the marginal cost on the same
QuickJS desktop host by rotating 0/2/4/6 real wander overrides on
`spyder_scoop4` (5 runs × 600 frames each): 0 wanderers = 0.750
ms/frame, 6 wanderers = 0.899 ms/frame, a marginal 0.017–0.025
ms/wanderer/frame. The 修复 1 changes (char_run drop, get_party_monster,
choice_npc labels, placement facing fold) do not touch the wander path,
so that marginal cost is unchanged. The worst real map (6 wanderers)
adds ≈0.15 ms/frame — comfortably inside the 16.7 ms budget. Boot and
first-visit cost are dominated by bundle parse and map load, not NPC
movement. The K1 freeze scan reports 0 permanent locks and 0 permanent
blocking fibers; that is an interpreter-liveness claim only, not a proof
that a wanderer can never spatially block the player.

## Subagent usage

None. This continuation was a single-agent run; the killed session left
a merge in progress and a partial wander benchmark, both of which were
finished here. Spawning subagents was not worthwhile for the serial
verify/bench work that dominated the task.

## 修复 1 (review-task-2135)

The review `findings/review-task-2135.md` judged the original GI-1b work
FAIL. This section records each blocking item, what changed, the test
that pins it, and the before/after.

### B1 — `choice_npc` options are now distinguishable

**What changed.** `choice_npc` shares one label across all buttons
upstream and tells options apart by per-option NPC front portraits. The
kit choice box draws only the label, so the six appearance options in
`start_tuxemon.yaml` all rendered "Select". The importer now appends each
option's own translated name (from `base.po`) to the shared label:
"Select (White male)", "Select (Black male)", and so on. Disposition
moved from Native to **Degraded** (text-only; no portraits).

**Test.** `choice_npc keeps every appearance option distinguishable`
(`tests/importer.test.ts`) — asserts six options, six distinct labels,
and each appearance name present.

**Before/after.** Before: six identical "Select" lines (the old test
locked this in). After: six distinct lines carrying the appearance names.

### B2 — `char_run` is dropped, not a persistent run grade

**What changed.** Upstream `char_run` calls `mover.running()`, which
sets the absolute run rate (7.35 tiles/s) only while the body is already
moving and reverts to walk speed on idle. The kit's `run` control is a
persistent relative +1 speed grade with no movement-scoped lifetime, so
the old mapping sped up every later route (route1's idle christie ran
her whole pathfind, where upstream is a no-op). The importer now emits
nothing and records the action as Dropped with the reason.

**Test.** `ImportOptions.moveControl emits KM1 stop, run, speed and
facing controls` (`tests/importer.test.ts`) — now asserts no `run`
control is emitted for the route1 event, matching upstream's no-op on
the idle christie.

**Before/after.** Before: Native (2), persistent +1 grade. After:
Dropped (2). The one wander use (`spyder_route1` bjorn) may lose a
transient single-step boost; the kit cannot express a movement-scoped
speed.

### B3 — `get_party_monster` and NPC-owned `remove_monster`

**What changed.** `get_party_monster` was dropped; it now lowers to
`tux.get_party_monsters`, which dumps each party monster's iid into
`iid_slot_*` variables (upstream opens no menu) for either an NPC party
or the player's. `remove_monster` resolved the iid only in the player
party/kennel; it now searches the player party, then the kennel, then
every NPC party, deleting from the owner where found. The Nimrod event
(`get_party_monster spyder_nimrod_argon` + `remove_monster iid_slot_0`)
now deletes argon's first monster for real.

**Tests.**
- `get_party_monster becomes a tux.get_party_monsters ext command`
  (`tests/importer.test.ts`)
- `get_party_monsters dumps the party iids into iid_slot variables`,
  `get_party_monsters defaults to the player party`, and
  `remove_monster removes an NPC-owned monster by iid (the Nimrod flow)`
  (`tests/battle-extension.test.ts`)

**Before/after.** Before: `get_party_monster` Dropped, `remove_monster`
player-only (Native 4 + Dropped 1). After: `get_party_monster` Native
(8) + Dropped (1, a world-level cheat event attached to no map);
`remove_monster` Native (4) + Dropped (1) with global IID lookup.
(Historical: 修复 3 reclassified `get_party_monster` as 1 Native /
7 Degraded / 1 Dropped; see the 修复 3 R2 section.)

### B4 — placement no longer swallows the facing

**What changed.** The kit installs pending routes before it applies
placements, and a player placement stops the player route, so a separate
`char_face` route after `char_position` was swallowed (the TV Yes
cutscene left the player facing down instead of left). The importer now
folds an immediately-following `char_face <same target>,<dir>` into the
`place` command's `dir`, which is exact: upstream places and faces as
two instants.

**Test.** `char_position followed by char_face folds the facing into the
placement` (`tests/importer.test.ts`) — statically asserts the place
carries `dir: "left"`, then drives the real imported event through the
reducer and asserts facing is left (1) after the trigger and still left
on the next frame.

**Before/after.** Before: `place` (no dir) + a swallowed face route,
facing 0. After: `place` with `dir: "left"`, facing 1 and persists.

### B5 — docs corrected

`docs/status.md`, `docs/importer.md` and this report now match the
implementation:
- `char_run` is Partial/Dropped (was Done/Native); `char_position` is
  Done with the facing fold; `choice_npc` is Partial/Degraded (was
  Done/Native); `get_party_monster`/`remove_monster` are Done with NPC
  owners.
- `docs/importer.md` no longer says `char_stop` has no output, that
  wander omits frequency/bounds, that choices are placeholders, or that
  `remove_monster` only decrements a counter.
- The wander RNG claim is corrected: upstream uses the Python
  module-level `random.choice` (a single global stream), not a per-NPC
  RNG.
- The `char_position` claim is corrected: upstream is itself an
  instantaneous placement (`complete_tile_entry`); there is no
  interpolation to lose.
- The frozen-scan claim is corrected: 0 permanent locks / 0 blocking
  fibers is an interpreter-liveness result only, not a proof that a
  wanderer can never spatially block the player.
- Journey frame counts use the post-merge values (GB6 109,654; J1
  combined 121,839; J2 combined 172,009).

### B6 — QuickJS cost

(Replaced the JSC-extrapolated numbers with real QuickJS desktop-host
measurements; see the Cost section below.)

### B7 — merge of main and re-recordings

Merged local `main` (day/night runtime, chapter snapshots, native-density
text, kit pointer to `dfbae47`). Kept `FacingMode`/`AnimationDef`,
`surfaceLabels`/`wanderControls`, and the benchmark stale-artifact
preflight. Re-recorded GB6 mainline (109,654 frames), later-loss, J1
(12,185) and J2 (50,170 segment, 172,009 combined) against the merged
project; the J2 driver now idles 60 frames before the hospital-password
checkpoint so the golden captures a clear room instead of a torchlight
transition. Refreshed the g6-journey terminal-hash pins and the
cross-map save frame; re-baked the chapter snapshots. The web
native-density dialog checkpoint moved to frame 1565 (the Gold Pass
dialog at `spyder_paper_town@24,13`), verified by opening the PNG.

### 需要组件仓提供的能力

- **Choice-box option images.** `choice_npc` upstream distinguishes options by per-option NPC portraits.
  The kit choice box draws only text labels, so the importer falls back
  to per-option names (Degraded). A kit capability to attach an image
  per choice option would let the importer restore the upstream
  presentation.

## Subagent usage (修复 1)

1 subagent (Explore, read-only): extracted the exact upstream semantics
of `char_run`, `get_party_monster`, `remove_monster`, `char_position`,
`choice_npc` and the real content excerpts, with file:line citations.
This saved serial reading time; all fixes, gates, re-recordings, the
QuickJS bench and the final verdict were done by the main agent.

## 修复 2 (review-task-2081-fix1)

The re-review `findings/review-task-2081-fix1.md` judged 修复 1 FAIL on
three items. This section records each fix.

### F1 — chapters re-baked after the last tape change

Merged local `main` twice: first the SLIM-G compact map shards and
indexed battle art (`bf79f29`), then the GM1 music/sound, battle frame
cost and PSP work (`28d2c23`) plus the chapter clock fix (`ec9af51`,
`87f16be`). The kit submodule moved to `58ee468` (PocketJS `b07d017b`);
`bun run build:wasm` was re-run after the pointer change. The merge
conflicts were generated data (journeys, reports, chapters) plus
`importer/project.ts` (kept the GI-1b movement cases and adopted main's
native `play_music`/`fadeout_music`/`pause_music`/`unpause_music`
instead of the old P1-silent drop) and the docs.

All journeys were re-recorded against the merged project, and the
chapter snapshots were re-baked **last**, after every tape change:

| Journey | Segment frames | Combined frames | Battles | Terminal state |
|---|---:|---:|---|---|
| GB6 mainline | 110,575 | — | 97 (22 trainer, 75 wild) | `e5a1dd27…` |
| J1 captain-returns | 13,487 | 124,062 | 18 (10 trainer, 8 wild) | `0a4a07e1…` |
| J2 hospital-cure | 51,478 | 175,540 | 54 (50 trainer, 4 wild) | `2fc635e3…` |
| GB6 first-loss | 3,281 | — | 1 | `3b79c196…` |
| GB6 later-loss | 65,435 | — | 1 | `4d3836ef…` |

`verify:chapters` PASS: 13 chapters, 175,540 combined tape frames,
snapshots and thumbnails byte-identical, all suffix replays reach
terminal `2fc635e34ab5`.

The J2 segment now meets four of the six previously-required wild
species (foofle and katapill are no longer on the driven path because
the GM1 battle frame cost shifted the encounter RNG); the verify pin
was narrowed to the four species the journey actually meets.

### F2 — NPC battle parties persist after the battle (option a)

> Superseded by 修复 3 (R1/R2): the party persistence below never cleared,
> which made Billie's later battles reuse her early team, and the dojo/gym
> `get_party_monster` calls never found a party. The claims "matching
> upstream", "the autoplay path is unchanged" and "the same path covers the
> dojo and gym" were wrong.

Chose option (a): the battle runtime now keeps a defeated trainer's
party in `npcParties` instead of deleting it, matching upstream (an
NPC keeps its monsters after a battle). The folded `setup.party`
monsters join any extension-staged ones, are assigned deterministic
iids from the extension's id counter, and the merged party is capped at
`PARTY_LIMIT` (6) like upstream's `add_monster` — Billie is a recurring
rival fought across eight maps, so without the cap the persisted party
grew past the validator's limit.

**Real-content proof.** The Nimrod `Zircon Back` event now works end to
end: `Talk Argon`'s folded `chrome_robo` (level 30) persists in
`npcParties.spyder_nimrod_argon` after the battle, so `Zircon Back`'s
`tux.get_party_monsters` writes the iid into `v.iid_slot_0` and
`tux.remove_monster` deletes it. The same path covers the dojo
(`spyder_dojo2`, three point calls after the kataro/iroh/wan battles)
and gym (`spyder_leather_gym`, four point calls for brad/chad) content.

**Tests.**
- `the Nimrod Zircon Back flow: a folded trainer party persists so
  get_party_monster writes its iid and remove_monster deletes it`
  (`tests/battle-runtime.test.ts`) — drives the real Talk Argon setup
  through the runtime, then the real `tux.get_party_monsters` /
  `tux.remove_monster` commands.
- `a trainer fought twice keeps its persisted party capped at the party
  limit` (`tests/battle-runtime.test.ts`) — the Billie scenario.
- The existing `remove_monster removes an NPC-owned monster by iid`
  test still passes.

**Terminal-state diff.** Persisting `npcParties` for every defeated
trainer changed the session state, so every journey terminal hash moved
(see the F1 table). The autoplay path is unchanged — no condition reads
`npcParties` in a way that alters behavior (`char_defeated` is false
for `PendingMonster`, which has no `currentHp`, same as the old empty
party; `party_size(npc)`/`has_monster(npc)` are placeholders that don't
read it). Wild-encounter counts shifted only because the GM1 battle
frame cost changed the step timing.

### F3 — docs aligned with the implementation

- `docs/importer.md`: `char_stop` and `set_facing_mode` moved to Native
  examples; `choice_monster` to Native; `choice_npc` to Degraded (was
  Placeholder).
- `importer/index.ts`: the generated coverage text no longer claims
  `choice_npc` and `remove_monster` are Native; it now states
  `choice_npc` is Degraded and that trainer parties persist in
  `npcParties` so `get_party_monster`/`remove_monster` address real
  iids. Re-imported to regenerate `reports/G1-coverage.md`.
- `docs/status.md`: `char_run` is Planned (both uses dropped, not
  Partial); `char_wander`/`char_speed`/`char_position` are Partial with
  their degrade limits noted (were Done); the `remove_monster` row notes
  the post-battle persistence.
- `findings/GI1b.md`: corrected the kit pointer (`dfbae47`, was
  `c93a1ec`), the J2 修复 1 frame count (50,170, was 50,110 in two
  places), and the `choice_monster` portrait claim (only `choice_npc`
  falls back to per-option names).
- `README.md`, `docs/verification.md`, `docs/ci.md`: frame counts and
  battle totals refreshed to the re-recorded values; the "No map can
  freeze the player" overstatement replaced with the precise
  interpreter-liveness claim (0 permanent locks / 0 blocking fibers,
  not a proof against wanderer spatial blocking).

### Acceptance gate (serial, `TUXEMON_SRC=/var/tmp/tuxemon-src`)

| Command | Result |
|---|---|
| `bun run import` ×2 | byte-identical |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 |
| `bun run build:wasm` | exit 0 |
| `bun run test` | 327 pass / 0 fail (52 files) |
| `verify:chapters` | PASS (13 chapters, 175,540 frames) |
| `verify:gb6:mainline` | PASS (110,575 frames, 97 battles) |
| `verify:j1:mainline` | PASS (124,062 combined frames, 18 battles) |
| `verify:j2:mainline` | PASS (175,540 combined frames, 54 battles) |
| `verify:gb6:failures` | PASS (first-loss + later-loss) |
| `verify:g6:locks` | PASS (330 pages, 334 locks, 0 unresolved) |
| `verify:g6:determinism` | PASS (`baecbe13…`) |
| `verify:g6:frozen` | PASS (263 maps, 0 permanent locks / 0 blocking fibers) |
| `verify:audio` | PASS (all hashes match) |
| `bun run web` + `verify-web-journey.ts` | WEB JOURNEY PASS (console errors 0) |
| `bun.lock` | unchanged |

## Subagent usage (修复 2)

1 subagent (general-purpose, foreground): refreshed the journey frame
counts and battle totals in `README.md`, `docs/verification.md` and
`docs/ci.md`, and replaced the freeze overstatement. This saved serial
editing time; the merge, F2 implementation, journey re-recordings,
chapter re-bake, all gates and the final verdict were done by the main
agent.

## 修复 3 (review-task-2081-fix2)

The re-review `findings/review-task-2081-fix2.md` judged 修复 2 FAIL on
R1–R3. This round merged local `main` (`84c488e`: renaming, the
Tuxepedia and journal scenes), fixed the NPC party lifetime, made the
`get_party_monster` dispositions honest, re-recorded every tape and
refreshed the docs from this round's verify output.

### Merge of `main`

42 conflicts. The one code conflict was `get_player_monster` in
`importer/project.ts`: main's rename picker (a `get_player_monster`
immediately followed by `rename_monster` opens the `tux.monsterPicker`
scene) now comes first, and every other use falls through to the
branch's KC1 `extChoice`; `set_tuxepedia`, `open_journal` and
`rename_monster` follow main. Generated data, tapes, goldens, pins and
chapter screenshots took main's side and were then regenerated; the docs
were merged by hand. The kit pointer is `58ee468` on both sides. The
merge commit message is "Merge branch 'main'" (no branch name).

### R1 — an NPC's party lives as long as the NPC

Upstream drops every non-persistent NPC on each map transition
(`tuxemon/map/transition.py` `change_map` → `_clear_npcs` →
`npc_manager.clear_npcs`, which keeps only `persistence` NPCs; no mod
NPC sets it), `create_npc` builds a fresh NPC with an empty party unless
the NPC is already on the map (`event/actions/create_npc.py`), and
`remove_npc` discards it.

Implementation:

- `battle/extension.ts`: new command `tux.clear_npc_party {character}`
  deletes `npcParties[character]`.
- `importer/project.ts`: with battles on, `create_npc` emits
  `if local.npc.<slug> == 0 → tux.clear_npc_party` before setting the
  presence variable (the guard mirrors upstream's "already exists" no-op;
  the kit clears every `local.*` id on each map entry, same-map
  transfers included), and `remove_npc` emits `tux.clear_npc_party`
  after clearing the presence variable.
- `battle/runtime.ts`: unchanged logic; a battle still appends the
  folded `setup.party` to the NPC's current party (capped at the party
  limit, like upstream `add_monster` within one NPC lifetime) and keeps
  it there, so `get_party_monster`/`remove_monster` after the battle
  still work. Because the party is cleared on the next fresh
  `create_npc`, a later visit's battle starts from that visit's monsters
  only.

Limitation at the time (superseded by 修复 4, which drops every NPC
party on each map change): parties of NPCs on maps the player had left
stayed in the save until that NPC was created again.

**Billie, every battle in the re-recorded tapes** (enemy party from the
tape's `battles[]`; `87f16be` is the pre-persistence build the review
showed to match upstream):

| Tape / battle | After this fix | `87f16be` |
|---|---|---|
| GB6 #0 (Paper Town) f2177 | [1] budaye@5 | [1] budaye@5 |
| GB6 #1 (Route 2) f10302 | [3] budaye@6, eyenemy@6, cardiling@3 | [3] budaye@6, eyenemy@6, cardiling@3 |
| J1 #0 (Route 4) f4031 | [3] budaye@18, cardiwing@16, eyesore@16 | [3] budaye@18, cardiwing@16, eyesore@16 |
| J1 #1 (Route A) f7594 | [4] budaye@20, cardiwing@17, eyesore@17, viviphyta@17 | [4] budaye@20, cardiwing@17, eyesore@17, viviphyta@17 |
| J2 #0 (Dojo 4) f20877 | [4] bamboon@34, eyesore@30, cardiwing@30, viviphyta@30 | [4] bamboon@34, eyesore@30, cardiwing@30, viviphyta@30 |
| J2 #1 (Route 6) f38220 | [4] bamboon@40, eyesore@40, cardiwing@40, viviphyta@40 | [4] bamboon@40, eyesore@40, cardiwing@40, viviphyta@40 |

All six match. Across every trainer battle in the five tapes, 80 of 82
enemy parties match `87f16be` position by position; the other two are
Route 6 Gunner ([2] enduros@25, viviteel@25) and Blair ([2]
grintrock@35, grinflare@35), met in the opposite order with identical
parties.

**Tests.**

- `tests/battle-runtime.test.ts`: the old "a trainer fought twice keeps
  its persisted party capped at the party limit" (which pinned the
  accumulation as the spec) is replaced by "a trainer's party lasts for
  the NPC's lifetime and is cleared with it": within one lifetime a
  second battle appends (capped at 6), after `tux.clear_npc_party` the
  next battle has only its own 4 monsters.
- `tests/npc-party-lifecycle.test.ts` (new) replays the real imported
  event commands (`create_npc` guard + clear, `tux.add_monster`,
  Battle Processing, `remove_npc` + clear) through the production
  extension and battle rules, with a map visit modelled as the kit's
  `local.*` reset:
  - Billie's five encounters (Paper Town, Route 2, Route 4, Route A,
    Dojo 4) fight exactly the parties in the table above;
  - losing to Marion (Route 2) and coming back: the rematch party is the
    same 2 monsters, not 4;
  - `create_npc` for an NPC already on the map keeps its party, and
    Billie's Route 2 win follow-up (`remove_npc`) discards hers.
- `tests/importer.test.ts`: "create_npc and remove_npc bound the NPC's
  party lifetime" checks the guarded and unguarded clears on Route 2.

### R2 — `get_party_monster` dispositions

Chose the honest-classification option. Making the dojo order effective
would only matter for the following `add_tech iid_slot_*` actions, and
all 12 `add_tech` uses are dropped, so nothing would consume the iids.
The importer now classifies each use from the content:

- Native when the NPC's party can exist at that point: Nimrod's
  `Zircon Back` (after the Talk Argon battle). In the re-recorded J2 the
  chapter snapshots `greenwash-aardant` and `hospital-cure` carry
  `v.iid_slot_0 = "txmn-000044"`; argon's current party is a later
  `chrome_robo` (`txmn-000046`) added by `Post Flashback`.
- Degraded (`get_party_monster(before folded battle)`) when the NPC's
  own `add_monster` calls earlier in the event are folded into a later
  battle: the three dojo calls (Iroh, Kataro, Wan).
- Degraded (`get_party_monster(after NPC-vs-NPC battle)`; named
  `npc without party` until 修复 4 corrected the reason) for the four
  gym calls (Brad, Chad). They sit on the `Points Brad`/`Points Chad`
  pages, which wait for `battle_last_winner` from an NPC-versus-NPC
  battle; that battle runs as a skipped placeholder that writes no
  winner, so the pages never run. (Create Brad/Chad do add monsters,
  so the party itself is not empty.)

Coverage: `get_party_monster` 1 Native / 7 Degraded / 1 Dropped (the
`spyder.yaml` cheat code that can never start), pinned by
`tests/importer.test.ts` "get_party_monster is Native only where the
NPC's party exists when it runs". The generated text in
`importer/index.ts` (and thus `reports/G1-coverage.md`), `docs/status.md`
(`remove_monster`/`get_party_monster` row, now Partial) and
`docs/importer.md` (Native and Degraded tables) say the same thing.

### R3 — numbers from this round's output

All journey numbers come from the final verify runs below and the
regenerated `reports/G1-coverage.md`:

| Tape | Frames | Battles | Terminal state |
|---|---:|---|---|
| G6 opening | 3,369 | 1 | — |
| GB6 mainline | 108,225 | 100 (22 trainer, 78 wild) | `93db6e4a…` |
| J1 captain-returns | 12,629 (120,854 combined) | 17 (10 trainer, 7 wild) | `a9791f34…` |
| J2 hospital-cure | 50,014 (170,868 combined) | 56 (50 trainer, 6 wild) | `b8099566…` |
| GB6 first-loss | 3,154 | 1 | `5bedca90…` |
| GB6 later-loss | 64,611 | 1 loss + prefix | — |

Coverage: actions 12,437 / 13,617 Native (91.3%), 95.8% executable;
conditions 8,183 / 8,663 Native (94.5%), 94.5% executable.

Updated: `README.md`, `docs/status.md`, `docs/verification.md`,
`docs/ci.md`, `docs/importer.md` (coverage table). The QuickJS timings
in `README.md`/`docs/status.md` were not re-measured; they now say they
were measured on the earlier 108,618-frame, 100-battle recording of the
mainline tape. The PPSSPP result now says it was checked on an earlier
recording of the opening tape and not re-run on the 3,369-frame tape.
The snapshot table in "Tape changes and reasons" is restored to its
`8b76116`/`bc7182b` values (kit `c93a1ec`, J2 50,110 frames), and its
header now says it is a snapshot.

Other fixes found on the way:

- `tools/update-j2-goldens.ts` booted the world without
  `FIXED_TIME_HOST_GLOBALS`, so the J2 goldens took their daylight grade
  from the wall clock at regeneration time (main's were captured in the
  afternoon; a regeneration at 16:30 local time produced a visibly darker
  grade). It now
  starts at the fixed 09:00 like the other golden tools, and
  `tests/j2-golden.test.ts` reads the morning profile from
  `battle/daylight.ts`.
- `tools/verify-j2-mainline.ts` is back to main's six-species wild
  roster, which the re-recorded tape meets again.
- `tools/verify-gb6-failures.ts` prints the computed first-loss hash on
  mismatch.

### Re-recording order

`bun run import` → `bun run build` → `goldens:g6` (opening tape) →
first-loss → GB6 mainline → later-loss → `record:j1:mainline` →
`record:j2:mainline` → `goldens:gb6:route` (frames moved to 5,727 /
10,285 / 43,446 / 108,222) → `goldens:j1` → `goldens:j2` → pins
(import hash, G6 terminal, first-loss terminal, web dialog frame 1,622 +
its golden) → `bun tools/bake-chapters.ts` **last** → `verify:chapters`.
Every regenerated PNG was opened and checked by eye (G6 keyframes, route
2, Route 4 Billie, Greenwash/Looten, hospital password torchlight,
hospital cure, the web native-density dialog, chapter thumbnails).

### Mutation check (isolated detached worktree, removed afterwards)

| Mutation | Killed by |
|---|---|
| `tux.clear_npc_party` is a no-op | 4 tests (3 lifecycle + runtime lifetime) |
| `create_npc` clears even when the NPC is on the map | 4 tests (importer + 3 lifecycle) |
| `remove_npc` emits no clear | 2 tests (importer + lifecycle) |
| every `get_party_monster` Native | 1 test (importer disposition) |
| battle start ignores the staged party | 3 tests |

### Acceptance gate (serial, `TUXEMON_SRC=/var/tmp/tuxemon-src`)

| Command | Result |
|---|---|
| `bun run import` ×2 | 3,957 output files byte-identical |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 |
| `bun run build:wasm` | exit 0 |
| `bun run test` | 339 pass / 0 fail (55 files) |
| `verify:audio` | PASS (all hashes match) |
| `verify:chapters` | PASS (13 chapters, 170,868 frames, terminal `b809956636aa`) |
| `verify:gb6:mainline` | PASS (108,225 frames, 100 battles: 22 trainer, 78 wild) |
| `verify:j1:mainline` | PASS (120,854 combined, 17 battles: 10 trainer, 7 wild) |
| `verify:j2:mainline` | PASS (170,868 combined, 56 battles: 50 trainer, 6 wild) |
| `verify:gb6:failures` | PASS (first-loss 3,154; later-loss 64,611) |
| `verify:g6:locks` | PASS (330 pages, 334 locks, 0 unresolved) |
| `verify:g6:determinism` | PASS (`0555315c…`) |
| `verify:g6:frozen` | PASS (263 maps, 0 permanent locks / 0 blocking fibers / 0 errors) |
| `bun run web` + `tools/verify-web-journey.ts` | WEB JOURNEY PASS (console errors 0) |
| `bun.lock` | unchanged |

## Subagent usage (修复 3)

1 subagent (general-purpose, background, edit-only, no commands):
refreshed the journey frame/battle counts and coverage percentages in
`README.md`, `docs/verification.md`, `docs/ci.md` and `docs/status.md`
from the numbers I gave it, and flagged the PPSSPP provenance question.
I re-read every changed line and rewrote the PSP sentences. It ran while
the main agent ran the lock/determinism/freeze/audio verifies, saving
roughly 10 minutes of editing. The merge, R1/R2 implementation, tests,
re-recordings, goldens, chapter bake, mutation check, all gates and the
verdict were done by the main agent.

## 修复 4 — NPC parties end with the map change (upstream `change_map`)

The fix 3 re-review failed on R1: only `create_npc`/`remove_npc`
cleared an NPC's party, so the save kept the parties of NPCs on maps the
player had left (35 parties at Candy Hospital). Upstream
`MapTransition.change_map` calls `npc_manager.clear_npcs()` on every
map change, same-map ones included, and keeps only NPCs with
`persistence` (`tuxemon/map/transition.py:38-43`,
`tuxemon/npc_manager.py:60-67,150-152`; default `False`
in `tuxemon/db.py:2154`, and no mod NPC sets it).

### Implementation

- `battle/extension.ts`: new command `tux.clear_npc_parties {keep}`
  drops every NPC party except the listed persistent slugs. It returns
  no change when there is nothing to drop.
- `importer/project.ts`:
  - `PERSISTENT_NPCS` is read from the NPC database's `persistence`
    flag. It is empty for this corpus.
  - Every imported transfer now emits `tux.clear_npc_parties` right
    before the `transfer`. That covers `transition_teleport` and the
    `teleport_faint` defeat transfer. The parties go with the map
    change itself, as in `change_map`.
  - Every map gets one parallel entry page, `e000_npc_parties`. Its
    page condition is `local.tux.npc_parties_cleared == 0`, it runs the
    same command, and it then sets that variable. The kit clears
    `local.*` on each map entry, and parallels start in ascending id
    order before any blocking fiber. So this page runs exactly once per
    visit, before any of the map's own events builds a party.
  - The page is the catch-all for map entries that are not imported
    transfers, such as the demo warp menu, which restarts the session
    on another map with the live banks.
  - It is appended before the time/weather event, which stays last.
- Within a visit nothing changes: re-running `create_npc` for an NPC
  already on the map is still a no-op, and `remove_npc` still clears
  that NPC.
- **Why both clear points.** With the entry page alone, the rebaked
  chapters still showed stale parties at City Park (1), Flower City (3)
  and Candy Town (5). A replay probe showed the cause: each of those
  chapters is captured on the exact frame the transfer's fade-in ends.
  That frame is saveable, and it comes one tick before the new map's
  first interpreter tick. The transfer-side clear closes that window.
- Cost:
  - The entry page takes one actor slot: `maxActors` 503→504 and
    `runtimeMaxActors` 218→219, with the pins updated in
    `tests/g6-assets.test.ts`.
  - The map repository's entry bytes grow 4,499,153→4,586,336 (+1.9 %).

### Tests (`tests/npc-party-lifecycle.test.ts`, 3→5 tests)

- The replay model's `enter()` now runs the map's real imported
  `e000_npc_parties` commands after the `local.*` reset.
- Billie: after each of the five visits are entered, `npcParties` is `{}`.
- Marion: after the defeat and re-entry, her party is undefined before
  `create_npc` runs.
- New real-session test. It walks through Route 2's imported west door
  to Cotton Town with `BTN_BITS.LEFT`:
  - after 120 idle frames on Route 2, Marion's party is still there (no
    map change, no clear);
  - on the first frame on Cotton Town, during the fade, `npcParties` is
    already `{}`;
  - 60 frames later, any party left belongs to an NPC that Cotton
    Town's own events add.
- New warp test: `startSession` on Cotton Town with the carried
  `sw`/`ext`, the way the demo warp works. One tick later the Route 2
  party is gone.

Mutations, each in a detached worktree removed afterwards:

| Mutation | Result |
|---|---|
| Entry page without the clear command (before the transfer-side clear existed) | 3 fail / 1 pass |
| Entry page without its page condition (clears every tick) | the same-map assertion fails (1 fail) |
| No transfer-side clear (entry page kept) | real-transfer test fails (1 fail / 4 pass) |
| No entry-page clear (transfer-side kept) | Billie, Marion and warp tests fail (3 fail / 2 pass) |

### Save state: the re-review's `jq` on the rebaked `data/chapters.json`

| Chapter | Map | npcParties before | after |
|---|---|---:|---:|
| bedroom … cotton-town (6) | — | 0 | 0 |
| city-park | spyder_citypark | 1 | 0 |
| route-3-north | spyder_route3 | 4 | 0 |
| flower-city | spyder_flower_city | 7 | 0 |
| captain-returns | spyder_mansion | 11 | 0 |
| candy-town | spyder_candy_town | 29 | 0 |
| greenwash-aardant | spyder_greenwash | 35 | 1 (`spyder_greenwash_looten`, this map's NPC) |
| hospital-cure | spyder_candy_hospital3 | 35 | 0 |

A frame-by-frame replay of the combined 170,868-frame tape found:

- 174 map arrivals, and no frame of any of them still holds a party;
- at most 6 parties at any frame, against 35 at the end before this fix.

### Player-visible behaviour is unchanged

Re-recording every tape with the recorders gave the same inputs:

- the `masks`, `maps`, `battles`, `story` and `party` of the GB6,
  first-loss, later-loss, J1 and J2 tapes are byte-identical to fix 3;
- the G6 opening and first-loss tapes are fully identical, including
  their terminal hashes `4bc48ecf…` and `5bedca90…`.

Only these terminal state hashes moved:

| Tape | Before | After |
|---|---|---|
| GB6 mainline | `93db6e4a…` | `eb81c416…` |
| GB6 later-loss | `fb98b783…` | `78a84c84…` |
| J1 | `a9791f34…` | `6a47dd83…` |
| J2 | `b8099566…` | `eec0900c…` |

The J1/J2 initial hashes follow from these. Goldens, chapter thumbnails
and the web density golden are byte-identical, because the frames did
not move.

Billie and Marion in the re-recorded tapes. These are the same as the
fix 3 re-review table and `87f16be`:

| Tape | Start frame | Opponent | Enemy party | Outcome |
|---|---:|---|---|---|
| GB6 | 2,177 | Billie | budaye@5 | won |
| GB6 | 10,302 | Billie | budaye@6, eyenemy@6, cardiling@3 | won |
| GB6 | 38,003 | Marion | aardorn@7, aardorn@7 | won |
| J1 | 4,031 | Billie | budaye@18, cardiwing@16, eyesore@16 | won |
| J1 | 7,594 | Billie | budaye@20, cardiwing@17, eyesore@17, viviphyta@17 | won |
| J2 | 20,877 | Billie | bamboon@34, eyesore@30, cardiwing@30, viviphyta@30 | won |
| J2 | 38,220 | Billie | bamboon@40, eyesore@40, cardiwing@40, viviphyta@40 | won |

### R2 wording, also flagged by the re-review

The four gym `get_party_monster` calls stay Degraded, but the reason
was wrong. They sit on Points pages gated on `battle_last_winner` from
an NPC-versus-NPC battle. That battle is a skipped placeholder that
writes no winner, so the pages never run; the party is not empty.

Corrected in:

- the importer note, now keyed
  `get_party_monster(after NPC-vs-NPC battle)` (the counts in
  `reports/G1-coverage.md` are unchanged);
- `docs/importer.md` and `docs/status.md`;
- this report's R2 section.

This report's summary table and the B3 before/after no longer give
Native 8 as the current classification.

### Docs

- `docs/status.md`: the `remove_monster`/`get_party_monster` row no
  longer lists departed NPC parties as a limitation. It now says every
  map change drops all NPC parties.
- `docs/importer.md`: the `transition_teleport` row describes the
  transfer-side clear and the entry page.
- `battle/runtime.ts`: comment updated.

### Gates (final HEAD, `TUXEMON_SRC=/var/tmp/tuxemon-src`, serial)

| Command | Result |
|---|---|
| `bun run import` ×2 | 4,115 dist files plus data, report and assets; same digest both runs, clean tree |
| `bunx tsc --noEmit` | exit 0 |
| `bun run build` | exit 0 (pak 4,813 entries) |
| `bun run build:wasm` | exit 0 (357,528 B) |
| `bun run test` | 341 pass / 0 fail (55 files) |
| `verify:audio` | PASS (all hashes match) |
| `verify:chapters` | PASS (13 chapters, 170,868 frames, byte-identical snapshots and thumbnails, terminal `eec0900cf35c`) |
| `verify:gb6:mainline` | PASS (108,225 frames, 100 battles: 22 trainer, 78 wild) |
| `verify:j1:mainline` | PASS (120,854 combined, 17 battles: 10 trainer, 7 wild) |
| `verify:j2:mainline` | PASS (170,868 combined, 56 battles: 50 trainer, 6 wild) |
| `verify:gb6:failures` | PASS (first-loss 3,154 / `5bedca90…`; later-loss 64,611 / `78a84c84…`) |
| `verify:g6:locks` | PASS (330 pages, 334 locks, 0 unresolved, 0 errors) |
| `verify:g6:determinism` | PASS (2 roots, 4,742 files, `ef80fef6…`) |
| `verify:g6:frozen` | PASS (263 maps, 0 permanent locks, 0 blocking fibers, 0 errors) |
| `bun run web` + `tools/verify-web-journey.ts` | WEB JOURNEY PASS (console errors 0) |
| `bun.lock`, kit pointer | unchanged |

I opened the web end frame (`dist/web-journey/end.png`, Route 1) and the
Candy Town chapter thumbnail; both render normally.

## Subagent usage (修复 4)

None. The work was one tightly coupled chain: the importer rule, then
re-recording, then the chapter bake, then the gates. Each step depended
on the previous result, and all of it was heavy serial work that must
not run in parallel.

PASS
