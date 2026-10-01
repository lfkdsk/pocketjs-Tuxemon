// Real-product GB5 battle fixture. It enters Billie's first battle through
// the maintained journey prefix, then drives the live GameView/BattleRules
// state machine to six presentation checkpoints. No fixture renderer is
// involved: every returned frame comes from dist/main.{js,pak} through the
// PocketJS wasm sim host.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RuntimeBattleState } from "../battle/runtime.ts";
import { tuxemonRuntimeBattleState } from "../battle/runtime.ts";
import type { BattleEvent } from "../battle/types.ts";
import type { BattleDb } from "../importer/battle-schema.ts";
import type { SessionState } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { JsonValue } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { PSM } from "../vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/spec.ts";
import {
  bootWorld,
  type SimWorld,
} from "../vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts";
import { FIXED_TIME_HOST_GLOBALS } from "../battle/time-weather.ts";

export const GB5_FRAME_NAMES = [
  "main-menu",
  "technique-menu",
  "hit",
  "faint",
  "capture-shake",
  "level-up",
] as const;

export type Gb5FrameName = (typeof GB5_FRAME_NAMES)[number];

export interface Gb5CapturedFrame {
  rgba: Uint8Array;
  state: RuntimeBattleState;
  hostFrame: number;
}

export interface StructuralCounts {
  createNode: number;
  destroyNode: number;
  insertBefore: number;
  removeChild: number;
}

export interface StructuralSample extends StructuralCounts {
  hostFrame: number;
  event: string;
  eventTicks: number;
}

export interface BattleTextureOp {
  kind: "load" | "set" | "free";
  handle: number;
  node?: number;
}

export interface BattleTextureCycle {
  loads: number[];
  frees: number[];
  operations: BattleTextureOp[];
}

export interface Gb5BattleCapture {
  width: number;
  height: number;
  frames: Record<Gb5FrameName, Gb5CapturedFrame>;
  /** The hit frame restored later in the same mounted scene, after the
   * synthetic capture checkpoint had replaced its serialised scene state. */
  rewoundHit: Uint8Array;
  structuralSamples: StructuralSample[];
  /** Three active/inactive cycles over the same persistent battle subtree. */
  textureCycles: BattleTextureCycle[];
}

interface JourneyPrefix {
  masks: number[];
}

const ROOT = resolve(import.meta.dir, "..");
const BTN_CONFIRM = 0x2000;
const STRUCTURAL_OPS = ["createNode", "destroyNode", "insertBefore", "removeChild"] as const;

const zeroCounts = (): StructuralCounts => ({
  createNode: 0,
  destroyNode: 0,
  insertBefore: 0,
  removeChild: 0,
});

function sessionState(): SessionState {
  const state = (globalThis as typeof globalThis & { __rpgSessionState?: SessionState }).__rpgSessionState;
  if (!state) throw new Error("GB5 battle fixture: GameView did not publish SessionState");
  return state;
}

function runtimeState(): RuntimeBattleState {
  const scene = sessionState().scene;
  if (scene?.kind !== "battle") throw new Error("GB5 battle fixture: no active battle scene");
  return tuxemonRuntimeBattleState(scene.state);
}

function cloneRuntime(state: RuntimeBattleState): RuntimeBattleState {
  return structuredClone(state);
}

function currentEvent(state = runtimeState()): BattleEvent | null {
  return state.battle.events[state.eventCursor] ?? null;
}

function wrapTrackedOps(counts: StructuralCounts | null, textures: BattleTextureOp[] | null) {
  return (ops: Record<string, unknown>): void => {
    if (counts) {
      for (const name of STRUCTURAL_OPS) {
        const original = ops[name] as ((...args: unknown[]) => unknown) | undefined;
        if (!original) continue;
        ops[name] = (...args: unknown[]) => {
          counts[name]++;
          return original.apply(ops, args);
        };
      }
    }
    if (textures) {
      const upload = ops.uploadImgEntry as ((blob: Uint8Array) => number) | undefined;
      const free = ops.freeTexture as ((handle: number) => void) | undefined;
      const setImage = ops.setImage as ((node: number, handle: number) => void) | undefined;
      if (upload) {
        ops.uploadImgEntry = (blob: Uint8Array): number => {
          const handle = upload.call(ops, blob);
          if (blob[4] === PSM.PSM_T8) textures.push({ kind: "load", handle });
          return handle;
        };
      }
      if (free) {
        ops.freeTexture = (handle: number): void => {
          textures.push({ kind: "free", handle });
          free.call(ops, handle);
        };
      }
      if (setImage) {
        ops.setImage = (node: number, handle: number): void => {
          textures.push({ kind: "set", node, handle });
          setImage.call(ops, node, handle);
        };
      }
    }
  };
}

