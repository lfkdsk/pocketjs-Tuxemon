"""Generate Monster.spawn_base goldens from the pinned Tuxemon engine.

The committed fixture covers every imported Spyder trainer party at three RNG
seeds plus deterministic samples from the imported wild encounter tables.
"""

from __future__ import annotations

import gzip
import json
import os
import sys
from pathlib import Path
from typing import Any

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")

SCRIPT_DIR = Path(__file__).resolve().parent
ORIGINAL_CWD = Path.cwd()
sys.path.insert(0, str(SCRIPT_DIR))

from boot import RNG  # noqa: E402
from tuxemon.monster.monster import Monster  # noqa: E402

STAT_NAMES = ("armour", "dodge", "hp", "melee", "ranged", "speed")
SEEDS = (1, 0x12345678, 0xFFFFFFFF)


def dump_monster(monster: Monster) -> dict[str, Any]:
    return {
        "slug": monster.slug,
        "level": monster.level,
        "stage": monster.stage.value,
        "gender": monster.gender.value,
        "tasteCold": monster.taste_cold,
        "tasteWarm": monster.taste_warm,
        "height": monster.height,
        "weight": monster.weight,
        "individualValues": monster.individual_values.to_dict(),
        "birthdate": list(monster.birthdate),
        "base": {name: getattr(monster, name) for name in STAT_NAMES},
        "currentHp": monster.current_hp,
        "moves": [move.slug for move in monster.moves.get_moves()],
        "types": [
            value.slug if hasattr(value, "slug") else str(value)
            for value in monster.types.current
        ],
        "totalExperience": monster.total_experience,
        "experienceModifier": monster.experience_modifier,
        "moneyModifier": monster.money_modifier,
        "bond": monster.bond_handler.bond,
        "trainingPoints": {
            name: getattr(monster.training_points, name) for name in STAT_NAMES
        },
        "status": None,
    }


def spawn_case(case_id: str, seed: int, specs: list[dict[str, Any]]) -> dict[str, Any]:
    RNG.seed(seed)
    expected = []
    for spec in specs:
        monster = Monster.spawn_base(spec["slug"], spec["level"])
        monster.set_experience_modifier(spec.get("experienceModifier", 1))
        monster.money_modifier = spec.get("moneyModifier", 0)
        expected.append(dump_monster(monster))
    return {
        "id": case_id,
        "seed": seed,
        "monsters": specs,
        "expected": expected,
        "rng": {"cursor": RNG.a, "draws": RNG.draws},
    }


def trainer_specs(definition: dict[str, Any], seed: int) -> list[dict[str, Any]]:
    specs = []
    for member in definition["party"]:
        species = member["species"]
        # Variable-backed choices are resolved outside Monster.spawn_base and
        # therefore do not consume this RNG stream.
        slug = species[(seed - 1) % len(species)]
        specs.append(
            {
                "slug": slug,
                "level": member["level"],
                "experienceModifier": member["experienceModifier"],
                "moneyModifier": member["moneyModifier"],
            }
        )
    return specs


def wild_samples(database: dict[str, Any], limit: int = 12) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    seen: set[str] = set()
    for encounter_slug in sorted(database["encounters"]):
        for row in database["encounters"][encounter_slug]["monsters"]:
            slug = row["monster"]
            if slug in seen:
                continue
            seen.add(slug)
            low, high = row["level"]
            samples.append(
                {
                    "encounter": encounter_slug,
                    "slug": slug,
                    "level": (low + high) // 2,
                    "experienceModifier": row["experienceModifier"],
                    "moneyModifier": 0,
                }
            )
            if len(samples) == limit:
                return samples
    return samples


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate_spawn.py BATTLE_DB.json OUT.json.gz")
    database_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not database_path.is_absolute():
        database_path = (ORIGINAL_CWD / database_path).resolve()
    if not output_path.is_absolute():
        output_path = (ORIGINAL_CWD / output_path).resolve()
    database = json.loads(database_path.read_text())
    cases = []
    for definition in database["trainerParties"]:
        for seed in SEEDS:
            cases.append(
                spawn_case(
                    f"trainer:{definition['id']}:{seed:08x}",
                    seed,
                    trainer_specs(definition, seed),
                )
            )

    wild = wild_samples(database)
    for sample in wild:
        for seed in SEEDS:
            spec = {key: value for key, value in sample.items() if key != "encounter"}
            cases.append(
                spawn_case(
                    f"wild:{sample['encounter']}:{sample['slug']}:{seed:08x}",
                    seed,
                    [spec],
                )
            )

    payload = {
        "header": {
            "version": 1,
            "source": f"Tuxemon {database['sourceRevision'][:8]}",
            "trainerDefinitions": len(database["trainerParties"]),
            "wildSpecies": len(wild),
            "seeds": list(SEEDS),
            "cases": len(cases),
            "drawsPerMonster": 13,
        },
        "cases": cases,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode()
    with output_path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
            stream.write(encoded)
    print(
        json.dumps(
            {
                "cases": len(cases),
                "monsters": sum(len(case["monsters"]) for case in cases),
                "draws": sum(case["rng"]["draws"] for case in cases),
                "output": str(output_path),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
