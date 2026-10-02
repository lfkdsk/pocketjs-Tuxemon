"""Generate deterministic Spyder battle traces with Tuxemon as the oracle.

The fixture mirrors each trainer party onto the player side. This makes both
the deterministic player policies and Tuxemon's random trainer AI exercise the
same campaign move pool. ``billie_choice`` rotates through the five campaign
choices over the 20 seeds (and through their evolved forms after level 20).

The output is gzip-compressed NDJSON with mtime=0. The first line is metadata;
each following line contains one replayable BattleStart and its oracle trace.

Weather mode (fourth argument ``weather``) runs one seed per definition under
each of the ten weather slugs (214 x 1 seed x 2 policies x 10 weathers =
4,280 battles). The pinned engine has no weather combat effects, so the
Python trace is identical to the no-weather battle; the slug rides in the
BattleStart so the TypeScript side proves its weather threading and modifier
pipeline stay differential-neutral.

Usage:
    python generate_spyder.py MANIFEST.json OUT.json.gz [seeds] [weather]
"""

from __future__ import annotations

import gzip
import json
import sys
import types
from pathlib import Path

CALLER_CWD = Path.cwd()

import boot
from boot import RNG

from tuxemon.ai.manager import AIManager
from tuxemon.combat.combat_context import CombatType
from tuxemon.combat.machine import CombatMachine, CombatPhase
from tuxemon.combat.session import CombatSession
from tuxemon.db import EffectPhase, TargetType
from tuxemon.event import get_event_bus
from tuxemon.item.item import Item
from tuxemon.monster.monster import Monster
from tuxemon.status.status import Status
from tuxemon.technique.technique import Technique


BILLIE_BASE = ("budaye", "dollfin", "grintot", "ignibus", "memnomnom")
BILLIE_EVOLVED = ("bamboon", "bigfin", "grintrock", "eruptibus", "miaownolith")

# Sorted to match battle/time-weather.ts DEFAULT_WEATHER_SLUGS.
WEATHER_SLUGS = (
    "cloudy",
    "foggy",
    "freezing",
    "hot",
    "misty",
    "rain",
    "snow",
    "sunny",
    "thunderstorm",
    "windy",
)


class Obj:
    def __init__(self, **values):
        self.__dict__.update(values)


class FakeParty:
    def __init__(self, owner):
        self.owner = owner

    @property
    def is_fainted(self):
        return all(monster.is_fainted for monster in self.owner.monsters)

    @property
    def alive(self):
        return [monster for monster in self.owner.monsters if not monster.is_fainted]


class FakeBag:
    def find_item(self, _slug):
        return None


class FakeNPC:
    def __init__(self, slug, is_player, monsters):
        self.slug = slug
        self.name = slug
        self.is_player = is_player
        self.monsters = monsters
        self.items = []
        self.party = FakeParty(self)
        self.bag = FakeBag()
        self.game_variables = {"method_money": "conserved"}
        self.combat = Obj(switch_logic=None, forfeit=False)
        self.tuxepedia = Obj(
            register_seen=lambda *_: None,
            register_caught=lambda *_: None,
        )
        self.battle_last_used_item_slug = None
        for monster in monsters:
            monster.set_owner(self)

    def __hash__(self):
        return hash(self.slug)


class NullEffects:
    def add_technique(self, *_):
        pass

    def add_status(self, *_):
        pass

    def add_item(self, *_):
        pass


class FakeEventEngine:
    def __init__(self):
        self.money = 0

    def execute_action(self, name, values, _immediate):
        if name != "modify_money":
            raise RuntimeError(f"unexpected battle action: {name}")
        if values[0] == "player":
            self.money += int(values[1])


def resolve_slug(slug: str, level: int, seed: int) -> str:
    if slug != "billie_choice":
        return slug
    choices = BILLIE_EVOLVED if level > 20 else BILLIE_BASE
    return choices[(seed - 1) % len(choices)]


