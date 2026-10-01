// Keep PSP fixes reproducible without publishing unmerged submodule commits.
import { resolve, join } from "node:path";
const root = resolve(import.meta.dir, "..");
const patches = [
  { dir: "vendor/pocket-rpgkit", pin: "4bba234b99550998d9f1e2ea532065da0564eb39", file: "rpgkit-performance.patch" },
  { dir: "vendor/pocket-rpgkit/vendor/pocketjs", pin: "2d2b333b071e2cdf0fb9ef2320bec1d2d6bdadc5", file: "pocketjs-psp.patch" },
];
for (const { dir, pin, file } of patches) {
  const cwd = join(root, dir), patch = join(root, "patches", file);
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const head = git("rev-parse", "HEAD");
  if (head.exitCode !== 0 || head.stdout.toString().trim() !== pin)
    throw new Error(`${dir}: expected pinned revision ${pin}; run git submodule update --init --recursive`);
  if (git("apply", "--reverse", "--check", patch).exitCode === 0) {
    console.log(`${file}: already applied`);
    continue;
  }
  const check = git("apply", "--check", patch);
  if (check.exitCode !== 0) throw new Error(`${file}: cannot apply without conflicting with local changes\n${check.stderr}`);
  const applied = git("apply", patch);
  if (applied.exitCode !== 0) throw new Error(`${file}: ${applied.stderr}`);
  console.log(`${file}: applied`);
}
