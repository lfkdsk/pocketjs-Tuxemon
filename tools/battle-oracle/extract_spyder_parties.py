"""Derive every distinct Spyder trainer (opponent, party) definition.

This intentionally mirrors Tuxemon's map loader ordering. It reads TMX event
properties, same-name YAML event files, the Spyder scenario YAML, and YAML
files pulled in through ``load_yaml``. No generated game data is hand edited.

Usage:
    python tools/battle-oracle/extract_spyder_parties.py OUT.json
"""

from __future__ import annotations

import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import yaml

TUXEMON_SRC = Path(
    os.environ.get(
        "TUXEMON_SRC", Path(__file__).resolve().parents[2] / ".tuxemon-src"
    )
)
MAPS = TUXEMON_SRC / "mods" / "tuxemon" / "maps"


def natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value)]


def split_escaped(value: str, delimiter: str = ",") -> list[str]:
    if not value.strip():
        return []
    return [
        part.replace(f"\\{delimiter}", delimiter).strip()
        for part in re.split(rf"(?<!\\){delimiter}", value)
    ]


def parse_action(value: str) -> tuple[str, list[str]]:
    words = value.split(" ", 1)
    return words[0], split_escaped(words[1]) if len(words) > 1 else []


def map_properties(path: Path) -> dict[str, str]:
    root = ET.parse(path).getroot()
    properties = root.find("properties")
    if properties is None:
        return {}
    return {
        item.get("name", ""): item.get("value", item.text or "")
        for item in properties.findall("property")
    }


def tmx_events(path: Path) -> list[dict]:
    root = ET.parse(path).getroot()
    result = []
    for group in root.iter("objectgroup"):
        for item in group.findall("object"):
            if (item.get("type") or item.get("class")) not in ("event", "init"):
                continue
            properties = item.find("properties")
            raw = {} if properties is None else {
                prop.get("name", ""): prop.get("value", prop.text or "")
                for prop in properties.findall("property")
            }
            actions = [value for key, value in sorted(raw.items(), key=lambda pair: natural_key(pair[0])) if key.startswith("act")]
            result.append({"name": item.get("name", ""), "actions": actions})
    return result


def yaml_events(path: Path) -> list[dict]:
    values = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return [
        {"name": name, "actions": list(event.get("actions") or [])}
        for name, event in (values.get("events") or {}).items()
    ]


def scenario_maps() -> list[Path]:
    return [
        path
        for path in sorted(MAPS.glob("*.tmx"))
        if map_properties(path).get("scenario") == "spyder"
    ]


def tagged_events() -> list[dict]:
    events: list[dict] = []
    for path in scenario_maps():
        current = tmx_events(path)
        yaml_path = path.with_suffix(".yaml")
        if yaml_path.exists():
            current += yaml_events(yaml_path)
        events += [{**event, "map": path.stem} for event in current]
    scenario = MAPS / "spyder.yaml"
    events += [{**event, "map": "spyder.yaml(scenario)"} for event in yaml_events(scenario)]
    extras = sorted({
        args[0]
        for event in events
        for action, args in map(parse_action, event["actions"])
        if action == "load_yaml" and args
    })
    for name in extras:
        path = MAPS / f"{name}.yaml"
        if path.exists():
            events += [{**event, "map": f"{name}.yaml(load_yaml)"} for event in yaml_events(path)]
    for event in events:
        event["parsed_actions"] = [parse_action(action) for action in event["actions"]]
    return events


def argument(values: list[str], index: int, default=None):
    return values[index] if len(values) > index and values[index] != "" else default


def main(output: str) -> None:
    events = tagged_events()
    environments: defaultdict[str, set[str]] = defaultdict(set)
    for event in events:
        for action, args in event["parsed_actions"]:
            if action == "set_environment" and args:
                environments[event["map"]].add(args[0])
    definitions: dict[tuple[str, tuple[tuple[str, int, str | None, str | None], ...]], dict] = {}
    for event in events:
        previous: defaultdict[str, int] = defaultdict(lambda: -1)
        actions = event["parsed_actions"]
        for index, (action, args) in enumerate(actions):
            if action not in ("start_battle", "start_double_battle"):
                continue
            characters = [argument(args, 0), argument(args, 1, "player")]
            for opponent in (value for value in characters if value not in (None, "", "player")):
                party = []
                for prior_action, prior_args in actions[previous[opponent] + 1:index]:
                    if prior_action == "add_monster" and argument(prior_args, 2) == opponent:
                        party.append((
                            prior_args[0],
                            int(prior_args[1]),
                            argument(prior_args, 3),
                            argument(prior_args, 4),
                        ))
                if not party:
                    for other in events:
                        if other is event or other["map"] != event["map"]:
                            continue
                        for prior_action, prior_args in other["parsed_actions"]:
                            if prior_action == "add_monster" and argument(prior_args, 2) == opponent:
                                party.append((
                                    prior_args[0],
                                    int(prior_args[1]),
                                    argument(prior_args, 3),
                                    argument(prior_args, 4),
                                ))
                if not party:
                    raise RuntimeError(f"no party for {opponent} at {event['map']}::{event['name']}")
                previous[opponent] = index
                key = (opponent, tuple(party))
                location = f"{event['map']}::{event['name']}"
                if key not in definitions:
                    definitions[key] = {
                        "opponent": opponent,
                        "party": [
                            {
                                "slug": slug,
                                "level": level,
                                "experienceModifier": float(exp or 1),
                                "moneyModifier": float(money or 0),
                            }
                            for slug, level, exp, money in party
                        ],
                        "fieldSize": 2 if action == "start_double_battle" else 1,
                        "inside": "interior" in environments[event["map"]],
                        "where": [location],
                    }
                else:
                    definitions[key]["where"].append(location)
                    if action == "start_double_battle":
                        definitions[key]["fieldSize"] = 2

    payload = {
        "version": 1,
        "scenario": "spyder",
        "definitions": list(definitions.values()),
    }
    Path(output).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "definitions": len(definitions),
        "double": sum(item["fieldSize"] == 2 for item in definitions.values()),
    }, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: extract_spyder_parties.py OUT.json")
    main(sys.argv[1])
