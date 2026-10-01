#!/usr/bin/env python3
"""Compare imported passage against an independent Tuxemon collision oracle.

The oracle mirrors tuxemon/map/loader.py + movement.py from raw TMX/TSX:
visible-tile region/surface properties, snapped collision rectangles/polygon
bounds, collision polylines, entry/exit/endure rules, and labelled dynamic
blocking regions.  It does not import the TypeScript terrain implementation.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import os
import struct
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass
from pathlib import Path

import yaml


TILE = 16
GID_MASK = 0x1FFFFFFF
DIRS = ("down", "left", "up", "right")
BITS = {"down": 1, "left": 2, "up": 4, "right": 8}
DX = {"down": 0, "left": -1, "up": 0, "right": 1}
DY = {"down": 1, "left": 0, "up": -1, "right": 0}
OPPOSITE = {"down": "up", "left": "right", "up": "down", "right": "left"}
REGION_KEYS = {"enter_from", "exit_from", "endure", "key", "push_direction", "push_strength", "speed_modifier", "hop"}
SURFACE_KEYS = ("surfable", "walkable", "climbable")

DEFAULT_MAPS = (
    "taba_house1",
    "buddha_mountain",
    "candy_town",
    "cotton_cafe",
    "classic_hearthrock_city",
    "mansion",
    "gaming_hall",
    "spyder_candy_hospital3",
    "spyder_dryadsgrove",
    "water_end_of_desert",
    "spyder_paper_manor",
)


@dataclass(frozen=True)
class Region:
    enter: frozenset[str]
    exits: frozenset[str]
    endure: tuple[str, ...]
    key: str | None


def properties(node: ET.Element) -> dict[str, str]:
    root = node.find("properties")
    if root is None:
        return {}
    return {prop.attrib["name"]: prop.get("value", prop.text or "") for prop in root.findall("property")}


def directions(raw: str | None) -> tuple[str, ...]:
    if not raw or not raw.strip():
        return ()
    found = {item.strip().lower() for item in raw.split(",")}
    if not found <= set(DIRS):
        raise ValueError(f"unknown directions {sorted(found - set(DIRS))}")
    return tuple(direction for direction in DIRS if direction in found)


def region_from(props: dict[str, str]) -> Region | None:
    if not REGION_KEYS.intersection(props):
        return None
    key = props.get("key", "").strip().lower() or None
    if key == "slide":
        return Region(frozenset(DIRS), frozenset(DIRS), DIRS, key)
    enter = directions(props.get("enter_from"))
    exits = directions(props.get("exit_from"))
    if exits and not enter and not props.get("enter_from", "").strip():
        enter = tuple(direction for direction in DIRS if direction not in exits)
    return Region(frozenset(enter), frozenset(exits), directions(props.get("endure")), key)


def decode_layer(node: ET.Element, expected: int) -> list[int]:
    data = node.find("data")
    if data is None:
        raise ValueError("missing layer data")
    if data.get("encoding") == "base64":
        raw = base64.b64decode("".join((data.text or "").split()))
        if data.get("compression") == "zlib":
            raw = zlib.decompress(raw)
        elif data.get("compression") == "gzip":
            raw = gzip.decompress(raw)
        elif data.get("compression"):
            raise ValueError(f"unsupported compression {data.get('compression')}")
        values = list(struct.unpack("<" + "I" * (len(raw) // 4), raw))
    elif data.get("encoding") == "csv":
        values = [int(item) for item in (data.text or "").replace("\n", "").split(",") if item.strip()]
    elif data.get("encoding") is None:
        values = [int(tile.get("gid", 0)) for tile in data.findall("tile")]
    else:
        raise ValueError(f"unsupported encoding {data.get('encoding')}")
    if len(values) != expected:
        raise ValueError(f"layer has {len(values)} cells, expected {expected}")
    return values


def tilesets(root: ET.Element, maps_dir: str) -> list[tuple[int, dict[int, dict[str, str]]]]:
    out = []
    for node in root.findall("tileset"):
        first_gid = int(node.attrib["firstgid"])
        if node.get("source"):
            path = os.path.normpath(os.path.join(maps_dir, node.attrib["source"]))
            tile_root = ET.parse(path).getroot()
        else:
            tile_root = node
        out.append((first_gid, {int(tile.attrib["id"]): properties(tile) for tile in tile_root.findall("tile")}))
    return sorted(out)


def python_grid(value: float) -> int:
    return int(round(value / TILE))


def points(raw: str) -> list[tuple[float, float]]:
    return [tuple(map(float, item.split(","))) for item in raw.strip().split()]  # type: ignore[return-value]


def load_oracle(source_root: str, map_id: str):
    maps_dir = os.path.join(source_root, "mods", "tuxemon", "maps")
    root = ET.parse(os.path.join(maps_dir, map_id + ".tmx")).getroot()
    width, height = int(root.attrib["width"]), int(root.attrib["height"])
    sets = tilesets(root, maps_dir)

    def tile_props(gid: int) -> dict[str, str]:
        for first_gid, by_id in reversed(sets):
            if gid >= first_gid:
                return by_id.get(gid - first_gid, {})
        raise ValueError(f"unresolved gid {gid}")

    static: list[Region | None | Ellipsis] = [Ellipsis] * (width * height)
    surfaces: list[dict[str, str] | None] = [None] * (width * height)
    for layer in root.findall("layer"):
        if layer.get("visible", "1") == "0":
            continue
        for index, raw in enumerate(decode_layer(layer, width * height)):
            gid = raw & GID_MASK
            if not gid:
                continue
            props = tile_props(gid)
            surface = {key: props[key] for key in SURFACE_KEYS if key in props}
            if surface:
                surfaces[index] = surface
            region = region_from(props)
            if region is not None:
                static[index] = region
    cells: list[Region | None | Ellipsis] = [
        None if surface and any(float(value) == 0 for value in surface.values()) else Ellipsis
        for surface in surfaces
    ]
    for index, region in enumerate(static):
        if region is not Ellipsis:
            cells[index] = region

    masks = bytearray(width * height)
    line_edges = 0
    for group in root.findall("objectgroup"):
        for obj in group.findall("object"):
            if not obj.get("type", "").lower().startswith("collision"):
                continue
            polyline = obj.find("polyline")
            if polyline is not None:
                ox, oy = float(obj.get("x", 0)), float(obj.get("y", 0))
                line = [(python_grid(x + ox), python_grid(y + oy)) for x, y in points(polyline.attrib["points"])]
                for start, end in zip(line, line[1:]):
                    x0, y0 = start
                    x1, y1 = end
                    if (x0, y0) > (x1, y1):
                        x0, y0, x1, y1 = x1, y1, x0, y0
                    if x0 == x1:
                        for y in range(y0, y1):
                            if 0 <= x0 < width and 0 <= y < height:
                                masks[y * width + x0] |= BITS["left"]
                            if 0 <= x0 - 1 < width and 0 <= y < height:
                                masks[y * width + x0 - 1] |= BITS["right"]
                            line_edges += 1
                    elif y0 == y1:
                        for x in range(x0, x1):
                            if 0 <= x < width and 0 <= y0 < height:
                                masks[y0 * width + x] |= BITS["up"]
                            if 0 <= x < width and 0 <= y0 - 1 < height:
                                masks[(y0 - 1) * width + x] |= BITS["down"]
                            line_edges += 1
                    else:
                        raise ValueError(f"{map_id}: diagonal collision line")
                continue
            polygon = obj.find("polygon")
            if obj.get("width") is not None or obj.get("height") is not None:
                object_width, object_height = float(obj.get("width", 0)), float(obj.get("height", 0))
            elif polygon is not None:
                polygon_points = points(polygon.attrib["points"])
                object_width = max(x for x, _ in polygon_points) - min(x for x, _ in polygon_points)
                object_height = max(y for _, y in polygon_points) - min(y for _, y in polygon_points)
            else:
                object_width = object_height = 0
            left = python_grid(float(obj.get("x", 0)))
            top = python_grid(float(obj.get("y", 0)))
            right = python_grid(float(obj.get("x", 0)) + object_width)
            bottom = python_grid(float(obj.get("y", 0)) + object_height)
            region = region_from(properties(obj))
            for y in range(top, bottom):
                for x in range(left, right):
                    if 0 <= x < width and 0 <= y < height:
                        cells[y * width + x] = region
    yaml_cells = 0
    yaml_path = os.path.join(maps_dir, map_id + ".yaml")
    if os.path.exists(yaml_path):
        with open(yaml_path, encoding="utf-8") as handle:
            document = yaml.safe_load(handle) or {}
        for collision in document.get("collisions", []):
            x0, y0 = int(collision.get("x", 0)), int(collision.get("y", 0))
            object_width = int(collision.get("width", 1))
            object_height = int(collision.get("height", 1))
            for y in range(y0, y0 + object_height):
                for x in range(x0, x0 + object_width):
                    if 0 <= x < width and 0 <= y < height:
                        cells[y * width + x] = None
                        yaml_cells += 1
    return width, height, cells, masks, line_edges, yaml_cells


def tux_step(cells, masks, width: int, height: int, x: int, y: int, direction: str) -> bool:
    nx, ny = x + DX[direction], y + DY[direction]
    if nx < 0 or ny < 0 or nx >= width or ny >= height:
        return False
    source_index, target_index = y * width + x, ny * width + nx
    source = cells[source_index]
    if isinstance(source, Region):
        exits = set(source.exits)
        if len(source.endure) == 1:
            exits.add(source.endure[0])
        elif len(source.endure) > 1:
            exits.add(direction)
        if exits and direction not in exits:
            return False
    if masks[source_index] & BITS[direction]:
        return False
    target = cells[target_index]
    if target is Ellipsis:
        return True
    if target is None:
        return False
    return OPPOSITE[direction] in target.enter


def verify_map(source_root: str, patch: dict, sheet: dict) -> dict[str, int]:
    map_id = patch["id"]
    width, height, cells, source_masks, line_edges, yaml_cells = load_oracle(source_root, map_id)
    if (width, height) != (patch["width"], patch["height"]):
        raise ValueError(f"{map_id}: dimensions differ")
    blocked = {index for index, flag in patch["passage"] if flag == "block"}
    dynamic = {index for values in patch["collisionLabels"].values() for index in values}
    cells_by_index = [tile.rsplit(".", 1)[1] for tile in patch["ground"]]
    dir_blocks = sheet.get("dirBlock", {})
    dir_edges = sheet.get("dirEdges", {})

    def mask(directions: list[str] | None) -> int:
        return sum(BITS[direction] for direction in directions or [])

    imported_blocks = [mask(dir_blocks.get(cell)) for cell in cells_by_index]
    imported_entries = [mask(dir_edges.get(cell, {}).get("enter")) for cell in cells_by_index]
    imported_exits = [mask(dir_edges.get(cell, {}).get("exit")) for cell in cells_by_index]

    def kit_step(x: int, y: int, direction: str) -> bool:
        nx, ny = x + DX[direction], y + DY[direction]
        if nx < 0 or ny < 0 or nx >= width or ny >= height:
            return False
        source, target = y * width + x, ny * width + nx
        return not (
            (imported_blocks[source] | imported_exits[source]) & BITS[direction]
            or target in blocked
            or target in dynamic
            or (imported_blocks[target] | imported_entries[target]) & BITS[OPPOSITE[direction]]
        )

    compared = 0
    mismatches = 0
    for y in range(height):
        for x in range(width):
            source = y * width + x
            if source in blocked or source in dynamic:
                continue
            for direction in DIRS:
                compared += 1
                if tux_step(cells, source_masks, width, height, x, y, direction) != kit_step(x, y, direction):
                    mismatches += 1
    return {
        "width": width,
        "height": height,
        "comparedDirectedSteps": compared,
        "mismatches": mismatches,
        "blockedCells": len(blocked),
        "dynamicLabelCells": len(dynamic),
        "collisionLineEdges": line_edges,
        "yamlCollisionCells": yaml_cells,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("map_ids", nargs="*", default=DEFAULT_MAPS)
    parser.add_argument("--src", default=os.environ.get("TUXEMON_SRC", str(Path(__file__).resolve().parents[1] / ".tuxemon-src")))
    parser.add_argument("--terrain", default="data/terrain.json")
    parser.add_argument("--out", default="reports/G5-collision-report.json")
    parser.add_argument("--all", action="store_true", help="verify every map in the terrain fragment")
    args = parser.parse_args()
    terrain = json.load(open(args.terrain, encoding="utf-8"))
    patches = {entry["id"]: entry for entry in terrain["maps"]}
    map_ids = sorted(patches) if args.all else args.map_ids
    report = {map_id: verify_map(args.src, patches[map_id], terrain["sheet"]) for map_id in map_ids}
    totals = {
        "maps": len(report),
        "comparedDirectedSteps": sum(item["comparedDirectedSteps"] for item in report.values()),
        "mismatches": sum(item["mismatches"] for item in report.values()),
    }
    output = {
        "format": "g5-collision-verification/v1",
        "oracle": "raw TMX/TSX port of Tuxemon loader.py + movement.py semantics",
        "maps": report,
        "totals": totals,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(output, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(totals, sort_keys=True))
    if totals["mismatches"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
