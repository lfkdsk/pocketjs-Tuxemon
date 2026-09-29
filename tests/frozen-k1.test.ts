import { expect, test } from "bun:test";
import type { MapDef, Project } from "../vendor/pocket-rpgkit/src/engine/types.ts";
import { verifyFrozenProject } from "../tools/frozen-k1.ts";

function project(maps: MapDef[], start = maps[0]!.id): Project {
  return {
    format: "rpgkit-project/v1",
    title: "freeze probe",
    tileSize: 16,
    start: { map: start, x: 0, y: 0, dir: "down" },
    sheets: [{ id: "floor", cols: 1, rows: 1, defaultPassage: "pass" }],
    items: [],
    maps,
  };
}

const map = (id: string, events: MapDef["events"]): MapDef => ({
  id,
  name: id,
  width: 1,
  height: 1,
  sheets: ["floor"],
  ground: ["floor.0"],
  events,
});

test("freeze scan counts a permanent input lock acquired after transfer", () => {
  const source = map("source", [{
    id: "leave",
    x: 0,
    y: 0,
    pages: [{ trigger: "autorun", sprite: null, commands: [{ op: "transfer", map: "destination", x: 0, y: 0, fade: 0 }] }],
  }]);
  const destination = map("destination", [{
    id: "lock",
    x: 0,
    y: 0,
    pages: [{ trigger: "autorun", sprite: null, commands: [{ op: "lockInput" }, { op: "wait", seconds: 999 }] }],
  }]);
  const report = verifyFrozenProject(project([source, destination]), 30);
  expect(report.flagged.find((row) => row.map === "source")).toMatchObject({
    finalMap: "destination",
    inputLocked: true,
  });
});

test("freeze scan treats a repeating dialogue with no world change as blocked", () => {
  const loop = map("loop", [{
    id: "again",
    x: 0,
    y: 0,
    pages: [{ trigger: "autorun", sprite: null, commands: [{ op: "text", lines: ["Again."], cps: 10_000 }] }],
  }]);
  const report = verifyFrozenProject(project([loop]), 30);
  expect(report.flagged).toHaveLength(1);
  expect(report.flagged[0]).toMatchObject({ map: "loop", inputLocked: false, blocking: true });
});
