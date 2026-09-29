// Exact plan-B pak cost: every unique tile variant as its own PSM_4444 IMG entry, appended to
// the prototype pak (so the desktop bench can also time boot with 5,044 boot-time textures).
import { readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodeImageEntry, pack, unpack } from "/home/tangollvm/.fleet/worktrees/task-1783/vendor/pocket-rpgkit/vendor/pocketjs/framework/compiler/pak.ts";
const SRC = "/var/tmp/fleet/task-1783/alltiles";
const files = readdirSync(SRC).filter((f) => f.endsWith(".png")).sort();
const blobs = [] as { key: string; dtype: number; data: Uint8Array }[];
let opaque = 0, alpha = 0, bytes = 0;
for (const f of files) {
  const img = decodePng(new Uint8Array(await Bun.file(join(SRC, f)).arrayBuffer()));
  let op = true; for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] !== 255) { op = false; break; }
  if (op) opaque++; else alpha++;
  const data = encodeImageEntry(img, 2);
  bytes += data.length;
  blobs.push({ key: `ui:img.tiles/${f}`, dtype: 1, data });
}
const tilesOnly = pack(blobs);
const base = unpack(new Uint8Array(await Bun.file("/var/tmp/fleet/task-1783/dist/s2-proto.pak").arrayBuffer()));
const merged = pack([...base, ...blobs]);
mkdirSync("/var/tmp/fleet/task-1783/dist-alltiles", { recursive: true });
copyFileSync("/var/tmp/fleet/task-1783/dist/s2-proto.js", "/var/tmp/fleet/task-1783/dist-alltiles/s2-proto.js");
await Bun.write("/var/tmp/fleet/task-1783/dist-alltiles/s2-proto.pak", merged);
console.log(JSON.stringify({ tiles: files.length, opaque, alpha, imgEntryBytes: bytes, pakBytesTilesOnly: tilesOnly.length, perTileInPak: +(tilesOnly.length / files.length).toFixed(1), atlas512Equivalent: { opaque5650: Math.ceil(opaque / 1024), alpha4444: Math.ceil(alpha / 1024), bytes: (Math.ceil(opaque / 1024) + Math.ceil(alpha / 1024)) * 512 * 512 * 2 }, mergedPakBytes: merged.length }));
