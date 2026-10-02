// importer/item-icons.ts — item icon atlas.
//
// Every imported item carries a `sprite: "<sheet>.<cell>"` reference. The G1
// placeholder sheet ("tux") was retired with the terrain system, leaving the
// item catalog pointing at an undeclared sheet. This module bakes the
// upstream item art (`mods/tuxemon/db/item/*.yaml` `sprite:` fields, all
// 24x24 PNGs under `gfx/items/`) into one declared 16x16-cell TILESET pak
// entry, the same streamed-tile format the terrain system uses. Items whose
// DB row names no existing art share one procedural placeholder cell and are
// listed in the import report.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeTilesetEntry, type TilesetTile } from "../vendor/pocket-rpgkit/vendor/pocketjs/framework/compiler/pak.ts";
import { TILESET_FLAG_RLE, keyTileset } from "../vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/spec.ts";
import type { Sheet } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { decodePng } from "./png.ts";
import { TUXEMON_SRC } from "./source.ts";

export const ITEM_ICON_SHEET_ID = "items";
/** Project tile size: every declared sheet has 16x16 cells. */
export const ITEM_ICON_CELL_PX = 16;
/** Upstream item art is authored at 24x24 and area-averaged down to 16x16. */
export const ITEM_ICON_SOURCE_PX = 24;
export const ITEM_ICON_PAK_KEY = keyTileset(ITEM_ICON_SHEET_ID);
const MOD_ROOT = "mods/tuxemon";
const ATLAS_COLS = 16;

export interface ItemIconPlan {
  /** Sheet declaration for `project.sheets`. */
  sheet: Sheet;
  /** Item slug -> `items.<cell>` sprite id, one entry per planned slug. */
  sprites: Record<string, string>;
  /** Cell index -> upstream art path (relative to the Tuxemon mod root),
   *  sorted by cell. The placeholder cell is absent. */
  cells: { cell: number; file: string }[];
  /** Cell index of the shared placeholder art. */
  placeholderCell: number;
  /** Item slugs whose DB row names no existing art. */
  missing: string[];
  /** Distinct upstream icon files baked into the atlas. */
  uniqueIcons: number;
}

/** Assign every item slug a deterministic atlas cell. Slugs with existing
 *  art share cells per unique file (upstream reuses one icon for many
 *  items — 65 items use `box.png`); the rest share the placeholder cell. */
export function planItemIcons(
  slugs: readonly string[],
  spriteOf: (slug: string) => string | undefined,
  sourceRoot: string = TUXEMON_SRC,
): ItemIconPlan {
  const modRoot = join(sourceRoot, MOD_ROOT);
  const artBySlug = new Map<string, string>();
  const missing: string[] = [];
  for (const slug of [...slugs].sort()) {
    const sprite = spriteOf(slug);
    if (sprite && existsSync(join(modRoot, sprite))) {
      artBySlug.set(slug, sprite);
    } else {
      missing.push(slug);
    }
  }
  const files = [...new Set(artBySlug.values())].sort();
  const cellByFile = new Map(files.map((file, index) => [file, index]));
  const placeholderCell = files.length;
  const rows = Math.ceil((files.length + 1) / ATLAS_COLS);
  const sprites: Record<string, string> = {};
  for (const slug of [...slugs].sort()) {
    const file = artBySlug.get(slug);
    const cell = file === undefined ? placeholderCell : cellByFile.get(file)!;
    sprites[slug] = `${ITEM_ICON_SHEET_ID}.${cell}`;
  }
  return {
    sheet: {
      id: ITEM_ICON_SHEET_ID,
      pak: ITEM_ICON_PAK_KEY,
      cols: ATLAS_COLS,
      rows,
      defaultPassage: "pass",
    },
    sprites,
    cells: files.map((file, index) => ({ cell: index, file })),
    placeholderCell,
    missing,
    uniqueIcons: files.length,
  };
}

export interface ItemIconBakeReport {
  uniqueIcons: number;
  missing: string[];
  /** Distinct colours in the assembled atlas before quantization (transparent
   *  is always counted). The shipped pak uses at most 256 palette entries. */
  colors: number;
  /** True when the atlas exceeded 256 colours and was quantized. */
  quantized: boolean;
  bytes: number;
}

/** The plan fields the baker needs (the import report carries exactly these). */
export type ItemIconBakePlan = Pick<ItemIconPlan, "sheet" | "cells" | "placeholderCell" | "missing" | "uniqueIcons">;

export interface ItemIconBake {
  blob: Uint8Array;
  pakKey: string;
  report: ItemIconBakeReport;
}

// --- palette ---------------------------------------------------------------

const TRANSPARENT = 0;

