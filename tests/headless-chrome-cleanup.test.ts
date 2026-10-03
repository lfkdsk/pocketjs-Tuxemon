// tools/headless-chrome.ts must tear Chrome down on every exit path. A
// leaked browser keeps the run's process tree alive after the verifier has
// exited, so a signal that lands while Chrome is still starting up (before
// the caller holds the handle) must clean up as well as one that lands
// after the DevTools endpoint is ready.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { workspaceChromePids } from "../tools/headless-chrome.ts";

const ROOT = resolve(import.meta.dir, "..");
const CHROME = process.env.CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium");

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(50);
  }
  return check();
}

/** Run a child that starts Chrome, print `marker` at the chosen point, and
 *  SIGTERM it as soon as the marker appears. Returns the profile dir. */
async function terminateAt(marker: "spawned" | "ready"): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "headless-chrome-cleanup-"));
  const profile = join(dir, "profile");
  const script = join(dir, "child.ts");
  writeFileSync(script, `
import { spawnHeadlessChrome } from ${JSON.stringify(join(ROOT, "tools/headless-chrome.ts"))};
const pending = spawnHeadlessChrome(${JSON.stringify(CHROME)}, ${JSON.stringify(profile)});
console.log("spawned");
await pending;
console.log("ready");
await new Promise(() => {});
`);
  const child = Bun.spawn(["bun", script], { stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  let text = "";
  while (!text.includes(marker)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  child.kill("SIGTERM");
  await child.exited;
  return profile;
}

describe.skipIf(!CHROME)("headless Chrome cleanup", () => {
  for (const marker of ["spawned", "ready"] as const) {
    test(`a SIGTERM after Chrome is ${marker} leaves no browser behind`, async () => {
      const profile = await terminateAt(marker);
      try {
        const gone = await waitFor(() => workspaceChromePids(profile).length === 0, 5000);
        expect(workspaceChromePids(profile)).toEqual([]);
        expect(gone).toBe(true);
      } finally {
        for (const pid of workspaceChromePids(profile)) {
          try { process.kill(pid, "SIGKILL"); } catch {}
        }
        rmSync(join(profile, ".."), { recursive: true, force: true });
      }
    }, 30_000);
  }
});
