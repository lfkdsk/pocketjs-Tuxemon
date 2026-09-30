# PR #1 rebase onto current `main`

## Result

PR #1 was replayed onto `main` at
`a0857e097c9a68880f28ace2c13e2253be886d1c`. The three contributor commits
remain three separate commits with Yifeng "Evan" Wang's original authorship:

| Original | Rebased | Subject |
| --- | --- | --- |
| `ca83cc6f` | `923b87e` | `perf(engine): fold reference ticks without redundant state copies` |
| `53e000ac` | `352da31` | `perf(ui): keep the dialog boxes mounted and hide them while unused` |
| `4607cc7f` | `a2fc53c` | `build: pin vendor/pocketjs to the PSP strip-blit and idle-frame commits` |

The current-main integration, verification harnesses, and measured budget
updates are separate commits. The implementation tested by the final
equivalence run is `ac3dd9bc8763a3794d3576fcf32eb0756cae6925`.

`vendor/pocketjs` is pinned to the required merged descendant
`d48962e82a237cc49719e5a0da72a6dbd45ff5e8`. `bun.lock` and every committed
golden PNG are unchanged. Nothing was pushed and no GitHub state was changed.

## Conflict resolution

The review's 22 conflict blocks were resolved without dropping current-main
features:

| File | Blocks | Resolution |
| --- | ---: | --- |
| `src/engine/interpreter.ts` | 10 | Kept extension commands/state, five-bank switch state, finite shop stock, shared inventory, queued battles, new conditions, and indexed event scans. Folded the PR's `shareInterp`/`ownRecord` mechanism around all of them. |
| `src/engine/session.ts` | 8 | Kept sharded-map acquisition and staged fade preparation, extension state, battle scenes/queues, shared inventory write-back, and multi-Hz scheduling. One owned session work copy is now advanced in place for all reference ticks in a host frame. |
| `src/engine/chars.ts` | 2 | Kept extension-aware page selection, current collision/body behavior, placements, and indexed event slots while applying `shareChars`/`ownChar`. Changed `syncPagesInPlace`'s `detachPatrol` default to the safe `true`. |
| `src/ui/DialogBox.tsx` | 2 | Extended persistent mounting from the old message/choice pair to current main's message, choice, and shop panels. Each is switched with `display`; choice and shop rows derive `windowStart` from the live cursor, so wrap and scroll cannot retain stale local state. |

The post-rebase adaptation is isolated in `eb365f6` and the measured UI budget
update in `ac3dd9b`.

## Copy-on-write audit

The published-state invariant is: after `stepSession` returns a state, no
later fold may mutate anything reachable from that state.

| State | Ownership treatment |
| --- | --- |
| `chars.chars[id]` | `shareChars` initially shares entries; every mutation goes through `ownChar`. Nested routes, patrol templates, and incremental path searches are detached. Page switches detach the new patrol by default. |
| `sw.switches`, `sw.self`, `sw.items`, `sw.variables`, `sw.shopStock` | `shareInterp` shares each record until its first write; all authored commands, extension writes, shop buy/sell/restock paths, local-variable cleanup, and battle completion writes use `ownRecord` or replace the entire record. |
| `interp.pendingBattles` | `copyInterp` copies the queue and deep-clones every request setup before in-place queue operations. Pending routes, placements, transfers, cues, fibers/stacks, modal, latches, and erased records are likewise detached. |
| `SessionState.ext` | Cloned once into the host-frame working copy through the registered extension codec before reference ticks mutate/replace it. |
| `SessionState.scene` | Cloned once into the host-frame working copy; each game battle `step` receives a deep clone and its returned state is deep-cloned before publication. |
| `Session.preparingMap` | A derived session/cache object, not part of a published `SessionState`; logical state/input is retried unchanged while preparation happens. It therefore must not be folded into snapshot COW. |

Focused retained-object regressions cover extension variables, finite-stock
shop buy/sell banks, every state retained across two queued battles, and the
page-switch patrol template. These complement the whole-run retained-state
hash check below.

`World.keyedEvents`/`slotsById` are compiled derived caches. They are correct
under the current invariant that `map.events` is immutable. A future dynamic
event add/remove feature must rebuild or invalidate the `World`; the source
comment records that constraint explicitly.

## Equivalence proof

`tools/pr1-equivalence.sh` checks out baseline `a0857e0` in a detached
worktree and loads baseline and candidate engines independently. For every
published state it records a canonical hash immediately, retains the actual
state object, and hashes that object again after the complete run. It then
compares baseline and candidate frame by frame. The second hash detects later
in-place writes that would otherwise silently corrupt an older shared state.

