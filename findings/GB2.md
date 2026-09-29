# GB2 Tuxemon battle rules and differential report

## Result

GB2 provides a deterministic, immutable-at-the-public-boundary battle reducer.
Its state is plain JSON, all random choices consume the serialized mulberry32
cursor, and the reducer has no frame-rate or wall-clock dependency. The
committed Spyder corpus finishes with **8,560 / 8,560 identical cases and zero
unwaived differences** against Tuxemon `9e6258ff`.

The implementation includes action ordering and target selection, hit and
potency rolls, cooldowns, AI and two deterministic player policies, status
phases, delayed actions, fainting and replacements, experience/training-point/
money rewards, and battle cleanup. Capture, item use, escape decisions,
level-up move learning, and evolution remain GB3 work; the decision/result
types reserve those boundaries without claiming them as GB2 coverage.

## Rule coverage

### Technique effects

The main-line rule surface is all 18 requested effect types:

| Effect | Reducer behavior |
| --- | --- |
| `damage` | Accuracy, affinity and range formula, spread penalty, damage attribution |
| `give` | Potency/accuracy gate, objective expansion, status transition/bond |
| `splash` | Miss divisor, spread penalty, stable multi-target application |
| `healing` | Level/power healing capped at maximum HP |
| `switch` | Fixed or RNG-selected element replacement |
| `multiattack` | Per-hit RNG consumption and accumulated damage |
| `statchange` | Objective expansion and bounded stage/stat mutation |
| `remove` | Remove by status slug, category, or `all` |
| `disappear` | Leave range and enqueue the next-turn return technique |
| `prop_healing` | Proportional base-HP healing |
| `prop_damage` | Proportional base-HP damage |
| `appear` | Return to range and resolve the delayed attack |
| `cooldown_modifier` | Filter moves and adjust cooldown within upstream bounds |
| `sacrifice` | Faint the user and transfer proportional current HP as damage |
| `photogenesis` | Outdoor, hour-shaped healing curve |
| `money` | Award technique gold on hit or self-damage on miss |
| `reverse` | Restore original elements |
| `transfer` | Move a matching status while preserving the upstream hook bypass |

The 8,560-battle trainer corpus executes 205 techniques and 16 of these
effects, plus the internally generated `empty` technique. `prop_damage` and
`reverse`, the two effects not reached by those trainer parties, have direct
rule-level regression tests. `empty` retains its own persistent hit result, as
the upstream generated technique does.

### Statuses

Every requested status appears in the committed differential traces:

`blinded`, `burn`, `chargedup`, `charging`, `charmed`, `confused`, `diehard`,
`elementalshield`, `enraged`, `exhausted`, `feedback`, `festering`,
`flinching`, `focused`, `grabbed`, `hardshell`, `harpooned`, `lifeleech`,
`lockdown`, `noddingoff`, `poison`, `prickly`, `recover`, `retaliate`,
`revenge`, `slow`, `sniping`, `softened`, `stuck`, and `wild`.

Coverage includes transition rules, stacking/duration, conditions, pre-check
move replacement, perform-technique hooks, periodic HP effects, linked
statuses, stat modifiers, swap hooks, party-HP hooks, and cleanup persistence.

## Differential corpus

The oracle runs the pinned Python engine headlessly with the reducer's
mulberry32 stream. It covers 214 distinct Spyder opponent/party definitions,
20 seeds per definition, and both `first` and `cycle` player policies:

```text
214 definitions x 20 seeds x 2 policies = 8,560 battles
```

The handoff expected five failures, but the first complete rerun found six:

| Case (`definition:seed:policy`) | Symptom | Root cause and reducer fix |
| --- | --- | --- |
| `46:3:cycle` | Battle cycled to its safety bound | A disappeared monster's due return had already moved to the queue, then was pruned when its target fainted. Restore `outOfRange` only when neither pending nor queued return exists. |
| `51:3:first` | One extra `empty` action | `wild` self-damage fainted its user during decision collection. Add the upstream PRE_ACTION winner check before draining queued moves. |
| `93:16:cycle` | Technique hit field differed | Generated `empty` inherited a transient/default hit value. Persist fallback hit exactly like upstream. |
| `94:16:first` | Technique hit field differed | Same `empty` hit-state defect. |
| `94:16:cycle` | Technique hit field differed | Same `empty` hit-state defect. |
| `179:16:cycle` | Technique hit field differed | Same `empty` hit-state defect. |

After those three reducer corrections, the committed comparator reports:

```json
{"cases":8560,"from":0,"identical":8560,"different":0,"firstDifference":null}
```

No golden expectation was edited to hide a reducer defect. The final corpus
has these content hashes:

| Artifact | SHA-256 |
| --- | --- |
| `battle/data/tuxemon-battle.json` | `241fcb4328c180dc7fd3b3a60b56543d0284cd9645d2253ea98a85ab345590f3` |
| `tools/battle-oracle/spyder-parties.json` | `bd18366d5814115da37cafbc13c22300343c7d3b64756e09dc24a2ca343efbd5` |
| `tests/goldens/gb2-spyder-traces.ndjson.gz` | `4264ad0c45021b0b3846350aca20bcf0955264fa2a6b781c6837dff090da69a8` |

The generator serializes sorted compact JSON and creates gzip data with
`mtime=0`. Two independent full generations under separate scratch
directories produced byte-identical party manifests, reducer databases, and
8,560-case golden files.

## Explicit compatibility decisions

There are exactly two intentional oracle exemptions, both declared in the
golden header and asserted by the offline test:

1. `draw-as-player-defeat`: Tuxemon's true-draw handler throws `ValueError`.
   The reducer ends deterministically with `outcome: "draw"`,
   `playerDefeated: true`, and `battleLastResult: "draw"`.
