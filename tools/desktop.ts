// Build and launch Pocket Tuxemon in PocketJS's portable desktop host.

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { validateAndResolveBuildPlan } from "../vendor/pocket-rpgkit/vendor/pocketjs/framework/src/manifest/resolve.ts";

const root = resolve(import.meta.dir, "..");
const pocketjs = join(root, "vendor", "pocket-rpgkit", "vendor", "pocketjs");
const target = process.platform === "darwin" ? "macos-app" : "linux-app";
const argv = process.argv.slice(2);
const buildOnly = argv.includes("--build-only");
const passthrough = argv.filter((arg) => arg !== "--build-only" && arg !== "--");

await $`bun ${join(root, "gen-assets.ts")}`.cwd(root);
const manifest = await Bun.file(join(root, "pocket.json")).json();
const resolution = validateAndResolveBuildPlan(manifest, { target });
if (!resolution.ok) {
  throw new Error(
    `desktop: pocket.json did not resolve against ${target}: ` +
      resolution.diagnostics.map((diagnostic) => `${diagnostic.path || "/"}: ${diagnostic.message}`).join("; "),
  );
}
const plan = resolution.plan;
const outdir = join(root, "dist", target);
mkdirSync(outdir, { recursive: true });
const planPath = join(root, ".pocket", target, `${plan.app.output}.plan.json`);
mkdirSync(resolve(planPath, ".."), { recursive: true });
await Bun.write(planPath, JSON.stringify(plan, null, 2) + "\n");
await $`bun ${join(pocketjs, "tools", "build.ts")} --plan=${planPath} --project-root=${root} --outdir=${outdir}`.cwd(root);
await $`cargo build --release`.cwd(join(pocketjs, "hosts", "desktop"));

const bin = join(pocketjs, "hosts", "desktop", "target", "release", "pocket-desktop-host");
if (buildOnly) {
  console.log(`desktop: built ${plan.app.output} for ${target} + release host (${bin})`);
  process.exit(0);
}

const flags = [
  "--app", plan.app.output,
  "--app-id", plan.app.id,
  "--title", plan.app.title,
  "--viewport", `${plan.viewport.logical[0]}x${plan.viewport.logical[1]}`,
  "--density", String(plan.viewport.rasterDensity),
  ...(plan.viewport.policy === "fixed" ? ["--fixed"] : []),
  ...(plan.companions.length > 0 ? ["--companions", plan.companions.join(",")] : []),
  "--js", join(outdir, `${plan.app.output}.js`),
  "--pak", join(outdir, `${plan.app.output}.pak`),
];
await $`${bin} ${flags} ${passthrough}`.env({ ...process.env, RUST_LOG: process.env.RUST_LOG ?? "info" });
