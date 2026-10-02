import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ITEM_ICON_CELL_PX,
  ITEM_ICON_PAK_KEY,
  ITEM_ICON_SHEET_ID,
  ITEM_ICON_SOURCE_PX,
  bakeItemIcons,
  downscaleIcon,
  placeholderIcon,
  planItemIcons,
} from "../importer/item-icons.ts";
import { buildProject, G6_IMPORT_OPTIONS } from "../importer/project.ts";
import { TUXEMON_SRC } from "../importer/source.ts";
import { TILESET_MAGIC } from "../vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/spec.ts";

const MOD_ROOT = join(TUXEMON_SRC, "mods/tuxemon");

/** Read the upstream item DB the same way the importer does: slug -> sprite. */
function upstreamItemSprites(): Map<string, string | undefined> {
  const bySlug = new Map<string, string | undefined>();
  for (const f of readdirSync(join(MOD_ROOT, "db/item")).sort()) {
    if (!f.endsWith(".yaml")) continue;
    const doc = Bun.YAML.parse(readFileSync(join(MOD_ROOT, "db/item", f), "utf8")) as
      | { slug: string; sprite?: string }
      | { slug: string; sprite?: string }[];
    for (const row of Array.isArray(doc) ? doc : [doc]) {
      if (!bySlug.has(row.slug)) bySlug.set(row.slug, row.sprite);
    }
  }
  return bySlug;
}

test("planItemIcons: every catalog item gets a cell on the declared sheet", () => {
  const db = upstreamItemSprites();
  const plan = planItemIcons([...db.keys()], (slug) => db.get(slug), TUXEMON_SRC);
  expect(plan.sheet.id).toBe(ITEM_ICON_SHEET_ID);
  expect(plan.sheet.pak).toBe(ITEM_ICON_PAK_KEY);
  expect(plan.sheet.cols).toBe(16);
  expect(plan.sheet.cols * plan.sheet.rows).toBeGreaterThanOrEqual(plan.uniqueIcons + 1);
  // Every slug has a sprite ref on the items sheet.
  for (const slug of db.keys()) {
    const sprite = plan.sprites[slug];
    expect(sprite).toBeDefined();
    expect(sprite!.startsWith(`${ITEM_ICON_SHEET_ID}.`)).toBe(true);
  }
  // No two distinct icon files share a cell.
  const cells = new Set(plan.cells.map((c) => c.cell));
  expect(cells.size).toBe(plan.cells.length);
  expect(plan.placeholderCell).toBe(plan.uniqueIcons);
});

test("planItemIcons: items without art share the placeholder cell", () => {
  const db = upstreamItemSprites();
  const slugs = [...db.keys(), "elianeoutput"]; // not in the upstream DB
  const plan = planItemIcons(slugs, (slug) => db.get(slug), TUXEMON_SRC);
  expect(plan.missing).toEqual(["elianeoutput"]);
  expect(plan.sprites["elianeoutput"]).toBe(`${ITEM_ICON_SHEET_ID}.${plan.placeholderCell}`);
  // A DB item with art gets a real cell, not the placeholder.
  const potion = plan.sprites["potion"];
  expect(potion).toBeDefined();
  expect(potion).not.toBe(`${ITEM_ICON_SHEET_ID}.${plan.placeholderCell}`);
});

test("planItemIcons: shared upstream icons share one cell", () => {
  const db = upstreamItemSprites();
  const plan = planItemIcons([...db.keys()], (slug) => db.get(slug), TUXEMON_SRC);
  // 65 items use box.png upstream; they must all map to the same cell.
  const boxSlugs = [...db.entries()].filter(([, sprite]) => sprite === "gfx/items/box.png").map(([slug]) => slug);
  expect(boxSlugs.length).toBeGreaterThan(10);
  const cells = new Set(boxSlugs.map((slug) => plan.sprites[slug]));
  expect(cells.size).toBe(1);
});

test("planItemIcons: deterministic", () => {
  const db = upstreamItemSprites();
  const slugs = [...db.keys()];
  const a = planItemIcons(slugs, (slug) => db.get(slug), TUXEMON_SRC);
  const b = planItemIcons([...slugs].reverse(), (slug) => db.get(slug), TUXEMON_SRC);
  expect(b.sprites).toEqual(a.sprites);
  expect(b.cells).toEqual(a.cells);
});

