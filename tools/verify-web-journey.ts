// tools/verify-web-journey.ts — play the maintained journey tape (bedroom
// through the first battle to Route 1) in real headless Chrome against the
// built web site, one fixed step per tape frame, and compare the checkpoint
// states and framebuffer hashes with the committed goldens.
//
//   bun run web && bun tools/verify-web-journey.ts [--chrome PATH]
//
// The page's requestAnimationFrame is frozen before load, so the player
// advances only when this script steps it: frame 0 is the player's own boot
// step (the tape starts idle), frames 1..N are fed from data/g6-journey.json.
// Any console error or uncaught exception fails the run.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SITE = resolve(ROOT, "dist/web");
const OUT = resolve(ROOT, "dist/web-journey");
const chromeFlag = process.argv.indexOf("--chrome");
const CHROME = chromeFlag >= 0 ? process.argv[chromeFlag + 1]! :
  process.env.CHROME ?? Bun.which("google-chrome") ?? Bun.which("chromium") ?? "google-chrome";
if (!existsSync(join(SITE, "pocket-tuxemon", "index.html"))) {
  console.error("verify-web-journey: no site at dist/web; run `bun run web` first");
  process.exit(2);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const journey = JSON.parse(readFileSync(join(ROOT, "data/g6-journey.json"), "utf8"));
const goldens = JSON.parse(readFileSync(join(ROOT, "data/g6-goldens.json"), "utf8"));

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    let path = resolve(SITE, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(SITE)) return new Response("forbidden", { status: 403 });
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    return existsSync(path) ? new Response(Bun.file(path)) : new Response("not found", { status: 404 });
  },
});

const proc = Bun.spawn([
  CHROME, "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0",
  `--user-data-dir=${OUT}/profile`, "--no-first-run", "--disable-background-networking",
  "--window-size=1200,900", "--force-device-scale-factor=1", "about:blank",
], { stdout: "ignore", stderr: "pipe" });
const reader = proc.stderr.getReader();
let text = "";
let wsUrl = "";
while (!wsUrl) {
  const { value, done } = await reader.read();
  if (done) throw new Error("chrome exited: " + text);
  text += new TextDecoder().decode(value);
  const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
  if (m) {
    const port = new URL(m[1]!).port;
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[];
    wsUrl = targets.find((t) => t.type === "page").webSocketDebuggerUrl;
  }
}
reader.releaseLock();

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map<number, (m: any) => void>();
const errors: string[] = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id !== undefined) pending.get(m.id)?.(m), pending.delete(m.id);
  else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description ?? "exception");
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
});
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<any>((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression: string) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send("Runtime.enable");
await send("Page.enable");
// Freeze the page's real-time clock: the player only advances when we step it.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};",
});
const t0 = performance.now();
await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/pocket-tuxemon/` });
for (let i = 0; i < 600; i++) {
  const ready = await evaluate(`!!(globalThis.__pocketPlayer && globalThis.__pocketPlayer.state === "running" && globalThis.__rpgSessionState)`).catch(() => false);
  if (ready) break;
  await Bun.sleep(100);
}
const bootMs = performance.now() - t0;

const checkpoints = new Map<number, string>(journey.checkpoints.map((c: any) => [c.frame, c.name]));
const result = await evaluate(`(async () => {
  const masks = ${JSON.stringify(journey.masks)};
  const marks = new Set(${JSON.stringify([...checkpoints.keys()])});
  const p = globalThis.__pocketPlayer;
  const fnv = (bytes) => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };
  const out = { size: [p.width, p.height], marks: {}, frames: 0 };
  // Frame 0 already ran at boot with buttons 0 (masks[0] is 0).
  if (masks[0] !== 0) throw new Error("tape does not start with an idle frame");
  const snap = (frame) => {
    const s = globalThis.__rpgSessionState;
    out.marks[frame] = { hash: fnv(p.wasm.render()), state: [s.mapId, s.move.tx, s.move.ty] };
  };
  if (marks.has(0)) snap(0);
  const t = performance.now();
  for (let frame = 1; frame < masks.length; frame++) {
    const mask = masks[frame];
    p.buttons = () => mask;
    p.step();
    out.frames++;
    if (marks.has(frame)) snap(frame);
  }
  out.ms = performance.now() - t;
  const s = globalThis.__rpgSessionState;
  out.end = [s.mapId, s.move.tx, s.move.ty];
  out.scene = s.scene ? s.scene.kind : null;
  p.paint();
  return out;
})()`);

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(OUT, "end.png"), Buffer.from(shot.data, "base64"));

console.log(`boot ${bootMs.toFixed(0)} ms; replayed ${result.frames + 1} frames in ${result.ms.toFixed(0)} ms; viewport ${result.size.join("x")}`);
let ok = true;
for (const g of goldens.frames) {
  const got = result.marks[g.frame];
  const stateOk = got && got.state.join() === [g.map, ...g.position].join();
  const hashOk = got && got.hash === g.rgbaFnv1a;
  ok &&= !!(stateOk && hashOk);
  console.log(`${stateOk && hashOk ? "ok  " : "FAIL"} ${g.name} @${g.frame}: state ${got?.state.join(",")} (want ${g.map},${g.position.join(",")}) pixels ${got?.hash} (want ${g.rgbaFnv1a})`);
}
const endOk = result.end.join() === [journey.map, ...journey.position].join();
ok &&= endOk;
console.log(`${endOk ? "ok  " : "FAIL"} end: ${result.end.join(",")} (want ${journey.map},${journey.position.join(",")}), scene ${result.scene}`);
console.log(`console errors: ${errors.length}${errors.length ? "\n  " + errors.slice(0, 5).join("\n  ") : ""}`);
ok &&= errors.length === 0;
console.log(ok ? "WEB JOURNEY PASS" : "WEB JOURNEY FAIL");
ws.close();
proc.kill();
server.stop(true);
process.exit(ok ? 0 : 1);
