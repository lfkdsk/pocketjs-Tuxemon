// Reviewer probe: classify every K1 lockInput site in the generated project.
import { readFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.argv[2] ?? "/var/tmp/fleet/1838/project-g6.json", "utf8"));
type C = any;
// Walk commands in order; report whether an unlock/transfer follows a lock on every path (simple linear check).
function flat(cmds: C[], out: C[] = []): C[] { for (const c of cmds) { out.push(c); if (c.op === "if") { flat(c.then, out); flat(c.else ?? [], out); } else if (c.op === "choices") { for (const o of c.options) flat(o.commands, out); flat(c.cancel?.commands ?? [], out); } } return out; }
let lockPages = 0, selfUnlocked = 0, transferAfter = 0, cross = 0;
const crossRows: string[] = [];
const byMap = new Map<string, { locks: number; unlocks: number }>();
for (const m of project.maps) {
  let mapLocks = 0, mapUnlocks = 0;
  for (const e of m.events ?? []) e.pages.forEach((p: C, pi: number) => {
    const f = flat(p.commands);
    const li = f.findIndex((c) => c.op === "lockInput");
    if (f.some((c) => c.op === "unlockInput")) mapUnlocks++;
    if (li < 0) return;
    mapLocks++; lockPages++;
    const after = f.slice(li + 1);
    const lastLock = f.map((c) => c.op).lastIndexOf("lockInput");
    const afterLast = f.slice(lastLock + 1);
    if (afterLast.some((c) => c.op === "unlockInput")) selfUnlocked++;
    else if (afterLast.some((c) => c.op === "transfer")) transferAfter++;
    else { cross++; crossRows.push(`${m.id} :: ${e.id} [${e.name}] page ${pi} trigger=${p.trigger}`); }
  });
  byMap.set(m.id, { locks: mapLocks, unlocks: mapUnlocks });
}
console.log({ lockPages, selfUnlocked, transferAfter, cross });
console.log(crossRows.join("\n"));
