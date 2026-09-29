import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  availableMapIds,
  buildProject,
  DEFAULT_IMPORT_OPTIONS,
  G6_IMPORT_OPTIONS,
  K1_IMPORT_OPTIONS,
} from "../importer/project.ts";
import { jsonBytes } from "../importer/index.ts";
import { applyTerrain, importTerrain } from "../importer/terrain.ts";
import { BTN_BITS } from "../vendor/pocket-rpgkit/src/engine/camera.ts";
import { canStepFrom, type Dir4 } from "../vendor/pocket-rpgkit/src/engine/passability.ts";
import { createSwitchState } from "../vendor/pocket-rpgkit/src/engine/interpreter.ts";
import {
  createSession,
  startSession,
  stepSession,
  type SessionState,
} from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { Command } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const ROOT = resolve(import.meta.dir, "..");

type TransferCommand = Extract<Command, { op: "transfer" }>;
type LiteralTransferCommand = TransferCommand & { map: string; x: number; y: number };

function assertLiteralTransfer(command: TransferCommand): asserts command is LiteralTransferCommand {
  if (
    typeof command.map !== "string" ||
    typeof command.x !== "number" ||
    typeof command.y !== "number"
  ) {
    throw new Error("importer produced a variable-addressed transfer");
  }
}

function numericVariable(state: SessionState, id: string): number {
  const value = state.sw.variables[id];
  if (value === undefined) return 0;
  if (typeof value !== "number") throw new Error(`expected numeric variable ${id}, got ${typeof value}`);
  return value;
}

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

test("all maps pass schema and reference valid transfer destinations", () => {
  const result = buildProject(availableMapIds());
  expect(result.project.system).toEqual({ messageBlocksPlayer: true });
  expect(result.project.maps).toHaveLength(263);
  expect(result.report.schemaErrors).toEqual([]);
  expect(result.report.transferErrors).toEqual([]);
  expect(result.report.coverage).toMatchObject({
    view: "source-file",
    accounting: "conversion-path",
    sourceEvents: 4_578,
  });
  expect(result.report.coverage.actions.summary).toMatchObject({
    types: 98,
    uses: 13_617,
    native: 6_161,
    degraded: 2_822,
    placeholder: 461,
    dropped: 4_173,
    nativePercent: 45.2,
    tier1: {
      uses: 6_099,
      percent: 44.79,
      requiredUses: 6_246,
      meetsBaseline: false,
    },
  });
  expect(result.report.coverage.conditions.summary).toMatchObject({
    types: 64,
    uses: 8_663,
    native: 3_535,
    degraded: 1_238,
    placeholder: 850,
    dropped: 3_040,
    tier1: {
      uses: 3_535,
      percent: 40.81,
      requiredUses: 4_591,
      meetsBaseline: false,
    },
  });
  // Mutation guard: these conversion-derived counts fail if the recorder's
  // disposition mapping is changed to return `dropped` for every branch.
  const coverageRows = [
    ...result.report.coverage.actions.rows,
    ...result.report.coverage.conditions.rows,
  ];
  expect(coverageRows.find((row) => row.type === "char_face")).toMatchObject({
    native: 869,
    degraded: 440,
    dropped: 718,
  });
  expect(coverageRows.find((row) => row.type === "char_move")).toMatchObject({
    degraded: 9,
    dropped: 68,
  });
  expect(coverageRows.find((row) => row.type === "is char_facing")).toMatchObject({
    native: 0,
    degraded: 0,
    dropped: 1_008,
  });
  expect(coverageRows.find((row) => row.type === "set_monster_health")).toMatchObject({
    placeholder: 0,
    dropped: 83,
  });
  expect(coverageRows.find((row) => row.type === "set_monster_status")).toMatchObject({
    placeholder: 0,
    dropped: 83,
  });
  expect(new Set(result.report.rows.map((row) => row.key)).size).toBe(result.report.rows.length);
  expect(result.report.rows.some((row) => row.key === "trigger:touch:facing:T1-lowered")).toBeTrue();
  expect(Object.keys(result.variables)).toHaveLength(493);
  expect(Object.values(result.variables).filter((values) => values.length === 0)).toHaveLength(19);
  expect(
    result.report.coverage.actions.summary.native +
    result.report.coverage.actions.summary.degraded +
    result.report.coverage.actions.summary.placeholder +
    result.report.coverage.actions.summary.dropped,
  ).toBe(13_617);
  expect(
    result.report.coverage.conditions.summary.native +
    result.report.coverage.conditions.summary.degraded +
    result.report.coverage.conditions.summary.placeholder +
    result.report.coverage.conditions.summary.dropped,
  ).toBe(8_663);

  const maps = new Map(result.project.maps.map((map) => [map.id, map]));
  let transfers = 0;
  const visit = (commands: readonly Command[]): void => {
    for (const command of commands) {
      if (command.op === "transfer") {
        assertLiteralTransfer(command);
        transfers++;
        const target = maps.get(command.map);
        expect(target, `missing transfer target ${command.map}`).toBeDefined();
        expect(command.x).toBeGreaterThanOrEqual(0);
        expect(command.y).toBeGreaterThanOrEqual(0);
        expect(command.x).toBeLessThan(target!.width);
        expect(command.y).toBeLessThan(target!.height);
      } else if (command.op === "if") {
        visit(command.then);
        visit(command.else ?? []);
      } else if (command.op === "choices") {
        for (const option of command.options) visit(option.commands);
        visit(command.cancel?.commands ?? []);
      }
    }
  };
  for (const map of result.project.maps) {
    for (const event of map.events ?? []) {
      expect(event.x).toBeGreaterThanOrEqual(0);
      expect(event.y).toBeGreaterThanOrEqual(0);
      expect(event.x).toBeLessThan(map.width);
      expect(event.y).toBeLessThan(map.height);
      for (const page of event.pages) visit(page.commands);
    }
  }
  expect(transfers).toBeGreaterThan(1_000);
}, 30_000);

