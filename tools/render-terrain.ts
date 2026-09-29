// Render the G5 terrain-preview bundle on PocketJS's wasm host, optionally
// compare it against an independent full-map reference, and write a visual
// [runtime | reference | amplified difference] strip.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createWasmUi } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/wasm-ops.js";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { decodePng } from "../importer/png.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = process.env.G5_DIST ?? "/var/tmp/fleet/task-1806/dist";
const WASM = join(ROOT, "vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/pocketjs.wasm");

function arg(name: string, fallback = ""): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

const map = arg("map", "taba_town");
const width = Number(arg("w", "480"));
const height = Number(arg("h", "272"));
const frames = Number(arg("frames", "2"));
const atParts = arg("at", "0,0").split(",").map(Number);
const at: [number, number] = [atParts[0]!, atParts[1]!];
const marker = arg("marker", "true") !== "false";
const out = arg("out", `/var/tmp/fleet/task-1806/shots/${map}-${width}x${height}.png`);
const referencePath = arg("ref");
const comparePath = arg("compare");

for (const path of [join(DIST, "terrain-preview.js"), join(DIST, "terrain-preview.pak"), WASM]) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
}
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
  throw new Error(`invalid viewport ${width}x${height}`);
}
if (at.some((value) => !Number.isFinite(value))) throw new Error(`invalid --at=${arg("at")}`);

const wasm = await createWasmUi(await Bun.file(WASM).arrayBuffer(), { width, height });
const globals = globalThis as Record<string, unknown>;
globals.ui = wasm.ops;
globals.__pak = await Bun.file(join(DIST, "terrain-preview.pak")).arrayBuffer();
globals.frame = undefined;
globals.offload = undefined;
globals.audio = undefined;
globals.db = undefined;
globals.fs = undefined;
globals.__pocketApp = "terrain-preview";
globals.__simHz = 60;
globals.__pocketEffectTrace = (): void => {};
globals.__pocketEffectDriver = undefined;
globals.__pocketDevtoolsTransport = { send: (): void => {}, recv: () => null };
globals.__terrainPreview = { map, at, marker };
(0, eval)(await Bun.file(join(DIST, "terrain-preview.js")).text());
const appFrame = globals.frame as ((buttons: number, analog?: number) => void) | undefined;
if (!appFrame) throw new Error("terrain preview did not install globalThis.frame");
for (let i = 0; i < frames; i++) {
  appFrame(0);
  wasm.tick();
}
const shot = wasm.renderScaled(1);
mkdirSync(dirname(out), { recursive: true });
await Bun.write(out, encodePNG(shot, width, height));

const state = globals.__terrainPreviewState as {
  camX: number;
  camY: number;
  px: number;
  py: number;
  ground?: unknown;
  upper?: unknown;
};
const result: Record<string, unknown> = { map, width, height, frames, out, state };

if (referencePath) {
  const reference = decodePng(new Uint8Array(await Bun.file(referencePath).arrayBuffer()), referencePath);
  const expected = new Uint8Array(width * height * 4);
  for (let p = 0; p < expected.length; p += 4) expected.set([0, 0, 0, 255], p);
  for (let sy = 0; sy < height; sy++) {
    const wy = sy + state.camY;
    if (wy < 0 || wy >= reference.height) continue;
    for (let sx = 0; sx < width; sx++) {
      const wx = sx + state.camX;
      if (wx < 0 || wx >= reference.width) continue;
      const from = (wy * reference.width + wx) * 4;
      const to = (sy * width + sx) * 4;
      const alpha = reference.rgba[from + 3]!;
      expected[to] = Math.round(reference.rgba[from]! * alpha / 255);
      expected[to + 1] = Math.round(reference.rgba[from + 1]! * alpha / 255);
      expected[to + 2] = Math.round(reference.rgba[from + 2]! * alpha / 255);
    }
  }

  let differentPixels = 0;
  let outsideMask = 0;
  let markerSame = 0;
  let markerDifferent = 0;
  let maxChannelDelta = 0;
  const diff = new Uint8Array(width * height * 4);
  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const p = (sy * width + sx) * 4;
      let delta = 0;
      for (let channel = 0; channel < 4; channel++) {
        delta = Math.max(delta, Math.abs(shot[p + channel]! - expected[p + channel]!));
      }
      const worldX = sx + state.camX;
      const worldY = sy + state.camY;
      const masked = marker && worldX >= state.px && worldX < state.px + 16 && worldY >= state.py && worldY < state.py + 16;
      if (delta) {
        differentPixels++;
        if (masked) markerDifferent++;
        else outsideMask++;
      } else if (masked) {
        markerSame++;
      }
      const shown = Math.min(255, delta * 8);
      diff[p] = shown;
      diff[p + 1] = shown;
      diff[p + 2] = shown;
      diff[p + 3] = 255;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
  }
  Object.assign(result, { differentPixels, outsideMask, markerSame, markerDifferent, maxChannelDelta });
  if (comparePath) {
    const gap = 4;
    const compareWidth = width * 3 + gap * 2;
    const compare = new Uint8Array(compareWidth * height * 4);
    for (let p = 0; p < compare.length; p += 4) compare.set([40, 40, 40, 255], p);
    for (let y = 0; y < height; y++) {
      for (const [source, offset] of [[shot, 0], [expected, width + gap], [diff, (width + gap) * 2]] as const) {
        compare.set(source.subarray(y * width * 4, (y + 1) * width * 4), (y * compareWidth + offset) * 4);
      }
    }
    mkdirSync(dirname(comparePath), { recursive: true });
    await Bun.write(comparePath, encodePNG(compare, compareWidth, height));
    result.compare = comparePath;
  }
  if (outsideMask !== 0) throw new Error(`pixel mismatch outside marker: ${outsideMask}`);
}

console.log(JSON.stringify(result));
