import { describe, expect, test } from "bun:test";
import battleDbJson from "../data/battle-db.json";
import variableEnumsJson from "../dist/variable-enums.json";

import { createTuxemonExtensions, tuxemonExtensionState } from "../battle/extension.ts";
import {
  createTuxemonBattleRules,
  tuxemonRuntimeBattleState,
  type RuntimeBattleState,
  type VariableEnums,
} from "../battle/runtime.ts";
import { validateBattleDb } from "../importer/battle-schema.ts";
import { buildProject, G6_IMPORT_OPTIONS } from "../importer/project.ts";
import { AttractController } from "../vendor/pocket-rpgkit/src/engine/attract.ts";
import type { ShopModal } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import { restoreSessionEnvelope } from "../vendor/pocket-rpgkit/src/engine/save-restore.ts";
import {
  canonicalJson,
  createSessionSnapshot,
  encodeEnvelope,
} from "../vendor/pocket-rpgkit/src/engine/save.ts";
import type {
  Command,
  Project,
  TileId,
} from "../vendor/pocket-rpgkit/src/engine/types.ts";

const DOWN = 0x0040;
const L = 0x0100;
const CIRCLE = 0x2000;
const CROSS = 0x4000;

type ShopCommand = Extract<Command, { op: "shop" }>;
type IfCondition = Extract<Command, { op: "if" }>["if"];

const DB = validateBattleDb(battleDbJson);
const ENUMS = variableEnumsJson as VariableEnums;

function objectNodes(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const child of value) objectNodes(child, out);
  } else if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    out.push(object);
    for (const child of Object.values(object)) objectNodes(child, out);
  }
  return out;
}

function importedShop(project: Project, id: string): ShopCommand {
  const command = objectNodes(project).find((node) => node.op === "shop" && node.id === id);
  if (!command) throw new Error(`missing imported shop ${id}`);
  return structuredClone(command) as ShopCommand;
}

function importedItemCondition(project: Project, id: string, count: number): IfCondition {
  const condition = objectNodes(project).find((node) =>
    node.kind === "item" && node.id === id && node.count === count
  );
  if (!condition) throw new Error(`missing imported has_item condition ${id} >= ${count}`);
  return structuredClone(condition) as IfCondition;
}

/** Isolate a real imported shop and condition on a tiny map while retaining
 * the imported item catalog and the production Tuxemon battle database. */
function sharedEconomyHarness(): Project {
  const imported = buildProject(["cotton_scoop", "taba_town"], G6_IMPORT_OPTIONS).project;
  const shop = importedShop(imported, "cotton_scoop");
  const hasTwoPotions = importedItemCondition(imported, "potion", 2);
  const tile = "tux.0" as TileId;
  return {
    ...imported,
    title: "Imported shared economy harness",
    initialGold: 140,
    start: { map: "shared_economy", x: 1, y: 2, dir: "up" },
    maps: [{
      id: "shared_economy",
      name: "Imported shared economy harness",
      width: 3,
      height: 3,
      sheets: ["tux"],
      ground: new Array(9).fill(tile),
      events: [{
        id: "flow",
        x: 1,
        y: 1,
        pages: [
          {
            trigger: "autorun",
            commands: [
              { op: "ext", call: "tux.add_monster", args: { species: "nut", level: 50 } },
              { op: "ext", call: "tux.set_monster_health", args: { health: { kind: "points", value: 1 } } },
              { op: "ext", call: "tux.set_environment", args: { environment: "grass" } },
              structuredClone(shop),
              { op: "battle", setup: { kind: "wild", species: "budaye", level: 5, environment: "grass" } },
              {
                op: "battle",
                setup: {
                  kind: "trainer",
                  opponent: "spyder_billie",
                  party: [{ species: "budaye", level: 2, experienceModifier: 5, moneyModifier: 10 }],
                  environment: "grass",
                },
              },
              structuredClone(shop),
              {
                op: "if",
                if: hasTwoPotions,
                then: [{ op: "switch", id: "condition.sees.items", value: true }],
              },
              { op: "switch", id: "flow.done", value: true },
            ],
          },
          { trigger: "action", condition: { switch: "flow.done" }, commands: [] },
        ],
      }],
    }],
  };
}

