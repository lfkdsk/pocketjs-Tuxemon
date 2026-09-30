// Deterministic 480x272 visual fixture for the GB3 five-way battle menu.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { decodePng } from "../importer/png.ts";
import {
  GB4_BATTLE_HEIGHT,
  GB4_BATTLE_WIDTH,
  renderGb4Battle,
} from "./render-gb4-battle.ts";

const ROOT = resolve(import.meta.dir, "..");
export const GB3_MENU_PANEL = { x: 8, y: 198, width: 464, height: 66 } as const;
export const GB3_MENU_MARKER = { x: 20, y: 226 } as const;

const FONT_3X5: Readonly<Record<string, readonly string[]>> = {
  " ": ["000", "000", "000", "000", "000"],
  ">": ["100", "010", "001", "010", "100"],
  A: ["010", "101", "111", "101", "101"],
  C: ["011", "100", "100", "100", "011"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  W: ["101", "101", "111", "111", "101"],
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
    for (let row = 0; row < glyph.length; row++) for (let column = 0; column < 3; column++) {
      if (glyph[row]![column] === "1") {
        rectangle(rgba, cursor + column * scale, y + row * scale, scale, scale, colour);
      }
    }
    cursor += 4 * scale;
  }
}

export function renderGb3Battle(root = ROOT): Uint8Array {
  const image = decodePng(renderGb4Battle(root), "GB3 battle base");
  const rgba = image.rgba;
  const panel = GB3_MENU_PANEL;
  rectangle(rgba, panel.x, panel.y, panel.width, panel.height, [16, 43, 58, 255]);
  drawText(rgba, "Choose an action", 18, 205, [245, 241, 215, 255]);
  drawText(rgba, "> Fight", 20, 226, [255, 209, 92, 255]);
  drawText(rgba, "Item", 150, 226, [156, 200, 193, 255]);
  drawText(rgba, "Capture", 270, 226, [156, 200, 193, 255]);
  drawText(rgba, "Run", 20, 244, [156, 200, 193, 255]);
  drawText(rgba, "Swap", 150, 244, [156, 200, 193, 255]);
  return encodePNG(rgba, GB4_BATTLE_WIDTH, GB4_BATTLE_HEIGHT);
}

if (import.meta.main) {
  const output = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "findings/GB3-battle.png");
  mkdirSync(dirname(output), { recursive: true });
  const png = renderGb3Battle(ROOT);
  writeFileSync(output, png);
  console.log(`GB3 battle menu: ${output} (${GB4_BATTLE_WIDTH}x${GB4_BATTLE_HEIGHT}, ${png.byteLength} bytes)`);
}