def spawn_party(entries: list[dict], seed: int, enemy: bool) -> list[Monster]:
    result = []
    for entry in entries:
        slug = resolve_slug(entry["slug"], entry["level"], seed)
        monster = Monster.spawn_base(slug, entry["level"])
        if enemy:
            monster.set_experience_modifier(entry.get("experienceModifier", 1))
            monster.money_modifier = entry.get("moneyModifier", 0)
        result.append(monster)
    return result


STAT_NAMES = ("armour", "dodge", "hp", "melee", "ranged", "speed")


def dump_monster(monster: Monster) -> dict:
    return {
        "slug": monster.slug,
        "level": monster.level,
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
    }


def stable_targets(self, technique, user, target):
    """Intentional GB2 exemption: active-field order replaces UUID-set order."""
    seen = set()
    result = []
    for target_type in TargetType:
        if not technique.target[target_type]:
            continue
        for monster in self.get_targets_from_map(target_type, user, target):
            if monster not in seen:
                seen.add(monster)
                result.append(monster)
    return result


def run(definition: dict, definition_index: int, seed: int, policy: str, weather: str | None = None) -> dict:
    create_seed = 0xC0FFEE + definition_index * 100 + seed
    RNG.seed(create_seed)
    resolved = [
        {**entry, "slug": resolve_slug(entry["slug"], entry["level"], seed)}
        for entry in definition["party"]
    ]
    # A stable two-monster test party avoids inventing a campaign save at each
    # of 214 unrelated encounters. Its level follows the strongest opponent,
    # and both species always have at least one damaging level-up technique.
    fixture_level = max(entry["level"] for entry in resolved)
    player_monsters = spawn_party(
        [
            {"slug": "rockitten", "level": fixture_level},
            {"slug": "nut", "level": fixture_level},
        ],
        seed,
        False,
    )
    enemy_monsters = spawn_party(resolved, seed, True)
    start = {
        "seed": seed,
        "kind": "trainer",
        "opponent": definition["opponent"],
        "policy": policy,
        "player": [dump_monster(monster) for monster in player_monsters],
        "enemy": [dump_monster(monster) for monster in enemy_monsters],
        "inside": definition.get("inside", False),
        "hour": 12,
        "fieldSize": definition["fieldSize"],
        "moneyMethod": "conserved",
    }
    if weather is not None:
        start["weather"] = weather

    player = FakeNPC("player", True, player_monsters)
    opponent = FakeNPC(definition["opponent"], False, enemy_monsters)
    labels = {
        **{monster: f"p{index}" for index, monster in enumerate(player_monsters)},
        **{monster: f"e{index}" for index, monster in enumerate(enemy_monsters)},
    }

    combat = CombatSession()
    event_engine = FakeEventEngine()
    client = Obj(
        combat_session=combat,
        event_bus=get_event_bus(),
        active_effect_manager=NullEffects(),
        event_engine=event_engine,
        map_manager=Obj(map_inside=start["inside"]),
    )
    session = Obj(
        client=client,
        player=player,
        time=Obj(get_time_variables=lambda: Obj(hour=start["hour"])),
    )
    combat.set_combat_type(CombatType.TRAINER)
    combat.set_battle_format(start["fieldSize"] == 2)
    combat.set_players([player, opponent])
    combat.get_targets = types.MethodType(stable_targets, combat)
    machine = CombatMachine(combat)
    ai = AIManager(session)

    def label(monster):
        return labels[monster]

    def hp_snapshot():
        return {label(monster): monster.current_hp for monster in combat.active_monsters}

    def status_snapshot():
        return {
            label(monster): (
                monster.status.current_status.slug
                if monster.status.current_status
                else None
            )
            for monster in combat.active_monsters
        }

    RNG.seed(seed)
    trace = []
    phase = CombatPhase.READY
    guard = 0

    def check_party_hp():
        for npc, party in list(combat.field_monsters.get_all_monsters().items()):
            for monster in list(party):
                current = monster.status.current_status
                if current:
                    current.use(session, EffectPhase.CHECK_PARTY_HP)
                if not monster.is_fainted:
                    continue
                combat.action_queue.remove_monster_actions(monster)
                ai.remove_ai(monster)
                trace.append({
                    "type": "faint",
                    "turn": combat.turn,
                    "monster": label(monster),
                })
                combat.damage_tracker.remove_monster(monster)
                combat.field_monsters.remove_monster(npc, monster)

    while phase is not None and guard < 10_000:
        guard += 1
        if phase == CombatPhase.HOUSEKEEPING:
            turn = combat.next_turn()
            combat.action_queue.set_current_turn(turn)
            combat.action_queue.autoclean_pending()
            combat.restore_stranded_monsters()
            for npc in sorted(combat.active_players, key=lambda candidate: candidate.is_player):
                for _ in range(combat.get_available_positions(npc)):
                    replacement = ai.choose_replacement_monster(npc)
                    if replacement:
                        combat.add_monster_into_play(session, npc, replacement)
                        trace.append({
                            "type": "sendOut",
                            "turn": combat.turn,
                            "side": 0 if npc.is_player else 1,
                            "monster": label(replacement),
                        })
        elif phase == CombatPhase.DECISION:
            combat.check_decisions(session)
            combat.initialize_hit_chances()
            trace.append({
                "type": "round",
                "turn": combat.turn,
                "hit": {
                    label(monster): combat.get_tech_hit(monster)
                    for monster in combat.active_monsters
                },
            })
            for monster in list(combat.active_monsters):
                npc = combat.field_monsters.get_npc_for_monster(monster)
                monster.moves.recharge_moves()
                if combat.skips_decision(monster):
                    continue
                if npc.is_player:
                    candidates = [
                        (move, target)
                        for move in monster.moves.get_moves()
                        for target in combat.get_opponent_monsters(monster)
                        if move.can_use(session, target)
                    ]
                    if not candidates:
                        candidates = [
                            (move, combat.get_opponent_monsters(monster)[0])
                            for move in monster.moves.get_fallback_moves()
                        ]
                    selected = 0 if policy == "first" else (combat.turn - 1) % len(candidates)
                    technique, target = candidates[selected]
                    combat.set_variable("action_tech", technique.slug)
                    technique = combat.pre_checking(session, monster, technique, target)
                    combat.enqueue_action(monster, technique, target)
                    trace.append({
                        "type": "decision",
                        "turn": combat.turn,
                        "side": 0,
                        "user": label(monster),
                        "technique": technique.slug,
                        "target": label(target),
                    })
                else:
                    before = len(combat.action_queue.queue)
                    ai.process_ai_turn(monster, npc)
                    queue = combat.action_queue.queue
                    if len(queue) > before:
                        action = queue[-1]
                        trace.append({
                            "type": "decision",
                            "turn": combat.turn,
                            "side": 1,
                            "user": label(monster),
                            "technique": getattr(action.method, "slug", "?"),
                            "target": label(action.target),
                        })
        elif phase == CombatPhase.ACTION:
            if combat.action_queue.pending:
                combat.action_queue.autoclean_pending()
                combat.action_queue.from_pending_to_action(combat.turn)
            combat.action_queue.sort()
        elif phase == CombatPhase.POST_ACTION:
            if combat.action_queue.pending:
                combat.action_queue.autoclean_pending()
                combat.action_queue.from_pending_to_action(combat.turn)
            combat.apply_statuses(session)
        elif phase in (CombatPhase.HAS_WINNER, CombatPhase.DRAW_MATCH, CombatPhase.RAN_AWAY):
            remaining = list(combat.remaining_players)
            outcome = "draw" if not remaining else ("won" if remaining[0].is_player else "lost")
            trace.append({"type": "end", "turn": combat.turn, "outcome": outcome})
        elif phase == CombatPhase.END_COMBAT:
            break

        while phase in (CombatPhase.ACTION, CombatPhase.POST_ACTION) and not combat.action_queue.is_empty():
            action = combat.action_queue.pop()
            user, method, target = action.user, action.method, action.target
            if isinstance(method, Technique) and isinstance(user, Monster):
                before = hp_snapshot()
                result, status_result = combat.apply_technique(session, method, user, target)
                if status_result and status_result.statuses:
                    user.status.apply_status(session, boot._choice(status_result.statuses))
                trace.append({
                    "type": "technique",
                    "turn": combat.turn,
                    "user": label(user),
                    "target": label(target),
                    "technique": method.slug,
                    "hit": bool(method.hit),
                    "success": bool(result.success),
                    "damage": result.damage,
                    "multiplier": result.element_multiplier,
                    "hpBefore": before,
                    "hp": hp_snapshot(),
                    "statuses": status_snapshot(),
                })
            elif isinstance(method, Status):
                success = False
                if target.status.has_status(method.slug):
                    result = combat.apply_status(session, method, target, EffectPhase.PERFORM_STATUS)
                    success = bool(result.success)
                trace.append({
                    "type": "status",
                    "turn": combat.turn,
                    "status": method.slug,
                    "target": label(target),
                    "success": success,
                    "hp": hp_snapshot(),
                })
            elif isinstance(method, Item):
                raise RuntimeError("trainer fixture unexpectedly selected an item")
            combat.action_queue.sort()
            check_party_hp()

        next_phase = machine.determine_next_phase(phase)
        if next_phase is not None:
            phase = next_phase
        elif phase == CombatPhase.READY:
            phase = CombatPhase.HOUSEKEEPING

    if guard >= 10_000:
        raise RuntimeError(
            f"oracle phase loop exceeded its safety bound for "
            f"{definition_index}:{seed}:{policy} ({definition['opponent']})"
        )
    return {
        "id": f"{definition_index}:{seed}:{policy}" if weather is None else f"{definition_index}:{seed}:{policy}:{weather}",
        "definition": definition_index,
        "seed": seed,
        "policy": policy,
        "start": start,
        "expected": {
            "rngDraws": RNG.draws,
            "outcome": trace[-1]["outcome"],
            "trace": trace,
            "techniqueGold": event_engine.money,
        },
    }


