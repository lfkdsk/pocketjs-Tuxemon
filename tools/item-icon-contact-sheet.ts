// tools/item-icon-contact-sheet.ts — render the SHIPPED item icon atlas as a
// 3x-nearest-neighbour contact sheet over a checkerboard. The pixels come
// from decoding the packed TILESET entry `assets/icons/items.pkts` (CLUT8 +
// PackBits-RLE), not from any pre-quantization intermediate, so the image
// shows exactly what the runtime loads.
//
// Usage:
//   bun tools/item-icon-contact-sheet.ts [output.png]
//   bun tools/item-icon-contact-sheet.ts --cell <selector> [zoom] <out.png>
//
// <selector> is one of:
//   - a project item slug (e.g. `repellent`, resolved via dist/project.json)
//   - a cell number (e.g. `19`, or the placeholder cell, e.g. `143`)
//   - an upstream icon file basename (e.g. `box.png` or `box`)
// The --cell output path is required; there is no built-in default.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import {
  TILESET_ABSENT,
  TILESET_FLAG_RLE,
  TILESET_MAGIC,
  packbitsDecode,
} from "../vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/spec.ts";

const ZOOM = 3;
const CHECKER_LIGHT = [240, 240, 240] as const;
const CHECKER_DARK = [200, 200, 200] as const;
const CHECKER_PX = 8; // source pixels per checker square

// --- TILESET decode ---------------------------------------------------------

interface DecodedTileset {
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  palette: Uint32Array; // ABGR
  tiles: Uint8Array[]; // CLUT8 indices per tile
}

/** Decode a TILESET pak entry per contracts/spec/spec.ts. */
export function decodeTileset(blob: Uint8Array): DecodedTileset {
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (dv.getUint32(0, true) !== TILESET_MAGIC) throw new Error("items.pkts: bad magic");
  const flags = dv.getUint16(6, true);
  const tileW = dv.getUint16(8, true);
  const tileH = dv.getUint16(10, true);
  const cols = dv.getUint16(12, true);
  const rows = dv.getUint16(14, true);
  const paletteOff = dv.getUint32(16, true);
  const dirOff = dv.getUint32(20, true);
  const dataOff = dv.getUint32(24, true);
  const palette = new Uint32Array(256);
  for (let i = 0; i < 256; i++) palette[i] = dv.getUint32(paletteOff + i * 4, true);
  const tiles: Uint8Array[] = [];
  for (let t = 0; t < cols * rows; t++) {
    const off = dv.getUint32(dirOff + t * 8, true);
    const len = dv.getUint32(dirOff + t * 8 + 4, true);
    if (off === TILESET_ABSENT) {
      tiles.push(new Uint8Array(tileW * tileH));
    } else if (len === 0) {
      tiles.push(new Uint8Array(tileW * tileH).fill(off)); // solid: off is the palette index
    } else {
      const stream = blob.subarray(dataOff + off, dataOff + off + len);
      const decoded = (flags & TILESET_FLAG_RLE) !== 0 ? packbitsDecode(stream, tileW * tileH) : stream.slice(0, tileW * tileH);
      if (!decoded) throw new Error(`items.pkts: tile ${t} has a bad RLE stream`);
      tiles.push(decoded);
    }
  }
  return { tileW, tileH, cols, rows, palette, tiles };
}

/** Reconstruct the full atlas as RGBA. */
export function tilesetToRgba(ts: DecodedTileset): Uint8Array {
  const w = ts.cols * ts.tileW;
  const h = ts.rows * ts.tileH;
  const rgba = new Uint8Array(w * h * 4);
  for (let t = 0; t < ts.cols * ts.rows; t++) {
    const ox = (t % ts.cols) * ts.tileW;
    const oy = Math.floor(t / ts.cols) * ts.tileW;
    const indices = ts.tiles[t]!;
    for (let y = 0; y < ts.tileH; y++) {
      for (let x = 0; x < ts.tileW; x++) {
        const word = ts.palette[indices[y * ts.tileW + x]!]!;
        const o = ((oy + y) * w + ox + x) * 4;
        rgba[o] = word & 0xff;
        rgba[o + 1] = (word >>> 8) & 0xff;
        rgba[o + 2] = (word >>> 16) & 0xff;
        rgba[o + 3] = (word >>> 24) & 0xff;
      }
    }
  }
  return rgba;
}

