// The web demo's chapter tapes live in one pak entry. Building the options
// must not read the pak; the first chapter selection decodes the tape once,
// and every chapter windows that one decoded tape.

import { describe, expect, test } from "bun:test";
import { createDemoOptions } from "../ui/demo-tape.ts";
import { DEMO_CHAPTER_INDEX, DEMO_TAPE_ENTRY } from "../ui/demo-index.ts";
import { chapterTape, chapterTapeFrames } from "../vendor/pocket-rpgkit/src/ui/demo/runtime.ts";

/** Raw-format tape (see decodeTape): frame i holds i & 0xffff. */
function rawTape(frames: number): Uint8Array {
  const bytes = new Uint8Array(8 + frames * 2);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x54;
  bytes[1] = 1;
  bytes[2] = 2;
  view.setUint32(4, frames, true);
  for (let i = 0; i < frames; i++) view.setUint16(8 + i * 2, i & 0xffff, true);
  return bytes;
}

describe("demo chapter tapes", () => {
  const total = Math.max(...DEMO_CHAPTER_INDEX.map((entry) => entry.frame + entry.suffixFrames));

  test("one shared provider, read once, windowed without copies", () => {
    expect(DEMO_CHAPTER_INDEX.length).toBe(13);
    const reads: string[] = [];
    const options = createDemoOptions((entry) => {
      reads.push(entry);
      if (entry !== DEMO_TAPE_ENTRY) throw new Error(`unexpected read ${entry}`);
      return rawTape(total);
    });
    expect(reads).toEqual([]);
    const providers = new Set(options.chapters.map((chapter) => chapter.tape));
    expect(providers.size).toBe(1);
    // The autoplay page lists chapters from the declared window.
    for (const [index, chapter] of options.chapters.entries()) {
      expect(chapterTapeFrames(chapter)).toBe(DEMO_CHAPTER_INDEX[index]!.suffixFrames);
    }
    expect(reads).toEqual([]);

    const tapes = options.chapters.map((chapter) => chapterTape(chapter) as Uint16Array);
    expect(reads).toEqual([DEMO_TAPE_ENTRY]);
    const buffer = tapes[0]!.buffer;
    for (const [index, tape] of tapes.entries()) {
      const entry = DEMO_CHAPTER_INDEX[index]!;
      expect(tape.buffer).toBe(buffer);
      expect(tape.length).toBe(entry.suffixFrames);
      expect(tape[0]).toBe(entry.frame & 0xffff);
    }
    options.chapters.forEach((chapter) => chapterTape(chapter));
    expect(reads).toEqual([DEMO_TAPE_ENTRY]);
  });
});
