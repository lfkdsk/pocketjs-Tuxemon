// findings/scout-S1/patterns.ts — measurements behind the S1 design choices
// (Scout S1; not product code).
//
//   bun findings/scout-S1/patterns.ts > findings/scout-S1/patterns.json

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAllFileEvents, loadAllMaps, MAPS_DIR, parsePo, type TuxEvent } from "./tuxsrc.ts";
import { triggerClass } from "./shapes.ts";

const events = loadAllFileEvents();
const out: Record<string, unknown> = {};
const count = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
};
const acts = (ev: TuxEvent, t: string) => ev.acts.filter((a) => a.type === t);

// 1. lock/unlock pairing inside one event
{
  let both = 0, lockOnly = 0, unlockOnly = 0, lockAfterUnlock = 0;
  const lockOnlyEx: string[] = [];
  for (const ev of events) {
    const l = acts(ev, "lock_controls").length, u = acts(ev, "unlock_controls").length;
    if (l && u) both++;
    else if (l) { lockOnly++; if (lockOnlyEx.length < 6) lockOnlyEx.push(`${ev.source}:${ev.name}`); }
    else if (u) unlockOnly++;
    const li = ev.acts.findIndex((a) => a.type === "lock_controls");
    const ui = ev.acts.findIndex((a) => a.type === "unlock_controls");
    if (li >= 0 && ui >= 0 && ui < li) lockAfterUnlock++;
  }
  out.lockControls = { eventsWithBoth: both, lockOnly, unlockOnly, unlockBeforeLock: lockAfterUnlock, lockOnlyExamples: lockOnlyEx };
}

// 2. where do create_npc / remove_npc live
{
  const createIn = count(events.filter((e) => acts(e, "create_npc").length), (e) => triggerClass(e));
  const removeIn = count(events.filter((e) => acts(e, "remove_npc").length), (e) => triggerClass(e));
  const createsPerEvent = count(events.filter((e) => acts(e, "create_npc").length), (e) => String(acts(e, "create_npc").length));
  // create_npc behaviour argument (4th)
  const behaviourArg = count(events.flatMap((e) => acts(e, "create_npc")).filter((a) => a.args.length > 3), (a) => a.args[3]!);
  // same slug created at different positions in one map
  const multiPos: string[] = [];
  const byMapSlug = new Map<string, Set<string>>();
  for (const e of events) for (const a of acts(e, "create_npc")) {
    const k = `${e.source}|${a.args[0]}`;
    (byMapSlug.get(k) ?? byMapSlug.set(k, new Set()).get(k)!).add(`${a.args[1]},${a.args[2]}`);
  }
  for (const [k, s] of byMapSlug) if (s.size > 1) multiPos.push(`${k} ${[...s].join(" ")}`);
  out.npcLifecycle = {
    createNpcEventsByTriggerClass: createIn,
    removeNpcEventsByTriggerClass: removeIn,
    createsPerEvent,
    createNpcBehaviourArg: behaviourArg,
    mapSlugPairs: byMapSlug.size,
    mapSlugPairsWithSeveralPositions: multiPos.length,
    severalPositionsExamples: multiPos.slice(0, 8),
  };
}

// 3. char_face targets / directions
{
  const cf = events.flatMap((e) => acts(e, "char_face"));
  out.charFace = {
    total: cf.length,
    target: count(cf, (a) => (a.args[0] === "player" ? "player" : "npc")),
    direction: count(cf, (a) => (["up", "down", "left", "right"].includes(a.args[1] ?? "") ? a.args[1]! : a.args[1] === "player" ? "player" : "character-slug")),
  };
}

// 4. movement actions: targets
{
  const pick = (t: string, i: number) => count(events.flatMap((e) => acts(e, t)), (a) => (a.args[i] === "player" ? "player" : "npc"));
  out.movement = {
    pathfindMover: pick("pathfind", 0),
    pathfindToCharTarget: pick("pathfind_to_char", 0),
    pathfindToCharMover: pick("pathfind_to_char", 1),
    pathfindToCharDirectionGiven: events.flatMap((e) => acts(e, "pathfind_to_char")).filter((a) => a.args.length >= 3).length,
    charMoveMover: pick("char_move", 0),
    charStop: pick("char_stop", 0),
    charWanderArgc: count(events.flatMap((e) => acts(e, "char_wander")), (a) => String(a.args.length)),
  };
}

