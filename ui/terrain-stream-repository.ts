// GP1 fix 1: lazy, per-map ground/upper chunk-ref tables. ui/terrain-assets.ts
// carries only TERRAIN_STREAM_META (chunkPx + columns, both small) and the
// GROUND/UPPER index tables (map id -> pak/data.fs entry); lazyEntryTable
// resolves and caches each map's chunk-ref list on first read.
// StreamedChunkLayer and OccludingUpperLayer only ever read
// `refs[mapId]`/`stream.upper[mapId]` for the current map (one keyed
// property get per map switch, never an enumeration), so a session only
// ever parses the ground/upper shards for maps it actually visits.
import { lazyEntryTable, type LazyEntrySource } from "./lazy-entry-table.ts";
import type { StreamedGameAssets } from "../vendor/pocket-rpgkit/src/ui/game-assets.ts";
import type { StreamRefIndexEntry, TerrainStreamMeta } from "../importer/terrain.ts";

export type { StreamRefIndexEntry };
export type TerrainStreamEntrySource = LazyEntrySource;

export function createTerrainStreamProvider(
  meta: TerrainStreamMeta,
  groundIndex: readonly StreamRefIndexEntry[],
  upperIndex: readonly StreamRefIndexEntry[],
  source: TerrainStreamEntrySource,
): StreamedGameAssets {
  return {
    chunkPx: meta.chunkPx,
    columns: meta.columns,
    ground: lazyEntryTable<readonly (string | null)[]>(groundIndex, source, "terrain-stream-ground"),
    upper: lazyEntryTable<readonly (string | null)[]>(upperIndex, source, "terrain-stream-upper"),
  };
}
