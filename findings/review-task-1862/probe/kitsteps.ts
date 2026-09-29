// Check the REAL kit canStepFrom (dist/project.json tables) against the raw-TMX oracle step table.
import { readFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { createSession } = await import(`${E}/session.ts`);
const { canStepFrom } = await import(`${E}/passability.ts`);
const project = JSON.parse(readFileSync(process.argv[2] ?? "/home/tangollvm/.fleet/worktrees/task-1833/dist/project.json", "utf8"));
const oracle = JSON.parse(readFileSync("/var/tmp/fleet/1863/probe/oracle-steps.json", "utf8"));
const KIT = ["down", "left", "up", "right"];
const ss = createSession(project, 60);
let compared = 0, mismatch = 0, oneWayOracle = 0, oneWayKitAgree = 0;
const bad: string[] = [];
const DX: Record<string, number> = { down: 0, left: -1, up: 0, right: 1 }, DY: Record<string, number> = { down: 1, left: 0, up: -1, right: 0 };
const OPP: Record<string, string> = { down: "up", up: "down", left: "right", right: "left" };
for (const [mid, rows] of Object.entries<any[]>(oracle.maps)) {
  const t = ss.tables.get(mid);
  if (!t) { bad.push(`${mid}: no table`); continue; }
  const want = new Map<string, number>();
  for (const [x, y, d, w] of rows) want.set(`${x},${y},${d}`, w);
  for (const [x, y, d, w] of rows) {
    compared++;
    const got = canStepFrom(t, x, y, KIT.indexOf(d)) ? 1 : 0;
    if (got !== w) { mismatch++; if (bad.length < 1000) bad.push(`${mid} (${x},${y}) ${d}: oracle ${w} kit ${got}`); }
    // one-way pair: forward allowed, reverse from the neighbour known to the oracle and disallowed
    const rev = want.get(`${x + DX[d]!},${y + DY[d]!},${OPP[d]}`);
    if (w === 1 && rev === 0) { oneWayOracle++; if (got === 1 && !canStepFrom(t, x + DX[d]!, y + DY[d]!, KIT.indexOf(OPP[d]!))) oneWayKitAgree++; }
  }
}
console.log(JSON.stringify({ maps: Object.keys(oracle.maps).length, compared, mismatch, oneWayOracle, oneWayKitAgree }));
for (const b of bad) console.log("  " + b);
