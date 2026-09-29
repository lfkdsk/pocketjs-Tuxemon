// findings/scout-S1/smoke.ts — Scout S1 one-off (NOT product code): drive
// the converted Spyder opening (proto-v1.json) through the kit's own
// session reducer, headless, and check the story beats land.
//
//   bun findings/scout-S1/proto.ts && bun findings/scout-S1/smoke.ts
//
// The driver only presses buttons: confirm/down edges for text and choice
// boxes, held d-pad for walking (BFS over the kit's passage table with
// character bodies). G5 replaces the prototype's collision-only placeholder
// with the generated TMX terrain fragment before the session starts.

import { readFileSync, writeFileSync } from "node:fs";
import { createSession, startSession, stepSession, tableWithBodies, type SessionState } from "../../vendor/pocket-rpgkit/src/engine/session.ts";
import { canStepFrom, type Dir4 } from "../../vendor/pocket-rpgkit/src/engine/passability.ts";
import { BTN_BITS } from "../../vendor/pocket-rpgkit/src/engine/camera.ts";
import type { Project } from "../../vendor/pocket-rpgkit/src/engine/types.ts";
import { applyTerrain, importTerrain } from "../../importer/terrain.ts";

const DIR = new URL(".", import.meta.url).pathname;
const baseProject = JSON.parse(readFileSync(`${DIR}proto-v1.json`, "utf8")) as Project;
const terrain = importTerrain({ mapIds: baseProject.maps.map((map) => map.id) });
const project = applyTerrain(baseProject, terrain.fragment);
const HZ = Number(process.env.HZ ?? 60); // host rate; the kit folds 60/HZ reference ticks per frame
const sess = createSession(project, HZ);
let st: SessionState = startSession(project, sess);

const DX = [0, -1, 0, 1];
const DY = [1, 0, -1, 0];
const BTN_OF: Record<Dir4, number> = { 0: BTN_BITS.DOWN, 1: BTN_BITS.LEFT, 2: BTN_BITS.UP, 3: BTN_BITS.RIGHT };
const journal: string[] = [];
let frames = 0;
let lastModalKey = "";
let lastMap = st.mapId;

function note(s: string): void {
  journal.push(`[${String(frames).padStart(5)}] ${s}`);
}

function tick(buttons = 0, edges: { confirm?: boolean; down?: boolean; up?: boolean } = {}): void {
  st = stepSession(sess, st, { buttons, confirmEdge: !!edges.confirm, downEdge: !!edges.down, upEdge: !!edges.up, cancelEdge: false });
  frames++;
  const m = st.interp.modal;
  const key = m ? `${m.kind}|${m.kind === "text" ? m.lines.join("/") : m.prompt + "|" + m.options.join("/")}` : "";
  if (key && key !== lastModalKey) note(m!.kind === "text" ? `TEXT  ${m!.lines.join(" / ")}` : `CHOICE [${(m as { options: string[] }).options.join(" | ")}]`);
  lastModalKey = key;
  if (st.mapId !== lastMap) { note(`MAP   ${lastMap} -> ${st.mapId} @${st.move.tx},${st.move.ty}`); lastMap = st.mapId; }
  if (st.interp.error) throw new Error(st.interp.error.message);
}

const v = (id: string) => st.sw.variables[id] ?? 0;

/** Advance text boxes; answer choice boxes from `answers` (label wanted). */
function settle(answers: string[] = [], maxFrames = 3000): void {
  const startMap = st.mapId;
  for (let i = 0; i < maxFrames; i++) {
    // a transfer ends this beat once its fade has finished
    if (st.mapId !== startMap && !st.fade) return;
    const m = st.interp.modal;
    if (!m) {
      // let autoruns start / fades end; stop once idle for a few frames
      let idle = 0;
      while (!st.interp.modal && idle < 12) {
        tick();
        if (st.mapId !== startMap && !st.fade) return;
        idle = st.interp.main || st.fade ? 0 : idle + 1;
        if (frames > 200000) return;
      }
      if (!st.interp.modal) return;
      continue;
    }
    if (m.kind === "text") { tick(0, { confirm: true }); tick(); continue; }
    const want = answers.shift();
    const idx = want === undefined ? 0 : m.options.findIndex((o) => o === want);
    if (idx < 0) throw new Error(`choice ${want} not in [${m.options.join(", ")}]`);
    while ((st.interp.modal as { index: number } | null)?.index !== idx) { tick(0, { down: true }); tick(); }
    note(`PICK  ${m.options[idx]}`);
    tick(0, { confirm: true }); tick();
  }
  throw new Error("settle: modal never closed");
}

