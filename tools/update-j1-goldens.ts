// Capture three clear-map J1 checkpoints at both supported logical
// resolutions from frame-zero replays of the production bundle.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { bootWorld, fnv1a } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { walkPose } from "../vendor/pocket-rpgkit/src/engine/movement.ts";
import { isSessionWorldIdle, type SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { CameraState, Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { NPC_SRC_INDEX, PLAYER } from "../ui/game-assets.ts";
import { createNpcSrcProvider } from "../ui/npc-src-repository.ts";
import type { Gb6JourneyResult } from "./gb6-journey.ts";
import type { J1JourneyResult } from "./j1-journey.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const OUT = join(ROOT, "tests/goldens");
const VIEWPORTS = [{ width: 480, height: 272 }, { width: 960, height: 544 }] as const;
const NAMES = ["wayfarer-guestbook", "route-4-billie", "captain-found"] as const;
const ACTOR_AT: Readonly<Record<string, string>> = {
  "captain-found": "npc_spyder_basement_flick",
};

if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
  throw new Error("J1 goldens: missing dist/main.{js,pak}; run `bun run build`");
}

const base = JSON.parse(readFileSync(join(ROOT, "data/gb6-mainline-journey.json"), "utf8")) as Gb6JourneyResult;
const journey = JSON.parse(readFileSync(join(ROOT, "data/j1-captainreturns-journey.json"), "utf8")) as J1JourneyResult;
const combined = [...base.masks, ...journey.masks];
const checkpoints = NAMES.map((name) => {
  const mark = journey.maps.find((candidate) => candidate.name === name);
  if (!mark) throw new Error(`J1 goldens: missing ${name} journey checkpoint`);
  return { ...mark, mergedFrame: base.frames + mark.frame };
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

mkdirSync(OUT, { recursive: true });
const frames: Record<string, unknown>[] = [];
for (const viewport of VIEWPORTS) {
  // Camera bounds and streamed terrain nodes are derived during a tick. A
  // fresh world per viewport keeps both images on the exact tape frame while
  // exercising the same startup path as the real host.
  const world = await bootWorld(BUNDLE, 60, undefined, undefined, viewport);
  for (let frame = 0; frame <= checkpoints.at(-1)!.mergedFrame; frame++) {
    world.frame(combined[frame]!);
    world.tick();
    const checkpoint = wanted.get(frame);
    if (!checkpoint) continue;
    const state = globalThis.__rpgSessionState as SessionState | undefined;
    if (!state || state.mapId !== checkpoint.map || state.move.tx !== checkpoint.position[0] ||
        state.move.ty !== checkpoint.position[1]) {
      throw new Error(`J1 goldens: ${checkpoint.name} diverged at merged f${frame}: ` +
        `${state?.mapId}@${state?.move.tx},${state?.move.ty}`);
    }
    if (!isSessionWorldIdle(state)) {
      throw new Error(`J1 goldens: ${checkpoint.name} is not a world-idle frame`);
    }

    const actorId = ACTOR_AT[checkpoint.name];
    const character = actorId ? state.chars.chars[actorId] : undefined;
    const event = actorId
      ? project.maps.find((map) => map.id === state.mapId)?.events?.find((candidate) => candidate.id === actorId)
      : undefined;
    const sprite = character && event ? event.pages[character.pageIndex]?.sprite : undefined;
    const art = sprite ? npcSrc[sprite] : undefined;
    if (actorId && (!character || !event || !sprite || !art || character.blocks !== true)) {
      throw new Error(`J1 goldens: ${actorId} is not visibly resolved at ${checkpoint.name}`);
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
    if (!camera) throw new Error(`J1 goldens: missing camera at ${checkpoint.name}`);
    const file = `j1-${checkpoint.name}.${viewport.width}x${viewport.height}.png`;
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
        enforcersResponseDone: state.sw.variables["v.enforcers_response"] ?? 0,
        route4Billie: state.sw.variables["v.route4billie"] ?? 0,
        routeABillie: state.sw.variables["v.routeabillie"] ?? 0,
        foundCaptain: state.sw.variables["v.foundcaptain"] ?? 0,
        captainReturns: state.sw.variables["v.captainreturns"] ?? 0,
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
    console.log(`${checkpoint.name} ${viewport.width}x${viewport.height}: ` +
      `merged f${frame} rgba=${fnv1a(rgba)} -> ${file}`);
  }
}

if (frames.length !== checkpoints.length * VIEWPORTS.length) {
  throw new Error(`J1 goldens: captured ${frames.length}/${checkpoints.length * VIEWPORTS.length}`);
}
writeFileSync(join(ROOT, "data/j1-goldens.json"), JSON.stringify({
  format: "pocket-tuxemon/j1-goldens/v1",
  baseFrames: base.frames,
  segmentTapeSha256: journey.tapeSha256,
  combinedTapeSha256: journey.combinedTapeSha256,
  frames,
}, null, 2) + "\n");
