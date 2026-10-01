# GM1 — Pocket Tuxemon has sound: SFX, mainline music, and music state

The eight mainline music tracks and the three used SFX are transcoded into
committed QOA/WAV assets, packed into the pak, and mapped through the
importer to the kit's KAU1 audio commands. The reducer now tracks music
state across maps, saves and rewinds; hosts without an audio module stay
silent by design. Actual playback (QOA decode, host audio mounts) lands
with the kit's streaming-audio work.

This is a continuation task: the fetch, transcode and license steps were
already committed by the previous session; this session finished the
importer mapping, pak packing, GameView opt-in, the origin/main merge
(kit c93a1ec), the journey hash re-pins, the cost measurement and the docs.

## What shipped

| Step | Commit |
| --- | --- |
| Sparse-checkout the eight mainline music tracks | `2e47cb8` |
| Transcode pipeline + committed QOA/WAV assets + manifest | `29c14f2` |
| Audio attributions + Shadewing soundpack readme | `864e77f` |
| Importer mapping (playBgm/playSe/bgmPlaying + Project.audio) | `36582d8` |
| Merge origin/main (kit c93a1ec, J2) | `dd36711` |
| Pack audio blobs into pak.json + GameView `createAudioEffects` opt-in | `e140db0` |
| Read the audio manifest from the source tree, not the output root | `c029023` |
| Re-pin journey terminal hashes (gb6/j1/j2/first-loss/later-loss) | `7a85b77` |
| Update test goldens (coverage, event ids, byte-pin, assets) | `0daeefa` |
| Bench wrapper reads the expected hash from the journey | `83e9901` |
| Docs: status.md, importer.md, architecture.md | `ca24c38` |
| Default TUXEMON_SRC to the repo-local checkout (no machine path) | `babef50` |

## Assets and pipeline

- `tools/fetch-tuxemon.sh` sparse-checks the eight mainline tracks (GM0 §1.1)
  alongside the existing checkout, still pinned to Tuxemon `9e6258ff`.
- `tools/transcode-audio.ts` decodes each ogg/mp3 to s16 22.05 kHz mono with
  ffmpeg, encodes music as QOA and SFX as WAV, and commits the blobs to
  `assets/audio/` with a manifest recording the ffmpeg version and per-file
  SHA-256. `bun run verify:audio` re-checks the committed blobs.
- The 11 blobs (8 QOA + 3 WAV) total **7,207,422 bytes** and ship as raw pak
  entries (`audio:qoa.*` / `audio:wav.*`). `gen-assets.ts` reads the manifest
  and emits both the pak entries and the `Project.audio` logical-id → pak-key
  table.
- Licenses: `licenses/AUDIO-ATTRIBUTIONS.md` (per-track credits) and the
  Shadewing soundpack readme, carried unchanged.

## Importer mapping (GM0 §5)

| Tuxemon | Kit output | Notes |
| --- | --- | --- |
| `play_music slug` | `playBgm {id}` | slug sanitized through the audio table; no-asset slugs stay silent |
| `fadeout_music ms` | `fadeoutBgm {duration}` / `stopBgm` | ms → seconds; `0` → `stopBgm` |
| `pause_music` / `unpause_music` | `pauseBgm` / `resumeBgm` | 0 authored uses, mapped for completeness |
| `is/not music_playing slug` | `bgmPlaying {id, negate?}` | G6 paused/combat inversion is safe for the map-enter guard idiom |
| `play_sound slug[,vol]` | `playSe {id, volume?}` | volume = round(vol×100); fixes the old volume-drop |

The `Project.audio` table maps sanitized slugs to pak keys for the 11
committed assets. The 13 non-mainline used tracks and the 6 dead slugs
(GM0 §1.1) still emit `playBgm` so the reducer tracks them, but have no
pak entry and stay silent.

The kit schema at c93a1ec only accepts the `audio:wav.*` namespace; the
eight `audio:qoa.*` entries are separated into `report.audioQoaPending`
so the schema-error gate stays meaningful until the kit schema is extended.

## Why the journey terminal hashes moved (field-level proof)

The previous session's field-level diff tool (`tools/gm1-audio-diff.ts`)
replays the frozen GB6 tape and hashes the terminal state with and without
the sparse audio fields. The diff against the pre-GM1 state shows exactly
two deltas:

1. **`interp.audio` added** — the BGM intent (`music_the_wild_places` at the
   GB6 terminal). This is the expected reducer state.
