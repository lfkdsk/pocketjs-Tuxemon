"""Generate the focused GB3 double-battle oracle from real Tuxemon combat.

The Spyder campaign contains eight ``start_double_battle`` event uses which
collapse to five distinct opponent/party definitions.  Reuse the full battle
oracle runner, but keep only those definitions so target selection, two active
slots, replacement, and spread damage have an explicit acceptance fixture.

Usage:
    python generate_gb3_double.py MANIFEST.json OUT.ndjson.gz [seeds]
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

CALLER_CWD = Path.cwd()

# Importing boot through generate_spyder intentionally changes cwd to the
# pinned Tuxemon source, so capture the caller's repository first.
from generate_spyder import run  # noqa: E402


def main(manifest_path: str, output_path: str, seed_count: int) -> None:
    manifest_file = Path(manifest_path)
    output_file = Path(output_path)
    if not manifest_file.is_absolute():
        manifest_file = (CALLER_CWD / manifest_file).resolve()
    if not output_file.is_absolute():
        output_file = (CALLER_CWD / output_file).resolve()

    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    definitions = [
        (index, definition)
        for index, definition in enumerate(manifest["definitions"])
        if definition["fieldSize"] == 2
    ]
    locations = sorted(
        location
        for _, definition in definitions
        for location in definition["where"]
    )
    policies = ("first", "cycle")
    case_count = len(definitions) * seed_count * len(policies)
    header = {
        "version": 1,
        "suite": "gb3-double",
        "source": "Tuxemon 9e6258ff",
        "definitions": len(definitions),
        "events": len(locations),
        "locations": locations,
        "seedsPerDefinition": seed_count,
        "policies": list(policies),
        "cases": case_count,
        "exemptions": ["stable-active-field-multitarget-order"],
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    completed = 0
    with output_file.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
            stream.write((json.dumps(header, sort_keys=True, separators=(",", ":")) + "\n").encode())
            for original_index, definition in definitions:
                for seed in range(1, seed_count + 1):
                    for policy in policies:
                        case = run(definition, original_index, seed, policy)
                        stream.write((json.dumps(case, sort_keys=True, separators=(",", ":")) + "\n").encode())
                        completed += 1

    print(json.dumps({
        "definitions": len(definitions),
        "events": len(locations),
        "cases": completed,
        "output": str(output_file),
    }, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: generate_gb3_double.py MANIFEST.json OUT.ndjson.gz [seeds]")
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) == 4 else 20)
