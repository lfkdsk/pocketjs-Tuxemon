#!/usr/bin/env python3
"""Side-by-side of a sim shot against the Tuxemon composite reference at the same camera.
usage: compare.py <shot.png> <ref map png> <camX> <camY> <out.png> [mask cells: x,y ...]
Prints the fraction of differing pixels (any channel differs) and the count outside the
player-marker cell; writes [shot | ref | diff x8] as one PNG."""
import sys, numpy as np
from PIL import Image
shot = np.asarray(Image.open(sys.argv[1]).convert("RGBA")).astype(np.int32)
ref_full = Image.open(sys.argv[2]).convert("RGBA")
cx, cy = int(sys.argv[3]), int(sys.argv[4])
h, w = shot.shape[:2]
# the app centres undersized maps on a black frame: negative cam = letterbox offset
canvas = Image.new("RGBA", (w, h), (0, 0, 0, 255))
x0, y0 = max(0, -cx), max(0, -cy)
crop = ref_full.crop((max(0, cx), max(0, cy), max(0, cx) + w - x0, max(0, cy) + h - y0))
canvas.alpha_composite(crop, (x0, y0))
ref = np.asarray(canvas).astype(np.int32)
ref[..., 3] = 255
shot[..., 3] = 255
diff = np.abs(shot - ref).max(axis=2)
mask = np.ones((h, w), bool)
for cell in sys.argv[6:]:
    px, py = map(int, cell.split(","))
    mask[py - cy:py - cy + 16, px - cx:px - cx + 16] = False
bad = (diff > 0)
print("differing pixels: %d / %d (%.3f%%); outside masked cells: %d" % (bad.sum(), h * w, 100.0 * bad.sum() / (h * w), (bad & mask).sum()))
vis = np.zeros((h, w, 4), np.uint8); vis[..., 3] = 255
vis[..., 0] = np.clip(diff * 8, 0, 255); vis[..., 1] = np.clip(diff * 8, 0, 255); vis[..., 2] = np.clip(diff * 8, 0, 255)
out = Image.new("RGBA", (w * 3 + 8, h), (40, 40, 40, 255))
out.paste(Image.fromarray(shot.astype(np.uint8)), (0, 0)); out.paste(Image.fromarray(ref.astype(np.uint8)), (w + 4, 0)); out.paste(Image.fromarray(vis), (2 * w + 8, 0))
out.save(sys.argv[5])
