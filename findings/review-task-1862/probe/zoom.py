# zoom.py in.png out.png x0 y0 x1 y1 scale
import sys
from PIL import Image
src, dst, x0, y0, x1, y1, s = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:8])
im = Image.open(src).convert("RGBA").crop((x0, y0, x1, y1))
im = im.resize(((x1 - x0) * s, (y1 - y0) * s), Image.NEAREST)
im.save(dst)