test("bakeItemIcons: valid TILESET header and deterministic bytes", () => {
  const db = upstreamItemSprites();
  const plan = planItemIcons([...db.keys()], (slug) => db.get(slug), TUXEMON_SRC);
  const bake = bakeItemIcons(plan, TUXEMON_SRC);
  // Header: magic, version, flags, tileW/H, cols/rows.
  const view = new DataView(bake.blob.buffer, bake.blob.byteOffset, bake.blob.byteLength);
  expect(view.getUint32(0, true)).toBe(TILESET_MAGIC);
  expect(view.getUint16(4, true)).toBe(1);
  expect(view.getUint16(8, true)).toBe(ITEM_ICON_CELL_PX);
  expect(view.getUint16(10, true)).toBe(ITEM_ICON_CELL_PX);
  expect(view.getUint16(12, true)).toBe(plan.sheet.cols);
  expect(view.getUint16(14, true)).toBe(plan.sheet.rows);
  expect(bake.report.uniqueIcons).toBe(plan.uniqueIcons);
  expect(bake.report.colors).toBeGreaterThan(0);
  // Baking twice yields identical bytes.
  const again = bakeItemIcons(plan, TUXEMON_SRC);
  expect(again.blob).toEqual(bake.blob);
});

test("bakeItemIcons: placeholder cell is opaque and present", () => {
  const db = upstreamItemSprites();
  const plan = planItemIcons([...db.keys(), "elianeoutput"], (slug) => db.get(slug), TUXEMON_SRC);
  const bake = bakeItemIcons(plan, TUXEMON_SRC);
  expect(bake.report.missing).toContain("elianeoutput");
  // The placeholder glyph is opaque (alpha 255 somewhere in its 16x16 cell).
  const ph = placeholderIcon();
  let opaque = 0;
  for (let i = 3; i < ph.length; i += 4) if (ph[i] === 255) opaque++;
  expect(opaque).toBeGreaterThan(100);
});

