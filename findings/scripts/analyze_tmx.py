#!/usr/bin/env python3
"""Scout S2 asset measurement over every Tuxemon TMX map.

Parses all .tmx (+ external .tsx / embedded tilesets), applies Tuxemon's
draw-order rule (pyscroll: tile layers with index < SPRITE_LAYER_INDEX=2 are
under the sprites, index >= 2 are drawn over them), and measures:
  * per map / per layer non-empty cells, above-player share
  * unique 16x16 tiles by pixel content (with and without flip variants)
  * animated tiles (tsx <animation>) and the cells using them
  * unique composited per-cell stacks (ground / upper) -> one-node-per-cell atlas size
  * plan A bytes (512 chunks as today, tight pow2 canvases), colours per map,
    PackBits-RLE bytes of CLUT8 (T8) and of 4444 chunks
  * sliding-viewport node counts for plan B
and writes reference composites of every map (ref/<map>.png) plus JSON/CSV.
"""
import base64, collections, csv, hashlib, json, math, os, sys, time, zlib
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

SRC = os.environ.get("TUXEMON_SRC", "/var/tmp/tuxemon-src")
MAPS = os.path.join(SRC, "mods/tuxemon/maps")
OUT = os.environ.get("S2_OUT", "/var/tmp/fleet/task-1783/out")
REF = os.environ.get("S2_REF", "/var/tmp/fleet/task-1783/ref")
SPRITE_LAYER_INDEX = 2  # tuxemon/map/tuxemon.py:164
FLIP_H, FLIP_V, FLIP_D = 0x80000000, 0x40000000, 0x20000000
GID_MASK = 0x1FFFFFFF
T = 16

os.makedirs(OUT, exist_ok=True); os.makedirs(REF, exist_ok=True)
PROTO = os.environ.get("S2_PROTO", "/var/tmp/fleet/task-1783/proto")
PROTO_MAPS = set(os.environ.get("S2_PROTO_MAPS", "taba_house1,taba_town,buddha_mountain,classic_gym_pyra").split(","))
os.makedirs(os.path.join(PROTO, "tiles"), exist_ok=True)
proto_variants = {}
ALL_TILES = os.environ.get("S2_ALL_TILES", "")
if ALL_TILES: os.makedirs(ALL_TILES, exist_ok=True)

# ---------------------------------------------------------------- tilesets
class Tileset:
    def __init__(self, elem, base_dir, firstgid):
        self.firstgid = firstgid
        self.name = elem.get("name", "?")
        self.tw = int(elem.get("tilewidth")); self.th = int(elem.get("tileheight"))
        self.spacing = int(elem.get("spacing", 0)); self.margin = int(elem.get("margin", 0))
        self.tilecount = int(elem.get("tilecount", 0))
        img = elem.find("image")
        self.image_path = os.path.normpath(os.path.join(base_dir, img.get("source")))
        self.columns = int(elem.get("columns", 0))
        self.anim = {}       # local id -> [(local id, ms), ...]
        self.props = {}      # local id -> {name: value}
        for t in elem.findall("tile"):
            lid = int(t.get("id"))
            a = t.find("animation")
            if a is not None:
                self.anim[lid] = [(int(f.get("tileid")), int(f.get("duration"))) for f in a.findall("frame")]
            p = t.find("properties")
            if p is not None:
                self.props[lid] = {q.get("name"): q.get("value") for q in p.findall("property")}
        self._img = None
        self._cells = {}
    @property
    def img(self):
        if self._img is None:
            im = Image.open(self.image_path).convert("RGBA")
            self._img = np.asarray(im)
            if self.columns == 0:
                self.columns = (im.width - 2 * self.margin + self.spacing) // (self.tw + self.spacing)
            self.rows = (im.height - 2 * self.margin + self.spacing) // (self.th + self.spacing)
        return self._img
    def cell(self, lid):
        c = self._cells.get(lid)
        if c is None:
            img = self.img
            cx, cy = lid % self.columns, lid // self.columns
            x0 = self.margin + cx * (self.tw + self.spacing); y0 = self.margin + cy * (self.th + self.spacing)
            c = img[y0:y0 + self.th, x0:x0 + self.tw]
            if c.shape[0] != self.th or c.shape[1] != self.tw:
                c = np.zeros((self.th, self.tw, 4), np.uint8)
            self._cells[lid] = c
        return c

