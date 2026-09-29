import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { verifyProjectLocks } from "../tools/verify-g6-locks.ts";

const ROOT = resolve(import.meta.dir, "..");

test("every G6 lockInput page dynamically releases or transfers", () => {
  const project = JSON.parse(readFileSync(resolve(ROOT, "dist/project.json"), "utf8")) as Project;
  const report = verifyProjectLocks(project);
  expect(report.format).toBe("pocket-tuxemon/g6-lock-check/v2");
  expect(report.lockCommands).toBe(323);
  expect(report.dynamicChecks).toBe(323);
  expect(report.pages).toBe(319);
  expect(report.outcomes).toMatchObject({ unresolved: 0, error: 0 });
  expect(report.failures).toEqual([]);
  expect(report.exceptions).toEqual([]);

  for (const [map, name] of [
    ["route1", "gym time"],
    ["taba_ba_br_3", "there he is"],
    ["taba_ba_main", "im here"],
    ["taba_ba_main", "time to face the master"],
    ["taba_ba_br_1", "get acolyte"],
  ] as const) {
    const row = report.rows.find((candidate) => candidate.map === map && candidate.name === name);
    expect(row, `${map}: ${name}`).toBeDefined();
    expect(row!.outcome, `${map}: ${name}`).toBe("unlocked");
    expect(row!.checks.every((check) => check.lockedAt >= 0 && check.resolvedAt >= check.lockedAt)).toBeTrue();
  }
}, 30_000);
