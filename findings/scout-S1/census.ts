// findings/scout-S1/census.ts — count Tuxemon event actions/conditions
// (Scout S1; not product code).
//
//   bun findings/scout-S1/census.ts > findings/scout-S1/census.json
//
// Two views:
//   files  — every event object once per FILE (each .yaml once, however
//            many maps name it as their scenario). This is the view the
//            commander's context numbers were taken in.
//   loaded — every event as the engine loads it per map (scenario yaml
//            merged into each map that names it): the runtime event load.

import { loadAllFileEvents, loadAllMaps, type TuxEvent } from "./tuxsrc.ts";

interface Tally {
  count: number;
  maps: Set<string>;
  argc: Map<number, number>;
  examples: string[];
}

function tally(events: TuxEvent[]) {
  const acts = new Map<string, Tally>();
  const conds = new Map<string, Tally>();
  const condOps = new Map<string, Tally>();
  const behavs = new Map<string, Tally>();
  const bump = (m: Map<string, Tally>, key: string, ev: TuxEvent, argc: number, raw: string) => {
    let t = m.get(key);
    if (!t) m.set(key, (t = { count: 0, maps: new Set(), argc: new Map(), examples: [] }));
    t.count++;
    t.maps.add(ev.source.replace(/\.(tmx|yaml)$/, ""));
    t.argc.set(argc, (t.argc.get(argc) ?? 0) + 1);
    if (t.examples.length < 4 && !t.examples.includes(raw)) t.examples.push(raw);
  };
  for (const ev of events) {
    for (const a of ev.acts) bump(acts, a.type, ev, a.args.length, a.raw);
    for (const c of ev.conds) {
      bump(conds, c.type, ev, c.args.length, c.raw);
      bump(condOps, `${c.op} ${c.type}`, ev, c.args.length, c.raw);
    }
    for (const b of ev.behavs) bump(behavs, b.type, ev, b.args.length, b.raw);
  }
  const out = (m: Map<string, Tally>) =>
    [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
      .map(([k, t]) => ({
        type: k,
        count: t.count,
        maps: t.maps.size,
        argc: Object.fromEntries([...t.argc.entries()].sort((a, b) => a[0] - b[0])),
        examples: t.examples,
      }));
  const sum = (m: Map<string, Tally>) => [...m.values()].reduce((n, t) => n + t.count, 0);
  return {
    events: events.length,
    byKind: {
      tmxEvent: events.filter((e) => e.origin === "tmx" && e.kind === "event").length,
      tmxInit: events.filter((e) => e.origin === "tmx" && e.kind === "init").length,
      yamlEvent: events.filter((e) => e.origin !== "tmx" && e.kind === "event").length,
      yamlInit: events.filter((e) => e.origin !== "tmx" && e.kind === "init").length,
    },
    actionTypes: acts.size,
    actionUses: sum(acts),
    conditionTypes: conds.size,
    conditionUses: sum(conds),
    behaviourTypes: behavs.size,
    behaviourUses: sum(behavs),
    actions: out(acts),
    conditions: out(conds),
    conditionsByOperator: out(condOps),
    behaviours: out(behavs),
  };
}

const files = tally(loadAllFileEvents());
const maps = loadAllMaps();
const loaded = tally(maps.flatMap((m) => m.events));
const result = {
  source: process.env.TUXEMON_SRC ?? "/var/tmp/tuxemon-src",
  maps: maps.length,
  scenarios: Object.fromEntries(
    [...new Set(maps.map((m) => m.props.scenario ?? "(none)"))]
      .sort()
      .map((s) => [s, maps.filter((m) => (m.props.scenario ?? "(none)") === s).length]),
  ),
  files,
  loaded: {
    events: loaded.events,
    byKind: loaded.byKind,
    actionUses: loaded.actionUses,
    conditionUses: loaded.conditionUses,
  },
};
console.log(JSON.stringify(result, null, 1));
