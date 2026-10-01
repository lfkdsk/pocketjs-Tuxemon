// Regenerate the three production-rendered GI-1a visual evidence frames.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import {
  captureGi1aVisuals,
  GI1A_VISUAL_FILES,
  GI1A_VISUAL_HEIGHT,
  GI1A_VISUAL_WIDTH,
} from "./gi1a-visual-fixture.ts";

const root = resolve(import.meta.dir, "..");
const out = join(root, "tests/goldens");
mkdirSync(out, { recursive: true });

const capture = await captureGi1aVisuals();
for (const [key, file] of Object.entries(GI1A_VISUAL_FILES) as [keyof typeof GI1A_VISUAL_FILES, string][]) {
  const png = encodePNG(capture[key], GI1A_VISUAL_WIDTH, GI1A_VISUAL_HEIGHT);
  writeFileSync(join(out, file), png);
  console.log(`${key}: ${capture[key].length} RGBA bytes -> tests/goldens/${file}`);
}
console.log(
  `appearance=${capture.appearanceState.sprite} ` +
    `mapAnim=${capture.mapAnimationState.anim} ` +
    `fade=${capture.fadeState.left}/${capture.fadeState.total}`,
);
