// findings/s2-proto/s2-proto.tsx — Scout S2 render prototype: two ways to draw a
// Tuxemon map on PocketJS, switchable at runtime so one bundle measures both.
//
//   mode "chunks"  (recommended)  the composited below-player and above-player
//                  layers are 256x256 CLUT8+RLE chunks in TILESET pak entries,
//                  streamed with loadTileTexture for the chunks that intersect the
//                  viewport (+margin) and freed one chunk past it. Nodes: one image
//                  per resident chunk per layer (<= 2 x 3x3 at 480x272, 2 x 5x4 at
//                  960x544). Animated tiles are native sprite nodes (the core cycles
//                  the atlas frames itself) mounted for the cells in view.
//   mode "nodes"   (plan B)       every visible TMX layer is a toroidal ring of 16 px
//                  image nodes over the viewport + 1 tile of overscan, exactly like
//                  examples/wander's RenderRing; a tile's art is its own texture
//                  (assets/t<id>.png, uploaded at boot). Animated cells use the same
//                  sprite overlay as above.
//
// A virtual player walks the map (the camera follows and clamps like GameView);
// `globalThis.__s2Cmd` steers it and `globalThis.__s2State` publishes counters,
// so render.ts (wasm sim) and the desktop QuickJS bench drive the same bundle.

import { mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";
import { createElement, insertNode, setProp, type NodeMirror } from "@pocketjs/framework/renderer";
import { jump } from "@pocketjs/framework/animation";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { getOps, hostViewport } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import { freeTileTexture, loadTileTexture } from "../../vendor/pocket-rpgkit/vendor/pocketjs/framework/src/tiles.ts";
import { ANIMS, CHUNK, MAPS, ORDER, TILES, type S2Map } from "./manifest.ts";

const TILE = 16;
const PSP_W = 480;
const PSP_H = 272;
type Mode = "chunks" | "nodes";

export interface S2Cmd {
  mode?: Mode;
  map?: string;
  /** Walk the virtual player along a bouncing diagonal (vx, vy px per frame). */
  scroll?: boolean;
  vx?: number;
  vy?: number;
  /** Teleport the player (world px). */
  at?: [number, number];
  /** Streaming margin around the viewport in px (chunks mode). */
  margin?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __s2Cmd: S2Cmd | undefined;
  // eslint-disable-next-line no-var
  var __s2State: Record<string, unknown> | undefined;
}

function container(parent: NodeMirror, name: string): NodeMirror {
  const n = createElement("view");
  setProp(n, "style", { posType: 1, insetL: 0, insetT: 0, width: 0, height: 0 });
  setProp(n, "debugName", name);
  insertNode(parent, n);
  return n;
}
function imageNode(parent: NodeMirror, w: number, h: number): NodeMirror {
  const n = createElement("image");
  setProp(n, "style", { posType: 1, insetL: 0, insetT: 0, width: w, height: h });
  insertNode(parent, n);
  return n;
}
function hide(n: NodeMirror, hidden: boolean): void {
  setProp(n, "style", { display: hidden ? 1 : 0 });
}

// --- chunks mode -----------------------------------------------------------

interface ChunkRec { node: NodeMirror; handle: number }

/** One streamed layer: pooled image nodes over the chunks in the load window. */
class ChunkStream {
  readonly root: NodeMirror;
  private free: NodeMirror[] = [];
  private live = new Map<number, ChunkRec>();
  private refs: readonly string[] = [];
  private cols = 0;
  private rows = 0;
  uploads = 0;
  frees = 0;
  created = 0;
  constructor(parent: NodeMirror, name: string) {
    this.root = container(parent, name);
  }
  setMap(m: S2Map, refs: readonly string[]): void {
    this.unloadAll();
    this.refs = refs;
    this.cols = m.cols;
    this.rows = m.rows;
  }
  unloadAll(): void {
    for (const rec of this.live.values()) this.release(rec);
    this.live.clear();
  }
  private release(rec: ChunkRec): void {
    if (rec.handle >= 0) {
      freeTileTexture(rec.handle);
      this.frees++;
    }
    getOps().setImage(rec.node.id, -1);
    this.free.push(rec.node);
  }
  get resident(): number {
    return this.live.size;
  }
  /** Load every chunk touching the viewport grown by `margin`; unload one chunk
   *  beyond that (hysteresis, so a player pacing on a chunk edge never thrashes). */
  update(camX: number, camY: number, vpW: number, vpH: number, margin: number): void {
    if (!this.cols) return;
    const cx0 = Math.max(0, Math.floor((camX - margin) / CHUNK));
    const cy0 = Math.max(0, Math.floor((camY - margin) / CHUNK));
    const cx1 = Math.min(this.cols - 1, Math.floor((camX + vpW - 1 + margin) / CHUNK));
    const cy1 = Math.min(this.rows - 1, Math.floor((camY + vpH - 1 + margin) / CHUNK));
    const gone: number[] = [];
    for (const [i, rec] of this.live) {
      const cx = i % this.cols;
      const cy = (i - cx) / this.cols;
      if (cx < cx0 - 1 || cx > cx1 + 1 || cy < cy0 - 1 || cy > cy1 + 1) {
        this.release(rec);
        gone.push(i);
      }
    }
    for (const i of gone) this.live.delete(i);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * this.cols + cx;
        if (this.live.has(i)) continue;
        const ref = this.refs[i];
        if (!ref) continue;
        const hash = ref.indexOf("#");
        const key = ref.slice(0, hash);
        const idx = Number(ref.slice(hash + 1));
        let node = this.free.pop();
        if (!node) {
          node = imageNode(this.root, CHUNK, CHUNK);
          this.created++;
        }
        jump(node, "translateX", cx * CHUNK);
        jump(node, "translateY", cy * CHUNK);
        const handle = loadTileTexture(key, idx);
        if (handle >= 0) {
          getOps().setImage(node.id, handle);
          this.uploads++;
        }
        this.live.set(i, { node, handle });
      }
    }
  }
}