tsx_cache = {}
def load_tsx(path, firstgid):
    root = ET.parse(path).getroot()
    return Tileset(root, os.path.dirname(path), firstgid)

def variant(cell, flags):
    v = cell
    if flags & FLIP_D: v = np.transpose(v, (1, 0, 2))
    if flags & FLIP_H: v = v[:, ::-1]
    if flags & FLIP_V: v = v[::-1, :]
    return np.ascontiguousarray(v)

def pixhash(arr):
    return hashlib.blake2b(arr.tobytes(), digest_size=12).digest()

def over(dst, src):
    """Porter-Duff over, straight alpha, uint8 in/out (matches chunks.ts blitTile)."""
    a = src[..., 3:4].astype(np.float32) / 255.0
    da = dst[..., 3:4].astype(np.float32) / 255.0
    outa = a + da * (1 - a)
    rgb = (src[..., :3].astype(np.float32) * a + dst[..., :3].astype(np.float32) * da * (1 - a)) / np.maximum(outa, 1e-6)
    out = np.empty_like(dst)
    out[..., :3] = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
    out[..., 3:4] = np.clip(np.round(outa * 255), 0, 255).astype(np.uint8)
    return out

def packbits_len(stream):
    """Exact byte length of spec.ts packbitsEncode over a uint8 stream (vectorised)."""
    s = np.asarray(stream, np.uint8).ravel()
    n = s.size
    if n == 0: return 0
    # run starts
    change = np.flatnonzero(s[1:] != s[:-1]) + 1
    starts = np.concatenate(([0], change)); ends = np.concatenate((change, [n]))
    lens = ends - starts
    # Encoder: at position i with run>=2 -> repeat packets of <=129; else literal until a run>=3 starts (max 128).
    # Literal groups = maximal sequences of runs with len 1 or 2, but a run of 2 ends the literal only when... the
    # encoder scans `r<3` so 2-runs stay literal; a run>=3 breaks. Also a run of exactly 2 AT the start of a
    # literal search (i.e. right after a repeat/literal) is emitted as a repeat (run>=2 check first).
    total = 0
    i = 0; R = lens.size
    # iterate over runs but group literal spans vectorially: python loop over runs is too slow for 45M px,
    # so do a hybrid: process run arrays with numpy where possible.
    rep = lens >= 3
    # sequences: maximal spans of non-rep runs form literal candidates, except a span-leading run of len 2 is a repeat.
    # Cost model:
    #   repeat run of length L: 2*ceil(L/129)
    #   literal span of total pixels P: P + ceil(P/128)
    # A run of length 2 leading a span -> counted as a repeat (2 bytes) and the remaining span continues as literal.
    # (the encoder re-checks run>=2 after each literal packet of 128 too; ignore that 2nd-order effect)
    cost = np.where(rep, 2 * np.ceil(lens / 129.0), 0).sum()
    nonrep = ~rep
    if nonrep.any():
        # spans of consecutive nonrep runs
        idx = np.flatnonzero(nonrep)
        brk = np.flatnonzero(np.diff(idx) > 1) + 1
        span_starts = np.concatenate(([0], brk)); span_ends = np.concatenate((brk, [idx.size]))
        cl = np.cumsum(np.concatenate(([0], lens[idx])))
        for a, b in zip(span_starts, span_ends):
            first = idx[a]
            P = cl[b] - cl[a]
            if lens[first] == 2:
                cost += 2; P -= 2
            if P > 0:
                cost += P + math.ceil(P / 128.0)
    return int(cost)

# ---------------------------------------------------------------- maps
def decode_layer(layer, w, h):
    d = layer.find("data")
    enc = d.get("encoding"); comp = d.get("compression")
    if enc == "base64":
        raw = base64.b64decode(d.text.strip())
        if comp == "zlib": raw = zlib.decompress(raw)
        elif comp == "gzip":
            import gzip; raw = gzip.decompress(raw)
        elif comp: raise RuntimeError("compression " + comp)
        arr = np.frombuffer(raw, dtype="<u4")
    elif enc == "csv":
        arr = np.array([int(x) for x in d.text.replace("\n", "").split(",") if x.strip() != ""], dtype=np.uint32)
    else:
        arr = np.array([int(t.get("gid", 0)) for t in d.findall("tile")], dtype=np.uint32)
    return arr.reshape(h, w)

