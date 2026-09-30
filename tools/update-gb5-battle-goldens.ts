// Regenerate the six GB5 battle-presentation checkpoints at both supported
// logical resolutions from the real built game.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import {
  captureGb5BattleFrames,
  GB5_FRAME_NAMES,
} from "./gb5-battle-fixture.ts";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "tests/goldens");
const viewports = [
  { width: 480, height: 272 },
  { width: 960, height: 544 },
] as const;

function nearestTwoX(source: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * 2 * height * 2 * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4;
    for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
      const to = ((y * 2 + oy) * width * 2 + x * 2 + ox) * 4;
      output.set(source.subarray(from, from + 4), to);
    }
  }
  return output;
}

mkdirSync(OUT, { recursive: true });
const entries: Record<string, unknown>[] = [];
for (const viewport of viewports) {
  const capture = await captureGb5BattleFrames(viewport);
  for (const name of GB5_FRAME_NAMES) {
    const frame = capture.frames[name];
    const file = `gb5-battle-${name}.${viewport.width}x${viewport.height}.png`;
    const png = encodePNG(frame.rgba, viewport.width, viewport.height);
    writeFileSync(join(OUT, file), png);
    const event = frame.state.battle.events[frame.state.eventCursor] ?? null;
    entries.push({
      name,
      width: viewport.width,
      height: viewport.height,
      file,
      hostFrame: frame.hostFrame,
      event: event?.type ?? null,
      eventCursor: frame.state.eventCursor,
      eventTicks: frame.state.eventTicks,
      menuMode: frame.state.menuMode,
      rgbaFnv1a: fnv1a(frame.rgba),
      pngSha256: createHash("sha256").update(png).digest("hex"),
    });
    console.log(`${name} ${viewport.width}x${viewport.height}: f${frame.hostFrame} ${fnv1a(frame.rgba)} -> ${file}`);
  }
  if (!capture.frames.hit.rgba.every((byte, index) => byte === capture.rewoundHit[index])) {
    throw new Error(`GB5 goldens: ${viewport.width}x${viewport.height} hit rewind changed pixels`);
  }
  if (viewport.width === 480) {
    const screenshot = nearestTwoX(capture.frames["technique-menu"].rgba, viewport.width, viewport.height);
    writeFileSync(join(ROOT, "docs/screenshots/battle.png"), encodePNG(screenshot, 960, 544));
  }
}

writeFileSync(
  join(ROOT, "data/gb5-battle-goldens.json"),
  JSON.stringify({ format: "pocket-tuxemon/gb5-battle-goldens/v1", frames: entries }, null, 2) + "\n",
);
