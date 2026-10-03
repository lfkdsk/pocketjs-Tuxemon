import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePng } from "../importer/png.ts";
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const WASM = join(ROOT, "vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/pocketjs.wasm");
const journey = JSON.parse(readFileSync(join(ROOT, "data/g6-journey.json"), "utf8")) as {
  masks: number[];
  checkpoints: { name: string; frame: number; map: string; position: [number, number] }[];
};
interface PaintMark {
  tile: [number, number];
  pixel: [number, number];
  facing: number;
  phase: number;
  image: string;
  height: 16 | 32;
}
interface GoldenFrame {
  name: string;
  frame: number;
  map: string;
  position: [number, number];
  file: string;
  rgbaFnv1a: string;
  pngSha256: string;
  camera: [number, number];
  player: PaintMark;
  actor?: PaintMark & { id: string; sprite: string };
}
const manifest = JSON.parse(readFileSync(join(ROOT, "data/g6-goldens.json"), "utf8")) as {
  width: number;
  height: number;
  frames: GoldenFrame[];
};
const project = JSON.parse(readFileSync(join(ROOT, "dist/project.json"), "utf8")) as {
  maps: { id: string; width: number; height: number }[];
  worldLayout?: {
    components: Array<{
      bounds: { minTileX: number; minTileY: number; maxTileX: number; maxTileY: number };
      placements: Array<{ mapId: string; originTileX: number; originTileY: number }>;
    }>;
  };
};

function load(name: string) {
  const entry = manifest.frames.find((frame) => frame.name === name)!;
  const path = join(ROOT, "tests/goldens", entry.file);
  const bytes = new Uint8Array(readFileSync(path));
  return { entry, bytes, image: decodePng(bytes, path) };
}

function count(
  rgba: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  predicate: (r: number, g: number, b: number) => boolean,
): number {
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4;
    if (predicate(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)) total++;
  }
  return total;
}

const exact = (rr: number, gg: number, bb: number) => (r: number, g: number, b: number) =>
  r === rr && g === gg && b === bb;
const PLAYER_BLUE = (r: number, g: number, b: number) => b > 120 && b > r * 1.2 && b > g * 1.05;

function matchingOpaquePixels(frame: GoldenFrame, mark: PaintMark): { opaque: number; matching: number } {
  const target = load(frame.name).image;
  const sprite = decodePng(new Uint8Array(readFileSync(join(ROOT, mark.image))), mark.image);
  const map = project.maps.find((candidate) => candidate.id === frame.map)!;
  const component = project.worldLayout?.components.find((candidate) =>
    candidate.placements.some((placement) => placement.mapId === frame.map)
  );
  const placement = component?.placements.find((candidate) => candidate.mapId === frame.map);
  const componentW = component ? (component.bounds.maxTileX - component.bounds.minTileX) * 16 : map.width * 16;
  const componentH = component ? (component.bounds.maxTileY - component.bounds.minTileY) * 16 : map.height * 16;
  const offsetX = Math.max(0, Math.floor((manifest.width - componentW) / 2));
  const offsetY = Math.max(0, Math.floor((manifest.height - componentH) / 2));
  const worldX = mark.pixel[0] + (placement?.originTileX ?? 0) * 16;
  const worldY = mark.pixel[1] + (placement?.originTileY ?? 0) * 16;
  const x0 = offsetX + worldX - frame.camera[0];
  const y0 = offsetY + worldY - frame.camera[1] + 16 - mark.height;
  let opaque = 0;
  let matching = 0;
  for (let y = 0; y < sprite.height; y++) for (let x = 0; x < sprite.width; x++) {
    const source = (y * sprite.width + x) * 4;
    if (sprite.rgba[source + 3] !== 255) continue;
    opaque++;
    const targetIndex = ((y0 + y) * target.width + x0 + x) * 4;
    if (
      sprite.rgba[source] === target.rgba[targetIndex] &&
      sprite.rgba[source + 1] === target.rgba[targetIndex + 1] &&
      sprite.rgba[source + 2] === target.rgba[targetIndex + 2] &&
      sprite.rgba[source + 3] === target.rgba[targetIndex + 3]
    ) matching++;
  }
  return { opaque, matching };
}

