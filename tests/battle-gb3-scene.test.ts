import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { decodePng } from "../importer/png.ts";
import {
  GB3_MENU_MARKER,
  GB3_MENU_PANEL,
  renderGb3Battle,
} from "../tools/render-gb3-battle.ts";
import { GB4_BATTLE_HEIGHT, GB4_BATTLE_WIDTH } from "../tools/render-gb4-battle.ts";

const ROOT = resolve(import.meta.dir, "..");
const pixel = (rgba: Uint8Array, width: number, x: number, y: number) =>
  [...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test("GB3 action-menu preview is byte-stable and exposes all five decisions", () => {
  const generated = renderGb3Battle(ROOT);
  expect(generated).toEqual(new Uint8Array(readFileSync(join(ROOT, "tests/goldens/GB3-battle.png"))));
  const image = decodePng(generated, "GB3-battle.png");
  expect([image.width, image.height]).toEqual([GB4_BATTLE_WIDTH, GB4_BATTLE_HEIGHT]);
  expect(pixel(image.rgba, image.width, GB3_MENU_PANEL.x + 1, GB3_MENU_PANEL.y + 1))
    .toEqual([16, 43, 58, 255]);
  expect(pixel(image.rgba, image.width, GB3_MENU_MARKER.x, GB3_MENU_MARKER.y))
    .toEqual([255, 209, 92, 255]);
  for (const [x, y] of [[152, 226], [272, 226], [20, 244], [152, 244]] as const) {
    expect(pixel(image.rgba, image.width, x, y)).toEqual([156, 200, 193, 255]);
  }
});
