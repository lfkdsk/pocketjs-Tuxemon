// Boot a bundle at arbitrary starts (or replay the maintained tape to a frame),
// capture the frame, and check every current-map actor's opaque sprite pixels
// at its reducer-derived screen position. Writes plain + annotated PNGs.
// usage: bun npcscan.ts <bundle-without-ext> '<json shots>' [outdir]
//   shot: {name, map,x,y,dir, frames?}  or  {name, tape: <frame>}
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = "/home/tangollvm/.fleet/worktrees/task-1833";
const { bootWorld, fnv1a } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/hosts/sim/sim.ts`);
const { encodePNG } = await import(`${ROOT}/vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts`);
const { decodePng } = await import(`${ROOT}/importer/png.ts`);
const { walkPose } = await import(`${ROOT}/vendor/pocket-rpgkit/src/engine/movement.ts`);
const { NPC_SRC, PLAYER } = await import(`${ROOT}/ui/game-assets.ts`);
const project = JSON.parse(readFileSync(`${ROOT}/dist/project.json`, "utf8"));
const journey = JSON.parse(readFileSync(`${ROOT}/data/g6-journey.json`, "utf8"));
const [bundle, shotsJson, outArg] = process.argv.slice(2);
const OUT = outArg ?? "/var/tmp/fleet/1863/shots";
const shots = JSON.parse(shotsJson!) as any[];
const imgCache = new Map<string, any>();
const img = (p: string) => imgCache.get(p) ?? imgCache.set(p, decodePng(new Uint8Array(readFileSync(join(ROOT, p))), p)).get(p);
const imageKey = (phase: number, facing: number, frames: any): string => {
  const pose = walkPose(phase);
  return pose === 1 ? frames.walkL[facing] : pose === 2 ? frames.walkR[facing] : frames.idle[facing];
};
function box(rgba: Uint8Array, x0: number, y0: number, w: number, h: number, c: [number, number, number]) {
  for (let x = x0; x < x0 + w; x++) for (const y of [y0, y0 + h - 1]) put(rgba, x, y, c);
  for (let y = y0; y < y0 + h; y++) for (const x of [x0, x0 + w - 1]) put(rgba, x, y, c);
}
function put(rgba: Uint8Array, x: number, y: number, c: [number, number, number]) {
  if (x < 0 || y < 0 || x >= 480 || y >= 272) return;
  const i = (y * 480 + x) * 4; rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
}
function match(rgba: Uint8Array, image: string, x0: number, y0: number) {
  const s = img(image); let opaque = 0, matching = 0, onscreen = 0;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const si = (y * s.width + x) * 4; if (s.rgba[si + 3] !== 255) continue; opaque++;
    const tx = x0 + x, ty = y0 + y; if (tx < 0 || ty < 0 || tx >= 480 || ty >= 272) continue; onscreen++;
    const ti = (ty * 480 + tx) * 4;
    if (s.rgba[si] === rgba[ti] && s.rgba[si + 1] === rgba[ti + 1] && s.rgba[si + 2] === rgba[ti + 2]) matching++;
  }
  return { opaque, onscreen, matching, w: s.width, h: s.height };
}
const results: any[] = [];
for (const s of shots) {
  const globals = { __reviewStart: s.tape === undefined ? { map: s.map, x: s.x, y: s.y, dir: s.dir } : undefined, __reviewVars: s.vars };
  const world = await bootWorld(bundle, 60, globals, undefined, { width: 480, height: 272 });
  const n = s.tape === undefined ? (s.frames ?? 40) : s.tape + 1;
  for (let f = 0; f < n; f++) { world.frame(s.tape === undefined ? (s.mask ?? 0) : journey.masks[f]); world.tick(); }
  const rgba = world.render().slice();
  const st = (globalThis as any).__rpgSessionState, cam = (globalThis as any).__rpgGameCamera;
  const map = project.maps.find((m: any) => m.id === st.mapId);
  const offX = Math.max(0, Math.floor((480 - map.width * 16) / 2)), offY = Math.max(0, Math.floor((272 - map.height * 16) / 2));
  const actors: any[] = [];
  const ann = rgba.slice();
  // player
  {
    const image = imageKey(st.move.phase, st.move.facing, PLAYER);
    const x0 = offX + st.move.px - cam.x, y0 = offY + st.move.py - cam.y + 16 - 32;
    actors.push({ id: "PLAYER", tile: [st.move.tx, st.move.ty], screen: [x0, y0], ...match(rgba, image, x0, y0) });
    box(ann, x0, y0, 16, 32, [0, 255, 255]);
  }
  for (const [id, ch] of Object.entries<any>(st.chars?.chars ?? {})) {
    const ev = map.events?.find((e: any) => e.id === id);
    if (!ev) continue;
    const sprite = ev.pages[ch.pageIndex]?.sprite;
    const art = sprite ? NPC_SRC[sprite] : undefined;
    if (!art) { actors.push({ id, tile: [ch.tx, ch.ty], sprite: sprite ?? null, note: "no art" }); continue; }
    const image = typeof art === "string" ? art : imageKey(ch.phase, ch.facing, art);
    const h = typeof art === "string" ? img(art).height : art.h;
    const w = typeof art === "string" ? img(art).width : 16;
    const x0 = offX + ch.px - cam.x, y0 = offY + ch.py - cam.y + 16 - h;
    const m = match(rgba, image, x0, y0);
    // what would be there if drawn at the map origin instead
    const o = match(rgba, image, offX + 0 - cam.x, offY + 0 - cam.y + 16 - h);
    actors.push({ id, sprite, tile: [ch.tx, ch.ty], screen: [x0, y0], ...m, originMatch: o.matching });
    if (m.onscreen > 0) box(ann, x0, y0, w, h, m.matching === m.onscreen ? [0, 255, 0] : [255, 0, 0]);
  }
  writeFileSync(join(OUT, `${s.name}.png`), encodePNG(rgba, 480, 272));
  writeFileSync(join(OUT, `${s.name}.ann.png`), encodePNG(ann, 480, 272));
  const modal = st.interp.modal ? (st.interp.modal.lines ?? st.interp.modal.options).join(" / ").slice(0, 80) : null;
  results.push({ name: s.name, map: st.mapId, player: [st.move.tx, st.move.ty], camera: [cam.x, cam.y], fnv: fnv1a(rgba), modal, actors });
  console.log(`${s.name}: ${st.mapId}@${st.move.tx},${st.move.ty} cam=${cam.x},${cam.y} fnv=${fnv1a(rgba)} modal=${modal ?? "-"}`);
  for (const a of actors) console.log(`   ${a.id.padEnd(44)} tile=${JSON.stringify(a.tile)} screen=${JSON.stringify(a.screen)} opaque=${a.opaque} onscreen=${a.onscreen} match=${a.matching} origin=${a.originMatch ?? "-"} ${a.note ?? ""}`);
}
writeFileSync(join(OUT, `scan-${Date.now()}.json`), JSON.stringify(results, null, 1));
