// tools/headless-chrome.ts — shared headless-Chrome lifecycle for the web
// verifiers. The browser process tree (crashpad, renderers) and the local
// HTTP server MUST be torn down on EVERY exit path — success, assertion
// failure, thrown error, or signal — so a failed acceptance run never leaves
// Chrome processes behind (a leaked browser holds the task's process tree
// open until the fleet timeout).
//
// Chrome is launched through setsid(1) when available, so it sits in its own
// process group and one kill(-pid) takes down the whole tree; without setsid
// we walk the child chain with pgrep instead. Cleanup functions registered
// with registerCleanup() run on process exit, fatal signals, and uncaught
// errors, and are idempotent.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export interface HeadlessChrome {
  wsUrl: string;
  /** Kill the browser process tree. Idempotent. */
  close(): void;
}

const haveSetsid = Bun.which("setsid") !== null;

/** Recursively SIGKILL every descendant of `rootPid` (pgrep -P walk), then
 *  the root itself. */
function killProcessTree(rootPid: number): void {
  let out = "";
  try {
    out = execFileSync("pgrep", ["-P", String(rootPid)], { encoding: "utf8" });
  } catch {
    out = ""; // pgrep exits 1 when the process has no children
  }
  for (const child of out.trim().split(/\s+/)) {
    if (!child) continue;
    killProcessTree(Number(child));
  }
  try {
    process.kill(rootPid, "SIGKILL");
  } catch {
    // already gone
  }
}

/** Launch headless Chrome and resolve once the DevTools endpoint is up.
 *  `profileDir` is this run's --user-data-dir (also the handle cleanup and
 *  leak checks match on). */
export async function spawnHeadlessChrome(
  chrome: string,
  profileDir: string,
  windowSize = "1200,900",
): Promise<HeadlessChrome> {
  mkdirSync(profileDir, { recursive: true });
  const proc = Bun.spawn([
    ...(haveSetsid ? ["setsid"] : []),
    chrome,
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-background-networking",
    `--window-size=${windowSize}`,
    "--force-device-scale-factor=1",
    "about:blank",
  ], { stdout: "ignore", stderr: "pipe" });
  const pid = proc.pid;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (haveSetsid) {
      // setsid exec'd Chrome as the leader of a fresh group; killing the
      // group takes crashpad/renderer children down in one syscall.
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // group already gone
      }
    }
    killProcessTree(pid);
  };
  // Register before the first await: a signal that arrives while Chrome is
  // still starting up (before the caller holds the handle) must still tear
  // the browser down.
  registerCleanup(close);
  const reader = proc.stderr.getReader();
  let text = "";
  let wsUrl = "";
  try {
    while (!wsUrl) {
      const { value, done } = await reader.read();
      if (done) throw new Error("chrome exited: " + text);
      text += new TextDecoder().decode(value);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (m) {
        const port = new URL(m[1]!).port;
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[];
        wsUrl = targets.find((t) => t.type === "page")!.webSocketDebuggerUrl;
      }
    }
  } catch (err) {
    close();
    throw err;
  } finally {
    reader.releaseLock();
  }
  return { wsUrl, close };
}

// --- global cleanup registry -------------------------------------------------

const cleanups: (() => void)[] = [];
let registered = false;

/** Register a cleanup function to run on every exit path. Idempotent per
 *  registration; each registered function runs at most once. */
export function registerCleanup(fn: () => void): void {
  cleanups.push(fn);
  if (registered) return;
  registered = true;
  const run = () => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // cleanup must not block further cleanup
      }
    }
  };
  process.on("exit", run);
  for (const sig of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      run();
      process.exit(128);
    });
  }
  process.on("uncaughtException", (err) => {
    run();
    console.error(err);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    run();
    console.error(err);
    process.exit(1);
  });
}

/** PIDs of live Chrome processes whose --user-data-dir points at `dir`.
 *  Matching on the workspace profile path (not the process name) means this
 *  never touches browsers another workspace or task started. */
export function workspaceChromePids(dir: string): number[] {
  let out = "";
  try {
    out = execFileSync("pgrep", ["-f", "--", `--user-data-dir=${dir}`], { encoding: "utf8" });
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
  return out.trim().split(/\s+/).filter(Boolean).map(Number);
}