test("the complete import is byte-stable", () => {
  const ids = availableMapIds();
  const first = buildProject(ids);
  const second = buildProject(ids);
  expect(jsonBytes(first)).toBe(jsonBytes(second));
}, 30_000);

test("inert source events cannot freeze the Cotton Cafe", () => {
  const result = buildProject(["spyder_cotton_cafe"]);
  const cafe = result.project.maps[0]!;
  expect(cafe.events?.some((event) => event.name === "Rand facing")).toBeFalse();

  result.project.start = {
    map: "spyder_cotton_cafe",
    x: 8,
    y: 10,
    dir: "down",
  };
  const session = createSession(result.project, 60);
  let state = startSession(result.project, session);
  for (let frame = 0; frame < 20; frame++) {
    state = stepSession(session, state, { buttons: 0 });
  }
  const start = [state.move.tx, state.move.ty];
  for (let frame = 0; frame < 300; frame++) {
    state = stepSession(session, state, { buttons: BTN_BITS.LEFT });
  }
  expect([state.move.tx, state.move.ty]).not.toEqual(start);
  expect(state.interp.error).toBeUndefined();

  const wait = result.report.coverage.actions.rows.find((row) => row.type === "wait")!;
  expect(wait.reasons.dropped).toContain(
    "Tuxemon never starts an event without source conditions or behavior",
  );

  const zeroSize = buildProject(["tt_paper_town"]);
  const paperTown = zeroSize.project.maps[0]!;
  expect(paperTown.events?.some((event) => event.name === "Teleport to Sea Route")).toBeFalse();
  const transfers = zeroSize.report.coverage.actions.rows.find(
    (row) => row.type === "transition_teleport",
  )!;
  expect(transfers.reasons.dropped).toContain(
    "Tuxemon's integer tile boundary never contains a point for a zero-size TMX event",
  );
});

