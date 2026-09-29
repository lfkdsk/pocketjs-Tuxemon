// findings/scout-S1/sim.ts — greedy story simulator under the P1 battle
// placeholder (Scout S1; not product code, an APPROXIMATION).
//
//   bun findings/scout-S1/sim.ts [spyder|xero|water] > findings/scout-S1/sim-<c>.json
//
// World model (what P1 can know without monsters/combat):
//   * the player can walk to any event on the current map and press
//     INTERACT there: char_at / char_facing / char_moved / button_pressed /
//     char_facing_tile / talk conditions are "player-satisfiable";
//   * trainer battles (start_battle / start_double_battle / scripted
//     wild_encounter) are auto-WON when the player's party is non-empty
//     (Tuxemon skips an illegal battle); random_encounter is a no-op;
//   * the clock is fixed at daytime, no music plays, the player's sprite
//     is the default; party = monsters given by add_monster to the player.
// Loop: run automatic (guard/spawn) events to quiescence, fire the first
// player event on this map that changes story state, otherwise walk
// (teleport BFS over exits whose conditions hold) to the nearest map that
// has one. Records the trace and where the story stops.

import { loadAllMaps, type Cond, type Rule, type TuxEvent, type TuxMap } from "./tuxsrc.ts";

const CAMPAIGN = process.argv[2] ?? "spyder";
const START: Record<string, { map: string; vars: Record<string, string> }> = {
  spyder: { map: "spyder_bedroom", vars: { scenario_choice: "spyder_campaign", gender_choice: "gender_male", race_choice: "white_male", method_money: "conserved" } },
  xero: { map: "player_house_bedroom", vars: { scenario_choice: "xero_campaign", gender_choice: "gender_male", race_choice: "white_male" } },
  water: { map: "water_end_of_desert", vars: { scenario_choice: "water_campaign", gender_choice: "gender_male", race_choice: "white_male" } },
};

const maps = new Map(loadAllMaps().map((m) => [m.slug, m]));

interface State {
  map: string;
  vars: Record<string, string>;
  items: Record<string, number>;
  party: string[];
  battles: Record<string, number>; // "opp:won" -> count
  money: number;
  trackers: Record<string, true>;
  npcs: Record<string, true>; // per map visit
  extra: TuxEvent[]; // load_yaml events for this visit
  choiceTurn: Record<string, number>;
}

const story = (s: State) => JSON.stringify([s.vars, s.items, s.party, s.battles, s.money, s.trackers]);
const clone = (s: State): State => JSON.parse(JSON.stringify(s));

const PLAYER_SPATIAL = new Set(["char_at", "char_facing", "char_moved", "button_pressed", "char_facing_tile", "char_facing_char"]);
const isPlayerEvent = (e: TuxEvent) =>
  e.behavs.some((b) => b.type === "talk") || e.conds.some((c) => c.op === "is" && PLAYER_SPATIAL.has(c.type));

function cmp(op: string, a: number, b: number): boolean {
  switch (op) {
    case "less_than": return a < b;
    case "less_or_equal": return a <= b;
    case "greater_than": return a > b;
    case "greater_or_equal": return a >= b;
    case "equals": return a === b;
    case "not_equals": return a !== b;
  }
  return false;
}

