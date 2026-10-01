// Build the complete game for PSP while keeping the large resource pak beside
// EBOOT.PBP. Only boot resources and the external-pak directory are embedded.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FIXED_INITIAL_CIVIL_TIME } from "../battle/time-weather.ts";
import {
  pack,
  unpack,
} from "../vendor/pocket-rpgkit/vendor/pocketjs/framework/compiler/pak.ts";

const args = new Set(process.argv.slice(2));
const allowed = new Set(["--skip-assets", "--bench", "--journey", "--capture", "--help"]);
for (const arg of args) {
  if (!allowed.has(arg)) throw new Error(`Unknown PSP option: ${arg}`);
}
if (args.has("--help")) {
  console.log(
    "bun run build:psp [--skip-assets] [--bench] [--journey] [--capture]\n" +
      "Normal builds accept live controls. --bench enables timing logs. " +
      "--journey replays the maintained opening and implies --bench. " +
      "--capture writes a short PPSSPP framebuffer sequence and exits.",
  );
  process.exit(0);
}
const benchmark = args.has("--bench") || args.has("--journey");
if (benchmark && args.has("--capture")) {
  throw new Error("Build timing journeys and framebuffer captures separately");
}
const root = resolve(import.meta.dir, "..");
const framework = join(root, "vendor/pocket-rpgkit/vendor/pocketjs");
const out = join(root, "dist/psp");
mkdirSync(out, { recursive: true });

// The pinned SDK archive carries the author's native GCC wrapper on macOS.
// Linux CI uses LLVM's MIPS backend against the same headers and libraries.
const cCompiler = process.env.POCKETJS_PSP_C_COMPILER ??
  (process.platform === "linux" ? "clang" : "gcc");
if (!["gcc", "clang"].includes(cCompiler)) {
  throw new Error("POCKETJS_PSP_C_COMPILER must be gcc or clang");
}
const discoveredClang = Bun.which("clang");
const discoveredClangBin = discoveredClang ? dirname(realpathSync(discoveredClang)) : undefined;
const discoveredLlvmBin = discoveredClangBin &&
    existsSync(join(discoveredClangBin, "llvm-ar"))
  ? discoveredClangBin
  : undefined;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function linuxCrossLlvmBin(realLlvmBin: string): string {
  const manifest = JSON.parse(readFileSync(
    join(framework, "tools/cli/psp-toolchain.json"),
    "utf8",
  )) as { sdk: { cachePath: string } };
  const cacheRoot = process.env.POCKET_NEXUS_CACHE_DIR?.trim() ||
    join(process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache"), "pocket-nexus");
  const sdk = resolve(
    process.env.PSP_SDK?.trim() || process.env.PSPDEV?.trim() ||
      join(cacheRoot, manifest.sdk.cachePath),
  );
  const wrappers = join(root, ".pocket-build/psp-llvm-bin");
  mkdirSync(wrappers, { recursive: true });
  for (const tool of ["clang", "llvm-ar", "llvm-ranlib", "llvm-objcopy"]) {
    const executable = join(realLlvmBin, tool);
    if (!existsSync(executable)) throw new Error(`PSP LLVM tool is missing: ${executable}`);
    const prefix = tool === "clang"
      ? ` --sysroot=${shellQuote(join(sdk, "psp"))}`
      : "";
    const wrapper = join(wrappers, tool);
    writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(executable)}${prefix} \"$@\"\n`);
    chmodSync(wrapper, 0o755);
  }
  return wrappers;
}

const realLlvmBin = process.env.POCKETJS_LLVM_BIN || discoveredLlvmBin;
const pspLlvmBin = process.platform === "linux" && cCompiler === "clang" && realLlvmBin
  ? linuxCrossLlvmBin(realLlvmBin)
  : realLlvmBin;

