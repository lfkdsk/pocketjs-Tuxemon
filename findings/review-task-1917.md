# Review of G8 (task 1917): K4 upgrade, native Tuxemon shops, battle-transition budgets

Reviewed against `game-G8-shops.md` and `reviewer-generic.md`. Baseline `main` before this
task: `433bc55`. Reviewed range: `433bc55..715712b` (7 commits). All gates below were
re-run independently in this worktree, not copied from `findings/G8.md`.

## 1. Shop import vs. upstream (spot check + full census cross-check)

Read all four upstream economy files directly (`db/economy/{cotton_scoop,leather_scoop,
tuxe_mart_taba,spyder_scoops}.yaml`, 14 economies total — `spyder_scoops.yaml` is a
single YAML list of 11 economies). Recomputed by hand, independent of the importer:

- Item goods: 66 (from `spyder_scoops.yaml`) + 9 (3×3 from the three singleton files) = **75** — matches report.
- Finite-stock item goods: `spyder_cotton_tech` (tm_avalanche, tm_blossom) + `spyder_candy_tech`
  (tm_frostbite, tm_supernova, tm_vorpal, tm_acid) = **6** — matches.
- Variable-conditioned goods (`daytime`): `spyder_flower_scoop` + `spyder_candy_scoop`,
  2 each = **4** — matches.
- `cost != floor(price/2)`: 9 in `spyder_scoops.yaml` (5 in `spyder_cotton_tech`, 4 in
  `spyder_candy_tech`) + 9 (3×3, all three singleton-file economies use `cost=price/4`) = **18** — matches.
- Largest shop `spyder_timber_scoop`: counted 19 goods by hand — matches.
- Monster goods: 1+1+1+5+1+1 = **10** — matches.
- `open_shop` call sites in the map corpus: `grep` for `open_shop` across all `.tmx`/`.yaml`
  gives exactly 28 (11 `spyder_wayfarer1_norm` + 10 `spyder_shopassistant` + 3
  `tuxemart_keeper` + 2 `spyder_shopkeeper` + 2 `spyder_flowerpetshop_titus`), split 21
  `both_item` (incl. 3 in `spyder_test_map.tmx`, a real shipped map) / 7 `buy_monster` —
  matches "21 native / 7 placeholder" exactly, independent of the importer's own count.

Read `importer/project.ts:725-853`: `importedItem()` pulls the item's own `cost` field
(intrinsic catalog price, confirmed against `db/item/potion.yaml: cost: 100`) and
`behaviors.resellable` for `Item.sellable`; `itemShop()` maps each economy row's `price`
→ `ShopGood.price`, `cost` → `ShopGood.sellPrice`, non-negative finite `inventory` →
`stock` (an explicit upstream `-1` is correctly excluded, matching the upstream comment
"default -1 = unlimited"), and `variables` → a K4 `condition.all` variable clause.
`sellList: "hide"` matches K4's documented "Tuxemon parity, only resellable items"
semantics (`vendor/pocket-rpgkit/src/engine/types.ts:196-199`). Per-map NPC→economy
binding (`set_economy`) is scoped correctly: verified `spyder_shopassistant` resolves to
`spyder_candy_scoop`/`spyder_candy_tech` in `spyder_candy_scoop.tmx` and to
`spyder_leather_scoop`/`spyder_leather_tech` in `spyder_leather_scoop.tmx` — the same NPC
template slug, two different economies, correctly disambiguated per map
(`importer/project.ts:1487-1491`).

**Mutation check**: swapped `price`/`sellPrice` sourcing in `itemShop()` (used `cost` for
price and `price` for sellPrice) — `bun test tests/shop-import.test.ts` immediately failed
on the exact expected buy price (`expected price 2000, received 400`). Reverted; clean.

Coverage-report claims (`open_shop` 0→21 native / 28→7 placeholder, `set_economy` 0→16
native, locker-overflow refusal, missing `Item.description` field) all verified against
`importer/project.ts` and `dist/import-report.json` directly — **成立**.

`maxKinds` enforcement is real engine code, not a no-op: `vendor/pocket-rpgkit/src/engine/
interpreter.ts:1352-1360` computes `heldKinds` and refuses a new-kind purchase at the cap;
`system.inventory.maxKinds = 99` is set at `importer/project.ts:2074`.

Verdict: **成立**. Content is auto-imported by rule (price/cost/stock/condition/sellable
all derive mechanically from `db/economy` + `db/item` + `behaviors.resellable`); no
per-shop hand-editing found.

