# KW1 — derived world-idle condition

## Result

Pocket RPG Kit now accepts `{ "kind": "worldIdle", "negate"?: boolean }`
wherever the shared `Condition` union is used, including event-page
`condition.all` gates and `if` branches. The result is derived from the live
interpreter/session state at the point of evaluation. No field was added to
`Project`, `SessionState`, `InterpState`, or the save envelope.

The public session query is `isSessionWorldIdle(state, menuOpen?)`. The
optional flag lets a host account for a save/menu overlay without serializing
host UI state.

## Included state

`worldIdle` is false for each of the following independently:

| Owner | Blocker | Reason |
| --- | --- | --- |
| interpreter | `main !== null` | A blocking action/touch/autorun event owns the map flow. |
| interpreter | `inputLocked` | A cutscene explicitly owns player control, even though parallel and autorun fibers keep advancing. |
| interpreter | `modal !== null` | Any current or future modal kind blocks; today this covers text, choices, and shop. |
| interpreter | `error !== undefined` | The fatal content overlay freezes the playfield. |
| interpreter | `pendingTransfer !== null` | A transfer request blocks immediately when published, before session consumption. |
| interpreter | a pending player `moveRoute` | A newly published forced player route owns control immediately. Pending NPC routes do not. |
| interpreter | `pendingBattles.length > 0` | A queued scene request blocks immediately when published. |
| session | `playerRoute !== null` | The session-consumed forced player route still owns control. |
| session | `fade !== null` | Both fade-out and fade-in are transfer activity. |
| session | `scene !== null` | Every active scene blocks, including a scene configured with `worldContinues:true`. |
| host query | `menuOpen === true` | Save/menu UI is host-owned and pauses folding, so it is supplied to the derived query rather than saved. |

A parallel fiber, an NPC route, or attract/demo input ownership alone is not a
blocker. Attract read/end holds do not fold the reducer. Rewind restores a
session snapshot and derives the condition again.

## Evaluation order

- Trigger/page selection samples the predicate during the trigger scan, before
  fibers execute their commands for that reference tick. If a fiber unlocks
  input after that scan, an eligible page begins on the next reference tick.
- A compiled `if` recomputes the predicate from the mutable working state when
  its instruction runs. A later fiber in event-key order therefore observes a
  lock, modal, transfer, player-route request, or battle request emitted by an
  earlier fiber in the same tick.
- The blocking main fiber is part of the predicate. Parallel fibers themselves
  are not, preserving the existing rule that `inputLocked` suppresses player
  movement/action input but does not stop autorun or parallel progress.

## Integration and compatibility

- The runtime type, JSON schema, compiled-save validator, page selectors,
  character synchronization, session fold, shop-condition path, and UI page
  selection all receive the same derived condition context.
- The normative schema change is mirrored into the generated editor schema and
  its conservative `MAP_SCHEMA_HASH` is refreshed.
- `negate:true` is applied after deriving the base value. Low-level callers
  that omit runtime context conservatively cannot prove a positive
  `worldIdle` condition.
- The condition adds no serialized state. Save-code round trips, attract
  rewind, and 60/30/20/4 Hz behavior are covered directly. Existing projects
  that do not use the condition retain identical reducer outputs in the PR1
  equivalence corpus.

## Verification

- `bun run build:example` — exit 0; all examples and fixtures built, including
  `dist/sunstone.js` at 440,370 bytes.
- `bun test` — `936 pass`, `0 fail`, `468593 expect() calls`, 62 files; no
  skipped tests after building PocketJS wasm.
- `bunx tsc --noEmit` — exit 0.
- `tools/pr1-equivalence.sh` — `PASS scenarios=37 states=12376`; every produced
  semantic hash matched its retained baseline.
- `bun.lock` is unchanged, and no golden image is modified. Rendering was not
  changed; the full wasm-backed golden suite passed, so no new visual artifact
  was required.

PASS
