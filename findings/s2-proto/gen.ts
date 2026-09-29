// findings/s2-proto/gen.ts — Scout S2 prototype asset cooker.
//
//   bun findings/s2-proto/gen.ts        (reads $S2_PROTO, default /var/tmp/fleet/task-1783/proto,
//                                        written by findings/scripts/analyze_tmx.py)
//
// For each exported Tuxemon map it writes, into findings/s2-proto/assets/:
//   <map>-g.pkts / <map>-u.pkts   TILESET pak entries (spec.ts "TILESET pak entry"): the
//                                 composited below-player ("g") and above-player ("u")
//                                 layers cut into 256x256 CLUT8 chunks, PackBits-RLE, one
//                                 shared 256-colour palette per entry (a layer with more
//                                 colours is split into one entry per chunk). Streamed at
//                                 runtime through loadTileTexture (ui:tile.* keys are never
//                                 bulk-uploaded at boot on any host).
//   anim-<n>.png                  one SPRITE atlas per distinct animation sequence (frames in a
//                                 row on a pow2-wide strip; the core auto-plays them).
//   t<id>.png                     every unique 16x16 tile variant of the exported maps, for the
//                                 plan-B node ring (uploaded at boot like any image).
// plus pak.json / sprites.json / images.json for the PocketJS build and manifest.ts (full string
// literals so pass 1 bakes them; cell tables for plan B; chunk keys for the streamed layers).

import { existsSync, mkdirSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodeTilesetEntry, type TilesetTile } from "../../vendor/pocket-rpgkit/vendor/pocketjs/framework/compiler/pak.ts";
import { encodePNG } from "../../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { TILESET_FLAG_RLE, keyTileset } from "../../vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/spec.ts";

const HERE = new URL(".", import.meta.url).pathname;
const PROTO = process.env.S2_PROTO ?? "/var/tmp/fleet/task-1783/proto";
const ASSETS = join(HERE, "assets");
const CHUNK = Number(process.env.S2_CHUNK ?? 256);
const TILE = 16;
mkdirSync(ASSETS, { recursive: true });

interface MapJson {
  map: string; w: number; h: number;
  layers: { name: string; above: boolean; cells: number[] }[];
  anims: { x: number; y: number; layer: number; above: boolean; frames: [number, number][] }[];
}

const q = (s: string) => JSON.stringify(s);
const pak: { key: string; file: string }[] = [];
const sprites: Record<string, { cols: number; rows: number; frames: number; step: number; psm: number }> = {};
const images: Record<string, { psm: number }> = {};
const report: Record<string, unknown> = {};

/** RGBA -> ABGR u32 (the palette word order the core wants). */
const abgr = (r: number, g: number, b: number, a: number) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

interface Layer { rgba: Uint8Array; w: number; h: number }

function chunkOf(l: Layer, cx: number, cy: number): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK * 4);
  for (let y = 0; y < CHUNK; y++) {
    const sy = cy * CHUNK + y;
    if (sy >= l.h) break;
    const sx0 = cx * CHUNK;
    const n = Math.min(CHUNK, l.w - sx0);
    if (n <= 0) break;
    out.set(l.rgba.subarray((sy * l.w + sx0) * 4, (sy * l.w + sx0 + n) * 4), y * CHUNK * 4);
  }
  return out;
}