Final command result:

```text
PR1_EQUIV PASS scenarios=37 states=12376
```

The full per-frame hashes are in
`/var/tmp/fleet/1946/equivalence/result.json`; its candidate commit is
`ac3dd9bc8763a3794d3576fcf32eb0756cae6925`.

| Coverage group | Scenarios | States | Result |
| --- | ---: | ---: | --- |
| Sunstone journey 60/30/20/4 Hz, frozen input tape, attract 60/30/20/4 Hz | 9 | 6,763 | identical |
| Wander automatic movement 60/20 Hz | 2 | 962 | identical |
| Grow to completion | 1 | 157 | identical |
| Meadow 60/30/20/4 Hz | 4 | 916 | identical |
| Event-model, r2-ui, and streamed fixtures | 3 | 1,123 | identical |
| KR1 inline versus sharded repository parity 60/30/20/4 Hz | 4 | 1,372 | identical |
| Queued KB2 battles, KB4 wins 60/30/20/4 Hz, rewind across battle boundaries | 9 | 385 | identical |
| K4 shop economy plus save round trip | 1 | 10 | identical |
| KF2 dialog freeze 60/30/20/4 Hz | 4 | 688 | identical |
| **Total** | **37** | **12,376** | **identical** |

Every scenario matched both its produced-state sequence and its end-of-run
rehash of all retained states.

## QuickJS performance

`tools/pr1-quickjs-bench.sh` bundles the same workloads from baseline and
candidate, then executes them inside the pinned PocketJS desktop host's real
QuickJS `Guest`. Each workload uses 2,000 iterations and 9 timed rounds. The
order is interleaved `main`, `candidate`, `candidate`, `main`; the table is the
mean of the two per-run medians from the persisted run log.

| Workload | main | candidate | Change |
| --- | ---: | ---: | ---: |
| Sunstone idle tick | 135.395 us | 75.739 us | **-44.1%** |
| Sunstone walking tick | 145.471 us | 86.326 us | **-40.7%** |
| Wander automatic tick | 417.669 us | 303.322 us | **-27.4%** |
| Active battle-scene tick | 147.616 us | 139.457 us | **-5.5%** |

Thus the intended Sunstone/Wander tick win is present, and the current-main
battle scene does not regress. A second interleaved final-HEAD run also kept
all four candidate means below their paired main means.

The existing full KB4 QuickJS presentation benchmark was additionally run on
the candidate at both 480x272 and 960x544. Command-idle, shake + HP tween, and
faint animation measured 0.338--0.395 ms, 0.349--0.355 ms, and 0.368--0.372 ms
mean JS time respectively. All six samples reported zero create, destroy,
insert, or remove operations on every measured frame.

## Persistent dialog budget and visual check

All message, choice, and shop panel trees now exist from boot and only their
`display` changes. A Sunstone boot has a measured 119 nodes; the regression
cap is 130 (11 nodes of local headroom), still far below the earlier R1
558-node design. The built Sunstone JS is 429,204 bytes, 426 bytes above the
pre-persistent-three-panel bundle pin; the exact isolation test was updated to
that measured value. KB4's distinctive UI identifiers remain absent from the
Sunstone bundle.

The full suite retained all golden hashes and semantic pixel assertions,
including exact HP-bar width, sprite shake offset, faint sink/opacity, map
occlusion, letterboxing, and dialog colours. I also opened and inspected the
current text, scrolling-choice, shop, battle command, hit, faint, win, and
lose frames. Text is contained, the 4-row choice window and ellipsis are
correct, shop labels/prices/disabled colours align, sprites and HP bars are
visible, and the message bands do not overlap or clip.

Visual evidence:

- `/var/tmp/fleet/1946/dialog-text.png`
- `/var/tmp/fleet/1946/dialog-choices-scroll.png`
- `/var/tmp/fleet/1946/dialog-shop.png`
- `tests/goldens/kb4-battle.{command,hit,faint,winmsg,losemsg}.png`

## Required gate

Run in the required order after the final code/budget commit:

| Command | Result |
| --- | --- |
| `bun run build:example` | exit 0; all examples and fixtures built; `sunstone.js` 429,204 B and `sunstone.pak` 3,308,384 B |
| `bun run build:wasm` | exit 0; `pocketjs.wasm` 289,510 B |
| `bun test` | **910 pass, 0 fail, 0 skip**, 467,641 assertions across 60 files |
| `bunx tsc --noEmit` | exit 0 |

The final worktree is clean, including the submodule, and `bun.lock` has no
diff from `a0857e0`.

PASS
