// Deterministic 480x272 visual fixture for the registered GB4 battle scene.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { decodePng } from "../importer/png.ts";
import type { BattleDb, BattleImageRef } from "../importer/battle-schema.ts";
import { hpBarWidth } from "../ui/battle-layout.ts";
import { battlePreviewSourcePath } from "./render-battle-preview.ts";

const ROOT = resolve(import.meta.dir, "..");
export const GB4_BATTLE_WIDTH = 480;
export const GB4_BATTLE_HEIGHT = 272;
export const GB4_PLAYER_HP = { current: 31, maximum: 62 } as const;
export const GB4_ENEMY_HP = { current: 17, maximum: 40 } as const;
export const GB4_PLAYER_BAR = { x: 328, y: 143, width: 116, height: 10 } as const;
export const GB4_ENEMY_BAR = { x: 60, y: 44, width: 116, height: 10 } as const;

const FONT_3X5: Readonly<Record<string, readonly string[]>> = {
  " ": ["000", "000", "000", "000", "000"],
  ">": ["100", "010", "001", "010", "100"],
  "5": ["111", "100", "110", "001", "110"],
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  Q: ["010", "101", "101", "111", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  Y: ["101", "101", "010", "010", "010"],
};

function rectangle(
  rgba: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: readonly [number, number, number, number],
): void {
  for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
    rgba.set(colour, (py * GB4_BATTLE_WIDTH + px) * 4);
  }
}

function drawText(
  rgba: Uint8Array,
  text: string,
  x: number,
  y: number,
  colour: readonly [number, number, number, number],
  scale = 2,
): void {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT_3X5[raw] ?? FONT_3X5[" "]!;
    for (let row = 0; row < glyph.length; row++) {
      for (let column = 0; column < 3; column++) {
        if (glyph[row]![column] === "1") {
          rectangle(rgba, cursor + column * scale, y + row * scale, scale, scale, colour);
        }
      }
    }
    cursor += 4 * scale;
  }
}

function blitScaled(
  root: string,
  rgba: Uint8Array,
  ref: BattleImageRef,
  rect: readonly [number, number, number, number],
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const image = decodePng(new Uint8Array(readFileSync(battlePreviewSourcePath(root, ref))), ref.key);
  const [sx, sy, sw, sh] = rect;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sourceX = sx + Math.min(sw - 1, Math.floor(x * sw / dw));
    const sourceY = sy + Math.min(sh - 1, Math.floor(y * sh / dh));
    const source = (sourceY * image.width + sourceX) * 4;
    const alpha = image.rgba[source + 3]!;
    if (alpha === 0) continue;
    const target = ((dy + y) * GB4_BATTLE_WIDTH + dx + x) * 4;
    if (alpha === 255) rgba.set(image.rgba.subarray(source, source + 4), target);
    else {
      const inverse = 255 - alpha;
      rgba[target] = Math.round((image.rgba[source]! * alpha + rgba[target]! * inverse) / 255);
      rgba[target + 1] = Math.round((image.rgba[source + 1]! * alpha + rgba[target + 1]! * inverse) / 255);
      rgba[target + 2] = Math.round((image.rgba[source + 2]! * alpha + rgba[target + 2]! * inverse) / 255);
      rgba[target + 3] = 255;
    }
  }
}

export function renderGb4Battle(root = ROOT): Uint8Array {
  const db = JSON.parse(readFileSync(join(root, "data/battle-db.json"), "utf8")) as BattleDb;
  const rgba = new Uint8Array(GB4_BATTLE_WIDTH * GB4_BATTLE_HEIGHT * 4);
  rectangle(rgba, 0, 0, GB4_BATTLE_WIDTH, GB4_BATTLE_HEIGHT, [6, 20, 29, 255]);
  const environment = db.environments.grass!;
  blitScaled(root, rgba, environment.background, environment.background.rect, 0, 0, 480, 204);
  blitScaled(root, rgba, db.monsters.nut!.art.sheet, db.monsters.nut!.art.back, 68, 102, 96, 96);
  blitScaled(root, rgba, db.monsters.budaye!.art.sheet, db.monsters.budaye!.art.front, 326, 28, 96, 96);
  rectangle(rgba, 24, 20, 164, 46, [245, 241, 215, 255]);
  rectangle(rgba, 292, 119, 164, 46, [245, 241, 215, 255]);
  drawText(rgba, "Budaye Lv5", 32, 25, [16, 43, 58, 255]);
  drawText(rgba, "Nut Lv5", 300, 124, [16, 43, 58, 255]);
  rectangle(rgba, GB4_ENEMY_BAR.x, GB4_ENEMY_BAR.y, GB4_ENEMY_BAR.width, GB4_ENEMY_BAR.height, [38, 59, 67, 255]);
  rectangle(rgba, GB4_PLAYER_BAR.x, GB4_PLAYER_BAR.y, GB4_PLAYER_BAR.width, GB4_PLAYER_BAR.height, [38, 59, 67, 255]);
  rectangle(rgba, GB4_ENEMY_BAR.x, GB4_ENEMY_BAR.y, hpBarWidth(GB4_ENEMY_HP.current, GB4_ENEMY_HP.maximum), GB4_ENEMY_BAR.height, [242, 201, 76, 255]);
  rectangle(rgba, GB4_PLAYER_BAR.x, GB4_PLAYER_BAR.y, hpBarWidth(GB4_PLAYER_HP.current, GB4_PLAYER_HP.maximum), GB4_PLAYER_BAR.height, [242, 201, 76, 255]);
  rectangle(rgba, 8, 198, 464, 66, [16, 43, 58, 255]);
  drawText(rgba, "Choose a technique", 18, 205, [245, 241, 215, 255]);
  drawText(rgba, "> Bullet", 20, 226, [255, 209, 92, 255]);
  drawText(rgba, "Static Field", 240, 226, [156, 200, 193, 255]);
  drawText(rgba, "Shuriken", 20, 244, [156, 200, 193, 255]);
  return encodePNG(rgba, GB4_BATTLE_WIDTH, GB4_BATTLE_HEIGHT);
}

if (import.meta.main) {
  const output = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "tests/goldens/GB4-battle.png");
  mkdirSync(dirname(output), { recursive: true });
  const png = renderGb4Battle(ROOT);
  writeFileSync(output, png);
  console.log(`GB4 battle scene: ${output} (${GB4_BATTLE_WIDTH}x${GB4_BATTLE_HEIGHT}, ${png.byteLength} bytes)`);
}
