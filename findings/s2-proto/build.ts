// findings/s2-proto/build.ts — build the S2 prototype against the vendored PocketJS.
//   bun findings/s2-proto/build.ts [--outdir=/var/tmp/fleet/task-1783/dist]
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "../..");
const outdir = process.argv.find((a) => a.startsWith("--outdir="))?.slice(9) ?? "/var/tmp/fleet/task-1783/dist";
mkdirSync(outdir, { recursive: true });
const buildTs = join(root, "vendor/pocket-rpgkit/vendor/pocketjs/tools/build.ts");
const proc = Bun.spawn({ cmd: [process.execPath, buildTs, join(root, "findings/s2-proto/s2-proto.tsx"), `--project-root=${root}`, `--outdir=${outdir}`], cwd: root, stdio: ["inherit", "inherit", "inherit"] });
process.exit(await proc.exited);