2. `stable-active-field-multitarget-order`: Python iterates a UUID-backed set,
   so its target order varies between processes. The reducer and normalized
   oracle use stable active-field order.

The other commander-selected quirks are preserved rather than waived:

- The status returned from a PERFORM_TECH hook is applied twice, matching the
  upstream `CombatSession` behavior.
- Counter-like status hooks (`feedback`, `prickly`, `retaliate`, `revenge`, and
  elemental shield) retain the observable upstream no-op after the performed
  action has been removed from history.
- `runAttempts` remains serialized and may be seeded across battles. Escape is
  a reserved GB3 decision, so GB2 does not reset or reinterpret it.
- Capture cleanup is deliberately not claimed here. GB3 must run normal
  cleanup after successful capture, which is the approved correction to the
  upstream early return.
- `teleport_faint`, foresight, item/revive paths, and other non-trainer action
  entry points are outside this reducer slice; no incompatible substitute was
  added.

## QuickJS performance

The benchmark bundles the real reducer/database as an IIFE and evaluates it in
PocketJS's bare QuickJS `Guest`. The benchmark host and this checkout both use
PocketJS revision `76ae741fb8fcda8da89ef65b4af7db654670ce9e`.

The fixture is `spyder_dryadsgrove_petra`, seed 3, `cycle` policy: a real
two-versus-three battle ending lost after 11 turns and 88 RNG draws. Each run
warms 20 battles, then measures 250 battles (2,750 round settlements and 3,000
active frames). Three separate host runs produced:

| Metric | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| Round mean | 0.625 ms | 0.598 ms | 0.636 ms |
| Round p95 | 0.862 ms | 0.839 ms | 0.867 ms |
| Round max | 1.501 ms | 1.954 ms | 1.310 ms |
| Rounds over 1 ms / 2,750 | 9 | 2 | 4 |
| Active-frame mean | 0.581 ms | 0.556 ms | 0.592 ms |
| Active-frame p95 | 0.861 ms | 0.837 ms | 0.865 ms |
| Complete-battle mean | 6.981 ms | 6.686 ms | 7.108 ms |
| Complete-battle p95 | 7.388 ms | 7.190 ms | 7.275 ms |

The round-settlement target is met at both mean and p95 in all three runs.
The maximum is reported rather than hidden: 2--9 of 2,750 samples per run
crossed 1 ms, with a worst observed single-round spike of 1.954 ms. An active
frame is either `createBattle` or one immutable `reduceBattle` decision; this
is JS execution time inside QuickJS, not a Bun/JSC proxy.

## Switching to the GB1 battle database

GB1's generated `pocket-tuxemon/battle-db/v1` is the intended runtime source,
but it is not a direct structural replacement for the oracle export. GB2 must
keep using its fixture until the following adapter/schema work lands.

| GB2 oracle field | GB1 field / conversion |
| --- | --- |
| `monster` | `monsters`; key supplies `slug`, and moveset fields convert from camelCase to the reducer's source-shaped names |
| `technique` | `techniques`; convert `healingPower`/`statModifiers` and other camelCase fields to the GB2 shape |
| `status` | `statuses`; convert transition and hook names and expand `statModifiers` |
| `element` | `elements`; turn each target-keyed `multipliers` object into the reducer's `{ against, multiplier }[]` |
| `taste` | `tastes`; turn the compact stat/multiplier fields into the reducer modifier record |
| `shape` | `shapes`; wrap each six-stat object as `{ attributes }` |
| `technique_speed` | Derive each value from `rules.actionOrder.speedTiers[technique.speed]` |

Three data gaps must be closed before cutover:

1. GB1 has no explicit source `elementOrder`. The required order is `frost`,
   `heroic`, `normal`, `wood`, `sky`, `earth`, `shadow`, `venom`, `water`,
   `lightning`, `metal`, `cosmic`, `fire`; alphabetically serialized element
   keys change RNG-selected `switch` results.
2. GB1 statuses omit the source `modifiers` list. Those modifiers implement,
   among other rules, fire immunity to burn, doubled burn damage for frost,
   and venom immunity to poison.
3. GB1's compact `statModifiers` need deterministic defaults for `step`,
   `max_step_limit`, `scaling_mode`, `max_deviation`, and `overridetofull` when
   expanded for the reducer.

GB1's Spyder database has 214 monsters, 228 techniques, 35 statuses, 13
elements, 12 tastes, and 14 shapes. Its techniques also contain the extra
`scope` effect, which is not among GB2's 18 trainer effects and is currently
rejected by the reducer. That effect must be implemented before player/TM
content that selects it can use the shared database.

Recommended cutover sequence:

1. Extend the GB1 schema/importer with `elementOrder` and status `modifiers`.
2. Add a pure, covered `BattleDb -> TuxemonBattleDb` adapter, including the
   casing conversions, speed-tier derivation, and stat-modifier defaults.
3. Load `game:battle-db` at runtime and pass the adapted object to GB2.
4. Run the same 8,560-case comparator against the adapted GB1 data and require
   zero differences before removing the oracle JSON from runtime use.
5. Retain the oracle JSON only as a development fixture for differential
   diagnostics.

## Verification

Final verification after the implementation, with the built replay enabled:

- `bunx tsc --noEmit`: exit 0.
- `bun test`: 46 pass, 0 fail, 39,388 assertions across 9 files; the built
  bundle replay ran, so no test was skipped.
- Offline differential comparator: 8,560 identical, 0 different, exit 0.
- Two complete oracle generations: byte-identical.
- `bun.lock`: unchanged from baseline.
- `vendor/`: unchanged from baseline.
