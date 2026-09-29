# Pocket Tuxemon

[Tuxemon](https://github.com/Tuxemon/Tuxemon)'s world — its maps, events,
characters and dialogue — imported into
[Pocket RPG Kit](https://github.com/lfkdsk/pocket-rpgkit) and played on
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
  campaign plays from the bedroom through Paper Town to Route 1, and every
  imported input lock is executed to its unlock. Battles are still a
  placeholder that the player wins.
- **Battles (P2, in progress):** the battle database and 511 battle
  textures are imported from Tuxemon's YAML, and `battle/` is a pure
  reducer whose results match Tuxemon's own Python engine on 8,560 recorded
  battles. Wiring it into the events and a battle screen is next.
- **Performance:** maps load one at a time from the pak — the game JS is
  1.1 MB and reaches its first frame in about 175 ms on the desktop QuickJS
  host; walking stays near 1 ms per frame and map transfers under 15 ms.

## Screenshots

The world renders pixel-for-pixel like Tuxemon's own maps. Left: this
runtime; right: an independent render of the same Tuxemon TMX map, used as
the reference in the terrain tests (0 differing pixels).

![Taba Town: runtime and reference](docs/screenshots/taba-town-runtime-vs-reference.png)

Battle art imported from Tuxemon (a static preview composed from the
generated textures; the in-game battle screen is not wired up yet):

![Battle art preview](docs/screenshots/battle-art-preview.png)

## Running

```sh
bun run setup           # submodules + dependencies
bun run fetch:tuxemon   # pinned Tuxemon checkout
bun run import          # Tuxemon -> project, maps, art and battle data
bun run desktop         # play on the desktop host
bun run web             # build the web version into dist/web
bun test                # tests (build first for the pixel replays)
```

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