// --- PNG encode (minimal, RGBA8) --------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false); // PNG integers are big-endian
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w, false); // PNG integers are big-endian
  dv.setUint32(4, h, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// --- contact sheet -----------------------------------------------------------

/** Nearest-neighbour upscale of the atlas over a checkerboard, `zoom`x. */
export function renderContactSheet(atlas: Uint8Array, w: number, h: number, zoom: number): Uint8Array {
  const out = new Uint8Array(w * zoom * h * zoom * 4);
  for (let y = 0; y < h * zoom; y++) {
    for (let x = 0; x < w * zoom; x++) {
      const sx = Math.floor(x / zoom);
      const sy = Math.floor(y / zoom);
      const o = (y * w * zoom + x) * 4;
      const src = (sy * w + sx) * 4;
      const a = atlas[src + 3]!;
      if (a === 0) {
        const checker = (Math.floor(sx / CHECKER_PX) + Math.floor(sy / CHECKER_PX)) % 2 === 0;
        const c = checker ? CHECKER_LIGHT : CHECKER_DARK;
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
        out[o + 3] = 255;
      } else if (a === 255) {
        out[o] = atlas[src]!;
        out[o + 1] = atlas[src + 1]!;
        out[o + 2] = atlas[src + 2]!;
        out[o + 3] = 255;
      } else {
        // Blend translucent pixels over the checker so the sheet shows what
        // the runtime composites (the kit draws icons over opaque scenes).
        const checker = (Math.floor(sx / CHECKER_PX) + Math.floor(sy / CHECKER_PX)) % 2 === 0;
        const c = checker ? CHECKER_LIGHT : CHECKER_DARK;
        const f = a / 255;
        out[o] = Math.round(atlas[src]! * f + c[0] * (1 - f));
        out[o + 1] = Math.round(atlas[src + 1]! * f + c[1] * (1 - f));
        out[o + 2] = Math.round(atlas[src + 2]! * f + c[2] * (1 - f));
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

// --- cell selector -----------------------------------------------------------

/** The import-report fields the selector needs. */
export interface IconReportView {
  itemIcons: {
    sheet: { cols: number; rows: number };
    cells: { cell: number; file: string }[];
    placeholderCell: number;
  };
}

/** The project fields the selector needs. */
export interface IconProjectView {
  items: { id: string; sprite?: string }[];
}

export interface CellRef {
  cell: number;
  /** File basename for art cells, or `placeholder` for the placeholder cell. */
  label: string;
}

/** Resolve a `--cell` selector: project item slug, cell number (including the
 *  placeholder cell), or upstream icon file basename (with or without `.png`). */
export function resolveCell(needle: string, report: IconReportView, project: IconProjectView): CellRef {
  const { cells, placeholderCell } = report.itemIcons;
  const cellCount = report.itemIcons.sheet.cols * report.itemIcons.sheet.rows;
  const labelFor = (cell: number): string | undefined => {
    const file = cells.find((c) => c.cell === cell)?.file;
    if (file) return file.split("/").pop()!;
    return cell === placeholderCell ? "placeholder" : undefined;
  };
  if (/^\d+$/.test(needle)) {
    const cell = Number(needle);
    const label = cell >= 0 && cell < cellCount ? labelFor(cell) : undefined;
    if (label === undefined) throw new Error(`no cell for ${needle}`);
    return { cell, label };
  }
  const bySlug = project.items.find((it) => it.id === needle && it.sprite?.startsWith("items."));
  if (bySlug) {
    const cell = Number(bySlug.sprite!.split(".")[1]);
    const label = labelFor(cell);
    if (label === undefined) throw new Error(`no cell for ${needle}`);
    return { cell, label };
  }
  const file = cells.find((c) => c.file.endsWith(`/${needle}.png`) || c.file.endsWith(`/${needle}`))?.file;
  if (file) return { cell: cells.find((c) => c.file === file)!.cell, label: file.split("/").pop()! };
  throw new Error(`no cell for ${needle}`);
}

// --- CLI ---------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const ts = decodeTileset(readFileSync("assets/icons/items.pkts"));
  const atlas = tilesetToRgba(ts);
  const atlasW = ts.cols * ts.tileW;
  const atlasH = ts.rows * ts.tileH;

  if (args[0] === "--cell") {
    // Render one cell (item slug, cell number, or upstream file basename).
    const report = JSON.parse(readFileSync("dist/import-report.json", "utf8")) as IconReportView;
    const project = JSON.parse(readFileSync("dist/project.json", "utf8")) as IconProjectView;
    const needle = args[1]!;
    const ref = resolveCell(needle, report, project);
    let zoom = 12;
    let outPath: string | undefined;
    if (args.length === 3) {
      outPath = args[2];
    } else if (args.length >= 4) {
      zoom = Number(args[2]);
      outPath = args[3];
    }
    if (!outPath) throw new Error("--cell requires an output path, e.g. --cell repellent 12 dist/cell-repellent.png");
    if (!Number.isInteger(zoom) || zoom <= 0) throw new Error(`bad zoom: ${args[2]}`);
    const cell = new Uint8Array(ts.tileW * ts.tileH * 4);
    const ox = (ref.cell % ts.cols) * ts.tileW;
    const oy = Math.floor(ref.cell / ts.cols) * ts.tileW;
    for (let y = 0; y < ts.tileH; y++) cell.set(atlas.subarray(((oy + y) * atlasW + ox) * 4, ((oy + y) * atlasW + ox + ts.tileW) * 4), y * ts.tileW * 4);
    const sheet = renderContactSheet(cell, ts.tileW, ts.tileH, zoom);
    writeFileSync(outPath, encodePng(sheet, ts.tileW * zoom, ts.tileH * zoom));
    console.log(`cell ${ref.cell} (${ref.label}) -> ${outPath}`);
    return;
  }

  const outPath = args[0] ?? "dist/item-icons-contact.png";
  const sheet = renderContactSheet(atlas, atlasW, atlasH, ZOOM);
  writeFileSync(outPath, encodePng(sheet, atlasW * ZOOM, atlasH * ZOOM));
  console.log(`${atlasW}x${atlasH} atlas -> ${outPath} (${atlasW * ZOOM}x${atlasH * ZOOM})`);
}

if (import.meta.main) main();
