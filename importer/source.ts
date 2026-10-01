// Tuxemon TMX/YAML event reader. Mirrors tuxemon/map/loader.py:
//   TMX  objects with type="event" | "init"; properties cond*/act*/behav*
//        in natural-sort key order (natsorted), box = int(px / 16).
//   YAML `events:` name -> {type, x, y, width, height, conditions, actions,
//        behav}; a map's own <name>.yaml plus its `scenario` property's
//        <scenario>.yaml are appended after the TMX events.
// Strings split like tuxemon/script/parser.py (action: "name a,b";
// condition: "is|not name a,b"; "\," escapes a comma).

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Defaults to the repo-local checkout created by tools/fetch-tuxemon.sh;
// set TUXEMON_SRC to point at an existing Tuxemon checkout instead.
export const TUXEMON_SRC = process.env.TUXEMON_SRC ?? resolve(import.meta.dir, "../.tuxemon-src");
export const MAPS_DIR = join(TUXEMON_SRC, "mods/tuxemon/maps");

export interface Rule {
  /** action / condition / behaviour type slug */
  type: string;
  args: string[];
  raw: string;
  /** Importer-created guard; excluded from the source-file coverage view. */
  synthetic?: boolean;
}
export interface Cond extends Rule {
  op: "is" | "not";
}
export interface TuxEvent {
  /** file the event was read from (tmx or yaml basename) */
  source: string;
  origin: "tmx" | "yaml" | "scenario" | "loaded";
  kind: "event" | "init";
  name: string;
  /** TMX object id (yaml events: null) */
  objectId: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
  conds: Cond[];
  acts: Rule[];
  behavs: Rule[];
}
export interface TuxMap {
  slug: string;
  width: number;
  height: number;
  props: Record<string, string>;
  events: TuxEvent[];
}

export interface CollisionRegion {
  key?: string;
  cells: [number, number][];
}

export function splitEscaped(s: string): string[] {
  if (!s.trim()) return [];
  return s.split(/(?<!\\),/).map((p) => p.replace(/\\,/g, ",").trim());
}

export function parseAction(text: string): Rule {
  const sp = text.indexOf(" ");
  const type = sp < 0 ? text : text.slice(0, sp);
  const args = sp < 0 ? [] : splitEscaped(text.slice(sp + 1));
  return { type, args, raw: text };
}

export function parseCondition(text: string): Cond {
  const words = text.split(" ");
  const op = words[0] === "not" ? "not" : "is";
  const type = words[1] ?? "";
  const rest = words.slice(2).join(" ");
  return { op, type, args: splitEscaped(rest), raw: text };
}

/** Python natsort-compatible enough for act10/act100/cond5 style keys. */
function natKey(s: string): (string | number)[] {
  return s.split(/(\d+)/).map((p, i) => (i % 2 ? Number(p) : p));
}
export function natCompare(a: string, b: string): number {
  const ka = natKey(a);
  const kb = natKey(b);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    const x = ka[i]!;
    const y = kb[i]!;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return ka.length - kb.length;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:-]+)="([^"]*)"/g)) out[m[1]!] = decode(m[2]!);
  return out;
}
function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");
}