test("clamped transfers use the nearest deterministic walkable landing", () => {
  const result = buildProject(availableMapIds());
  const repair = result.report.transferRepairs.find(
    (entry) => entry.sourceMap === "leather_town" && entry.targetMap === "flower_city",
  );
  expect(repair).toEqual({
    sourceMap: "leather_town",
    targetMap: "flower_city",
    requested: { x: 59, y: 0 },
    clamped: { x: 39, y: 0 },
    emitted: { x: 38, y: 3 },
  });

  const landings: { x: number; y: number }[] = [];
  const collect = (commands: readonly Command[]): void => {
    for (const command of commands) {
      if (command.op === "transfer" && command.map === "flower_city") {
        assertLiteralTransfer(command);
        landings.push({ x: command.x, y: command.y });
      } else if (command.op === "if") {
        collect(command.then);
        collect(command.else ?? []);
      } else if (command.op === "choices") {
        for (const option of command.options) collect(option.commands);
      }
    }
  };
  const leather = result.project.maps.find((map) => map.id === "leather_town")!;
  for (const event of leather.events ?? []) {
    for (const page of event.pages) collect(page.commands);
  }
  expect(landings).toEqual([{ x: 38, y: 3 }, { x: 38, y: 3 }]);

  const session = createSession(result.project);
  const flower = session.tables.get("flower_city")!;
  const exits = ([0, 1, 2, 3] as Dir4[]).filter((dir) =>
    canStepFrom(flower, repair!.emitted.x, repair!.emitted.y, dir)
  );
  expect(exits.length).toBeGreaterThan(0);
});

test("default import output remains byte-pinned", () => {
  const maps = ["spyder_downstairs", "spyder_paper_town"];
  const bytes = jsonBytes(buildProject(maps, DEFAULT_IMPORT_OPTIONS));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "1f4aa5b232b560d9de776188ea4787d08fc8a68e8a12df503767c0d0948d428c",
  );
});

test("ImportOptions.areas emits a K1 rectangular event", () => {
  const result = buildProject(["spyder_candy_town"], { areas: true });
  const event = result.project.maps[0]!.events?.find((candidate) =>
    candidate.name === "Entry Candy"
  ) as (Record<string, unknown> | undefined);
  expect(event).toMatchObject({ x: 14, y: 3, w: 22, h: 1 });
  expect(result.report.options?.areas).toBeTrue();
});

test("ImportOptions.areas partitions overlaps and latches every guard before bodies", () => {
  const result = buildProject(["spyder_paper_town"], {
    areas: true,
    facing: true,
    condAll: true,
    localReset: true,
    place: true,
    inputLock: true,
  });
  const overlap = result.project.maps[0]!.events?.find((event) =>
    event.name === "Stop! + Autosave Cotton + Mom Quest Intercept"
  ) as (Record<string, unknown> | undefined);
  expect(overlap).toMatchObject({ x: 13, y: 1, w: 2, h: 1 });
  const commands = ((overlap?.pages as { commands: Command[] }[])[0]!.commands);
  const firstBody = commands.findIndex((entry) => entry.op === "if" &&
    JSON.stringify(entry).includes("Hey! What do you think you're doing?"));
  const lastLatch = commands.findLastIndex((entry) => entry.op === "switch" && entry.value === false);
  expect(lastLatch).toBeGreaterThanOrEqual(0);
  expect(firstBody).toBeGreaterThan(lastLatch);
  expect(commands.filter((entry) => entry.op === "switch" && entry.value === false)).toHaveLength(3);
});

test("ImportOptions.facing emits a K1 facing condition", () => {
  const result = buildProject(["spyder_downstairs"], { facing: true });
  const nodes = objectNodes(result.project);
  expect(nodes.some((node) => node.kind === "facing" && node.dir === "down")).toBeTrue();
  expect(result.report.options?.facing).toBeTrue();
});

