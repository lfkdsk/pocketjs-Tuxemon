import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  availableMapIds,
  buildProject,
  DEFAULT_IMPORT_OPTIONS,
} from "../importer/project.ts";
import { jsonBytes, writeImport } from "../importer/index.ts";
import { BTN_BITS } from "../vendor/pocket-rpgkit/src/engine/camera.ts";
import { canStepFrom, type Dir4 } from "../vendor/pocket-rpgkit/src/engine/passability.ts";
import { createSession, startSession, stepSession } from "../vendor/pocket-rpgkit/src/engine/session.ts";
import type { Command } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const ROOT = resolve(import.meta.dir, "..");

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
    placeholder: 433,
    dropped: 4_201,
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
    native: 3_529,
    degraded: 1_238,
    placeholder: 850,
    dropped: 3_046,
    tier1: {
      uses: 3_529,
      percent: 40.74,
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

test("ImportOptions defaults preserve the v1 output byte-for-byte", () => {
  const maps = ["spyder_downstairs", "spyder_paper_town"];
  expect(jsonBytes(buildProject(maps, DEFAULT_IMPORT_OPTIONS))).toBe(
    jsonBytes(buildProject(maps)),
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

test("ImportOptions.routes emits K2 arbitrary targets and path steps", () => {
  const result = buildProject(["spyder_paper_town"], { routes: true });
  const nodes = objectNodes(result.project);
  expect(nodes.some((node) =>
    node.op === "moveRoute" && node.target !== null && typeof node.target === "object"
  )).toBeTrue();
  expect(nodes.some((node) => node.pathTo !== undefined)).toBeTrue();
  expect(nodes.some((node) => node.approach !== undefined)).toBeTrue();
  expect(nodes.some((node) => node.turnToward !== undefined)).toBeTrue();
  expect(result.report.options?.routes).toBeTrue();
});

test("Spyder opening completes identically at 60, 30, and 20 Hz", () => {
  writeImport(availableMapIds());
  const transcripts: string[] = [];
  for (const hz of [60, 30, 20]) {
    const run = spawnSync(process.execPath, ["tools/smoke-spyder.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, HZ: String(hz) },
      timeout: 30_000,
    });
    if (run.status !== 0) {
      throw new Error(`smoke ${hz} Hz failed\n${run.stdout}\n${run.stderr}`);
    }
    expect(run.stdout.match(/PASS  /g)).toHaveLength(11);
    transcripts.push(run.stdout.replace(/\[\s*\d+\]/g, "[frame]"));
  }
  const beats = (transcript: string) => transcript
    .split("\n")
    .filter((line) => /(?:TEXT|PICK|MAP|PASS|RESULT)/.test(line));
  expect(beats(transcripts[1]!)).toEqual(beats(transcripts[0]!));
  expect(beats(transcripts[2]!)).toEqual(beats(transcripts[0]!));
}, 120_000);