/** RGBA bytes -> the ABGR u32 word stored in a PocketJS CLUT. */
function abgr(r: number, g: number, b: number, a: number): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Alpha-zero texels are one canonical transparent colour regardless of RGB. */
function pixelWord(rgba: Uint8Array, offset: number): number {
  return rgba[offset + 3] === 0
    ? TRANSPARENT
    : abgr(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!);
}

interface Palette {
  words: Uint32Array;
  indices: Map<number, number>;
  quantized: boolean;
}

/** Exact palette when the atlas fits one CLUT8, else the 255 most frequent
 *  colours plus nearest-colour fallback (alpha included in the distance, so
 *  translucent edges stay sensible). Mirrors the terrain stream encoder. */
function makePalette(census: Map<number, number>): Palette {
  const ranked = [...census]
    .filter(([word]) => word !== TRANSPARENT)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const keep = ranked.slice(0, 255);
  const words = new Uint32Array(256);
  const indices = new Map<number, number>([[TRANSPARENT, 0]]);
  for (let i = 0; i < keep.length; i++) {
    words[i + 1] = keep[i]![0];
    indices.set(keep[i]![0], i + 1);
  }
  const quantized = ranked.length > keep.length;
  for (const [word] of ranked.slice(keep.length)) {
    const r = word & 0xff;
    const g = (word >>> 8) & 0xff;
    const b = (word >>> 16) & 0xff;
    const a = word >>> 24;
    let best = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= keep.length; i++) {
      const candidate = words[i]!;
      const dr = r - (candidate & 0xff);
      const dg = g - ((candidate >>> 8) & 0xff);
      const db = b - ((candidate >>> 16) & 0xff);
      const da = a - (candidate >>> 24);
      const distance = dr * dr + dg * dg + db * db + da * da;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    indices.set(word, best);
  }
  return { words, indices, quantized };
}

// --- raster helpers ---------------------------------------------------------

/** Area-average one 24x24 RGBA icon down to 16x16. The 3:2 ratio means each
 *  destination pixel covers a 1.5x1.5 source region; the two texels it
 *  overlaps contribute in proportion to their overlap area (the caller
 *  normalizes by the accumulated weight), and colours are premultiplied
 *  before averaging so translucent edges don't darken. */
export function downscaleIcon(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(ITEM_ICON_CELL_PX * ITEM_ICON_CELL_PX * 4);
  const ratio = ITEM_ICON_SOURCE_PX / ITEM_ICON_CELL_PX; // 1.5
  const axisWeights = (dest: number): [number, number][] => {
    // Destination pixel `dest` covers the source interval
    // [dest*1.5, dest*1.5+1.5). It overlaps texel s0=floor(start) by
    // (1-frac) and texel s0+1 by the remaining (1.5-(1-frac)): even dest
    // -> [1, 0.5], odd dest -> [0.5, 1]. Weights are unnormalized overlap
    // areas; the accumulation below divides by their 2.25 total. (dest < 16
    // keeps s0+1 <= 23, the last source texel.)
    const start = dest * ratio;
    const s0 = Math.floor(start);
    const frac = start - s0;
    const w0 = 1 - frac;
    return [[s0, w0], [s0 + 1, ratio - w0]];
  };
  for (let dy = 0; dy < ITEM_ICON_CELL_PX; dy++) {
    for (let dx = 0; dx < ITEM_ICON_CELL_PX; dx++) {
      let accR = 0, accG = 0, accB = 0, accA = 0, weight = 0;
      for (const [sy, wy] of axisWeights(dy)) {
        for (const [sx, wx] of axisWeights(dx)) {
          const w = wx * wy;
          const offset = (sy * ITEM_ICON_SOURCE_PX + sx) * 4;
          const a = source[offset + 3]!;
          accR += source[offset]! * a * w;
          accG += source[offset + 1]! * a * w;
          accB += source[offset + 2]! * a * w;
          accA += a * w;
          weight += w;
        }
      }
      const outOffset = (dy * ITEM_ICON_CELL_PX + dx) * 4;
      const alpha = Math.round(accA / weight);
      out[outOffset + 3] = alpha;
      if (alpha > 0) {
        out[outOffset] = Math.round(accR / accA);
        out[outOffset + 1] = Math.round(accG / accA);
        out[outOffset + 2] = Math.round(accB / accA);
      }
    }
  }
  return out;
}

/** Procedural 16x16 placeholder for items without upstream art: a dark gray
 *  tile with a lighter question mark. Deterministic, no art attribution. */
