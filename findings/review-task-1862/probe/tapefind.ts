// Replay the maintained tape on a bundle and log map changes, modal texts, and
// frames where any NPC stands on a given cell.
import { readFileSync } from "node:fs";
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { bootWorld } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts`);
const journey = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const [bundle, cellArg] = process.argv.slice(2);
const [cx, cy] = (cellArg ?? "19,13").split(",").map(Number);
const world = await bootWorld(bundle, 60, undefined, undefined, { width: 480, height: 272 });
let lastMap = "", lastText = "";
for (let f = 0; f < journey.masks.length; f++) {
  world.frame(journey.masks[f]); world.tick();
  const st = (globalThis as any).__rpgSessionState;
  if (st.mapId !== lastMap) { console.log(`[${f}] MAP ${st.mapId} @${st.move.tx},${st.move.ty}`); lastMap = st.mapId; }
  const m = st.interp.modal; const t = m ? (m.kind === "text" ? m.lines.join(" / ") : "CHOICE " + m.options.join("|")) : "";
  if (t && t !== lastText) {
    const at = Object.entries<any>(st.chars.chars).filter(([, c]) => c.tx === cx && c.ty === cy).map(([k]) => k);
    console.log(`[${f}] ${m.kind === "text" ? "TEXT" : ""} ${t.slice(0, 70)} | player ${st.move.tx},${st.move.ty} | at ${cx},${cy}: ${at.join(",") || "-"} | fiber ${m.fiber}`);
  }
  lastText = t;
}
