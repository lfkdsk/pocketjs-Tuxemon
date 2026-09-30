#!/usr/bin/env python3
"""Run Tuxemon's Spyder opening through the first-fight loss, headlessly.

The source checkout intentionally omits fonts and music.  This harness supplies
one system-font fallback and makes audio playback inert; map loading, events,
movement, state transitions, and combat all remain the pinned upstream code.

Usage:
    TUXEMON_SRC=/var/tmp/tuxemon-src \
      /var/tmp/fleet/gb2-oracle-venv/bin/python \
      tools/upstream-first-loss-oracle.py \
      /var/tmp/fleet/<task>/upstream-first-loss-trace.jsonl
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
TUXEMON_SRC = Path(os.environ.get("TUXEMON_SRC", "/var/tmp/tuxemon-src"))
EXPECTED_REVISION = "9e6258ff"
FALLBACK_FONT = Path(
    "/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf"
)
DT = 1.0 / 60.0
MAX_TICKS = 12_000
TRACE_EVENT_NAMES = {
    "First Fight - Start",
    "First Fight - Win",
    "First Fight - Lose",
    "Teleport Faint",
}
TRACE_VARIABLES = (
    "scenario_choice",
    "race_choice",
    "gender_choice",
    "question_intro",
    "intro_scoop",
    "choice_phase",
    "myintrochoice",
    "billie_choice",
    "dantefirst",
    "dantebin",
    "rockittenchosen",
    "mymonchoice",
    "firstfightdue",
    "firstfightend",
    "battle_last_result",
)

# boot patches Python's RNG before Tuxemon imports capture it and performs the
# mandated db.load(validate=False).
sys.path.insert(0, str(SCRIPT_DIR / "battle-oracle"))
import boot  # noqa: E402

boot.RNG.seed(1)

import pygame  # noqa: E402

from tuxemon import tools as tuxemon_tools  # noqa: E402
from tuxemon.audio import MusicPlayerState, SoundManager  # noqa: E402
from tuxemon.client import LocalPygameClient  # noqa: E402
from tuxemon.constants import asset_loader  # noqa: E402
from tuxemon.db import Direction, MusicStatus  # noqa: E402
from tuxemon.event.eventaction import EventAction  # noqa: E402
from tuxemon.event.eventengine import EventEngine  # noqa: E402
from tuxemon.event.running import ConditionEvaluator, RunningEvent  # noqa: E402
from tuxemon.launcher import GameLauncher  # noqa: E402
from tuxemon.locale.locale import T  # noqa: E402
from tuxemon.platform import platform  # noqa: E402
from tuxemon.session import local_session  # noqa: E402
from tuxemon.user_config import CONFIG  # noqa: E402


def revision() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=TUXEMON_SRC,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    enum_value = getattr(value, "value", None)
    if isinstance(enum_value, (bool, int, float, str)):
        return enum_value
    return str(value)


def action_parameters(action: EventAction) -> dict[str, Any]:
    if not dataclasses.is_dataclass(action):
        return {}
    hidden = {"_done", "_skip", "cancelled"}
    return {
        field.name: jsonable(getattr(action, field.name))
        for field in dataclasses.fields(action)
        if field.name not in hidden
    }


class Recorder:
    def __init__(self) -> None:
        self.tick = -1
        self.current_eval_event: Any | None = None
        self.current_running_event: Any | None = None
        self.condition_buffer: list[dict[str, Any]] = []
        self.conditions: list[dict[str, Any]] = []
        self.event_starts: list[dict[str, Any]] = []
        self.actions: list[dict[str, Any]] = []
        self.dialogs: list[dict[str, Any]] = []
        self.driver: list[str] = []
        self.event_counts: Counter[str] = Counter()
        self.action_counts: Counter[str] = Counter()
        self.dialog_counts: Counter[str] = Counter()
        self.milestones: dict[str, int] = {}

    def begin_tick(self, tick: int) -> None:
        self.tick = tick
        self.conditions = []
        self.event_starts = []
        self.actions = []
        self.dialogs = []
        self.driver = []

    def milestone(self, name: str) -> None:
        self.milestones.setdefault(name, self.tick)


RECORDER = Recorder()


def install_asset_and_audio_adapters() -> None:
    if not FALLBACK_FONT.is_file():
        raise RuntimeError(f"font fallback is missing: {FALLBACK_FONT}")

    original_fetch = asset_loader.fetch_asset

    def fetch_with_font_fallback(*parts: str) -> str:
        try:
            return original_fetch(*parts)
        except OSError:
            if parts and parts[0] == "font":
                return str(FALLBACK_FONT)
            raise

    # tools imported fetch_asset before the harness installed the wrapper.
    asset_loader.fetch_asset = fetch_with_font_fallback
    tuxemon_tools.fetch_asset = fetch_with_font_fallback

    def silent_music_load(
        self: MusicPlayerState,
        filename: str,
        volume: float,
        loop: int,
        fade_ms: int,
    ) -> None:
        del self, filename, volume, loop, fade_ms

    def logical_music_playing(self: MusicPlayerState) -> bool:
        return self.status == MusicStatus.PLAYING and self.current_song is not None

    MusicPlayerState.load = silent_music_load
    MusicPlayerState.is_playing = logical_music_playing
    SoundManager.play = lambda self, slug: None


def condition_dict(condition: Any, result: bool) -> dict[str, Any]:
    operator = getattr(condition, "operator", None)
    return {
        "operator": jsonable(operator),
        "type": getattr(condition, "type", ""),
        "parameters": jsonable(getattr(condition, "parameters", [])),
        "result": bool(result),
    }


def install_event_tracing() -> None:
    original_evaluate = ConditionEvaluator.evaluate
    original_queue = EventEngine._evaluate_and_queue_event
    original_start_event = EventEngine.start_event
    original_process = RunningEvent.process
    original_action_start = EventAction.on_start

    def evaluate(self: ConditionEvaluator, condition: Any) -> bool:
        result = original_evaluate(self, condition)
        if RECORDER.current_eval_event is not None:
            RECORDER.condition_buffer.append(condition_dict(condition, result))
        return result

    def queue_event(
        self: EventEngine, event: Any, is_global: bool = False
    ) -> None:
        previous = RECORDER.current_eval_event
        RECORDER.current_eval_event = event
        RECORDER.condition_buffer = []
        before = len(RECORDER.event_starts)
        try:
            original_queue(self, event, is_global=is_global)
        finally:
            evaluated = RECORDER.condition_buffer
            started = len(RECORDER.event_starts) != before
            if event.name in TRACE_EVENT_NAMES or started:
                RECORDER.conditions.append(
                    {
                        "event": event.name,
                        "scope": "global" if is_global else "map",
                        "evaluated": evaluated,
                        "allMet": bool(evaluated)
                        and all(item["result"] for item in evaluated),
                        "started": started,
                    }
                )
            RECORDER.condition_buffer = []
            RECORDER.current_eval_event = previous

    def start_event(self: EventEngine, event: Any) -> None:
        already_running = event.id in self.running_events
        original_start_event(self, event)
        if not already_running and event.id in self.running_events:
            scope = "global" if event in self.global_events else "map"
            entry = {"event": event.name, "scope": scope}
            RECORDER.event_starts.append(entry)
            RECORDER.event_counts[event.name] += 1
            if event.name == "First Fight - Start":
                RECORDER.milestone("firstFightStarted")
            elif event.name == "First Fight - Lose":
                RECORDER.milestone("firstFightLoseStarted")
            elif event.name == "Teleport Faint":
                RECORDER.milestone("teleportFaintStarted")

    def process(
        self: RunningEvent,
        session: Any,
        action_manager: Any,
        dt: float,
    ) -> bool:
        previous = RECORDER.current_running_event
        RECORDER.current_running_event = self.map_event
        try:
            return original_process(self, session, action_manager, dt)
        finally:
            RECORDER.current_running_event = previous

    def action_start(self: EventAction, session: Any) -> None:
        event = RECORDER.current_running_event
        entry = {
            "event": getattr(event, "name", None),
            "action": self.name,
            "parameters": action_parameters(self),
        }
        RECORDER.actions.append(entry)
        RECORDER.action_counts[self.name] += 1
        if self.name == "translated_dialog":
            raw = str(getattr(self, "raw_parameters", ""))
            dialog = {
                "event": getattr(event, "name", None),
                "key": raw,
                "text": T.translate(raw),
            }
            RECORDER.dialogs.append(dialog)
            RECORDER.dialog_counts[raw] += 1
        elif self.name == "start_battle":
            RECORDER.milestone("startBattleAction")
        elif self.name == "teleport_faint":
            RECORDER.milestone("teleportFaintAction")
        original_action_start(self, session)

    ConditionEvaluator.evaluate = evaluate
    EventEngine._evaluate_and_queue_event = queue_event
    EventEngine.start_event = start_event
    RunningEvent.process = process
    EventAction.on_start = action_start


class Driver:
    def __init__(self, client: LocalPygameClient) -> None:
        self.client = client
        self.path_targets: set[tuple[str, tuple[int, int]]] = set()
        self.chose_intro_monster = False
        self.entered_name = False
        self.interacted_with_starter = False
        self.pending_key_release: int | None = None

    @property
    def player(self) -> Any:
        return local_session.player

    def map_name(self) -> str | None:
        try:
            return Path(self.client.get_map_name()).name
        except (AttributeError, RuntimeError, ValueError):
            return None

    def variable(self, name: str) -> Any:
        return self.player.game_variables.get(name)

    def choose_intro_monster(self) -> None:
        self.player.game_variables.set("myintrochoice", "budaye")
        self.client.pop_state()
        self.chose_intro_monster = True
        RECORDER.driver.append("choose myintrochoice=budaye; pop ChoiceMonster")

    def enter_name(self, state: Any) -> None:
        state.input_controller.set_string("Oracle")
        state.confirm()
        self.entered_name = True
        RECORDER.driver.append("set player name=Oracle; confirm InputMenu")

    def pathfind_once(self, destination: tuple[int, int]) -> None:
        map_name = self.map_name()
        if map_name is None:
            return
        marker = (map_name, destination)
        if marker in self.path_targets:
            return
        self.player.pathfind(destination)
        self.path_targets.add(marker)
        RECORDER.driver.append(f"pathfind player to {destination}")

    def press_a(self) -> None:
        if self.pending_key_release is not None:
            return
        pygame.event.post(pygame.event.Event(pygame.KEYDOWN, key=pygame.K_RETURN))
        self.pending_key_release = pygame.K_RETURN

    def before_tick(self, tick: int) -> None:
        if self.pending_key_release is not None:
            pygame.event.post(
                pygame.event.Event(pygame.KEYUP, key=self.pending_key_release)
            )
            self.pending_key_release = None

        state = self.client.current_state
        state_name = state.name if state else None

        if state_name == "ChoiceMonster" and not self.chose_intro_monster:
            self.choose_intro_monster()
            return

        if state_name == "InputMenu" and not self.entered_name:
            self.enter_name(state)
            return

        # Max-speed text still requires one press to finish a line and another
        # to advance. A six-tick cadence avoids AlertManager's rapid-click guard.
        if state_name not in (None, "WorldState", "BackgroundState"):
            if tick % 6 == 0:
                self.press_a()
                RECORDER.driver.append(f"press A in {state_name}")
            return

        if state_name != "WorldState":
            return

        map_name = self.map_name()
        if map_name == "spyder_bedroom.tmx":
            if self.variable("intro_scoop") == "done":
                self.pathfind_once((7, 2))
            return

        if map_name == "spyder_downstairs.tmx":
            if self.player.tile_pos == (4, 6):
                self.player.set_facing(Direction.DOWN)
                RECORDER.driver.append("face down at downstairs exit")
            else:
                self.pathfind_once((4, 6))
            return

        if map_name != "spyder_paper_town.tmx" or self.player.monsters:
            return

        if self.variable("dantefirst") != "yes":
            self.pathfind_once((23, 13))
            return

        if self.player.tile_pos != (23, 10):
            self.pathfind_once((23, 10))
            return

        self.player.set_facing(Direction.LEFT)
        if not self.interacted_with_starter and tick % 6 == 0:
            self.press_a()
            self.interacted_with_starter = True
            RECORDER.driver.append("face left and interact with Rockitten")


def snapshot(client: LocalPygameClient) -> dict[str, Any]:
    try:
        player = local_session.player
    except ValueError:
        player = None

    variables = (
        {name: player.game_variables.get(name) for name in TRACE_VARIABLES}
        if player
        else {}
    )
    party = []
    if player:
        party = [
            {
                "slug": monster.slug,
                "level": monster.level,
                "hp": monster.current_hp,
                "maxHp": monster.hp,
                "fainted": monster.is_fainted,
            }
            for monster in player.monsters
        ]
    try:
        map_name = Path(client.get_map_name()).name
    except (AttributeError, RuntimeError, ValueError):
        map_name = None

    return {
        "tick": RECORDER.tick,
        "seconds": round(RECORDER.tick * DT, 6),
        "currentState": client.current_state.name if client.current_state else None,
        "stateStack": [state.name for state in client.active_states],
        "map": map_name,
        "player": {
            "tile": list(player.tile_pos) if player else None,
            "facing": player.facing.value if player else None,
        },
        "variables": variables,
        "party": party,
        "conditions": RECORDER.conditions,
        "eventStarts": RECORDER.event_starts,
        "actions": RECORDER.actions,
        "dialogs": RECORDER.dialogs,
        "driver": RECORDER.driver,
    }


def recovered(client: LocalPygameClient, frame: dict[str, Any]) -> bool:
    variables = frame["variables"]
    party = frame["party"]
    return (
        frame["map"] == "spyder_paper_town.tmx"
        and frame["stateStack"] == ["WorldState", "BackgroundState"]
        and variables["firstfightdue"] == "no"
        and variables["firstfightend"] == "no"
        and variables["battle_last_result"] == "lost"
        and len(party) == 1
        and party[0]["hp"] == party[0]["maxHp"]
        and "First Fight - Lose" not in {
            token.map_event.name for token in client.event_engine.running_events.values()
        }
    )


def validate(final_frame: dict[str, Any]) -> None:
    expected_dialogs = {
        "spyder_papertown_firstfight_lose": 1,
        "spyder_papertown_firstfight_after": 1,
        "heal_before_leave": 0,
    }
    actual_dialogs = {
        key: RECORDER.dialog_counts[key] for key in expected_dialogs
    }
    if actual_dialogs != expected_dialogs:
        raise AssertionError(
            f"unexpected recovery dialogs: {actual_dialogs}, expected {expected_dialogs}"
        )
    if RECORDER.event_counts["Teleport Faint"] != 0:
        raise AssertionError("Teleport Faint unexpectedly started")
    if RECORDER.action_counts["teleport_faint"] != 0:
        raise AssertionError("teleport_faint unexpectedly executed")
    if final_frame["map"] != "spyder_paper_town.tmx":
        raise AssertionError(f"unexpected final map: {final_frame['map']}")
    if final_frame["player"]["tile"] != [23, 10]:
        raise AssertionError(f"unexpected final tile: {final_frame['player']['tile']}")
    party = final_frame["party"]
    if len(party) != 1 or party[0]["slug"] != "rockitten":
        raise AssertionError(f"unexpected final party: {party}")
    if party[0]["hp"] != party[0]["maxHp"]:
        raise AssertionError(f"Rockitten was not healed: {party[0]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source_revision = revision()
    if not source_revision.startswith(EXPECTED_REVISION):
        raise RuntimeError(
            f"expected Tuxemon {EXPECTED_REVISION}, found {source_revision}"
        )

    install_asset_and_audio_adapters()
    install_event_tracing()

    CONFIG.config_model.display.resolution_x = 256
    CONFIG.config_model.display.resolution_y = 144
    CONFIG.config_model.display.vsync = False
    CONFIG.config_model.display.fullscreen = False
    CONFIG.config_model.game.recompile_translations = False
    CONFIG.config_model.gameplay.dialog_speed = "max"

    asset_loader.fetch_mod_asset_roots(CONFIG, force=True)
    T.initialize_translations(recompile=False)
    platform.init()
    # prepare.pygame_init() reloads the database with validation enabled.  The
    # pinned source deliberately omits its 147 MB music tree, so construct the
    # equivalent native dummy-display context after boot's validate=False load.
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
    client = LocalPygameClient.create(CONFIG, context)
    local_session.set_client(client)
    client.push_state("BackgroundState")

    launcher = GameLauncher(client)
    meta = boot.db.mod_metadata.get_mod_metadata("tuxemon")
    launcher.launch(session=local_session, meta=meta)

    player = local_session.player
    player.game_variables.update(
        {
            "scenario_choice": "spyder_campaign",
            "race_choice": "white_male",
            "gender_choice": "gender_male",
            "question_intro": "yes",
        }
    )
    driver = Driver(client)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    final_frame: dict[str, Any] | None = None
    with args.output.open("w", encoding="utf-8") as trace:
        header = {
            "type": "header",
            "format": "tuxemon-upstream-first-loss-trace/v1",
            "source": str(TUXEMON_SRC),
            "sourceRevision": source_revision,
            "dbLoad": "db.load(validate=False) via tools/battle-oracle/boot.py",
            "seed": 1,
            "hz": 60,
            "display": [256, 144],
            "adapters": {
                "fontFallback": str(FALLBACK_FONT),
                "audio": "silent",
                "uiChoices": {
                    "openingMonster": "budaye",
                    "playerName": "Oracle",
                    "allOtherMenus": "first/default option",
                },
            },
        }
        trace.write(json.dumps(header, sort_keys=True) + "\n")

        for tick in range(MAX_TICKS):
            RECORDER.begin_tick(tick)
            driver.before_tick(tick)
            client.update(DT)
            frame = snapshot(client)
            trace.write(json.dumps(frame, sort_keys=True) + "\n")
            if frame["variables"]["battle_last_result"] == "lost":
                RECORDER.milestone("battleResultLost")
            if recovered(client, frame):
                final_frame = frame
                RECORDER.milestone("recovered")
                break

        if final_frame is None:
            raise RuntimeError(f"first-loss run did not recover in {MAX_TICKS} ticks")

        validate(final_frame)
        summary = {
            "type": "summary",
            "ticks": final_frame["tick"] + 1,
            "milestones": RECORDER.milestones,
            "eventCounts": dict(sorted(RECORDER.event_counts.items())),
            "actionCounts": dict(sorted(RECORDER.action_counts.items())),
            "dialogCounts": dict(sorted(RECORDER.dialog_counts.items())),
            "visibleRecoveryDialogs": [
                {
                    "key": key,
                    "count": RECORDER.dialog_counts[key],
                    "text": T.translate(key),
                }
                for key in (
                    "spyder_papertown_firstfight_lose",
                    "spyder_papertown_firstfight_after",
                    "heal_before_leave",
                )
            ],
            "final": {
                key: final_frame[key]
                for key in (
                    "currentState",
                    "stateStack",
                    "map",
                    "player",
                    "variables",
                    "party",
                )
            },
        }
        trace.write(json.dumps(summary, sort_keys=True) + "\n")

    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
