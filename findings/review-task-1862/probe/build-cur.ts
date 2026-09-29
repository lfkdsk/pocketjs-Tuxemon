// Build a terrain-applied project for some maps with the CURRENT worktree importer and a named profile.
import { writeFileSync } from "node:fs";
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const mod = await import(`${ROOT}/importer/project.ts`);
const { applyTerrain, importTerrain } = await import(`${ROOT}/importer/terrain.ts`);
const maps = process.argv[2]!.split(",");
const opts = (mod as any)[process.argv[4] ?? "G6_IMPORT_OPTIONS"];
const r = mod.buildProject(maps, opts);
const p = applyTerrain(r.project, importTerrain({ mapIds: maps }).fragment);
writeFileSync(process.argv[3]!, JSON.stringify(p));
console.log("ok", p.maps.length, Object.keys(opts).filter((k) => opts[k]).join(","));
