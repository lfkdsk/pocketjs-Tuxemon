import importlib.util, json, sys
import numpy as np
spec = importlib.util.spec_from_file_location("tref", "/home/tangollvm/.fleet/worktrees/task-1833/tools/terrain-reference.py")
tref = importlib.util.module_from_spec(spec); sys.modules["tref"] = tref; spec.loader.exec_module(tref)
grid = json.load(open("/var/tmp/fleet/1838/walkgrid.json"))
res = {}
for mid, g in grid.items():
    ground, upper, meta = tref.render_map("/var/tmp/tuxemon-src", mid)
    w, h = g["w"], g["h"]
    ua = upper[..., 3] > 0
    def cell_has(x, y):
        if x < 0 or y < 0 or x >= w or y >= h: return False
        return bool(ua[y*16:(y+1)*16, x*16:(x+1)*16].any())
    walk = [(x, y) for y in range(h) for x in range(w) if g["walk"][y*w+x]]
    head_only = [(x, y) for (x, y) in walk if cell_has(x, y-1) and not cell_has(x, y)]
    feet = [(x, y) for (x, y) in walk if cell_has(x, y)]
    both = [(x, y) for (x, y) in walk if cell_has(x, y) and cell_has(x, y-1)]
    clear = [(x, y) for (x, y) in walk if not cell_has(x, y) and not cell_has(x, y-1)]
    res[mid] = dict(walkable=len(walk), head_only=len(head_only), feet=len(feet), feet_and_head=len(both), clear=len(clear),
                    head_only_cells=head_only[:60], both_cells=both[:60])
    print(f"{mid}: walkable={len(walk)} headCoveredOnlyInG6={len(head_only)} feetUpper={len(feet)} feet+head={len(both)} clear={len(clear)}")
json.dump(res, open("/var/tmp/fleet/1838/occl_stats.json", "w"))