2. **Character id renumbering on 195 maps** — each map with a `play_music`
   action gains one previously-dropped parallel event (the old importer
   dropped the action, leaving an empty event that was removed). The new
   `playBgm` event shifts the compiler-assigned `e###` ids by one (two on
   `spyder_timber_walledgarden1`).

The journey path, battle checkpoints, map positions and story variables are
unchanged — the verifies confirm battle checkpoints, trainer wins (22/22 in
GB6, 10/10 in J1, 50/50 in J2) and story gates all match. The tape (input
masks) was not re-recorded; only the terminal state hashes were re-pinned.

Re-pinned hashes:

| Journey | Field | Old → New |
| --- | --- | --- |
| gb6 mainline | `terminalStateSha256` | `df7c996e` → `b4e6fe98` |
| j1 captainreturns | `base.terminalStateSha256` | `df7c996e` → `b4e6fe98` |
| j1 captainreturns | `terminalStateSha256` | `88c3c691` → `2c398829` |
| j2 hospitalcure | `base.terminalStateSha256` | `88c3c691` → `2c398829` |
| j2 hospitalcure | `terminalStateSha256` | `519154d6` → `9135d8c1` |
| gb6 first-loss | `FIRST_LOSS_STATE_SHA256` (constant) | `d321b217` → `0f75240b` |
| gb6 later-loss | `terminalStateSha256` | `4a969987` → `c5cb914b` |
| g7/battle-repository | `EXPECTED_TERMINAL_STATE_SHA256` | `5653f011` → `7425955a` |

## Coverage shift

The audio actions and conditions moved from dropped to native:

| Metric | Before | After |
| --- | ---: | ---: |
| Actions native | 6,225 | 6,425 (+200) |
| Actions dropped | 4,053 | 3,853 (−200) |
| Actions tier-1 meets baseline | false | **true** |
| Conditions native | 3,550 | 3,747 (+197) |
| Conditions dropped | 3,019 | 2,822 (−197) |

