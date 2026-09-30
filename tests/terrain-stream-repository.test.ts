import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createTerrainStreamProvider } from "../ui/terrain-stream-repository.ts";
import {
  TERRAIN_STREAM_META,
  TERRAIN_STREAM_GROUND_INDEX,
  TERRAIN_STREAM_UPPER_INDEX,
} from "../ui/terrain-assets.ts";

const ROOT = resolve(import.meta.dir, "..");

describe("GP1 lazy terrain-stream repository", () => {
  test("has/ownKeys never read a shard; a keyed get reads exactly once and caches it, for both layers", () => {
    for (const index of [TERRAIN_STREAM_GROUND_INDEX, TERRAIN_STREAM_UPPER_INDEX]) {
      const reads: string[] = [];
      const files = new Map(index.map(({ entry }) => [entry, readFileSync(resolve(ROOT, "dist", entry))]));
      const provider = createTerrainStreamProvider(TERRAIN_STREAM_META, index, index, {
        read(entry) {
          reads.push(entry);
          return files.get(entry);
        },
      });
      const [{ id, entry }] = index;

      expect(id in provider.ground).toBeTrue();
      expect("no_such_map_id" in provider.ground).toBeFalse();
      expect(Reflect.ownKeys(provider.ground)).toHaveLength(index.length);
      expect(reads).toEqual([]);

      const first = provider.ground[id];
      expect(reads).toEqual([entry]);
      expect(first).toBeDefined();

      const second = provider.ground[id];
      expect(reads).toEqual([entry]);
      expect(second).toBe(first);
    }
  });

  test("an unindexed map id resolves to undefined without a read", () => {
    const reads: string[] = [];
    const provider = createTerrainStreamProvider(
      TERRAIN_STREAM_META,
      TERRAIN_STREAM_GROUND_INDEX,
      TERRAIN_STREAM_UPPER_INDEX,
      {
        read(entry) {
          reads.push(entry);
          return undefined;
        },
      },
    );
    expect(provider.ground["no_such_map_id"]).toBeUndefined();
    expect(provider.upper["no_such_map_id"]).toBeUndefined();
    expect(reads).toEqual([]);
  });

  test("every indexed map's resolved refs equal its shard file, parsed directly, for both layers", () => {
    const provider = createTerrainStreamProvider(
      TERRAIN_STREAM_META,
      TERRAIN_STREAM_GROUND_INDEX,
      TERRAIN_STREAM_UPPER_INDEX,
      { read: (entry) => readFileSync(resolve(ROOT, "dist", entry)) },
    );
    for (const { id, entry } of TERRAIN_STREAM_GROUND_INDEX) {
      const oracle = JSON.parse(readFileSync(resolve(ROOT, "dist", entry), "utf8"));
      expect(provider.ground[id]).toEqual(oracle);
    }
    for (const { id, entry } of TERRAIN_STREAM_UPPER_INDEX) {
      const oracle = JSON.parse(readFileSync(resolve(ROOT, "dist", entry), "utf8"));
      expect(provider.upper[id]).toEqual(oracle);
    }
  });

  test("chunkPx/columns meta pass through unchanged", () => {
    const provider = createTerrainStreamProvider(
      TERRAIN_STREAM_META,
      TERRAIN_STREAM_GROUND_INDEX,
      TERRAIN_STREAM_UPPER_INDEX,
      { read: (entry) => readFileSync(resolve(ROOT, "dist", entry)) },
    );
    expect(provider.chunkPx).toBe(TERRAIN_STREAM_META.chunkPx);
    expect(provider.columns).toBe(TERRAIN_STREAM_META.columns);
  });
});