/** Truth of the bare condition (before is/not), P1 world model. */
function test(c: Cond, s: State, m: TuxMap): boolean | "blocked" {
  const a = c.args;
  switch (c.type) {
    case "variable_set":
      return a.every((p) => {
        const i = p.indexOf(":");
        const k = i < 0 ? p : p.slice(0, i);
        const v = i < 0 ? "" : p.slice(i + 1);
        return k in s.vars && (v === "" || s.vars[k] === v);
      });
    case "variable_is": {
      const num = (x: string) => (x in s.vars ? Number(s.vars[x]) : Number(x));
      return cmp(a[1]!, num(a[0]!), num(a[2]!));
    }
    case "char_at": case "char_facing": case "char_moved": case "button_pressed": case "char_facing_tile":
      return a[0] === "player" || c.type === "button_pressed" ? true : false;
    case "char_facing_char":
      return !!s.npcs[a[1]!];
    case "char_exists":
      return a[0] === "player" || !!s.npcs[a[0]!];
    case "battle_outcome":
      return a[0] === "player" && (s.battles[`${a[2]}:${a[1]}`] ?? 0) > 0;
    case "battle_outcome_count":
      return a[0] === "player" && (s.battles[`${a[2]}:${a[1]}`] ?? 0) >= Number(a[3]);
    case "char_defeated":
      return false;
    case "party_size":
      return a[0] === "player" ? cmp(a[1]!, s.party.length, Number(a[2])) : cmp(a[1]!, 1, Number(a[2]));
    case "has_item": {
      if (a[0] !== "player") return false;
      const q = s.items[a[1]!] ?? 0;
      return q > 0 && (!a[2] || !a[3] ? true : cmp(a[2], q, Number(a[3])));
    }
    case "has_monster":
      return a[0] === "player" && s.party.includes(a[1]!);
    case "music_playing":
      return false;
    case "environment_is":
      return false;
    case "time_is":
      if (a[0] === "stage_of_day") return a[1] === "equals" ? a[2] === "morning" : a[2] !== "morning";
      if (a[0] === "daytime") return a[1] === "equals" ? a[2] === "true" : a[2] !== "true";
      return false;
    case "current_state":
      return a[0]!.split(":").includes("WorldState");
    case "tracker":
      return !!s.trackers[a[1]!];
    case "money_is": {
      const amt = /^\d+$/.test(a[2]!) ? Number(a[2]) : Number(s.vars[a[2]!] ?? 0);
      return cmp(a[1]!, s.money, amt);
    }
    case "location_inside":
      return m.props.inside === "true";
    case "location_type":
      return a[0]!.split(":").includes(m.props.map_type ?? "notype");
    case "char_sprite":
      return false;
    case "check_char_parameter":
      return false;
    // P1 has no plague/kennel/evolution/step trackers/surfing: fixed answers
    case "party_infected":
      return a[2] === "none";
    case "has_kennel":
      return cmp(a[2]!, 0, Number(a[3]));
    case "kennel": case "check_evolution": case "check_max_tech": case "char_in":
    case "step_tracker": case "tile_property_updated": case "check_world":
    case "char_healed": case "has_tuxepedia":
      return false;
    case "cooldown_days":
      return true;
    default:
      return "blocked"; // monster/party internals etc.: unknowable in P1
  }
}

function holds(e: TuxEvent, s: State, m: TuxMap, blockedOut?: Set<string>): boolean {
  for (const c of e.conds) {
    const t = test(c, s, m);
    if (t === "blocked") {
      blockedOut?.add(`${c.op} ${c.type}`);
      // unknowable: `not X` passes, `is X` fails (conservative both ways)
      if (c.op === "is") return false;
      continue;
    }
    if ((c.op === "is") !== t) return false;
  }
  for (const b of e.behavs) if (b.type === "talk" && !s.npcs[b.args[0]!]) return false;
  return true;
}

interface Fired { map: string; event: string; changed: string[]; battles: string[]; teleport?: string }

function apply(e: TuxEvent, s0: State): { s: State; battles: string[]; teleport?: { map: string } } {
  const s = clone(s0);
  const battles: string[] = [];
  let teleport: { map: string } | undefined;
  const win = (opp: string) => {
    if (s.party.length === 0) return;
    // counts only matter up to battle_outcome_count's small thresholds
    s.battles[`${opp}:won`] = Math.min(3, (s.battles[`${opp}:won`] ?? 0) + 1);
    s.vars.battle_last_result = "won";
    s.vars.battle_last_winner = "player";
    s.vars.battle_last_trainer = opp;
    battles.push(opp);
  };
  for (const a of e.acts as Rule[]) {
    const g = a.args;
    switch (a.type) {
      case "set_variable":
        for (const p of g) { const i = p.indexOf(":"); s.vars[i < 0 ? p : p.slice(0, i)] = i < 0 ? "" : p.slice(i + 1); }
        break;
      case "clear_variable": for (const p of g) delete s.vars[p]; break;
      case "copy_variable": if (g[1]! in s.vars) s.vars[g[0]!] = s.vars[g[1]!]!; break;
      case "random_integer": s.vars[g[0]!] = g[1]!; break;
      case "set_random_variable": s.vars[g[0]!] = g[1]!.split(":")[0]!.split("=")[0]!; break;
      case "translated_dialog_choice": case "choice_monster": case "choice_npc": {
        const opts = g[0]!.split(":");
        const key = g[1]!;
        const turn = s.choiceTurn[`${e.source}/${e.name}`] ?? 0;
        s.choiceTurn[`${e.source}/${e.name}`] = turn + 1;
        s.vars[key] = opts[turn % opts.length]!;
        break;
      }
      case "add_item": {
        if (g[2] && g[2] !== "player") break;
        const item = g[0]! in s.vars ? s.vars[g[0]!]! : g[0]!;
        const q = g[1] ? Number(g[1]) : 1;
        s.items[item] = Math.max(0, (s.items[item] ?? 0) + q);
        if (s.items[item] === 0) delete s.items[item];
        break;
      }
      case "add_monster":
        if (!g[2] || g[2] === "player") s.party.push(g[0]! in s.vars ? s.vars[g[0]!]! : g[0]!);
        break;
      case "random_monster":
        if (!g[1] || g[1] === "player") s.party.push("random_monster");
        break;
      case "remove_monster": s.party.pop(); break;
      case "modify_money": if (g[0] === "player" && g[1]) s.money += Number(g[1]); break;
      case "add_tracker": s.trackers[g[1]!] = true; break;
      case "create_npc": s.npcs[g[0]!] = true; break;
      case "remove_npc": delete s.npcs[g[0]!]; break;
      case "start_battle": case "start_double_battle":
        if (s.npcs[g[0] === "player" ? g[1]! : g[0]!] || g[1] === "player" || g[0] === "player") win(g[0] === "player" ? g[1]! : g[0]!);
        break;
      case "wild_encounter": win(`wild:${g[0]}`); break;
      case "transition_teleport": case "teleport":
        if (g[0] === "player") teleport = { map: g[1]!.replace(/\.tmx$/, "") };
        break;
      case "teleport_faint":
        break;
      case "load_yaml": {
        // events appended for this visit
        s.extra.push(...[...maps.values()].flatMap(() => []));
        break;
      }
    }
  }
  return { s, battles, teleport };
}

