// Regenerate the two production-rendered Tuxepedia journal screenshots.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import {
  captureGi2aJournal,
  GI2A_JOURNAL_VIEWPORTS,
  GI2A_VISUAL_CASES,
  GI2A_VISUAL_FILES,
} from "./gi2a-journal-fixture.ts";

const root = resolve(import.meta.dir, "..");
const out = join(root, "tests/goldens");
mkdirSync(out, { recursive: true });

const frames: Array<Record<string, unknown>> = [];
for (const viewport of GI2A_JOURNAL_VIEWPORTS) {
  const capture = await captureGi2aJournal(viewport);
  const viewportKey = `${viewport.width}x${viewport.height}` as "480x272" | "960x544";
  for (const visualCase of GI2A_VISUAL_CASES) {
    const frame = capture.cases[visualCase];
    const file = GI2A_VISUAL_FILES[visualCase][viewportKey];
    const png = encodePNG(frame.rgba, viewport.width, viewport.height);
    writeFileSync(join(out, file), png);
    frames.push({
      case: visualCase,
      ...viewport,
      file,
      rgbaFnv1a: fnv1a(frame.rgba),
      pngSha256: createHash("sha256").update(png).digest("hex"),
      selected: capture.selected,
    });
    console.log(`${visualCase} ${viewportKey}: rgba=${fnv1a(frame.rgba)} -> tests/goldens/${file}`);
  }
}

writeFileSync(join(root, "data/gi2a-journal-goldens.json"), JSON.stringify({
  format: "pocket-tuxemon/gi2a-journal-goldens/v2",
  frames,
}, null, 2) + "\n");