/** Colour census of an RGBA chunk (alpha 0 folds to 0). */
function colours(rgba: Uint8Array): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < rgba.length; i += 4) {
    const k = rgba[i + 3] === 0 ? 0 : abgr(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Build a 256-entry palette from a census (index 0 = transparent); the 255 most
 *  frequent colours survive, the rest map to the nearest survivor (a lossy
 *  fallback for the rare >256-colour chunk). */
function palette(census: Map<number, number>): { pal: Uint32Array; index: Map<number, number>; lossy: boolean } {
  const entries = [...census.entries()].filter(([k]) => k !== 0).sort((a, b) => b[1] - a[1]);
  const pal = new Uint32Array(256);
  const index = new Map<number, number>([[0, 0]]);
  const keep = entries.slice(0, 255);
  keep.forEach(([k], i) => { pal[i + 1] = k; index.set(k, i + 1); });
  let lossy = false;
  for (const [k] of entries.slice(255)) {
    lossy = true;
    const r = k & 255, g = (k >> 8) & 255, b = (k >> 16) & 255;
    let best = 1, bd = Infinity;
    for (let i = 1; i <= keep.length; i++) {
      const p = pal[i]!;
      const d = (r - (p & 255)) ** 2 + (g - ((p >> 8) & 255)) ** 2 + (b - ((p >> 16) & 255)) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    index.set(k, best);
  }
  return { pal, index, lossy };
}

function indices(rgba: Uint8Array, index: Map<number, number>): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const k = rgba[i + 3] === 0 ? 0 : abgr(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!);
    out[p] = index.get(k)!;
  }
  return out;
}

const manifestMaps: string[] = [];
const tileNames = new Set<number>();
let animSeq = new Map<string, number>();
const animMeta: string[] = [];
let totalTilesetBytes = 0;

for (const id of readdirSync(PROTO).filter((d) => existsSync(join(PROTO, d, "map.json"))).sort()) {
  const dir = join(PROTO, id);
  const mj = JSON.parse(await Bun.file(join(dir, "map.json")).text()) as MapJson;
  const cols = Math.ceil((mj.w * TILE) / CHUNK), rows = Math.ceil((mj.h * TILE) / CHUNK);
  const layerRefs: Record<string, string> = {};
  const rep: Record<string, unknown> = { w: mj.w, h: mj.h, cols, rows };
  for (const layer of ["g", "u"] as const) {
    const png = decodePng(new Uint8Array(await Bun.file(join(dir, layer === "g" ? "ground.png" : "upper.png")).arrayBuffer()));
    const L: Layer = { rgba: png.rgba, w: png.width, h: png.height };
    const chunks: Uint8Array[] = [];
    const census = new Map<number, number>();
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const c = chunkOf(L, cx, cy);
      chunks.push(c);
      for (const [k, n] of colours(c)) census.set(k, (census.get(k) ?? 0) + n);
    }
    const perChunk = census.size > 256;
    const refs: string[] = [];
    let bytes = 0, absent = 0, lossyChunks = 0;
    const emit = (name: string, tiles: TilesetTile[], grid: [number, number], pal: Uint32Array) => {
      const blob = encodeTilesetEntry({ tileW: CHUNK, tileH: CHUNK, cols: grid[0], rows: grid[1], flags: TILESET_FLAG_RLE, palette: pal, tiles });
      const file = `assets/${name}.pkts`;
      writeFileSync(join(HERE, file), blob);
      pak.push({ key: keyTileset(name), file });
      bytes += blob.length;
      return keyTileset(name);
    };
    if (!perChunk) {
      const { pal, index } = palette(census);
      const tiles: TilesetTile[] = chunks.map((c) => {
        let any = false;
        for (let i = 3; i < c.length; i += 4) if (c[i] !== 0) { any = true; break; }
        if (!any) { absent++; return { kind: "absent" }; }
        return { kind: "pixels", indices: indices(c, index) };
      });
      const key = emit(`${id}-${layer}`, tiles, [cols, rows], pal);
      for (let i = 0; i < chunks.length; i++) refs.push(tiles[i]!.kind === "absent" ? "" : `${key}#${i}`);
    } else {
      chunks.forEach((c, i) => {
        let any = false;
        for (let k = 3; k < c.length; k += 4) if (c[k] !== 0) { any = true; break; }
        if (!any) { absent++; refs.push(""); return; }
        const { pal, index, lossy } = palette(colours(c));
        if (lossy) lossyChunks++;
        const key = emit(`${id}-${layer}-${i}`, [{ kind: "pixels", indices: indices(c, index) }], [1, 1], pal);
        refs.push(`${key}#0`);
      });
    }
    totalTilesetBytes += bytes;
    layerRefs[layer] = JSON.stringify(refs);
    rep[layer] = { colours: census.size, perChunkEntries: perChunk, bytes, absentChunks: absent, lossyChunks };
  }
  // animations: one sprite atlas per distinct frame sequence
  const anims: string[] = [];
  for (const a of mj.anims) {
    const sig = JSON.stringify(a.frames);
    let n = animSeq.get(sig);
    if (n === undefined) {
      n = animSeq.size; animSeq.set(sig, n);
      const frames = a.frames.length;
      const colsA = 1 << Math.ceil(Math.log2(frames));
      const W = colsA * TILE;
      const name = `assets/anim-${n}.png`;
      const rgbaSync = new Uint8Array(W * TILE * 4);
      for (let i = 0; i < frames; i++) {
        const t = decodePng(new Uint8Array(await Bun.file(join(PROTO, "tiles", `t${a.frames[i]![0]}.png`)).arrayBuffer()));
        for (let y = 0; y < TILE; y++) rgbaSync.set(t.rgba.subarray(y * TILE * 4, (y + 1) * TILE * 4), (y * W + i * TILE) * 4);
      }
      writeFileSync(join(HERE, name), encodePNG(rgbaSync, W, TILE));
      const step = Math.max(1, Math.round((a.frames[0]![1] / 1000) * 60));
      sprites[name] = { cols: colsA, rows: 1, frames, step, psm: 3 };
      animMeta[n] = `{ src: ${q(name)}, step: ${step}, frames: ${frames} }`;
    }
    anims.push(`[${a.x}, ${a.y}, ${a.above ? 1 : 0}, ${n}]`);
  }
  // plan-B cell tables: one printable char per cell (code = vid + 32)
  const enc = (cells: number[]) => {
    let s = "";
    for (const c of cells) { if (c) tileNames.add(c); s += String.fromCharCode(c + 32); }
    return JSON.stringify(s);
  };
  const cellTables = mj.layers.map((l) => `{ above: ${l.above}, s: ${enc(l.cells)} }`);
  rep.anims = mj.anims.length; rep.layers = mj.layers.map((l) => [l.name, l.above]);
  report[id] = rep;
  manifestMaps.push(
    `  ${q(id)}: {\n    w: ${mj.w}, h: ${mj.h}, cols: ${cols}, rows: ${rows},\n    g: ${layerRefs.g},\n    u: ${layerRefs.u},\n` +
    `    anims: [${anims.join(", ")}],\n    cells: [\n${cellTables.map((t) => `      ${t},`).join("\n")}\n    ],\n  }`,
  );
}

