// GP1: NPC_SRC_ASSET_PATHS and ANIMATED_ATLAS_NAMES (ui/npc-src-assets.ts,
// ui/animated-assets.ts) exist solely to keep PocketJS's pass-1 literal
// scanner reachable to every texture a lazily-loaded shard can name — see
// gen-assets.ts's comments next to where each list is written. A stale or
// hand-edited list would silently drop a texture from the built pak with no
// other gate catching it. These tests reconstruct the referenced-path sets
// straight from the committed dist/ shards — independently of
// NPC_SRC_INDEX/ANIMATED_INDEX and of gen-assets.ts's own in-memory
// generation — and assert Set equality against the committed lists, with no
// hardcoded counts.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { collectAnimatedAtlasNames } from "../importer/animated.ts";
import { collectNpcSrcAssetPaths } from "../importer/npc-src.ts";
import { collectStreamRefKeys } from "../importer/terrain.ts";
import { ANIMATED_ATLAS_NAMES } from "../ui/animated-assets.ts";
import { NPC_SRC_ASSET_PATHS } from "../ui/npc-src-assets.ts";
import type { AnimatedTile, NpcArt } from "../vendor/pocket-rpgkit/src/ui/game-assets.ts";

const ROOT = resolve(import.meta.dir, "..");

function jsonFiles(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `${dir}/${name}`);
}

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, relative), "utf8")) as T;
}

describe("GP1 keepalive manifests (bidirectional)", () => {
  test("NPC_SRC_ASSET_PATHS matches every path referenced by dist/npc-src/*.json", () => {
    const shardFiles = jsonFiles("dist/npc-src");
    expect(shardFiles.length).toBeGreaterThan(0);
    const referenced = new Set<string>();
    for (const file of shardFiles) {
      const art = readJson<NpcArt>(file);
      for (const path of collectNpcSrcAssetPaths(art)) referenced.add(path);
    }
    const listed = new Set<string>(NPC_SRC_ASSET_PATHS);
    const missing = [...referenced].filter((path) => !listed.has(path)).sort();
    const extra = [...listed].filter((path) => !referenced.has(path)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    for (const path of referenced) {
      expect(existsSync(resolve(ROOT, path)), path).toBeTrue();
    }
  });

  test("ANIMATED_ATLAS_NAMES matches every atlas referenced by dist/animated/*.json", () => {
    const shardFiles = jsonFiles("dist/animated");
    expect(shardFiles.length).toBeGreaterThan(0);
    const referenced = new Set<string>();
    for (const file of shardFiles) {
      const tiles = readJson<AnimatedTile[]>(file);
      for (const name of collectAnimatedAtlasNames(tiles)) referenced.add(name);
    }
    const listed = new Set<string>(ANIMATED_ATLAS_NAMES);
    const missing = [...referenced].filter((name) => !listed.has(name)).sort();
    const extra = [...listed].filter((name) => !referenced.has(name)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    for (const name of referenced) {
      expect(existsSync(resolve(ROOT, name)), name).toBeTrue();
    }
  });

  test("terrain-stream ground/upper shard refs resolve to real pak.json TILESET entries", () => {
    const shardFiles = [...jsonFiles("dist/terrain-stream/ground"), ...jsonFiles("dist/terrain-stream/upper")];
    expect(shardFiles.length).toBeGreaterThan(0);
    const referenced = new Set<string>();
    for (const file of shardFiles) {
      const refs = readJson<(string | null)[]>(file);
      for (const key of collectStreamRefKeys(refs)) referenced.add(key);
    }
    const pak = readJson<{ key: string; file: string }[]>("pak.json");
    const tileEntries = new Map(pak
      .filter((entry) => entry.file.startsWith("assets/stream/"))
      .map((entry) => [entry.key, entry.file]));
    expect([...tileEntries.keys()].every((key) => key.startsWith("ui:tile."))).toBeTrue();
    const listed = new Set(tileEntries.keys());
    const missing = [...referenced].filter((key) => !listed.has(key)).sort();
    const extra = [...listed].filter((key) => !referenced.has(key)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    for (const key of referenced) {
      expect(existsSync(resolve(ROOT, tileEntries.get(key)!)), key).toBeTrue();
    }
  });
});
