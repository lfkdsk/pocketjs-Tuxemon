// Input-only failure journey: replay the frozen mainline to Route 3, lose to
// Wanda deliberately, prove the faint transfer/clinic exit guard, heal, and
// leave the clinic normally.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expectedTechniqueDamage } from "../battle/autoplay.ts";
import { tuxemonExtensionState } from "../battle/extension.ts";
import { battleDbToTuxemonBattleDb } from "../battle/from-battle-db.ts";
import { TUXEMON_BATTLE_DB } from "../battle/game.ts";
import { battleMenuEntries, tuxemonRuntimeBattleState, type RuntimeBattleState } from "../battle/runtime.ts";
import type { BattleInput } from "../vendor/pocket-rpgkit/src/engine/battle.ts";
import { BTN_BITS } from "../vendor/pocket-rpgkit/src/engine/camera.ts";
import { canonicalJson } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import type { Gb6JourneyResult } from "./gb6-journey.ts";
import { Driver } from "./gb6-journey.ts";
import { readInlineProject } from "./generated-project.ts";
import { createSession, startSession } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import { TUXEMON_BATTLE_RULES, TUXEMON_EXTENSIONS, TUXEMON_SCENES } from "../battle/game.ts";

const ROOT = resolve(import.meta.dir, "..");
const MAINLINE = resolve(process.env.GB6_JOURNEY ?? join(ROOT, "data/gb6-mainline-journey.json"));
const OUTPUT = resolve(process.env.GB6_LATER_LOSS_OUT ?? join(ROOT, "data/gb6-later-loss-journey.json"));
const BTN_CONFIRM = 0x2000;
const BTN_CANCEL = 0x4000;
const RULE_DB = battleDbToTuxemonBattleDb(TUXEMON_BATTLE_DB);
const HEAL_BEFORE_LEAVE = "You should heal your monsters before heading off.";

function expect(label: string, condition: boolean): asserts condition {
  if (!condition) throw new Error(`GB6 later loss: ${label}`);
}

function indexInput(state: RuntimeBattleState, wanted: number): BattleInput {
  return state.menuIndex === wanted ? { buttons: 0, confirmEdge: true } : { buttons: 0, downEdge: true };
}

/** Spend turns swapping whenever possible, otherwise use the least damaging
 * move (zero-damage status moves sort first).  It reads no RNG and is only a
 * failure-path test policy, not part of the shipped winning autoplay. */
function loseBattleInput(state: RuntimeBattleState): BattleInput {
  if (state.eventCursor < state.battle.events.length) return { buttons: 0, confirmEdge: true };
  if (!state.battle.awaiting || state.battle.phase === "ended") return { buttons: 0 };
  if (state.menuMode === "root") {
    const replacement = state.menu.findIndex((entry) => entry.kind === "replacement" && entry.available);
    const fight = state.menu.findIndex((entry) => entry.kind === "fight" && entry.available);
    return indexInput(state, replacement >= 0 ? replacement : fight);
  }
  if (state.menuMode === "swap") {
    const entries = battleMenuEntries(state, RULE_DB, "swap");
    const wanted = entries.findIndex((entry) => entry.available);
    return wanted < 0 ? { buttons: 0, cancelEdge: true } : indexInput(state, wanted);
  }
  if (state.menuMode === "technique") {
    const entries = battleMenuEntries(state, RULE_DB, "technique");
    let wanted = 0;
    let score = Number.POSITIVE_INFINITY;
    for (let index = 0; index < entries.length; index++) {
      const next = expectedTechniqueDamage(RULE_DB, state, entries[index]!);
      if (next < score) {
        score = next;
        wanted = index;
      }
    }
    return indexInput(state, wanted);
  }
  return { buttons: 0, cancelEdge: true };
}

function maskFor(input: BattleInput): number {
  if (input.confirmEdge) return BTN_CONFIRM;
  if (input.cancelEdge) return BTN_CANCEL;
  if (input.downEdge) return BTN_BITS.DOWN;
  if (input.upEdge) return BTN_BITS.UP;
  return input.buttons;
}

interface SeenText {
  frame: number;
  map: string;
  lines: string[];
}

function settleAndRecord(driver: Driver, texts: SeenText[], choices: string[] = [], maxFrames = 20_000): void {
  let idle = 0;
  let lastText = "";
  for (let guard = 0; guard < maxFrames; guard++) {
    expect("unexpected battle while settling the faint path", driver.state.scene === null);
    const modal = driver.state.interp.modal;
    if (modal?.kind === "text") {
      const key = modal.lines.join("\n");
      if (key !== lastText) texts.push({ frame: driver.masks.length, map: driver.state.mapId, lines: [...modal.lines] });
      lastText = key;
      driver.pulse(BTN_CONFIRM);
      idle = 0;
      continue;
    }
    lastText = "";
    if (modal?.kind === "choices") {
      const wanted = choices.shift() ?? modal.options[0]!;
      const index = modal.options.indexOf(wanted);
      expect(`choice '${wanted}' not found`, index >= 0);
      while (driver.state.interp.modal?.kind === "choices" && driver.state.interp.modal.index !== index) {
        driver.pulse(BTN_BITS.DOWN);
      }
      driver.pulse(BTN_CONFIRM);
      idle = 0;
      continue;
    }
    if (modal?.kind === "shop") {
      driver.pulse(BTN_CANCEL);
      idle = 0;
      continue;
    }
    driver.tick();
    if (driver.state.interp.main || driver.state.interp.inputLocked || driver.state.fade || driver.state.move.moving) {
      idle = 0;
    } else if (++idle >= 12) {
      return;
    }
  }
  throw new Error(`GB6 later loss: settle exceeded ${maxFrames} frames at ${driver.where()}`);
}