// --- nodes mode (plan B ring) ----------------------------------------------

interface Rec { node: NodeMirror; src: string | null; x: number; y: number }

class SlotLayer {
  readonly root: NodeMirror;
  private slots: (Rec | null)[] = [];
  visible = 0;
  constructor(parent: NodeMirror, name: string, private readonly pool: Rec[], private readonly counters: { created: number }) {
    this.root = container(parent, name);
  }
  resize(n: number): void {
    for (const rec of this.slots) if (rec) this.drop(rec);
    this.slots = new Array<Rec | null>(n).fill(null);
    this.visible = 0;
  }
  private drop(rec: Rec): void {
    if (rec.src !== null) setProp(rec.node, "src", null, rec.src);
    rec.src = null;
    this.pool.push(rec);
  }
  set(slot: number, src: string | null, px: number, py: number): void {
    let rec = this.slots[slot] ?? null;
    if (!src) {
      if (rec) {
        this.drop(rec);
        this.slots[slot] = null;
        this.visible--;
      }
      return;
    }
    if (!rec) {
      rec = this.pool.pop() ?? null;
      if (rec) {
        if (rec.node.parent !== this.root) insertNode(this.root, rec.node);
      } else {
        rec = { node: imageNode(this.root, TILE, TILE), src: null, x: NaN, y: NaN };
        this.counters.created++;
      }
      this.slots[slot] = rec;
      this.visible++;
    }
    if (rec.x !== px) { jump(rec.node, "translateX", px); rec.x = px; }
    if (rec.y !== py) { jump(rec.node, "translateY", py); rec.y = py; }
    if (rec.src !== src) { setProp(rec.node, "src", src, rec.src); rec.src = src; }
  }
}

const MAX_BELOW = 5;
const MAX_ABOVE = 3;

