// Refine samelatch candidates: A (earlier key) and B (later key) parallel pages on one map.
// Real divergence iff some assignment satisfies guard(A) AND guard(B) (Tuxemon starts both in
// the same update) while guard(B) is false after applying A's same-frame instant writes
// (the kit samples B's in-fiber guard after A's prefix ran).
import { readFileSync, writeFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.argv[2] ?? "/home/tangollvm/.fleet/worktrees/task-1833/dist/project.json", "utf8"));
const BLOCK = new Set(["text", "choices", "wait", "transfer", "moveRoute"]);
type C = { id: string; op: string; value: number; neg: boolean };
function conds(c: any, neg: boolean, out: C[]): boolean { // false => unsupported clause (treated as free)
  if (!c) return true;
  if (c.all) { for (const x of c.all) conds(x, neg, out); return true; }
  if (c.kind === "variable") { out.push({ id: c.id, op: c.op, value: c.value, neg }); return true; }
  if (c.kind === "switch") { out.push({ id: "sw:" + c.id, op: "==", value: c.value === false ? 0 : 1, neg }); return true; }
  if (c.variable) { out.push({ id: c.variable.id, op: c.variable.op ?? ">=", value: c.variable.value, neg }); }
  if (typeof c.switch === "string") out.push({ id: "sw:" + c.switch, op: "==", value: 1, neg });
  return true;
}
function guardOf(page: any): { cs: C[]; body: any[]; inFiber: C[] } {
  const cs: C[] = []; conds(page.condition, false, cs);
  const inFiber: C[] = [];
  let cmds = page.commands;
  while (cmds.length === 1 && cmds[0].op === "if") {
    const c = cmds[0];
    const t = c.then ?? [], e = c.else ?? [];
    if (t.length && !e.length) { conds(c.if, false, inFiber); cmds = t; }
    else if (!t.length && e.length) { conds(c.if, true, inFiber); cmds = e; }
    else break;
  }
  return { cs, body: cmds, inFiber };
}
function writesOf(cmds: any[], out: Map<string, { set?: number; add?: number }>): boolean {
  for (const c of cmds) {
    if (BLOCK.has(c.op) && !(c.op === "moveRoute" && c.wait === false)) return true;
    if (c.op === "variable") {
      if (c.set.op === "set") out.set(c.id, { set: c.set.value });
      else if (c.set.op === "add") out.set(c.id, { add: c.set.value });
      else if (c.set.op === "sub") out.set(c.id, { add: -c.set.value });
      else out.set(c.id, {});
    }
    if (c.op === "switch") out.set("sw:" + c.id, { set: c.value ? 1 : 0 });
    if (c.op === "if") { // unconditional-prefix only: stop at branching to stay conservative
      return true;
    }
  }
  return false;
}
const holds = (c: C, v: number) => {
  const r = c.op === "==" ? v === c.value : c.op === "!=" ? v !== c.value : c.op === ">=" ? v >= c.value
    : c.op === "<=" ? v <= c.value : c.op === ">" ? v > c.value : c.op === "<" ? v < c.value : true;
  return c.neg ? !r : r;
};
const rows: any[] = [];
for (const m of project.maps) {
  const par: any[] = [];
  for (const e of m.events ?? []) e.pages.forEach((p: any, i: number) => { if (p.trigger === "parallel") par.push({ key: e.id, name: e.name, page: p, i }); });
  par.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (let i = 0; i < par.length; i++) for (let j = i + 1; j < par.length; j++) {
    const A = par[i], B = par[j];
    if (A.key === B.key) continue;
    const ga = guardOf(A.page), gb = guardOf(B.page);
    if (!gb.inFiber.length) continue; // B has no in-fiber guard: latched at scan like Tuxemon
    const w = new Map(); writesOf(ga.body, w);
    const hit = gb.inFiber.filter((c) => w.has(c.id));
    if (!hit.length) continue;
    const all = [...ga.cs, ...ga.inFiber, ...gb.cs, ...gb.inFiber];
    const ids = [...new Set(all.map((c) => c.id))];
    const dom = new Map(ids.map((id) => [id, [...new Set([0, 1, -1, 99, ...all.filter((c) => c.id === id).flatMap((c) => [c.value, c.value - 1, c.value + 1])])]]));
    // enumerate assignments (small)
    let found: any = null; let count = 0;
    const assign: Record<string, number> = {};
    const rec = (k: number): void => {
      if (found || count > 200000) return;
      if (k === ids.length) {
        count++;
        const ok = [...ga.cs, ...ga.inFiber, ...gb.cs, ...gb.inFiber].every((c) => holds(c, assign[c.id]!));
        if (!ok) return;
        const after = { ...assign };
        for (const [id, wv] of w) after[id] = wv.set !== undefined ? wv.set : wv.add !== undefined ? (after[id] ?? 0) + wv.add : NaN;
        const bAfter = gb.inFiber.every((c) => holds(c, after[c.id] ?? 0));
        if (!bAfter) found = { ...assign };
        return;
      }
      for (const v of dom.get(ids[k]!)!) { assign[ids[k]!] = v; rec(k + 1); }
    };
    rec(0);
    if (found) rows.push({ map: m.id, A: `${A.key} (${A.name})`, B: `${B.key} (${B.name})`, witness: found, writes: Object.fromEntries(w) });
  }
}
writeFileSync("/var/tmp/fleet/1863/probe/samelatch2.json", JSON.stringify(rows, null, 1));
console.log(`real same-frame divergences: ${rows.length} pairs on ${new Set(rows.map((r) => r.map)).size} maps`);
for (const r of rows) console.log(`${r.map} | ${r.A} -> ${r.B} | witness ${JSON.stringify(r.witness)} | A writes ${JSON.stringify(r.writes)}`);
