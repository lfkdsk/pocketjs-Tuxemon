# KB5 — shared session items and gold

## Result

Battle rules, extension commands, authored item/gold commands, and shops now
use one session-owned backpack and wallet (`SessionState.sw.items` and
`SessionState.sw.gold`). No game-specific state or Tuxemon-specific behavior
was added.

## Contracts and runtime behavior

- `BattleRules.start` now receives `ExtensionReadContext` as its fourth
  argument. The context snapshots live `ext`, switches, variables, items, and
  gold when the queued battle starts. A three-parameter implementation remains
  assignable and runs normally because JavaScript ignores the extra argument.
- `ExtensionCommandResult` and `BattleCompletion` accept optional `items` and
  `gold`. `items` is a per-id replacement patch; it is not a replacement for
  the entire inventory. A normalized zero removes that id. `gold` replaces the
  wallet.
- Both paths validate the complete returned patch before changing reducer
  state. They then commit ext/variables/switches/items/gold before the next
  interpreter command or battle-result branch.
- Item and gold values pass through `clampFiniteVar` and are clamped
  non-negative. Item counts additionally cap at
  `system.inventory.maxPerItem` (default 99).
- The deterministic `maxKinds` rule is: remove zeroed ids and update already
  held positive kinds first; sort previously unheld positive ids lexically;
  admit them until `maxKinds`; discard the remainder. This permits an atomic
  remove-and-add swap and does not depend on object insertion order.
- `canSave` was not changed. Once committed, the shared banks use the existing
  save/restore and attract-refold paths; an active battle remains unsafe to
  save.

## Tests

`tests/shared-inventory.test.ts` adds seven integration tests covering:

1. same-tick visibility to built-in item/gold conditions and a following
   extension command;
2. non-negative/safe-integer/max-per-item clamping and deterministic
   max-kinds admission;
3. a battle start observing an item just purchased from a shop;
4. source/runtime compatibility for a legacy three-parameter `start`;
5. battle reward items/gold appearing in a shop sell list, affecting the sale
   amount, and surviving an envelope save/restore;
6. rewind across an extension inventory write; and
7. identical battle writeback at 60/30/20/4 Hz, including overflow and both
   inventory limits.

Required validation, in order:

- `bun run build:example`: exit 0; all examples and fixtures built.
- `bun run build:wasm`: exit 0; produced the local test host so no simulator
  tests were skipped.
- `bun test`: **851 pass, 0 fail, 0 skip**, 465,955 assertions across 56 files.
  This includes all pinned framebuffer/golden tests.
- `bunx tsc --noEmit`: exit 0, no diagnostics.

The initial test run before building the local wasm host reported 129 skips;
it was not used as acceptance evidence. The wasm-backed rerun above has none.

## Bundle and repository audit

Compared with the clean baseline `fdc54ca` build, JS bundles that include the
session battle/extension engine increased by exactly 3,701 bytes (`meadow`,
`sunstone`, `grow`, `wander`, `r2-ui`, `streamed`, and `event-model`). This is
the expected code for the shared item normalization helper, result validation,
and two commit paths. Tree-shaken `editor` and `ui-theme` bundles changed by 0
bytes. Every generated `.pak` changed by 0 bytes.

No golden, generated asset, schema, `bun.lock`, or vendor file changed. The
submodule remains pinned at `76ae741f`.

## Commits

- `c0690f2 feat(engine): share inventory with battles and extensions`
- `dfb42d9 test(engine): cover shared battle inventory state`
- `df8f40c docs: define shared inventory writeback semantics`

PASS
