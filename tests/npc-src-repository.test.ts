import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createNpcSrcProvider } from "../ui/npc-src-repository.ts";
import { NPC_SRC_INDEX } from "../ui/game-assets.ts";

const ROOT = resolve(import.meta.dir, "..");

describe("GP1 lazy NPC sprite-frame repository", () => {
  test("has/ownKeys never read a shard; a keyed get reads exactly once and caches it", () => {
    const reads: string[] = [];
    const files = new Map(NPC_SRC_INDEX.map(({ entry }) => [entry, readFileSync(resolve(ROOT, "dist", entry))]));
    const provider = createNpcSrcProvider(NPC_SRC_INDEX, {
      read(entry) {
        reads.push(entry);
        return files.get(entry);
      },
    });
    const [{ id, entry }] = NPC_SRC_INDEX;

    expect(id in provider).toBeTrue();
    expect("no_such_npc_id" in provider).toBeFalse();
    expect(Reflect.ownKeys(provider)).toHaveLength(NPC_SRC_INDEX.length);
    expect(reads).toEqual([]);

    const first = provider[id];
    expect(reads).toEqual([entry]);
    expect(first).toBeDefined();

    const second = provider[id];
    expect(reads).toEqual([entry]);
    expect(second).toBe(first);
  });

  test("an unindexed NPC id resolves to undefined without a read", () => {
    const reads: string[] = [];
    const provider = createNpcSrcProvider(NPC_SRC_INDEX, {
      read(entry) {
        reads.push(entry);
        return undefined;
      },
    });
    expect(provider["no_such_npc_id"]).toBeUndefined();
    expect(reads).toEqual([]);
  });

  test("every indexed NPC's resolved art equals its shard file, parsed directly", () => {
    const provider = createNpcSrcProvider(NPC_SRC_INDEX, {
      read: (entry) => readFileSync(resolve(ROOT, "dist", entry)),
    });
    for (const { id, entry } of NPC_SRC_INDEX) {
      const oracle = JSON.parse(readFileSync(resolve(ROOT, "dist", entry), "utf8"));
      expect(provider[id]).toEqual(oracle);
    }
  });
});
