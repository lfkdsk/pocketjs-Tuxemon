// Build the short QuickJS continuation fixture from committed inputs.
// The desktop host restores the hospital-cure demo chapter, so this tape is
// the eleven remaining J2 masks followed by every J3 mask. No gameplay state
// or input is duplicated here: chapters.json and the journeys remain the
// authorities.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Gb6JourneyResult } from "./gb6-journey.ts";
import type { J1JourneyResult } from "./j1-journey.ts";
import type { J2JourneyResult } from "./j2-journey.ts";
import type { J3JourneyResult } from "./j3-journey.ts";

interface ChapterRow {
  id: string;
  frame: number;
  timelineFrame: number;
  held: number;
  map: string;
  position: [number, number];
}

export interface J3QuickjsTape {
  format: "pocket-tuxemon/j3-quickjs/v1";
  hz: 60;
  startChapter: "hospital-cure";
  frames: number;
  masks: number[];
  maps: { frame: number; map: string }[];
  battles: J3JourneyResult["battles"];
  terminalStateSha256: string;
  tapeSha256: string;
}

const ROOT = resolve(import.meta.dir, "..");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`j3-quickjs-tape: ${message}`);
}

export function buildJ3QuickjsTape(root: string = ROOT): J3QuickjsTape {
  const read = <T>(file: string): T =>
    JSON.parse(readFileSync(join(root, file), "utf8")) as T;
  const gb6 = read<Gb6JourneyResult>("data/gb6-mainline-journey.json");
  const j1 = read<J1JourneyResult>("data/j1-captainreturns-journey.json");
  const j2 = read<J2JourneyResult>("data/j2-hospitalcure-journey.json");
  const j3 = read<J3JourneyResult>("data/j3-omnichannelradioannounce-journey.json");
  const chapters = read<{ chapters: ChapterRow[] }>("data/chapters.json");
  const chapter = chapters.chapters.find((candidate) => candidate.id === "hospital-cure");
  expect(chapter, "missing hospital-cure chapter");

  const j1Masks = [...gb6.masks, ...j1.masks];
  const j2Masks = [...j1Masks, ...j2.masks];
  expect(j1.combinedFrames === j1Masks.length, "J1 ancestry frame count changed");
  expect(j1.combinedTapeSha256 === sha256(JSON.stringify(j1Masks)), "J1 ancestry hash changed");
  expect(j2.combinedFrames === j2Masks.length, "J2 ancestry frame count changed");
  expect(j2.combinedTapeSha256 === sha256(JSON.stringify(j2Masks)), "J2 ancestry hash changed");
  expect(j3.base.frames === j2Masks.length, "J3 no longer starts at the J2 terminal");
  expect(j3.base.tapeSha256 === j2.combinedTapeSha256, "J3 parent tape hash changed");
  expect(chapter.frame <= j2Masks.length, "hospital-cure chapter starts after J2");
  expect(chapter.timelineFrame === chapter.frame, "hospital-cure global frame changed");
  expect(chapter.map === "spyder_candy_hospital3", "hospital-cure map changed");

  const parentTail = j2Masks.slice(chapter.frame);
  const masks = [...parentTail, ...j3.masks];
  const offset = parentTail.length;
  expect(offset === 11, `expected 11 J2 tail frames, got ${offset}`);
  expect(masks.length === 12_991, `expected 12,991 continuation frames, got ${masks.length}`);
  const maps = [
    { frame: 0, map: chapter.map },
    ...j3.maps
      .filter((mark) => mark.frame >= 0)
      .map((mark) => ({ frame: offset + mark.frame, map: mark.map })),
  ];
  const battles = j3.battles.map((battle) => ({
    ...battle,
    startFrame: offset + battle.startFrame,
    endFrame: offset + battle.endFrame,
  }));
  return {
    format: "pocket-tuxemon/j3-quickjs/v1",
    hz: 60,
    startChapter: "hospital-cure",
    frames: masks.length,
    masks,
    maps,
    battles,
    terminalStateSha256: j3.terminalStateSha256,
    tapeSha256: sha256(JSON.stringify(masks)),
  };
}

if (import.meta.main) {
  const output = process.argv[2];
  if (!output) throw new Error("usage: bun tools/j3-quickjs-tape.ts <output.json>");
  const tape = buildJ3QuickjsTape();
  writeFileSync(resolve(output), JSON.stringify(tape) + "\n");
  console.log(`J3 QUICKJS TAPE frames=${tape.frames} battles=${tape.battles.length} ` +
    `state=${tape.terminalStateSha256}`);
}
