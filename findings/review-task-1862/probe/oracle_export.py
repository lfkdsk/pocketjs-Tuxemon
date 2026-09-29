# Export the raw-TMX Tuxemon step oracle (tools/verify-terrain-collision.py) as per-map step tables
# so the REAL kit canStepFrom can be checked against it (no python re-implementation of the kit).
import sys, json, importlib.util
sys.dont_write_bytecode = True
ROOT = "/home/tangollvm/.fleet/worktrees/task-1833"
spec = importlib.util.spec_from_file_location("vtc", f"{ROOT}/tools/verify-terrain-collision.py")
vtc = importlib.util.module_from_spec(spec); sys.modules["vtc"] = vtc; spec.loader.exec_module(vtc)
terrain = json.load(open(f"{ROOT}/data/terrain.json"))
out = {}
oneway = 0
for patch in terrain["maps"]:
    mid = patch["id"]
    width, height, cells, source_masks, line_edges, yaml_cells = vtc.load_oracle("/var/tmp/tuxemon-src", mid)
    blocked = {i for i, f in patch["passage"] if f == "block"}
    dynamic = {i for v in patch["collisionLabels"].values() for i in v}
    rows = []
    for y in range(height):
        for x in range(width):
            s = y * width + x
            if s in blocked or s in dynamic: continue
            for d in vtc.DIRS:
                nx, ny = x + vtc.DX[d], y + vtc.DY[d]
                t = ny * width + nx if 0 <= nx < width and 0 <= ny < height else -1
                if t in dynamic: continue
                rows.append([x, y, d, 1 if vtc.tux_step(cells, source_masks, width, height, x, y, d) else 0])
    out[mid] = rows
json.dump({"dirs": list(vtc.DIRS), "maps": out}, open("/var/tmp/fleet/1863/probe/oracle-steps.json", "w"))
print("maps", len(out), "steps", sum(len(v) for v in out.values()))
