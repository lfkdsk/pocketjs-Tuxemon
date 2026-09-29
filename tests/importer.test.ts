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
