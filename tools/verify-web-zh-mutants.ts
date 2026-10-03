// Mutation tests for tools/verify-web-zh.ts. Each mutation simulates one of
// the regressions the verifier exists to catch; the mutated verifier MUST go
// red on the assertion that targets that regression. Run after `bun run web`:
//
//   TUXEMON_SRC=/path bun tools/verify-web-zh-mutants.ts
//
// The mutated verifier is written to a temp file INSIDE tools/ (so its
// relative imports keep resolving — copying it to a system temp dir broke
// every import and six module-load errors were misreported as six reds). A
// mutation counts as RED only when the verifier exits non-zero AND its output
// names the assertion the mutation targets; a crash or load error is a runner
// failure. After every run we also assert no Chrome with a --user-data-dir
// under this workspace survived (the verifier must clean up its browser on
// the failure path).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { registerCleanup, workspaceChromePids } from "./headless-chrome.ts";

const ROOT = resolve(import.meta.dir, "..");
const VERIFIER = join(ROOT, "tools/verify-web-zh.ts");
// Keep the mutated verifier next to the real one: its imports are relative
// ("../battle/...", "./zh-font-mask.ts"), so it only runs from tools/.
const MUTANT = join(ROOT, "tools/.verify-web-zh-mutant.ts");
const PROFILE_DIR = join(ROOT, "dist/web-zh/profile");
const src = readFileSync(VERIFIER, "utf8");

// Safety net: if the runner itself is killed mid-run, take down any Chrome
// its verifier children left behind (matched on this workspace's profile
// dir, never by process name alone).
registerCleanup(() => {
  for (const pid of workspaceChromePids(PROFILE_DIR)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

interface Mutation {
  name: string;
  apply: (s: string) => string;
  /** The assertion name the verifier prints when THIS mutation is caught. */
  expect: RegExp;
}

const RGBA_ANCHOR = "const rgba = new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);";

const mutations: Mutation[] = [
  {
    name: "capture text before the typewriter finished",
    apply: (s) => s.replace("m0.kind === \"text\" && m0.complete", "m0.kind === \"text\""),
    expect: /^FAIL  every dialog line matches its font glyph mask/m,
  },
  {
    name: "truncate the long-dialog concatenation by 1 char",
    apply: (s) => s.replace("catalogSquash.has(runText)", "catalogSquash.has(runText.slice(0, -1) || \" \")"),
    expect: /^FAIL  a long dialog paginated into consecutive pages strictly equal to the catalog text/m,
  },
  {
    name: "remove an actually-displayed char from the charset",
    apply: (s) => s.replace(
      "new Set([...readFileSync(join(ROOT, \"fonts/cjk-charset.txt\"), \"utf8\")])",
      "new Set([...readFileSync(join(ROOT, \"fonts/cjk-charset.txt\"), \"utf8\")].filter((ch) => ch !== \"你\"))",
    ),
    expect: /^FAIL  every displayed CJK character is in the subset font/m,
  },
  {
    name: "capture the final map instead of the battle menu",
    apply: (s) => s.replace("if (battleMenu && !battleCaptured)", "if (!battleCaptured && frame > masks.length - 200)"),
    expect: /^FAIL  battle prompt matches its font glyph mask/m,
  },
  {
    name: "black out the dialog body text (y >= 172)",
    apply: (s) => s.replace(RGBA_ANCHOR, RGBA_ANCHOR +
      "\n  if (cap.kind === \"text\") for (let y = 172; y < cap.height; y++) for (let x = 0; x < cap.width; x++) { const o = (y * cap.width + x) * 4; rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0; }"),
    expect: /^FAIL  every dialog line matches its font glyph mask/m,
  },
  {
    name: "paint the battle prompt/menu pure light paper",
    apply: (s) => s.replace(RGBA_ANCHOR, RGBA_ANCHOR +
      "\n  if (cap.kind === \"battle\") for (let y = 216; y < 272; y++) for (let x = 0; x < 480; x++) { const o = (y * cap.width + x) * 4; rgba[o] = 245; rgba[o + 1] = 241; rgba[o + 2] = 215; }"),
    // The command labels also fail, but the regression the review found was
    // the PROMPT assertion matching a solid-light band at 100% — require the
    // prompt assertion itself to go red.
    expect: /^FAIL  battle prompt matches its font glyph mask/m,
  },
];

const LOAD_ERROR = /Cannot find module|Failed to resolve|SyntaxError|error: Cannot/;

let failed = 0;
try {
  for (const m of mutations) {
    const mutated = m.apply(src);
    if (mutated === src) {
      console.error(`MUTANT SETUP FAIL  ${m.name} (no replacement made — verifier anchor changed?)`);
      failed++;
      continue;
    }
    writeFileSync(MUTANT, mutated);
    const result = spawnSync("bun", ["run", MUTANT], {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      timeout: 300_000,
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    // Leak check: a verifier that exits on the failure path must have taken
    // its Chrome down with it. Kill anything left (it is ours — matched on
    // this workspace's profile dir) and count it as a failure.
    const leaks = workspaceChromePids(PROFILE_DIR);
    for (const pid of leaks) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    const wentRed = result.status !== 0;
    const onTarget = wentRed && m.expect.test(output);
    const loadError = LOAD_ERROR.test(output);
    const leakNote = leaks.length ? `, CHROME LEAK x${leaks.length} (killed)` : "";
    if (onTarget && !loadError && leaks.length === 0) {
      console.log(`RED   ${m.name} (exit ${result.status}, on ${m.expect.source})`);
    } else {
      failed++;
      const why = !wentRed
        ? "verifier stayed GREEN"
        : loadError
          ? "verifier died on a module-load error, not an assertion"
          : leaks.length > 0
            ? "verifier leaked Chrome"
            : `went red on the wrong assertion (wanted ${m.expect.source})`;
      console.error(`FALSE ${m.name}: ${why} (exit ${result.status})${leakNote}`);
      console.error(`  last output: ${output.split("\n").filter(Boolean).slice(-4).join(" | ")}`);
    }
  }
} finally {
  rmSync(MUTANT, { force: true });
}
if (failed) {
  console.error(`\n${failed}/${mutations.length} mutations did NOT go red on their target assertions`);
  process.exit(1);
}
console.log(`\n${mutations.length}/${mutations.length} mutations went red on their target assertions`);