unique_tiles = {}        # pixhash(base tile) -> dict(source, opaque, alpha_kind)
unique_variants = {}     # pixhash(variant) -> True
anim_defs = {}           # (tileset image, lid) -> frames
anim_frame_tiles = set() # pixhashes of all animation frames
empty_hash = pixhash(np.zeros((T, T, 4), np.uint8))
ground_stacks = {}       # composite hash -> count (unique composited ground cells)
upper_stacks = {}
tileset_sizes = {}       # image path -> (w,h,tilecount, colours)
non16 = []

maps_out = []
layer_rows = []
per_map_ref = {}
t_start = time.time()
files = sorted(f for f in os.listdir(MAPS) if f.endswith(".tmx"))
grand = collections.Counter()
above_by_name_disagree = 0
opacity_layers = 0
hidden_layers = 0

def tile_kind(cell):
    a = cell[..., 3]
    if a.max() == 0: return "empty"
    if a.min() == 255: return "opaque"
    return "alpha"

for fi, f in enumerate(files):
    path = os.path.join(MAPS, f)
    root = ET.parse(path).getroot()
    w, h = int(root.get("width")), int(root.get("height"))
    assert root.get("tilewidth") == "16" and root.get("tileheight") == "16", f
    tilesets = []
    for te in root.findall("tileset"):
        fg = int(te.get("firstgid"))
        if te.get("source"):
            p = os.path.normpath(os.path.join(MAPS, te.get("source")))
            key = (p, fg)
            ts = load_tsx(p, fg)
        else:
            ts = Tileset(te, MAPS, fg)
        tilesets.append(ts)
        if ts.tw != 16 or ts.th != 16: non16.append((f, ts.name, ts.tw, ts.th))
    tilesets.sort(key=lambda t: t.firstgid)
    def resolve(gid):
        for ts in reversed(tilesets):
            if gid >= ts.firstgid: return ts, gid - ts.firstgid
        raise RuntimeError("gid %d unresolved in %s" % (gid, f))

    # visible tile layers in order (pyscroll visible_tile_layers = visible layers, in file order)
    layers = []
    for idx, le in enumerate([e for e in root if e.tag in ("layer", "objectgroup", "imagelayer", "group")]):
        if le.tag != "layer": continue
        vis = le.get("visible", "1") != "0"
        if not vis: hidden_layers += 1; continue
        op = float(le.get("opacity", 1))
        if op != 1: opacity_layers += 1
        layers.append((le.get("name"), decode_layer(le, w, h), op, idx))
    n_ev = len([o for og in root.findall("objectgroup") for o in og.findall("object") if o.get("type") == "event"])

    # per-cell composites
    ground = np.zeros((h * T, w * T, 4), np.uint8)
    upper = np.zeros((h * T, w * T, 4), np.uint8)
    cell_tiles = {}   # (hash) per cell reuse
    below_count = np.zeros((h, w), np.int32)   # non-empty below-layer tiles per cell
    above_count = np.zeros((h, w), np.int32)
    anim_cells = 0
    anim_grid = np.zeros((h, w), np.int32)
    flip_cells = 0
    map_unique = set()
    map_anim_unique = set()
    layer_info = []
    # stacks per cell: list of variant arrays
    stacks_g = [[None] * w for _ in range(h)]
    stacks_u = [[None] * w for _ in range(h)]
    for li, (name, data, op, pidx) in enumerate(layers):
        above = pidx > SPRITE_LAYER_INDEX  # pyscroll: tiles at the sprite layer sort UNDER sprites; > draws over
        by_name = ("above" in name.lower()) or ("over" in name.lower())
        nonempty = 0
        ys, xs = np.nonzero(data)
        for y, x in zip(ys.tolist(), xs.tolist()):
            raw = int(data[y, x]); gid = raw & GID_MASK; flags = raw & ~GID_MASK
            ts, lid = resolve(gid)
            base = ts.cell(lid)
            bh = pixhash(base)
            if bh == empty_hash or base[..., 3].max() == 0:
                continue  # fully transparent tile: draws nothing
            kind = tile_kind(base)
            if bh not in unique_tiles:
                unique_tiles[bh] = {"src": os.path.basename(ts.image_path), "lid": lid, "kind": kind}
            v = variant(base, flags) if flags else base
            vh = pixhash(v) if flags else bh
            if vh not in unique_variants and ALL_TILES:
                Image.fromarray(np.ascontiguousarray(v), "RGBA").save(os.path.join(ALL_TILES, "v%d.png" % (len(unique_variants) + 1)))
            unique_variants[vh] = True
            if flags: flip_cells += 1
            map_unique.add(vh)
            if lid in ts.anim:
                key = (ts.image_path, lid)
                if key not in anim_defs:
                    anim_defs[key] = ts.anim[lid]
                    for (fl, ms) in ts.anim[lid]:
                        anim_frame_tiles.add(pixhash(ts.cell(fl)))
                anim_cells += 1
                anim_grid[y, x] += 1
                map_anim_unique.add(key)
            nonempty += 1
            if op != 1:
                v = v.copy(); v[..., 3] = (v[..., 3].astype(np.float32) * op).astype(np.uint8)
            if above:
                above_count[y, x] += 1
                st = stacks_u[y][x] or []
                st.append((vh, v)); stacks_u[y][x] = st
            else:
                below_count[y, x] += 1
                st = stacks_g[y][x] or []
                st.append((vh, v)); stacks_g[y][x] = st
        if above != by_name and nonempty > 0: above_by_name_disagree += 1
        layer_info.append({"i": li, "name": name, "above": above, "nonempty": nonempty, "opacity": op})
        layer_rows.append([f[:-4], li, name, int(above), nonempty, w * h])

    # composite cells, dedupe stacks
    def composite(stacks, canvas, registry):
        n_multi = 0
        for y in range(h):
            for x in range(w):
                st = stacks[y][x]
                if not st: continue
                # drop everything under an opaque tile
                k = len(st) - 1
                while k > 0 and st[k][1][..., 3].min() < 255: k -= 1
                st = st[k:]
                if len(st) == 1:
                    comp = st[0][1]; ch = st[0][0]
                else:
                    n_multi += 1
                    comp = st[0][1]
                    for _, v in st[1:]: comp = over(comp, v)
                    ch = pixhash(comp)
                registry[ch] = registry.get(ch, 0) + 1
                canvas[y * T:(y + 1) * T, x * T:(x + 1) * T] = comp
        return n_multi
    multi_g = composite(stacks_g, ground, ground_stacks)
    multi_u = composite(stacks_u, upper, upper_stacks)

    # colours and RLE sizes
    def colours(canvas):
        flat = canvas.reshape(-1, 4)
        flat = flat[flat[:, 3] != 0] if (flat[:, 3] == 0).any() else flat
        # count unique RGBA (transparent -> single colour)
        u = np.unique(flat.view(np.uint32))
        return int(u.size)
    col_g = colours(ground); col_u = colours(upper)
    full = over(ground, upper)
    col_full = colours(full)
    def t8_indices(canvas):
        """CLUT8 index image (palette index 0 = transparent). Quantise if >255 opaque colours."""
        flat = canvas.reshape(-1, 4).copy()
        alpha0 = flat[:, 3] == 0
        flat[alpha0] = 0
        keys = flat.view(np.uint32).ravel()
        u, inv = np.unique(keys, return_inverse=True)
        if u.size <= 256:
            return inv.astype(np.uint8).reshape(canvas.shape[:2]), int(u.size), False
        # quantise: PIL adaptive palette on RGB, transparent stays 0
        im = Image.fromarray(canvas, "RGBA")
        q = im.convert("RGB").quantize(colors=255, method=Image.MEDIANCUT, dither=Image.NONE)
        idx = np.asarray(q, np.uint8).astype(np.int32) + 1
        idx[alpha0.reshape(canvas.shape[:2])] = 0
        return idx.astype(np.uint8), 256, True
    def chunk_rle(index_img, chunk):
        """PackBits length over CHUNK×CHUNK T8 tiles covering the map; counts absent chunks as 0 bytes."""
        H, W = index_img.shape
        total = 0; nchunks = 0; nonempty = 0
        for cy in range(0, H, chunk):
            for cx in range(0, W, chunk):
                nchunks += 1
                tile = np.zeros((chunk, chunk), np.uint8)
                sub = index_img[cy:cy + chunk, cx:cx + chunk]
                tile[:sub.shape[0], :sub.shape[1]] = sub
                if tile.max() == 0: continue
                nonempty += 1
                total += packbits_len(tile)
        return total, nchunks, nonempty
    def to4444(canvas):
        r = (canvas[..., 0] >> 4).astype(np.uint16); g = (canvas[..., 1] >> 4).astype(np.uint16)
        b = (canvas[..., 2] >> 4).astype(np.uint16); a = (canvas[..., 3] >> 4).astype(np.uint16)
        return ((a << 12) | (b << 8) | (g << 4) | r).astype("<u2")
    def chunk_rle_4444(canvas, chunk):
        H, W = canvas.shape[:2]; total = 0
        px = to4444(canvas)
        for cy in range(0, H, chunk):
            for cx in range(0, W, chunk):
                tile = np.zeros((chunk, chunk), "<u2")
                sub = px[cy:cy + chunk, cx:cx + chunk]
                tile[:sub.shape[0], :sub.shape[1]] = sub
                if tile.max() == 0: continue
                total += packbits_len(tile.view(np.uint8))
        return total
    def chunk_colours(canvas, chunk):
        H, W = canvas.shape[:2]; over256 = 0; mx = 0; n = 0
        for cy in range(0, H, chunk):
            for cx in range(0, W, chunk):
                sub = canvas[cy:cy + chunk, cx:cx + chunk].reshape(-1, 4).copy()
                sub[sub[:, 3] == 0] = 0
                c = int(np.unique(sub.view(np.uint32)).size)
                n += 1; mx = max(mx, c)
                if c > 256: over256 += 1
        return over256, mx, n
    over256_g, maxcol_chunk_g, _ = chunk_colours(ground, 256)
    over256_u, maxcol_chunk_u, _ = chunk_colours(upper, 256)
    ig, ncol_g, quant_g = t8_indices(ground)
    iu, ncol_u, quant_u = t8_indices(upper)
    rle256_g, nch256, ne256_g = chunk_rle(ig, 256)
    rle256_u, _, ne256_u = chunk_rle(iu, 256)
    rle512_g, nch512, ne512_g = chunk_rle(ig, 512)
    rle512_u, _, ne512_u = chunk_rle(iu, 512)
    rle4444_256 = chunk_rle_4444(ground, 256) + chunk_rle_4444(upper, 256)
    pow2 = lambda n: 1 << max(0, math.ceil(math.log2(max(1, n))))
    tight_w, tight_h = min(512, pow2(w * T)), min(512, pow2(h * T))

    # sliding viewport node counts (plan B): nodes per cell = below tiles + above tiles (per-layer nodes),
    # and composited = (1 if below) + (1 if above)
    per_layer = below_count + above_count
    comp = (below_count > 0).astype(np.int32) + (above_count > 0).astype(np.int32)
    def window_stats(grid, vw, vh):
        vw = min(vw, w); vh = min(vh, h)
        cs = np.zeros((h + 1, w + 1), np.int64); cs[1:, 1:] = grid.cumsum(0).cumsum(1)
        sums = cs[vh:, vw:] - cs[:-vh, vw:] - cs[vh:, :-vw] + cs[:-vh, :-vw]
        return int(sums.max()), float(sums.mean())
    win = {}
    for (vw, vh, tag) in [(32, 19, "psp"), (62, 36, "desk")]:
        m1, a1 = window_stats(per_layer, vw, vh); m2, a2 = window_stats(comp, vw, vh); m3, a3 = window_stats(anim_grid, vw, vh)
        win[tag] = {"perLayerMax": m1, "perLayerMean": round(a1, 1), "compMax": m2, "compMean": round(a2, 1), "animMax": m3, "animMean": round(a3, 1)}
    anim_chunks = 0
    for cy in range(0, h, 16):
        for cx in range(0, w, 16):
            if anim_grid[cy:cy + 16, cx:cx + 16].any(): anim_chunks += 1

    Image.fromarray(full, "RGBA").save(os.path.join(REF, f[:-4] + ".png"))
    if f[:-4] in PROTO_MAPS:
        pd = os.path.join(PROTO, f[:-4]); os.makedirs(pd, exist_ok=True)
        Image.fromarray(ground, "RGBA").save(os.path.join(pd, "ground.png"))
        Image.fromarray(upper, "RGBA").save(os.path.join(pd, "upper.png"))
        # plan-B cell tables: per visible layer, variant id per cell (0 = empty); variants shared across proto maps
        layer_tables = []
        for li, (name, data, op, pidx) in enumerate(layers):
            tab = np.zeros((h, w), np.int32)
            ys, xs = np.nonzero(data)
            for y, x in zip(ys.tolist(), xs.tolist()):
                raw = int(data[y, x]); gid = raw & GID_MASK; flags = raw & ~GID_MASK
                ts, lid = resolve(gid); base = ts.cell(lid)
                if base[..., 3].max() == 0: continue
                v = variant(base, flags) if flags else base
                vh = pixhash(v)
                vid = proto_variants.get(vh)
                if vid is None:
                    vid = len(proto_variants) + 1; proto_variants[vh] = vid
                    Image.fromarray(np.ascontiguousarray(v), "RGBA").save(os.path.join(PROTO, "tiles", "t%d.png" % vid))
                tab[y, x] = vid
            layer_tables.append({"name": name, "above": pidx > SPRITE_LAYER_INDEX, "cells": tab.ravel().tolist()})
        anims = []
        for li, (name, data, op, pidx) in enumerate(layers):
            ys, xs = np.nonzero(data)
            for y, x in zip(ys.tolist(), xs.tolist()):
                raw = int(data[y, x]); gid = raw & GID_MASK; flags = raw & ~GID_MASK
                ts, lid = resolve(gid)
                if lid not in ts.anim: continue
                frames = []
                for (fl, ms) in ts.anim[lid]:
                    fv = variant(ts.cell(fl), flags) if flags else ts.cell(fl)
                    vh = pixhash(fv); vid = proto_variants.get(vh)
                    if vid is None:
                        vid = len(proto_variants) + 1; proto_variants[vh] = vid
                        Image.fromarray(np.ascontiguousarray(fv), "RGBA").save(os.path.join(PROTO, "tiles", "t%d.png" % vid))
                    frames.append([vid, ms])
                anims.append({"x": x, "y": y, "layer": li, "above": pidx > SPRITE_LAYER_INDEX, "frames": frames})
        json.dump({"map": f[:-4], "w": w, "h": h, "layers": layer_tables, "anims": anims}, open(os.path.join(pd, "map.json"), "w"))
    rec = {
        "map": f[:-4], "w": w, "h": h, "cells": w * h, "layers": len(layers), "events": n_ev,
        "belowLayers": sum(1 for l in layer_info if not l["above"]), "aboveLayers": sum(1 for l in layer_info if l["above"]),
        "belowNonempty": int(below_count.sum()), "aboveNonempty": int(above_count.sum()),
        "cellsWithGround": int((below_count > 0).sum()), "cellsWithAbove": int((above_count > 0).sum()),
        "multiStackGround": multi_g, "multiStackUpper": multi_u,
        "animCells": anim_cells, "animTilesUnique": len(map_anim_unique), "flipCells": flip_cells,
        "uniqueVariants": len(map_unique),
        "coloursGround": col_g, "coloursUpper": col_u, "coloursFull": col_full,
        "t8ColoursGround": ncol_g, "t8QuantGround": quant_g, "t8ColoursUpper": ncol_u, "t8QuantUpper": quant_u,
        "chunks256Over256ColoursGround": over256_g, "chunks256Over256ColoursUpper": over256_u,
        "maxColoursChunk256Ground": maxcol_chunk_g, "animChunks256": anim_chunks,
        "chunks512": nch512, "chunks256": nch256, "nonempty256Upper": ne256_u, "nonempty512Upper": ne512_u,
        "bytes4444_512chunks": nch512 * 512 * 512 * 2 * 2,
        "bytes4444_tight": tight_w * tight_h * 2 * 2,
        "bytesT8_256chunks_raw": (ne256_g + ne256_u) * 256 * 256,
        "bytesT8RLE_256": rle256_g + rle256_u, "bytesT8RLE_512": rle512_g + rle512_u,
        "bytes4444RLE_256": rle4444_256,
        "tightCanvas": [tight_w, tight_h],
        "win": win,
        "layerNames": [l["name"] for l in layer_info],
    }
    maps_out.append(rec)
    if (fi + 1) % 20 == 0 or fi == len(files) - 1:
        print("%3d/%d %-32s %4dx%-4d layers=%d uniq=%d t=%.0fs" % (fi + 1, len(files), f, w, h, len(layers), len(unique_tiles), time.time() - t_start), flush=True)