export function placeholderIcon(): Uint8Array {
  const size = ITEM_ICON_CELL_PX;
  const rgba = new Uint8Array(size * size * 4);
  const bg = [58, 58, 58, 255];
  const border = [106, 106, 106, 255];
  const ink = [200, 200, 200, 255];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const px = edge ? border : bg;
      rgba[offset] = px[0]!;
      rgba[offset + 1] = px[1]!;
      rgba[offset + 2] = px[2]!;
      rgba[offset + 3] = px[3]!;
    }
  }
  // 5x7 question mark, centered at (5, 4).
  const GLYPH = [
    "01110",
    "10001",
    "00001",
    "00010",
    "00100",
    "00000",
    "00100",
  ];
  for (let gy = 0; gy < GLYPH.length; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (GLYPH[gy]![gx] !== "1") continue;
      const offset = ((gy + 4) * size + (gx + 5)) * 4;
      rgba[offset] = ink[0]!;
      rgba[offset + 1] = ink[1]!;
      rgba[offset + 2] = ink[2]!;
      rgba[offset + 3] = ink[3]!;
    }
  }
  return rgba;
}

function isAbsent(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
}

/** Bake the planned atlas into one CLUT8 + RLE TILESET pak entry. */
export function bakeItemIcons(
  plan: ItemIconBakePlan,
  sourceRoot: string = TUXEMON_SRC,
): ItemIconBake {
  const { cols, rows } = plan.sheet;
  const atlasW = cols * ITEM_ICON_CELL_PX;
  const atlasH = rows * ITEM_ICON_CELL_PX;
  const atlas = new Uint8Array(atlasW * atlasH * 4);
  const blit = (cell: number, rgba: Uint8Array): void => {
    const ox = (cell % cols) * ITEM_ICON_CELL_PX;
    const oy = Math.floor(cell / cols) * ITEM_ICON_CELL_PX;
    for (let y = 0; y < ITEM_ICON_CELL_PX; y++) {
      const src = y * ITEM_ICON_CELL_PX * 4;
      const dst = ((oy + y) * atlasW + ox) * 4;
      atlas.set(rgba.subarray(src, src + ITEM_ICON_CELL_PX * 4), dst);
    }
  };
  const modRoot = join(sourceRoot, MOD_ROOT);
  for (const { cell, file } of plan.cells) {
    const image = decodePng(new Uint8Array(readFileSync(join(modRoot, file))), file);
    if (image.width !== ITEM_ICON_SOURCE_PX || image.height !== ITEM_ICON_SOURCE_PX) {
      throw new Error(`${file}: item icon must be ${ITEM_ICON_SOURCE_PX}x${ITEM_ICON_SOURCE_PX}, got ${image.width}x${image.height}`);
    }
    blit(cell, downscaleIcon(image.rgba));
  }
  blit(plan.placeholderCell, placeholderIcon());

  const census = new Map<number, number>();
  for (let i = 0; i < atlas.length; i += 4) {
    const word = pixelWord(atlas, i);
    census.set(word, (census.get(word) ?? 0) + 1);
  }
  if (!census.has(TRANSPARENT)) census.set(TRANSPARENT, 0);
  const palette = makePalette(census);
  const tiles: TilesetTile[] = [];
  for (let cell = 0; cell < cols * rows; cell++) {
    const ox = (cell % cols) * ITEM_ICON_CELL_PX;
    const oy = Math.floor(cell / cols) * ITEM_ICON_CELL_PX;
    const indices = new Uint8Array(ITEM_ICON_CELL_PX * ITEM_ICON_CELL_PX);
    let p = 0;
    for (let y = 0; y < ITEM_ICON_CELL_PX; y++) {
      for (let x = 0; x < ITEM_ICON_CELL_PX; x++) {
        const offset = ((oy + y) * atlasW + ox + x) * 4;
        indices[p++] = palette.indices.get(pixelWord(atlas, offset))!;
      }
    }
    // Fully transparent cells (none today — the placeholder is opaque — but
    // keep the door open for future art) cost only their directory entry.
    tiles.push(isAbsentCell(indices) ? { kind: "absent" } : { kind: "pixels", indices });
  }
  const blob = encodeTilesetEntry({
    tileW: ITEM_ICON_CELL_PX,
    tileH: ITEM_ICON_CELL_PX,
    cols,
    rows,
    flags: TILESET_FLAG_RLE,
    palette: palette.words,
    tiles,
  });
  return {
    blob,
    pakKey: ITEM_ICON_PAK_KEY,
    report: {
      uniqueIcons: plan.uniqueIcons,
      missing: plan.missing,
      colors: census.size,
      quantized: palette.quantized,
      bytes: blob.length,
    },
  };
}

function isAbsentCell(indices: Uint8Array): boolean {
  for (const index of indices) if (index !== 0) return false;
  return true;
}