The 200 action uses are `play_music` (199) + `fadeout_music` (1); the 197
condition uses are `music_playing` (1 is + 196 not). The one dropped
`play_music` is the `act2`-slot anomaly GM0 recorded (a condition string in
an action slot, dropped as an unknown action by Tuxemon's own loader).

## Cost

**Pak size:** 70,055,360 bytes (66.8 MiB), up from 59.89 MiB (GM0 §4.1).
The +6.9 MiB is the 11 audio blobs (7,207,422 bytes) plus a few bytes per
map for the added event. The web player downloads the pak whole, so the
first load grows by the same amount. This is the interim (b) loading
option from GM0 §4.2; on-demand per-entry loading (option c) is the target.

**QuickJS frame timing** (desktop host, `bench-gb6-quickjs.sh`, 109,983-frame
GB6 journey, state hash `b4e6fe98` matches):

| Kind | Frames | qjs mean | qjs p95 | qjs max |
| --- | ---: | ---: | ---: | ---: |
| walking | 6,340 | 2.451 ms | 3.791 ms | 20.721 ms |
| map-switch | 1,760 | 1.184 ms | 4.323 ms | 9.111 ms |
| battle | 44,108 | 12.574 ms | 18.185 ms | 58.339 ms |
| all | 109,982 | 6.003 ms | 15.461 ms | 58.339 ms |

The desktop host has no audio module, so `createAudioEffects` returns null
and acquires no frame callback — the audio driver is completely absent. The
only overhead is reducer-side: a sparse `audio.bgm` object allocated once
per `playBgm` (110 times in 110k frames), and O(1) property reads for the
`bgmPlaying` guards. The frame budget (50 ms) is comfortably met on every
kind.

## Verification

| Check | Result |
| --- | --- |
| `bun run import` twice, no diff | PASS (byte-identical) |
| `bunx tsc --noEmit` | 0 errors |
| `bun run build && bun run build:wasm` | PASS |
| `bun run test` | 249 pass, 0 fail, 0 skip |
| `verify:g6:determinism` | PASS (4,638 files, 62,073,260 bytes) |
| `verify:g6:locks` | PASS (330 pages, 0 unresolved, 0 errors) |
| `verify:g6:frozen` | PASS (0 permanent locks, 0 errors) |
| `verify:gb6:mainline` | PASS (109,983 frames, 100 battles, 22 trainers won) |
| `verify:j1:mainline` | PASS (122,145 combined frames, 17 battles, 10 trainers won) |
| `verify:j2:mainline` | PASS (172,060 combined frames, 56 battles, 50 trainers won) |
| `verify:gb6:failures` | PASS (first-loss + later-loss paths) |
| `bun run web && verify-web-journey` | PASS (0 console errors, pixels match) |
| `verify:audio` | PASS (all committed blob hashes match) |
| `bun.lock` / `vendor/` | unchanged |

## Forward merge to main b832794 (2026-10-01)

Merged game-repo main (GI-1a presentation mapping, web 2× text, QuickJS
bench fix; kit submodule to dfbae47) into this branch.

**Conflict resolution.** `importer/project.ts` kept both mappings: GI-1a's
presentation cases (map animations, screen fades, camera, balloons,
backdrops, overlays, appearance, tile properties) and GM1's audio cases
(`playBgm`/`playSe`/`bgmPlaying`). GI-1a's full `screen_transition`
supersedes the old lowered `wait` version, which the auto-merge had already
dropped. The `native` clause kind (GI-1a) joins `bgmPlaying` in the clause
union and `toIf`. Generated reports, asset reports and goldens were
regenerated, never hand-edited.

**Why the terminal hashes moved (field-level proof, same tape, same
frames).** The GB6 tape was replayed against the merged project and the
terminal state dumped, then compared field-by-field with a dump of GI-1a's
terminal state (same tape replayed in a clean b832794 checkout). Exactly
two deltas:

1. `interp.audio` added — the BGM intent (`music_the_wild_places` at the
   GB6 terminal), the expected reducer state.
2. `chars.chars` renumbering — 27 of 67 terminal chars carry a shifted
   `e###` compiler id (the `play_music` parallel event lands before them);
   after normalizing the id prefix, the two states have identical
   logical-name sets, instance counts and **0 value differences**.

Story variables, party, positions, map state, switches, items and gold are
unchanged; the masks (tape) are byte-identical — only hash fields moved.

Re-pinned hashes:

| Journey | Field | Old (GI-1a) → New |
| --- | --- | --- |
| gb6 mainline | `terminalStateSha256` | `cedface0` → `f02f0e73` |
| j1 captainreturns | `base.terminalStateSha256` | `cedface0` → `f02f0e73` |
| j1 captainreturns | `terminalStateSha256` | `670a85f7` → `7f11a290` |
| j2 hospitalcure | `base.terminalStateSha256` | `670a85f7` → `7f11a290` |
| j2 hospitalcure | `terminalStateSha256` | `933c8a78` → `074e2b7d` |
| gb6 later-loss | `terminalStateSha256` | `28b8ac0c` → `5af94e2d` |
| gb6 first-loss | `FIRST_LOSS_STATE_SHA256` | unchanged `0f75240b` |
| g7/battle-repository | `EXPECTED_TERMINAL_STATE_SHA256` | unchanged `7425955a` |

The first-loss path (3,254 frames) and the battle-only g7 repository carry
no music event, so their hashes are untouched.

**Coverage shift (conversion-path report).** Actions native 12,122 →
12,322 (+200: `play_music` 199 + `fadeout_music` 1), dropped 848 → 648;
conditions native 7,850 → 8,047 (+197 `music_playing`), dropped 684 → 487.
In the type-table view the action tier-1 baseline flips to **meets**
(6,330 ≥ 6,246 required uses).

**Event-id follow-ups.** The merged importer shifts compiler ids on maps
that gain the music event; the GB6 recorder's sight-strip assertions
(`battle_confused`, `talk_bobette`, `rookie_talk`) and the GI-1a visual
fixture (`encounters_r022`, `resting_in_bed_r004`) follow.

**Verification (all PASS):** import twice with no diff; `tsc` 0 errors;
`build` + `build:wasm`; `bun test` 256 pass / 0 fail / 0 skip;
`verify:g6:determinism` (4,742 files, 64,726,233 bytes), `verify:g6:locks`
(330 pages, 0 unresolved), `verify:g6:frozen` (0 permanent locks);
`verify:gb6:mainline` (109,983 frames, 100 battles, 22 trainers),
`verify:j1:mainline` (122,145 frames, 17 battles, 10 trainers),
`verify:j2:mainline` (172,060 frames, 56 battles, 50 trainers),
`verify:gb6:failures`, `verify:audio`; `bun run web` +
`verify-web-journey` (0 console errors, pixels match).

## Known gaps (carried from GM0)

- **G6** — `music_playing` is true while paused or in combat in Tuxemon;
  `bgmPlaying` is false there. Safe for the 196 `not music_playing` guards
  around `play_music` on map entry (BGM never paused, no combat active).
- **G2/G3** — fade-in and finite loop counts have no kit equivalent; no
  authored usage, so default-only loss.
- **G4/G5** — same-song no-op and crossfade on song change; the
  `not music_playing` guards cover 196/200 cases.
- **G7** — user volume preference has no kit global volume.
- The 13 non-mainline used tracks are state-tracked but silent (no asset).
- QOA playback in the static web player depends on the kit's streaming
  decoder and the player mounting the audio namespace; the desktop host has
  no audio module yet. Both are silent-by-design until those land.

## Subagent usage

None. This was a single-agent continuation: the parallelizable research
(usage scan, license audit, codec prototypes, mapping) was already done by
GM0's four subagents, and the remaining work was a serial chain of
import → verify → re-pin → measure → document that could not be usefully
split. The main agent ran all heavy commands (import, test, verifies,
QuickJS bench) serially per the protocol.

The forward merge to main b832794 was also single-agent: the critical path
is an inherently serial chain (merge → resolve → import → re-record →
gate), and the machine is memory-constrained, so journeys and builds ran
serially in the main agent. The one parallelizable bit — a clean b832794
checkout for the field-level state diff — ran as a temporary local worktree
the main agent drove itself, not a subagent.

PASS

---

## 修复 1 (2026-10-01)

Review task-2139 judged the GM1 integration FAIL on four blockers (B1–B4).
This section records the fixes, the main merge, and the post-merge gate.

### B1 — License corrections

Two attribution errors in `licenses/AUDIO-ATTRIBUTIONS.md`, both found by
re-checking every committed blob against the Tuxemon DB and the upstream
attribution file:

1. **`coinecho.wav`** was labeled "Click" / NenadSimic / CC0. The blob is
   `setting/coinecho.wav` (content-verified: identical decoded PCM,
   `b8e47304…`), which the upstream attribution file names
   "picked-coin-echo-2" by NenadSimic, **CC BY 3.0**. The CC0 "Click" is a
   different file (`interface/NenadSimic_Click.ogg`).
2. **`sound_confirm.wav`** was labeled "sf3-sfx-menu-select" / broumbroum /
   CC BY 3.0. The source `interface/confirm.ogg` entered Tuxemon in the
   2015 "Add Kelvin's sound pack" commit (41 pack files, `confirm.ogg` the
   only interface sound) and is acoustically unrelated to the broumbroum
   recording (0.568 s vs 0.337 s, waveform correlation ≈ 0.00). It is
   Kelvin Shadewing's work from his soundpack, **CC BY 3.0**.

Per-file re-verification (file → DB entry → upstream attribution → license):

| File | DB entry (slug → source) | Upstream attribution | License |
| --- | --- | --- | --- |
| `music/music_home.qoa` | music.yaml: `music_home` → `All of Us.ogg` | "All of Us" by Eric Skiff | CC-BY-SA 4.0 |
| `music/music_cathedral_theme.qoa` | music.yaml: `music_cathedral_theme` → `JRPG_royalCourt_loop.ogg` | JRPG Collection by Yubatake | CC BY 3.0 |
| `music/music_town_theme.qoa` | music.yaml: `music_town_theme` → `JRPG_town_loop.ogg` | JRPG Collection by Yubatake | CC BY 3.0 |
| `music/music_the_wild_places.qoa` | music.yaml: `music_the_wild_places` → `peasant_kingdom.ogg` | "Peasant Kingdom" by Spring | CC BY 3.0 |
| `music/music_city_park.qoa` | music.yaml: `music_city_park` → `back34.mp3` | "back34" by Tom Peter | CC-BY-SA 3.0 |
| `music/music_10_empire.qoa` | jrpg-ostr2.yaml: `music_10_empire` → `10 - The Empire.ogg` | Generic 8-bit JRPG Soundtrack by AVGVSTA | CC BY 3.0 |
| `music/music_07_town.qoa` | jrpg-ostr2.yaml: `music_07_town` → `07 - Town.ogg` | Generic 8-bit JRPG Soundtrack by AVGVSTA | CC BY 3.0 |
| `music/music_jester_theme.qoa` | music.yaml: `music_jester_theme` → `Jester Theme.mp3` | "Jester Theme" by Hydrogene | CC0 |
| `sounds/japanese_temple_bell_small.wav` | setting.yaml: `japanese_temple_bell_small` → `setting/japanese_temple_bell_small.mp3` | "Japanese Temple Bell Small" by Mike Koenig | CC BY 3.0 |
| `sounds/sound_confirm.wav` | interface.yaml: `sound_confirm` → `interface/confirm.ogg` | Kelvin Shadewing's Soundpacks | CC BY 3.0 |
| `sounds/coinecho.wav` | setting.yaml: `coinecho` → `setting/coinecho.wav` | "coinecho.wav" (picked-coin-echo-2) by NenadSimic | CC BY 3.0 |

All 11 committed blobs hash-match the manifest (files=11, bytes=7,207,422,
bad=[]). A new gate test (`tests/audio-attribution.test.ts`) pins every
file's work/artist/license against the attribution table, the upstream
attribution file, and the DB slug mapping; it fails on the old wrong rows
(verified by mutation: reverting the coinecho row makes it fail).

### B2 — fadeout_music semantics

Upstream `fadeout_music` clears `current_song` immediately, so
`music_playing` is false while the audible fade is still running. The kit
keeps `bgmPlaying` true until the fade completes, which let the
`37707_tower` parallel page (guarded by `is music_playing
music_mystic_island`) re-trigger `fadeoutBgm` every frame, pinning the fade
counter at 60 — the music never stopped.

Fix (game-repo only, no kit change): `fadeout_music` now sets a
`sys.music_fading` switch alongside `fadeoutBgm`; `play_music` clears it
(guarded, so the common no-fade case writes no state); the positive
`music_playing` condition excludes the fading window
(`bgmPlaying AND NOT sys.music_fading`). The negated form keeps its
historical mapping — no negated guard exists on the only fadeout map, and
the divergence is bounded by the fade duration.

Regression test (`tests/music-fadeout.test.ts`) drives the real imported
`37707_tower` page: after the fade starts the counter strictly decreases
(no re-trigger) and the BGM is gone after ~60 frames; a second cycle
proves `play_music` recovers the flag. Mutation-verified: the test fails
on the pre-fix importer (counter stuck at 60, BGM never removed).

### B3 — Verification tools

1. **`verify:audio`** now reads every committed blob in
   `assets/audio/{music,sounds}` and compares its byte count and SHA-256
   against the manifest (plus missing/extra detection), via the new
   `tools/audio-manifest.ts`. The old re-encode-only check could not notice
   a corrupted or swapped committed blob. Tests cover corruption,
   replacement, missing and extra blobs, plus an integration run on the
   real assets.
2. **`tools/gm1-audio-diff.ts`** rewritten: it takes `--baseline`
   (required) and `--current` (defaults to a journey replay), normalizes
   both states (drop `interp.audio`, canonicalize `e###_` char-id
   prefixes), and exits 1 when anything beyond audio differs. The old
   version compared against the journey's own golden (mislabeled
   "pre-GM1") and always exited 0. Tests cover the audio-only case, the
   char-prefix shift, extra-diff failure, and the CLI exit codes.