class Ring {
  readonly below: SlotLayer[] = [];
  readonly above: SlotLayer[] = [];
  private readonly pool: Rec[] = [];
  readonly counters = { created: 0 };
  private map: S2Map | null = null;
  private layers: { layer: SlotLayer; s: string }[] = [];
  private W = 0;
  private H = 0;
  private x0 = NaN;
  private y0 = NaN;
  resyncs = 0;
  cellsSynced = 0;
  constructor(parentBelow: NodeMirror, parentAbove: NodeMirror) {
    for (let i = 0; i < MAX_BELOW; i++) this.below.push(new SlotLayer(parentBelow, `ring-below-${i}`, this.pool, this.counters));
    for (let i = 0; i < MAX_ABOVE; i++) this.above.push(new SlotLayer(parentAbove, `ring-above-${i}`, this.pool, this.counters));
  }
  setMap(m: S2Map | null): void {
    for (const l of [...this.below, ...this.above]) l.resize(this.W * this.H);
    this.map = m;
    this.layers = [];
    if (!m) return;
    let b = 0, a = 0;
    for (const c of m.cells) {
      const layer = c.above ? this.above[a++] : this.below[b++];
      if (layer) this.layers.push({ layer, s: c.s });
    }
    this.x0 = NaN;
  }
  get visible(): number {
    let n = 0;
    for (const l of [...this.below, ...this.above]) n += l.visible;
    return n;
  }
  private syncCell(tx: number, ty: number): void {
    const m = this.map!;
    const slot = (((ty % this.H) + this.H) % this.H) * this.W + (((tx % this.W) + this.W) % this.W);
    const inside = tx >= 0 && ty >= 0 && tx < m.w && ty < m.h;
    const i = ty * m.w + tx;
    for (const { layer, s } of this.layers) {
      const code = inside ? s.charCodeAt(i) - 32 : 0;
      layer.set(slot, code ? TILES[code]! : null, tx * TILE, ty * TILE);
    }
    this.cellsSynced++;
  }
  update(camX: number, camY: number, vpW: number, vpH: number): void {
    if (!this.map) return;
    const W = Math.ceil(vpW / TILE) + 3;
    const H = Math.ceil(vpH / TILE) + 3;
    if (W !== this.W || H !== this.H) {
      this.W = W;
      this.H = H;
      for (const l of [...this.below, ...this.above]) l.resize(W * H);
      this.x0 = NaN;
    }
    const x0 = Math.floor(camX / TILE) - 1;
    const y0 = Math.floor(camY / TILE) - 1;
    if (x0 === this.x0 && y0 === this.y0) return;
    const full = Number.isNaN(this.x0) || Math.abs(x0 - this.x0) >= W || Math.abs(y0 - this.y0) >= H;
    const px0 = this.x0, py0 = this.y0;
    this.x0 = x0;
    this.y0 = y0;
    this.resyncs++;
    if (full) {
      for (let y = y0; y < y0 + H; y++) for (let x = x0; x < x0 + W; x++) this.syncCell(x, y);
      return;
    }
    const px1 = px0 + W - 1, py1 = py0 + H - 1;
    for (let y = y0; y < y0 + H; y++) {
      const rowNew = y < py0 || y > py1;
      for (let x = x0; x < x0 + W; x++) if (rowNew || x < px0 || x > px1) this.syncCell(x, y);
    }
  }
}

// --- animated tiles (both modes) -------------------------------------------

interface AnimRec { node: NodeMirror; seq: number; above: boolean }