function mapEvents(s: State): TuxEvent[] {
  const m = maps.get(s.map)!;
  return [...m.events, ...s.extra];
}

function enter(s: State, map: string): void {
  s.map = map;
  s.npcs = {};
  s.extra = [];
}

const trace: Fired[] = [];
const blockedConds = new Map<string, number>();
const visitedMaps: string[] = [];
let s: State = {
  map: "",
  vars: { ...START[CAMPAIGN]!.vars },
  items: {},
  party: [],
  battles: {},
  money: 500,
  trackers: {},
  npcs: {},
  extra: [],
  choiceTurn: {},
};
enter(s, START[CAMPAIGN]!.map);

const firedOnce = new Set<string>();
/** Repeatable events (a re-battle, a toggling choice) fire at most this
 *  many times in one run; the story trace wants first occurrences. */
const FIRE_CAP = 3;
const fireCount = new Map<string, number>();
const capped = (map: string, e: TuxEvent) => (fireCount.get(`${map}/${e.name}`) ?? 0) >= FIRE_CAP;
const bump = (map: string, e: TuxEvent) => fireCount.set(`${map}/${e.name}`, (fireCount.get(`${map}/${e.name}`) ?? 0) + 1);
const MAX_STEPS = 4000;

/** Automatic events to quiescence; a teleport switches map and continues. */
function settle(): void {
  for (let guard = 0; guard < 200; guard++) {
    const m = maps.get(s.map)!;
    if (!visitedMaps.includes(s.map)) visitedMaps.push(s.map);
    let progressed = false;
    for (const e of mapEvents(s)) {
      if (isPlayerEvent(e)) continue;
      const b = new Set<string>();
      if (!holds(e, s, m, b)) { for (const k of b) blockedConds.set(k, (blockedConds.get(k) ?? 0) + 1); continue; }
      const r = apply(e, s);
      const npcChange = JSON.stringify(r.s.npcs) !== JSON.stringify(s.npcs);
      const changed = story(r.s) !== story(s);
      if (!changed && !npcChange && !r.teleport) continue;
      const key = `${s.map}/${e.name}/${story(s)}/${JSON.stringify(s.npcs)}`;
      if (firedOnce.has(key) || capped(s.map, e)) continue;
      firedOnce.add(key);
      bump(s.map, e);
      if (changed || r.teleport) trace.push({ map: s.map, event: e.name, changed: diff(s, r.s), battles: r.battles, teleport: r.teleport?.map });
      const from = s.map;
      s = r.s;
      if (r.teleport && maps.has(r.teleport.map)) enter(s, r.teleport.map);
      progressed = true;
      if (s.map !== from) break;
    }
    if (!progressed) return;
  }
}

function diff(a: State, b: State): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a.vars), ...Object.keys(b.vars)])) if (a.vars[k] !== b.vars[k]) out.push(`${k}=${b.vars[k] ?? "(cleared)"}`);
  for (const k of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) if (a.items[k] !== b.items[k]) out.push(`item ${k}=${b.items[k] ?? 0}`);
  if (a.party.length !== b.party.length) out.push(`party=${b.party.join("+")}`);
  for (const k of Object.keys(b.battles)) if (a.battles[k] !== b.battles[k]) out.push(`won ${k}`);
  if (a.money !== b.money) out.push(`money=${b.money}`);
  return out;
}

/** Player events on this map that change story state (not pure exits). */
function playerCandidates(st: State): TuxEvent[] {
  const m = maps.get(st.map)!;
  return mapEvents(st).filter((e) => {
    if (!isPlayerEvent(e) || !holds(e, st, m)) return false;
    const r = apply(e, st);
    return story(r.s) !== story(st) && !firedOnce.has(`${st.map}/${e.name}/${story(st)}`) && !capped(st.map, e);
  });
}

