import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../importer/png.ts";
import { ANIMATED, GAME_ASSETS, NPC_SRC, PLAYER } from "../ui/game-assets.ts";

const ROOT = resolve(import.meta.dir, "..");
const report = JSON.parse(readFileSync(resolve(ROOT, "data/g6-assets-report.json"), "utf8"));
const images = JSON.parse(readFileSync(resolve(ROOT, "images.json"), "utf8")) as Record<string, { psm: number }>;
const sprites = JSON.parse(readFileSync(resolve(ROOT, "sprites.json"), "utf8")) as Record<
  string,
  { cols: number; rows: number; frames: number; step: number; psm: number }
>;

describe("G6 generated game assets", () => {
  test("cover every imported map, character, animation, and labelled collision body", () => {
    expect(report.project).toMatchObject({
      maps: 263,
      collisionBodies: 14,
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
    });
    expect(GAME_ASSETS.order).toHaveLength(263);
    expect(Object.keys(NPC_SRC)).toHaveLength(175);
    expect(Object.values(ANIMATED).reduce((sum, placements) => sum + placements.length, 0)).toBe(5_785);
    expect(GAME_ASSETS.playerHeight).toBe(32);
  });

  test("all R2 character images are portable power-of-two RGBAs", () => {
    expect(Object.keys(images)).toHaveLength(1_859);
    for (const [relative, meta] of Object.entries(images)) {
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