class AnimOverlay {
  private free: NodeMirror[] = [];
  private live = new Map<number, AnimRec>();
  private anims: S2Map["anims"] = [];
  private x0 = NaN;
  private y0 = NaN;
  private x1 = NaN;
  private y1 = NaN;
  created = 0;
  constructor(private readonly below: NodeMirror, private readonly above: NodeMirror) {}
  setMap(m: S2Map | null): void {
    for (const rec of this.live.values()) this.unmount(rec);
    this.live.clear();
    this.anims = m ? m.anims : [];
    this.x0 = NaN;
  }
  private unmount(rec: AnimRec): void {
    setProp(rec.node, "sprite", null, ANIMS[rec.seq]!.src);
    this.free.push(rec.node);
  }
  get mounted(): number {
    return this.live.size;
  }
  update(camX: number, camY: number, vpW: number, vpH: number): void {
    const x0 = Math.floor(camX / TILE) - 1, y0 = Math.floor(camY / TILE) - 1;
    const x1 = Math.floor((camX + vpW) / TILE) + 1, y1 = Math.floor((camY + vpH) / TILE) + 1;
    if (x0 === this.x0 && y0 === this.y0 && x1 === this.x1 && y1 === this.y1) return;
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    // Unmount first so the pool serves the cells scrolling in (one pass would
    // create a node for every entering cell before the leaving ones free theirs).
    for (const [i, rec] of [...this.live]) {
      const [x, y] = this.anims[i]!;
      if (x < x0 || x > x1 || y < y0 || y > y1) {
        this.unmount(rec);
        this.live.delete(i);
      }
    }
    for (let i = 0; i < this.anims.length; i++) {
      const [x, y, above, seq] = this.anims[i]!;
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const rec = this.live.get(i);
      if (inside && !rec) {
        let node = this.free.pop();
        const parent = above ? this.above : this.below;
        if (!node) {
          node = imageNode(parent, TILE, TILE);
          this.created++;
        } else if (node.parent !== parent) insertNode(parent, node);
        jump(node, "translateX", x * TILE);
        jump(node, "translateY", y * TILE);
        const a = ANIMS[seq]!;
        setProp(node, "frameStep", a.step);
        setProp(node, "sprite", a.src, null);
        this.live.set(i, { node, seq, above: above === 1 });
      }
    }
  }
}

// --- the app ---------------------------------------------------------------