test("ImportOptions.condAll emits a K1 compound page condition", () => {
  const result = buildProject(["spyder_paper_town"], { condAll: true });
  const compound = objectNodes(result.project).find((node) =>
    Array.isArray(node.all) && node.all.length >= 2
  );
  expect(compound).toBeDefined();
  expect(result.report.options?.condAll).toBeTrue();
});

test("ImportOptions.localReset selects K1 local-state semantics", () => {
  const result = buildProject(["spyder_paper_town"], { localReset: true });
  expect(JSON.stringify(result.project)).toContain("local.npc.");
  const row = result.report.coverage.conditions.rows.find(
    (candidate) => candidate.type === "not char_exists",
  )!;
  expect(row.native).toBeGreaterThan(0);
  expect(row.degraded).toBe(0);
  expect(result.report.options?.localReset).toBeTrue();
});

test("ImportOptions.place emits K1 place and page-direction constructs", () => {
  const result = buildProject(["spyder_candy_town"], { place: true });
  const nodes = objectNodes(result.project);
  expect(nodes.some((node) =>
    node.op === "place" && typeof node.target === "object"
  )).toBeTrue();
  expect(nodes.some((node) =>
    node.trigger === "action" && typeof node.dir === "string"
  )).toBeTrue();
  expect(result.report.options?.place).toBeTrue();
});

test("ImportOptions.inputLock emits K1 cross-event lock commands", () => {
  const result = buildProject(["spyder_paper_town"], { inputLock: true });
  const ops = objectNodes(result.project).map((node) => node.op);
  expect(ops).toContain("lockInput");
  expect(ops).toContain("unlockInput");
  expect(result.report.options?.inputLock).toBeTrue();
});

test("K1 appends a safety unlock when a source map has no unlock path", () => {
  const result = buildProject(["taba_ba_br_master_foyer"], K1_IMPORT_OPTIONS);
  const stop = result.project.maps[0]!.events!.find((event) => event.name === "Stop and talk")!;
  expect(stop.pages[0]!.commands.at(-1)).toEqual({ op: "unlockInput" });
  expect(result.report.rows).toContainEqual(expect.objectContaining({
    key: "trigger:orphan input lock repair:T1-lowered",
    count: 1,
  }));
});

test("all 14 labelled collision cells are removable K1 event bodies", () => {
  const result = buildProject([
    "spyder_candy_hospital3",
    "spyder_dragonscave",
    "spyder_dryadsgrove",
    "spyder_omnichannel1",
    "spyder_omnichannel2",
  ], K1_IMPORT_OPTIONS);
  const bodies = result.project.maps.flatMap((map) =>
    (map.events ?? []).filter((event) => event.name?.startsWith("collision:"))
      .map((event) => ({ map: map.id, event })),
  );
  expect(bodies).toHaveLength(14);
  for (const { map, event } of bodies) {
    const key = event.name!.slice("collision:".length);
    expect(event.pages[0]).toMatchObject({ blocks: true });
    expect(event.pages[1]).toMatchObject({
      blocks: false,
      condition: { variable: { id: `local.collision.${map}.${key}`, op: "==", value: 1 } },
    });
  }
  const writes = objectNodes(result.project).filter((node) =>
    node.op === "variable" && typeof node.id === "string" && node.id.startsWith("local.collision.")
  );
  expect(writes).toHaveLength(5);
  expect(result.report.coverage.actions.rows.find((row) => row.type === "remove_collision")).toMatchObject({
    native: 5,
    degraded: 0,
    dropped: 0,
  });
});

