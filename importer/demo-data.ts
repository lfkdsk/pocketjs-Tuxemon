// Demo chapter tape and snapshot packaging for the web demo menu.
//
// The complete mainline tape is ~186k u16 button masks.
// Inlining it in the JS bundle would bloat every page load, so the importer
// packs it as a compact binary and the 15 chapter snapshots as a JSON map;
// both become pak entries the game reads on demand when a chapter is first
// selected (see ui/demo-tape.ts). Only the tiny chapter index (id, title,
// tape offset) is inline.
//
// The masks use just 9 distinct values, so the tape is a nibble dictionary:
// a u16 table plus one 4-bit index per frame (86 KB versus 344 KB raw u16
// or 479 KB JSON). A tape with more than 16 distinct masks falls back to
// raw u16 so the format stays self-describing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PakManifestEntry } from "../vendor/pocket-rpgkit/tools/lib/stream.ts";
import type { WarpIndex } from "./warp.ts";

export const DEMO_TAPE_ENTRY = "demo/tape.bin";
export const DEMO_SNAPSHOTS_ENTRY = "demo/chapters.json";
export const DEMO_SNAPSHOTS_FORMAT = "pocket-tuxemon/demo-snapshots/v1";

const TAPE_MAGIC = 0x54; // 'T'
const TAPE_VERSION = 1;
const TAPE_FMT_NIBBLE = 1;
const TAPE_FMT_RAW = 2;
const MAX_DICT = 16;

interface JourneyFile {
  masks: number[];
}

interface ChapterRecord {
  id: string;
  title: string;
  map: string;
  position: [number, number];
  frame: number;
  timelineFrame: number;
  held: number;
  suffixFrames: number;
  snapshot: string;
}

interface ChaptersFile {
  format: string;
  chapters: ChapterRecord[];
}

export interface DemoChapterIndexEntry {
  id: string;
  title: string;
  /** First mask of the chapter's tape suffix in the combined tape. */
  frame: number;
  suffixFrames: number;
  /** Global reducer frame at the checkpoint (the snapshot carries only the
   *  per-map clock, which diverges after a map transfer). */
  timelineFrame: number;
}

export interface DemoSpawnIndexEntry {
  id: string;
  x: number;
  y: number;
}

export interface DemoDataBuild {
  tapeBytes: Uint8Array;
  snapshotsJson: string;
  pakEntries: PakManifestEntry[];
  index: DemoChapterIndexEntry[];
  spawns: DemoSpawnIndexEntry[];
}

/** Pack a u16 button-mask stream into the self-describing tape binary. */
export function encodeTape(masks: readonly number[]): Uint8Array {
  const distinct = [...new Set(masks)].sort((a, b) => a - b);
  const header = new Uint8Array(8);
  header[0] = TAPE_MAGIC;
  header[1] = TAPE_VERSION;
  const view = new DataView(header.buffer);
  view.setUint32(4, masks.length, true);
  if (distinct.length > MAX_DICT) {
    header[2] = TAPE_FMT_RAW;
    const out = new Uint8Array(8 + masks.length * 2);
    out.set(header);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < masks.length; i++) dv.setUint16(8 + i * 2, masks[i]!, true);
    return out;
  }
  header[2] = TAPE_FMT_NIBBLE;
  header[3] = distinct.length;
  const packedLen = (masks.length + 1) >> 1;
  const out = new Uint8Array(8 + distinct.length * 2 + packedLen);
  out.set(header);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < distinct.length; i++) dv.setUint16(8 + i * 2, distinct[i]!, true);
  const codes = new Map<number, number>(distinct.map((mask, i) => [mask, i]));
  const base = 8 + distinct.length * 2;
  for (let i = 0; i < masks.length; i += 2) {
    const lo = codes.get(masks[i]!)!;
    const hi = i + 1 < masks.length ? codes.get(masks[i + 1]!)! : 0;
    out[base + (i >> 1)] = lo | (hi << 4);
  }
  return out;
}

/** Read the committed chapter snapshots and the four journey tapes, pack
 *  them, and return the pak entries plus the inline chapter index. The warp
 *  index contributes the non-blocked spawns (blocked maps have no standable
 *  event-free cell and are left to the runtime's visible-error path). */
export function buildDemoData(root: string, warp: WarpIndex): DemoDataBuild {
  const chaptersPath = join(root, "data/chapters.json");
  const chaptersFile = JSON.parse(readFileSync(chaptersPath, "utf8")) as ChaptersFile;
  if (chaptersFile.format !== "pocket-tuxemon/chapters/v1") {
    throw new Error(`demo-data: unexpected chapters format ${chaptersFile.format}`);
  }
  const tapeFiles = [
    "data/gb6-mainline-journey.json",
    "data/j1-captainreturns-journey.json",
    "data/j2-hospitalcure-journey.json",
    "data/j3-omnichannelradioannounce-journey.json",
  ];
  const masks: number[] = [];
  for (const file of tapeFiles) {
    const journey = JSON.parse(readFileSync(join(root, file), "utf8")) as JourneyFile;
    if (!Array.isArray(journey.masks)) throw new Error(`demo-data: ${file} has no masks`);
    masks.push(...journey.masks);
  }
  const tapeBytes = encodeTape(masks);
  const snapshots: Record<string, string> = {};
  const index: DemoChapterIndexEntry[] = [];
  for (const chapter of chaptersFile.chapters) {
    snapshots[chapter.id] = chapter.snapshot;
    index.push({
      id: chapter.id,
      title: chapter.title,
      frame: chapter.frame,
      suffixFrames: chapter.suffixFrames,
      timelineFrame: chapter.timelineFrame,
    });
  }
  const snapshotsJson = JSON.stringify({
    format: DEMO_SNAPSHOTS_FORMAT,
    frames: masks.length,
    snapshots,
  }) + "\n";
  const spawns: DemoSpawnIndexEntry[] = warp.maps
    .filter((map) => map.from !== "blocked")
    .map((map) => ({ id: map.id, x: map.x, y: map.y }));
  return {
    tapeBytes,
    snapshotsJson,
    pakEntries: [
      { key: DEMO_TAPE_ENTRY, file: "dist/demo/tape.bin" },
      { key: DEMO_SNAPSHOTS_ENTRY, file: "dist/demo/chapters.json" },
    ],
    index,
    spawns,
  };
}

/** The generated ui/demo-index.ts source: the tiny inline index the bundle
 *  needs to build lazy chapter objects. Snapshots and tape stay in the pak. */
export function demoIndexSource(
  index: readonly DemoChapterIndexEntry[],
  spawns: readonly DemoSpawnIndexEntry[],
): string {
  return (
    "// AUTO-GENERATED by gen-assets.ts — do not edit.\n" +
    "// The chapter snapshots and the mainline tape live in the pak (entries\n" +
    "// below) and are read on demand when a chapter is first selected.\n" +
    `export const DEMO_TAPE_ENTRY = ${JSON.stringify(DEMO_TAPE_ENTRY)};\n` +
    `export const DEMO_SNAPSHOTS_ENTRY = ${JSON.stringify(DEMO_SNAPSHOTS_ENTRY)};\n\n` +
    `export const DEMO_CHAPTER_INDEX = ${JSON.stringify(index, null, 2)} as const;\n\n` +
    `export const DEMO_WARP_SPAWNS = ${JSON.stringify(spawns, null, 2)} as const;\n`
  );
}