describe("G6 maintained keyframes", () => {
  test("manifest pins the intended maps and PNG bytes", () => {
    expect(manifest).toMatchObject({ width: 480, height: 272 });
    expect(manifest.frames.map(({ name, map }) => [name, map])).toEqual([
      ["bedroom", "spyder_bedroom"],
      ["downstairs-mom", "spyder_downstairs"],
      ["paper-town", "spyder_paper_town"],
      ["route-1", "spyder_route1"],
    ]);
    for (const frame of manifest.frames) {
      const loaded = load(frame.name);
      expect([loaded.image.width, loaded.image.height]).toEqual([480, 272]);
      expect(createHash("sha256").update(loaded.bytes).digest("hex"), frame.name).toBe(frame.pngSha256);
      expect(fnv1a(loaded.image.rgba), frame.name).toBe(frame.rgbaFnv1a);
    }
  });

  test("bedroom shows the compact original room, rug, wood floor, and 16x32 player", () => {
    const { image } = load("bedroom");
    expect(count(image.rgba, image.width, 0, 0, 480, 272, exact(0, 0, 0))).toBeGreaterThan(110_000);
    expect(count(image.rgba, image.width, 168, 80, 312, 192, exact(207, 184, 104))).toBeGreaterThan(1_500);
    expect(count(image.rgba, image.width, 196, 112, 260, 176, exact(100, 192, 130))).toBeGreaterThan(400);
    expect(count(image.rgba, image.width, 210, 110, 242, 160, PLAYER_BLUE)).toBeGreaterThan(60);
  });

  test("downstairs mom is painted at her live NPC tile", () => {
    const frame = manifest.frames.find((candidate) => candidate.name === "downstairs-mom")!;
    expect(frame.actor).toMatchObject({ id: "npc_spyder_papertown_mom", sprite: "npc.homemaker" });
    expect(frame.actor!.pixel).toEqual([frame.actor!.tile[0] * 16, frame.actor!.tile[1] * 16]);
    const pixels = matchingOpaquePixels(frame, frame.actor!);
    expect(pixels.opaque).toBeGreaterThan(80);
    expect(pixels.matching).toBe(pixels.opaque);
  });

  test("Paper Town shows grass, roads, forest, the blue mart, and a visible player", () => {
    const { entry, image } = load("paper-town");
    expect(count(image.rgba, image.width, 0, 0, 480, 272, exact(64, 176, 128))).toBeGreaterThan(35_000);
    expect(count(image.rgba, image.width, 0, 0, 480, 272, exact(216, 200, 128))).toBeGreaterThan(18_000);
    expect(count(image.rgba, image.width, 250, 115, 420, 240, exact(0, 107, 219))).toBeGreaterThan(1_500);
    expect(count(image.rgba, image.width, 0, 0, 110, 220, exact(48, 96, 56))).toBeGreaterThan(1_000);
    const pixels = matchingOpaquePixels(entry, entry.player);
    expect(pixels.opaque).toBeGreaterThan(80);
    expect(pixels.matching).toBe(pixels.opaque);
  });

  test("Route 1 shows water, crop rows, forest, and the 16x32 player", () => {
    const { image } = load("route-1");
    expect(count(image.rgba, image.width, 0, 0, 480, 272, exact(64, 176, 128))).toBeGreaterThan(45_000);
    expect(count(image.rgba, image.width, 0, 0, 90, 180, exact(61, 106, 179))).toBeGreaterThan(3_000);
    expect(count(image.rgba, image.width, 80, 0, 440, 160, exact(56, 80, 0))).toBeGreaterThan(3_900);
    const frame = manifest.frames.find((candidate) => candidate.name === "route-1")!;
    const pixels = matchingOpaquePixels(frame, frame.player);
    expect(pixels.opaque).toBeGreaterThan(80);
    expect(pixels.matching).toBe(pixels.opaque);
  });
});

const canBoot = existsSync(BUNDLE + ".js") && existsSync(BUNDLE + ".pak") && existsSync(WASM);
if (!canBoot) console.warn("G6 built-bundle golden replay skipped; run `bun run build && bun run build:wasm`");
const simTest = canBoot ? test : test.skip;

describe("G6 built bundle deterministic replay", () => {
  async function drive() {
    const world = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, { width: 480, height: 272 });
    const hashes: string[] = [];
    const marked = new Map<number, { hash: string; state: [string, number, number] }>();
    const frames = new Set(journey.checkpoints.map((mark) => mark.frame));
    for (let frame = 0; frame < journey.masks.length; frame++) {
      world.frame(journey.masks[frame]!);
      world.tick();
      const hash = fnv1a(world.render());
      hashes.push(hash);
      if (frames.has(frame)) {
        const state = globalThis.__rpgSessionState as SessionState;
        marked.set(frame, { hash, state: [state.mapId, state.move.tx, state.move.ty] });
      }
    }
    const end = globalThis.__rpgSessionState as SessionState;
    return { hashes, marked, end: [end.mapId, end.move.tx, end.move.ty] as const };
  }

  simTest("two full tape runs have identical per-frame pixels and finish Route 1", async () => {
    const first = await drive();
    const second = await drive();
    expect(second.hashes).toEqual(first.hashes);
    expect(second.end).toEqual(["spyder_route1", 14, 19]);
    for (const frame of manifest.frames) {
      expect(first.marked.get(frame.frame)).toEqual({
        hash: frame.rgbaFnv1a,
        state: [frame.map, frame.position[0], frame.position[1]],
      });
    }
  }, 120_000);
});
