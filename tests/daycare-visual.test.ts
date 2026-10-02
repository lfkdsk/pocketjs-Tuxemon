import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

import { decodePng } from "../importer/png.ts";
import {
  captureDaycare,
  DAYCARE_VISUAL_CASES,
  type DaycareVisualCase,
} from "../tools/daycare-visual-fixture.ts";
import { TUXEMON_UI_THEME } from "../ui/tuxemon-theme.ts";
import { fnv1a, treeHasText } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const WASM = join(ROOT, "vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/pocketjs.wasm");
const MANIFEST = join(ROOT, "data/daycare-goldens.json");
const canBoot = existsSync(BUNDLE + ".js") && existsSync(BUNDLE + ".pak")
  && existsSync(WASM) && existsSync(MANIFEST);
if (!canBoot) console.warn("daycare visual tests skipped; run `bun run build && bun run build:wasm && bun tools/update-daycare-goldens.ts`");
const simTest = canBoot ? test : test.skip;

interface GoldenEntry {
  case: DaycareVisualCase;
  width: number;
  height: number;
  file: string;
  rgbaFnv1a: string;
  pngSha256: string;
}

const manifest = canBoot
  ? JSON.parse(readFileSync(MANIFEST, "utf8")) as { format: string; frames: GoldenEntry[] }
  : { format: "", frames: [] };

function rgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function countColour(
  rgba: Uint8Array,
  width: number,
  rect: { x: number; y: number; width: number; height: number },
  colour: readonly [number, number, number],
): number {
  let total = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
    const offset = (y * width + x) * 4;
    if (rgba[offset] === colour[0] && rgba[offset + 1] === colour[1] && rgba[offset + 2] === colour[2]) total++;
  }
  return total;
}

let captured: ReturnType<typeof captureDaycare> | undefined;
const frames = () => captured ??= captureDaycare();

describe("daycare production scene visuals", () => {
  simTest("match committed PNGs and retain every localized label", async () => {
    expect(manifest.format).toBe("pocket-tuxemon/daycare-goldens/v1");
    expect(manifest.frames).toHaveLength(DAYCARE_VISUAL_CASES.length);
    const capture = await frames();
    for (const visualCase of DAYCARE_VISUAL_CASES) {
      const entry = manifest.frames.find((candidate) => candidate.case === visualCase)!;
      const path = join(ROOT, "tests/goldens", entry.file);
      const png = new Uint8Array(readFileSync(path));
      const decoded = decodePng(png, path);
      expect(capture.cases[visualCase].rgba).toEqual(decoded.rgba);
      expect(fnv1a(decoded.rgba)).toBe(entry.rgbaFnv1a);
      expect(createHash("sha256").update(png).digest("hex")).toBe(entry.pngSha256);
      expect(JSON.stringify(capture.cases[visualCase].tree)).not.toContain("…");
    }
    expect(treeHasText(capture.cases.ready.tree, "Progress: 10000/10000")).toBeTrue();
    expect(treeHasText(capture.cases.ready.tree, "Newborn Ready!")).toBeTrue();
    expect(treeHasText(capture.cases.party.tree, "Rockitten")).toBeTrue();
    expect(treeHasText(capture.cases.party.tree, "Nut")).toBeTrue();
  }, 60_000);

  simTest("selection panels paint semantic accent regions", async () => {
    const capture = await frames();
    const accent = rgb(TUXEMON_UI_THEME.accent);
    expect(countColour(
      capture.cases.ready.rgba,
      capture.width,
      { x: 326, y: 32, width: 146, height: 194 },
      accent,
    )).toBeGreaterThan(3_000);
    expect(countColour(
      capture.cases.party.rgba,
      capture.width,
      { x: 8, y: 32, width: 312, height: 194 },
      accent,
    )).toBeGreaterThan(4_000);
  }, 60_000);
});
