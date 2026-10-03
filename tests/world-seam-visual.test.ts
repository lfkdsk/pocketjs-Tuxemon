import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePng } from "../importer/png.ts";
import { fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";

interface Rect extends Array<number> {
  0: number;
  1: number;
  2: number;
  3: number;
}

interface SeamFrame {
  name: "east-west" | "north-south";
  viewport: { width: number; height: number };
  activeMap: string;
  neighbourMap: string;
  file: string;
  sample: { world: [number, number]; screen: [number, number]; rgba: number[] };
  activeRect: Rect;
  neighbourRect: Rect;
  visibleMaps: string[];
  terrain: { textures: number; resident: number; pooled: number; created: number; pending: number };
  rgbaFnv1a: string;
  pngSha256: string;
}

const ROOT = resolve(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/world-seam-goldens.json"), "utf8")) as {
  format: string;
  frames: SeamFrame[];
};

const contains = (rect: Rect, point: readonly number[]): boolean =>
  point[0]! >= rect[0] && point[0]! < rect[0] + rect[2] &&
  point[1]! >= rect[1] && point[1]! < rect[1] + rect[3];

describe("production outdoor seam rendering", () => {
  test("pins both seam orientations at 480x272 and 960x544", () => {
    expect(manifest.format).toBe("pocket-tuxemon/world-seam-goldens/v1");
    expect(manifest.frames.map((frame) => [frame.name, frame.viewport])).toEqual([
      ["east-west", { width: 480, height: 272 }],
      ["north-south", { width: 480, height: 272 }],
      ["east-west", { width: 960, height: 544 }],
      ["north-south", { width: 960, height: 544 }],
    ]);
    for (const frame of manifest.frames) {
      const path = join(ROOT, "tests/goldens", frame.file);
      const bytes = new Uint8Array(readFileSync(path));
      const image = decodePng(bytes, path);
      expect([image.width, image.height], frame.file)
        .toEqual([frame.viewport.width, frame.viewport.height]);
      expect(createHash("sha256").update(bytes).digest("hex"), frame.file).toBe(frame.pngSha256);
      expect(fnv1a(image.rgba), frame.file).toBe(frame.rgbaFnv1a);
    }
  });

  test("each neighbour-side sample is owned by the neighbour and is real terrain", () => {
    const expected = {
      "east-west": [64, 176, 128, 255],
      "north-south": [216, 200, 128, 255],
    } as const;
    for (const frame of manifest.frames) {
      expect(contains(frame.neighbourRect, frame.sample.world), frame.file).toBeTrue();
      expect(contains(frame.activeRect, frame.sample.world), frame.file).toBeFalse();
      expect(frame.visibleMaps, frame.file).toContain(frame.activeMap);
      expect(frame.visibleMaps, frame.file).toContain(frame.neighbourMap);
      expect(frame.sample.rgba, frame.file).toEqual([...expected[frame.name]]);
      expect(frame.sample.rgba, frame.file).not.toEqual([0, 0, 0, 255]);
      expect(frame.terrain.pending, frame.file).toBe(0);
      expect(frame.terrain.textures, frame.file).toBeGreaterThan(0);
      expect(frame.terrain.resident + frame.terrain.pooled, frame.file).toBe(frame.terrain.created);

      const path = join(ROOT, "tests/goldens", frame.file);
      const image = decodePng(new Uint8Array(readFileSync(path)), path);
      const [x, y] = frame.sample.screen;
      const offset = (y * image.width + x) * 4;
      expect([...image.rgba.subarray(offset, offset + 4)], frame.file).toEqual(frame.sample.rgba);
    }
  });
});