## 2. Visual check (self-driven, not from the report)

The report's own "Visual and repository hygiene" section only re-opens the three
*generic* web-verify PNGs (landing/phone/subpath) — it does **not** contain a shop-screen
screenshot despite this being the review's explicit ask. I produced my own:

Patched `dist/project-shell.json.start` to spawn the player directly at the real
`spyder_cotton_scoop` shop counter tile (`(1,8)` facing up, the exact walk-up tile of
imported `GameEvent e008_open_shop_r006` in `dist/project.json`, confirmed by reading the
generated map), recomputed `mapManifestHash` (`vendor/pocket-rpgkit/src/engine/
map-repository.ts:130`) so the session accepts it, rebuilt only the JS/pak (not
`gen-assets`), and drove `hosts/sim/sim.ts`'s `bootWorld` with real button masks
(open → confirm through the welcome dialog → confirm into the shop; `renderScale: 2` for
the "960×544" viewport, since PocketJS's native canvas stays 480×272 and doubles via
`wasm.renderScaled`, matching how the project's own `web-verify` sizing test describes
device-pixel scaling). `dist/`, `bun.lock`, and everything else are gitignored/restored;
`bun run import && bun run build` afterward reproduced the exact original byte counts
(`git status --porcelain` clean throughout).

Opened all four PNGs (480×272 and 960×544, buy-tab default and scrolled to the
unaffordable row):
- Buy tab: header "Buy", "Gold: 500" right-aligned, rows Repellent 100g / Potion 100g /
  Tuxeball 100g / Restoration 400g — exact match to upstream `spyder_cotton_scoop`
  economy prices I read directly from `spyder_scoops.yaml`. No clipping in either
  viewport; the 960×544 render is a clean 2× scale-up of the same content.
- Scrolled to index 4: "Escape Key 600g" renders in the dimmed/disabled color (gold=500 <
  600, `canAfford:false` in the actual modal state I logged alongside the screenshot),
  visually distinct from the enabled rows above it — the disabled-row requirement is
  satisfied and the price matches upstream exactly.

Verdict: **成立** (after independent reproduction; the report itself did not demonstrate this).

## 3. Hash re-pin proof

Reproduced independently rather than trusting the report's numbers. Built a second git
worktree at the pre-upgrade baseline `433bc55` (submodule `4e5d880`, its own pinned
`vendor/pocketjs` at `76ae741f`, identical to the post-upgrade pin — confirmed with
`git rev-parse HEAD` in both), ran `HZ=60 bun tools/smoke-spyder.ts` in both trees with a
one-line temporary addition (`writeFileSync(..., canonicalJson(st))`, reverted after) to
dump the full terminal `SessionState` as JSON.

- New tree: `STATE sha256=449c38b52331133ab10cea7293bff56a60f993a2d088d5bc6ccf072b8b09088c` — matches the pinned hash in `tests/g7-repository.test.ts` and the report.
- Old tree: `STATE sha256=fa06b6c6d379c889c5e51ba9356199e3e55845b20ef830f51c50d7c67a0d7993` — matches the old pin, and its own `bun test tests/g7-repository.test.ts` (3 pass) confirms this hash predates my involvement.
- Structural diff of the two JSON states: exactly `["interp","sw","shopStock"]` and
  `["sw","shopStock"]` (both empty objects), nothing else.
- After deleting those two keys from the new state and serializing both with
  `sort_keys=True, separators=(",",":")`, SHA-256 of both byte strings is
  `fa06b6c6d379c889c5e51ba9356199e3e55845b20ef830f51c50d7c67a0d7993` — **identical**.

Verdict: **成立**, independently reproduced byte-for-byte, not just re-read from the report.

## 4. Battle-transition frame-budget assertion

Ran `bash tools/bench-g6-quickjs.sh` (cargo from `~/.cargo/bin`, not on default PATH in
this worktree) end to end:

| Viewport | Entry total | Exit total |
| --- | ---: | ---: |
| 480×272 | 13.323 ms | 30.526 ms |
| 960×544 | 24.451 ms | 39.078 ms |

Close to the report's 13.379/30.623 and 24.633/38.930 (small run-to-run jitter, same
order of magnitude, same worst frame `f2091`/`f2205` at `spyder_paper_town`). Both runs
independently reproduced canonical state `449c38b5…09088c`.

