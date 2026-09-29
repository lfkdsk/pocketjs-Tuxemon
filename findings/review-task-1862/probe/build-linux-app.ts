// Build the linux-app bundle exactly like tools/desktop.ts (minus gen-assets and cargo) into a scratch dir.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
const root = "/home/tangollvm/.fleet/worktrees/task-1833";
const pocketjs = join(root, "vendor", "pocket-rpgkit", "vendor", "pocketjs");
const { validateAndResolveBuildPlan } = await import(join(pocketjs, "framework/src/manifest/resolve.ts"));
const target = "linux-app";
const manifest = await Bun.file(join(root, "pocket.json")).json();
const resolution = validateAndResolveBuildPlan(manifest, { target });
if (!resolution.ok) throw new Error(JSON.stringify(resolution.diagnostics));
const plan = resolution.plan;
const outdir = process.argv[2] ?? "/var/tmp/fleet/1863/linux-app";
mkdirSync(outdir, { recursive: true });
const planPath = join(outdir, `${plan.app.output}.plan.json`);
await Bun.write(planPath, JSON.stringify(plan, null, 2) + "\n");
await $`bun ${join(pocketjs, "tools", "build.ts")} --plan=${planPath} --project-root=${root} --outdir=${outdir}`.cwd(root);
console.log("built", plan.app.output, "->", outdir);
