import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAnimatedProvider } from "../ui/animated-repository.ts";
import { ANIMATED_INDEX } from "../ui/game-assets.ts";

const ROOT = resolve(import.meta.dir, "..");

describe("GP1 lazy animated-tile repository", () => {
  test("has/ownKeys never read a shard; a keyed get reads exactly once and caches it", () => {
    const reads: string[] = [];
    const files = new Map(ANIMATED_INDEX.map(({ entry }) => [entry, readFileSync(resolve(ROOT, "dist", entry))]));
    const provider = createAnimatedProvider(ANIMATED_INDEX, {
      read(entry) {
        reads.push(entry);
        return files.get(entry);
      },
    });
    const [{ id, entry }] = ANIMATED_INDEX;

    expect(id in provider).toBeTrue();
    expect("no_such_map_id" in provider).toBeFalse();
    // Reflect.ownKeys reads the index alone; Object.keys additionally probes
    // every key's property descriptor (to check enumerability), which is
    // documented cost — same as battle-repository.ts's lazyShardTable.
    expect(Reflect.ownKeys(provider)).toHaveLength(ANIMATED_INDEX.length);
    expect(reads).toEqual([]);

    const first = provider[id];
    expect(reads).toEqual([entry]);
    expect(first).toBeDefined();

    const second = provider[id];
    expect(reads).toEqual([entry]);
    expect(second).toBe(first);
  });

  test("an unindexed map id resolves to undefined without a read", () => {
    const reads: string[] = [];
    const provider = createAnimatedProvider(ANIMATED_INDEX, {
      read(entry) {
        reads.push(entry);
        return undefined;
      },
    });
    expect(provider["no_such_map_id"]).toBeUndefined();
    expect(reads).toEqual([]);
  });

  test("every indexed map's resolved tiles equal its shard file, parsed directly", () => {
    const provider = createAnimatedProvider(ANIMATED_INDEX, {
      read: (entry) => readFileSync(resolve(ROOT, "dist", entry)),
    });
    for (const { id, entry } of ANIMATED_INDEX) {
      const oracle = JSON.parse(readFileSync(resolve(ROOT, "dist", entry), "utf8"));
      expect(provider[id]).toEqual(oracle);
    }
  });
});
