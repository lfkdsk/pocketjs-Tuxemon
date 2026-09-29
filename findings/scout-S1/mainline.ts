// findings/scout-S1/mainline.ts — campaign reachability and story gates
// (Scout S1; not product code).
//
//   bun findings/scout-S1/mainline.ts > findings/scout-S1/mainline.json
//
// The map graph follows every transition_teleport (and the `door`
// behaviour) regardless of its conditions, breadth-first from each
// campaign's start map (start_tuxemon.yaml). Per campaign it then lists
// the conditioned teleports ("gates"), every start_battle / char_talk
// pre_battle and which later conditions read that battle's outcome.

import { loadAllMaps, type TuxEvent, type TuxMap } from "./tuxsrc.ts";

const maps = loadAllMaps();
const bySlug = new Map(maps.map((m) => [m.slug, m]));
const stripTmx = (s: string) => s.replace(/\.tmx$/, "");

interface Edge { from: string; to: string; x: number; y: number; event: string; conds: string[] }
const edges: Edge[] = [];
for (const m of maps) {
  for (const ev of m.events) {
    // scenario yaml events are shared machinery (heal-teleports etc.), not map exits
    if (ev.origin === "scenario") continue;
    for (const a of ev.acts) {
      if (a.type === "transition_teleport" || a.type === "teleport") {
        edges.push({ from: m.slug, to: stripTmx(a.args[1]!), x: Number(a.args[2]), y: Number(a.args[3]), event: ev.name, conds: ev.conds.map((c) => c.raw) });
      }
    }
    for (const b of ev.behavs) {
      if (b.type === "door") edges.push({ from: m.slug, to: stripTmx(b.args[1]!), x: Number(b.args[2]), y: Number(b.args[3]), event: ev.name, conds: ev.conds.map((c) => c.raw) });
    }
  }
}

function bfs(start: string): { order: { map: string; depth: number }[]; reach: Set<string> } {
  const depth = new Map<string, number>([[start, 0]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const e of edges.filter((e) => e.from === cur).sort((a, b) => (a.to < b.to ? -1 : 1))) {
      if (!depth.has(e.to) && bySlug.has(e.to)) {
        depth.set(e.to, depth.get(cur)! + 1);
        q.push(e.to);
      }
    }
  }
  const order = [...depth.entries()].map(([map, d]) => ({ map, depth: d })).sort((a, b) => a.depth - b.depth || (a.map < b.map ? -1 : 1));
  return { order, reach: new Set(depth.keys()) };
}

const STARTS: Record<string, string> = {
  spyder: "spyder_bedroom",
  xero: "player_house_bedroom",
  water: "water_end_of_desert",
};

const isGateCond = (c: string) => !/^is char_at |^is char_facing |^is char_moved |^is button_pressed /.test(c);

function campaign(name: string, start: string) {
  const { order, reach } = bfs(start);
  const inReach = (m: TuxMap) => reach.has(m.slug);
  const evs = maps.filter(inReach).flatMap((m) => m.events.filter((e) => e.origin !== "scenario").map((e) => ({ m, e })));
  const gates = edges
    .filter((e) => reach.has(e.from) && e.conds.some(isGateCond))
    .map((e) => ({ from: e.from, to: e.to, event: e.event, gate: e.conds.filter(isGateCond) }));
  // battles
  const battles: { map: string; event: string; opponent: string; guard: string[] }[] = [];
  for (const { m, e } of evs) {
    for (const a of e.acts) {
      if (a.type === "start_battle" || a.type === "start_double_battle") {
        const opp = a.args[0] === "player" ? a.args[1]! : a.args[0]!;
        battles.push({ map: m.slug, event: e.name, opponent: opp, guard: e.conds.map((c) => c.raw) });
      }
    }
  }
  // who reads each opponent's outcome
  const readers = new Map<string, { map: string; event: string; cond: string; effect: string[] }[]>();
  for (const { m, e } of evs) {
    for (const c of e.conds) {
      if (c.type === "battle_outcome" || c.type === "battle_outcome_count") {
        const opp = c.args[2]!;
        const effect = [...new Set(e.acts.map((a) => a.type))].filter((t) => !["char_face", "lock_controls", "unlock_controls", "wait"].includes(t));
        (readers.get(opp) ?? readers.set(opp, []).get(opp)!).push({ map: m.slug, event: e.name, cond: c.raw, effect });
      }
    }
  }
  // battles whose outcome gates something other than the trainer's own talk/spawn
  const storyBattles = battles.map((b) => {
    const r = readers.get(b.opponent) ?? [];
    const gatesProgress = r.filter((x) => x.effect.some((t) => ["transition_teleport", "set_variable", "remove_npc", "add_item", "add_monster", "remove_collision", "create_npc", "pathfind", "char_move"].includes(t)));
    return { ...b, outcomeReaders: r.length, progressReaders: gatesProgress.map((x) => `${x.map}:${x.event} [${x.cond}] -> ${x.effect.join(",")}`).slice(0, 6) };
  });
  return {
    campaign: name,
    start,
    reachableMaps: order.length,
    order,
    conditionedExits: gates.length,
    gates: gates.slice(0, 80),
    battles: battles.length,
    battlesWithProgressReaders: storyBattles.filter((b) => b.progressReaders.length).length,
    storyBattles: storyBattles.filter((b) => b.progressReaders.length),
    randomEncounterEvents: evs.filter(({ e }) => e.acts.some((a) => a.type === "random_encounter")).length,
  };
}

const unreached = maps.map((m) => m.slug).filter((s) => !Object.values(STARTS).some((st) => bfs(st).reach.has(s)) && s !== "start_tuxemon");
console.log(
  JSON.stringify(
    {
      teleportEdges: edges.length,
      campaigns: Object.entries(STARTS).map(([n, s]) => campaign(n, s)),
      mapsUnreachableFromAnyCampaignStart: unreached.length,
      unreachedMaps: unreached,
    },
    null,
    1,
  ),
);