async function run(command: string[], env: Record<string, string> = {}): Promise<void> {
  const child = Bun.spawn([process.execPath, ...command], {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited !== 0) process.exit(1);
}

if (!args.has("--skip-assets")) await run([join(root, "gen-assets.ts")]);
await run([
  join(framework, "tools/pocket.ts"),
  "compile",
  "--target",
  "psp",
  "--outdir",
  out,
]);

const pakPath = join(out, "pocket-tuxemon.pak");
const fullPak = readFileSync(pakPath);
copyFileSync(pakPath, join(out, "assets.pak"));
const dataOffset = fullPak.readUInt32LE(20);
if (dataOffset <= 24 || dataOffset > fullPak.length) {
  throw new Error(`PSP external pak has an invalid data offset: ${dataOffset}`);
}
const bootEntries = unpack(fullPak).filter((entry) =>
  entry.key === "ui:styles" || entry.key.startsWith("ui:font.") || entry.key.startsWith("ui:sprite.")
);
if (bootEntries.length === 0) throw new Error("PSP external pak contains no boot resources");
bootEntries.push({
  key: "pocket:external-index",
  dtype: 0,
  data: fullPak.subarray(0, dataOffset),
});
writeFileSync(pakPath, pack(bootEntries));
console.log(
  `PSP: ${fullPak.length} bytes external, ${readFileSync(pakPath).length} bytes embedded`,
);

let journeyBuildId: string | undefined;
if (args.has("--journey")) {
  const bundlePath = join(out, "pocket-tuxemon.js");
  const original = readFileSync(bundlePath, "utf8");
  const tape = JSON.parse(readFileSync(join(root, "data/g6-journey.json"), "utf8")).masks as number[];
  journeyBuildId = createHash("sha256")
    .update(original)
    .update(JSON.stringify(tape))
    .update(JSON.stringify(FIXED_INITIAL_CIVIL_TIME))
    .digest("hex");
  const prefix =
    `globalThis.__pocketTuxemonInitialCivilTime=${JSON.stringify(FIXED_INITIAL_CIVIL_TIME)};\n`;
  const suffix =
    `\n;(function(){var id=${JSON.stringify(journeyBuildId)};` +
    `__pspLog(JSON.stringify({kind:"session",buildId:id}));` +
    `[0,-0,1.25,-4.5,1e30,Number.MIN_VALUE,NaN,Infinity,-Infinity].forEach(function(v){` +
    `if(!Object.is(__pspRoundTrip(v),v))throw new Error("PSP double ABI round trip failed");});` +
    `__pspLog(JSON.stringify({kind:"abi",passed:true,buildId:id}));` +
    `var f=globalThis.frame,n=0,tape=${JSON.stringify(tape)};` +
    `globalThis.frame=function(buttons,analog){f(n<tape.length?tape[n]:buttons,analog);n++;` +
    `var s=globalThis.__rpgSessionState;` +
    `if(n%300===0)__pspLog(JSON.stringify({frame:n,map:s.mapId,pos:[s.move.tx,s.move.ty],` +
    `scene:s.scene?.kind,modal:s.interp.modal,error:s.interp.error,buildId:id}));` +
    `if(n===tape.length)__pspLog(JSON.stringify({kind:"terminal",frame:n,state:s,buildId:id}));};})();\n`;
  writeFileSync(bundlePath, prefix + original + suffix);
}

// Hardware timing needs the bench functions, but not the capture feature:
// capture intentionally exits after its bounded framebuffer window.
const hostFeatures = benchmark
  ? ["--features=bench"]
  : args.has("--capture")
    ? ["--capture"]
    : [];
await run(
  [
    join(framework, "tools/psp.ts"),
    `--plan=${join(root, ".pocket/psp/plan.json")}`,
    `--project-root=${root}`,
    `--outdir=${out}`,
    "--skip-build",
    "--release",
    ...hostFeatures,
  ],
  {
    POCKETJS_PSP_C_COMPILER: cCompiler,
    ...(!pspLlvmBin
      ? {}
      : { POCKETJS_LLVM_BIN: pspLlvmBin }),
  },
);

const target = join(framework, "hosts/psp/target/mipsel-sony-psp/release");
copyFileSync(join(target, "pocketjs-psp.prx"), join(out, "pocket-tuxemon.prx"));
copyFileSync(join(target, "EBOOT.PBP"), join(out, "EBOOT.PBP"));

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
const identity = (cwd: string) => {
  const changed = execFileSync(
    "git",
    ["ls-files", "--modified", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "utf8" },
  ).split("\0").filter(Boolean).sort();
  const files = Object.fromEntries(changed.filter((name) => {
    try {
      return statSync(join(cwd, name)).isFile();
    } catch {
      return false;
    }
  }).map((name) => [name, sha256(readFileSync(join(cwd, name)))]));
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
    diffSha256: sha256(execFileSync(
      "git",
      ["diff", "HEAD", "--binary", "--ignore-submodules=dirty"],
      { cwd },
    )),
    changedFiles: files,
  };
};

writeFileSync(join(out, "build-receipt.json"), JSON.stringify({
  target: "psp",
  cCompiler,
  benchmark,
  capture: args.has("--capture"),
  journey: args.has("--journey"),
  ...(journeyBuildId === undefined ? {} : { journeyBuildId }),
  source: identity(root),
  rpgkit: identity(join(root, "vendor/pocket-rpgkit")),
  pocketjs: identity(framework),
  artifacts: Object.fromEntries([
    "pocket-tuxemon.prx",
    "EBOOT.PBP",
    "assets.pak",
    "pocket-tuxemon.js",
    "pocket-tuxemon.pak",
  ].map((name) => {
    const bytes = readFileSync(join(out, name));
    return [name, { bytes: bytes.length, sha256: sha256(bytes) }];
  })),
}, null, 2) + "\n");
