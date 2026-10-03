// Save and load in the middle of the GB6 mainline, then finish the tape.
//
//   bun run verify:save
//
// Two uninterrupted replays of data/gb6-mainline-journey.json:
//   - the shipped 09:00 start: save after a battle, after a map change and
//     after a late battle; the uninterrupted terminal state must also match
//     the journey's recorded terminalStateSha256
//   - an 11:52 start, so the clock crosses noon (morning -> afternoon
//     daylight) mid-tape: save in the last minute before noon and right after
//     the daylight stage changes, while the tint is still tweening
// Every save resumes through the game's save path (tools/save-resume.ts) and
// must reach the uninterrupted terminal state hash. The report is written to
// reports/save-resume.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tuxemonExtensionState } from "../battle/extension.ts";
import {
  afterBattle,
  afterDaylightChange,
  afterMapChange,
  loadGb6Tape,
  ROOT,
  verifySaveResume,
  type RunReport,
  type SavePointRule,
} from "./save-resume.ts";

const NOON_START = { year: 2024, month: 6, day: 15, hour: 11, minute: 52 } as const;

function expect(label: string, condition: boolean): asserts condition {
  if (!condition) throw new Error(`save resume: ${label}`);
}

function lastMinuteBeforeNoon(id: string): SavePointRule {
  return {
    id,
    label: "first save point once the clock reads 11:59",
    pick: (ctx) => tuxemonExtensionState(ctx.state.ext).clock.minuteOfDay === 11 * 60 + 59,
  };
}

function check(name: string, report: RunReport, expectedTerminal?: string): void {
  if (expectedTerminal !== undefined) {
    expect(`${name}: uninterrupted replay ends at ${report.terminalSha256}, journey recorded ${expectedTerminal}`,
      report.terminalSha256 === expectedTerminal);
  }
  for (const point of report.points) {
    console.log(`${name} save ${point.id} frame=${point.frame} ${point.map}@${point.position.join(",")} `
      + `clock=${point.clock} daylight=${point.daylightStage} via=${point.channel} bytes=${point.envelopeBytes}`);
  }
  for (const resume of report.resumes) {
    expect(`${name} ${resume.id}: restored state differs from the live state at frame ${resume.frame}: `
      + resume.restoredDiff.join(", "),
      resume.restoredMatchesLive);
    expect(`${name} ${resume.id}: resumed run differs in more than the host frame counter`, resume.onlyFrameDiffers);
    expect(`${name} ${resume.id}: resumed terminal ${resume.terminalSha256} != ${report.terminalSha256}`,
      resume.terminalSha256 === report.terminalSha256);
    console.log(`${name} resume ${resume.id} +${resume.suffixFrames} frames PASS ${resume.terminalSha256}`);
  }
}

const tape = loadGb6Tape();
const n = tape.masks.length;
const started = performance.now();

const only = process.env.SAVE_RESUME_ONLY;
const morning = only === "noon" ? null : verifySaveResume(tape.masks, [
  afterBattle("after-battle", Math.floor(n * 0.25)),
  afterMapChange("after-map-change", Math.floor(n * 0.5)),
  afterBattle("after-late-battle", Math.floor(n * 0.8)),
], undefined, tape.worldTraversal);
if (morning) check("09:00", morning, tape.terminalStateSha256);

const noon = only === "morning" ? null : verifySaveResume(tape.masks, [
  lastMinuteBeforeNoon("before-noon"),
  afterDaylightChange("daylight-change"),
], NOON_START, tape.worldTraversal);
if (noon) {
  check("11:52", noon);
  const before = noon.points.find((p) => p.id === "before-noon")!;
  const after = noon.points.find((p) => p.id === "daylight-change")!;
  expect("the noon run saves in the morning stage first", before.daylightStage === 2);
  expect("the noon run's second save is in the afternoon stage", after.daylightStage === 3);
  console.log(`11:52 daylight-change saved screen state ${after.screen}`);
}

const elapsedMs = Math.round(performance.now() - started);
mkdirSync(join(ROOT, "reports"), { recursive: true });
writeFileSync(join(ROOT, "reports/save-resume.json"), `${JSON.stringify({ morning, noon, elapsedMs }, null, 2)}\n`);
const points = (morning?.points.length ?? 0) + (noon?.points.length ?? 0);
console.log(`SAVE RESUME PASS points=${points} elapsedMs=${elapsedMs}`);