3. **`tools/bench-g6-quickjs.sh`** default expected state updated to the
   merged g6 terminal hash (`cf3d902a…`); `bench-gb6-quickjs.sh` already
   derives its hash from the journey file.

### Merge main

Merged game-repo main (D2 day/night runtime, chapter snapshots, warp
spawns). Conflicts were terminal-state hash pins and coverage numbers,
resolved by re-pinning against the merged importer. The kit submodule
pointer is unchanged (`dfbae47a`), so no wasm rebuild was needed from the
merge.

- `bun run import` twice: byte-identical.
- Journey terminal hashes re-pinned: GB6 mainline `80b067c7…`, J1
  `c8d9b88e…`, J2 `eb627a3d…`, first-loss `4e532690…`, later-loss
  `c6ba2339…`, g6 repository `cf3d902a…`. The tapes are unchanged; the
  deltas are the union of D2's daylight/clock state and GM1's sparse audio
  intent. B2's `sys.music_fading` adds nothing on the mainline (it never
  fades), confirmed by inspecting the terminal switches.
- Chapter snapshots re-baked (`tools/bake-chapters.ts`). Decoded field by
  field against the previous `data/chapters.json`, the snapshots differ in
  exactly three ways: each checksum; `/state/interp/audio/bgm` (GM1's music
  intent now lives in every save); and one touched-event id in
  `spyder_mansion` (`e012_captain_returns_r020` → `e013_…`), shifted by the
  inserted music event. `verify:chapters` passed when baked; at the time the
  baker still read the machine clock for thumbnails, which main has since
  fixed by pinning 09:00.