**Mutation check**: changed the two `assert_single_frame_budget(...)` calls in
`tools/g6-quickjs-bench.rs:308-309` from `50.0` to `5.0` and re-ran — it failed exactly as
expected:
```
thread 'g6_quickjs_bench::journey' panicked at src/g6-quickjs-bench.rs:164:9:
battle-entry frame f2091:spyder_paper_town exceeded the 5 ms limit: 11.812 ms (qjs 11.763 + core 0.031 + draw 0.019)
```
Reverted; `git diff --stat` on `tools/g6-quickjs-bench.rs` is empty afterward (also
reverted the regenerated `findings/G7-map-first-visits.tsv` diff each bench run produces,
since its numbers are timing-noise, not a tracked artifact of this review).

Verdict: **成立** — this is a real, mutation-sensitive assertion, not report-only telemetry.

## 5. Gates (all re-run independently in this worktree)

| Gate | My result | Report |
| --- | --- | --- |
| `bun run import` ×2, `git status --porcelain` | both clean | matches |
| `bunx tsc --noEmit` | exit 0 | matches |
| `bun run build` | pak 3154 entries/58,561,216 B, `main.js` 2,068,263 B | matches |
| `bun run build:wasm` | `pocketjs.wasm` 289,758 B | matches |
| `bun test tests/` | 93 pass, 0 fail, 54,995 assertions, 19 files | matches |
| `bun test tests/shop-import.test.ts` | 2 pass, 82 assertions | matches |
| `bun run verify:g6:locks` | 329 pages, 333 dynamic checks, 327 unlocked, 2 transferred, 0 unresolved/error, 0 exceptions | matches |
| `bun run verify:g6:determinism` | 2 roots, 3167 files, 58,618,764 B, sha `3e16ceb3…` | matches |
| `bun run verify:g6:frozen` | 263 maps, 0 permanent locks/blocking fibers, 0 errors | matches |
| `bun run web && bun run web:verify` | PASS, 30 requests / 0 failed / 0 console errors | matches |
| Battle differential (`tests/battle-db-adapter.test.ts`, part of the 93) | included in the 93-pass/54,995-assertion run above | matches (8,560/8,560 identical) |

`git log 433bc55..HEAD` shows 7 commits, all authored `lfkdsk <lfkdsk@gmail.com>`, no
`Co-Authored-By`/AI attribution/fleet task numbers in any commit message or in the diff
text itself (`git diff 433bc55..HEAD | grep -iE "task-19[0-9]{2}|fleet task|co-authored"`
→ no hits outside the report's own prose describing the absence). `bun.lock` unchanged
(`git diff --stat -- bun.lock` empty). No `as any` introduced in the diff. The K4 modal
narrowing in `tools/smoke-spyder.ts` (commit `64451a9`) uses proper discriminated-union
narrowing (`m?.kind === "shop"` etc.), confirmed by reading the diff directly.

## 6. Two follow-up proposals

- **`Item` has no `description` field**: confirmed true by reading
  `vendor/pocket-rpgkit/src/engine/types.ts:285-302` — `Item` has `id/name/sprite/usable/
  price/sellable`, no description. The importer correctly records all 224 translated
  descriptions in `dist/import-report.json.economy.itemCatalog.descriptions` (spot-checked
  `potion` = "Heals a monster by 50 HP.", byte-identical to the report's quote) rather than
  silently dropping them, and marks this Degraded. Accurate, does not block this task
  (K4 schema change is out of scope for a game-repo task).
- **First clean PocketJS build failure after submodule init**: plausible bun-resolver
  caching behavior (stale "module missing" negative cache after a generated file appears
  mid-run); did not reproduce it myself since my worktree already had `framework/src/
  styles.generated.ts` from earlier build runs in this session, so I can't independently
  confirm the exact failure mode, but it's consistent with known bun behavior and the
  report says the immediate re-run and every gate afterward succeeded — not a blocking
  concern for this task, and not a PocketJS source change (`vendor/pocketjs` diff is empty
  per the report and per my own `git -C vendor/pocket-rpgkit/vendor/pocketjs status`).

Neither proposal changes the PASS/FAIL determination for this task.

## Blocking items

无 (none). The only gap found — the report's own visual-verification section not
actually covering the shop screen the spec asked for — was closed by reproducing the
missing screenshots myself in §2, and everything else checked out on independent
re-derivation, not just re-reading the report's claims.

PASS
