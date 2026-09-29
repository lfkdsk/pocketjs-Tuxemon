// Build the generated G6 project against the PocketJS pinned by RPG Kit.

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
mkdirSync(join(root, "dist"), { recursive: true });

const generated = Bun.spawn({
  cmd: [process.execPath, join(root, "gen-assets.ts")],
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});
if (await generated.exited !== 0) process.exit(1);

const buildTs = join(root, "vendor", "pocket-rpgkit", "vendor", "pocketjs", "tools", "build.ts");
const build = Bun.spawn({
  cmd: [process.execPath, buildTs, join(root, "main.tsx"), `--project-root=${root}`, `--outdir=${join(root, "dist")}`],
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await build.exited);
