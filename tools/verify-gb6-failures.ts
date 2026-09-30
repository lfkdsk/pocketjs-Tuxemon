// Replay both committed GB6 defeat tapes through the production sharded
// session. The generators assert these beats while recording; this verifier
// makes the frozen masks and their visible recovery order a repeatable gate.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { tuxemonExtensionState } from "../battle/extension.ts";
import { TUXEMON_BATTLE_DB, TUXEMON_BATTLE_RULES, TUXEMON_EXTENSIONS } from "../battle/game.ts";
import { tuxemonRuntimeBattleState } from "../battle/runtime.ts";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionInput,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { readShardedProject } from "./generated-project.ts";

const ROOT = resolve(import.meta.dir, "..");
const HEAL_BEFORE_LEAVE = "You should heal your monsters before heading off.";
const FIRST_FIGHT_LOSE = "As expected! Old models can't compare to new ones!";
const FIRST_LOSS_STATE_SHA256 = "69e4ad1dc22c8a71df102737598143c938b2880bc15209bcdefe70d766cf069d";

interface SeenText {
  frame: number;
  map: string;
  lines: string[];
}

interface FrozenTape {
  frames: number;
  masks: number[];
}

interface ReplayedBattle {
  opponent: string;
  startFrame: number;
  endFrame: number;
  turns: number;
  outcome: string;
}

interface Replay {
  state: SessionState;
  texts: SeenText[];
  battles: ReplayedBattle[];
  sawFaintedClinic: boolean;
  sawHealedAfterFaint: boolean;
}

