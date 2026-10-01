import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../importer/png.ts";
import { DEFAULT_TUXEMON_SRC } from "../importer/terrain.ts";
import { BATTLE_ASSET_PATHS } from "../ui/battle-assets.ts";
import { ANIMATED_INDEX, GAME_ASSETS, NPC_SRC_INDEX, PLAYER } from "../ui/game-assets.ts";
import type { AnimatedTile, NpcArt } from "../vendor/pocket-rpgkit/src/ui/game-assets.ts";

const ROOT = resolve(import.meta.dir, "..");
const report = JSON.parse(readFileSync(resolve(ROOT, "data/g6-assets-report.json"), "utf8"));
const images = JSON.parse(readFileSync(resolve(ROOT, "images.json"), "utf8")) as Record<string, { psm: number }>;
const sprites = JSON.parse(readFileSync(resolve(ROOT, "sprites.json"), "utf8")) as Record<
  string,
  { cols: number; rows: number; frames: number; step: number; psm: number }
>;

describe("G6 generated game assets", () => {
  test("cover every imported map, character, animation, and labelled collision body", () => {
    const appearances = Bun.YAML.parse(readFileSync(
      resolve(process.env.TUXEMON_SRC ?? DEFAULT_TUXEMON_SRC, "mods/tuxemon/db/npc/appearance_options.yaml"),
      "utf8",
    )) as { template: { sprite_name: string } }[];
    expect(report.project).toMatchObject({
      maps: 263,
      collisionBodies: 14,
      maxActors: 501,
      runtimeMaxActors: 205,
      excludedActorStressMaps: [{ id: "test_npcs", slots: 501 }],
      options: {
        areas: true,
        facing: true,
        condAll: true,
        localReset: true,
        place: true,
        inputLock: true,
        routes: true,
      },
    });
    expect(report.terrain).toMatchObject({ entries: 430, animatedPlacements: 5_785 });
    expect(report.animation).toMatchObject({ sourceSequences: 86, atlases: 86 });
    expect(report.characters).toMatchObject({
      spriteKeys: 175,
      walkers: 152,
      staticObjects: 22,
      placeholders: 1,
      imageFiles: 1_859,
      playerSheet: `sprites/${appearances[0]!.template.sprite_name}.png`,
    });
    expect(GAME_ASSETS.order).toHaveLength(263);
    expect(GAME_ASSETS.maxActors).toBe(205);
    expect(NPC_SRC_INDEX).toHaveLength(175);
    for (const { id, entry } of NPC_SRC_INDEX) {
      const art = JSON.parse(readFileSync(resolve(ROOT, "dist", entry), "utf8")) as NpcArt;
      expect(typeof art === "string" ? art.length > 0 : art.idle.length > 0, id).toBeTrue();
    }
    expect(ANIMATED_INDEX).toHaveLength(48);
    const animatedTotal = ANIMATED_INDEX.reduce((sum, { entry }) => {
      const tiles = JSON.parse(readFileSync(resolve(ROOT, "dist", entry), "utf8")) as AnimatedTile[];
      return sum + tiles.length;
    }, 0);
    expect(animatedTotal).toBe(5_785);
    expect(GAME_ASSETS.playerHeight).toBe(32);
  });

  test("sizes the actor pool from every event on every reachable map (KV1)", () => {
    // KV1's collectMapSlots reserves one actor slot per map event — runtime
    // appearance ops can give any event a sprite — so the baked pool must
    // cover the event count of every map a session can load. The test_*
    // stress fixtures stay exempt by design (see gen-assets.ts).
    const shell = JSON.parse(readFileSync(resolve(ROOT, "dist/project-shell.json"), "utf8")) as {
      mapIndex: Record<string, { id: string; entry: string }>;
    };
    let playableMax = 0;
    let testNpcsEvents = 0;
    for (const meta of Object.values(shell.mapIndex)) {
      const map = JSON.parse(readFileSync(resolve(ROOT, "dist", meta.entry), "utf8")) as {
        id: string;
        events?: unknown[];
      };
      const events = map.events?.length ?? 0;
      if (map.id === "test_npcs") {
        testNpcsEvents = events;
      } else if (!map.id.startsWith("test_")) {
        expect(events, `${map.id} needs ${events} actor slots`).toBeLessThanOrEqual(GAME_ASSETS.maxActors!);
        playableMax = Math.max(playableMax, events);
      }
    }
    // The pool is exactly the playable max: sprite-based counting would shrink
    // it below the real event counts, and dropping the test_* exemption would
    // inflate it to the fixture's 501.
    expect(playableMax).toBe(GAME_ASSETS.maxActors!);
    expect(testNpcsEvents, "test_npcs stays a real, exempted stress fixture").toBeGreaterThan(GAME_ASSETS.maxActors!);
  });

  test("all R2 character images are portable power-of-two RGBAs", () => {
    const battlePaths = new Set<string>(BATTLE_ASSET_PATHS);
    const characterImages = Object.entries(images).filter(([relative]) => !battlePaths.has(relative));
    expect(characterImages).toHaveLength(1_859);
    expect(Object.keys(images)).toHaveLength(1_859 + BATTLE_ASSET_PATHS.length);
    expect(BATTLE_ASSET_PATHS.every((relative) => images[relative]?.psm === 2)).toBeTrue();
    for (const [relative, meta] of characterImages) {
      const path = resolve(ROOT, relative);
      expect(existsSync(path), relative).toBeTrue();
      expect(meta.psm, relative).toBe(3);
      const image = decodePng(new Uint8Array(readFileSync(path)), path);
      expect(image.width & (image.width - 1), relative).toBe(0);
      expect(image.height & (image.height - 1), relative).toBe(0);
      expect(image.width, relative).toBeLessThanOrEqual(512);
      expect(image.height, relative).toBeLessThanOrEqual(512);
    }
    for (const group of [PLAYER.idle, PLAYER.walkL, PLAYER.walkR]) {
      expect(group).toHaveLength(4);
      for (const relative of group) {
        const image = decodePng(new Uint8Array(readFileSync(resolve(ROOT, relative))), relative);
        expect([image.width, image.height]).toEqual([16, 32]);
      }
    }
  }, 30_000);

  test("all R2 terrain animation atlases match their sprite metadata", () => {
    expect(Object.keys(sprites)).toHaveLength(86);
    for (const [relative, sprite] of Object.entries(sprites)) {
      const image = decodePng(new Uint8Array(readFileSync(resolve(ROOT, relative))), relative);
      expect(sprite.psm, relative).toBe(3);
      expect(sprite.rows, relative).toBe(1);
      expect(sprite.frames, relative).toBeGreaterThanOrEqual(2);
      expect(sprite.frames, relative).toBeLessThanOrEqual(sprite.cols);
      expect(sprite.step, relative).toBeGreaterThan(0);
      expect(image.width, relative).toBe(sprite.cols * 16);
      expect(image.height, relative).toBe(16);
    }
  });
});
