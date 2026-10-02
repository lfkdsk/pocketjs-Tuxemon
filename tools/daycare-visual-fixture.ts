// Production-bundle visual fixture for the imported daycare scene. Scene
// states come from the real reducer and real en_US import arguments, then
// mount into the shipped GameView scene registry.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { TUXEMON_DAYCARE_SCENE_ID } from "../battle/daycare-scenes.ts";
import {
  initialTuxemonExtensionState,
  packTuxemonExtensionState,
} from "../battle/extension.ts";
import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import { TUXEMON_BATTLE_DB, TUXEMON_SCENES } from "../battle/game.ts";
import { spawnMonster } from "../battle/spawn.ts";
import type { DaycareExtensionState, SpawnedMonsterSnapshot } from "../battle/types.ts";
import { buildProject, G6_IMPORT_OPTIONS } from "../importer/project.ts";
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";
import type { SceneInput } from "../vendor/pocket-rpgkit/src/engine/scene.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { bootWorld, type SimWorld } from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";

export const DAYCARE_VISUAL_VIEWPORT = { width: 480, height: 272 } as const;
export const DAYCARE_VISUAL_CASES = ["ready", "party"] as const;
export type DaycareVisualCase = typeof DAYCARE_VISUAL_CASES[number];

export function daycareGoldenFile(visualCase: DaycareVisualCase): string {
  return `daycare-${visualCase}.${DAYCARE_VISUAL_VIEWPORT.width}x${DAYCARE_VISUAL_VIEWPORT.height}.png`;
}

const ROOT = resolve(import.meta.dir, "..");
const BUNDLE = join(ROOT, "dist/main");
const RULE_DB = battleDbToTuxemonBattleDb(TUXEMON_BATTLE_DB);

function objectNodes(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) for (const child of value) objectNodes(child, out);
  else if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    out.push(object);
    for (const child of Object.values(object)) objectNodes(child, out);
  }
  return out;
}

const importedArgs = objectNodes(buildProject(["spyder_paper_daycare"], G6_IMPORT_OPTIONS).project)
  .find((node) => node.op === "scene" && node.id === TUXEMON_DAYCARE_SCENE_ID)?.args as JsonValue | undefined;
if (!importedArgs) throw new Error("daycare visual fixture: real imported scene arguments are missing");
const IMPORTED_ARGS: JsonValue = importedArgs;

function monster(
  slug: string,
  iid: string,
  gender: SpawnedMonsterSnapshot["gender"],
  stage: SpawnedMonsterSnapshot["stage"],
): SpawnedMonsterSnapshot {
  return {
    ...spawnMonster(TUXEMON_BATTLE_DB, RULE_DB, { rng: iid.length * 65_537, rngDraws: 0 }, slug, 18, { iid }),
    gender,
    stage,
  };
}

function daycare(parents: SpawnedMonsterSnapshot[], progressSteps: number): DaycareExtensionState {
  return {
    parents,
    progressSteps,
    pendingExperience: 0,
    lastTrainingExp: 12,
    lastTrainingCost: 12,
  };
}

function fixtureExt(kind: DaycareVisualCase): JsonValue {
  const state = initialTuxemonExtensionState();
  const male = monster("bamboon", "daycare-male", "male", "stage1");
  const female = monster("bigfin", "daycare-female", "female", "stage1");
  if (kind === "ready") {
    state.daycare = daycare([male, female], 10_000);
  } else {
    state.daycare = daycare([male], 0);
    state.party = [
      monster("rockitten", "party-rockitten", "female", "basic"),
      monster("nut", "party-nut", "male", "basic"),
    ];
  }
  return packTuxemonExtensionState(state);
}

function readContext(ext: JsonValue) {
  return { ext, switches: {}, variables: {}, items: {}, gold: 250, playerName: "A" };
}

function drive(kind: DaycareVisualCase, inputs: Partial<SceneInput>[]): JsonValue {
  const rules = TUXEMON_SCENES[TUXEMON_DAYCARE_SCENE_ID]!;
  const ext = fixtureExt(kind);
  const started = rules.start(ext, IMPORTED_ARGS, 0x5eed, readContext(ext));
  if (!started) throw new Error("daycare visual fixture: scene did not open");
  let state = started.state;
  for (const input of inputs) {
    state = rules.step(structuredClone(state), { buttons: 0, ...input }, 1);
  }
  return state;
}

export function daycareVisualSceneStates(): Record<DaycareVisualCase, JsonValue> {
  return {
    // Third content page shows the exact 10,000-step readiness boundary.
    ready: drive("ready", [{ rightEdge: true }, { rightEdge: true }]),
    // Add enters the party selector and highlights the first real monster.
    party: drive("party", [{ confirmEdge: true }]),
  };
}

export interface DaycareVisualCapture {
  width: number;
  height: number;
  cases: Record<DaycareVisualCase, { rgba: Uint8Array; tree: unknown; state: JsonValue }>;
}

function pump(world: SimWorld, frames: number): void {
  for (let frame = 0; frame < frames; frame++) {
    world.frame(0, 0x8080);
    world.tick();
  }
}

export async function captureDaycare(): Promise<DaycareVisualCapture> {
  if (!existsSync(BUNDLE + ".js") || !existsSync(BUNDLE + ".pak")) {
    throw new Error("daycare visual fixture: run `bun run build` first");
  }
  const viewport = DAYCARE_VISUAL_VIEWPORT;
  const world = await bootWorld(BUNDLE, 60, FIXED_TIME_HOST_GLOBALS, undefined, viewport);
  pump(world, 1);
  const session = globalThis.__rpgSessionState;
  if (!session) throw new Error("daycare visual fixture: production session probe is unavailable");
  const fiber = session.interp.main?.key ?? "daycare-visual-fixture";
  const states = daycareVisualSceneStates();
  const cases = {} as DaycareVisualCapture["cases"];
  for (const visualCase of DAYCARE_VISUAL_CASES) {
    const live = globalThis.__rpgSessionState;
    if (!live) throw new Error(`daycare visual fixture: session disappeared before ${visualCase}`);
    live.scene = {
      kind: "scene",
      id: TUXEMON_DAYCARE_SCENE_ID,
      fiber,
      state: states[visualCase],
      pausedTicks: 0,
    };
    pump(world, 2);
    const mounted = globalThis.__rpgSessionState?.scene;
    if (mounted?.kind !== "scene" || mounted.id !== TUXEMON_DAYCARE_SCENE_ID) {
      throw new Error(`daycare visual fixture: ${visualCase} did not mount`);
    }
    cases[visualCase] = {
      rgba: world.render().slice(),
      tree: structuredClone(world.getTree()),
      state: states[visualCase],
    };
  }
  return { ...viewport, cases };
}
