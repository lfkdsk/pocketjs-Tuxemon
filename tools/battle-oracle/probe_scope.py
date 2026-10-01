"""Independent oracle probe for the scope technique readout.

Constructs real `nut` L17 and `rockitten` L13 monsters via Monster.spawn_base
(the same path the game uses), seeds the shared RNG stream to 1899, and calls
the pinned ScopeEffect directly. Also checks the effect's behaviour when the
target has an active armour +1 / speed -1 stage, to confirm ScopeEffect reads
base_stats and ignores stage modifiers (scope.py:40-47, monster.py:350-372).

Run from the repo root:
    TUXEMON_SRC=<tuxemon-checkout> <venv>/bin/python \
        tools/battle-oracle/probe_scope.py
"""

from __future__ import annotations

import sys

sys.path.insert(0, "tools/battle-oracle")

import boot  # noqa: E402  (patches random + loads db as import side effect)

from tuxemon.core.effects.scope import ScopeEffect  # noqa: E402
from tuxemon.monster.monster import Monster  # noqa: E402


def stats_line(monster: Monster) -> str:
    return (
        f"AR={monster.armour} DE={monster.dodge} ME={monster.melee} "
        f"RD={monster.ranged} SD={monster.speed}"
    )


def main() -> None:
    boot.RNG.seed(1899)

    attacker = Monster.spawn_base("rockitten", 13)
    target = Monster.spawn_base("nut", 17)

    print("target nut L17 base (property) stats:")
    print(" ", stats_line(target), f"HP={target.hp}")
    print("  taste_cold/warm:", target.taste_cold, target.taste_warm)
    print("  individual_values:", target.individual_values.to_dict())
    print("attacker rockitten L13 base (property) stats:")
    print(" ", stats_line(attacker), f"HP={attacker.hp}")
    print("  taste_cold/warm:", attacker.taste_cold, attacker.taste_warm)
    print("  individual_values:", attacker.individual_values.to_dict())

    class FakeTech:
        name = "scope"

    effect = ScopeEffect()
    result = effect.apply_tech_target(None, FakeTech(), attacker, target)
    print("ScopeEffect.apply_tech_target extras:", result.extras)

    # Apply a +1 armour stage and -1 speed stage the way battle code does
    # (temporary_stat_boosts / combat stat computation lives outside
    # base_stats), then confirm get_combat_stats reflects it while the raw
    # armour/dodge/... properties (and thus ScopeEffect) do not.
    before_combat = target.get_combat_stats()
    target.temporary_stat_boosts.add_stage("probe", "armour", 1)
    target.temporary_stat_boosts.add_stage("probe", "speed", -1)
    after_combat = target.get_combat_stats()
    print("target get_combat_stats() before boosts:", before_combat)
    print("target get_combat_stats() after +1 armour / -1 speed:", after_combat)

    result_boosted = effect.apply_tech_target(None, FakeTech(), attacker, target)
    print("ScopeEffect extras with active stage boosts:", result_boosted.extras)
    print("target property stats with active stage boosts:", stats_line(target))


if __name__ == "__main__":
    main()