# ---------------------------------------------------------------- tileset stats
ts_stats = []
seen = set()
for f in files:
    pass
for key, meta in unique_tiles.items():
    grand[meta["kind"]] += 1
kinds_variants = collections.Counter()
summary = {
    "maps": len(files),
    "cells": sum(m["cells"] for m in maps_out),
    "hiddenLayers": hidden_layers, "opacityLayers": opacity_layers, "non16Tilesets": non16,
    "aboveRuleDisagreements(name vs pytmx index>2, layers with content)": above_by_name_disagree,
    "uniqueTilesByPixels": len(unique_tiles),
    "uniqueTilesOpaque": grand["opaque"], "uniqueTilesAlpha": grand["alpha"],
    "uniqueTileVariantsWithFlips": len(unique_variants),
    "animatedTileDefsUsed": len(anim_defs),
    "animatedFramesTotal": sum(len(v) for v in anim_defs.values()),
    "animatedFrameUniqueTiles": len(anim_frame_tiles),
    "animCellsTotal": sum(m["animCells"] for m in maps_out),
    "flipCellsTotal": sum(m["flipCells"] for m in maps_out),
    "uniqueGroundStacks": len(ground_stacks), "uniqueUpperStacks": len(upper_stacks),
    "belowNonemptyTotal": sum(m["belowNonempty"] for m in maps_out),
    "aboveNonemptyTotal": sum(m["aboveNonempty"] for m in maps_out),
    "cellsWithAboveTotal": sum(m["cellsWithAbove"] for m in maps_out),
    "cellsWithGroundTotal": sum(m["cellsWithGround"] for m in maps_out),
    "multiStackGroundTotal": sum(m["multiStackGround"] for m in maps_out),
    "planA_bytes4444_512chunks": sum(m["bytes4444_512chunks"] for m in maps_out),
    "planA_bytes4444_tight": sum(m["bytes4444_tight"] for m in maps_out),
    "planA_chunks512": sum(m["chunks512"] for m in maps_out),
    "planA_chunks256": sum(m["chunks256"] for m in maps_out),
    "planA_bytesT8_256_raw": sum(m["bytesT8_256chunks_raw"] for m in maps_out),
    "planA_bytesT8RLE_256": sum(m["bytesT8RLE_256"] for m in maps_out),
    "planA_bytesT8RLE_512": sum(m["bytesT8RLE_512"] for m in maps_out),
    "planA_bytes4444RLE_256": sum(m["bytes4444RLE_256"] for m in maps_out),
    "chunks256Over256ColoursGround": sum(m["chunks256Over256ColoursGround"] for m in maps_out),
    "chunks256Over256ColoursUpper": sum(m["chunks256Over256ColoursUpper"] for m in maps_out),
    "animChunks256Total": sum(m["animChunks256"] for m in maps_out),
    "maps20x20": [m["map"] for m in maps_out if m["w"] == 20 and m["h"] == 20],
    "mapsOver256ColoursGround": sum(1 for m in maps_out if m["t8QuantGround"]),
    "mapsOver256ColoursUpper": sum(1 for m in maps_out if m["t8QuantUpper"]),
    "mapsOver256ColoursFull": sum(1 for m in maps_out if m["coloursFull"] > 256),
    "maxColoursFull": max(m["coloursFull"] for m in maps_out),
    "animDefs": {"%s:%d" % (os.path.basename(k[0]), k[1]): v for k, v in list(anim_defs.items())[:400]},
    "seconds": round(time.time() - t_start, 1),
}
json.dump({"variants": len(proto_variants)}, open(os.path.join(PROTO, "variants.json"), "w"))
json.dump({"summary": summary, "maps": maps_out}, open(os.path.join(OUT, "tmx-stats.json"), "w"), indent=1)
with open(os.path.join(OUT, "layers.csv"), "w", newline="") as fh:
    cw = csv.writer(fh); cw.writerow(["map", "index", "name", "above", "nonempty", "cells"]); cw.writerows(layer_rows)
with open(os.path.join(OUT, "maps.csv"), "w", newline="") as fh:
    keys = [k for k in maps_out[0].keys() if k not in ("win", "layerNames", "tightCanvas")]
    cw = csv.writer(fh); cw.writerow(keys + ["pspPerLayerMax", "pspCompMax", "deskPerLayerMax", "deskCompMax"])
    for m in maps_out:
        cw.writerow([m[k] for k in keys] + [m["win"]["psp"]["perLayerMax"], m["win"]["psp"]["compMax"], m["win"]["desk"]["perLayerMax"], m["win"]["desk"]["compMax"]])
print(json.dumps({k: v for k, v in summary.items() if k != "animDefs"}, indent=1))
