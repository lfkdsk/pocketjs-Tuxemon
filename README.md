# Pocket Tuxemon

[Tuxemon](https://github.com/Tuxemon/Tuxemon)'s world — its maps, events,
characters and dialogue — imported into
[Pocket RPG Kit](https://github.com/lfkdsk/pocketjs-rpgkit) and played on
[PocketJS](https://github.com/pocket-nexus/pocketjs) (desktop, web, PSP).

Work in progress. The importer reads a pinned Tuxemon checkout
(`bun run fetch:tuxemon`, commit `9e6258ff`) and writes
`rpgkit-project/v1` documents and baked art into this repository.

<p align="center">
  <img src="docs/screenshots/paper-town.png" width="480" alt="Paper Town, imported from Tuxemon and running on Pocket RPG Kit">
  <img src="docs/screenshots/route-1.png" width="480" alt="Route 1">
</p>

## Status

- **World (P1, playable):** all 263 Tuxemon maps and their 4,572 events are
  imported automatically — terrain with one-way ledges, animated tiles, tall
  NPC walkers, dialogue, cutscene routes and map transfers. The Spyder
  campaign plays from the bedroom through Paper Town, Cotton Town and City
  Park to the north end of Route 3 (final position `spyder_route3 @4,6`),
  driven by a deterministic autoplay tape, and every imported input lock is
  executed to its unlock.
- **Battles (P2, complete):** the battle database and 578 battle
  textures are imported from Tuxemon's YAML, and `battle/` is a pure
  reducer whose results match Tuxemon's own Python engine on 8,560 recorded
  battles; monsters spawn draw-for-draw like Tuxemon's. The mainline is
  played for real end to end: the autoplay tape fights 100 real battles
  along the way (22 trainer battles + 78 wild), and every trainer battle
  enters Battle Processing and ends `won` with its `battle_outcome` written
  back. The frozen 30-minute 60 Hz tape (109,983 frames / 30 min 33 s)
  replays byte-identical at 60, 30 and 20 Hz, and both failure paths are
  verified — the first loss against Billie, and a later loss on Route 3
  with the faint-point teleport, the heal-before-leaving block and the
  nurse recovery. Double battles, capture, items, swapping and levelling
  are live. The battle scene uses the imported Tuxemon backgrounds,
  islands, trainers, monsters, HUD frames, status/party icons and
  technique strips; every slide, hit, HP/XP tween, faint and capture shake
  is driven by the reducer's rewindable reference tick rather than a wall
  clock.
- **Performance:** maps load one at a time from the pak — the game JS is
  1.1 MB and reaches its first frame in about 150 ms on the desktop QuickJS
  host (measured medians: 151.897 ms at 480×272 and 155.168 ms at 960×544,
  10-run samples); walking stays near 1 ms per frame and map transfers
  under 16 ms.

## Screenshots

The world renders pixel-for-pixel like Tuxemon's own maps. Left: this
runtime; right: an independent render of the same Tuxemon TMX map, used as
the reference in the terrain tests (0 differing pixels).

![Taba Town: runtime and reference](docs/screenshots/taba-town-runtime-vs-reference.png)

The first trainer battle, played for real: Billie's Budaye against Nut,
with sprites, HUD and backgrounds imported from Tuxemon and the rules
running bit-exact with Tuxemon's own engine. The lower band is Pocket RPG
Kit's state-driven command/list UI; the screenshot is a nearest-neighbour
2× capture of its 480×272 logical scene.

<p align="center">
  <img src="docs/screenshots/battle.png" width="480" alt="The first trainer battle">
</p>

The mainline journey, played by the deterministic autoplay tape: Cotton Town
(left) and the north end of Route 3 (right), the northernmost point of the
current journey.

<p align="center">
  <img src="docs/screenshots/cotton-town.png" width="480" alt="Cotton Town, a frame from the autoplay journey">
  <img src="docs/screenshots/route-3-end.png" width="480" alt="The north end of Route 3, a frame from the autoplay journey">
</p>

## Play it

- **In a browser:** <https://lfkdsk.github.io/pocketjs-tuxemon/pocket-tuxemon/>
  (deployed from `main` after CI has played the whole journey on it).
- **From a CI run:** every push builds the web version. Open the
  latest [CI run](../../actions/workflows/ci.yml), download the `web-site`
  artifact, unzip it and serve the folder, e.g.
  `python3 -m http.server -d web-site 8000`, then open
  <http://localhost:8000/pocket-tuxemon/>.
- **Locally:** `bun run web`, then serve `dist/web` the same way; or
  `bun run desktop` for the desktop host.
- **Keys:** arrows walk, `A`/`Z`/`Enter` talks and confirms, `B`/`Esc` goes back.

CI also plays the whole maintained journey — bedroom, Paper Town, the first
battle, Route 1 — in headless Chrome against the built site
(`bun tools/verify-web-journey.ts`) and checks every checkpoint's state and
pixels against the goldens.

## Running

```sh
bun run setup           # submodules + dependencies
bun run fetch:tuxemon   # pinned Tuxemon checkout
bun run import          # Tuxemon -> project, maps, art and battle data
bun run desktop         # play on the desktop host
bun run web             # build the web version into dist/web
bun test                # tests (build first for the pixel replays)
```

The importer reads the Tuxemon source from the repo-local `.tuxemon-src`
checkout that `bun run fetch:tuxemon` creates. To reuse an existing Tuxemon
checkout instead, set `TUXEMON_SRC` to its path (e.g.
`TUXEMON_SRC=/path/to/Tuxemon bun run import`).

## License

Tuxemon's code is GPL-3.0-or-later and its art CC BY-SA; this port and
everything it derives from Tuxemon are distributed under the same terms.
Pocket RPG Kit (vendored at `vendor/pocket-rpgkit`) is MIT.

The full GPL-3.0 text is in [`LICENSE`](LICENSE). Tuxemon's per-asset credits
and licenses (for the maps, sprites, tilesets, battle art and dialogue this
repository imports) are copied verbatim from Tuxemon `9e6258ff` into
[`licenses/TUXEMON-ATTRIBUTIONS.md`](licenses/TUXEMON-ATTRIBUTIONS.md), with its
contributor list in
[`licenses/TUXEMON-CONTRIBUTORS.md`](licenses/TUXEMON-CONTRIBUTORS.md).
