// Render weather particle screenshots for visual inspection:
// rain/snow/clear x indoor/outdoor x 480x272 and 960x544.
//
// Usage: bun tools/render-weather-shots.ts
// Writes findings/wx1-shots/*.png and a manifest with per-shot pixel stats.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { FIXED_INITIAL_CIVIL_TIME } from "../battle/time-weather.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { bootWorld } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const OUT = join(ROOT, "findings/wx1-shots");
const MANIFEST = join(OUT, "manifest.json");

if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
  throw new Error("weather shots: missing dist/main.{js,pak}; run `bun run build`");
}

const journey = JSON.parse(readFileSync(join(ROOT, "data/g6-journey.json"), "utf8")) as {
  masks: number[];
  checkpoints: { name: string; frame: number; map: string; position: [number, number] }[];
};
const checkpoint = (name: string) => {
  const found = journey.checkpoints.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`weather shots: G6 journey has no ${name} checkpoint`);
  return found;
};
const INDOOR = checkpoint("bedroom");
const OUTDOOR = checkpoint("paper-town");

const WEATHERS = ["rain", "snow", "sunny", "thunderstorm", "foggy"] as const;
const NIGHT_WEATHERS = ["sunny", "rain", "snow", "foggy"] as const;
const VIEWPORTS = [
  { name: "480x272", width: 480, height: 272 },
  { name: "960x544", width: 960, height: 544 },
] as const;
/** 22:00 sits inside the night stage (dim 0.45). */
const NIGHT_CIVIL_TIME = { ...FIXED_INITIAL_CIVIL_TIME, hour: 22, minute: 0 } as const;

interface ShotStats {
  file: string;
  sha256: string;
  meanLuminance: number;
  blueBias: number;
  /** Fraction of pixels whose blue channel leads by >40 (particle streaks). */
  blueStreak: number;
  /** Fraction of bright near-white pixels (snow/flakes/veils). */
  brightWhite: number;
}

function stats(rgba: Uint8Array, file: string, pngSha256: string): ShotStats {
  let luminance = 0;
  let blueBias = 0;
  let blueStreak = 0;
  let brightWhite = 0;
  const pixels = rgba.length / 4;
  for (let index = 0; index < rgba.length; index += 4) {
    const r = rgba[index]!;
    const g = rgba[index + 1]!;
    const b = rgba[index + 2]!;
    luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    blueBias += b - (r + g) / 2;
    if (b - r > 40 && b - g > 20 && b > 150) blueStreak++;
    if (r > 200 && g > 200 && b > 200) brightWhite++;
  }
  return {
    file,
    sha256: pngSha256,
    meanLuminance: Math.round(luminance / pixels * 1000) / 1000,
    blueBias: Math.round(blueBias / pixels * 1000) / 1000,
    blueStreak: Math.round(blueStreak / pixels * 10000) / 10000,
    brightWhite: Math.round(brightWhite / pixels * 10000) / 10000,
  };
}

async function capture(
  weather: string,
  location: { frame: number; map: string; position: [number, number] },
  viewport: { width: number; height: number },
  civilTime: { year: number; month: number; day: number; hour: number; minute: number } = FIXED_INITIAL_CIVIL_TIME,
): Promise<{ rgba: Uint8Array; state: SessionState }> {
  const world = await bootWorld(
    BUNDLE,
    60,
    {
      __pocketTuxemonInitialCivilTime: civilTime,
      __pocketTuxemonInitialWeather: { slug: weather },
    },
    undefined,
    { width: viewport.width, height: viewport.height },
  );
  for (let frame = 0; frame <= location.frame; frame++) {
    world.frame(journey.masks[frame]!);
    world.tick();
  }
  const state = globalThis.__rpgSessionState as SessionState | undefined;
  if (!state || state.mapId !== location.map) {
    throw new Error(`weather shots: diverged at f${location.frame}: ${state?.mapId} != ${location.map}`);
  }
  return { rgba: world.render().slice(), state };
}

const shots: ShotStats[] = [];
mkdirSync(OUT, { recursive: true });

for (const viewport of VIEWPORTS) {
  for (const [locationName, location] of [["indoor", INDOOR], ["outdoor", OUTDOOR]] as const) {
    for (const weather of WEATHERS) {
      const { rgba, state } = await capture(weather, location, viewport);
      const file = `${weather}-${locationName}-${viewport.name}.png`;
      const png = encodePNG(rgba, viewport.width, viewport.height);
      writeFileSync(join(OUT, file), png);
      const shot = stats(rgba, file, createHash("sha256").update(png).digest("hex"));
      shots.push(shot);
      console.log(`${file} map=${state.mapId} lum=${shot.meanLuminance} blue=${shot.blueBias} streak=${shot.blueStreak} white=${shot.brightWhite}`);
    }
  }
}

// Night outdoor variants document the actual day/night behavior: the overlay
// paints above the daylight tint and self-dims particle opacity (night 0.45),
// rather than being veiled by the tint.
const nightViewport = VIEWPORTS[0]!;
for (const weather of NIGHT_WEATHERS) {
  const { rgba, state } = await capture(weather, OUTDOOR, nightViewport, NIGHT_CIVIL_TIME);
  const file = `${weather}-outdoor-night-${nightViewport.name}.png`;
  const png = encodePNG(rgba, nightViewport.width, nightViewport.height);
  writeFileSync(join(OUT, file), png);
  const shot = stats(rgba, file, createHash("sha256").update(png).digest("hex"));
  shots.push(shot);
  console.log(`${file} map=${state.mapId} lum=${shot.meanLuminance} blue=${shot.blueBias} streak=${shot.blueStreak} white=${shot.brightWhite}`);
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  format: "pocket-tuxemon/wx1-shots/v1",
  civil: FIXED_INITIAL_CIVIL_TIME,
  nightCivil: NIGHT_CIVIL_TIME,
  checkpoints: { indoor: INDOOR.name, outdoor: OUTDOOR.name },
  shots,
}, null, 1) + "\n");
console.log(`wrote ${shots.length} shots to ${OUT}`);
