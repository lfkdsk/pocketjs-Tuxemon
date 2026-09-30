"""Generate deterministic GB3 rule vectors with Tuxemon as the oracle.

This corpus isolates the rules that do not appear in the trainer-only GB2
trace: all 27 combat capture devices, all 25 other combat items, and the
default wild-battle escape command.  Monster construction uses the real
upstream database, but every measured rule stream is re-seeded after setup so
the recorded cursor contains only the random values consumed by that rule.

Usage:
    python generate_gb3.py OUT.json.gz
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

import pygame  # noqa: E402

from tuxemon import formula  # noqa: E402
from tuxemon.database.runtime import db  # noqa: E402
from tuxemon.database.rules import config_capdev  # noqa: E402
from tuxemon.db import GenderType, ItemModel, State  # noqa: E402
from tuxemon.item.item import Item  # noqa: E402
from tuxemon.monster.monster import Monster  # noqa: E402
from tuxemon.status.status import Status  # noqa: E402
from tuxemon.technique.technique import Technique  # noqa: E402


STAT_NAMES = ("armour", "dodge", "hp", "melee", "ranged", "speed")
CAPTURE_SEEDS = (1, 7, 0x12345678, 0xFFFFFFFF)
RUN_SEEDS = (1, 2, 3, 5, 8, 13, 0x12345678, 0xFFFFFFFF)


class Obj:
    def __init__(self, **values: Any) -> None:
        self.__dict__.update(values)


class FakeBag:
    def __init__(self, item: Item) -> None:
        self.items = [item]

    def find_item(self, slug: str) -> Item | None:
        return next((item for item in self.items if item.slug == slug), None)

    def remove_item(self, item: Item) -> None:
        self.items.remove(item)


class FakeParty:
    def __init__(self, owner: Obj) -> None:
        self.owner = owner

    def add_monster(self, monster: Monster, index: int) -> None:
        self.owner.monsters.insert(index, monster)
        monster.set_owner(self.owner)


class FakeTuxepedia:
    def __init__(self) -> None:
        self.caught: list[str] = []

    def is_seen(self, _slug: str) -> bool:
        return False

    def register_caught(self, slug: str) -> None:
        self.caught.append(slug)


class FakeVariableManager:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values

    def check_logic(self, clauses: list[dict[str, object]]) -> bool:
        return all(str(self.values.get(key)) == str(value) for clause in clauses for key, value in clause.items())


class NullEffects:
    def add_item(self, *_args: object) -> None:
        pass

    def add_status(self, *_args: object) -> None:
        pass


def enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def status_slug(monster: Monster) -> str | None:
    current = monster.status.current_status
    return current.slug if current else None


def dump_stats(monster: Monster) -> dict[str, int]:
    stats = monster.get_combat_stats()
    return {name: int(getattr(stats, name)) for name in STAT_NAMES}


def dump_target(monster: Monster) -> dict[str, Any]:
    return {
        "slug": monster.slug,
        "level": monster.level,
        "base": {name: int(getattr(monster, name)) for name in STAT_NAMES},
        "currentHp": monster.current_hp,
        "types": [element.slug for element in monster.types.current],
        "gender": enum_value(monster.gender),
        "status": status_slug(monster),
        "catchRate": monster.catch_rate,
        "catchResistance": [
            monster.lower_catch_resistance,
            monster.upper_catch_resistance,
        ],
        "tasteWarm": monster.taste_warm,
        "wild": monster.wild,
    }


def make_session(
    item_slug: str,
    *,
    target_type: str,
    player_type: str,
    gender: str,
    current_hp: str,
    status: str | None,
    variables: dict[str, str],
) -> tuple[Obj, Obj, Item, Monster]:
    # Spawn entropy is deliberately outside the measured rule stream.
    target = Monster.spawn_base("rockitten", 8)
    target.types.set_types([target_type])
    target.gender = GenderType(gender)
    target.current_hp = target.hp if current_hp == "full" else 1
    target.wild = True
    if status:
        target.status.add_status(Status.create(status, target))

    active = Monster.spawn_base("nut", 8)
    active.types.set_types([player_type])
    item = Item.create(item_slug)
    item.set_quantity(1)
    bag = FakeBag(item)
    player = Obj(
        monsters=[],
        bag=bag,
        tuxepedia=FakeTuxepedia(),
        variable_manager=FakeVariableManager(variables),
    )
    player.party = FakeParty(player)
    combat_variables: dict[str, object] = {}
    combat = Obj(
        field_monsters=Obj(get_monsters=lambda character: [active] if character is player else []),
        set_variable=lambda key, value: combat_variables.__setitem__(key, value),
    )
    session = Obj(
        player=player,
        client=Obj(combat_session=combat, active_effect_manager=NullEffects()),
    )
    return session, player, item, target


def capture_context(item_slug: str, favored: bool) -> dict[str, Any]:
    config = config_capdev.items.get(item_slug)
    target_type = "earth"
    gender = "male"
    variables = {"daytime": "false"}
    player_type = "earth"

    if config and config.specific_element_modifiers:
        matched = next(iter(config.specific_element_modifiers))
        target_type = matched if favored else "normal"
    if config and config.specific_gender_modifiers:
        matched = next(iter(config.specific_gender_modifiers))
        gender = matched if favored else ({"male": "female", "female": "neuter", "neuter": "male"}[matched])
    if config and config.specific_variables_modifiers:
        rule = config.specific_variables_modifiers[0]
        expected = str(rule["value"])
        variables[str(rule["key"])] = expected if favored else ("false" if expected == "true" else "true")
    if item_slug == "tuxeball_omni":
        player_type = target_type if favored else "water"
    elif item_slug == "tuxeball_xero":
        player_type = "water" if favored else target_type

    return {
        "targetType": target_type,
        "playerType": player_type,
        "gender": gender,
        "currentHp": "low" if favored else "full",
        "status": "grabbed" if favored else None,
        "variables": variables,
    }


def capture_formula(
    session: Obj,
    player: Obj,
    item: Item,
    target: Monster,
    seed: int,
) -> dict[str, Any]:
    RNG.seed(seed)
    status_modifier = formula.calculate_status_modifier(item, target)
    effects = item.core_assets.parse_effects(item.effect_defs)
    capture_effect = effects[0]
    if capture_effect.name == "capture_combined":
        capture_effect.session = session
        capture_effect.client = session.client
        device_modifier = capture_effect._calculate_tuxeball_modifier(target)
    else:
        device_modifier = formula.calculate_capdev_modifier(item, target, player)
    shake_check = formula.shake_check(target, status_modifier, device_modifier)
    success, shakes = formula.capture(shake_check)
    return {
        "statusModifier": status_modifier,
        "deviceModifier": device_modifier,
        "shakeCheck": shake_check,
        "success": success,
        "shakes": shakes,
        "rng": {"cursor": RNG.a, "draws": RNG.draws},
    }


def capture_case(item_slug: str, favored: bool, seed: int) -> dict[str, Any]:
    context = capture_context(item_slug, favored)
    RNG.seed(0xA11CE)
    session, player, item, target = make_session(item_slug, **{
        "target_type": context["targetType"],
        "player_type": context["playerType"],
        "gender": context["gender"],
        "current_hp": context["currentHp"],
        "status": context["status"],
        "variables": context["variables"],
    })
    before = dump_target(target)
    expected = capture_formula(session, player, item, target, seed)

    # Run the full upstream Item.use path independently. This captures stock
    # consumption/return and post-capture mutation without double-consuming
    # any values from the formula stream recorded above.
    RNG.seed(0xA11CE)
    session, player, item, target = make_session(item_slug, **{
        "target_type": context["targetType"],
        "player_type": context["playerType"],
        "gender": context["gender"],
        "current_hp": context["currentHp"],
        "status": context["status"],
        "variables": context["variables"],
    })
    RNG.seed(seed)
    error = None
    result = None
    try:
        result = item.use(session, player, target)
    except Exception as caught:  # Upstream candy ball currently writes a read-only level property.
        error = f"{type(caught).__name__}: {caught}"
    actual_rng = {"cursor": RNG.a, "draws": RNG.draws}
    if actual_rng != expected["rng"]:
        raise AssertionError(f"capture RNG mismatch for {item_slug}/{favored}/{seed}")
    if result is not None and (bool(result.success), result.num_shakes) != (expected["success"], expected["shakes"]):
        raise AssertionError(f"capture result mismatch for {item_slug}/{favored}/{seed}")
    expected.update({
        "error": error,
        "itemQuantity": item.quantity,
        "caught": list(player.tuxepedia.caught),
        "post": dump_target(target),
    })
    mode = "favored" if favored else "neutral"
    return {
        "id": f"capture:{item_slug}:{mode}:{seed:08x}",
        "seed": seed,
        "item": item_slug,
        "context": context,
        "target": before,
        "expected": expected,
    }


def item_case(item_slug: str) -> dict[str, Any]:
    model = ItemModel.lookup(item_slug, db)
    effect_types = [effect.type for effect in model.effects]
    parameters = list(model.effects[0].parameters or []) if model.effects else []
    target_type = "normal"
    if "switch_type" in effect_types:
        desired = str(parameters[0])
        target_type = "earth" if desired == "normal" else "normal"
    status = "faint" if item_slug == "revive" else (
        "poison" if "restore" in effect_types else None
    )
    current_hp = "low" if "heal" in effect_types and item_slug != "revive" else "full"
    RNG.seed(0x17E4)
    session, player, item, target = make_session(
        item_slug,
        target_type=target_type,
        player_type="earth",
        gender="male",
        current_hp=current_hp,
        status=status,
        variables={"daytime": "true"},
    )
    if item_slug == "revive":
        target.current_hp = 0
    before = dump_target(target)
    valid = item.validate_monster(session, target)
    RNG.seed(0xC0FFEE)
    result = item.use(session, player, target) if valid else None
    return {
        "id": f"item:{item_slug}",
        "item": item_slug,
        "effects": effect_types,
        "target": before,
        "expected": {
            "valid": valid,
            "success": bool(result.success) if result else False,
            "itemQuantity": item.quantity,
            "currentHp": target.current_hp,
            "status": status_slug(target),
            "types": [element.slug for element in target.types.current],
            "combatStats": dump_stats(target),
            "stages": {name: target.temporary_stat_boosts.get_stage(name) for name in STAT_NAMES},
            "rng": {"cursor": RNG.a, "draws": RNG.draws},
        },
    }


def run_case(user_level: int, target_level: int, attempts: int, seed: int, status: str | None = None) -> dict[str, Any]:
    RNG.seed(0xE5CA9E)
    user = Monster.spawn_base("rockitten", user_level)
    target = Monster.spawn_base("nut", target_level)
    if status:
        user.status.add_status(Status.create(status, user))
    session = Obj(client=None)
    technique = Technique.create("menu_run")
    valid = technique.validate_monster(session, user)
    RNG.seed(seed)
    success = formula.attempt_escape("default", user, target, attempts) if valid else False
    return {
        "id": f"run:{user_level}:{target_level}:{attempts}:{status or 'clear'}:{seed:08x}",
        "seed": seed,
        "userLevel": user_level,
        "targetLevel": target_level,
        "attempts": attempts,
        "status": status,
        "expected": {
            "valid": valid,
            "success": success,
            "runAttempts": 0 if success else attempts + (1 if valid else 0),
            "battleLastResult": "run" if success else None,
            "rng": {"cursor": RNG.a, "draws": RNG.draws},
        },
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_gb3.py OUT.json.gz")
    output_path = Path(sys.argv[1])
    if not output_path.is_absolute():
        output_path = (CALLER_CWD / output_path).resolve()

    # Item construction loads sprites. SDL's dummy driver keeps this headless.
    pygame.display.set_mode((1, 1))
    combat_items = []
    for slug in db.database["item"]:
        model = ItemModel.lookup(slug, db)
        if State.MainCombatMenuState in model.usable_in:
            combat_items.append(slug)
    capture_items = sorted(
        slug
        for slug in combat_items
        if any(effect.type in {"capture", "capture_combined"} for effect in ItemModel.lookup(slug, db).effects)
    )
    ordinary_items = sorted(set(combat_items) - set(capture_items))

    captures = [
        capture_case(slug, favored, seed)
        for slug in capture_items
        for favored in (False, True)
        for seed in CAPTURE_SEEDS
    ]
    items = [item_case(slug) for slug in ordinary_items]
    runs = [
        run_case(user, target, attempts, seed)
        for user, target in ((5, 5), (1, 10), (10, 1))
        for attempts in (0, 1, 3)
        for seed in RUN_SEEDS
    ]
    runs.extend(run_case(5, 5, 2, seed, status) for status in ("grabbed", "stuck") for seed in RUN_SEEDS)
    payload = {
        "header": {
            "version": 1,
            "source": "Tuxemon 9e6258ff",
            "captureDevices": len(capture_items),
            "combatItems": len(combat_items),
            "ordinaryItems": len(ordinary_items),
            "captureCases": len(captures),
            "itemCases": len(items),
            "runCases": len(runs),
            "captureSeeds": list(CAPTURE_SEEDS),
            "runSeeds": list(RUN_SEEDS),
            "exemptions": [
                "captured battles still run normal post-battle cleanup in Pocket Tuxemon",
            ],
        },
        "captures": captures,
        "items": items,
        "runs": runs,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode()
    with output_path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as stream:
            stream.write(encoded)
    print(json.dumps({
        "captureDevices": len(capture_items),
        "combatItems": len(combat_items),
        "captures": len(captures),
        "items": len(items),
        "runs": len(runs),
        "output": str(output_path),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