test("a blocking spawn cutscene survives its own presence write and unlocks input", () => {
  const options = {
    areas: true,
    facing: true,
    condAll: true,
    localReset: true,
    place: true,
    inputLock: true,
  };
  const result = buildProject(["tuxe_mart_taba"], options);
  const session = createSession(result.project, 60);
  let state = startSession(result.project, session);
  const seen = new Set<string>();
  for (let frame = 0; frame < 1_000; frame++) {
    if (state.interp.modal?.kind === "text") seen.add(state.interp.modal.lines.join(" "));
    state = stepSession(session, state, {
      buttons: 0,
      confirmEdge: state.interp.modal?.kind === "text" && frame % 2 === 0,
      cancelEdge: false,
      upEdge: false,
      downEdge: false,
    });
    if (numericVariable(state, "v.proftalk2") > 0 && !state.interp.modal) break;
  }
  expect([...seen].some((line) => line.includes("I'll take 12 potions please."))).toBeTrue();
  expect([...seen].some((line) => line.includes("My name is Kay Wren"))).toBeTrue();
  expect(numericVariable(state, "v.proftalk2")).toBeGreaterThan(0);
  expect(state.interp.inputLocked).toBeFalse();
  expect(state.interp.error).toBeUndefined();
});

test("ImportOptions.routes emits K2 arbitrary targets and path steps", () => {
  const result = buildProject(["spyder_paper_town"], { routes: true });
  const nodes = objectNodes(result.project);
  expect(nodes.some((node) =>
    node.op === "moveRoute" && node.target !== null && typeof node.target === "object"
  )).toBeTrue();
  expect(nodes.some((node) => node.pathTo !== undefined)).toBeTrue();
  expect(nodes.some((node) => node.approach !== undefined)).toBeTrue();
  expect(nodes.some((node) => node.turnToward !== undefined)).toBeTrue();
  const routeNodes = objectNodes(buildProject(["route1"], { routes: true }).project);
  const charMoves = routeNodes.filter((node) =>
    node.op === "moveRoute" && node.wait === true &&
    typeof node.route === "object" && node.route !== null &&
    Array.isArray((node.route as { steps?: unknown }).steps) &&
    (node.route as { steps: unknown[] }).steps.every((step) =>
      typeof step === "string" && step.startsWith("move")
    )
  );
  expect(charMoves.length).toBeGreaterThan(0);
  expect(charMoves.every((node) =>
    (node.route as { skippable?: boolean }).skippable === true
  )).toBeTrue();
  expect(result.report.options?.routes).toBeTrue();
});

test("open_shop becomes a visible G6 stock-summary placeholder", () => {
  const result = buildProject(availableMapIds(), G6_IMPORT_OPTIONS);
  const row = result.report.coverage.actions.rows.find((candidate) => candidate.type === "open_shop");
  expect(row).toMatchObject({ total: 28, native: 0, degraded: 0, placeholder: 28, dropped: 0 });
  const shopLines = objectNodes(result.project)
    .filter((node) => node.op === "text" && Array.isArray(node.lines))
    .flatMap((node) => node.lines as string[]);
  expect(shopLines.filter((line) => line.startsWith("[SHOP]"))).toHaveLength(28);
  expect(shopLines.join("\n")).toContain("Repellent $100");
  expect(shopLines.join("\n")).toContain("P1 placeholder; trading is unavailable.");
});

test("simultaneously eligible route1 automatic events run concurrently and release input (N1)", () => {
  const result = buildProject(["route1"], G6_IMPORT_OPTIONS);
  const projectWithTerrain = applyTerrain(result.project, importTerrain({ mapIds: ["route1"] }).fragment);
  const route = projectWithTerrain.maps[0]!;
  for (const name of ["omnigruntmove", "omnigrunt2move", "omnigrunt3move", "omnigrunt4move"]) {
    expect(route.events?.find((event) => event.name === name)?.pages[0]?.trigger).toBe("parallel");
  }

  const project = {
    ...projectWithTerrain,
    start: { map: "route1", x: 31, y: 25, dir: "down" as const },
  };
  const session = createSession(project, 60);
  let state = startSession(project, session, createSwitchState({
    variables: { "sys.party_size": 1, "v.whoartthou": 5 },
  }));
  let locked = false;
  for (let frame = 0; frame < 12_000; frame++) {
    const modal = state.interp.modal;
    state = stepSession(session, state, {
      buttons: frame < 4 ? BTN_BITS.DOWN : 0,
      confirmEdge: modal ? frame % 2 === 0 : frame === 6,
      cancelEdge: false,
      upEdge: false,
      downEdge: false,
    });
    locked ||= state.interp.inputLocked;
    if (locked && !state.interp.inputLocked) break;
  }
  expect(locked).toBeTrue();
  expect(state.interp.inputLocked).toBeFalse();
  expect(numericVariable(state, "v.completethis")).toBeGreaterThan(0);
  expect(numericVariable(state, "v.left")).toBeGreaterThan(0);
  expect(state.interp.error).toBeUndefined();
});

