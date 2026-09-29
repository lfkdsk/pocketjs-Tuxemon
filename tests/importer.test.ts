import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { availableMapIds, buildProject } from "../importer/project.ts";
import { jsonBytes, writeImport } from "../importer/index.ts";
import type { Command } from "../vendor/pocket-rpgkit/src/engine/types.ts";

const ROOT = resolve(import.meta.dir, "..");

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
    native: 6_167,
    degraded: 2_822,
    placeholder: 433,
    dropped: 4_195,
    nativePercent: 45.3,
    tier1: {
      uses: 6_104,
      percent: 44.83,
      requiredUses: 6_246,
      meetsBaseline: false,
    },
  });
  expect(result.report.coverage.conditions.summary).toMatchObject({
    types: 64,
    uses: 8_663,
    native: 3_530,
    degraded: 1_238,
    placeholder: 850,
    dropped: 3_045,
    tier1: {
      uses: 3_530,
      percent: 40.75,
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
    native: 870,
    degraded: 440,
    dropped: 717,
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
