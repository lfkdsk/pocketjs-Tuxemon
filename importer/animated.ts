// GameAssets.animated used to bundle every map's animated-tile placements as
// one eager object literal — 5,785 placements across 48 maps, the single
// largest input in the desktop bundle at ui/game-assets.ts. AnimatedTiles/OccludingUpperLayer only ever
// read `tiles[mapId]` for the currently-loaded map (one keyed property get,
// never an enumeration), so this splits the table the same way
// splitBattleRuntimeDb splits species/techniques: one canonical entry per
// map id, addressed by an index small enough to stay inline in
// ui/game-assets.ts.
import type { AnimatedMapTiles } from "../vendor/pocket-rpgkit/tools/lib/animated.ts";

export interface AnimatedIndexEntry {
  id: string;
  entry: string;
}

export interface AnimatedSplitEntry {
  path: string;
  bytes: Uint8Array;
  meta: AnimatedIndexEntry;
}

export interface AnimatedSplit {
  index: readonly AnimatedIndexEntry[];
  entries: readonly AnimatedSplitEntry[];
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 1) + "\n");
}

/** GP1 fix 2: the atlas names an animated-tile shard's placements reference,
 *  for cross-checking against ANIMATED_ATLAS_NAMES (ui/animated-assets.ts) —
 *  the literal list that keeps PocketJS's pass-1 scanner baking every atlas
 *  named here into the app pak. */
export function collectAnimatedAtlasNames(tiles: readonly { sprite: string }[]): readonly string[] {
  return tiles.map((tile) => tile.sprite);
}

export function splitAnimatedTiles(maps: readonly AnimatedMapTiles[]): AnimatedSplit {
  const index: AnimatedIndexEntry[] = [];
  const entries: AnimatedSplitEntry[] = [];
  const withTiles = [...maps]
    .filter((map) => map.tiles.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const map of withTiles) {
    const path = `animated/${map.id}.json`;
    const meta: AnimatedIndexEntry = { id: map.id, entry: path };
    index.push(meta);
    entries.push({ path, bytes: jsonBytes(map.tiles), meta });
  }
  return { index, entries };
}