def main(manifest_path: str, output_path: str, seed_count: int, weather: bool) -> None:
    manifest_file = Path(manifest_path)
    output_file = Path(output_path)
    if not manifest_file.is_absolute():
        manifest_file = CALLER_CWD / manifest_file
    if not output_file.is_absolute():
        output_file = CALLER_CWD / output_file
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    definitions = manifest["definitions"]
    weathers = WEATHER_SLUGS if weather else (None,)
    if weather:
        seed_count = 1
    cases = len(definitions) * seed_count * 2 * len(weathers)
    with open(output_file, "wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as zipped:
            header = {
                "version": 1,
                "source": "Tuxemon 9e6258ff",
                "definitions": len(definitions),
                "seedsPerDefinition": seed_count,
                "policies": ["first", "cycle"],
                "cases": cases,
                "exemptions": [
                    "draw-as-player-defeat",
                    "stable-active-field-multitarget-order",
                ],
            }
            if weather:
                header["mode"] = "weather"
                header["weather"] = list(WEATHER_SLUGS)
            zipped.write((json.dumps(header, sort_keys=True, separators=(",", ":")) + "\n").encode())
            completed = 0
            for definition_index, definition in enumerate(definitions):
                for seed in range(1, seed_count + 1):
                    for policy in ("first", "cycle"):
                        for slug in weathers:
                            case = run(definition, definition_index, seed, policy, slug)
                            zipped.write((json.dumps(case, sort_keys=True, separators=(",", ":")) + "\n").encode())
                            completed += 1
                if (definition_index + 1) % 10 == 0:
                    print(f"generated {completed}/{cases}", file=sys.stderr)
    print(json.dumps({"definitions": len(definitions), "cases": completed, "output": str(output_file)}, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4, 5):
        raise SystemExit("usage: generate_spyder.py MANIFEST.json OUT.json.gz [seeds] [weather]")
    weather_mode = len(sys.argv) == 5 and sys.argv[4] == "weather"
    if len(sys.argv) == 5 and not weather_mode:
        raise SystemExit("fourth argument must be 'weather'")
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) >= 4 else 20, weather_mode)
