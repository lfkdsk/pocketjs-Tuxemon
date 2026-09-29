// Reviewer probe (task 1838): fire EVERY lockInput page directly and check the lock
// is released (unlock or transfer) without player input. The page condition is
// satisfied through the initial switch state; touch pages are entered from a
// walkable neighbour, action pages are faced and confirmed, autorun/parallel just run.
import { readFileSync, writeFileSync } from "node:fs";
const E = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${E}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${E}/session.ts`);
const { createSwitchState } = await import(`${E}/interpreter.ts`);
const { canStepFrom } = await import(`${E}/passability.ts`);
const project = JSON.parse(readFileSync(process.argv[2] ?? "/var/tmp/fleet/1838/project-g6.json", "utf8"));
const only = process.argv[3];
const DX = [0, -1, 0, 1], DY = [1, 0, -1, 0];
const BTN = [BTN_BITS.DOWN, BTN_BITS.LEFT, BTN_BITS.UP, BTN_BITS.RIGHT];
const DIRS = ["down", "left", "up", "right"];
function flat(cmds: any[], out: any[] = []): any[] { for (const c of cmds) { out.push(c); if (c.op === "if") { flat(c.then, out); flat(c.else ?? [], out); } else if (c.op === "choices") { for (const o of c.options) flat(o.commands, out); flat(c.cancel?.commands ?? [], out); } } return out; }
function satisfy(cond: any, sw: any, local: Record<string, number>, facing: { dir?: string }) {
  if (!cond) return;
  const clauses = [...(cond.all ?? [])];
  if (cond.variable) clauses.push({ kind: "variable", ...cond.variable });
  if (cond.switch) clauses.push({ kind: "switch", id: cond.switch, value: true });
  if (cond.item) clauses.push({ kind: "item", id: cond.item, count: 1 });
  for (const c of clauses) {
    if (c.kind === "variable") {
      const v = c.op === "==" ? c.value : c.op === "!=" ? (c.value === 0 ? 1 : 0) : c.op === ">=" ? c.value : c.value;
      if (c.id.startsWith("local.")) local[c.id] = v; else sw.variables[c.id] = v;
    } else if (c.kind === "switch") sw.switches[c.id] = c.value ?? true;
    else if (c.kind === "item") sw.items[c.id] = c.count;
    else if (c.kind === "gold") sw.gold = c.amount;
    else if (c.kind === "facing") facing.dir = c.dir;
  }
}
const rows: any[] = [];
for (const m of project.maps) for (const e of m.events ?? []) e.pages.forEach((p: any, pi: number) => {
  const f = flat(p.commands);
  if (!f.some((c) => c.op === "lockInput")) return;
  if (only && !`${m.id}:${e.id}`.includes(only)) return;
  const sess = createSession(project, 60);
  const table = sess.tables.get(m.id);
  const cells: [number, number][] = [];
  for (let y = e.y; y < e.y + (e.h ?? 1); y++) for (let x = e.x; x < e.x + (e.w ?? 1); x++) cells.push([x, y]);
  const facing: { dir?: string } = {};
  const sw = createSwitchState({ variables: { "sys.party_size": Number(process.env.PARTY ?? 0) } }); const local: Record<string, number> = {};
  satisfy(p.condition, sw, local, facing);
  // lower pages must not shadow this page: the kit picks the LAST eligible page
  for (let k = pi + 1; k < e.pages.length; k++) { /* leave as is; report */ }
  const starts: { x: number; y: number; d: number }[] = [];
  if (p.trigger === "playerTouch" || p.trigger === "action") {
    for (const [cx, cy] of cells) for (let d = 0; d < 4; d++) {
      const nx = cx - DX[d]!, ny = cy - DY[d]!;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
      if (cells.some(([x, y]) => x === nx && y === ny)) continue;
      if (p.trigger === "playerTouch" && !canStepFrom(table, nx, ny, d)) continue;
      if (facing.dir && p.trigger === "playerTouch" && DIRS[d] !== facing.dir) {
        // facing clause: we still enter with d then turn to the wanted facing
      }
      starts.push({ x: nx, y: ny, d });
      if (starts.length >= 3) break;
    }
  } else starts.push({ x: cells[0]![0], y: cells[0]![1], d: 0 });
  let result: any = { map: m.id, event: e.id, name: e.name, page: pi, trigger: p.trigger, outcome: "no-start-cell" };
  for (const s of starts) {
    const proj = { ...project, start: { map: m.id, x: s.x, y: s.y, dir: DIRS[s.d] } };
    const ss = createSession(proj, 60);
    let st = startSession(proj, ss, createSwitchState(sw));
    Object.assign(st.sw.variables, local);
    let lockedAt = -1, unlockedAt = -1, transferAt = -1, err = "";
    const texts: string[] = [];
    let lastText = "";
    for (let fr = 0; fr < 8000; fr++) {
      const md = st.interp.modal;
      let buttons = 0, confirm = false;
      if (md) confirm = fr % 2 === 0;
      else if (lockedAt < 0) {
        if (p.trigger === "playerTouch") buttons = fr < 40 ? BTN[s.d]! : (facing.dir ? BTN[DIRS.indexOf(facing.dir)]! : 0);
        else if (p.trigger === "action") { buttons = fr < 4 ? BTN[s.d]! : 0; confirm = fr === 6 || fr === 30; }
      }
      st = stepSession(ss, st, { buttons, confirmEdge: confirm, cancelEdge: false, upEdge: false, downEdge: false });
      if (st.interp.error) { err = st.interp.error.message; break; }
      const mm = st.interp.modal; if (mm) { const t = mm.kind === "text" ? mm.lines.join(" / ") : "CHOICE " + mm.options.join("|"); if (t !== lastText) { texts.push(t.slice(0, 70)); lastText = t; } }
      if (st.mapId !== m.id) { transferAt = fr; break; }
      if (lockedAt < 0 && st.interp.inputLocked) lockedAt = fr;
      if (lockedAt >= 0 && !st.interp.inputLocked) { unlockedAt = fr; break; }
    }
    const outcome = err ? "error" : transferAt >= 0 ? (lockedAt >= 0 ? "locked->transfer" : "transfer-before-lock") : lockedAt < 0 ? "lock-not-reached" : unlockedAt >= 0 ? "locked->unlocked" : "STUCK-LOCKED";
    result = { map: m.id, event: e.id, name: e.name, page: pi, trigger: p.trigger, start: [s.x, s.y, DIRS[s.d]], outcome, lockedAt, unlockedAt, transferAt, err: err || undefined, pos: [st.move.tx, st.move.ty], main: st.interp.main?.key, texts: texts.slice(-3) };
    if (outcome !== "lock-not-reached" && outcome !== "transfer-before-lock") break;
  }
  rows.push(result);
});
const counts: Record<string, number> = {};
for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
console.log(JSON.stringify(counts));
for (const r of rows) if (r.outcome !== "locked->unlocked") console.log(JSON.stringify(r));
writeFileSync(`/var/tmp/fleet/1838/lockfire-party${process.env.PARTY ?? 0}.json`, JSON.stringify(rows, null, 1));
