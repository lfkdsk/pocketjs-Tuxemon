// Regenerate the production-rendered daycare screenshots and hash manifest.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import {
  captureDaycare,
  daycareGoldenFile,
  DAYCARE_VISUAL_CASES,
} from "./daycare-visual-fixture.ts";

const root = resolve(import.meta.dir, "..");
const out = join(root, "tests/goldens");
mkdirSync(out, { recursive: true });

const capture = await captureDaycare();
const frames: Array<Record<string, unknown>> = [];
for (const visualCase of DAYCARE_VISUAL_CASES) {
  const frame = capture.cases[visualCase];
  const file = daycareGoldenFile(visualCase);
  const png = encodePNG(frame.rgba, capture.width, capture.height);
  writeFileSync(join(out, file), png);
  frames.push({
    case: visualCase,
    width: capture.width,
    height: capture.height,
    file,
    rgbaFnv1a: fnv1a(frame.rgba),
    pngSha256: createHash("sha256").update(png).digest("hex"),
  });
  console.log(`${visualCase}: rgba=${fnv1a(frame.rgba)} -> tests/goldens/${file}`);
}

writeFileSync(join(root, "data/daycare-goldens.json"), JSON.stringify({
  format: "pocket-tuxemon/daycare-goldens/v1",
  frames,
}, null, 2) + "\n");