const journey = JSON.parse(readFileSync(MAINLINE, "utf8")) as Gb6JourneyResult;
const target = journey.battles.find((row) => row.opponent === "spyder_route3_wanda");
expect("mainline has no Wanda checkpoint", target !== undefined);
const project = readInlineProject(ROOT);
const session = createSession(project, 60, {
  extensions: TUXEMON_EXTENSIONS,
  battle: TUXEMON_BATTLE_RULES,
  scenes: TUXEMON_SCENES,
});
const driver = new Driver(session, 60, startSession(project, session));
for (let frame = 0; frame <= target.startFrame; frame++) driver.tick(journey.masks[frame]!);
expect("prefix did not enter Wanda's trainer battle", driver.state.scene !== null &&
  tuxemonRuntimeBattleState(driver.state.scene.state).battle.opponent === "spyder_route3_wanda");

const lossStart = driver.masks.length - 1;
let swaps = 0;
let techniques = 0;
for (let guard = 0; guard < 40_000 && driver.state.scene; guard++) {
  const battle = tuxemonRuntimeBattleState(driver.state.scene.state);
  const choice = loseBattleInput(battle);
  if (choice.confirmEdge) {
    const selected = battle.menu[battle.menuIndex];
    if (battle.menuMode === "swap" && selected?.kind === "replacement") swaps++;
    if (battle.menuMode === "technique" && selected?.kind === "technique") techniques++;
  }
  const mask = maskFor(choice);
  mask === 0 ? driver.tick() : driver.pulse(mask);
}
expect("Wanda battle did not terminate under the deterministic loss policy", driver.state.scene === null);
const lost = driver.battles.at(-1);
expect(`Wanda outcome was ${lost?.outcome ?? "missing"}`, lost?.opponent === "spyder_route3_wanda" && lost.outcome === "lost");
expect("loss did not set bo.spyder_route3_wanda.lost", driver.state.sw.switches["bo.spyder_route3_wanda.lost"] === true);

const texts: SeenText[] = [];
settleAndRecord(driver, texts);
expect(`faint transfer ended at ${driver.where()}`, driver.state.mapId === "spyder_leather_center" &&
  driver.state.move.tx === 6 && driver.state.move.ty === 7);
expect("Teleport Faint did not show heal_before_leave exactly once",
  texts.filter((entry) => entry.lines.includes(HEAL_BEFORE_LEAVE)).length === 1);
expect("worldIdle did not let Wanda's post-battle gift finish before faint transfer",
  texts.some((entry) => entry.lines.includes("Here, you can have my Fishing Rod.")) &&
  texts.some((entry) => entry.lines.includes("Fishing Rod")) &&
  driver.state.sw.items.fishing_rod === 1);
expect("party was unexpectedly healed by the faint transfer",
  tuxemonExtensionState(driver.state.ext, TUXEMON_BATTLE_DB).party.every((monster) => (monster.currentHp ?? 0) === 0));

driver.goTo(6, 9);
driver.walkTo(6, 10, true);
for (let guard = 0; guard < 240 && driver.state.interp.modal === null; guard++) driver.tick();
const blocked = driver.state.interp.modal;
expect("clinic exit did not open Cannot Leave Fainted", blocked?.kind === "text" &&
  blocked.lines.includes(HEAL_BEFORE_LEAVE));
settleAndRecord(driver, texts);
expect("fainted player escaped the clinic", driver.state.mapId === "spyder_leather_center");
expect("Cannot Leave Fainted did not add exactly one second warning",
  texts.filter((entry) => entry.lines.includes(HEAL_BEFORE_LEAVE)).length === 2);

driver.goTo(5, 6);
driver.pulse(BTN_BITS.UP | BTN_CONFIRM);
driver.settle(["Yes"]);
const healed = tuxemonExtensionState(driver.state.ext, TUXEMON_BATTLE_DB).party;
expect("nurse did not fully heal the party", healed.every((monster) => monster.currentHp === monster.base.hp));
driver.goTo(6, 9);
driver.goTo(6, 10);
driver.settle();
expect(`healed player could not leave the clinic (${driver.where()})`, String(driver.state.mapId) === "spyder_leather_town");

const result = {
  format: "pocket-tuxemon/gb6-later-loss/v1",
  hz: 60,
  frames: driver.masks.length,
  prefixFrames: target.startFrame + 1,
  masks: driver.masks,
  battle: {
    opponent: lost.opponent,
    startFrame: lossStart,
    endFrame: lost.endFrame,
    turns: lost.turns,
    outcome: lost.outcome,
    swaps,
    techniques,
  },
  faintPoint: { map: "spyder_leather_center", position: [6, 7] },
  blockedExit: true,
  healed: true,
  end: { map: driver.state.mapId, position: [driver.state.move.tx, driver.state.move.ty] },
  texts,
  terminalStateSha256: createHash("sha256").update(canonicalJson(driver.state)).digest("hex"),
  tapeSha256: createHash("sha256").update(JSON.stringify(driver.masks)).digest("hex"),
};
writeFileSync(OUTPUT, JSON.stringify(result, null, 2) + "\n");
console.log(`GB6 LATER LOSS PASS frames=${result.frames} turns=${lost.turns} swaps=${swaps} `
  + `techniques=${techniques} texts=${texts.length} end=${result.end.map}@${result.end.position.join(",")} `
  + `state=${result.terminalStateSha256}`);
