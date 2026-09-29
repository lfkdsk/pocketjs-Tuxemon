import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { createSession } = await import(`${E}/session.ts`);
const { canStepFrom } = await import(`${E}/passability.ts`);
const [path, mapId, ...cells] = process.argv.slice(2);
const project = JSON.parse(readFileSync(path!, "utf8"));
const ss = createSession({ ...project, start: { map: mapId, x: 0, y: 0, dir: "down" } }, 60);
const t = ss.tables.get(mapId);
const D = ["down", "left", "up", "right"];
for (const c of cells) { const [x, y] = c.split(",").map(Number); console.log(`${x},${y}`, D.map((d, i) => `${d}:${canStepFrom(t, x, y, i) ? "Y" : "n"}`).join(" ")); }
