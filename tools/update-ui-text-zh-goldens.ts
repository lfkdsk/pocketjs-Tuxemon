// Regenerate the production-rendered Simplified Chinese kit-UI screenshots.
// Exact-size goldens are committed; 3x nearest-neighbour copies in dist/ are
// for the required human inspection and deliberately stay build artifacts.

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import {
  captureUiTextZh,
  UI_TEXT_ZH_CASES,
  UI_TEXT_ZH_VIEWPORTS,
  uiTextZhGoldenFile,
} from "./ui-text-zh-visual-fixture.ts";

const ROOT = resolve(import.meta.dir, "..");
const GOLDENS = join(ROOT, "tests/goldens");
const REVIEW = join(ROOT, "dist/ui-text-zh-review");

function nearestThreeX(source: Uint8Array, width: number, height: number): Uint8Array {
  const scaledWidth = width * 3;
  const output = new Uint8Array(scaledWidth * height * 3 * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const to = ((y * 3 + dy) * scaledWidth + x * 3 + dx) * 4;
      output.set(source.subarray(from, from + 4), to);
    }
  }
  return output;
}

mkdirSync(GOLDENS, { recursive: true });
rmSync(REVIEW, { recursive: true, force: true });
mkdirSync(REVIEW, { recursive: true });

const frames: Record<string, unknown>[] = [];
for (const viewport of UI_TEXT_ZH_VIEWPORTS) {
  const capture = await captureUiTextZh(viewport);
  for (const visualCase of UI_TEXT_ZH_CASES) {
    const rgba = capture.cases[visualCase].rgba;
    const file = uiTextZhGoldenFile(visualCase, viewport);
    const png = encodePNG(rgba, viewport.width, viewport.height);
    writeFileSync(join(GOLDENS, file), png);
    const enlarged = nearestThreeX(rgba, viewport.width, viewport.height);
    writeFileSync(
      join(REVIEW, file.replace(/\.png$/, ".3x.png")),
      encodePNG(enlarged, viewport.width * 3, viewport.height * 3),
    );
    frames.push({
      case: visualCase,
      ...viewport,
      file,
      rgbaFnv1a: fnv1a(rgba),
      pngSha256: createHash("sha256").update(png).digest("hex"),
    });
    console.log(`${visualCase} ${viewport.width}x${viewport.height}: ${fnv1a(rgba)} -> ${file}`);
  }
}

writeFileSync(
  join(ROOT, "data/ui-text-zh-goldens.json"),
  JSON.stringify({ format: "pocket-tuxemon/ui-text-zh-goldens/v1", frames }, null, 2) + "\n",
);
console.log(`3x review copies: ${REVIEW}`);
