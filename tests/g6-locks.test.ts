import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { verifyProjectLocks } from "../tools/verify-g6-locks.ts";

const ROOT = resolve(import.meta.dir, "..");

test("every G6 lockInput has a local, transfer, or cross-event release path", () => {
  const project = JSON.parse(readFileSync(resolve(ROOT, "dist/project.json"), "utf8")) as Project;
  const report = verifyProjectLocks(project);
  expect(report.lockCommands).toBe(323);
  expect(report.pages).toBe(319);
  expect(report.outcomes).toEqual({
    "local-unlock": 300,
    "local-transfer": 0,
    unlocked: 13,
    transferred: 1,
    reachable: 5,
    unresolved: 0,
    error: 0,
  });
  expect(report.failures).toEqual([]);
}, 30_000);