// 5. transfers: target map exists, trailing actions, fade
{
  const tt = events.flatMap((e) => acts(e, "transition_teleport").map((a) => ({ e, a })));
  const missing = tt.filter(({ a }) => !existsSync(join(MAPS_DIR, a.args[1]!.endsWith(".tmx") ? a.args[1]! : `${a.args[1]}.tmx`)));
  let trailing = 0;
  const trailingKinds = new Map<string, number>();
  for (const e of events) {
    const i = e.acts.findIndex((a) => a.type === "transition_teleport");
    if (i < 0) continue;
    const rest = e.acts.slice(i + 1);
    if (rest.length) trailing++;
    for (const r of rest) trailingKinds.set(r.type, (trailingKinds.get(r.type) ?? 0) + 1);
  }
  out.transitionTeleport = {
    total: tt.length,
    mover: count(tt, ({ a }) => (a.args[0] === "player" ? "player" : "npc")),
    targetMapMissing: missing.length,
    missingExamples: [...new Set(missing.map(({ a }) => a.args[1]))].slice(0, 12),
    transTime: count(tt, ({ a }) => a.args[4] ?? "(default 0.3)"),
    eventsWithActionsAfterTeleport: trailing,
    actionsAfterTeleport: Object.fromEntries([...trailingKinds.entries()].sort((a, b) => b[1] - a[1])),
    sameMapTeleports: tt.filter(({ e, a }) => a.args[1]!.replace(/\.tmx$/, "") === e.source.replace(/\.(tmx|yaml)$/, "")).length,
  };
}

// 6. teleport (instant) and other
{
  out.buttons = count(events.flatMap((e) => e.conds.filter((c) => c.type === "button_pressed")), (c) => c.args[0]!);
  out.charAtSubjects = count(events.flatMap((e) => e.conds.filter((c) => c.type === "char_at")), (c) => (c.args[0] === "player" ? "player" : "npc"));
  out.charFacingSubjects = count(events.flatMap((e) => e.conds.filter((c) => c.type === "char_facing")), (c) => (c.args[0] === "player" ? "player" : "npc"));
}

// 7. dialog sizes vs the rpgkit text box (lines <= 52 chars, <= 4 lines)
{
  const po = parsePo(join(MAPS_DIR, "../l18n/en_US/LC_MESSAGES/base.po"));
  const keys = events.flatMap((e) => acts(e, "translated_dialog").map((a) => a.args[0]!));
  let missing = 0, pagesTotal = 0, fitsOnePage = 0;
  const pageLens: number[] = [];
  const missingKeys = new Set<string>();
  for (const k of keys) {
    const s = po.get(k);
    if (s === undefined) { missing++; missingKeys.add(k); continue; }
    const pages = s.replace(/\\n/g, "\n").split("\n");
    pagesTotal += pages.length;
    for (const p of pages) pageLens.push(p.length);
    if (pages.length === 1) fitsOnePage++;
  }
  pageLens.sort((a, b) => a - b);
  const q = (f: number) => pageLens[Math.floor(f * (pageLens.length - 1))];
  const wrapLines = (p: string, w = 52) => {
    let lines = 0, cur = 0;
    for (const word of p.split(/\s+/).filter(Boolean)) {
      if (cur === 0) { cur = word.length; lines++; }
      else if (cur + 1 + word.length <= w) cur += 1 + word.length;
      else { cur = word.length; lines++; }
    }
    return Math.max(lines, 1);
  };
  const needBoxes = pageLens.length ? events.flatMap((e) => acts(e, "translated_dialog").map((a) => po.get(a.args[0]!))).filter((s): s is string => s !== undefined)
    .flatMap((s) => s.replace(/\\n/g, "\n").split("\n")).map((p) => Math.ceil(wrapLines(p) / 4)) : [];
  out.dialog = {
    translatedDialogUses: keys.length,
    distinctKeys: new Set(keys).size,
    keysMissingFromEnUS: missing,
    missingKeyExamples: [...missingKeys].slice(0, 10),
    poEntries: po.size,
    usesWithOnePage: fitsOnePage,
    pagesTotal,
    pageLengthChars: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: pageLens[pageLens.length - 1] },
    pagesNeedingMoreThanOneBoxAt52x4: needBoxes.filter((n) => n > 1).length,
  };
  const choices = events.flatMap((e) => acts(e, "translated_dialog_choice"));
  const optCounts = choices.map((a) => a.args[0]!.split(":").length);
  const optLabels = choices.flatMap((a) => a.args[0]!.split(":").map((k) => po.get(k) ?? k));
  out.choices = {
    uses: choices.length,
    optionCountHistogram: count(optCounts, String),
    optionLabelMaxLen: Math.max(...optLabels.map((s) => s.length)),
    optionLabelsOver24: optLabels.filter((s) => s.length > 24).length,
  };
  const charTalk = events.flatMap((e) => acts(e, "char_talk"));
  out.charTalk = { uses: charTalk.length, field: count(charTalk, (a) => a.args[1]!) };
}

// 8. per-map runtime event load (scenario merged)
{
  const maps = loadAllMaps();
  const per = maps.map((m) => m.events.length).sort((a, b) => a - b);
  out.eventsPerMapLoaded = { p50: per[Math.floor(per.length / 2)], p90: per[Math.floor(per.length * 0.9)], max: per[per.length - 1] };
}

if (import.meta.main) console.log(JSON.stringify(out, null, 1));