function expect(label: string, condition: boolean): asserts condition {
  if (!condition) throw new Error(`GB6 failure paths: ${label}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function input(mask: number, previous: number): SessionInput {
  const pressed = mask & ~previous;
  return {
    buttons: mask,
    confirmEdge: Boolean(pressed & 0x2000),
    cancelEdge: Boolean(pressed & 0x4000),
    upEdge: Boolean(pressed & 0x0010),
    downEdge: Boolean(pressed & 0x0040),
  };
}

function replay(tape: FrozenTape): Replay {
  expect("frame count differs from masks", tape.frames === tape.masks.length);
  const { project, repository: maps } = readShardedProject(ROOT);
  const session = createSession(project, 60, {
    maps,
    extensions: TUXEMON_EXTENSIONS,
    battle: TUXEMON_BATTLE_RULES,
  });
  let state = startSession(project, session);
  let previous = 0;
  let lastModalKey = "";
  let active: { opponent: string; startFrame: number } | null = null;
  let sawFaintedClinic = false;
  let wasFainted = false;
  let sawHealedAfterFaint = false;
  const texts: SeenText[] = [];
  const battles: ReplayedBattle[] = [];

  for (let frame = 0; frame < tape.masks.length; frame++) {
    const before = state.scene;
    const mask = tape.masks[frame]!;
    state = stepSession(session, state, input(mask, previous));
    previous = mask;
    if (!before && state.scene) {
      active = {
        opponent: tuxemonRuntimeBattleState(state.scene.state).battle.opponent,
        startFrame: frame,
      };
    }
    if (before && !state.scene) {
      expect(`battle exit at f${frame} had no matching entry`, active !== null);
      const ended = tuxemonRuntimeBattleState(before.state).battle;
      battles.push({
        ...active,
        endFrame: frame + 1,
        turns: ended.turn,
        outcome: ended.result?.outcome ?? "missing",
      });
      active = null;
    }

    const modal = state.interp.modal;
    const modalKey = modal?.kind === "text" ? `text|${modal.lines.join("/")}`
      : modal?.kind === "choices" ? `choices|${modal.prompt}|${modal.options.join("/")}`
        : modal?.kind === "shop" ? `shop|${modal.fiber}|${modal.stage}|${modal.index}`
          : "";
    if (modal?.kind === "text" && modalKey !== lastModalKey) {
      texts.push({ frame, map: state.mapId, lines: [...modal.lines] });
    }
    lastModalKey = modalKey;

    const party = tuxemonExtensionState(state.ext, TUXEMON_BATTLE_DB).party;
    const allFainted = party.length > 0 && party.every((monster) => (monster.currentHp ?? 0) === 0);
    if (allFainted) wasFainted = true;
    if (state.mapId === "spyder_leather_center" && state.move.tx === 6 && state.move.ty === 7 && allFainted) {
      sawFaintedClinic = true;
    }
    if (wasFainted && party.length > 0 && party.every((monster) => monster.currentHp === monster.base.hp)) {
      sawHealedAfterFaint = true;
    }
    if (state.interp.error) throw new Error(`GB6 failure paths: ${state.interp.error.message}`);
  }
  expect("tape ended inside a battle", active === null && state.scene === null);
  return { state, texts, battles, sawFaintedClinic, sawHealedAfterFaint };
}

const first = JSON.parse(readFileSync(join(ROOT, "data/gb6-first-loss-journey.json"), "utf8")) as
  FrozenTape & {
    map: string;
    position: [number, number];
    story: { billie_result: string; billie_lost: boolean; billie_won: boolean };
    sha256: string;
  };
const { sha256: firstRecordedSha, ...firstPayload } = first;
expect("first-loss payload hash changed", sha256(JSON.stringify(firstPayload)) === firstRecordedSha);
const firstReplay = replay(first);
const firstExt = tuxemonExtensionState(firstReplay.state.ext, TUXEMON_BATTLE_DB);
expect("first loss did not end on Route 1", firstReplay.state.mapId === first.map &&
  firstReplay.state.move.tx === first.position[0] && firstReplay.state.move.ty === first.position[1]);
expect("first loss did not record Billie lost", first.story.billie_result === "lost" &&
  first.story.billie_lost && !first.story.billie_won &&
  firstReplay.state.sw.switches["bo.spyder_billie.lost"] === true &&
  firstExt.history.some((row) => row.opponent === "spyder_billie" && row.outcome === "lost"));
expect("first loss did not close both fight gates", firstReplay.state.sw.variables["v.firstfightdue"] === 1 &&
  firstReplay.state.sw.variables["v.firstfightend"] === 1);
expect("First Fight - Lose was not shown exactly once after recovery",
  firstReplay.texts.filter((row) => row.lines.includes(FIRST_FIGHT_LOSE)).length === 1);
expect("first-loss faint notice was not shown exactly once",
  firstReplay.texts.filter((row) => row.lines.includes(HEAL_BEFORE_LEAVE)).length === 1);
expect("first-loss terminal state hash changed",
  sha256(canonicalJson(firstReplay.state)) === FIRST_LOSS_STATE_SHA256);

const later = JSON.parse(readFileSync(join(ROOT, "data/gb6-later-loss-journey.json"), "utf8")) as
  FrozenTape & {
    format: string;
    battle: ReplayedBattle & { swaps: number; techniques: number };
    faintPoint: { map: string; position: [number, number] };
    blockedExit: boolean;
    healed: boolean;
    end: { map: string; position: [number, number] };
    texts: SeenText[];
    terminalStateSha256: string;
    tapeSha256: string;
  };
expect("later-loss tape hash changed", sha256(JSON.stringify(later.masks)) === later.tapeSha256);
const laterReplay = replay(later);
const laterExt = tuxemonExtensionState(laterReplay.state.ext, TUXEMON_BATTLE_DB);
const wanda = laterReplay.battles.find((row) => row.opponent === "spyder_route3_wanda" && row.outcome === "lost");
expect("Wanda loss checkpoint changed", wanda !== undefined &&
  wanda.startFrame === later.battle.startFrame && wanda.endFrame === later.battle.endFrame &&
  wanda.turns === later.battle.turns);
expect("Wanda loss did not write history and battle_outcome",
  laterReplay.state.sw.switches["bo.spyder_route3_wanda.lost"] === true &&
  laterExt.history.some((row) => row.opponent === "spyder_route3_wanda" && row.outcome === "lost"));
expect("faint transfer did not preserve the all-fainted party at the clinic", laterReplay.sawFaintedClinic);
expect("clinic exit was not visibly blocked twice",
  laterReplay.texts.filter((row) => row.lines.includes(HEAL_BEFORE_LEAVE)).length === 2);
expect("nurse did not restore the party after the blocked exit", laterReplay.sawHealedAfterFaint &&
  laterExt.party.every((monster) => monster.currentHp === monster.base.hp));
expect("healed player did not leave for Leather Town", laterReplay.state.mapId === later.end.map &&
  laterReplay.state.move.tx === later.end.position[0] && laterReplay.state.move.ty === later.end.position[1]);
// Driver.tick records its post-step `masks.length`; the generic replay loop
// above uses the zero-based mask index. The generator also deliberately
// starts its SeenText list after Wanda exits, so normalize both conventions
// before comparing the frozen visible sequence.
const laterTailTexts = laterReplay.texts
  .filter((row) => row.frame >= later.battle.endFrame)
  .map((row) => ({ ...row, frame: row.frame + 1 }));
expect("later-loss visible recovery text sequence changed",
  canonicalJson(laterTailTexts.slice(0, later.texts.length)) === canonicalJson(later.texts));
expect("later-loss terminal state hash changed",
  sha256(canonicalJson(laterReplay.state)) === later.terminalStateSha256);

console.log("GB6 FAILURE PATHS PASS " + JSON.stringify({
  first: {
    frames: first.frames,
    battles: firstReplay.battles.length,
    end: `${firstReplay.state.mapId}@${firstReplay.state.move.tx},${firstReplay.state.move.ty}`,
    terminalStateSha256: FIRST_LOSS_STATE_SHA256,
  },
  later: {
    frames: later.frames,
    battle: wanda,
    faintPoint: later.faintPoint,
    blockedExit: later.blockedExit,
    healed: later.healed,
    end: `${laterReplay.state.mapId}@${laterReplay.state.move.tx},${laterReplay.state.move.ty}`,
    terminalStateSha256: later.terminalStateSha256,
  },
}));
