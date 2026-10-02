// Lazy demo chapter loading: the mainline tape and the chapter snapshots
// live in the pak as compact entries (see importer/demo-data.ts) and are
// read on demand when a chapter is first selected, so the bundle keeps only
// the tiny generated index (ui/demo-index.ts). Every chapter names the same
// tape provider with its own window; the kit's demo runtime calls that
// provider once and windows the decoded tape without copying it.

import { decodeEnvelopeText, type SaveSnapshot } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import type { DemoChapter, DemoOptions, DemoSpawn } from "../vendor/pocket-rpgkit/src/ui/demo/types.ts";
import {
  DEMO_CHAPTER_INDEX,
  DEMO_SNAPSHOTS_ENTRY,
  DEMO_TAPE_ENTRY,
  DEMO_WARP_SPAWNS,
} from "./demo-index.ts";

const TAPE_FMT_NIBBLE = 1;
const TAPE_FMT_RAW = 2;

let snapshotsCache: Record<string, string> | null = null;

/** Decode the self-describing tape binary (nibble dictionary or raw u16)
 *  into one contiguous u16 mask stream. */
function decodeTape(bytes: Uint8Array): Uint16Array {
  if (bytes[0] !== 0x54 || bytes[1] !== 1) throw new Error("demo tape: bad magic or version");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = dv.getUint32(4, true);
  const format = bytes[2];
  if (format === TAPE_FMT_RAW) {
    const out = new Uint16Array(frames);
    for (let i = 0; i < frames; i++) out[i] = dv.getUint16(8 + i * 2, true);
    return out;
  }
  if (format !== TAPE_FMT_NIBBLE) throw new Error(`demo tape: unknown format ${format}`);
  const dictSize = bytes[3]!;
  const dict = new Uint16Array(dictSize);
  for (let i = 0; i < dictSize; i++) dict[i] = dv.getUint16(8 + i * 2, true);
  const base = 8 + dictSize * 2;
  const out = new Uint16Array(frames);
  for (let i = 0; i < frames; i++) {
    const byte = bytes[base + (i >> 1)]!;
    out[i] = dict[(i & 1) === 0 ? byte & 0xf : byte >> 4]!;
  }
  return out;
}

/** Build the kit DemoOptions from the generated index. All chapters share
 *  one provider for the combined tape and window it by their index entry;
 *  the snapshot getter decodes the envelope on first selection. Neither
 *  touches the pak at boot. */
export function createDemoOptions(read: (entry: string) => Uint8Array): DemoOptions {
  const tape = (): Uint16Array => decodeTape(read(DEMO_TAPE_ENTRY));
  const snapshots = (): Record<string, string> => {
    if (!snapshotsCache) {
      const text = new TextDecoder().decode(read(DEMO_SNAPSHOTS_ENTRY));
      snapshotsCache = (JSON.parse(text) as { snapshots: Record<string, string> }).snapshots;
    }
    return snapshotsCache;
  };
  const chapters: DemoChapter[] = DEMO_CHAPTER_INDEX.map((entry) => ({
    id: entry.id,
    title: entry.title,
    get snapshot(): SaveSnapshot {
      return decodeEnvelopeText(snapshots()[entry.id]!);
    },
    timelineFrame: entry.timelineFrame,
    tape,
    tapeStart: entry.frame,
    tapeFrames: entry.suffixFrames,
  }));
  const spawns: Record<string, DemoSpawn> = {};
  for (const spawn of DEMO_WARP_SPAWNS) spawns[spawn.id] = { x: spawn.x, y: spawn.y };
  return { chapters, warp: { spawns } };
}
