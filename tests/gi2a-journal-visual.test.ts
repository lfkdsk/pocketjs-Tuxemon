import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

import { decodePng } from "../importer/png.ts";
import {
  captureGi2aJournal,
  GI2A_JOURNAL_VIEWPORTS,
  GI2A_VISUAL_CASES,
  type Gi2aVisualCase,
} from "../tools/gi2a-journal-fixture.ts";
import { TUXEMON_UI_THEME } from "../ui/tuxemon-theme.ts";
import { fnv1a, treeHasText } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const WASM = join(ROOT, "vendor/pocket-rpgkit/vendor/pocketjs/hosts/web/pocketjs.wasm");
const MANIFEST = join(ROOT, "data/gi2a-journal-goldens.json");
const canBoot = existsSync(BUNDLE + ".js") && existsSync(BUNDLE + ".pak") &&
  existsSync(WASM) && existsSync(MANIFEST);
if (!canBoot) console.warn("GI2a journal visual tests skipped; run `bun run build && bun run build:wasm && bun tools/update-gi2a-goldens.ts`");
const simTest = canBoot ? test : test.skip;

interface GoldenEntry {
  case: Gi2aVisualCase;
  width: number;
  height: number;
  file: string;
  rgbaFnv1a: string;
  pngSha256: string;
  selected: { index: number; id: string; name: string; description: string; artPath: string; front: [number, number, number, number] };
}

interface TreeNode {
  n?: string;
  x?: string;
  k?: TreeNode[];
}

function namedNode(value: unknown, name: string): TreeNode | undefined {
  const node = value as TreeNode;
  if (node?.n === name) return node;
  for (const child of node?.k ?? []) {
    const found = namedNode(child, name);
    if (found) return found;
  }
  return undefined;
}

function nodeText(node: TreeNode | undefined): string {
  return node ? `${node.x ?? ""}${(node.k ?? []).map(nodeText).join("")}` : "";
}

const manifest = canBoot
  ? JSON.parse(readFileSync(MANIFEST, "utf8")) as { format: string; frames: GoldenEntry[] }
  : { format: "", frames: [] };

function rgb(hex: string): readonly [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function countColour(
  rgba: Uint8Array,
  width: number,
  rect: { x: number; y: number; width: number; height: number },
  colour: readonly [number, number, number],
): number {
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
    const offset = (y * width + x) * 4;
    if (rgba[offset] === colour[0] && rgba[offset + 1] === colour[1] && rgba[offset + 2] === colour[2]) count++;
  }
  return count;
}

function twoXSimilarity(small: Uint8Array, large: Uint8Array): { exactRatio: number; meanChannelError: number } {
  let exactBlocks = 0;
  let channelError = 0;
  for (let y = 0; y < 272; y++) for (let x = 0; x < 480; x++) {
    const source = (y * 480 + x) * 4;
    let exact = true;
    for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
      const target = ((y * 2 + oy) * 960 + x * 2 + ox) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const difference = Math.abs(large[target + channel]! - small[source + channel]!);
        channelError += difference;
        if (difference !== 0) exact = false;
      }
    }
    if (exact) exactBlocks++;
  }
  return {
    exactRatio: exactBlocks / (480 * 272),
    meanChannelError: channelError / (480 * 272 * 4 * 4),
  };
}

function assertFrontSprite(capture: Awaited<ReturnType<typeof captureGi2aJournal>>): void {
  const image = decodePng(
    new Uint8Array(readFileSync(join(ROOT, capture.selected.artPath))),
    capture.selected.artPath,
  );
  const [sourceX, sourceY, width, height] = capture.selected.front;
  let opaque = 0;
  let farRight = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = ((sourceY + y) * image.width + sourceX + x) * 4;
    if (image.rgba[source + 3] !== 255) continue;
    const expected = [...image.rgba.slice(source, source + 3)]
      .map((channel) => Math.floor(channel / 16) * 17);
    const target = ((64 + y * 2) * 480 + 274 + x * 2) * 4;
    expect([...capture.rgba.slice(target, target + 3)], `front sprite ${x},${y}`).toEqual(expected);
    opaque++;
    if (x >= 48) farRight++;
  }
  expect(opaque).toBeGreaterThan(1_000);
  // This specifically fails if the old +32 px image offset crops source
  // columns 48..63 from the 128 px detail viewport.
  expect(farRight).toBeGreaterThan(100);
}

let captures: Promise<{
  small: Awaited<ReturnType<typeof captureGi2aJournal>>;
  large: Awaited<ReturnType<typeof captureGi2aJournal>>;
}> | undefined;
function captured() {
  return captures ??= (async () => ({
    small: await captureGi2aJournal(GI2A_JOURNAL_VIEWPORTS[0]),
    large: await captureGi2aJournal(GI2A_JOURNAL_VIEWPORTS[1]),
  }))();
}