function shopModal(controller: AttractController): ShopModal {
  const modal = controller.state.interp.modal;
  if (modal?.kind !== "shop") throw new Error("expected imported shop modal");
  return modal;
}

function battleState(controller: AttractController): RuntimeBattleState | null {
  const scene = controller.state.scene;
  return scene?.kind === "battle" ? tuxemonRuntimeBattleState(scene.state) : null;
}

function fold(controller: AttractController, masks: number[], mask = 0): void {
  masks.push(mask);
  controller.step(mask);
}

function press(controller: AttractController, masks: number[], mask: number): void {
  fold(controller, masks, mask);
  fold(controller, masks, 0);
}

function advanceUntil(
  controller: AttractController,
  masks: number[],
  predicate: () => boolean,
  label: string,
): void {
  for (let guard = 0; guard < 10_000; guard++) {
    if (predicate()) return;
    fold(controller, masks);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function selectShopRow(
  controller: AttractController,
  masks: number[],
  predicate: (row: ShopModal["rows"][number]) => boolean,
): void {
  for (let guard = 0; guard < 100; guard++) {
    const modal = shopModal(controller);
    if (predicate(modal.rows[modal.index]!)) {
      press(controller, masks, CIRCLE);
      return;
    }
    press(controller, masks, DOWN);
  }
  throw new Error("shop row was not reachable");
}

function settleBattlePresentation(controller: AttractController, masks: number[]): void {
  advanceUntil(
    controller,
    masks,
    () => {
      const state = battleState(controller);
      return state === null || state.eventCursor >= state.battle.events.length;
    },
    "battle presentation",
  );
}

function selectBattleEntry(
  controller: AttractController,
  masks: number[],
  predicate: (entry: RuntimeBattleState["menu"][number]) => boolean,
): void {
  for (let guard = 0; guard < 100; guard++) {
    const state = battleState(controller);
    if (!state) throw new Error("battle ended before selecting an entry");
    if (predicate(state.menu[state.menuIndex]!)) {
      press(controller, masks, CIRCLE);
      return;
    }
    press(controller, masks, DOWN);
  }
  throw new Error("battle entry was not reachable");
}

function finishBattleWithFirstMove(controller: AttractController, masks: number[]): void {
  for (let guard = 0; guard < 100; guard++) {
    settleBattlePresentation(controller, masks);
    const state = battleState(controller);
    if (!state) return;
    if (!state.battle.awaiting) {
      fold(controller, masks);
      continue;
    }
    if (state.menuMode !== "root") press(controller, masks, CROSS);
    selectBattleEntry(controller, masks, (entry) => entry.kind === "fight");
    selectBattleEntry(controller, masks, (entry) => entry.kind === "technique");
  }
  throw new Error("battle did not finish with first-move policy");
}

describe("shared imported shop and battle economy", () => {
  test("shop purchases, battle consumption/rewards, conditions, save, and rewind use one state", () => {
    const project = sharedEconomyHarness();
    const extensions = createTuxemonExtensions(DB);
    const battle = createTuxemonBattleRules(DB, ENUMS);
    const controller = new AttractController(project, [], {
      hz: 60,
      attractEnabled: false,
      rewindSeconds: 100_000,
      extensions,
      battle,
    });
    const masks: number[] = [];
    controller.startPlay();

    fold(controller, masks); // setup commands open the imported Cotton Scoop
    expect(shopModal(controller).rows.slice(0, 3)).toEqual([
      expect.objectContaining({ kind: "item", item: "potion", price: 20 }),
      expect.objectContaining({ kind: "item", item: "revive", price: 100 }),
      expect.objectContaining({ kind: "item", item: "tuxeball", price: 50 }),
    ]);
    press(controller, masks, CIRCLE);
    press(controller, masks, CIRCLE); // two potions
    selectShopRow(controller, masks, (row) => row.kind === "item" && row.item === "tuxeball");
    press(controller, masks, CIRCLE); // two tuxeballs
    expect(controller.state.sw.items).toMatchObject({ potion: 2, tuxeball: 2 });
    expect(controller.state.sw.gold).toBe(0);

    press(controller, masks, CROSS);
    advanceUntil(controller, masks, () => battleState(controller) !== null, "wild battle");
    settleBattlePresentation(controller, masks);
    let runtime = battleState(controller)!;
    expect(runtime.menu.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["item", "capture"]));
    expect(runtime.battle.inventory).toMatchObject({ potion: 2, tuxeball: 2 });

    selectBattleEntry(controller, masks, (entry) => entry.kind === "item");
    runtime = battleState(controller)!;
    expect(runtime.menu).toContainEqual(expect.objectContaining({ kind: "item", slug: "potion", quantity: 2 }));
    selectBattleEntry(controller, masks, (entry) => entry.kind === "item" && entry.slug === "potion");
    expect(battleState(controller)!.battle.inventory.potion).toBe(1);

    settleBattlePresentation(controller, masks);
    selectBattleEntry(controller, masks, (entry) => entry.kind === "capture");
    runtime = battleState(controller)!;
    expect(runtime.menu).toContainEqual(expect.objectContaining({ kind: "capture", slug: "tuxeball", quantity: 2 }));
    selectBattleEntry(controller, masks, (entry) => entry.kind === "capture" && entry.slug === "tuxeball");
    expect(battleState(controller)?.battle.inventory.tuxeball ?? 1).toBe(1);
    finishBattleWithFirstMove(controller, masks);
    expect(controller.state.sw.items).toMatchObject({ potion: 1, tuxeball: 1 });
    expect(controller.state.sw.gold).toBe(0);

    advanceUntil(controller, masks, () => battleState(controller) !== null, "trainer battle");
    finishBattleWithFirstMove(controller, masks);
    expect(controller.state.sw.gold).toBe(20);

    advanceUntil(controller, masks, () => controller.state.interp.modal?.kind === "shop", "return shop");
    selectShopRow(controller, masks, (row) => row.kind === "sell");
    const sellRows = shopModal(controller).rows.filter((row) => row.kind === "item");
    expect(sellRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: "potion", owned: 1 }),
      expect.objectContaining({ item: "tuxeball", owned: 1 }),
    ]));

    press(controller, masks, CROSS);
    selectShopRow(controller, masks, (row) => row.kind === "item" && row.item === "potion");
    expect(controller.state.sw.gold).toBe(0);
    expect(controller.state.sw.items).toMatchObject({ potion: 2, tuxeball: 1 });
    press(controller, masks, CROSS);
    advanceUntil(controller, masks, () => controller.state.sw.switches["flow.done"] === true, "item condition");
    expect(controller.state.sw.switches["condition.sees.items"]).toBeTrue();
    const extension = tuxemonExtensionState(controller.state.ext, DB);
    expect(extension).not.toHaveProperty("inventory");
    expect(extension).not.toHaveProperty("money");

    const session = controller.getSession();
    const restored = restoreSessionEnvelope(
      session,
      encodeEnvelope(createSessionSnapshot(session, controller.state, 0)),
    );
    expect(restored.sw).toEqual(controller.state.sw);
    expect(restored.ext).toEqual(controller.state.ext);

    const terminal = canonicalJson(controller.state);
    const replayMasks = [...masks];
    controller.step(L);
    expect(controller.length).toBe(0);
    expect(controller.state.sw.items).toEqual({});
    expect(controller.state.sw.gold).toBe(140);
    for (const mask of replayMasks) controller.step(mask);
    expect(canonicalJson(controller.state)).toBe(terminal);
  }, 30_000);
});