- Actor slot counts rose by one (the daylight parallel event): test_npcs
  503, maxActors 503, runtimeMaxActors 218.

### B4 — Docs

- `docs/importer.md`: the sparse checkout includes the eight music tracks
  and three SFX (not "excludes all music"); coverage table regenerated.
- `docs/architecture.md`: 52 test files; the audio pipeline section
  documents the `sys.music_fading` fadeout guard; the `verify:audio`
  blob-check claim is now true.
- `README.md` and `docs/status.md`: coverage regenerated (actions native
  90.5% / executable 95.2%, conditions 94.3% / 94.4%); the music/sound
  status rows restored to the GM1 Partial state with the fadeout fix
  noted (main's version was pre-GM1).
- `tools/bench-g6-quickjs.sh`: default hash updated.

### Cost (same machine, main versus this branch)

Measured during review: `main` (`29ad5a1`) and this branch, each re-imported
and built from source, run interleaved main → branch → branch → main with
`bench:g6:quickjs` (3,793 frames, 480×272) on one machine under load 9.7–15.

| Run | walking mean / p95 / max | map-switch mean / p95 / max | startup to first frame | CPU max (all) |
| --- | --- | --- | ---: | ---: |
| main 1 | 1.347 / 1.887 / 3.047 ms | 0.875 / 2.483 / 5.146 ms | 202.046 ms | 27.184 ms |
| branch 1 | 1.321 / 1.864 / 2.463 ms | 0.845 / 2.244 / 5.269 ms | 184.657 ms | 25.250 ms |
| branch 2 | 1.330 / 1.877 / 2.725 ms | 0.837 / 2.277 / 5.171 ms | 176.551 ms | 27.767 ms |
| main 2 | 1.260 / 1.769 / 2.412 ms | 0.827 / 2.258 / 5.159 ms | 167.219 ms | 25.390 ms |

Walking means 1.304 ms (main) and 1.326 ms (branch), within main's own run
to run spread; map switches 0.851 and 0.841 ms. No frame-time regression is
attributable to GM1. The Linux pak grows from 67,113,808 to 74,397,072
bytes (+7,283,264), of which the 11 audio files are 7,207,422 bytes.

On the full GB6 replay the budget is checked on thread CPU time
(`qjs_core_max_cpu`). A rerun on this branch passes with a 33.493 ms CPU
maximum (wall-clock maximum 57.493 ms); an earlier 74.4 ms wall-clock frame
was machine contention, not a regression.

The original "Cost" section above was measured before the forward merge
and is kept for history; this section supersedes it.

### Verification

| Check | Result |
| --- | --- |
| `bun run import` twice, no diff | PASS (byte-identical) |
| `bunx tsc --noEmit` | 0 errors |
| `bun run build` | PASS (pak 74,397,072 bytes) |
| `bun run build:wasm` | PASS (290,031 bytes, cached) |
| `bun run test` | 301 pass, 0 fail, 52 files |
| `verify:audio` | PASS (re-encode + committed blob hashes) |
| `verify:chapters` | PASS (13 chapters, byte-identical) |
| `verify:gb6:mainline` | PASS (109,983 frames, 100 battles, 22 trainers) |
| `verify:j1:mainline` | PASS (122,145 combined frames, 17 battles, 10 trainers) |
| `verify:j2:mainline` | PASS (172,060 combined frames, 56 battles, 50 trainers) |
| `verify:gb6:failures` | PASS (first-loss + later-loss paths) |
| `verify:g6:locks` | PASS (330 pages, 0 unresolved, 0 errors) |
| `verify:g6:determinism` | PASS (4,742 files, 66,969,683 bytes) |
| `verify:g6:frozen` | PASS (263 maps, 0 permanent locks) |
| `bench:g6:quickjs` (no override) | PASS (state `cf3d902a…`, budgets met) |
| `bun.lock` / `vendor/` | unchanged |

### Subagent usage

None. This was a serial fix-and-merge chain: each blocker depended on the
previous one's verification, and the heavy commands (import, full test
suite, journey verifies, chapter bake, QuickJS benches) had to run serially
per the protocol. The one parallelizable chunk — the B1 per-file audio
provenance check — was a quick set of ffmpeg/sha256 commands the main
agent ran directly.


PASS
