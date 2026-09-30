"""Generate deterministic GB3 progression vectors with Tuxemon as oracle.

The corpus covers the complete reward pipeline (defeated-monster XP,
acquisition multiplier, participant split, and winner XP modifier), level
boundaries, stat/HP growth, scheduled moves and a deterministic move-forget
choice, plus every evolution row currently emitted by the battle importer.

Usage:
    python generate_gb3_progression.py BATTLE_DB.json OUT.json.gz
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
CALLER_CWD = Path.cwd()
sys.path.insert(0, str(SCRIPT_DIR))

import boot  # noqa: E402
from boot import RNG  # noqa: E402

from tuxemon.combat.reward_system import RewardCalculator  # noqa: E402
from tuxemon.db import Acquisition, GenderType, MonsterModel  # noqa: E402
from tuxemon.monster.evolution_registry import EvolutionRegistry  # noqa: E402
from tuxemon.monster.monster import Monster  # noqa: E402
from tuxemon.status.status import Status  # noqa: E402


STAT_NAMES = ("armour", "dodge", "hp", "melee", "ranged", "speed")
ACQUISITIONS = tuple(member.value for member in Acquisition)
DEFAULT_FORGET_INDEX = 0


class FakeVariableManager:
    def __init__(self, values: dict[str, object] | None = None) -> None:
        self.values = values or {}

    def check_conditions(self, conditions: list[object]) -> bool:
        return all(
            str(self.values.get(getattr(condition, "key")))
            == str(getattr(condition, "value"))
            for condition in conditions
        )


class FakeParty:
    def __init__(self, owner: FakeOwner) -> None:
        self.owner = owner
        self.techs: set[str] = set()

    @property
    def monsters(self) -> list[Monster]:
        return self.owner.monsters

    @property
    def alive(self) -> list[Monster]:
        return [monster for monster in self.monsters if not monster.is_fainted]

    def has_tech(self, slug: str) -> bool:
        return slug in self.techs or any(
            move.slug == slug
            for monster in self.monsters
            for move in monster.moves.get_moves()
        )

    def replace_monster(self, old_monster: Monster, new_monster: Monster) -> bool:
        if old_monster not in self.owner.monsters:
            return False
        index = self.owner.monsters.index(old_monster)
        old_monster.set_owner(None)
        self.owner.monsters[index] = new_monster
        new_monster.set_owner(self.owner)
        return True


class FakeTuxepedia:
    def __init__(self) -> None:
        self.caught: list[str] = []

    def is_caught(self, slug: str) -> bool:
        return slug in self.caught

    def register_caught(self, slug: str) -> None:
        if slug not in self.caught:
            self.caught.append(slug)


class FakeOwner:
    def __init__(
        self,
        monsters: list[Monster],
        variables: dict[str, object] | None = None,
    ) -> None:
        self.monsters = monsters
        self.variable_manager = FakeVariableManager(variables)
        self.evolution_registry = EvolutionRegistry()
        self.tuxepedia = FakeTuxepedia()
        self.is_player = True
        self.party = FakeParty(self)
        for monster in monsters:
            monster.set_owner(self)


class FakeDamageTracker:
    def __init__(self, attackers: list[Monster]) -> None:
        self.attackers = set(attackers)

    def get_attackers(self, _loser: Monster) -> set[Monster]:
        return self.attackers


def enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def dump_stats(monster: Monster) -> dict[str, int]:
    return {
        name: int(getattr(monster.base_stats, name)) for name in STAT_NAMES
    }


def dump_monster(monster: Monster) -> dict[str, Any]:
    status = monster.status.current_status
    return {
        "slug": monster.slug,
        "level": monster.level,
        "stage": enum_value(monster.stage),
        "gender": enum_value(monster.gender),
        "tasteCold": monster.taste_cold,
        "tasteWarm": monster.taste_warm,
        "height": monster.height,
        "weight": monster.weight,
        "birthdate": list(monster.birthdate or ()),
        "individualValues": monster.individual_values.to_dict(),
        "base": dump_stats(monster),
        "currentHp": monster.current_hp,
        "moves": [move.slug for move in monster.moves.get_moves()],
        "types": [element.slug for element in monster.types.current],
        "totalExperience": monster.total_experience,
        "experienceModifier": monster.experience_modifier,
        "moneyModifier": monster.money_modifier,
        "acquisition": enum_value(monster.acquisition),
        "captureDevice": monster.capture_device,
        "bond": monster.bond_handler.bond,
        "trainingPoints": {
            name: int(getattr(monster.training_points, name))
            for name in STAT_NAMES
        },
        "status": status.slug if status else None,
        "waitingToEvolve": monster.waiting_to_evolve,
    }


def forget_excess_moves(monster: Monster, index: int) -> list[str]:
    """Replay a deterministic user choice through upstream's forget API."""
    forgotten: list[str] = []
    while len(monster.moves.get_moves()) > monster.max_moves:
        moves = monster.moves.get_moves()
        selected = moves[min(index, len(moves) - 1)]
        if not monster.moves.can_forget(selected):
            selected = next(move for move in moves if monster.moves.can_forget(move))
        if not monster.moves.forget(selected):
            raise RuntimeError(f"oracle could not forget {selected.slug}")
        forgotten.append(selected.slug)
    return forgotten


