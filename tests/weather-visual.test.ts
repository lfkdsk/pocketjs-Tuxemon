import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { decodePng } from "../importer/png.ts";

const ROOT = resolve(import.meta.dir, "..");
const SHOTS = join(ROOT, "docs/screenshots/weather");
const manifestPath = join(SHOTS, "manifest.json");
const canVerify = existsSync(manifestPath);
if (!canVerify) console.warn("weather shots missing; run `bun tools/render-weather-shots.ts`");
const visualTest = canVerify ? test : test.skip;

interface ShotStat {
  file: string;
  sha256: string;
  meanLuminance: number;
  blueBias: number;
  blueStreak: number;
  brightWhite: number;
}

interface ShotManifest {
  format: "pocket-tuxemon/wx1-shots/v1";
  shots: ShotStat[];
}

function loadShot(file: string): { rgba: Uint8Array; width: number; height: number } {
  const bytes = readFileSync(join(SHOTS, file));
  return decodePng(new Uint8Array(bytes), file);
}

/** Count pixels that differ and the mean luminance of those pixels. */
function diff(a: Uint8Array, b: Uint8Array): { count: number; lum: number; blueBias: number } {
  let count = 0;
  let lum = 0;
  let blueBias = 0;
  for (let index = 0; index < a.length; index += 4) {
    if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2]) {
      count++;
      lum += 0.2126 * a[index]! + 0.7152 * a[index + 1]! + 0.0722 * a[index + 2]!;
      blueBias += a[index + 2]! - (a[index]! + a[index + 1]!) / 2;
    }
  }
  return { count, lum: count ? lum / count : 0, blueBias: count ? blueBias / count : 0 };
}

describe("weather particle screenshots", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ShotManifest;

  visualTest("every shot is a committed, hash-pinned PNG at the expected size", () => {
    expect(manifest.format).toBe("pocket-tuxemon/wx1-shots/v1");
    const files = readdirSync(SHOTS).filter((name) => name.endsWith(".png")).sort();
    expect(files.length).toBe(manifest.shots.length);
    for (const shot of manifest.shots) {
      const path = join(SHOTS, shot.file);
      const bytes = readFileSync(path);
      expect(createHash("sha256").update(bytes).digest("hex"), shot.file).toBe(shot.sha256);
      const png = decodePng(new Uint8Array(bytes), shot.file);
      const expected = shot.file.endsWith("480x272.png") ? [480, 272] : [960, 544];
      expect([png.width, png.height], shot.file).toEqual(expected);
    }
  });

  visualTest("rain adds bright blue streaks over the same outdoor scene", () => {
    const rain = loadShot("rain-outdoor-480x272.png");
    const sunny = loadShot("sunny-outdoor-480x272.png");
    const delta = diff(rain.rgba, sunny.rgba);
    // Hundreds of streak pixels, each brighter and bluer than the scene it covers.
    expect(delta.count).toBeGreaterThan(150);
    expect(delta.lum).toBeGreaterThan(150);
    expect(delta.blueBias).toBeGreaterThan(8);
  });

  visualTest("snow adds bright near-white flakes over the same outdoor scene", () => {
    const snow = loadShot("snow-outdoor-480x272.png");
    const sunny = loadShot("sunny-outdoor-480x272.png");
    const delta = diff(snow.rgba, sunny.rgba);
    expect(delta.count).toBeGreaterThan(80);
    expect(delta.lum).toBeGreaterThan(180);
  });

  visualTest("fog veils brighten the scene", () => {
    const foggy = manifest.shots.find((shot) => shot.file === "foggy-outdoor-480x272.png")!;
    const sunny = manifest.shots.find((shot) => shot.file === "sunny-outdoor-480x272.png")!;
    expect(foggy.meanLuminance).toBeGreaterThan(sunny.meanLuminance);
  });

  visualTest("the overlay is byte-identical indoors for every weather", () => {
    const reference = loadShot("sunny-indoor-480x272.png");
    for (const weather of ["rain", "snow", "thunderstorm", "foggy"]) {
      const shot = loadShot(`${weather}-indoor-480x272.png`);
      expect(shot.rgba, `${weather} indoor`).toEqual(reference.rgba);
    }
    const reference960 = loadShot("sunny-indoor-960x544.png");
    for (const weather of ["rain", "snow", "thunderstorm", "foggy"]) {
      const shot = loadShot(`${weather}-indoor-960x544.png`);
      expect(shot.rgba, `${weather} indoor 960`).toEqual(reference960.rgba);
    }
  });

  visualTest("particles stay inside the world frame at 960x544 (no letterbox rain)", () => {
    const rain = loadShot("rain-outdoor-960x544.png");
    const sunny = loadShot("sunny-outdoor-960x544.png");
    const delta = diff(rain.rgba, sunny.rgba);
    expect(delta.count).toBeGreaterThan(150);
    // Paper Town is 640x320 centered at (160,112) in 960x544; every differing
    // pixel must fall inside that frame.
    for (let index = 0; index < rain.rgba.length; index += 4) {
      const pixel = index / 4;
      const x = pixel % 960;
      const y = Math.floor(pixel / 960);
      const differs = rain.rgba[index] !== sunny.rgba[index]
        || rain.rgba[index + 1] !== sunny.rgba[index + 1]
        || rain.rgba[index + 2] !== sunny.rgba[index + 2];
      if (differs) {
        expect(x, `particle at ${x},${y}`).toBeGreaterThanOrEqual(160);
        expect(x).toBeLessThan(800);
        expect(y).toBeGreaterThanOrEqual(112);
        expect(y).toBeLessThan(432);
      }
    }
  });

  visualTest("the night daylight grade darkens the world and the particles with it", () => {
    const daySunny = manifest.shots.find((shot) => shot.file === "sunny-outdoor-480x272.png")!;
    const nightSunny = manifest.shots.find((shot) => shot.file === "sunny-outdoor-night-480x272.png")!;
    // The world itself is tinted dark at 22:00.
    expect(nightSunny.meanLuminance).toBeLessThan(daySunny.meanLuminance / 2);
    // Rain still reads as streaks at night, but dimmer than in daylight:
    // the overlay paints above the tint and self-dims (night 0.45), which is
    // the documented Partial limitation.
    const dayRain = diff(loadShot("rain-outdoor-480x272.png").rgba, loadShot("sunny-outdoor-480x272.png").rgba);
    const nightRain = diff(loadShot("rain-outdoor-night-480x272.png").rgba, loadShot("sunny-outdoor-night-480x272.png").rgba);
    expect(nightRain.count).toBeGreaterThan(150);
    expect(nightRain.lum).toBeLessThan(dayRain.lum);
    expect(nightRain.blueBias).toBeGreaterThan(8);
  });

  visualTest("snow and fog still read at night", () => {
    const nightSunny = loadShot("sunny-outdoor-night-480x272.png");
    const nightSnow = diff(loadShot("snow-outdoor-night-480x272.png").rgba, nightSunny.rgba);
    expect(nightSnow.count).toBeGreaterThan(80);
    // Flakes stay bright against the darkened scene (night sunny mean ~51),
    // though dimmer than daylight snow (which asserts > 180).
    expect(nightSnow.lum).toBeGreaterThan(80);
    const nightFoggy = manifest.shots.find((shot) => shot.file === "foggy-outdoor-night-480x272.png")!;
    const nightSunnyStat = manifest.shots.find((shot) => shot.file === "sunny-outdoor-night-480x272.png")!;
    expect(nightFoggy.meanLuminance).toBeGreaterThan(nightSunnyStat.meanLuminance);
  });
});
