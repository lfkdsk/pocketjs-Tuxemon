// GP1 fix 1: lazy, per-map animated-tile table. ui/game-assets.ts carries
// only ANIMATED_INDEX (map id -> pak/data.fs entry); lazyEntryTable resolves
// and caches each map's placement list on first read. AnimatedTiles and
// OccludingUpperLayer only ever read `tiles[mapId]` for the current map (one
// keyed property get per map switch, never an enumeration), so a session
// only ever parses the animated-tile shards for maps it actually visits.
import { lazyEntryTable, type LazyEntrySource } from "./lazy-entry-table.ts";
import type { AnimatedTile } from "../vendor/pocket-rpgkit/src/ui/game-assets.ts";
import type { AnimatedIndexEntry } from "../importer/animated.ts";

export type { AnimatedIndexEntry };
export type AnimatedEntrySource = LazyEntrySource;

export function createAnimatedProvider(
  index: readonly AnimatedIndexEntry[],
  source: AnimatedEntrySource,
): Readonly<Record<string, readonly AnimatedTile[]>> {
  return lazyEntryTable<readonly AnimatedTile[]>(index, source, "animated");
}