/** Cells of active playerTouch pages: the walker steps on them only as a
 *  goal. (Found the hard way: v1 drops Tuxemon's `char_facing player,down`
 *  on exit mats, so crossing a mat sideways leaves the map.) */
function touchCells(): Set<string> {
  const map = project.maps.find((m) => m.id === st.mapId)!;
  const out = new Set<string>();
  for (const ev of map.events ?? []) {
    const page = [...ev.pages].reverse().find((p) => !p.condition || (p.condition.variable ? (() => {
      const x = v(p.condition!.variable!.id), c = p.condition!.variable!;
      return c.op === "==" ? x === c.value : c.op === "!=" ? x !== c.value : c.op === ">=" ? x >= c.value : x <= c.value;
    })() : true));
    if (page?.trigger === "playerTouch") out.add(`${ev.x},${ev.y}`);
  }
  return out;
}

function bfs(tx: number, ty: number): Dir4[] | null {
  const table = tableWithBodies(sess.tables.get(st.mapId)!, st.chars);
  const avoid = touchCells();
  const start = `${st.move.tx},${st.move.ty}`;
  const prev = new Map<string, [string, Dir4]>([[start, ["", 0]]]);
  const q = [[st.move.tx, st.move.ty]];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x === tx && y === ty) break;
    for (const d of [0, 1, 2, 3] as Dir4[]) {
      const nx = x! + DX[d]!, ny = y! + DY[d]!;
      const k = `${nx},${ny}`;
      if (prev.has(k) || !canStepFrom(table, x!, y!, d)) continue;
      if (avoid.has(k) && !(nx === tx && ny === ty)) continue;
      prev.set(k, [`${x},${y}`, d]);
      q.push([nx, ny]);
    }
  }
  const goal = `${tx},${ty}`;
  if (!prev.has(goal)) return null;
  const path: Dir4[] = [];
  for (let k = goal; k !== start; k = prev.get(k)![0]) path.unshift(prev.get(k)![1]);
  return path;
}

/** Walk to a cell; stops early (returns false) when an event takes over. */
function walkTo(tx: number, ty: number, soft = false): boolean {
  const map = st.mapId;
  for (let guard = 0; guard < 400; guard++) {
    if (st.mapId !== map || st.interp.modal || st.interp.main) return false;
    if (st.move.tx === tx && st.move.ty === ty && !st.move.moving) return true;
    const path = bfs(tx, ty);
    if (!path) {
      if (soft) return false; // e.g. a wandering NPC stepped into the spot
      throw new Error(`no path on ${st.mapId} from ${st.move.tx},${st.move.ty} to ${tx},${ty}`);
    }
    // Press until the step commits, then release: a held pad at the
    // arrival tick chains into the next tile, and at 20 Hz one host frame
    // folds three reference ticks (the reason the kit ships journey-search).
    const from = `${st.move.tx},${st.move.ty}`;
    for (let i = 0; i < 40 && !st.move.moving && `${st.move.tx},${st.move.ty}` === from; i++) {
      tick(BTN_OF[path[0]!]);
      if (st.interp.modal || st.interp.main || st.mapId !== map) return false;
    }
    while (st.move.moving) {
      tick();
      if (st.interp.modal || st.interp.main || st.mapId !== map) return false;
    }
  }
  throw new Error(`walkTo ${tx},${ty} did not arrive`);
}

/** Walk to a cell, letting any event that fires on the way play out. */
function goTo(tx: number, ty: number): void {
  const map = st.mapId;
  for (let i = 0; i < 8; i++) {
    if (walkTo(tx, ty)) return;
    settle();
    if (st.mapId !== map) return;
  }
  throw new Error(`goTo ${tx},${ty}: kept being interrupted`);
}

