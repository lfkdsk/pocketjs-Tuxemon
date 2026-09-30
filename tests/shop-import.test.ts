import { describe, expect, test } from "bun:test";
import { buildProject, G6_IMPORT_OPTIONS } from "../importer/project.ts";
import { createSwitchState, type ShopModal } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import { restoreSessionEnvelope } from "../vendor/pocket-rpgkit/src/engine/save-restore.ts";
import { createSessionSnapshot, encodeEnvelope } from "../vendor/pocket-rpgkit/src/engine/save.ts";
import {
  createSession,
  startSession,
  stepSession,
  type Session,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type {
  Command,
  Project,
  ShopGood,
  TileId,
} from "../vendor/pocket-rpgkit/src/engine/types.ts";

type ShopCommand = Extract<Command, { op: "shop" }>;

function collectShops(commands: readonly Command[], out: ShopCommand[]): void {
  for (const command of commands) {
    if (command.op === "shop") out.push(command);
    else if (command.op === "if") {
      collectShops(command.then, out);
      collectShops(command.else ?? [], out);
    } else if (command.op === "choices") {
      for (const option of command.options) collectShops(option.commands, out);
      collectShops(command.cancel?.commands ?? [], out);
    } else if (command.op === "battle") {
      collectShops(command.onWin ?? [], out);
      collectShops(command.onLose ?? [], out);
      collectShops(command.onEscape ?? [], out);
    }
  }
}

function importedShop(project: Project, id: string): ShopCommand {
  const shops: ShopCommand[] = [];
  for (const map of project.maps) {
    for (const event of map.events ?? []) {
      for (const page of event.pages) collectShops(page.commands, shops);
    }
  }
  const shop = shops.find((candidate) => candidate.id === id);
  if (!shop) throw new Error(`missing imported shop ${id}`);
  return shop;
}

/** Keep the exact imported shop command and catalog, but put the command on a
 * tiny action map so this test exercises commerce rather than pathfinding to
 * a particular counter tile. */
function shopHarness(source: Project, shop: ShopCommand): Project {
  const tile = "tux.0" as TileId;
  return {
    ...source,
    start: { map: "shop_harness", x: 1, y: 2, dir: "up" },
    maps: [{
      id: "shop_harness",
      name: "Imported shop harness",
      width: 3,
      height: 3,
      sheets: ["tux"],
      ground: new Array(9).fill(tile),
      events: [{
        id: "shop_counter",
        x: 1,
        y: 1,
        pages: [{ trigger: "action", sprite: null, commands: [shop] }],
      }],
    }],
  };
}

const edge = (partial: Partial<{
  confirmEdge: boolean;
  cancelEdge: boolean;
  upEdge: boolean;
  downEdge: boolean;
}> = {}) => ({
  buttons: 0,
  confirmEdge: false,
  cancelEdge: false,
  upEdge: false,
  downEdge: false,
  ...partial,
});

function tick(session: Session, state: SessionState, input = edge()): SessionState {
  return stepSession(session, state, input);
}

function modal(state: SessionState): ShopModal {
  if (state.interp.modal?.kind !== "shop") throw new Error("expected a shop modal");
  return state.interp.modal;
}

function openShop(project: Project, hz: number, variables: Record<string, number> = {}): {
  session: Session;
  state: SessionState;
} {
  const session = createSession(project, hz);
  let state = startSession(project, session, createSwitchState({ gold: 10_000, variables }));
  state = tick(session, state, edge({ confirmEdge: true }));
  expect(state.interp.modal?.kind).toBe("shop");
  return { session, state };
}

interface CottonSummary {
  gold: number;
  items: Record<string, number>;
  stock: Record<string, number>;
}

function driveCottonTech(source: Project, hz: number): CottonSummary {
  const project = shopHarness(source, importedShop(source, "spyder_cotton_tech"));
  const opened = openShop(project, hz);
  const session = opened.session;
  let state = opened.state;

  expect(modal(state).rows[0]).toMatchObject({ item: "miaow_milk", price: 2_000 });
  state = tick(session, state, edge({ confirmEdge: true })); // buy miaow_milk
  expect(state.sw.gold).toBe(8_000);
  expect(state.sw.items.miaow_milk).toBe(1);

  for (let index = 0; index < 5; index++) state = tick(session, state, edge({ downEdge: true }));
  expect(modal(state).rows[modal(state).index]).toEqual({ kind: "sell" });
  state = tick(session, state, edge({ confirmEdge: true }));
  expect(modal(state).stage).toBe("sell");
  expect(modal(state).rows[0]).toMatchObject({ item: "miaow_milk", price: 400, sellable: true });
  state = tick(session, state, edge({ confirmEdge: true })); // sell it back
  expect(state.sw.gold).toBe(8_400);
  expect(state.sw.items.miaow_milk).toBe(0);

  state = tick(session, state, edge({ cancelEdge: true })); // buy stage, index 0
  for (let index = 0; index < 3; index++) state = tick(session, state, edge({ downEdge: true }));
  expect(modal(state).rows[modal(state).index]).toMatchObject({ item: "tm_avalanche", stock: 1 });
  state = tick(session, state, edge({ confirmEdge: true })); // exhaust the one-unit stock
  expect(state.sw.gold).toBe(6_400);
  expect(state.sw.items.tm_avalanche).toBe(1);
  expect(state.sw.shopStock["spyder_cotton_tech:tm_avalanche"]).toBe(0);
  expect(modal(state).rows[modal(state).index]).toMatchObject({ stock: 0, atCap: true });

  state = tick(session, state, edge({ confirmEdge: true })); // sold out: no effect
  expect(state.sw.gold).toBe(6_400);
  expect(state.sw.items.tm_avalanche).toBe(1);
  state = tick(session, state, edge({ cancelEdge: true }));
  expect(state.interp.modal).toBeNull();

  const envelope = encodeEnvelope(createSessionSnapshot(session, state, 0), session.content);
  const restored = restoreSessionEnvelope(session, envelope);
  expect(restored.sw.shopStock["spyder_cotton_tech:tm_avalanche"]).toBe(0);
  return {
    gold: restored.sw.gold,
    items: { ...restored.sw.items },
    stock: { ...restored.sw.shopStock },
  };
}

function variableConditionValue(good: ShopGood, id: string): number {
  const condition = good.condition?.all?.find((candidate) =>
    candidate.kind === "variable" && candidate.id === id
  );
  if (!condition || condition.kind !== "variable") {
    throw new Error(`missing imported variable condition ${id} on ${good.item}`);
  }
  return condition.value;
}

describe("imported Tuxemon shops", () => {
  const imported = buildProject(["spyder_cotton_scoop", "spyder_flower_scoop"], G6_IMPORT_OPTIONS).project;

  test("a real Cotton Tech command buys, sells, exhausts stock, and formally saves", () => {
    const summaries = [60, 30, 20, 4].map((hz) => driveCottonTech(imported, hz));
    for (const summary of summaries.slice(1)) expect(summary).toEqual(summaries[0]);
    expect(summaries[0]).toEqual({
      gold: 6_400,
      items: { miaow_milk: 0, tm_avalanche: 1 },
      stock: { "spyder_cotton_tech:tm_avalanche": 0 },
    });
  });

  test("real Flower Scoop daytime goods follow imported variable conditions", () => {
    const shop = importedShop(imported, "spyder_flower_scoop");
    const diurnal = shop.goods.find((good) => good.item === "tuxeball_diurnal");
    const nocturnal = shop.goods.find((good) => good.item === "tuxeball_nocturnal");
    if (!diurnal || !nocturnal) throw new Error("missing conditional Flower Scoop goods");

    const visible = (value: number): string[] => {
      const project = shopHarness(imported, shop);
      const { state } = openShop(project, 60, { "v.daytime": value });
      return modal(state).rows.flatMap((row) => row.kind === "item" ? [row.item] : []);
    };
    const day = visible(variableConditionValue(diurnal, "v.daytime"));
    const night = visible(variableConditionValue(nocturnal, "v.daytime"));
    expect(day).toContain("tuxeball_diurnal");
    expect(day).not.toContain("tuxeball_nocturnal");
    expect(night).toContain("tuxeball_nocturnal");
    expect(night).not.toContain("tuxeball_diurnal");
  });
});