describe("GI2a production Tuxepedia visuals", () => {
  simTest("matches both committed viewports with readable state and art", async () => {
    expect(manifest.format).toBe("pocket-tuxemon/gi2a-journal-goldens/v2");
    expect(manifest.frames).toHaveLength(GI2A_JOURNAL_VIEWPORTS.length * GI2A_VISUAL_CASES.length);
    const { small, large } = await captured();
    for (const [viewport, capture] of GI2A_JOURNAL_VIEWPORTS.map((viewport, index) =>
      [viewport, index === 0 ? small : large] as const)) {
      for (const visualCase of GI2A_VISUAL_CASES) {
        const entry = manifest.frames.find((candidate) =>
          candidate.case === visualCase
          && candidate.width === viewport.width
          && candidate.height === viewport.height);
        if (!entry) throw new Error(`GI2a ${visualCase} golden: missing ${viewport.width}x${viewport.height}`);
        const path = join(ROOT, "tests/goldens", entry.file);
        const png = new Uint8Array(readFileSync(path));
        const expected = decodePng(png, path);
        const frame = capture.cases[visualCase];
        expect([expected.width, expected.height]).toEqual([viewport.width, viewport.height]);
        expect(frame.rgba).toEqual(expected.rgba);
        expect(fnv1a(frame.rgba)).toBe(entry.rgbaFnv1a);
        expect(createHash("sha256").update(png).digest("hex")).toBe(entry.pngSha256);
      }
      expect(capture.state).toMatchObject({
        kind: "journal",
        seen: ["budaye"],
        caught: ["embazook"],
        revealed: "ignibus",
        phase: "browse",
      });
      expect(capture.selected).toMatchObject({
        id: "ignibus",
        name: "Ignibus",
        description: "When threatened it retreats into its shell and cools down dramatically by venting steam. It could be mistaken for a rock.",
      });
      expect(treeHasText(capture.tree, "Ignibus")).toBeTrue();
      expect(treeHasText(capture.tree, "PREVIEW")).toBeTrue();
      expect(treeHasText(capture.tree, "Fire   68 cm   27 kg")).toBeTrue();
      expect(JSON.stringify(capture.tree)).toContain("When threatened it retreats into its");
    }
  }, 60_000);

  simTest("distinguishes persistent journal states and both rename screens", async () => {
    const { small } = await captured();
    const unknown = small.cases.unknown.tree;
    const seen = small.cases.seen.tree;
    const caught = small.cases.caught.tree;
    const rowName = `journal-row-${small.selected.index}`;

    expect(nodeText(namedNode(unknown, "journal-monster-name"))).toBe("Unknown Tuxemon");
    expect(nodeText(namedNode(unknown, "journal-status"))).toBe("UNKNOWN");
    expect(nodeText(namedNode(unknown, rowName))).toBe("#030????");
    expect(namedNode(unknown, "journal-monster-art")).toBeUndefined();

    expect(nodeText(namedNode(seen, "journal-monster-name"))).toBe("Ignibus");
    expect(nodeText(namedNode(seen, "journal-status"))).toBe("SEEN");
    expect(nodeText(namedNode(seen, rowName))).toBe("#030IgnibusS");
    expect(namedNode(seen, "journal-monster-art")).toBeDefined();

    expect(nodeText(namedNode(caught, "journal-monster-name"))).toBe("Ignibus");
    expect(nodeText(namedNode(caught, "journal-status"))).toBe("CAUGHT");
    expect(nodeText(namedNode(caught, rowName))).toBe("#030IgnibusC");
    expect(namedNode(caught, "journal-monster-art")).toBeDefined();

    expect(new Set([
      fnv1a(small.cases.unknown.rgba),
      fnv1a(small.cases.seen.rgba),
      fnv1a(small.cases.caught.rgba),
    ]).size).toBe(3);
    expect(namedNode(small.cases.picker.tree, "tux-monster-picker-scene")).toBeDefined();
    expect(treeHasText(small.cases.picker.tree, "Six")).toBeTrue();
    expect(namedNode(small.cases.nameInput.tree, "rpgkit-name-input-scene")).toBeDefined();
    expect(treeHasText(small.cases.nameInput.tree, "Ignibus")).toBeTrue();
  }, 60_000);

  simTest("renders selection, detail, and exact two-times composition", async () => {
    const { small, large } = await captured();
    const accent = rgb(TUXEMON_UI_THEME.accent);
    const paper = rgb(TUXEMON_UI_THEME.paper);
    // The selected Rockitten row is the fifth visible row. Its accent fill
    // and the detail paper must both occupy substantial, separate regions.
    expect(countColour(small.rgba, 480, { x: 15, y: 149, width: 176, height: 24 }, accent))
      .toBeGreaterThan(2_500);
    expect(countColour(small.rgba, 480, { x: 206, y: 34, width: 264, height: 228 }, paper))
      .toBeGreaterThan(30_000);
    assertFrontSprite(small);
    expect(treeHasText(small.picker.tree, "Six")).toBeTrue();
    expect(treeHasText(small.picker.tree, "A: rename B: return")).toBeTrue();
    expect(countColour(small.picker.rgba, 480, { x: 84, y: 190, width: 312, height: 21 }, accent))
      .toBeGreaterThan(5_000);
    // The footer begins below y=218; a full six-entry party leaves a paper
    // gap instead of painting the sixth selection through its instructions.
    expect(countColour(small.picker.rgba, 480, { x: 84, y: 212, width: 312, height: 5 }, accent)).toBe(0);
    const similarity = twoXSimilarity(small.rgba, large.rgba);
    // The list/detail screen contains substantially more target-rasterised
    // glyph coverage than the battle UI; panels and sprite remain exact 2x,
    // while those glyph edges account for the bounded difference here.
    expect(similarity.exactRatio).toBeGreaterThan(0.89);
    expect(similarity.meanChannelError).toBeLessThan(2.2);
  }, 60_000);
});