export function readTmx(path: string): { width: number; height: number; props: Record<string, string>; events: TuxEvent[] } {
  const xml = readFileSync(path, "utf8");
  const source = path.split("/").pop()!;
  const mapTag = attrs(xml.match(/<map [^>]*>/)![0]);
  // map-level <properties> precede the first <layer>/<tileset>/<objectgroup>
  const props: Record<string, string> = {};
  const head = xml.slice(0, xml.search(/<(tileset|layer|objectgroup)[ >]/));
  for (const m of head.matchAll(/<property [^>]*\/>/g)) {
    const a = attrs(m[0]);
    props[a.name!] = a.value ?? "";
  }
  const events: TuxEvent[] = [];
  const re = /<object ([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g;
  for (const m of xml.matchAll(re)) {
    const a = attrs(m[1]!);
    const kind = a.type;
    if (kind !== "event" && kind !== "init") continue;
    const body = m[3] ?? "";
    const raw: [string, string][] = [];
    for (const p of body.matchAll(/<property [^>]*\/>/g)) {
      const pa = attrs(p[0]);
      raw.push([pa.name!, pa.value ?? ""]);
    }
    raw.sort((p, q) => natCompare(p[0], q[0]));
    const conds: Cond[] = [];
    const acts: Rule[] = [];
    const behavs: Rule[] = [];
    for (const [k, v] of raw) {
      if (k.startsWith("cond")) conds.push(parseCondition(v));
      else if (k.startsWith("act")) acts.push(parseAction(v));
      else if (k.startsWith("behav")) behavs.push(parseAction(v));
    }
    events.push({
      source,
      origin: "tmx",
      kind,
      name: a.name ?? "",
      objectId: Number(a.id),
      x: Math.trunc(Number(a.x ?? 0) / 16),
      y: Math.trunc(Number(a.y ?? 0) / 16),
      w: Math.trunc(Number(a.width ?? 0) / 16),
      h: Math.trunc(Number(a.height ?? 0) / 16),
      conds,
      acts,
      behavs,
    });
  }
  return { width: Number(mapTag.width), height: Number(mapTag.height), props, events };
}

export function readYamlEvents(path: string, origin: "yaml" | "scenario" | "loaded"): TuxEvent[] {
  const doc = Bun.YAML.parse(readFileSync(path, "utf8")) as { events?: Record<string, any> } | null;
  const source = path.split("/").pop()!;
  const out: TuxEvent[] = [];
  for (const [name, ev] of Object.entries(doc?.events ?? {})) {
    const kind = ev?.type === "init" ? "init" : ev?.type === "event" ? "event" : null;
    if (!kind) continue;
    out.push({
      source,
      origin,
      kind,
      name,
      objectId: null,
      x: Number(ev.x ?? 0),
      y: Number(ev.y ?? 0),
      w: Number(ev.width ?? 1),
      h: Number(ev.height ?? 1),
      conds: ((ev.conditions ?? []) as string[]).map(parseCondition),
      acts: ((ev.actions ?? []) as string[]).map(parseAction),
      behavs: ((ev.behav ?? []) as string[]).map(parseAction),
    });
  }
  return out;
}

/** Every map as the engine loads it: TMX events, then <slug>.yaml, then the
 *  scenario yaml (MapLoader.resolve_yaml_files / _merge_events order). */
export function loadAllMaps(): TuxMap[] {
  const maps: TuxMap[] = [];
  for (const f of readdirSync(MAPS_DIR).filter((f) => f.endsWith(".tmx")).sort()) {
    const slug = f.slice(0, -4);
    const tmx = readTmx(join(MAPS_DIR, f));
    const events = [...tmx.events];
    const own = join(MAPS_DIR, `${slug}.yaml`);
    if (existsSync(own)) events.push(...readYamlEvents(own, "yaml"));
    const scen = tmx.props.scenario;
    if (scen) {
      const sp = join(MAPS_DIR, `${scen}.yaml`);
      if (existsSync(sp)) events.push(...readYamlEvents(sp, "scenario"));
    }
    // load_yaml appends another YAML's events at runtime. Statically include
    // those events with a per-map gate; the converter flips that gate at the
    // original load_yaml action. Tuxemon de-duplicates loaded event/init names.
    const seen = {
      event: new Set(events.filter((event) => event.kind === "event").map((event) => event.name)),
      init: new Set(events.filter((event) => event.kind === "init").map((event) => event.name)),
    };
    const loads = events.flatMap((event) =>
      event.acts.filter((action) => action.type === "load_yaml")
    );
    for (const action of loads) {
      const file = action.args[0];
      if (!file) continue;
      const loadedPath = join(MAPS_DIR, `${file}.yaml`);
      if (!existsSync(loadedPath)) {
        throw new Error(`load_yaml target does not exist: ${file}.yaml`);
      }
      for (const event of readYamlEvents(loadedPath, "loaded")) {
        if (seen[event.kind].has(event.name)) continue;
        seen[event.kind].add(event.name);
        events.push({
          ...event,
          conds: [
            {
              ...parseCondition(`is variable_set __loaded_yaml.${slug}.${file}:yes`),
              synthetic: true,
            },
            ...event.conds,
          ],
        });
      }
    }
    maps.push({ slug, width: tmx.width, height: tmx.height, props: tmx.props, events });
  }
  return maps;
}

/** Events per FILE (each yaml counted once, the way a grep census sees it). */
export function loadAllFileEvents(): TuxEvent[] {
  const out: TuxEvent[] = [];
  const files = readdirSync(MAPS_DIR).sort();
  for (const f of files.filter((f) => f.endsWith(".tmx"))) out.push(...readTmx(join(MAPS_DIR, f)).events);
  for (const f of files.filter((f) => f.endsWith(".yaml"))) out.push(...readYamlEvents(join(MAPS_DIR, f), "yaml"));
  return out;
}

/** en_US base.po msgid -> msgstr ("\\n" kept as the two-char escape). */
export function parsePo(path: string): Map<string, string> {
  const text = readFileSync(path, "utf8");
  const out = new Map<string, string>();
  let id: string | null = null, str: string | null = null, mode: "id" | "str" | null = null;
  // PO string: "...", C escapes. Tolerates one malformed upstream line
  // (spyder_omnichannel_dempsey1 lacks its closing quote).
  const unq = (s: string) => {
    let t = s.trim();
    if (t.startsWith('"')) t = t.slice(1);
    if (t.endsWith('"') && !t.endsWith('\\"')) t = t.slice(0, -1);
    return t.replace(/\\(["\\nt])/g, (_m, c: string) => (c === "n" ? "\\n" : c === "t" ? "\t" : c));
  };
  const flush = () => { if (id !== null && str !== null && id !== "") out.set(id, str); id = str = null; mode = null; };
  for (const line of text.split("\n")) {
    if (line.startsWith("msgid ")) { flush(); id = unq(line.slice(6)); mode = "id"; }
    else if (line.startsWith("msgstr ")) { str = unq(line.slice(7)); mode = "str"; }
    else if (line.startsWith('"')) { if (mode === "id") id += unq(line); else if (mode === "str") str += unq(line); }
    else if (!line.trim() || line.startsWith("#")) { /* separator/comment */ }
  }
  flush();
  return out;
}

/** Cells covered by closed `collision*` rects of a TMX (loader.region_tiles:
 *  both rect corners snapped to the nearest grid intersection). Tile-level
 *  colliders, collision lines and enter/exit edge props are NOT read here —
 *  that is the terrain importer's job; this is enough for a smoke walk. */
export function readCollisionCells(path: string): Set<string> {
  return new Set(readCollisionRegions(path).flatMap((region) =>
    region.cells.map(([x, y]) => `${x},${y}`)
  ));
}

/** Closed collision rectangles, retaining their optional `key`. Keyed
 * rectangles can be lowered to blocking events for remove_collision. */
export function readCollisionRegions(path: string): CollisionRegion[] {
  const xml = readFileSync(path, "utf8");
  const regions: CollisionRegion[] = [];
  for (const m of xml.matchAll(/<object ([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g)) {
    const a = attrs(m[1]!);
    if (!a.type?.toLowerCase().startsWith("collision") || a.width === undefined) continue;
    const x0 = Math.round(Number(a.x) / 16), y0 = Math.round(Number(a.y) / 16);
    const x1 = Math.round((Number(a.x) + Number(a.width)) / 16), y1 = Math.round((Number(a.y) + Number(a.height)) / 16);
    const cells: [number, number][] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cells.push([x, y]);
    const body = m[3] ?? "";
    let key: string | undefined;
    for (const property of body.matchAll(/<property [^>]*\/>/g)) {
      const p = attrs(property[0]);
      if (p.name === "key" && p.value) key = p.value;
    }
    regions.push({ key, cells });
  }
  return regions;
}
