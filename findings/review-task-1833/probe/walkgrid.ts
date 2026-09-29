import { readFileSync, writeFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { createSession } = await import(`${E}/session.ts`);
const { canStepFrom } = await import(`${E}/passability.ts`);
const project = JSON.parse(readFileSync("/var/tmp/fleet/1838/project-g6.json", "utf8"));
const sess = createSession(project, 60);
const out: Record<string, { w: number; h: number; walk: number[] }> = {};
for (const id of process.argv.slice(2)) {
  const m = project.maps.find((mm: any) => mm.id === id);
  const t = sess.tables.get(id);
  const walk: number[] = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    // enterable from at least one side
    let ok = 0;
    for (let d = 0; d < 4; d++) { const DX = [0, -1, 0, 1][d]!, DY = [1, 0, -1, 0][d]!; const fx = x - DX, fy = y - DY; if (fx >= 0 && fy >= 0 && fx < m.width && fy < m.height && canStepFrom(t, fx, fy, d)) ok = 1; }
    walk.push(ok);
  }
  out[id] = { w: m.width, h: m.height, walk };
}
writeFileSync("/var/tmp/fleet/1838/walkgrid.json", JSON.stringify(out));
console.log(Object.keys(out).join(","));