function textureCycle(operations: readonly BattleTextureOp[]): BattleTextureCycle {
  const loads = operations.filter((op) => op.kind === "load").map((op) => op.handle);
  const loaded = new Set(loads);
  const frees = operations
    .filter((op) => op.kind === "free" && loaded.has(op.handle))
    .map((op) => op.handle);
  return { loads, frees, operations: [...operations] };
}

class Driver {
  hostFrame = -1;
  readonly structuralSamples: StructuralSample[] = [];

  constructor(
    readonly world: SimWorld,
    private readonly counts: StructuralCounts | null,
  ) {}

  step(mask = 0): void {
    if (this.counts) for (const name of STRUCTURAL_OPS) this.counts[name] = 0;
    const activeBefore = sessionState().scene?.kind === "battle";
    this.world.frame(mask, 0x8080);
    for (let tick = 0; tick < this.world.ticksPerFrame; tick++) this.world.tick();
    this.hostFrame++;
    const activeAfter = sessionState().scene?.kind === "battle";
    if (this.counts && activeBefore && activeAfter) {
      const state = runtimeState();
      this.structuralSamples.push({
        hostFrame: this.hostFrame,
        event: currentEvent(state)?.type ?? `menu:${state.menuMode}`,
        eventTicks: state.eventTicks,
        ...this.counts,
      });
    }
  }

  press(mask: number): void {
    this.step(mask);
    this.step(0);
  }

  capture(): Gb5CapturedFrame {
    return {
      rgba: this.world.render().slice(),
      state: cloneRuntime(runtimeState()),
      hostFrame: this.hostFrame,
    };
  }
}

function presentationDone(state: RuntimeBattleState): boolean {
  return state.eventCursor >= state.battle.events.length;
}

function isReadyRoot(state: RuntimeBattleState): boolean {
  return presentationDone(state)
    && state.battle.awaiting !== null
    && state.menuMode === "root";
}

function seek(
  driver: Driver,
  wanted: (state: RuntimeBattleState, event: BattleEvent | null) => boolean,
  limit: number,
): RuntimeBattleState {
  for (let frame = 0; frame < limit; frame++) {
    const state = runtimeState();
    if (wanted(state, currentEvent(state))) return state;
    driver.step();
  }
  const state = runtimeState();
  throw new Error(
    `GB5 battle fixture: checkpoint not reached after ${limit} frames ` +
      `(cursor=${state.eventCursor}/${state.battle.events.length}, tick=${state.eventTicks}, menu=${state.menuMode})`,
  );
}

function chooseFirstTechnique(driver: Driver): void {
  const root = runtimeState();
  if (!isReadyRoot(root)) throw new Error("GB5 battle fixture: expected the root command menu");
  driver.press(BTN_CONFIRM);
  const techniques = runtimeState();
  if (techniques.menuMode !== "technique" || techniques.menu[0]?.kind !== "technique") {
    throw new Error("GB5 battle fixture: Fight did not open the technique list");
  }
  driver.press(BTN_CONFIRM);
}

function seekFaint(driver: Driver, enemyUid: number, tick: number): RuntimeBattleState {
  for (let frame = 0; frame < 8_000; frame++) {
    const state = runtimeState();
    const event = currentEvent(state);
    if (event?.type === "faint" && event.monster === enemyUid && state.eventTicks === tick) return state;
    if (isReadyRoot(state)) {
      chooseFirstTechnique(driver);
    } else {
      driver.step();
    }
  }
  throw new Error(`GB5 battle fixture: enemy faint tick ${tick} was not reached`);
}

function installCaptureCheckpoint(rootState: RuntimeBattleState, db: BattleDb): RuntimeBattleState {
  const state = cloneRuntime(rootState);
  const playerUid = state.battle.parties[0][0]!.uid;
  const enemyUid = state.battle.parties[1][0]!.uid;
  const item = db.items.tuxeball;
  if (!item?.captureSprite) throw new Error("GB5 battle fixture: tuxeball capture art is missing");
  state.visuals.items.tuxeball = {
    captureSprite: item.captureSprite,
    ...(item.animation ? { animation: item.animation } : {}),
  };
  state.battle.events = [
    ...state.battle.events.slice(0, 2),
    {
      type: "capture",
      turn: 1,
      user: playerUid,
      target: enemyUid,
      item: "tuxeball",
      shakes: 3,
      success: false,
    },
  ];
  state.eventCursor = 2;
  // Driver.step advances one 60 Hz reference tick. Tick 21 is the first
  // shake's positive amplitude: landedTicks=3 => sin(pi/2) * 7 = +7 px.
  state.eventTicks = 20;
  state.menuMode = "root";
  state.menuIndex = 0;
  return state;
}

function replaceSceneState(state: RuntimeBattleState): void {
  const scene = sessionState().scene;
  if (scene?.kind !== "battle") throw new Error("GB5 battle fixture: cannot replace a closed scene");
  scene.state = state as unknown as JsonValue;
}