test("Spyder opening completes identically at 60, 30, 20, and 4 Hz", () => {
  const maintainedProject = resolve(ROOT, "dist/project.json");
  const before = readFileSync(maintainedProject);
  const scratchParent = resolve(process.env.G6_SCRATCH_ROOT ?? "/var/tmp/fleet/pocket-tuxemon");
  mkdirSync(scratchParent, { recursive: true });
  const isolatedRoot = mkdtempSync(join(scratchParent, "g6-hz-"));
  const transcripts: string[] = [];
  const results: Record<string, unknown>[] = [];
  const runAt = (hz: number) => {
    const run = spawnSync(process.execPath, ["tools/smoke-spyder.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, G6_PROJECT_ROOT: isolatedRoot, HZ: String(hz) },
      timeout: 30_000,
    });
    if (run.status !== 0) {
      throw new Error(`smoke ${hz} Hz failed\n${run.stdout}\n${run.stderr}`);
    }
    const result = JSON.parse(readFileSync(resolve(isolatedRoot, `dist/journey-spyder-${hz}hz.json`), "utf8")) as Record<string, unknown>;
    return { run, result };
  };
  try {
    const generated = spawnSync(process.execPath, ["gen-assets.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, G6_OUTPUT_ROOT: isolatedRoot },
      timeout: 30_000,
    });
    if (generated.status !== 0) {
      throw new Error(`isolated G6 cook failed\n${generated.stdout}\n${generated.stderr}`);
    }
    const assetReport = JSON.parse(readFileSync(resolve(isolatedRoot, "data/g6-assets-report.json"), "utf8"));
    expect(assetReport.project).toMatchObject({ maps: 263, options: G6_IMPORT_OPTIONS });

    for (const hz of [60, 30, 20, 4]) {
      const { run, result } = runAt(hz);
      expect(run.stdout.match(/PASS  /g)).toHaveLength(12);
      expect(run.stdout).toContain('"map":"spyder_route1"');
      transcripts.push(run.stdout.replace(/\[\s*\d+\]/g, "[frame]"));
      results.push(result);
    }
    const beats = (transcript: string) => transcript
      .split("\n")
      // PASS lines can straddle a new map's first autorun text at low host
      // rates because one folded host frame advances both. The observable
      // story sequence and final state must still be identical.
      .filter((line) => /(?:TEXT|PICK|MAP)/.test(line));
    expect(beats(transcripts[1]!)).toEqual(beats(transcripts[0]!));
    expect(beats(transcripts[2]!)).toEqual(beats(transcripts[0]!));
    expect(beats(transcripts[3]!)).toEqual(beats(transcripts[0]!));

    const outcome = (result: Record<string, unknown>) => ({
      map: result.map,
      position: result.position,
      story: result.story,
      checkpoints: (result.checkpoints as { name: string; map: string; position: [number, number] }[])
        .map(({ name, map, position }) => ({ name, map, position })),
    });
    for (const result of results.slice(1)) expect(outcome(result)).toEqual(outcome(results[0]!));

    const repeated = runAt(60).result;
    expect(repeated.sha256).toBe(results[0]!.sha256);
    expect(repeated.masks).toEqual(results[0]!.masks);
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
  expect(readFileSync(maintainedProject)).toEqual(before);
}, 120_000);
