#!/usr/bin/env python3
"""Render independent TMX ground/upper references for G5 verification.

This intentionally does not call the TypeScript importer.  It reads TMX/TSX
with ElementTree and source PNGs with Pillow, applies the pytmx layer-index
rule and Tiled flips, and bakes every animation at its first declared frame.

Usage:
  python tools/terrain-reference.py --out DIR MAP_ID [MAP_ID ...]
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
import zlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np
from PIL import Image


TILE = 16
FLIP_H = 0x80000000
FLIP_V = 0x40000000
FLIP_D = 0x20000000
GID_MASK = 0x1FFFFFFF
LAYER_TAGS = {"layer", "objectgroup", "imagelayer", "group"}


@dataclass
class Tileset:
    first_gid: int
    columns: int
    margin: int
    spacing: int
    image: np.ndarray
    animations: dict[int, list[tuple[int, int]]]

    def cell(self, tile_id: int) -> np.ndarray:
        x = self.margin + (tile_id % self.columns) * (TILE + self.spacing)
        y = self.margin + (tile_id // self.columns) * (TILE + self.spacing)
        out = self.image[y : y + TILE, x : x + TILE]
        if out.shape != (TILE, TILE, 4):
            return np.zeros((TILE, TILE, 4), dtype=np.uint8)
        return out


def load_tileset(node: ET.Element, map_dir: str) -> Tileset:
    first_gid = int(node.attrib["firstgid"])
    source = node.get("source")
    if source:
        path = os.path.normpath(os.path.join(map_dir, source))
        root = ET.parse(path).getroot()
        base_dir = os.path.dirname(path)
    else:
        root = node
        base_dir = map_dir
    if int(root.attrib["tilewidth"]) != TILE or int(root.attrib["tileheight"]) != TILE:
        raise ValueError(f"non-16px tileset {root.get('name')}")
    image_node = root.find("image")
    if image_node is None:
        raise ValueError(f"tileset {root.get('name')} has no image")
    image_path = os.path.normpath(os.path.join(base_dir, image_node.attrib["source"]))
    image = np.asarray(Image.open(image_path).convert("RGBA"), dtype=np.uint8)
    spacing = int(root.get("spacing", 0))
    margin = int(root.get("margin", 0))
    columns = int(root.get("columns", 0))
    if not columns:
        columns = (image.shape[1] - 2 * margin + spacing) // (TILE + spacing)
    animations: dict[int, list[tuple[int, int]]] = {}
    for tile in root.findall("tile"):
        animation = tile.find("animation")
        if animation is not None:
            animations[int(tile.attrib["id"])] = [
                (int(frame.attrib["tileid"]), int(frame.attrib["duration"]))
                for frame in animation.findall("frame")
            ]
    return Tileset(first_gid, columns, margin, spacing, image, animations)


def decode_layer(node: ET.Element, width: int, height: int) -> np.ndarray:
    data = node.find("data")
    if data is None:
        raise ValueError(f"layer {node.get('name')} has no data")
    encoding = data.get("encoding")
    if encoding == "base64":
        raw = base64.b64decode("".join((data.text or "").split()))
        compression = data.get("compression")
        if compression == "zlib":
            raw = zlib.decompress(raw)
        elif compression == "gzip":
            raw = gzip.decompress(raw)
        elif compression:
            raise ValueError(f"unsupported TMX compression {compression}")
        values = np.frombuffer(raw, dtype="<u4")
    elif encoding == "csv":
        values = np.asarray(
            [int(value) for value in (data.text or "").replace("\n", "").split(",") if value.strip()],
            dtype=np.uint32,
        )
    elif encoding is None:
        values = np.asarray([int(tile.get("gid", 0)) for tile in data.findall("tile")], dtype=np.uint32)
    else:
        raise ValueError(f"unsupported TMX encoding {encoding}")
    if values.size != width * height:
        raise ValueError(f"layer has {values.size} cells, expected {width * height}")
    return values.reshape((height, width))


def transformed(cell: np.ndarray, flags: int) -> np.ndarray:
    out = cell
    if flags & FLIP_D:
        out = np.transpose(out, (1, 0, 2))
    if flags & FLIP_H:
        out = out[:, ::-1]
    if flags & FLIP_V:
        out = out[::-1, :]
    return np.ascontiguousarray(out)


def over(dst: np.ndarray, src: np.ndarray) -> np.ndarray:
    """Straight-alpha Porter-Duff over matching RPG Kit's blitTile."""
    source_alpha = src[..., 3:4].astype(np.float64) / 255.0
    dest_alpha = dst[..., 3:4].astype(np.float64) / 255.0
    output_alpha = source_alpha + dest_alpha * (1.0 - source_alpha)
    rgb = (
        src[..., :3].astype(np.float64) * source_alpha
        + dst[..., :3].astype(np.float64) * dest_alpha * (1.0 - source_alpha)
    ) / np.maximum(output_alpha, 1e-12)
    out = np.empty_like(dst)
    out[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    out[..., 3:4] = np.clip(np.rint(output_alpha * 255.0), 0, 255).astype(np.uint8)
    return out


def render_map(source_root: str, map_id: str) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    maps_dir = os.path.join(source_root, "mods", "tuxemon", "maps")
    path = os.path.join(maps_dir, map_id + ".tmx")
    root = ET.parse(path).getroot()
    width, height = int(root.attrib["width"]), int(root.attrib["height"])
    if int(root.attrib["tilewidth"]) != TILE or int(root.attrib["tileheight"]) != TILE:
        raise ValueError(f"{map_id}: non-16px map")
    tilesets = sorted((load_tileset(node, maps_dir) for node in root.findall("tileset")), key=lambda item: item.first_gid)

    def resolve(gid: int) -> tuple[Tileset, int]:
        for tileset in reversed(tilesets):
            if gid >= tileset.first_gid:
                return tileset, gid - tileset.first_gid
        raise ValueError(f"{map_id}: unresolved gid {gid}")

    ground = np.zeros((height * TILE, width * TILE, 4), dtype=np.uint8)
    upper = np.zeros_like(ground)
    animations = 0
    flips = 0
    layers = 0
    index = 0
    for node in root:
        if node.tag not in LAYER_TAGS:
            continue
        if node.tag == "layer":
            layers += 1
            if node.get("visible", "1") != "0":
                opacity = float(node.get("opacity", 1))
                target = upper if index > 2 else ground
                cells = decode_layer(node, width, height)
                for y, x in zip(*np.nonzero(cells)):
                    raw = int(cells[y, x])
                    gid, flags = raw & GID_MASK, raw & ~GID_MASK
                    tileset, tile_id = resolve(gid)
                    animation = tileset.animations.get(tile_id)
                    if animation:
                        animations += 1
                        tile_id = animation[0][0]
                    art = transformed(tileset.cell(tile_id), flags)
                    if flags and art[..., 3].any():
                        flips += 1
                    if opacity != 1:
                        art = art.copy()
                        art[..., 3] = (art[..., 3].astype(np.float64) * opacity).astype(np.uint8)
                    ys = slice(y * TILE, (y + 1) * TILE)
                    xs = slice(x * TILE, (x + 1) * TILE)
                    target[ys, xs] = over(target[ys, xs], art)
        index += 1
    return ground, upper, {
        "width": width,
        "height": height,
        "layers": layers,
        "animatedCells": animations,
        "visibleFlipCells": flips,
    }


def digest(image: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(image).tobytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("map_ids", nargs="+")
    parser.add_argument("--out", required=True)
    parser.add_argument("--src", default=os.environ.get("TUXEMON_SRC", "/var/tmp/tuxemon-src"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    report: dict[str, dict[str, int | str]] = {}
    for map_id in sorted(set(args.map_ids)):
        ground, upper, meta = render_map(args.src, map_id)
        full = over(ground, upper)
        for name, image in (("ground", ground), ("upper", upper), ("full", full)):
            Image.fromarray(image).save(os.path.join(args.out, f"{map_id}-{name}.png"))
            meta[name + "Sha256"] = digest(image)
        report[map_id] = meta
        print(f"{map_id}: {meta['width']}x{meta['height']} anim={meta['animatedCells']} flip={meta['visibleFlipCells']}")
    with open(os.path.join(args.out, "reference-report.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
