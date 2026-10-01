import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { decodePng } from "../importer/png.ts";

const ROOT = resolve(import.meta.dir, "..");
const manifestPath = join(ROOT, "data/daylight-goldens.json");
const canVerify = existsSync(manifestPath);
if (!canVerify) console.warn("daylight visual goldens missing; run `bun tools/update-daylight-goldens.ts`");
const visualTest = canVerify ? test : test.skip;

interface GoldenImage {
  name: "day" | "night";
  file: string;
  pngSha256: string;
  luminance: number;
  blueBias: number;
}

interface DaylightManifest {
  format: "pocket-tuxemon/daylight-goldens/v1";
  width: number;
  height: number;
  images: GoldenImage[];
  comparison: { darkerPixels: number; bluerPixels: number; pixels: number };
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

describe("daylight visual goldens", () => {
  visualTest("pins inspected day/night screenshots and their semantic color shift", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DaylightManifest;
    expect(manifest.format).toBe("pocket-tuxemon/daylight-goldens/v1");
    expect([manifest.width, manifest.height]).toEqual([480, 272]);
    expect(manifest.images.map((image) => image.name)).toEqual(["day", "night"]);
    const decoded = new Map<GoldenImage["name"], Uint8Array>();
    for (const image of manifest.images) {
      const path = join(ROOT, "tests/goldens", image.file);
      const bytes = readFileSync(path);
      expect(createHash("sha256").update(bytes).digest("hex"), image.name).toBe(image.pngSha256);
      const png = decodePng(new Uint8Array(bytes), path);
      expect([png.width, png.height], image.name).toEqual([480, 272]);
      expect(channelMeans(png.rgba), image.name).toEqual({
        luminance: image.luminance,
        blueBias: image.blueBias,
      });
      decoded.set(image.name, png.rgba);
    }

    const day = decoded.get("day")!;
    const night = decoded.get("night")!;
    const dayMeans = channelMeans(day);
    const nightMeans = channelMeans(night);
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
    expect({ darkerPixels, bluerPixels, pixels: day.length / 4 }).toEqual(manifest.comparison);
    expect(nightMeans.luminance).toBeLessThan(dayMeans.luminance * 0.75);
    expect(nightMeans.blueBias).toBeGreaterThan(dayMeans.blueBias + 20);
    expect(darkerPixels).toBeGreaterThan(day.length / 4 * 0.75);
    expect(bluerPixels).toBeGreaterThan(day.length / 4 * 0.9);
  });
});
