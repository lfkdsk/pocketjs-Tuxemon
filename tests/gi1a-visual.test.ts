import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { decodePng } from "../importer/png.ts";
import {
  captureGi1aVisuals,
  GI1A_VISUAL_FILES,
  GI1A_VISUAL_HEIGHT,
  GI1A_VISUAL_WIDTH,
  type Gi1aVisualCapture,
} from "../tools/gi1a-visual-fixture.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const WASM = join(ROOT, "vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/pocketjs.wasm");
const canBoot = existsSync(BUNDLE + ".js") && existsSync(BUNDLE + ".pak") && existsSync(WASM);
if (!canBoot) console.warn("GI1a production visual tests skipped; run `bun run build && bun run build:wasm`");
const simTest = canBoot ? test : test.skip;

function rgbaAt(rgba: Uint8Array, x: number, y: number): number[] {
  const offset = (y * GI1A_VISUAL_WIDTH + x) * 4;
  return [...rgba.subarray(offset, offset + 4)];
}

function changedPixels(
  before: Uint8Array,
  after: Uint8Array,
  inside?: { x: number; y: number; w: number; h: number },
): { inside: number; outside: number } {
  let inner = 0;
  let outer = 0;
  for (let y = 0; y < GI1A_VISUAL_HEIGHT; y++) for (let x = 0; x < GI1A_VISUAL_WIDTH; x++) {
    const offset = (y * GI1A_VISUAL_WIDTH + x) * 4;
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      if (before[offset + channel] !== after[offset + channel]) changed = true;
    }
    if (!changed) continue;
    if (inside && x >= inside.x && y >= inside.y && x < inside.x + inside.w && y < inside.y + inside.h) inner++;
    else outer++;
  }
  return { inside: inner, outside: outer };
}

function expectGolden(name: keyof typeof GI1A_VISUAL_FILES, actual: Uint8Array): void {
  const path = join(ROOT, "tests/goldens", GI1A_VISUAL_FILES[name]);
  const image = decodePng(new Uint8Array(readFileSync(path)), path);
  expect([image.width, image.height], name).toEqual([GI1A_VISUAL_WIDTH, GI1A_VISUAL_HEIGHT]);
  expect(actual, name).toEqual(image.rgba);
}

function expectOpaqueSourceAt(
  frame: Uint8Array,
  sourcePath: string,
  x0: number,
  y0: number,
): number {
  const source = decodePng(new Uint8Array(readFileSync(sourcePath)), sourcePath);
  let opaque = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const sourceOffset = (y * source.width + x) * 4;
    if (source.rgba[sourceOffset + 3] !== 255) continue;
    opaque++;
    expect(
      rgbaAt(frame, x0 + x, y0 + y),
      `${sourcePath} opaque pixel ${x},${y}`,
    ).toEqual([...source.rgba.subarray(sourceOffset, sourceOffset + 4)]);
  }
  return opaque;
}

describe("GI1a imported production visuals", () => {
  let capture: Gi1aVisualCapture;

  simTest("renders appearance, map animation, and fade with semantic pixels", async () => {
    capture = await captureGi1aVisuals();

    expect(capture.sources.appearance).toMatchObject({
      op: "appearance",
      target: "player",
      sprite: "adventurer",
      saveDefault: true,
    });
    expect(capture.appearanceState).toMatchObject({
      map: "spyder_bedroom",
      player: [3, 4],
      pixel: [48, 64],
      camera: [0, 0],
      sprite: "adventurer",
    });
    // The 9x7 room is centred in 480x272. A 16x32 walker is anchored one
    // tile above its 48,64 world pixel, so the imported dynamic appearance
    // must match every opaque source pixel at (216,128).
    const appearanceOpaque = expectOpaqueSourceAt(
      capture.appearance,
      join(ROOT, "assets/characters/npc-adventurer-idle-0.png"),
      216,
      128,
    );
    expect(appearanceOpaque).toBeGreaterThan(80);
    expectGolden("appearance", capture.appearance);

    expect(capture.sources.mapAnimation).toMatchObject({
      op: "mapAnim",
      id: "tux_map_grass",
      anim: "tux_grass_100000us",
      target: "player",
      follow: false,
      layer: "above",
      loop: false,
    });
    expect(capture.mapAnimationState).toMatchObject({
      id: "tux_map_grass",
      anim: "tux_grass_100000us",
      x: 3,
      y: 4,
      target: null,
      layer: "above",
      loop: false,
    });
    // The first grass frame is an above-character 16x16 tile at the live
    // player cell. No pixel outside that tile may change on this idle map.
    const animationBox = { x: 216, y: 144, w: 16, h: 16 };
    const delta = changedPixels(capture.mapAnimationBase, capture.mapAnimation, animationBox);
    expect(delta.inside).toBe(28);
    expect(delta.outside).toBe(0);
    const animationOpaque = expectOpaqueSourceAt(
      capture.mapAnimation,
      join(ROOT, "assets/map-animations/tux_grass_100000us-0.png"),
      animationBox.x,
      animationBox.y,
    );
    expect(animationOpaque).toBe(28);
    expectGolden("mapAnimation", capture.mapAnimation);

    expect(capture.sources.screenFade).toMatchObject({
      op: "screenFade",
      direction: "out",
      duration: 1,
      color: { r: 0, g: 0, b: 0, a: 255 },
      wait: true,
    });
    expect(capture.fadeState).toMatchObject({
      total: 60,
      left: 30,
      toAlpha: 255,
    });
    expect(capture.fadeState.fiber).toEndWith("/e005_resting_in_bed_r003");
    let darker = 0;
    let brighter = 0;
    let nonOpaque = 0;
    for (let pixel = 0; pixel < GI1A_VISUAL_WIDTH * GI1A_VISUAL_HEIGHT; pixel++) {
      const offset = pixel * 4;
      for (let channel = 0; channel < 3; channel++) {
        const before = capture.screenFadeBase[offset + channel]!;
        const after = capture.screenFade[offset + channel]!;
        if (after < before) darker++;
        if (after > before) brighter++;
      }
      if (capture.screenFade[offset + 3] !== 255) nonOpaque++;
    }
    expect(darker).toBeGreaterThan(20_000);
    expect(brighter).toBe(0);
    expect(nonOpaque).toBe(0);
    // A known tan floor pixel is approximately halved at the 30/60 tick
    // midpoint; this distinguishes a real alpha ramp from a static mask.
    const baseFloor = rgbaAt(capture.screenFadeBase, 240, 176);
    expect(baseFloor).toEqual([167, 140, 75, 255]);
    const fadedFloor = rgbaAt(capture.screenFade, 240, 176);
    expect(fadedFloor).toEqual([
      Math.floor(baseFloor[0]! / 2),
      Math.floor(baseFloor[1]! / 2),
      Math.floor(baseFloor[2]! / 2),
      255,
    ]);
    expectGolden("screenFade", capture.screenFade);
  }, 120_000);
});
