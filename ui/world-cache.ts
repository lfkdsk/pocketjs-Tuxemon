import type { MapDef, WorldLayout } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import type { WorldCacheStats } from "../vendor/pocket-rpgkit/src/ui/world-cache-driver.ts";
import type { AnimatedTile, NpcArt, StreamedGameAssets } from "../vendor/pocket-rpgkit/src/ui/game-assets.ts";
import {
  lazyEntryStats,
  releaseLazyEntries,
  type LazyEntryStats,
} from "./lazy-entry-table.ts";

export interface GameWorldAssetProviders {
  stream: StreamedGameAssets;
  animated: Readonly<Record<string, readonly AnimatedTile[]>>;
  npcSrc: Readonly<Record<string, NpcArt>>;
}

export interface GameWorldAssetStats {
  ground: LazyEntryStats;
  upper: LazyEntryStats;
  animated: LazyEntryStats;
  npcSrc: LazyEntryStats;
}

export interface GameWorldCacheSnapshot {
  driver: WorldCacheStats;
  /** Renderer margin-expanded map ids retained by terrain/animation shards. */
  visualKeep: readonly string[];
  /** Sprite ids reachable from every page on the active map. */
  npcKeep: readonly string[];
  assets: GameWorldAssetStats;
}

export interface GameWorldAssetCache {
  /** Publish session-layer stats after the driver's outdoor sync. */
  onWorldCacheStats(stats: WorldCacheStats): void;
  /** Apply the renderer's margin-expanded visible set to immutable shards. */
  onVisibleMaps(mapIds: readonly string[]): void;
  /** Apply the active-map policy to NPC art and to every unplaced map. */
  onMapChange(mapId: string, map: MapDef): void;
  stats(): GameWorldAssetStats;
}

/** Stable, duplicate-free sprite ids that any page on this map may paint. */
export function npcArtKeepSet(map: Readonly<MapDef>): string[] {
  const keep = new Set<string>();
  for (const event of map.events ?? []) {
    for (const page of event.pages) {
      if (page.sprite) keep.add(page.sprite);
    }
  }
  return [...keep].sort();
}

/**
 * Bind the game's lazy render shards to the kit's world working set.
 *
 * - terrain and authored animated tiles follow the visible-map set;
 * - NPC art follows the authoritative active map (neighbour NPC preview is
 *   deliberately outside this phase);
 * - an unplaced map uses the legacy one-map keep-set.
 *
 * The mutable simulation remains owned by GameView/Session. This object only
 * releases reconstructible JSON shards and therefore cannot affect reducer
 * state or transfer timing.
 */
export function createGameWorldAssetCache(
  layout: Readonly<WorldLayout>,
  providers: GameWorldAssetProviders,
  onStats?: (stats: GameWorldCacheSnapshot) => void,
): GameWorldAssetCache {
  const placed = new Set(layout.components.flatMap((component) =>
    component.placements.map((placement) => placement.mapId)
  ));

  const stats = (): GameWorldAssetStats => ({
    ground: lazyEntryStats(providers.stream.ground),
    upper: lazyEntryStats(providers.stream.upper),
    animated: lazyEntryStats(providers.animated),
    npcSrc: lazyEntryStats(providers.npcSrc),
  });
  let lastDriver: WorldCacheStats | undefined;
  let visualKeep: readonly string[] = [];
  let npcKeep: readonly string[] = [];

  const report = (): void => {
    if (lastDriver) onStats?.({ driver: lastDriver, visualKeep, npcKeep, assets: stats() });
  };

  return {
    onWorldCacheStats(driver) {
      lastDriver = driver;
      report();
    },
    onVisibleMaps(mapIds) {
      // The renderer expands its query by the terrain margin. Using its
      // visible set avoids evict/re-read thrash for a placement just outside
      // the driver's unexpanded camera rectangle.
      visualKeep = [...new Set(mapIds)];
      releaseLazyEntries(providers.stream.ground, visualKeep);
      releaseLazyEntries(providers.stream.upper, visualKeep);
      releaseLazyEntries(providers.animated, visualKeep);
      report();
    },
    onMapChange(mapId, map) {
      npcKeep = npcArtKeepSet(map);
      releaseLazyEntries(providers.npcSrc, npcKeep);
      if (placed.has(mapId)) return;
      // The world driver intentionally emits no outdoor stats for an
      // unplaced map. Collapse visual shards here to the legacy fast path.
      visualKeep = [mapId];
      releaseLazyEntries(providers.stream.ground, visualKeep);
      releaseLazyEntries(providers.stream.upper, visualKeep);
      releaseLazyEntries(providers.animated, visualKeep);
      report();
    },
    stats,
  };
}
