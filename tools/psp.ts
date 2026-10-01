// Compile the full game, then embed only boot assets and a file-pak index.
// The complete resource file travels beside EBOOT.PBP; no maps are removed.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pack, unpack } from "../vendor/pocket-rpgkit/vendor/pocketjs/framework/compiler/pak.ts";
const args = new Set(process.argv.slice(2));
const allowed = new Set(["--skip-assets", "--bench", "--journey", "--help"]);
for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown PSP option: ${arg}`);
if (args.has("--help")) {
  console.log("bun run build:psp [--skip-assets] [--bench] [--journey]\n" +
    "Normal builds accept live controls. --journey replays the 3793-frame opening on hardware and enables timing logs.");
  process.exit(0);
}
const benchmark = args.has("--bench") || args.has("--journey");
const root = resolve(import.meta.dir, "..");
const framework = join(root, "vendor/pocket-rpgkit/vendor/pocketjs");
const out = join(root, "dist/psp");
mkdirSync(out, { recursive: true });
const cCompiler = process.env.POCKETJS_PSP_C_COMPILER ?? "gcc";
if (!["gcc", "clang"].includes(cCompiler)) throw new Error("PSP C compiler must be gcc or clang");
async function run(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) process.exit(1);
}
if (!args.has("--skip-assets")) await run([join(root, "gen-assets.ts")]);
await run([join(framework, "tools/pocket.ts"), "compile", "--target", "psp", "--outdir", out]);
const pakPath = join(out, "pocket-tuxemon.pak");
const full = readFileSync(pakPath);
copyFileSync(pakPath, join(out, "assets.pak"));
const dataOffset = full.readUInt32LE(20);
const boot = unpack(full).filter(b => b.key === "ui:styles" || b.key.startsWith("ui:font.") || b.key.startsWith("ui:sprite."));
boot.push({ key: "pocket:external-index", dtype: 0, data: full.subarray(0, dataOffset) });
writeFileSync(pakPath, pack(boot));
console.log(`PSP: ${full.length} bytes external, ${readFileSync(pakPath).length} bytes embedded`);
if (args.has("--journey")) {
  const bundlePath = join(out, "pocket-tuxemon.js");
  const original = readFileSync(bundlePath, "utf8");
  const tape = JSON.parse(readFileSync(join(root, "data/g6-journey.json"), "utf8")).masks;
  const suffix = `\n;[0,-0,1.25,-4.5,1e30,Number.MIN_VALUE,NaN,Infinity,-Infinity].forEach(function(v){if(!Object.is(__pspRoundTrip(v),v))throw new Error("PSP double ABI round trip failed");});__pspLog(JSON.stringify({kind:"abi",passed:true}));\n;(function(){var f=globalThis.frame,n=0,tape=${JSON.stringify(tape)};globalThis.frame=function(buttons,analog){f(n<tape.length?tape[n]:buttons,analog);n++;var s=globalThis.__rpgSessionState;if(n%300===0)__pspLog(JSON.stringify({frame:n,map:s.mapId,pos:[s.move.tx,s.move.ty],scene:s.scene?.kind,modal:s.interp.modal,error:s.interp.error}));if(n===tape.length)__pspLog(JSON.stringify({kind:"terminal",frame:n,state:s}));};})();\n`;
  writeFileSync(bundlePath, original + suffix);
}
const extra = benchmark ? ["--features=bench"] : [];
await run([join(framework, "tools/psp.ts"), `--plan=${join(root, ".pocket/psp/plan.json")}`, `--project-root=${root}`, `--outdir=${out}`, "--skip-build", "--release", ...extra], { POCKETJS_PSP_C_COMPILER: cCompiler });
const target = join(framework, "hosts/psp/target/mipsel-sony-psp/release");
copyFileSync(join(target, "pocketjs-psp.prx"), join(out, "pocket-tuxemon.prx"));
copyFileSync(join(target, "EBOOT.PBP"), join(out, "EBOOT.PBP"));

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const identity = (cwd: string) => {
  const changed = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard", "-z"], { cwd, encoding: "utf8" })
    .split("\0").filter(Boolean).sort();
  const files = Object.fromEntries(changed.filter(name => {
    try { return statSync(join(cwd, name)).isFile(); } catch { return false; }
  }).map(name => [name, sha256(readFileSync(join(cwd, name)))]));
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
    diffSha256: sha256(execFileSync("git", ["diff", "HEAD", "--binary", "--ignore-submodules=dirty"], { cwd })),
    changedFiles: files,
  };
};
writeFileSync(join(out, "build-receipt.json"), JSON.stringify({
  target: "psp", cCompiler, benchmark, journey: args.has("--journey"),
  source: identity(root), rpgkit: identity(join(root, "vendor/pocket-rpgkit")), pocketjs: identity(framework),
  artifacts: Object.fromEntries(["pocket-tuxemon.prx", "EBOOT.PBP", "assets.pak", "pocket-tuxemon.js", "pocket-tuxemon.pak"].map(name => {
    const bytes = readFileSync(join(out, name));
    return [name, { bytes: bytes.length, sha256: sha256(bytes) }];
  })),
}, null, 2) + "\n");
