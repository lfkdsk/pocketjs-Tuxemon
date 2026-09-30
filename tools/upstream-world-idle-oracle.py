#!/usr/bin/env python3
"""Probe Tuxemon's WorldState gates with the pinned upstream runtime.

The Radiotower case enters the authored ``Stop!`` event and loses its real
level-5-versus-level-55 battle.  The evolution cases load each candidate map,
put a real pending evolution behind the same SinkState created by
``lock_controls``, and release it with the real ``unlock_controls`` action.

Only missing font/audio assets are adapted, exactly as in
``upstream-first-loss-oracle.py``.  The output deliberately normalizes the
upstream UUID4 event ids to deterministic, per-case instance numbers.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
FIRST_LOSS_PATH = SCRIPT_DIR / "upstream-first-loss-oracle.py"
EXPECTED_REVISION = "9e6258ff"
DT = 1.0 / 60.0


def load_first_loss_support() -> Any:
    spec = importlib.util.spec_from_file_location(
        "tuxemon_upstream_first_loss_support", FIRST_LOSS_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {FIRST_LOSS_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SUPPORT = load_first_loss_support()

import pygame  # noqa: E402

from tuxemon.db import Direction  # noqa: E402
from tuxemon.event.eventaction import EventAction  # noqa: E402
from tuxemon.event.eventengine import EventEngine  # noqa: E402
from tuxemon.event.running import RunningEvent  # noqa: E402
from tuxemon.launcher import GameLauncher  # noqa: E402
from tuxemon.locale.locale import T  # noqa: E402
from tuxemon.monster.monster import Monster  # noqa: E402
from tuxemon.session import local_session  # noqa: E402
from tuxemon.teleporter import TeleportFaint  # noqa: E402


TRACKED_EVENTS = {
    "Evolution all",
    "Faint Recovery Notice",
    "Stop!",
    "Teleport Faint",
}
TRACKED_ACTIONS = {
    "evolution",
    "lock_controls",
    "set_variable",
    "start_battle",
    "teleport_faint",
    "translated_dialog",
    "unlock_controls",
}
EVOLUTION_CASES = (
    ("spyder_route1", "battle return (no authored story lock)"),
    ("spyder_paper_town", "First Fight - Start / result event"),
    ("spyder_radiotower", "Stop!"),
    ("taba_ba_br_1", "move to middle redo / result event"),
    ("taba_ba_br_2", "acolyte2 or battle redo / result event"),
)


def map_name(client: Any) -> str | None:
    try:
        return Path(client.get_map_name()).stem
    except (AttributeError, RuntimeError, ValueError):
        return None


def state_stack(client: Any) -> list[str]:
    return [state.name for state in client.active_states]


def box_of(event: Any) -> list[int]:
    box = event.box
    return [int(box.x), int(box.y), int(box.width), int(box.height)]


class Recorder:
    def __init__(self, case: str, client: Any) -> None:
        self.case = case
        self.client = client
        self.tick = -1
        self.sequence = 0
        self.current_event: Any | None = None
        self.entries: list[dict[str, Any]] = []
        self.dialog_counts: Counter[str] = Counter()
        self._instances: dict[int, int] = {}

    def begin_tick(self, tick: int) -> None:
        self.tick = tick

    def event_label(self, event: Any) -> dict[str, Any]:
        runtime_identity = id(event)
        if runtime_identity not in self._instances:
            self._instances[runtime_identity] = len(self._instances) + 1
        return {
            "event": event.name,
            "instance": self._instances[runtime_identity],
            "box": box_of(event),
        }

    def append(self, kind: str, **values: Any) -> None:
        entry = {
            "seq": self.sequence,
            "tick": self.tick,
            "kind": kind,
            "map": map_name(self.client),
            "stateStack": state_stack(self.client),
            **values,
        }
        self.sequence += 1
        self.entries.append(entry)


ACTIVE_RECORDER: Recorder | None = None


def install_tracing() -> None:
    original_start_event = EventEngine.start_event
    original_process = RunningEvent.process
    original_action_start = EventAction.on_start

    def start_event(self: EventEngine, event: Any) -> None:
        already_running = event.id in self.running_events
        original_start_event(self, event)
        recorder = ACTIVE_RECORDER
        if (
            recorder is not None
            and not already_running
            and event.id in self.running_events
            and event.name in TRACKED_EVENTS
        ):
            recorder.append("eventStart", **recorder.event_label(event))

    def process(
        self: RunningEvent,
        session: Any,
        action_manager: Any,
        dt: float,
    ) -> bool:
        recorder = ACTIVE_RECORDER
        previous = recorder.current_event if recorder is not None else None
        if recorder is not None:
            recorder.current_event = self.map_event
        try:
            return original_process(self, session, action_manager, dt)
        finally:
            if recorder is not None:
                recorder.current_event = previous

    def action_start(self: EventAction, session: Any) -> None:
        recorder = ACTIVE_RECORDER
        event = recorder.current_event if recorder is not None else None
        if recorder is not None and self.name in TRACKED_ACTIONS:
            values: dict[str, Any] = {
                "action": self.name,
                "parameters": SUPPORT.action_parameters(self),
            }
            if event is not None:
                values.update(recorder.event_label(event))
            if self.name == "translated_dialog":
                key = str(getattr(self, "raw_parameters", ""))
                values["key"] = key
                values["text"] = T.translate(key)
                recorder.dialog_counts[key] += 1
            recorder.append("action", **values)
        original_action_start(self, session)

    EventEngine.start_event = start_event
    RunningEvent.process = process
    EventAction.on_start = action_start


def configure_runtime() -> Any:
    SUPPORT.install_asset_and_audio_adapters()
    # A headless oracle has no multiplayer peers. Creating several fixture
    # clients otherwise starts several localhost servers on the same fixed
    # port, which adds irrelevant thread errors to an otherwise valid run.
    from tuxemon.network.manager import NetworkManager

    NetworkManager.initialize = lambda self: None
    SUPPORT.CONFIG.config_model.display.resolution_x = 256
    SUPPORT.CONFIG.config_model.display.resolution_y = 144
    SUPPORT.CONFIG.config_model.display.vsync = False
    SUPPORT.CONFIG.config_model.display.fullscreen = False
    SUPPORT.CONFIG.config_model.game.recompile_translations = False
    SUPPORT.CONFIG.config_model.gameplay.dialog_speed = "max"
    SUPPORT.asset_loader.fetch_mod_asset_roots(SUPPORT.CONFIG, force=True)
    T.initialize_translations(recompile=False)
    SUPPORT.platform.init()

    from tuxemon import prepare
    from tuxemon.platform.const.sizes import TILE_SIZE
    from tuxemon.prepare import DisplayContext
    from tuxemon.scaling import DefaultScaling

    pygame.init()
    screen = pygame.display.set_mode((256, 144))
    context = DisplayContext(
        screen=screen,
        rect=screen.get_rect(),
        resolution=(256, 144),
        tile_size=TILE_SIZE,
        scale=1,
        scaling=DefaultScaling(1),
    )
    prepare.DISPLAY_CONTEXT = context
    return context


def new_client(context: Any, target_map: str) -> Any:
    SUPPORT.boot.RNG.seed(1)
    client = SUPPORT.LocalPygameClient.create(SUPPORT.CONFIG, context)
    local_session.set_client(client)
    client.push_state("BackgroundState")
    launcher = GameLauncher(client)
    meta = SUPPORT.boot.db.mod_metadata.get_mod_metadata("tuxemon")
    launcher.launch(session=local_session, meta=meta)

    # Move to a non-triggering corner before the first world update. The
    # launcher's 15-tick TeleporterState remains on top and naturally expires.
    client.event_engine.execute_action(
        "teleport", ["player", f"{target_map}.tmx", 0, 0]
    )
    for tick in range(120):
        if client.current_state and client.current_state.name not in (
            "WorldState",
            "BackgroundState",
            "SinkState",
        ) and tick % 6 == 0:
            pygame.event.post(
                pygame.event.Event(pygame.KEYDOWN, key=pygame.K_RETURN)
            )
        client.update(DT)
        if client.current_state and client.current_state.name == "WorldState":
            return client
    raise RuntimeError(
        f"{target_map}: did not settle to WorldState: {state_stack(client)}"
    )


def press_confirm(tick: int) -> None:
    if tick % 6 == 0:
        pygame.event.post(pygame.event.Event(pygame.KEYDOWN, key=pygame.K_RETURN))
    elif tick % 6 == 1:
        pygame.event.post(pygame.event.Event(pygame.KEYUP, key=pygame.K_RETURN))


def party_snapshot(player: Any) -> list[dict[str, Any]]:
    return [
        {
            "slug": monster.slug,
            "level": monster.level,
            "hp": monster.current_hp,
            "maxHp": monster.hp,
            "waitingToEvolve": monster.waiting_to_evolve,
        }
        for monster in player.monsters
    ]


def run_radiotower(context: Any) -> dict[str, Any]:
    global ACTIVE_RECORDER
    client = new_client(context, "spyder_radiotower")
    player = local_session.player
    monster = Monster.spawn_base("rockitten", 5)
    player.party.add_monster(monster, 0)
    player.teleport_faint = TeleportFaint("spyder_leather_center.tmx", 6, 7)
    player.game_variables.set("kernelquest", None)

    recorder = Recorder("radiotower-loss", client)
    ACTIVE_RECORDER = recorder
    recorder.begin_tick(0)
    client.event_engine.execute_action(
        "teleport", ["player", "spyder_radiotower.tmx", 1, 16]
    )

    battle_result_tick: int | None = None
    final_tick: int | None = None
    try:
        for tick in range(8_000):
            recorder.begin_tick(tick)
            press_confirm(tick)
            client.update(DT)
            if (
                battle_result_tick is None
                and player.game_variables.get("battle_last_result") == "lost"
            ):
                battle_result_tick = tick
                recorder.append("milestone", name="battleResultLost")
            if (
                map_name(client) == "spyder_leather_center"
                and player.tile_pos == (6, 7)
                and state_stack(client) == ["WorldState", "BackgroundState"]
                and not client.event_engine.running_events
            ):
                final_tick = tick
                recorder.append("milestone", name="settledAtFaintPoint")
                break
    finally:
        ACTIVE_RECORDER = None

    if final_tick is None:
        raise RuntimeError(
            "radiotower loss did not settle at the configured faint point: "
            + json.dumps(
                {
                    "map": map_name(client),
                    "tile": list(player.tile_pos),
                    "stack": state_stack(client),
                    "battle": player.game_variables.get("battle_last_result"),
                    "kernelquest": player.game_variables.get("kernelquest"),
                    "party": party_snapshot(player),
                    "running": [
                        token.map_event.name
                        for token in client.event_engine.running_events.values()
                    ],
                    "tail": recorder.entries[-20:],
                },
                sort_keys=True,
            )
        )

    stop = [
        entry
        for entry in recorder.entries
        if entry.get("event") == "Stop!" and entry.get("box") == [1, 16, 12, 1]
    ]
    teleports = [
        entry
        for entry in recorder.entries
        if entry.get("event") == "Teleport Faint"
        and entry.get("kind") == "eventStart"
    ]
    faint_actions = [
        entry
        for entry in recorder.entries
        if entry.get("action") == "teleport_faint"
    ]
    unlocks = [entry for entry in stop if entry.get("action") == "unlock_controls"]
    starts = [entry for entry in stop if entry.get("action") == "start_battle"]
    visible_dialogs = [
        {
            "key": key,
            "text": T.translate(key),
            "count": recorder.dialog_counts[key],
        }
        for key in (
            "spyder_omnichannel_billie1",
            "spyder_omnichannel_dante1",
            "spyder_omnichannel_beaverbrook1",
            "spyder_omnichannel_dante2",
            "spyder_omnichannel_billie2",
            "spyder_omnichannel_beaverbrook2",
            "heal_before_leave",
        )
    ]

    if battle_result_tick is None:
        raise AssertionError("Radiotower battle did not report lost")
    if len(starts) != 1 or len(unlocks) != 1:
        raise AssertionError(
            f"Radiotower Stop! start/unlock mismatch: {len(starts)}/{len(unlocks)}"
        )
    if not teleports or teleports[0]["seq"] <= unlocks[0]["seq"]:
        raise AssertionError("Teleport Faint did not wait for Stop! unlock")
    if player.game_variables.get("kernelquest") != "yes":
        raise AssertionError("Radiotower post-battle story did not set kernelquest=yes")
    # Upstream 9e6258ff only heals when teleport_faint starts while already on
    # its destination map. A cross-map transition therefore leaves this party
    # fainted; preserving that observed bug is part of this oracle's evidence.
    if not player.monsters or any(mon.current_hp != 0 for mon in player.monsters):
        raise AssertionError("Radiotower upstream cross-map faint unexpectedly healed")

    return {
        "ticks": final_tick + 1,
        "battleResultTick": battle_result_tick,
        "stopBattleTick": starts[0]["tick"],
        "stopUnlockTick": unlocks[0]["tick"],
        "teleportFaintStarts": len(teleports),
        "teleportFaintActions": len(faint_actions),
        "visibleDialogs": visible_dialogs,
        "final": {
            "map": map_name(client),
            "playerTile": list(player.tile_pos),
            "stateStack": state_stack(client),
            "kernelquest": player.game_variables.get("kernelquest"),
            "battleLastResult": player.game_variables.get("battle_last_result"),
            "party": party_snapshot(player),
        },
        "trace": recorder.entries,
    }


def run_evolution_case(context: Any, map_id: str, story_gate: str) -> dict[str, Any]:
    global ACTIVE_RECORDER
    client = new_client(context, map_id)
    player = local_session.player
    monster = Monster.spawn_base("banling", 18)
    monster.waiting_to_evolve = True
    player.party.add_monster(monster, 0)

    evolution_events = [
        event for event in client.map_manager.events if event.name == "Evolution all"
    ]
    if len(evolution_events) != 1:
        raise AssertionError(
            f"{map_id}: expected one Evolution all event, got {len(evolution_events)}"
        )
    source_event = evolution_events[0]
    current_state_conditions = [
        {
            "operator": condition.operator.value,
            "type": condition.type,
            "parameters": list(condition.parameters),
        }
        for condition in source_event.conds
        if condition.type == "current_state"
    ]

    # Keep the loaded upstream EventObject, but remove unrelated map pages so
    # this probe observes only the common evolution page and its state gate.
    client.map_manager.set_events([source_event])
    recorder = Recorder(f"evolution:{map_id}", client)
    ACTIVE_RECORDER = recorder
    try:
        recorder.begin_tick(0)
        client.event_engine.execute_action("lock_controls")
        recorder.append("milestone", name="battleOrStoryBlockerPresent")
        for tick in range(5):
            recorder.begin_tick(tick)
            client.update(DT)

        starts_before_release = sum(
            entry.get("kind") == "eventStart"
            and entry.get("event") == "Evolution all"
            for entry in recorder.entries
        )
        recorder.begin_tick(5)
        client.event_engine.execute_action("unlock_controls")
        recorder.append("milestone", name="worldStateRestored")
        release_sequence = recorder.sequence - 1

        for tick in range(5, 30):
            recorder.begin_tick(tick)
            client.update(DT)
            if any(
                entry.get("action") == "evolution" for entry in recorder.entries
            ):
                break
    finally:
        ACTIVE_RECORDER = None

    starts = [
        entry
        for entry in recorder.entries
        if entry.get("kind") == "eventStart"
        and entry.get("event") == "Evolution all"
    ]
    actions = [
        entry
        for entry in recorder.entries
        if entry.get("action") == "evolution"
        and entry.get("event") == "Evolution all"
    ]
    if starts_before_release != 0:
        raise AssertionError(f"{map_id}: Evolution all started while blocked")
    if len(starts) != 1 or len(actions) != 1:
        raise AssertionError(
            f"{map_id}: expected one evolution start/action, got {len(starts)}/{len(actions)}"
        )
    if starts[0]["seq"] <= release_sequence:
        raise AssertionError(f"{map_id}: Evolution all preceded WorldState restoration")

    return {
        "map": map_id,
        "storyGate": story_gate,
        "sourceCondition": current_state_conditions,
        "blockedTicks": 5,
        "startsBeforeRelease": starts_before_release,
        "releaseTick": 5,
        "evolutionEventStartTick": starts[0]["tick"],
        "evolutionActionTick": actions[0]["tick"],
        "stateAtEvolution": actions[0]["stateStack"],
        "trace": recorder.entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else REPO_ROOT / args.output

    source_revision = SUPPORT.revision()
    if not source_revision.startswith(EXPECTED_REVISION):
        raise RuntimeError(
            f"expected Tuxemon {EXPECTED_REVISION}, found {source_revision}"
        )

    context = configure_runtime()
    install_tracing()
    radiotower = run_radiotower(context)
    evolutions = [
        run_evolution_case(context, map_id, story_gate)
        for map_id, story_gate in EVOLUTION_CASES
    ]
    result = {
        "format": "tuxemon-upstream-world-idle-oracle/v1",
        "source": str(SUPPORT.TUXEMON_SRC),
        "sourceRevision": source_revision,
        "seed": 1,
        "hz": 60,
        "adapters": {
            "fontFallback": str(SUPPORT.FALLBACK_FONT),
            "audio": "silent",
        },
        "radiotowerLoss": radiotower,
        "evolutionGates": evolutions,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "output": str(output),
                "radiotower": {
                    key: radiotower[key]
                    for key in (
                        "ticks",
                        "battleResultTick",
                        "stopBattleTick",
                        "stopUnlockTick",
                        "teleportFaintStarts",
                        "teleportFaintActions",
                    )
                },
                "evolutions": [
                    {
                        key: row[key]
                        for key in (
                            "map",
                            "startsBeforeRelease",
                            "releaseTick",
                            "evolutionEventStartTick",
                            "evolutionActionTick",
                        )
                    }
                    for row in evolutions
                ],
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
