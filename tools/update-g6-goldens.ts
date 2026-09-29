// Regenerate the three maintained G6 journey keyframes from the built app.
// Prerequisites: `bun run build` (bundle + pak) and `bun tools/smoke-spyder.ts`
// (the adaptive reducer driver freezes the exact 60 Hz input tape).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";

interface JourneyFile {
  hz: number;
  frames: number;
  map: string;
  position: [number, number];
  masks: number[];
  checkpoints: { name: string; frame: number; map: string; position: [number, number] }[];
  story: Record<string, number | boolean>;
  sha256: string;
}

const ROOT = resolve(import.meta.dir, "..");
const bundle = join(ROOT, "dist/main");
const journeyPath = join(ROOT, "dist/journey-spyder-60hz.json");
if (!existsSync(bundle + ".js") || !existsSync(bundle + ".pak")) {
  throw new Error("G6 goldens: missing dist/main.{js,pak}; run `bun run build`");
}
if (!existsSync(journeyPath)) {
  throw new Error("G6 goldens: missing 60 Hz tape; run `HZ=60 bun tools/smoke-spyder.ts`");
}

const journey = JSON.parse(readFileSync(journeyPath, "utf8")) as JourneyFile;
writeFileSync(
  join(ROOT, "data/g6-journey.json"),
  JSON.stringify({ format: "pocket-tuxemon/g6-journey/v1", ...journey }, null, 2) + "\n",
);
const wanted = new Map(journey.checkpoints.map((mark) => [mark.frame, mark]));
const dir = join(ROOT, "tests/goldens");
mkdirSync(dir, { recursive: true });
const world = await bootWorld(bundle, 60, undefined, undefined, { width: 480, height: 272 });
const frames: Record<string, unknown>[] = [];

for (let frame = 0; frame < journey.masks.length; frame++) {
  world.frame(journey.masks[frame]!);
  world.tick();
  const mark = wanted.get(frame);
  if (!mark) continue;
  const state = globalThis.__rpgSessionState as SessionState | undefined;
  if (!state || state.mapId !== mark.map || state.move.tx !== mark.position[0] || state.move.ty !== mark.position[1]) {
    throw new Error(
      `G6 goldens: ${mark.name} diverged at f${frame}: ` +
        `${state?.mapId}@${state?.move.tx},${state?.move.ty} != ${mark.map}@${mark.position.join(",")}`,
    );
  }
  const rgba = world.render().slice();
  const file = `g6-${mark.name}.${frame}.png`;
  const png = encodePNG(rgba, 480, 272);
  writeFileSync(join(dir, file), png);
  frames.push({
    ...mark,
    file,
    rgbaFnv1a: fnv1a(rgba),
    pngSha256: createHash("sha256").update(png).digest("hex"),
  });
  console.log(`${mark.name}: f${frame} ${mark.map}@${mark.position.join(",")} rgba=${fnv1a(rgba)} -> ${file}`);
}

if (frames.length !== journey.checkpoints.length) {
  throw new Error(`G6 goldens: captured ${frames.length}/${journey.checkpoints.length} checkpoints`);
}
writeFileSync(
  join(ROOT, "data/g6-goldens.json"),
  JSON.stringify({ format: "pocket-tuxemon/g6-goldens/v1", width: 480, height: 272, frames }, null, 2) + "\n",
);