def make_monster(
    slug: str,
    level: int,
    seed: int,
    *,
    total_experience: int | None = None,
    experience_modifier: float = 1.0,
    current_hp: str = "half",
) -> Monster:
    RNG.seed(seed)
    monster = Monster.spawn_base(slug, level)
    if total_experience is not None:
        monster.set_total_experience(total_experience)
    monster.set_experience_modifier(experience_modifier)
    if current_hp == "half":
        monster.current_hp = max(1, monster.hp // 2)
    elif current_hp != "full":
        raise ValueError(f"unknown HP setup {current_hp}")
    return monster


def progression_case(spec: dict[str, Any], index: int) -> dict[str, Any]:
    monster = make_monster(
        spec["slug"],
        spec["level"],
        0x71000000 + index,
        total_experience=spec.get("totalExperience"),
        experience_modifier=spec.get("experienceModifier", 1.0),
        current_hp=spec.get("currentHp", "half"),
    )
    variables = dict(spec.get("variables", {}))
    owner = FakeOwner([monster], variables) if spec.get("owner", False) else None
    if "gender" in spec:
        monster.gender = GenderType(spec["gender"])
    if "types" in spec:
        monster.types.set_types(spec["types"])
    if owner and "partyTech" in spec:
        owner.party.techs.add(spec["partyTech"])

    before = dump_monster(monster)
    RNG.seed(0x50524F47)
    levels = monster.give_experience(spec["amount"])
    after_gain = dump_monster(monster)
    learned = [move for move in after_gain["moves"] if move not in before["moves"]]
    eligible = monster.evolution_handler.get_eligible_evolution_slug(
        {"use_item": monster.waiting_to_evolve}
    ) if owner else None
    forgotten = forget_excess_moves(monster, DEFAULT_FORGET_INDEX)
    return {
        "id": spec["id"],
        "input": {
            key: value for key, value in spec.items() if key != "id"
        },
        "before": before,
        "expected": {
            "levelsGained": levels,
            "learnedMoves": learned,
            "afterGain": after_gain,
            "forgetIndex": DEFAULT_FORGET_INDEX,
            "forgottenMoves": forgotten,
            "afterChoice": dump_monster(monster),
            "evolutionTarget": eligible,
            "rng": {"cursor": RNG.a, "draws": RNG.draws},
        },
    }


def reward_case(
    acquisition: str,
    participants: int,
    loser_modifier: float,
    index: int,
    *,
    winner_level: int = 8,
) -> dict[str, Any]:
    RNG.seed(0x52000000 + index)
    loser = Monster.spawn_base("rockitten", 5)
    loser.set_experience_modifier(loser_modifier)
    winners = [Monster.spawn_base("cataspike", winner_level) for _ in range(participants)]
    owner = FakeOwner(winners)
    winner = winners[0]
    winner.set_acquisition(Acquisition(acquisition))
    before = dump_monster(winner)
    RNG.seed(0x52455744)
    entry = RewardCalculator(FakeDamageTracker(winners)).calculate_winner_entry(
        loser, winner
    )
    return {
        "id": f"reward:{acquisition}:{participants}:{loser_modifier:g}:L{winner_level}",
        "input": {
            "loser": dump_monster(loser),
            "winnerAcquisition": acquisition,
            "winnerExperienceModifier": winner.experience_modifier,
            "participants": participants,
        },
        "before": before,
        "expected": {
            "awardedExperience": entry.experience,
            "levelsGained": entry.levels_gained,
            "learnedMoves": entry.moves,
            "after": dump_monster(winner),
            "rng": {"cursor": RNG.a, "draws": RNG.draws},
        },
    }


def upstream_evolution(monster: Monster, target: str) -> object:
    matches = [
        evolution
        for evolution in monster.evolutions
        if evolution.monster_slug == target
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"expected one {monster.slug}->{target} evolution, got {len(matches)}"
        )
    return matches[0]


def evolution_case(
    slug: str,
    row: dict[str, Any],
    index: int,
) -> dict[str, Any]:
    level = int(row.get("at_level", 30))
    monster = make_monster(slug, level, 0x45000000 + index, current_hp="full")
    variables = {
        str(condition["key"]): condition["value"]
        for condition in row.get("variables", [])
    }
    party_members = [monster]
    party_conditions = row.get("party_conditions") or {}
    for party_slug, count in party_conditions.get("monster_slugs", {}).items():
        party_members.extend(
            Monster.spawn_base(str(party_slug), level) for _ in range(int(count))
        )
    owner = FakeOwner(party_members, variables)
    if "gender" in row:
        monster.gender = GenderType(row["gender"])
    if "element" in row:
        monster.types.set_types([row["element"]])
    if "tech" in row:
        owner.party.techs.add(str(row["tech"]))
    if "stats" in row:
        stats = row["stats"]
        stat = str(stats["stat_type"])
        target_stat = stats.get("target_stat")
        comparison = str(stats["comparison"])
        if target_stat:
            setattr(monster.base_stats, str(target_stat), 100)
            setattr(
                monster.base_stats,
                stat,
                101 if comparison == "greater_than" else 100,
            )
        else:
            target_value = int(stats["target_value"])
            setattr(
                monster.base_stats,
                stat,
                target_value + 1 if comparison == "greater_than" else target_value,
            )
    if "bond" in row:
        bond = row["bond"]
        monster.bond_handler.bond = int(bond["value"]) + (
            1 if bond["comparison"] == "greater_than" else 0
        )
    context = {
        "use_item": "item" in row,
        "map_inside": bool(row.get("inside", False)),
    }
    evolution = upstream_evolution(monster, str(row["monster_slug"]))
    RNG.seed(0x45564F4C)
    positive = monster.evolution_handler.can_evolve(evolution, context, owner)

    # Invalidate one condition while retaining all other satisfied inputs.
    negative_context = dict(context)
    if "variables" in row:
        owner.variable_manager.values.clear()
    elif "tech" in row:
        owner.party.techs.clear()
    elif "element" in row:
        monster.types.set_types(["normal"])
    elif "gender" in row:
        monster.gender = GenderType("male" if row["gender"] != "male" else "female")
    elif "inside" in row:
        negative_context["map_inside"] = not bool(row["inside"])
    elif "stats" in row:
        stats = row["stats"]
        stat = str(stats["stat_type"])
        target_stat = stats.get("target_stat")
        if target_stat:
            target_value = getattr(monster.base_stats, str(target_stat))
            setattr(
                monster.base_stats,
                stat,
                target_value + 1 if stats["comparison"] == "equals" else target_value,
            )
        else:
            setattr(monster.base_stats, stat, int(stats["target_value"]))
    elif "bond" in row:
        bond = row["bond"]
        monster.bond_handler.bond = int(bond["value"]) - (
            1 if bond["comparison"] in {"equals", "greater_or_equal"} else 0
        )
    elif "party_conditions" in row:
        owner.monsters[:] = [monster]
    elif "item" in row:
        negative_context["use_item"] = False
    elif "at_level" in row:
        monster.experience_handler.set_level(max(1, int(row["at_level"]) - 1))
    else:
        raise RuntimeError(f"evolution row has no supported condition: {slug} {row}")
    negative = monster.evolution_handler.can_evolve(
        evolution, negative_context, owner
    )
    return {
        "id": f"evolution:{slug}:{row['monster_slug']}:{index}",
        "slug": slug,
        "row": row,
        "satisfiedContext": context,
        "expected": {
            "satisfied": positive,
            "unsatisfied": negative,
            "rng": {"cursor": RNG.a, "draws": RNG.draws},
        },
    }


def applied_evolution_case(
    slug: str,
    target_slug: str,
    level: int,
    index: int,
) -> dict[str, Any]:
    """Exercise the same spawn/transfer/replace path as EvolutionState._confirm."""
    monster = make_monster(slug, level, 0x41000000 + index, current_hp="full")
    monster.set_total_experience(level**3 + 17)
    monster.set_experience_modifier(1.5)
    monster.money_modifier = 17.0
    monster.set_acquisition(Acquisition.TRADED)
    monster.capture_device = "tuxeball_ancient"
    monster.bond_handler.bond = 7
    monster.training_points.armour = 11
    monster.training_points.hp = 23
    monster.training_points.speed = 5
    monster.individual_values.armour = 1
    monster.individual_values.dodge = 2
    monster.individual_values.hp = 3
    monster.individual_values.melee = 4
    monster.individual_values.ranged = 5
    monster.individual_values.speed = 6
    monster.set_stats()
    monster.current_hp = max(1, monster.hp // 3)
    monster.status.add_status(Status.create("poison", monster))
    monster.waiting_to_evolve = True
    owner = FakeOwner([monster])
    before = dump_monster(monster)
    original_iid = monster.instance_id

    selected = monster.evolution_handler.get_eligible_evolution_slug(
        {"use_item": monster.waiting_to_evolve}
    )
    if selected != target_slug:
        raise RuntimeError(
            f"expected pending evolution {slug}->{target_slug}, got {selected}"
        )

    RNG.seed(0x4150504C + index)
    evolved = Monster.spawn_base(target_slug, monster.level)
    spawned = dump_monster(evolved)
    evolved.transfer_properties_from(monster)
    transferred = dump_monster(evolved)
    monster.evolution_handler.evolve_monster(evolved)
    monster.waiting_to_evolve = False
    actual = owner.monsters[0]
    rng_result = {"cursor": RNG.a, "draws": RNG.draws}
    # Save/reload recalculates stats after the transferred IVs and TPs land.
    # Upstream's immediate post-evolution object deliberately does not.
    reloaded = Monster.from_save(actual.get_state())
    return {
        "id": f"apply:{slug}:{target_slug}",
        "input": {
            "slug": slug,
            "target": target_slug,
            "level": level,
            "seed": 0x4150504C + index,
        },
        "before": before,
        "expected": {
            "spawned": spawned,
            "transferred": transferred,
            "after": dump_monster(actual),
            "afterReload": dump_monster(reloaded),
            "sameIdentity": actual.instance_id == original_iid,
            "caught": list(owner.tuxepedia.caught),
            "rng": rng_result,
        },
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(
            "usage: generate_gb3_progression.py BATTLE_DB.json OUT.json.gz"
        )
    database_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not database_path.is_absolute():
        database_path = (CALLER_CWD / database_path).resolve()
    if not output_path.is_absolute():
        output_path = (CALLER_CWD / output_path).resolve()
    database = json.loads(database_path.read_text())

    specs = [
        {"id": "nonpositive:zero", "slug": "nut", "level": 9, "amount": 0},
        {"id": "nonpositive:negative", "slug": "nut", "level": 9, "amount": -5},
        {"id": "boundary:below", "slug": "nut", "level": 9, "amount": 270},
        {"id": "boundary:exact-fifth-move", "slug": "nut", "level": 9, "amount": 271},
        {"id": "boundary:multi-level-multi-move", "slug": "nut", "level": 9, "amount": 1468},
        {"id": "modifier:truncated", "slug": "nut", "level": 9, "amount": 181, "experienceModifier": 1.5},
        {"id": "max-level:uncapped-total", "slug": "nut", "level": 100, "amount": 1234},
        {"id": "evolution:level", "slug": "cataspike", "level": 8, "amount": 217, "owner": True},
        {"id": "evolution:priority", "slug": "mk01_proto", "level": 9, "amount": 271, "owner": True},
        *[
            {
                "id": f"evolution:variables:{season}",
                "slug": "chromeye",
                "level": 17,
                "amount": 919,
                "owner": True,
                "variables": {"season": season},
            }
            for season in ("winter", "summer", "spring", "autumn", "missing")
        ],
        {"id": "evolution:tech", "slug": "vivipere", "level": 23, "amount": 1657, "owner": True, "partyTech": "salamander"},
        {"id": "evolution:element", "slug": "vivipere", "level": 23, "amount": 1657, "owner": True, "types": ["wood"]},
        {"id": "evolution:gender", "slug": "vivipere", "level": 23, "amount": 1657, "owner": True, "gender": "female"},
        {"id": "evolution:level-priority", "slug": "vivipere", "level": 25, "amount": 1951, "owner": True, "gender": "male"},
    ]
    progression = [progression_case(spec, index) for index, spec in enumerate(specs)]

    rewards = [
        reward_case(acquisition, participants, loser_modifier, index)
        for index, (acquisition, participants, loser_modifier) in enumerate(
            (acquisition, participants, loser_modifier)
            for acquisition in ACQUISITIONS
            for participants in (1, 2)
            for loser_modifier in (1.0, 5.0)
        )
    ]
    rewards.append(
        reward_case("traded", 1, 5.0, len(rewards), winner_level=100)
    )

    # A reachable monster may evolve into a form not directly encountered by
    # a map. Close over the upstream graph so the oracle catches a scoped
    # importer that strands starters such as nut without bolt.
    root_monsters = set(database["monsters"])
    closure_monsters = set(root_monsters)
    while True:
        before = len(closure_monsters)
        for slug in list(closure_monsters):
            model = MonsterModel.lookup(slug, boot.db)
            closure_monsters.update(row.monster_slug for row in model.evolutions)
        if len(closure_monsters) == before:
            break
    raw_evolutions = [
        (slug, row.model_dump(mode="json", exclude_none=True, exclude_defaults=True))
        for slug in sorted(closure_monsters)
        for row in MonsterModel.lookup(slug, boot.db).evolutions
    ]
    evolution_rows = [
        evolution_case(slug, row, index)
        for index, (slug, row) in enumerate(
            raw_evolutions
        )
    ]
    applied_evolutions = [
        applied_evolution_case("cataspike", "puparmor", 9, 0),
        applied_evolution_case("puparmor", "weavifly", 12, 1),
    ]
    condition_counts: dict[str, int] = {}
    for entry in evolution_rows:
        for key in entry["row"]:
            if key != "monster_slug":
                condition_counts[key] = condition_counts.get(key, 0) + 1

    payload = {
        "header": {
            "version": 2,
            "source": f"Tuxemon {database['sourceRevision'][:8]}",
            "defaultForgetIndex": DEFAULT_FORGET_INDEX,
            "acquisitions": list(ACQUISITIONS),
            "rewardCases": len(rewards),
            "progressionCases": len(progression),
            "evolutionRows": len(evolution_rows),
            "appliedEvolutionCases": len(applied_evolutions),
            "evolutionSources": len({entry["slug"] for entry in evolution_rows}),
            "rootMonsters": len(root_monsters),
            "evolutionClosureMonsters": len(closure_monsters),
            "evolutionConditionCounts": dict(sorted(condition_counts.items())),
            "exemptions": [],
        },
        "rewards": rewards,
        "progression": progression,
        "evolutions": evolution_rows,
        "appliedEvolutions": applied_evolutions,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode()
    with output_path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
            stream.write(encoded)
    print(json.dumps({
        "rewardCases": len(rewards),
        "progressionCases": len(progression),
        "evolutionRows": len(evolution_rows),
        "appliedEvolutionCases": len(applied_evolutions),
        "evolutionSources": payload["header"]["evolutionSources"],
        "output": str(output_path),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