// plan-B tile images
const tileList: string[] = [""];
const maxVid = Math.max(0, ...tileNames);
for (let v = 1; v <= maxVid; v++) {
  if (!tileNames.has(v)) { tileList.push(""); continue; }
  const name = `assets/t${v}.png`;
  copyFileSync(join(PROTO, "tiles", `t${v}.png`), join(HERE, name));
  images[name] = { psm: 2 };
  tileList.push(name);
}

writeFileSync(join(HERE, "pak.json"), JSON.stringify(pak, null, 1));
writeFileSync(join(HERE, "sprites.json"), JSON.stringify(sprites, null, 1));
writeFileSync(join(HERE, "images.json"), JSON.stringify(images, null, 1));
writeFileSync(join(HERE, "manifest.ts"),
  `// AUTO-GENERATED by findings/s2-proto/gen.ts — do not edit.\n` +
  `export const CHUNK = ${CHUNK};\n` +
  `export interface S2Map { w: number; h: number; cols: number; rows: number; g: readonly string[]; u: readonly string[]; anims: readonly (readonly [number, number, number, number])[]; cells: readonly { above: boolean; s: string }[] }\n` +
  `export const MAPS: Record<string, S2Map> = {\n${manifestMaps.join(",\n")},\n};\n` +
  `export const ORDER: readonly string[] = ${JSON.stringify(Object.keys(report))};\n` +
  `/** Animation atlases by sequence id: sprite literal, frame step (host frames), frame count. */\n` +
  `export const ANIMS: readonly { src: string; step: number; frames: number }[] = [\n${animMeta.map((m) => `  ${m},`).join("\n")}\n];\n` +
  `/** Plan-B tile images by variant id (index 0 unused). */\n` +
  `export const TILES: readonly string[] = [\n${tileList.map((t) => `  ${q(t)},`).join("\n")}\n];\n`);
report.__totals = { tilesetBytes: totalTilesetBytes, tiles: tileNames.size, animAtlases: animSeq.size, chunk: CHUNK };
writeFileSync(join(HERE, "gen-report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
