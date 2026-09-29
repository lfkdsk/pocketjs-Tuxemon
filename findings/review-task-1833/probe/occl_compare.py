# Compare the real G6 frame with a Tuxemon/pyscroll(tall_sprites=2) composite at the same camera.
import importlib.util, json, sys
import numpy as np
from PIL import Image, ImageDraw
W = "/home/tangollvm/.fleet/worktrees/task-1833/"
spec = importlib.util.spec_from_file_location("tref", W + "tools/terrain-reference.py")
tref = importlib.util.module_from_spec(spec); sys.modules["tref"] = tref; spec.loader.exec_module(tref)
shots = json.load(open("/var/tmp/fleet/1838/shots.json"))
cache = {}
def over(dst, src):
    a = src[..., 3:4].astype(np.float32) / 255.0
    out = dst.copy()
    out[..., :3] = (src[..., :3] * a + dst[..., :3] * (1 - a)).astype(np.uint8)
    out[..., 3] = np.maximum(dst[..., 3], src[..., 3])
    return out
tiles = []
report = []
for s in shots:
    mid = s["mapNow"]
    if mid not in cache: cache[mid] = tref.render_map("/var/tmp/tuxemon-src", mid)[:2]
    ground, upper = cache[mid]
    H, Wd = ground.shape[:2]
    spr = np.array(Image.open(W + f"assets/characters/player-adventurer-idle-{s['facing']}.png").convert("RGBA"))
    cx, cy = s["cam"]["x"], s["cam"]["y"]
    # world-space sprite rect
    sx, sy = s["px"], s["py"] - 16
    def layer_canvas():
        return np.zeros((H + 32, Wd, 4), np.uint8)
    # G6 model: ground, sprite, upper
    g6 = np.zeros_like(ground); g6 = over(g6, ground)
    g6[sy:sy+32, sx:sx+16] = over(g6[sy:sy+32, sx:sx+16], spr)
    g6 = over(g6, upper)
    # Tuxemon model: ground+upper, sprite, upper at the feet cell only
    tx = over(over(np.zeros_like(ground), ground), upper)
    tx[sy:sy+32, sx:sx+16] = over(tx[sy:sy+32, sx:sx+16], spr)
    fx, fy = s["px"] // 16, s["py"] // 16
    tx[fy*16:(fy+1)*16, fx*16:(fx+1)*16] = over(tx[fy*16:(fy+1)*16, fx*16:(fx+1)*16], upper[fy*16:(fy+1)*16, fx*16:(fx+1)*16])
    real = np.array(Image.open(f"/var/tmp/fleet/1838/shot-{s['name']}.png").convert("RGBA"))
    # map world->screen (maps smaller than the viewport are centred; here all oversized or clamped)
    vw, vh = min(480, Wd), min(272, H)
    ox, oy = (480 - vw) // 2, (272 - vh) // 2
    def crop_world(img, x0, y0, w, h): return img[y0:y0+h, x0:x0+w]
    # 48x64 window around the player
    wx0, wy0 = max(0, sx - 16), max(0, sy - 16)
    ww, wh = 48, 64
    rx0, ry0 = wx0 - cx + ox, wy0 - cy + oy
    real_c = real[ry0:ry0+wh, rx0:rx0+ww]
    g6_c = crop_world(g6, wx0, wy0, ww, wh)
    tx_c = crop_world(tx, wx0, wy0, ww, wh)
    # visible player pixels in each (compare with sprite mask)
    mask = spr[..., 3] > 0
    def visible(img, x0, y0):
        region = img[sy-y0+0:sy-y0+32, sx-x0:sx-x0+16, :3].astype(int)
        return int((np.abs(region - spr[..., :3].astype(int)).sum(axis=2)[mask] == 0).sum())
    vis_g6 = visible(g6, 0, 0); vis_tx = visible(tx, 0, 0)
    vis_real = int((np.abs(real[sy-cy+oy:sy-cy+oy+32, sx-cx+ox:sx-cx+ox+16, :3].astype(int) - spr[..., :3].astype(int)).sum(axis=2)[mask] == 0).sum())
    model_ok = bool((np.abs(real_c[..., :3].astype(int) - g6_c[..., :3].astype(int)).sum(axis=2) > 0).sum() < 40)
    report.append(dict(name=s["name"], cell=[s["tx"], s["ty"]], spritePx=int(mask.sum()), visibleReal=vis_real, visibleG6Model=vis_g6, visibleTuxemonModel=vis_tx, g6ModelMatchesReal=model_ok))
    z = 5
    row = Image.new("RGB", (ww*z*2 + 12, wh*z + 18), (40, 40, 40))
    row.paste(Image.fromarray(real_c[..., :3]).resize((ww*z, wh*z), Image.NEAREST), (0, 18))
    row.paste(Image.fromarray(tx_c[..., :3]).resize((ww*z, wh*z), Image.NEAREST), (ww*z + 12, 18))
    d = ImageDraw.Draw(row); d.text((4, 3), f"G6 real {s['name']} @{s['tx']},{s['ty']}", fill=(255,255,255)); d.text((ww*z+16, 3), "Tuxemon (pyscroll tall_sprites=2) model", fill=(255,255,255))
    tiles.append(row)
sheet = Image.new("RGB", (max(t.width for t in tiles), sum(t.height + 6 for t in tiles)), (0, 0, 0))
y = 0
for t in tiles: sheet.paste(t, (0, y)); y += t.height + 6
sheet.save("/var/tmp/fleet/1838/occlusion-compare.png")
json.dump(report, open("/var/tmp/fleet/1838/occlusion-compare.json", "w"), indent=1)
for r in report: print(r)
