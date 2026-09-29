// Reviewer probe (task 1838): stricter K1 freeze scan than tools/frozen-k1.ts.
// Same entry point + driver as the builder's scan (12,000 frames, final 6,000-frame
// window, d-pad cycle every 30 frames, confirm on every other modal frame), but a map is
// flagged when the PLAYER NEVER HAD CONTROL during the final window (modal, main fiber,
// input lock or fade on every frame), on whatever map the player ended up.
import { readFileSync, writeFileSync } from "node:fs";
const W = "/home/tangollvm/.fleet/worktrees/task-1833/vendor/pocket-rpgkit/src/engine";
const { BTN_BITS } = await import(`${W}/camera.ts`);
const { createSession, startSession, stepSession } = await import(`${W}/session.ts`);
const args = process.argv.slice(2);
const projectPath = args.find((a) => !a.startsWith("--")) ?? "dist/project.json";
const shardArg = args.find((a) => a.startsWith("--shard="))?.slice(8) ?? "0/1";
const [shard, shards] = shardArg.split("/").map(Number) as [number, number];
const outPath = args.find((a) => a.startsWith("--out="))?.slice(6) ?? `/var/tmp/fleet/1838/frozen2-${shard}.json`;
const project = JSON.parse(readFileSync(projectPath, "utf8"));
const landing = new Map<string, [number, number]>();
const visit = (cs: any[]) => { for (const c of cs) { if (c.op === "transfer" && !landing.has(c.map)) landing.set(c.map, [c.x, c.y]); else if (c.op === "if") { visit(c.then); visit(c.else ?? []); } else if (c.op === "choices") { for (const o of c.options) visit(o.commands); visit(c.cancel?.commands ?? []); } } };
for (const m of project.maps) for (const e of m.events ?? []) for (const pg of e.pages) visit(pg.commands);
const pads = [BTN_BITS.UP, BTN_BITS.LEFT, BTN_BITS.DOWN, BTN_BITS.RIGHT];
const WINDOW = 6000, TOTAL = 12000;
const rows: any[] = [];
project.maps.forEach((m: any, index: number) => {
  if (index % shards !== shard) return;
  const start = landing.get(m.id) ?? [Math.floor(m.width / 2), Math.floor(m.height / 2)];
  const p = { ...project, start: { map: m.id, x: start[0], y: start[1], dir: "down" } };
  const sess = createSession(p, 60);
  let st = startSession(p, sess);
  let lock = 0, busy = 0, noCtl = 0, err = "";
  const keys = new Map<string, number>(), texts = new Map<string, number>();
  let lastControl = -1;
  try {
    for (let f = 0; f < TOTAL; f++) {
      const md = st.interp.modal;
      st = stepSession(sess, st, { buttons: md ? 0 : pads[Math.floor(f / 30) % 4]!, confirmEdge: !!md && f % 2 === 0, downEdge: false, upEdge: false, cancelEdge: false });
      if (st.interp.error) { err = st.interp.error.message; break; }
      const noControl = !!st.interp.modal || !!st.interp.main || st.interp.inputLocked || !!st.fade;
      if (!noControl) lastControl = f;
      if (f >= TOTAL - WINDOW) {
        if (st.interp.inputLocked) lock++;
        if (st.interp.main) { busy++; keys.set(st.interp.main.key, (keys.get(st.interp.main.key) ?? 0) + 1); }
        if (noControl) noCtl++;
        const mm = st.interp.modal;
        if (mm) { const t = mm.kind === "text" ? mm.lines.join(" / ") : "CHOICE " + mm.prompt + " [" + mm.options.join("|") + "]"; texts.set(t, (texts.get(t) ?? 0) + 1); }
      }
    }
  } catch (e) { err = String(e); }
  const flagged = noCtl >= WINDOW || lock >= WINDOW || err;
  if (flagged) rows.push({ map: m.id, start, finalMap: st.mapId, final: [st.move.tx, st.move.ty], lock, busy, noCtl, lastControl, err: err || undefined,
    mainKeys: [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), texts: [...texts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) });
});
writeFileSync(outPath, JSON.stringify(rows, null, 1) + "\n");
console.log(`shard ${shard}/${shards}: ${rows.length} flagged`);
