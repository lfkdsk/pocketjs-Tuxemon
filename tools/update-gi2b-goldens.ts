// Regenerate the production-rendered PC storage, trade and monster shop
// screenshots.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { captureGi2b, gi2bGoldenFile, GI2B_VIEWPORTS, GI2B_VISUAL_CASES } from "./gi2b-storage-fixture.ts";

const root = resolve(import.meta.dir, "..");
const out = join(root, "tests/goldens");
mkdirSync(out, { recursive: true });

const frames: Array<Record<string, unknown>> = [];
for (const viewport of GI2B_VIEWPORTS) {
  const capture = await captureGi2b(viewport);
  for (const visualCase of GI2B_VISUAL_CASES) {
    const frame = capture.cases[visualCase];
    const file = gi2bGoldenFile(visualCase, viewport);
    const png = encodePNG(frame.rgba, viewport.width, viewport.height);
    writeFileSync(join(out, file), png);
    frames.push({
      case: visualCase,
      ...viewport,
      file,
      rgbaFnv1a: fnv1a(frame.rgba),
      pngSha256: createHash("sha256").update(png).digest("hex"),
    });
    console.log(`${visualCase} ${viewport.width}x${viewport.height}: rgba=${fnv1a(frame.rgba)} -> tests/goldens/${file}`);
  }
}

writeFileSync(join(root, "data/gi2b-storage-goldens.json"), JSON.stringify({
  format: "pocket-tuxemon/gi2b-storage-goldens/v1",
  frames,
}, null, 2) + "\n");
