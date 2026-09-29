// Plan A (today's bake) per-chunk build cost on real Tuxemon pixels: PNG encode of a
// 512x512 RGBA chunk (what gen-assets writes) + the pak pass's 4444 conversion.
import { decodePng, encodeImageEntry } from "/home/tangollvm/.fleet/worktrees/task-1783/vendor/pocket-rpgkit/vendor/pocketjs/framework/compiler/pak.ts";
import { encodePNG } from "/home/tangollvm/.fleet/worktrees/task-1783/vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { packbitsEncode } from "/home/tangollvm/.fleet/worktrees/task-1783/vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/spec.ts";
const png = decodePng(new Uint8Array(await Bun.file("/var/tmp/fleet/task-1783/proto/buddha_mountain/ground.png").arrayBuffer()));
const cut = (size: number, cx: number, cy: number) => {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = cy * size + y; if (sy >= png.height) break;
    const n = Math.min(size, png.width - cx * size); if (n <= 0) break;
    out.set(png.rgba.subarray((sy * png.width + cx * size) * 4, (sy * png.width + cx * size + n) * 4), y * size * 4);
  }
  return out;
};
const chunks512 = [] as Uint8Array[];
for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) chunks512.push(cut(512, cx, cy));
let t = performance.now(); let pngBytes = 0;
for (const c of chunks512) pngBytes += encodePNG(c, 512, 512).length;
const tPng = (performance.now() - t) / chunks512.length;
t = performance.now(); let pakBytes = 0;
for (const c of chunks512) { const png2 = encodePNG(c, 512, 512); const d = decodePng(new Uint8Array(png2)); pakBytes += encodeImageEntry(d, 2).length; }
const tPak = (performance.now() - t) / chunks512.length;
// streamed variant: T8 index + packbits per 256 chunk (index build with a Map, as gen.ts does)
const chunks256 = [] as Uint8Array[];
for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) chunks256.push(cut(256, cx, cy));
t = performance.now(); let rle = 0;
for (const c of chunks256) {
  const idx = new Map<number, number>([[0, 0]]); const out = new Uint8Array(256 * 256);
  for (let i = 0, p = 0; i < c.length; i += 4, p++) { const k = c[i + 3] === 0 ? 0 : (c[i]! | (c[i + 1]! << 8) | (c[i + 2]! << 16) | (c[i + 3]! << 24)) >>> 0; let v = idx.get(k); if (v === undefined) { v = idx.size; idx.set(k, v); } out[p] = v & 255; }
  rle += packbitsEncode(out).length;
}
const tT8 = (performance.now() - t) / chunks256.length;
console.log(JSON.stringify({ png512MsPerChunk: +tPng.toFixed(2), pakConvert512MsPerChunk: +tPak.toFixed(2), avgPng512Bytes: Math.round(pngBytes / chunks512.length), pak512Bytes: pakBytes / chunks512.length, t8rle256MsPerChunk: +tT8.toFixed(2), avgRle256Bytes: Math.round(rle / chunks256.length), extrapolatedPlanA_buildSeconds_910chunks: +(((tPng + tPak) * 910) / 1000).toFixed(1), extrapolatedT8_buildSeconds_2240chunks: +((tT8 * 2240) / 1000).toFixed(1) }));