/** Turn toward d (a blocked press turns in place) and press confirm. */
function interact(d: Dir4): void {
  tick(BTN_OF[d]);
  while (st.move.moving) tick();
  tick();
  tick(0, { confirm: true });
  tick();
}

function expect(what: string, ok: boolean): void {
  note(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) { writeOut(); throw new Error(`smoke: ${what}`); }
}

function writeOut(): void {
  writeFileSync(`${DIR}smoke-log${HZ === 60 ? "" : `-${HZ}hz`}.txt`, journal.join("\n") + "\n");
}

// --- the story beats --------------------------------------------------------

note(`START ${st.mapId} @${st.move.tx},${st.move.ty}`);
settle(["Yes"]); // "Do you want to skip the intro?" -> Yes
expect("skip-intro choice transfers to the Paper Town mart", st.mapId === "spyder_paper_scoop");
settle(["Budaye", "Yes"]); // storekeeper intro; rival's monster; "are you sure?"
expect("mart intro ends back in the bedroom", st.mapId === "spyder_bedroom" && v("v.intro_scoop") > 0);
walkTo(7, 2);
settle();
expect("stairs (touch) lead downstairs", st.mapId === "spyder_downstairs");
for (let i = 0; i < 10; i++) tick(); // the fade froze the fold; let the new map's parallels run
const momOn = v("local.npc.spyder_papertown_mom") === 1;
expect("the spawn guard created mom (party empty)", momOn);
// talk to mom wherever her random walk put her
for (let tries = 0; tries < 20 && v("v.spokenmom") === 0; tries++) {
  const mom = st.chars.chars["npc_spyder_papertown_mom"];
  if (!mom) { note(`chars: ${Object.keys(st.chars.chars).join(",")} page vars: ${v("local.npc.spyder_papertown_mom")}`); for (let i = 0; i < 30; i++) tick(); continue; }
  const spots = ([0, 1, 2, 3] as Dir4[]).map((d) => ({ d, x: mom.tx + DX[d]!, y: mom.ty + DY[d]! }));
  const avoid = touchCells();
  const spot = spots.find((s) => !avoid.has(`${s.x},${s.y}`) && bfs(s.x, s.y));
  if (!spot) { for (let i = 0; i < 30; i++) tick(); continue; }
  if (!walkTo(spot.x, spot.y, true)) { settle(); continue; }
  const m2 = st.chars.chars["npc_spyder_papertown_mom"]!;
  if (m2.tx !== mom.tx || m2.ty !== mom.ty) continue;
  interact(((spot.d + 2) % 4) as Dir4);
  settle();
}
expect("talking to mom ran her first talk page", v("v.spokenmom") > 0);
walkTo(4, 6);
settle();
expect("the front door leads to Paper Town", st.mapId === "spyder_paper_town");
walkTo(24, 13);
settle();
expect("the first-monster strip (touch area) ran Dante's scene", v("v.dantebin") > 0);
walkTo(21, 9);
interact(3); // face the Rockitten bin
settle(["Yes"]);
expect("choosing Rockitten gave a monster (placeholder party)", v("sys.party_size") === 1);
expect("the first fight ran the battle placeholder", st.sw.switches["bo.spyder_billie.won"] === true);
expect("the win branch closed the fight (firstfightend=no)", v("v.firstfightend") > 0 && v("v.firstfightdue") > 0);
let requested = "";
try {
  // The real town terrain has one narrow street across the already-consumed
  // first-monster touch strip. Make that inert strip an explicit waypoint;
  // the generic walker otherwise avoids all touch cells to prevent crossing
  // transfer mats sideways.
  goTo(23, 13);
  goTo(14, 1);
  goTo(14, 0);
  settle();
} catch (e) {
  requested = String(e);
  if (!/spyder_route1/.test(requested)) {
    note(`BLOCKERS ${Object.entries(st.chars.chars).filter(([, char]) => char.blocks).map(([id, char]) => `${id}@${char.tx},${char.ty}`).join(" ")}`);
  }
}
expect(`the Route 1 exit opens after the fight (${requested || st.mapId})`, /spyder_route1/.test(requested) || st.mapId === "spyder_route1");
note(`END   frames=${frames} at ${HZ} Hz (${(frames / HZ).toFixed(1)} s virtual)`);
writeOut();
console.log(journal.join("\n"));