/** Exits usable from the current state: player events that teleport. */
function exits(st: State): { e: TuxEvent; to: string }[] {
  const m = maps.get(st.map)!;
  const out: { e: TuxEvent; to: string }[] = [];
  for (const e of mapEvents(st)) {
    if (!isPlayerEvent(e) || !holds(e, st, m)) continue;
    const r = apply(e, st);
    if (r.teleport && maps.has(r.teleport.map) && r.teleport.map !== st.map) out.push({ e, to: r.teleport.map });
  }
  return out;
}

let steps = 0;
let stopReason = "";
outer: while (steps++ < MAX_STEPS) {
  settle();
  const here = playerCandidates(s);
  if (here.length) {
    const e = here[0]!;
    const r = apply(e, s);
    firedOnce.add(`${s.map}/${e.name}/${story(s)}`);
    bump(s.map, e);
    trace.push({ map: s.map, event: e.name, changed: diff(s, r.s), battles: r.battles, teleport: r.teleport?.map });
    s = r.s;
    if (r.teleport && maps.has(r.teleport.map)) enter(s, r.teleport.map);
    continue;
  }
  // BFS to the nearest map with a candidate (simulating arrivals)
  const seen = new Set([s.map]);
  let frontier: { st: State; path: string[] }[] = [{ st: s, path: [] }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const { st, path } of frontier) {
      for (const { to } of exits(st)) {
        if (seen.has(to)) continue;
        seen.add(to);
        const st2 = clone(st);
        enter(st2, to);
        // arrival runs the destination's automatic events in the sim proper
        const saved = s;
        s = st2;
        const before = trace.length;
        settle();
        const arrivedChanged = trace.length > before;
        const cand = playerCandidates(s);
        if (arrivedChanged || cand.length) {
          trace.splice(before, 0, { map: s.map, event: `(walk ${[...path, to].join(" > ")})`, changed: [], battles: [] });
          continue outer;
        }
        // undo the probe
        trace.length = before;
        s = saved;
        next.push({ st: st2, path: [...path, to] });
      }
    }
    frontier = next;
  }
  stopReason = `no reachable map offers a state-changing event (searched ${seen.size} maps)`;
  break;
}

// events never fired in the campaign's maps, with their blocking conditions
const reach = new Set(visitedMaps);
const unfired: Record<string, number> = {};
for (const slug of reach) {
  const m = maps.get(slug)!;
  for (const e of m.events) {
    if (e.origin === "scenario") continue;
    if ([...firedOnce].some((k) => k.startsWith(`${slug}/${e.name}/`))) continue;
    for (const c of e.conds) {
      const t = test(c, s, m);
      if (t === "blocked" && c.op === "is") unfired[`is ${c.type}`] = (unfired[`is ${c.type}`] ?? 0) + 1;
    }
  }
}

// story events (they write variables/items/party) that never fired, with
// the conditions that fail in the final state
const firedNames = new Set([...fireCount.keys()]);
const neverFired: { event: string; failing: string[] }[] = [];
const failTally: Record<string, number> = {};
for (const slug of reach) {
  const m = maps.get(slug)!;
  for (const e of m.events) {
    if (e.origin === "scenario" || firedNames.has(`${slug}/${e.name}`)) continue;
    const writes = e.acts.some((a) => ["set_variable", "add_item", "add_monster", "start_battle", "transition_teleport"].includes(a.type));
    if (!writes) continue;
    const failing = e.conds.filter((c) => {
      const t = test(c, s, m);
      return t === "blocked" ? c.op === "is" : (c.op === "is") !== t;
    }).map((c) => c.raw);
    for (const f of failing) {
      const k = f.replace(/ .*?(,|$).*/, (x) => x.split(" ")[0] ?? x);
      const key = `${f.split(" ")[0]} ${f.split(" ")[1]}`;
      failTally[key] = (failTally[key] ?? 0) + 1;
      void k;
    }
    neverFired.push({ event: `${slug}:${e.name}`, failing });
  }
}

console.log(
  JSON.stringify(
    {
      campaign: CAMPAIGN,
      storyEventsNeverFired: neverFired.length,
      neverFiredFailingConditionTally: Object.fromEntries(Object.entries(failTally).sort((a, b) => b[1] - a[1])),
      neverFired,
      steps,
      stopReason,
      mapsVisited: visitedMaps.length,
      visitOrder: visitedMaps,
      battlesWon: Object.keys(s.battles).length,
      party: s.party,
      items: s.items,
      finalVars: Object.keys(s.vars).length,
      conditionsUnknowableInP1: Object.fromEntries([...blockedConds.entries()].sort((a, b) => b[1] - a[1])),
      unfiredEventsBlockedBy: unfired,
      trace,
    },
    null,
    1,
  ),
);