function S2View() {
  const vp0 = hostViewport(getOps());
  let vpW = vp0 ? vp0.w : PSP_W;
  let vpH = vp0 ? vp0.h : PSP_H;

  const frameRoot = createElement("view");
  setProp(frameRoot, "style", { posType: 1, insetL: 0, insetT: 0, width: vpW, height: vpH, bgColor: "#000000" });
  setProp(frameRoot, "debugName", "s2-frame");
  const world = container(frameRoot, "s2-world");
  // z-order: chunk ground, ring below, anim below, player, chunk upper, ring above, anim above
  const ground = new ChunkStream(world, "s2-ground");
  const ringBelow = container(world, "s2-ring-below");
  const animBelow = container(world, "s2-anim-below");
  const player = createElement("view");
  setProp(player, "style", { posType: 1, insetL: 0, insetT: 0, width: TILE, height: TILE, bgColor: "#ff40c0" });
  setProp(player, "debugName", "s2-player");
  insertNode(world, player);
  const upper = new ChunkStream(world, "s2-upper");
  const ringAbove = container(world, "s2-ring-above");
  const animAbove = container(world, "s2-anim-above");
  const ring = new Ring(ringBelow, ringAbove);
  const anim = new AnimOverlay(animBelow, animAbove);

  let mode: Mode = "chunks";
  let mapId = ORDER[0]!;
  let map: S2Map = MAPS[mapId]!;
  let px = 0, py = 0, vx = 1, vy = 1;
  let scroll = false;
  let margin = 16;
  let frame = 0;
  let prevButtons = 0;
  let switchUploads = 0, switchFrees = 0, switches = 0;
  let camX = NaN, camY = NaN;

  const applyMap = (id: string, m: Mode) => {
    const u0 = ground.uploads + upper.uploads, f0 = ground.frees + upper.frees;
    mapId = id;
    map = MAPS[id]!;
    mode = m;
    if (mode === "chunks") {
      ground.setMap(map, map.g);
      upper.setMap(map, map.u);
      ring.setMap(null);
    } else {
      ground.unloadAll();
      upper.unloadAll();
      ring.setMap(map);
    }
    hide(ringBelow, mode !== "nodes");
    hide(ringAbove, mode !== "nodes");
    anim.setMap(map);
    px = Math.min(px, map.w * TILE - TILE);
    py = Math.min(py, map.h * TILE - TILE);
    camX = NaN;
    switches++;
    // uploads/frees this switch are counted after the first update below
    switchUploads = -(u0);
    switchFrees = -(f0);
  };

  const step = (buttons: number) => {
    const cmd = globalThis.__s2Cmd;
    let rebuild = false;
    if (cmd) {
      globalThis.__s2Cmd = undefined;
      if (cmd.at) { px = cmd.at[0]; py = cmd.at[1]; }
      if (cmd.vx !== undefined) vx = cmd.vx;
      if (cmd.vy !== undefined) vy = cmd.vy;
      if (cmd.scroll !== undefined) scroll = cmd.scroll;
      if (cmd.margin !== undefined) margin = cmd.margin;
      if ((cmd.map && cmd.map !== mapId) || (cmd.mode && cmd.mode !== mode)) {
        applyMap(cmd.map ?? mapId, cmd.mode ?? mode);
        rebuild = true;
      }
    }
    const nextVp = hostViewport(getOps());
    if (nextVp && (nextVp.w !== vpW || nextVp.h !== vpH)) {
      vpW = nextVp.w;
      vpH = nextVp.h;
      setProp(frameRoot, "style", { width: vpW, height: vpH });
    }
    const worldW = map.w * TILE, worldH = map.h * TILE;
    if (scroll) {
      px += vx;
      py += vy;
      if (px < 0) { px = 0; vx = -vx; } else if (px > worldW - TILE) { px = worldW - TILE; vx = -vx; }
      if (py < 0) { py = 0; vy = -vy; } else if (py > worldH - TILE) { py = worldH - TILE; vy = -vy; }
    } else {
      const speed = 2;
      if (buttons & BTN.LEFT) px = Math.max(0, px - speed);
      if (buttons & BTN.RIGHT) px = Math.min(worldW - TILE, px + speed);
      if (buttons & BTN.UP) py = Math.max(0, py - speed);
      if (buttons & BTN.DOWN) py = Math.min(worldH - TILE, py + speed);
    }
    // follow camera, clamped; undersized axes are centred (GameView semantics)
    const cx = worldW <= vpW ? -Math.floor((vpW - worldW) / 2) : Math.max(0, Math.min(worldW - vpW, Math.floor(px + TILE / 2 - vpW / 2)));
    const cy = worldH <= vpH ? -Math.floor((vpH - worldH) / 2) : Math.max(0, Math.min(worldH - vpH, Math.floor(py + TILE / 2 - vpH / 2)));
    const camMoved = cx !== camX || cy !== camY;
    if (camMoved) {
      camX = cx;
      camY = cy;
      jump(world, "translateX", -cx);
      jump(world, "translateY", -cy);
    }
    if (camMoved || rebuild) {
      if (mode === "chunks") {
        ground.update(cx, cy, vpW, vpH, margin);
        upper.update(cx, cy, vpW, vpH, margin);
      } else {
        ring.update(cx, cy, vpW, vpH);
      }
      anim.update(cx, cy, vpW, vpH);
    }
    if (rebuild) {
      switchUploads += ground.uploads + upper.uploads;
      switchFrees += ground.frees + upper.frees;
    }
    jump(player, "translateX", px);
    jump(player, "translateY", py);
    frame++;
    const st = globalThis.__s2State ?? (globalThis.__s2State = {});
    st.frame = frame; st.mode = mode; st.map = mapId; st.camX = cx; st.camY = cy; st.px = px; st.py = py;
    st.vpW = vpW; st.vpH = vpH; st.scroll = scroll;
    st.chunkResident = ground.resident + upper.resident;
    st.chunkNodes = ground.created + upper.created;
    st.uploads = ground.uploads + upper.uploads;
    st.frees = ground.frees + upper.frees;
    st.ringVisible = ring.visible;
    st.ringNodes = ring.counters.created;
    st.ringResyncs = ring.resyncs;
    st.ringCells = ring.cellsSynced;
    st.animMounted = anim.mounted;
    st.animNodes = anim.created;
    st.switches = switches;
    st.switchUploads = switchUploads;
    st.switchFrees = switchFrees;
    prevButtons = buttons;
  };

  // initial map from a pre-set command (sim/bench), else the first map
  const init = globalThis.__s2Cmd;
  applyMap(init?.map ?? mapId, init?.mode ?? mode);
  onFrame((buttons) => step(buttons));

  return (
    <View class="w-full h-full overflow-hidden bg-black">
      {frameRoot as unknown as ReturnType<typeof View>}
    </View>
  );
}

mount(() => <S2View />);