export async function captureGb5BattleFrames(
  viewport: { width: number; height: number },
  options: { root?: string; trackStructure?: boolean; trackTextures?: boolean } = {},
): Promise<Gb5BattleCapture> {
  const root = resolve(options.root ?? ROOT);
  const bundle = join(root, "dist/main");
  if (!existsSync(bundle + ".js") || !existsSync(bundle + ".pak")) {
    throw new Error("GB5 battle fixture: run `bun run build` first");
  }
  const journey = JSON.parse(readFileSync(join(root, "data/g6-journey.json"), "utf8")) as JourneyPrefix;
  const db = JSON.parse(readFileSync(join(root, "data/battle-runtime-db.json"), "utf8")) as BattleDb;
  const counts = options.trackStructure ? zeroCounts() : null;
  const textureOps: BattleTextureOp[] | null = options.trackTextures ? [] : null;
  const world = await bootWorld(
    bundle,
    60,
    FIXED_TIME_HOST_GLOBALS,
    counts || textureOps ? wrapTrackedOps(counts, textureOps) : undefined,
    viewport,
  );
  const driver = new Driver(world, counts);

  let foundRoot = false;
  let firstBattleTextureStart = textureOps?.length ?? 0;
  for (const mask of journey.masks) {
    const activeBefore = sessionState().scene?.kind === "battle";
    const operationStart = textureOps?.length ?? 0;
    driver.step(mask);
    if (!activeBefore && sessionState().scene?.kind === "battle") firstBattleTextureStart = operationStart;
    if (sessionState().scene?.kind === "battle" && isReadyRoot(runtimeState())) {
      // Release the confirm pulse that completed the final send-out frame.
      if (mask !== 0) driver.step(0);
      foundRoot = true;
      break;
    }
  }
  if (!foundRoot) throw new Error("GB5 battle fixture: journey prefix never reached the first battle menu");

  const frames = {} as Record<Gb5FrameName, Gb5CapturedFrame>;
  frames["main-menu"] = driver.capture();
  const initialRoot = cloneRuntime(runtimeState());
  const playerUid = initialRoot.battle.parties[0][0]!.uid;
  const enemyUid = initialRoot.battle.parties[1][0]!.uid;

  driver.press(BTN_CONFIRM);
  if (runtimeState().menuMode !== "technique") {
    throw new Error("GB5 battle fixture: first command did not open Techniques");
  }
  frames["technique-menu"] = driver.capture();
  driver.press(BTN_CONFIRM);

  seek(
    driver,
    (state, event) => event?.type === "technique"
      && event.user === playerUid
      && state.eventTicks === 24,
    2_000,
  );
  frames.hit = driver.capture();
  const hitState = cloneRuntime(runtimeState());

  // Two thirds through the 30-tick sink/fade window: visibly lower and
  // translucent, while still present enough for the golden to prove motion.
  seekFaint(driver, enemyUid, 24);
  frames.faint = driver.capture();
  seek(
    driver,
    (state, event) => event?.type === "faint"
      && event.monster === enemyUid
      && state.eventTicks === 54,
    100,
  );
  frames["level-up"] = driver.capture();

  replaceSceneState(installCaptureCheckpoint(initialRoot, db));
  driver.step();
  const capture = runtimeState();
  if (currentEvent(capture)?.type !== "capture" || capture.eventTicks !== 21) {
    throw new Error("GB5 battle fixture: synthetic capture did not settle at shake tick 21");
  }
  frames["capture-shake"] = driver.capture();

  // Rewind the same still-mounted scene to one tick before the recorded hit;
  // the next reducer frame must repaint byte-identically to the first visit.
  const rewindState = cloneRuntime(hitState);
  rewindState.eventTicks--;
  replaceSceneState(rewindState);
  driver.step();
  const rewound = runtimeState();
  if (rewound.eventCursor !== hitState.eventCursor || rewound.eventTicks !== hitState.eventTicks) {
    throw new Error("GB5 battle fixture: rewind did not restore the hit cursor");
  }
  const rewoundHit = world.render().slice();

  const textureCycles: BattleTextureCycle[] = [];
  if (textureOps) {
    const repeatScene = structuredClone(sessionState().scene);
    if (!repeatScene) throw new Error("GB5 battle fixture: cannot cycle an inactive scene");
    let cycleStart = firstBattleTextureStart;
    for (let cycle = 0; cycle < 3; cycle++) {
      sessionState().scene = null;
      driver.step();
      textureCycles.push(textureCycle(textureOps.slice(cycleStart)));
      if (cycle < 2) {
        cycleStart = textureOps.length;
        sessionState().scene = structuredClone(repeatScene);
        driver.step();
      }
    }
  }

  return {
    ...viewport,
    frames,
    rewoundHit,
    structuralSamples: driver.structuralSamples,
    textureCycles,
  };
}
