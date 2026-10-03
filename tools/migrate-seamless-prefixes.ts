// Preserve the four legacy mask arrays that still reach their authored
// endpoints under seamless-v1, while rebuilding runtime-derived metadata.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { tuxemonExtensionState } from "../battle/extension.ts";
import { createTuxemonSessionOptions, TUXEMON_BATTLE_DB } from "../battle/game.ts";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionInput,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { Driver, type Gb6JourneyResult } from "./gb6-journey.ts";
import { readInlineProject } from "./generated-project.ts";

const ROOT = resolve(import.meta.dir, "..");
const project = readInlineProject(ROOT);
if (project.worldTraversal !== "seamless-v1" || !project.worldLayout) {
  throw new Error("seamless prefix migration requires a seamless-v1 project with WorldLayout");
}

interface ShortTape {
  format: string;
  worldTraversal?: unknown;
  hz: number;
  frames: number;
  map: string;
  position: [number, number];
  masks: number[];
  terminalStateSha256?: string;
  tapeSha256?: string;
  sha256: string;
  [key: string]: unknown;
}

interface SeenText {
  frame: number;
  map: string;
  lines: string[];
}

interface LaterLossTape {
  format: string;
  worldTraversal?: unknown;
  hz: number;
  frames: number;
  prefixFrames: number;
  masks: number[];
  battle: {
    opponent: string;
    startFrame: number;
    endFrame: number;
    turns: number;
    outcome: string;
    swaps: number;
    techniques: number;
  };
  faintPoint: { map: string; position: [number, number] };
  blockedExit: boolean;
  healed: boolean;
  end: { map: string; position: [number, number] };
  texts: SeenText[];
  terminalStateSha256: string;
  tapeSha256: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function expect(label: string, condition: boolean): asserts condition {
  if (!condition) throw new Error(`seamless prefix migration: ${label}`);
}

function input(mask: number, previous: number): SessionInput {
  const pressed = mask & ~previous;
  return {
    buttons: mask,
    confirmEdge: Boolean(pressed & 0x2000),
    cancelEdge: Boolean(pressed & 0x4000),
    upEdge: Boolean(pressed & 0x0010),
    downEdge: Boolean(pressed & 0x0040),
    leftEdge: Boolean(pressed & 0x0080),
    rightEdge: Boolean(pressed & 0x0020),
  };
}

function replay(masks: readonly number[]): SessionState {
  const session = createSession(project, 60, createTuxemonSessionOptions(project));
  let state = startSession(project, session);
  let previous = 0;
  for (const mask of masks) {
    state = stepSession(session, state, input(mask, previous));
    previous = mask;
    if (state.interp.error) throw new Error(state.interp.error.message);
  }
  return state;
}

function migrateShort(file: string): void {
  const path = join(ROOT, file);
  const source = JSON.parse(readFileSync(path, "utf8")) as ShortTape;
  expect(`${file} is not a 60 Hz tape`, source.hz === 60);
  expect(`${file} frames differ from masks`, source.frames === source.masks.length);
  if (source.tapeSha256) {
    expect(`${file} tape hash changed`, source.tapeSha256 === sha256(JSON.stringify(source.masks)));
  }
  const state = replay(source.masks);
  expect(`${file} no longer reaches its endpoint`, state.mapId === source.map &&
    state.move.tx === source.position[0] && state.move.ty === source.position[1]);
  const terminalStateSha256 = sha256(canonicalJson(state));
  const { format, worldTraversal: _oldTraversal, sha256: _oldPayloadHash, ...rest } = source;
  const payload = {
    format,
    worldTraversal: "seamless-v1" as const,
    ...rest,
    terminalStateSha256,
  };
  const migrated = { ...payload, sha256: sha256(JSON.stringify(payload)) };
  writeFileSync(path, JSON.stringify(migrated, null, 2) + "\n");
  console.log(`${file}: masks=${source.masks.length} state=${terminalStateSha256}`);
}

function mapSignature(row: { name: string; map: string; position: [number, number] }): string {
  return `${row.name}|${row.map}|${row.position.join(",")}`;
}

function migrateGb6(): void {
  const path = join(ROOT, "data/gb6-mainline-journey.json");
  const source = JSON.parse(readFileSync(path, "utf8")) as Gb6JourneyResult;
  expect("GB6 frames differ from masks", source.frames === source.masks.length);
  expect("GB6 tape hash changed", source.tapeSha256 === sha256(JSON.stringify(source.masks)));
  const session = createSession(project, 60, createTuxemonSessionOptions(project));
  const driver = new Driver(session, 60, startSession(project, session));
  for (const mask of source.masks) driver.tick(mask);
  expect("GB6 no longer reaches its endpoint", driver.state.mapId === source.map &&
    driver.state.move.tx === source.position[0] && driver.state.move.ty === source.position[1]);
  expect("GB6 ended busy", driver.state.scene === null && driver.state.interp.modal === null &&
    driver.state.interp.main === null && driver.state.fade === null && driver.state.handoff === undefined);

  const authoredAutomaticMaps = source.maps.slice(0, -1);
  expect("GB6 map transition count changed", authoredAutomaticMaps.length === driver.maps.length);
  expect("GB6 map transition sequence changed", authoredAutomaticMaps.every((row, index) =>
    mapSignature(row) === mapSignature(driver.maps[index]!)));
  expect("GB6 battle count changed", source.battles.length === driver.battles.length);
  expect("GB6 battle sequence changed", source.battles.every((battle, index) => {
    const actual = driver.battles[index]!;
    return battle.opponent === actual.opponent && battle.kind === actual.kind && battle.outcome === actual.outcome;
  }));
  const finalMark = {
    ...source.maps.at(-1)!,
    frame: source.masks.length - 1,
    map: driver.state.mapId,
    position: [driver.state.move.tx, driver.state.move.ty] as [number, number],
  };
  const variable = (id: string): number => {
    const value = driver.state.sw.variables[id] ?? 0;
    if (typeof value !== "number") throw new Error(`${id} is not numeric`);
    return value;
  };
  const story = {
    firstfightend: variable("v.firstfightend"),
    firstfightdue: variable("v.firstfightdue"),
    confusedchoice: variable("v.confusedchoice"),
    visitedcottoncafe: variable("v.visitedcottoncafe"),
    route2billiefought: variable("v.route2billiefought"),
    shaftscheme: variable("v.shaftscheme"),
    zoolanderWon: driver.state.sw.switches["bo.spyder_route3_zoolander.won"] === true,
  };
  expect("GB6 story changed", canonicalJson(story) === canonicalJson(source.story));
  const { format, worldTraversal: _oldTraversal, ...rest } = source;
  const migrated: Gb6JourneyResult = {
    format,
    worldTraversal: "seamless-v1",
    ...rest,
    terminalMapFrame: driver.state.interp.frame,
    maps: [...driver.maps, finalMark],
    battles: driver.battles,
    story,
    terminalStateSha256: sha256(canonicalJson(driver.state)),
  };
  writeFileSync(path, JSON.stringify(migrated, null, 2) + "\n");
  console.log(`data/gb6-mainline-journey.json: masks=${source.masks.length} ` +
    `maps=${migrated.maps.length} battles=${migrated.battles.length} state=${migrated.terminalStateSha256}`);
}

function migrateLaterLoss(): void {
  const path = join(ROOT, "data/gb6-later-loss-journey.json");
  const source = JSON.parse(readFileSync(path, "utf8")) as LaterLossTape;
  expect("later-loss frames differ from masks", source.frames === source.masks.length);
  expect("later-loss tape hash changed", source.tapeSha256 === sha256(JSON.stringify(source.masks)));
  const session = createSession(project, 60, createTuxemonSessionOptions(project));
  const driver = new Driver(session, 60, startSession(project, session));
  let lastModalKey = "";
  const texts: SeenText[] = [];
  for (let frame = 0; frame < source.masks.length; frame++) {
    driver.tick(source.masks[frame]!);
    const modal = driver.state.interp.modal;
    const modalKey = modal?.kind === "text" ? `text|${modal.lines.join("/")}`
      : modal?.kind === "choices" ? `choices|${modal.prompt}|${modal.options.join("/")}`
        : modal?.kind === "shop" ? `shop|${modal.fiber}|${modal.stage}|${modal.index}`
          : "";
    if (modal?.kind === "text" && modalKey !== lastModalKey) {
      texts.push({ frame, map: driver.state.mapId, lines: [...modal.lines] });
    }
    lastModalKey = modalKey;
  }
  expect("later-loss no longer reaches its endpoint", driver.state.mapId === source.end.map &&
    driver.state.move.tx === source.end.position[0] && driver.state.move.ty === source.end.position[1]);
  const lost = driver.battles.find((battle) =>
    battle.opponent === source.battle.opponent && battle.outcome === "lost");
  expect("later-loss Wanda battle disappeared", lost !== undefined);
  const recoveryTexts = texts.filter((row) => row.frame >= lost.endFrame).slice(0, source.texts.length);
  expect("later-loss recovery text sequence changed", recoveryTexts.length === source.texts.length &&
    recoveryTexts.every((row, index) => row.map === source.texts[index]!.map &&
      canonicalJson(row.lines) === canonicalJson(source.texts[index]!.lines)));
  const extension = tuxemonExtensionState(driver.state.ext, TUXEMON_BATTLE_DB);
  expect("later-loss party was not healed", extension.party.length > 0 &&
    extension.party.every((monster) => monster.currentHp === monster.base.hp));
  const { format, worldTraversal: _oldTraversal, ...rest } = source;
  const migrated: LaterLossTape & { worldTraversal: "seamless-v1" } = {
    format,
    worldTraversal: "seamless-v1",
    ...rest,
    prefixFrames: lost.startFrame + 1,
    battle: {
      ...source.battle,
      startFrame: lost.startFrame,
      endFrame: lost.endFrame,
      turns: lost.turns,
      outcome: lost.outcome,
    },
    texts: recoveryTexts,
    terminalStateSha256: sha256(canonicalJson(driver.state)),
  };
  writeFileSync(path, JSON.stringify(migrated, null, 2) + "\n");
  console.log(`data/gb6-later-loss-journey.json: masks=${source.masks.length} ` +
    `battle=${lost.startFrame}-${lost.endFrame} state=${migrated.terminalStateSha256}`);
}

migrateShort("data/g6-journey.json");
migrateShort("data/gb6-first-loss-journey.json");
migrateGb6();
migrateLaterLoss();
console.log("SEAMLESS PREFIX MIGRATION PASS tapes=4 masks=preserved");
