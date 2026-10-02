// Capture three clear-map J3 checkpoints at both supported logical
// resolutions from frame-zero replays of the production bundle.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { walkPose } from "../vendor/pocket-rpgkit/src/engine/movement.ts";
import { isSessionWorldIdle, type SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { CameraState, Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import { NPC_SRC_INDEX, PLAYER } from "../ui/game-assets.ts";
import { createNpcSrcProvider } from "../ui/npc-src-repository.ts";
import type { Gb6JourneyResult } from "./gb6-journey.ts";
import type { J1JourneyResult } from "./j1-journey.ts";
import type { J2JourneyResult } from "./j2-journey.ts";
import type { J3JourneyResult } from "./j3-journey.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const OUT = join(ROOT, "tests/goldens");
const MANIFEST = join(ROOT, "data/j3-goldens.json");
const VIEWPORTS = [{ width: 480, height: 272 }, { width: 960, height: 544 }] as const;
const VIEWPORT_FILTER = process.env.J3_GOLDEN_VIEWPORT;
const selectedViewports = VIEWPORT_FILTER
  ? VIEWPORTS.filter(({ width, height }) => String(width) + "x" + String(height) === VIEWPORT_FILTER)
  : VIEWPORTS;
const NAMES = ["omnichannel-wall", "radio-tower-entry", "radio-broadcast"] as const;
const ACTOR_AT: Readonly<Record<string, string>> = {
  "omnichannel-wall": "npc_spyder_omnichannel_danita",
  "radio-tower-entry": "npc_spyder_omnichannel_beaverbrook",
};

if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
  throw new Error("J3 goldens: missing dist/main.{js,pak}; run bun run build");
}
if (selectedViewports.length === 0) {
  throw new Error("J3 goldens: unsupported J3_GOLDEN_VIEWPORT=" + VIEWPORT_FILTER);
}

const gb6 = JSON.parse(readFileSync(join(ROOT, "data/gb6-mainline-journey.json"), "utf8")) as Gb6JourneyResult;
const j1 = JSON.parse(readFileSync(join(ROOT, "data/j1-captainreturns-journey.json"), "utf8")) as J1JourneyResult;
const j2 = JSON.parse(readFileSync(join(ROOT, "data/j2-hospitalcure-journey.json"), "utf8")) as J2JourneyResult;
const journey = JSON.parse(
  readFileSync(join(ROOT, "data/j3-omnichannelradioannounce-journey.json"), "utf8"),
) as J3JourneyResult;
const baseFrames = gb6.frames + j1.frames + j2.frames;
const combined = [...gb6.masks, ...j1.masks, ...j2.masks, ...journey.masks];
const checkpoints = NAMES.map((name) => {
  const mark = journey.maps.find((candidate) => candidate.name === name);
  if (!mark) throw new Error("J3 goldens: missing " + name + " journey checkpoint");
  return { ...mark, mergedFrame: baseFrames + mark.frame };
});
const wanted = new Map(checkpoints.map((checkpoint) => [checkpoint.mergedFrame, checkpoint]));
const project = JSON.parse(readFileSync(join(ROOT, "dist/project.json"), "utf8")) as Project;
const npcSrc = createNpcSrcProvider(NPC_SRC_INDEX, {
  read: (entry) => readFileSync(join(ROOT, "dist", entry)),
});
const imageKey = (phase: number, facing: number, frames: typeof PLAYER): string => {
  const pose = walkPose(phase);
  return pose === 1 ? frames.walkL[facing]!
    : pose === 2 ? frames.walkR[facing]!
      : frames.idle[facing]!;
};
const numeric = (state: SessionState, id: string): number => {
  const value = state.sw.variables[id];
  if (value === undefined) return 0;
  if (typeof value !== "number") throw new Error("J3 goldens: " + id + " is not numeric");
  return value;
};

mkdirSync(OUT, { recursive: true });
const frames: Record<string, unknown>[] = [];
for (const viewport of selectedViewports) {
  const world = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, viewport);
  for (let frame = 0; frame <= checkpoints.at(-1)!.mergedFrame; frame++) {
    world.frame(combined[frame]!);
    world.tick();
    const checkpoint = wanted.get(frame);
    if (!checkpoint) continue;
    const state = globalThis.__rpgSessionState as SessionState | undefined;
    if (!state ||
      state.mapId !== checkpoint.map ||
      state.move.tx !== checkpoint.position[0] ||
      state.move.ty !== checkpoint.position[1]) {
      throw new Error("J3 goldens: " + checkpoint.name + " diverged at merged frame " + frame +
        ": " + state?.mapId + "@" + state?.move.tx + "," + state?.move.ty);
    }
    if (!isSessionWorldIdle(state)) {
      throw new Error("J3 goldens: " + checkpoint.name + " is not a world-idle frame");
    }

    const actorId = ACTOR_AT[checkpoint.name];
    const character = actorId ? state.chars.chars[actorId] : undefined;
    const event = actorId
      ? project.maps.find((map) => map.id === state.mapId)?.events?.find((candidate) => candidate.id === actorId)
      : undefined;
    const sprite = character && event ? event.pages[character.pageIndex]?.sprite : undefined;
    const art = sprite ? npcSrc[sprite] : undefined;
    if (actorId && (!character || !event || !sprite || !art || character.blocks !== true)) {
      throw new Error("J3 goldens: " + actorId + " is not visibly resolved at " + checkpoint.name);
    }
    const actor = character && sprite && art ? {
      id: actorId,
      tile: [character.tx, character.ty],
      pixel: [character.px, character.py],
      facing: character.facing,
      phase: character.phase,
      sprite,
      image: typeof art === "string" ? art : imageKey(character.phase, character.facing, art),
      height: typeof art === "string" ? 16 : art.h,
    } : undefined;

    const rgba = world.render().slice();
    const camera = globalThis.__rpgGameCamera as CameraState | undefined;
    if (!camera) throw new Error("J3 goldens: missing camera at " + checkpoint.name);
    const file = "j3-" + checkpoint.name + "." + viewport.width + "x" + viewport.height + ".png";
    const png = encodePNG(rgba, viewport.width, viewport.height);
    writeFileSync(join(OUT, file), png);
    frames.push({
      name: checkpoint.name,
      frame: checkpoint.frame,
      mergedFrame: checkpoint.mergedFrame,
      map: checkpoint.map,
      position: checkpoint.position,
      ...viewport,
      file,
      rgbaFnv1a: fnv1a(rgba),
      pngSha256: createHash("sha256").update(png).digest("hex"),
      camera: [camera.x, camera.y],
      story: {
        hospitalCure: numeric(state, "v.hospitalcure"),
        hospitalBillie: numeric(state, "v.hospitalbillie"),
        nurseSpyder: numeric(state, "v.nurse_spyder"),
        spyderPass: state.sw.items.spyder_pass ?? 0,
        omnichannelReadyWall: numeric(state, "v.omnichannel-ready-wall"),
        omnichannel1Wall: numeric(state, "v.omnichannel1wall"),
        beaverbrookWon: state.sw.switches["bo.spyder_omnichannel_beaverbrook.won"] === true,
        kernelQuest: numeric(state, "v.kernelquest"),
        omnichannelRadioAnnounce: numeric(state, "v.omnichannelradioannounce"),
      },
      player: {
        tile: [state.move.tx, state.move.ty],
        pixel: [state.move.px, state.move.py],
        facing: state.move.facing,
        phase: state.move.phase,
        image: imageKey(state.move.phase, state.move.facing, PLAYER),
        height: 32,
      },
      ...(actor ? { actor } : {}),
    });
    console.log(checkpoint.name + " " + viewport.width + "x" + viewport.height +
      ": merged frame " + frame + " rgba=" + fnv1a(rgba) + " -> " + file);
  }
}