test("downscaleIcon: solid colour stays solid", () => {
  const source = new Uint8Array(ITEM_ICON_SOURCE_PX * ITEM_ICON_SOURCE_PX * 4);
  for (let i = 0; i < source.length; i += 4) {
    source[i] = 200; source[i + 1] = 100; source[i + 2] = 50; source[i + 3] = 255;
  }
  const out = downscaleIcon(source);
  expect(out.length).toBe(ITEM_ICON_CELL_PX * ITEM_ICON_CELL_PX * 4);
  for (let i = 0; i < out.length; i += 4) {
    expect(out[i + 3]).toBe(255);
    expect(Math.abs(out[i]! - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(out[i + 1]! - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(out[i + 2]! - 50)).toBeLessThanOrEqual(1);
  }
});

test("downscaleIcon: transparent stays transparent", () => {
  const source = new Uint8Array(ITEM_ICON_SOURCE_PX * ITEM_ICON_SOURCE_PX * 4); // all zero
  const out = downscaleIcon(source);
  for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(0);
});

// --- area-average oracle (independent implementation) -----------------------

/** Independent box-filter downscale: for each destination pixel, sum every
 *  source texel weighted by the exact overlap area of the two rectangles.
 *  Written independently of downscaleIcon's two-texel shortcut so the two
 *  can only agree if both compute the true 1.5px-coverage area average. */
function oracleDownscale(source: Uint8Array): Uint8Array {
  const S = ITEM_ICON_SOURCE_PX;
  const D = ITEM_ICON_CELL_PX;
  const ratio = S / D;
  const out = new Uint8Array(D * D * 4);
  const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  for (let dy = 0; dy < D; dy++) {
    for (let dx = 0; dx < D; dx++) {
      const rx0 = dx * ratio;
      const rx1 = rx0 + ratio;
      const ry0 = dy * ratio;
      const ry1 = ry0 + ratio;
      let accR = 0, accG = 0, accB = 0, accA = 0, area = 0;
      for (let sy = Math.floor(ry0); sy < Math.ceil(ry1); sy++) {
        for (let sx = Math.floor(rx0); sx < Math.ceil(rx1); sx++) {
          const w = overlap(rx0, rx1, sx, sx + 1) * overlap(ry0, ry1, sy, sy + 1);
          if (w <= 0) continue;
          const o = (sy * S + sx) * 4;
          const a = source[o + 3]!;
          accR += source[o]! * a * w;
          accG += source[o + 1]! * a * w;
          accB += source[o + 2]! * a * w;
          accA += a * w;
          area += w;
        }
      }
      const o = (dy * D + dx) * 4;
      const alpha = Math.round(accA / area);
      out[o + 3] = alpha;
      if (alpha > 0) {
        out[o] = Math.round(accR / accA);
        out[o + 1] = Math.round(accG / accA);
        out[o + 2] = Math.round(accB / accA);
      }
    }
  }
  return out;
}

test("downscaleIcon: matches an exact area-average oracle on non-uniform art", () => {
  // Every texel a distinct colour with mixed alpha (zero, translucent,
  // opaque). Uniform fixtures are invariant under almost any kernel; this
  // one changes whenever the 1.5px overlap weights are wrong.
  const source = new Uint8Array(ITEM_ICON_SOURCE_PX * ITEM_ICON_SOURCE_PX * 4);
  for (let sy = 0; sy < ITEM_ICON_SOURCE_PX; sy++) {
    for (let sx = 0; sx < ITEM_ICON_SOURCE_PX; sx++) {
      const o = (sy * ITEM_ICON_SOURCE_PX + sx) * 4;
      source[o] = (sx * 13 + sy * 7) & 0xff;
      source[o + 1] = (sx * 5 + sy * 11) & 0xff;
      source[o + 2] = (sx * 17 + sy * 3) & 0xff;
      source[o + 3] = (sx + sy) % 3 === 0 ? 0 : (sx * 29 + sy * 31) & 0xff;
    }
  }
  expect(downscaleIcon(source)).toEqual(oracleDownscale(source));
});

test("downscaleIcon: hand-computed 1.5px overlap weights", () => {
  // Column sx is solid red = sx*10, fully opaque. Destination column dx
  // covers source columns [dx*1.5, dx*1.5+1.5):
  //   dx=0 -> col 0 (w 1) + col 1 (w 0.5): (0 + 5)/1.5 = 3.33 -> 3
  //   dx=1 -> col 1 (w 0.5) + col 2 (w 1):  (5 + 20)/1.5 = 16.67 -> 17
  //   dx=2 -> col 3 (w 1) + col 4 (w 0.5): (30 + 20)/1.5 = 33.33 -> 33
  //   dx=15 -> col 22 (w 0.5) + col 23 (w 1): (110 + 230)/1.5 = 226.67 -> 227
  const source = new Uint8Array(ITEM_ICON_SOURCE_PX * ITEM_ICON_SOURCE_PX * 4);
  for (let sy = 0; sy < ITEM_ICON_SOURCE_PX; sy++) {
    for (let sx = 0; sx < ITEM_ICON_SOURCE_PX; sx++) {
      const o = (sy * ITEM_ICON_SOURCE_PX + sx) * 4;
      source[o] = sx * 10;
      source[o + 3] = 255;
    }
  }
  const out = downscaleIcon(source);
  const red = (dx: number, dy: number): number => out[(dy * ITEM_ICON_CELL_PX + dx) * 4]!;
  expect(red(0, 0)).toBe(3);
  expect(red(1, 0)).toBe(17);
  expect(red(2, 0)).toBe(33);
  expect(red(15, 0)).toBe(227);
});

test("downscaleIcon: premultiplied alpha at translucent edges", () => {
  // Column 0 opaque red, column 1 transparent, the rest opaque black.
  // Destination (0,0) covers col 0 (w 1) + col 1 (w 0.5): premultiplied
  // averaging gives alpha = round(255/1.5) = 170 and red = 255 (the red is
  // not darkened by the transparent texel). A straight average would give
  // red 170; the old even-column kernel gave alpha 255.
  const source = new Uint8Array(ITEM_ICON_SOURCE_PX * ITEM_ICON_SOURCE_PX * 4);
  for (let sy = 0; sy < ITEM_ICON_SOURCE_PX; sy++) {
    for (let sx = 0; sx < ITEM_ICON_SOURCE_PX; sx++) {
      const o = (sy * ITEM_ICON_SOURCE_PX + sx) * 4;
      if (sx === 0) {
        source[o] = 255;
        source[o + 3] = 255;
      } else if (sx > 1) {
        source[o + 3] = 255;
      }
    }
  }
  const out = downscaleIcon(source);
  expect(out[3]).toBe(170);
  expect(out[0]).toBe(255);
});

test("buildProject: item sprites resolve to the declared items sheet", () => {
  const imported = buildProject(["spyder_cotton_scoop", "spyder_flower_scoop"], G6_IMPORT_OPTIONS);
  const sheetIds = new Set(imported.project.sheets.map((s) => s.id));
  expect(sheetIds.has(ITEM_ICON_SHEET_ID)).toBe(true);
  const itemsSheet = imported.project.sheets.find((s) => s.id === ITEM_ICON_SHEET_ID)!;
  for (const item of imported.project.items) {
    const dot = item.sprite.indexOf(".");
    expect(dot).toBeGreaterThan(0);
    const sheet = item.sprite.slice(0, dot);
    expect(sheet).toBe(ITEM_ICON_SHEET_ID);
    const cell = Number(item.sprite.slice(dot + 1));
    expect(Number.isInteger(cell)).toBe(true);
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cell).toBeLessThan(itemsSheet.cols * itemsSheet.rows);
  }
  // The report carries the bake plan.
  expect(imported.report.itemIcons.uniqueIcons).toBeGreaterThan(0);
  expect(imported.report.itemIcons.placeholderCell).toBe(imported.report.itemIcons.uniqueIcons);
});
