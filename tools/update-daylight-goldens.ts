// Capture the same clear Paper Town frame with fixed day and night starts.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { FIXED_INITIAL_CIVIL_TIME, type CivilDateTime } from "../battle/time-weather.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const OUT = join(ROOT, "tests/goldens");
const MANIFEST = join(ROOT, "data/daylight-goldens.json");
const WIDTH = 480;
const HEIGHT = 272;

if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
  throw new Error("daylight goldens: missing dist/main.{js,pak}; run `bun run build`");
}

const journey = JSON.parse(readFileSync(join(ROOT, "data/g6-journey.json"), "utf8")) as {
  masks: number[];
  checkpoints: { name: string; frame: number; map: string; position: [number, number] }[];
};
const foundCheckpoint = journey.checkpoints.find((candidate) => candidate.name === "paper-town");
if (!foundCheckpoint) throw new Error("daylight goldens: G6 journey has no paper-town checkpoint");
const checkpoint = foundCheckpoint;

async function capture(civil: CivilDateTime): Promise<Uint8Array> {
  const world = await bootWorld(
    BUNDLE,
    60,
    { __pocketTuxemonInitialCivilTime: civil },
    undefined,
    { width: WIDTH, height: HEIGHT },
  );
  for (let frame = 0; frame <= checkpoint.frame; frame++) {
    world.frame(journey.masks[frame]!);
    world.tick();
  }
  const state = globalThis.__rpgSessionState as SessionState | undefined;
  if (!state || state.mapId !== checkpoint.map || state.move.tx !== checkpoint.position[0]
    || state.move.ty !== checkpoint.position[1]) {
    throw new Error(
      `daylight goldens: diverged at f${checkpoint.frame}: `
      + `${state?.mapId}@${state?.move.tx},${state?.move.ty}`,
    );
  }
  return world.render().slice();
}

function channelMeans(rgba: Uint8Array): { luminance: number; blueBias: number } {
  let luminance = 0;
  let blueBias = 0;
  const pixels = rgba.length / 4;
  for (let index = 0; index < rgba.length; index += 4) {
    const r = rgba[index]!;
    const g = rgba[index + 1]!;
    const b = rgba[index + 2]!;
    luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    blueBias += b - (r + g) / 2;
  }
  return {
    luminance: Math.round(luminance / pixels * 1_000) / 1_000,
    blueBias: Math.round(blueBias / pixels * 1_000) / 1_000,
  };
}

const nightCivil: CivilDateTime = { ...FIXED_INITIAL_CIVIL_TIME, hour: 21 };
const day = await capture({ ...FIXED_INITIAL_CIVIL_TIME });
const night = await capture(nightCivil);
mkdirSync(OUT, { recursive: true });

const frames = [
  { name: "day", civil: FIXED_INITIAL_CIVIL_TIME, rgba: day },
  { name: "night", civil: nightCivil, rgba: night },
] as const;
const images = frames.map(({ name, civil, rgba }) => {
  const file = `daylight-${name}.png`;
  const png = encodePNG(rgba, WIDTH, HEIGHT);
  writeFileSync(join(OUT, file), png);
  return {
    name,
    civil,
    file,
    rgbaFnv1a: fnv1a(rgba),
    pngSha256: createHash("sha256").update(png).digest("hex"),
    ...channelMeans(rgba),
  };
});

let darkerPixels = 0;
let bluerPixels = 0;
for (let index = 0; index < day.length; index += 4) {
  const dayLuma = 0.2126 * day[index]! + 0.7152 * day[index + 1]! + 0.0722 * day[index + 2]!;
  const nightLuma = 0.2126 * night[index]! + 0.7152 * night[index + 1]! + 0.0722 * night[index + 2]!;
  if (nightLuma < dayLuma) darkerPixels++;
  const dayBias = day[index + 2]! - (day[index]! + day[index + 1]!) / 2;
  const nightBias = night[index + 2]! - (night[index]! + night[index + 1]!) / 2;
  if (nightBias > dayBias) bluerPixels++;
}

const manifest = {
  format: "pocket-tuxemon/daylight-goldens/v1",
  width: WIDTH,
  height: HEIGHT,
  checkpoint,
  images,
  comparison: { darkerPixels, bluerPixels, pixels: WIDTH * HEIGHT },
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
