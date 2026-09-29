// Count parallel pages whose text runs while input is not locked (player can walk during it).
import { readFileSync, writeFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.argv[2] ?? "/home/tangollvm/.fleet/worktrees/task-1833/dist/project.json", "utf8"));
const mapFilter = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
let pages = 0, textPages = 0, unlockedPages = 0, unlockedTexts = 0, texts = 0;
const rows: any[] = [];
function walk(cmds: any[], locked: boolean, acc: { unlocked: number; total: number }): boolean {
  for (const c of cmds) {
    if (c.op === "lockInput") locked = true;
    else if (c.op === "unlockInput") locked = false;
    else if (c.op === "text") { acc.total++; if (!locked) acc.unlocked++; }
    else if (c.op === "if") {
      const a = walk(c.then ?? [], locked, acc); const b = walk(c.else ?? [], locked, acc);
      locked = a && b; // conservative: locked only if both branches end locked
    } else if (c.op === "choices") {
      for (const o of c.options ?? []) walk(o.commands ?? [], locked, acc);
    }
  }
  return locked;
}
for (const m of project.maps) {
  if (mapFilter && !mapFilter.has(m.id)) continue;
  for (const e of m.events ?? []) e.pages.forEach((p: any, i: number) => {
    if (p.trigger !== "parallel") return;
    pages++;
    const acc = { unlocked: 0, total: 0 };
    walk(p.commands, false, acc);
    texts += acc.total;
    if (acc.total) textPages++;
    if (acc.unlocked) { unlockedPages++; unlockedTexts += acc.unlocked; rows.push({ map: m.id, event: e.id, name: e.name, unlocked: acc.unlocked, total: acc.total }); }
  });
}
writeFileSync("/var/tmp/fleet/1863/probe/unlockedtext.json", JSON.stringify(rows, null, 1));
console.log(`parallel pages ${pages}; with text ${textPages}; with unlocked text ${unlockedPages} on ${new Set(rows.map((r) => r.map)).size} maps; unlocked text commands ${unlockedTexts}/${texts}`);
for (const r of rows.slice(0, 12)) console.log(`  ${r.map} ${r.event} "${r.name}" ${r.unlocked}/${r.total}`);
