// Maps reachable from the start map through transfer commands (any event, any page).
import { readFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.argv[2] ?? "/home/tangollvm/.fleet/worktrees/task-1833/dist/project.json", "utf8"));
const edges = new Map<string, Set<string>>();
function walk(cmds: any[], out: Set<string>) { for (const c of cmds ?? []) { if (c.op === "transfer") out.add(c.map); if (c.op === "if") { walk(c.then, out); walk(c.else, out); } if (c.op === "choices") { for (const o of c.options) walk(o.commands, out); walk(c.cancel?.commands, out); } } }
for (const m of project.maps) { const s = new Set<string>(); for (const e of m.events ?? []) for (const p of e.pages) walk(p.commands, s); edges.set(m.id, s); }
for (const ce of project.commonEvents ?? []) {}
const start = process.argv[3] ?? project.start.map;
const seen = new Set([start]); const q = [start];
while (q.length) { const x = q.shift()!; for (const y of edges.get(x) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); } }
console.log(`reachable from ${start}: ${seen.size}/${project.maps.length}`);
for (const t of (process.argv[4] ?? "").split(",").filter(Boolean)) console.log(`  ${t}: ${seen.has(t)}`);