if (frames.length !== checkpoints.length * selectedViewports.length) {
  throw new Error("J3 goldens: captured " + frames.length + "/" +
    checkpoints.length * selectedViewports.length);
}
let preserved: Record<string, unknown>[] = [];
if (VIEWPORT_FILTER && existsSync(MANIFEST)) {
  const previous = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    format?: string;
    baseFrames?: number;
    segmentTapeSha256?: string;
    combinedTapeSha256?: string;
    frames?: Record<string, unknown>[];
  };
  if (previous.format !== "pocket-tuxemon/j3-goldens/v1" ||
    previous.baseFrames !== baseFrames ||
    previous.segmentTapeSha256 !== journey.tapeSha256 ||
    previous.combinedTapeSha256 !== journey.combinedTapeSha256 ||
    !Array.isArray(previous.frames)) {
    throw new Error("J3 goldens: existing partial manifest belongs to a different tape");
  }
  preserved = previous.frames.filter((frame) =>
    String(frame.width) + "x" + String(frame.height) !== VIEWPORT_FILTER);
}
const viewportOrder = new Map(VIEWPORTS.map(({ width, height }, index) =>
  [String(width) + "x" + String(height), index]));
const nameOrder = new Map(NAMES.map((name, index) => [name, index]));
const mergedFrames = [...preserved, ...frames].sort((a, b) =>
  (viewportOrder.get(String(a.width) + "x" + String(a.height)) ?? 99) -
    (viewportOrder.get(String(b.width) + "x" + String(b.height)) ?? 99) ||
  (nameOrder.get(String(a.name) as typeof NAMES[number]) ?? 99) -
    (nameOrder.get(String(b.name) as typeof NAMES[number]) ?? 99));
writeFileSync(MANIFEST, JSON.stringify({
  format: "pocket-tuxemon/j3-goldens/v1",
  baseFrames,
  segmentTapeSha256: journey.tapeSha256,
  combinedTapeSha256: journey.combinedTapeSha256,
  frames: mergedFrames,
}, null, 2) + "\n");
