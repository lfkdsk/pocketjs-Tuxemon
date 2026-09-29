"""Export only the Tuxemon model fields consumed by the TypeScript reducer."""

from __future__ import annotations

import json
import sys
from pathlib import Path

CALLER_CWD = Path.cwd()
import boot  # noqa: F401
from tuxemon.database.runtime import db


def model(table: str, slug: str) -> dict:
    return json.loads(db.database[table][slug].model_dump_json())


def select(values: dict, keys: tuple[str, ...]) -> dict:
    return {key: values[key] for key in keys if key in values}


data: dict[str, dict] = {}
data["monster"] = {
    slug: select(model("monster", slug), ("slug", "shape", "types", "moveset"))
    for slug in sorted(db.database["monster"])
}
data["technique"] = {
    slug: select(
        model("technique", slug),
        (
            "slug",
            "sort",
            "range",
            "speed",
            "accuracy",
            "potency",
            "power",
            "healing_power",
            "recharge",
            "min_recharge",
            "initial_delay",
            "cooldown_multiplier",
            "types",
            "effects",
            "conditions",
            "stat_modifiers",
            "target",
        ),
    )
    for slug in sorted(db.database["technique"])
}
data["technique_speed"] = {
    slug: value.speed.numeric_value
    for slug, value in sorted(db.database["technique"].items())
}
data["element"] = {
    slug: select(model("element", slug), ("types",))
    for slug in sorted(db.database["element"])
}
data["element_order"] = list(db.database["element"])
data["taste"] = {
    slug: select(model("taste", slug), ("taste_type", "rarity_score", "modifiers"))
    for slug in sorted(db.database["taste"])
}
data["shape"] = {
    slug: select(model("shape", slug), ("attributes",))
    for slug in sorted(db.database["shape"])
}
data["status"] = {
    slug: select(
        model("status", slug),
        (
            "slug",
            "category",
            "effects",
            "conditions",
            "stat_modifiers",
            "on_positive_status",
            "on_negative_status",
            "on_tech_use",
            "on_item_use",
            "duration",
            "max_stacks",
            "bond",
            "behaviors",
            "modifiers",
        ),
    )
    for slug in sorted(db.database["status"])
}

payload = json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n"
if len(sys.argv) == 2:
    destination = Path(sys.argv[1])
    if not destination.is_absolute():
        destination = CALLER_CWD / destination
    destination.write_text(payload, encoding="utf-8")
    print(json.dumps({"output": str(destination), "bytes": len(payload.encode())}))
elif len(sys.argv) == 1:
    sys.stdout.write(payload)
else:
    raise SystemExit("usage: export_data.py [OUT.json]")
