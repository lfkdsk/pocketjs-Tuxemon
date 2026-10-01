// Demo warp targets: one safe spawn per imported map.
//
// A chapter/warp menu needs a cell it can drop the player on for every map.
// The preferred spawn is a cell an upstream transfer already lands on (the
// cell is known to be reachable in play), provided it is standable and does
// not sit on any event area. If every incoming landing is covered by an
// event, the spawn is the standable, event-free cell nearest the first
// landing; maps nobody transfers to get the first such cell in row-major
// order. A spawn must be standable on the engine's own passage table and
// clear of every static event body (not just blocking ones: a teleport or
// playerTouch page on the spawn cell fires as soon as the player moves),
// the same invariants tests/warp-spawns.test.ts re-checks on the committed
// index.

import { buildPassage, type PassageTable } from "../vendor/pocket-rpgkit/src/engine/passability.ts";
import type { Command, MapDef, Project, Sheet } from "../vendor/pocket-rpgkit/src/engine/types.ts";

export const WARP_FORMAT = "pocket-tuxemon/warp/v1";

export interface WarpSpawn {
  /** Map id. */
  id: string;
  /** Display name (the imported map name, which is the en_US translation). */
  name: string;
  x: number;
  y: number;
  /** "transfer" = a clear incoming transfer landing; "fallback" = the
   *  standable event-free cell nearest the first landing (maps whose
   *  landings are all event-covered) or the first such cell in row-major
   *  order (maps nobody transfers to); "blocked" = the map has no
   *  standable event-free cell at all (every standable cell is solid
   *  terrain or covered by an event area), so the first incoming transfer
   *  landing is recorded as a best-effort marker and the spawn is not
   *  usable as a warp target. */
  from: "transfer" | "fallback" | "blocked";
}

export interface WarpIndex {
  format: typeof WARP_FORMAT;
  maps: WarpSpawn[];
}

interface Landing {
  x: number;
  y: number;
}

/** Cells covered by a static event body at map entry: the footprint of
 *  EVERY event (x/y/w/h), regardless of its pages. The imported corpus
 *  authors full-map visit-tracker regions this way (e.g. "Track route1"
 *  is a 40x20 playerTouch sensor), so maps blanketed by them have no
 *  event-free cell and are honestly marked blocked. */
function eventCells(map: MapDef): Set<number> {
  const cells = new Set<number>();
  for (const event of map.events ?? []) {
    const w = event.w ?? 1;
    const h = event.h ?? 1;
    for (let y = event.y; y < event.y + h; y++) {
      for (let x = event.x; x < event.x + w; x++) cells.add(y * map.width + x);
    }
  }
  return cells;
}

function standable(table: PassageTable, events: Set<number>, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= table.width || y >= table.height) return false;
  const index = y * table.width + x;
  return table.solid[index] === 0 && !events.has(index);
}

/** The standable, event-free cell nearest `ref` (squared Euclidean
 *  distance, row-major tie-break), or null when the map has none. */
function nearestClearCell(table: PassageTable, events: Set<number>, ref: Landing): Landing | null {
  let best: Landing | null = null;
  let bestDistance = Infinity;
  for (let y = 0; y < table.height; y++) {
    for (let x = 0; x < table.width; x++) {
      if (!standable(table, events, x, y)) continue;
      const dx = x - ref.x;
      const dy = y - ref.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

/** The first standable, event-free cell in row-major order, or null. */
function firstClearCell(table: PassageTable, events: Set<number>): Landing | null {
  for (let y = 0; y < table.height; y++) {
    for (let x = 0; x < table.width; x++) {
      if (standable(table, events, x, y)) return { x, y };
    }
  }
  return null;
}

/** Collect the static transfer landings each map receives, in deterministic
 *  order (map id, event, page, command; if-branches walked in order). */
function collectLandings(project: Project): Map<string, Landing[]> {
  const landings = new Map<string, Landing[]>();
  const walk = (commands: readonly Command[]): void => {
    for (const command of commands) {
      if (command.op === "transfer") {
        if (typeof command.map !== "string") continue; // variable target (faint point): not static
        if (typeof command.x !== "number" || typeof command.y !== "number") continue;
        const rows = landings.get(command.map);
        if (rows) rows.push({ x: command.x, y: command.y });
        else landings.set(command.map, [{ x: command.x, y: command.y }]);
      } else if (command.op === "if") {
        walk(command.then);
        if (command.else) walk(command.else);
      }
    }
  };
  for (const map of project.maps) {
    for (const event of map.events ?? []) {
      for (const page of event.pages) walk(page.commands);
    }
  }
  return landings;
}

export function buildWarpIndex(project: Project): WarpIndex {
  const sheets = new Map<string, Sheet>(project.sheets.map((sheet) => [sheet.id, sheet]));
  const tables = new Map<string, PassageTable>();
  const events = new Map<string, Set<number>>();
  const tableFor = (map: MapDef): PassageTable => {
    let table = tables.get(map.id);
    if (!table) {
      table = buildPassage(map, sheets);
      tables.set(map.id, table);
    }
    return table;
  };
  const eventsFor = (map: MapDef): Set<number> => {
    let cells = events.get(map.id);
    if (!cells) {
      cells = eventCells(map);
      events.set(map.id, cells);
    }
    return cells;
  };

  const landings = collectLandings(project);
  const maps: WarpSpawn[] = [];
  for (const map of project.maps) {
    const table = tableFor(map);
    const cells = eventsFor(map);
    const mapLandings = landings.get(map.id) ?? [];
    let spawn: WarpSpawn | null = null;
    // 1. Prefer an incoming transfer landing that is standable and clear
    //    of every event area.
    for (const landing of mapLandings) {
      if (standable(table, cells, landing.x, landing.y)) {
        spawn = { id: map.id, name: map.name || map.id, x: landing.x, y: landing.y, from: "transfer" };
        break;
      }
    }
    if (!spawn) {
      // 2. No clear landing: the standable event-free cell nearest the
      //    first landing (the map's natural entry point), or the first
      //    such cell in row-major order when nobody transfers here.
      const found = mapLandings.length > 0
        ? nearestClearCell(table, cells, mapLandings[0]!)
        : firstClearCell(table, cells);
      if (found) {
        spawn = { id: map.id, name: map.name || map.id, x: found.x, y: found.y, from: "fallback" };
      } else {
        // The map has no standable event-free cell (every standable cell
        // is solid terrain or covered by an event area, e.g. a full-map
        // visit-tracker region). Record the first transfer landing as a
        // best-effort marker so the index still names the map; the test
        // suite proves every "blocked" spawn sits on such a map.
        const landing = mapLandings[0];
        spawn = {
          id: map.id,
          name: map.name || map.id,
          x: landing?.x ?? 0,
          y: landing?.y ?? 0,
          from: "blocked",
        };
      }
    }
    maps.push(spawn);
  }
  return { format: WARP_FORMAT, maps };
}
