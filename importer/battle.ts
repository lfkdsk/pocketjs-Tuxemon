// Deterministic battle-data and battle-art importer.
//
// Default scope is the Spyder campaign. Set BATTLE_DB_SCOPE=full to emit the
// complete upstream database. All selections are derived from Tuxemon YAML
// and map events; there are no hand-maintained monster or opponent lists.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize, relative } from "node:path";
import { encodePNG } from "../vendor/pocket-rpgkit/vendor/pocketjs/tests/png.ts";
import { encodeImageEntry, pack, type PakBlob } from "../vendor/pocket-rpgkit/vendor/pocketjs/framework/compiler/pak.ts";
import { PAK_DTYPE, PSM } from "../vendor/pocket-rpgkit/vendor/pocketjs/contracts/spec/spec.ts";
import { decodePng } from "./png.ts";
import { loadAllMaps, TUXEMON_SRC, type Rule, type TuxEvent, type TuxMap } from "./source.ts";
import {
  collectBattleArtRefs,
  validateBattleDb,
  type BattleAnimationRef,
  type BattleDb,
  type BattleImageRef,
  type BattlePlugin,
  type BattleRangeRule,
  type BattleScope,
  type BattleStat,
} from "./battle-schema.ts";

const PSM_4444 = PSM.PSM_4444;
const IMAGE_KEY_PREFIX = "ui:img.";
const DB_PAK_KEY = "game:battle-db";
const PLAYER_NAMES = new Set(["", "player"]);
const STATS = ["hp", "armour", "dodge", "melee", "ranged", "speed"] as const satisfies readonly BattleStat[];
const TECHNIQUE_SPEED_TIERS = {
  extremely_slow: -3,
  very_slow: -2,
  slow: -1,
  normal: 0,
  fast: 1,
  very_fast: 2,
  extremely_fast: 3,
} as const;
const ITEM_BEHAVIOR_DEFAULTS: Record<string, unknown> = {
  requires_monster_menu: true,
  show_dialog_on_success: true,
  show_dialog_on_failure: true,
  consumable: true,
  visible: true,
  resellable: false,
  throwable: false,
  holdable: false,
  repairable: false,
  craftable: false,
  destroy_on_break: false,
  wear_on_use: false,
  block_evolution: false,
};
/**
 * Upstream `db.database["element"]` insertion order for Tuxemon source
 * revision `9e6258ff726b786040a267e8bdbbf037b560285e`, captured via
 * `tools/battle-oracle/export_data.py`'s `element_order` field. Filesystem
 * directory listings are alphabetical, not Python dict insertion order, so
 * random `switch`/`switch_type` element picks would silently diverge from
 * the oracle without this pinned order.
 */
const ELEMENT_ORDER = [
  "frost", "heroic", "normal", "wood", "sky", "earth", "shadow", "venom",
  "water", "lightning", "metal", "cosmic", "fire",
] as const;
/** Defaults mirror upstream `StatModel` (`tuxemon/db.py:1440-1468`). */
const STAT_MODIFIER_DEFAULTS = {
  value: 0,
  step: null,
  max_deviation: 0,
  operation: "+",
  overridetofull: false,
  max_step_limit: 6,
  scaling_mode: "nonlinear",
} as const satisfies Record<string, unknown>;
const CAPTURE_DEVICE_DEFAULTS: Record<string, unknown> = {
  specific_capdev_modifier: null,
  positive_modifier: 1,
  negative_modifier: 1.2,
  specific_status_modifiers: null,
  fallback_element_malus: 0.2,
  specific_element_modifiers: null,
  fallback_gender_malus: 0.2,
  specific_gender_modifiers: null,
  fallback_variables_malus: 0.2,
  fallback_variables_bonus: 1.5,
  specific_variables_modifiers: null,
  random_bounds: null,
  capdev_persistent_on_success: false,
  capdev_persistent_on_failure: false,
  capdev_effects: null,
};

type Raw = Record<string, any>;

interface LocatedEvent {
  map: string;
  event: TuxEvent;
}

interface PartyMemberDraft {
  rawSpecies: string;
  species: string[];
  level: number;
  experienceModifier: number;
  moneyModifier: number;
}

interface PartyDraft {
  opponent: string;
  kind: "single" | "double";
  party: PartyMemberDraft[];
  sources: Array<{ map: string; event: string }>;
}

interface Selection {
  monsters: Set<string>;
  techniques: Set<string>;
  items: Set<string>;
  encounters: Set<string>;
  npcs: Set<string>;
  environments: Set<string>;
  trainerSheets: Set<string>;
  maxLevel: Map<string, number>;
  parties: PartyDraft[];
  eventCounts: {
    maps: number;
    battleSlots: number;
    opponents: number;
    partyDefinitions: number;
    trainerMonsterSlots: number;
    randomEncounterUses: number;
    wildEncounterUses: number;
  };
}

interface Tables {
  monster: Record<string, Raw>;
  technique: Record<string, Raw>;
  item: Record<string, Raw>;
  element: Record<string, Raw>;
  taste: Record<string, Raw>;
  status: Record<string, Raw>;
  encounter: Record<string, Raw>;
  npc: Record<string, Raw>;
  shape: Record<string, Raw>;
  environment: Record<string, Raw>;
  animation: Record<string, Raw>;
  economy: Record<string, Raw>;
}

export interface BattleAssetStats {
  sourceFiles: number;
  files: number;
  sourceBytes: number;
  pngBytes: number;
  textureBytes: number;
}

export interface BattleImportReport {
  format: "pocket-tuxemon/battle-import-report/v1";
  sourceRevision: string;
  scope: BattleScope;
  counts: {
    monsters: number;
    techniques: number;
    items: number;
    elements: number;
    tastes: number;
    statuses: number;
    encounters: number;
    npcs: number;
    environments: number;
    trainerParties: number;
    trainerMonsterSlots: number;
    battleSlots: number;
    randomEncounterUses: number;
    wildEncounterUses: number;
  };
  art: {
    sourceFiles: number;
    files: number;
    sourceBytes: number;
    pngBytes: number;
    textureBytes: number;
    pakBytes: number;
    maxWidth: number;
    maxHeight: number;
    categories: Record<string, BattleAssetStats>;
  };
  battleDbBytes: number;
  runtimeDbBytes: number;
  pakKey: string;
}

export interface BattleBuild {
  db: BattleDb;
  report: BattleImportReport;
  imagesJson: Record<string, { psm: number }>;
  assetPaths: string[];
}

export interface BattleImportOptions {
  outputRoot: string;
  sourceRoot?: string;
  scope?: BattleScope;
}

function object(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};
}

function list<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sortedKeys<T>(values: Record<string, T>): string[] {
  return Object.keys(values).sort();
}

function stableObject<T>(keys: Iterable<string>, source: Record<string, T>): Record<string, T> {
  return Object.fromEntries([...keys].sort().map((key) => [key, source[key]!]));
}

function readYaml(path: string): unknown {
  const text = readFileSync(path, "utf8");
  return extname(path) === ".json" ? JSON.parse(text) : Bun.YAML.parse(text);
}

function loadTable(dbRoot: string, name: string): Record<string, Raw> {
  const output: Record<string, Raw> = {};
  const directory = join(dbRoot, name);
  for (const file of readdirSync(directory).filter((entry) => /\.(?:yaml|json)$/.test(entry)).sort()) {
    const parsed = readYaml(join(directory, file));
    for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
      const value = object(row);
      const slug = string(value.slug);
      if (!slug) continue;
      output[slug] = { ...(output[slug] ?? {}), ...value };
    }
  }
  return output;
}

function loadTables(sourceRoot: string): Tables {
  const dbRoot = join(sourceRoot, "mods/tuxemon/db");
  return {
    monster: loadTable(dbRoot, "monster"),
    technique: loadTable(dbRoot, "technique"),
    item: loadTable(dbRoot, "item"),
    element: loadTable(dbRoot, "element"),
    taste: loadTable(dbRoot, "taste"),
    status: loadTable(dbRoot, "status"),
    encounter: loadTable(dbRoot, "encounter"),
    npc: loadTable(dbRoot, "npc"),
    shape: loadTable(dbRoot, "shape"),
    environment: loadTable(dbRoot, "environment"),
    animation: loadTable(dbRoot, "animation"),
    economy: loadTable(dbRoot, "economy"),
  };
}

function arg(rule: Rule, index: number, fallback = ""): string {
  return rule.args[index] || fallback;
}

function isPlayer(value: string): boolean {
  return PLAYER_NAMES.has(value);
}

function addLevel(levels: Map<string, number>, slug: string, level: number): void {
  levels.set(slug, Math.max(levels.get(slug) ?? 0, level));
}

function memberFromAction(
  action: Rule,
  tables: Tables,
  variables: Map<string, Set<string>>,
): PartyMemberDraft | null {
  const rawSpecies = arg(action, 0);
  const species = rawSpecies in tables.monster
    ? [rawSpecies]
    : [...(variables.get(rawSpecies) ?? [])].filter((slug) => slug in tables.monster).sort();
  if (!species.length) return null;
  return {
    rawSpecies,
    species,
    level: Math.trunc(number(arg(action, 1))),
    experienceModifier: number(arg(action, 3, "1"), 1),
    moneyModifier: number(arg(action, 4, "1"), 1),
  };
}

function buildSelection(scope: BattleScope, tables: Tables, allMaps: TuxMap[], sourceRoot: string): Selection {
  const maps = scope === "spyder"
    ? allMaps.filter((map) => map.props.scenario === "spyder" && map.slug !== "spyder_test_map")
    : allMaps;
  const events: LocatedEvent[] = maps.flatMap((map) => map.events.map((event) => ({ map: map.slug, event })));
  const variables = new Map<string, Set<string>>();
  const setVariable = (key: string, value: string) => {
    if (!variables.has(key)) variables.set(key, new Set());
    variables.get(key)!.add(value);
  };
  for (const { event } of events) {
    for (const action of event.acts) {
      if (action.type === "set_variable") {
        for (const pair of action.args) {
          const colon = pair.indexOf(":");
          if (colon >= 0) setVariable(pair.slice(0, colon), pair.slice(colon + 1));
        }
      } else if (action.type === "choice_monster") {
        for (const value of arg(action, 0).split(":")) setVariable(arg(action, 1), value);
      } else if (action.type === "set_random_variable") {
        for (const value of arg(action, 1).split(":")) setVariable(arg(action, 0), value);
      }
    }
  }

  const monsters = new Set<string>();
  const techniques = new Set<string>();
  const items = new Set<string>();
  const encounters = new Set<string>();
  const npcs = new Set<string>();
  const environments = new Set<string>();
  const trainerSheets = new Set<string>();
  const maxLevel = new Map<string, number>();
  const partiesByKey = new Map<string, PartyDraft>();
  let battleSlots = 0;
  let trainerMonsterSlots = 0;
  let randomEncounterUses = 0;
  let wildEncounterUses = 0;

  const actionsForOpponent = (map: string, current: TuxEvent, opponent: string, after: number, before: number): Rule[] => {
    const local = current.acts.slice(after + 1, before)
      .filter((action) => action.type === "add_monster" && arg(action, 2, "player") === opponent);
    if (local.length) return local;
    return events
      .filter((candidate) => candidate.map === map && candidate.event !== current)
      .flatMap((candidate) => candidate.event.acts)
      .filter((action) => action.type === "add_monster" && arg(action, 2, "player") === opponent);
  };

  for (const { map, event } of events) {
    const lastBattle = new Map<string, number>();
    for (let index = 0; index < event.acts.length; index++) {
      const action = event.acts[index]!;
      if (action.type !== "start_battle" && action.type !== "start_double_battle") continue;
      const opponents = [arg(action, 0), arg(action, 1, "player")].filter((name) => !isPlayer(name));
      for (const opponent of opponents) {
        battleSlots++;
        if (opponent in tables.npc) npcs.add(opponent);
        let candidates = actionsForOpponent(map, event, opponent, lastBattle.get(opponent) ?? -1, index);
        if (!candidates.length) {
          candidates = list<Raw>(tables.npc[opponent]?.monsters).map((row) => ({
            type: "add_monster",
            args: [string(row.slug), String(number(row.level)), opponent],
            raw: "npc-db party",
          }));
        }
        const party = candidates
          .map((candidate) => memberFromAction(candidate, tables, variables))
          .filter((member): member is PartyMemberDraft => member !== null);
        lastBattle.set(opponent, index);
        if (!party.length) continue;
        trainerMonsterSlots += party.length;
        for (const member of party) for (const species of member.species) {
          monsters.add(species);
          addLevel(maxLevel, species, member.level);
        }
        const kind = action.type === "start_double_battle" ? "double" : "single";
        const key = JSON.stringify([opponent, kind, party]);
        const found = partiesByKey.get(key);
        const source = { map, event: event.name };
        if (found) {
          if (!found.sources.some((candidate) => candidate.map === map && candidate.event === event.name)) found.sources.push(source);
        } else {
          partiesByKey.set(key, { opponent, kind, party, sources: [source] });
        }
      }
    }
  }

  const resolve = (raw: string, table: Record<string, Raw>): string[] => raw in table
    ? [raw]
    : [...(variables.get(raw) ?? [])].filter((slug) => slug in table).sort();

  for (const { map, event } of events) {
    const isCheat = event.source === "spyder.yaml" && event.name === "Cheat Code ApexPlayer";
    for (const action of event.acts) {
      if (action.type === "random_encounter" && arg(action, 0) in tables.encounter) {
        encounters.add(arg(action, 0));
        randomEncounterUses++;
      } else if (action.type === "wild_encounter") {
        wildEncounterUses++;
        for (const slug of resolve(arg(action, 0), tables.monster)) {
          monsters.add(slug);
          addLevel(maxLevel, slug, Math.trunc(number(arg(action, 1))));
        }
      } else if (action.type === "add_monster" && isPlayer(arg(action, 2, "player")) && !isCheat) {
        for (const slug of resolve(arg(action, 0), tables.monster)) {
          monsters.add(slug);
          addLevel(maxLevel, slug, Math.trunc(number(arg(action, 1))));
        }
      } else if (action.type === "add_item") {
        const quantity = number(arg(action, 1, "1"), 1);
        if (quantity > 0 || !isPlayer(arg(action, 2, "player"))) {
          for (const slug of resolve(arg(action, 0), tables.item)) items.add(slug);
        }
      } else if (action.type === "add_tech" && arg(action, 1) in tables.technique) {
        techniques.add(arg(action, 1));
      } else if (action.type === "set_environment" && arg(action, 0) in tables.environment) {
        environments.add(arg(action, 0));
      } else if (action.type === "set_economy") {
        const economy = tables.economy[arg(action, 1)];
        for (const row of list<Raw>(economy?.items)) if (string(row.slug) in tables.item) items.add(string(row.slug));
      } else if (action.type === "trading") {
        // Trade rewards are intentionally outside the S4 214-monster battle
        // core; they enter naturally in full scope.
        if (scope === "full") for (const slug of resolve(arg(action, 1), tables.monster)) monsters.add(slug);
      }
    }
  }

  for (const slug of encounters) {
    const encounter = tables.encounter[slug]!;
    const rows = list<Raw>(encounter.monsters).length
      ? list<Raw>(encounter.monsters)
      : list<Raw>(object(encounter.horde).monsters);
    for (const row of rows) {
      const monster = string(row.monster);
      const levels = list<number>(row.level_range);
      if (!(monster in tables.monster)) continue;
      monsters.add(monster);
      addLevel(maxLevel, monster, number(levels[1], number(levels[0], 1)));
    }
  }

  // Tuxemon may give trainers items either from map actions or npc records.
  for (const npc of Object.values(tables.npc)) {
    for (const row of list<Raw>(npc.items)) if (string(row.slug) in tables.item) items.add(string(row.slug));
  }

  if (scope === "full") {
    for (const slug of sortedKeys(tables.monster)) monsters.add(slug);
    for (const slug of sortedKeys(tables.technique)) techniques.add(slug);
    for (const slug of sortedKeys(tables.item)) items.add(slug);
    for (const slug of sortedKeys(tables.encounter)) encounters.add(slug);
    for (const slug of sortedKeys(tables.npc)) npcs.add(slug);
    for (const slug of sortedKeys(tables.environment)) environments.add(slug);
  } else {
    for (const slug of monsters) {
      const max = maxLevel.get(slug) ?? 1;
      for (const move of list<Raw>(tables.monster[slug]?.moveset)) {
        if (move.learning_method === "fallback" || number(move.level_learned) <= max + 1) {
          const technique = string(move.technique);
          if (technique in tables.technique) techniques.add(technique);
        }
      }
    }
    for (const slug of items) {
      for (const effect of list<Raw>(tables.item[slug]?.effects)) {
        if (effect.type !== "learn_tm") continue;
        for (const technique of list<unknown>(effect.parameters).map(String)) {
          if (technique in tables.technique) techniques.add(technique);
        }
      }
    }
    // A technique's own effects can require another technique to exist
    // without any monster ever "learning" it: `disappear`'s first parameter
    // is the follow-up technique upstream schedules for next turn (e.g.
    // `altitude` -> `hawk`). Closing this transitively (a few passes is
    // enough; the upstream data has no long chains) keeps every reachable
    // follow-up technique in scope.
    for (let added = true; added;) {
      added = false;
      for (const slug of [...techniques]) {
        for (const effect of list<Raw>(tables.technique[slug]?.effects)) {
          if (effect.type !== "disappear") continue;
          const followUp = string(list<unknown>(effect.parameters)[0]);
          if (followUp in tables.technique && !techniques.has(followUp)) {
            techniques.add(followUp);
            added = true;
          }
        }
      }
    }
  }
  // Status `on_tech_use`/`on_item_use` may name a substitute technique (e.g.
  // the synthetic "empty" technique statuses like confused/flinching force
  // in place of the chosen move) rather than another status. No monster's
  // moveset ever "learns" these, so the moveset scan above never finds them;
  // ship them unconditionally, in every scope, since statuses always are.
  for (const status of Object.values(tables.status)) {
    for (const field of ["on_tech_use", "on_item_use"] as const) {
      const ref = optionalString(status[field]);
      if (ref && ref in tables.technique) techniques.add(ref);
    }
  }

  for (const slug of npcs) {
    const sheet = optionalString(tables.npc[slug]?.template?.combat_sheet);
    if (sheet) trainerSheets.add(sheet);
  }
  const appearancePath = join(sourceRoot, "mods/tuxemon/db/npc/appearance_options.yaml");
  for (const row of list<Raw>(readYaml(appearancePath))) {
    const sheet = optionalString(row.template?.combat_sheet);
    if (sheet) trainerSheets.add(sheet);
  }

  const parties = [...partiesByKey.values()]
    .sort((a, b) => a.opponent.localeCompare(b.opponent) || JSON.stringify(a.party).localeCompare(JSON.stringify(b.party)));
  for (const party of parties) party.sources.sort((a, b) => a.map.localeCompare(b.map) || a.event.localeCompare(b.event));
  return {
    monsters,
    techniques,
    items,
    encounters,
    npcs,
    environments,
    trainerSheets,
    maxLevel,
    parties,
    eventCounts: {
      maps: maps.length,
      battleSlots,
      opponents: npcs.size,
      partyDefinitions: parties.length,
      trainerMonsterSlots,
      randomEncounterUses,
      wildEncounterUses,
    },
  };
}

function expandStatModifiers(value: unknown): Record<string, import("./battle-schema.ts").BattleStatModifier> {
  return Object.fromEntries(
    Object.entries(object(value)).map(([stat, raw]) => [stat, { ...STAT_MODIFIER_DEFAULTS, ...object(raw) }]),
  );
}

function statusModifiers(value: unknown): import("./battle-schema.ts").BattleStatusModifier[] {
  return list<Raw>(value).map((entry) => ({
    attribute: string(entry.attribute),
    values: list<unknown>(entry.values).map(String),
    multiplier: number(entry.multiplier, 1),
  }));
}

function plugins(value: unknown): BattlePlugin[] {
  return list<Raw>(value).map((entry) => {
    const plugin: BattlePlugin = { type: string(entry.type) };
    if (Array.isArray(entry.parameters) && entry.parameters.length) plugin.parameters = entry.parameters;
    if (typeof entry.operator === "string") plugin.operator = entry.operator;
    return plugin;
  });
}

function nextPow2(value: number): number {
  let result = 1;
  while (result < value) result <<= 1;
  return result;
}

function blit(
  target: Uint8Array,
  targetWidth: number,
  source: Uint8Array,
  sourceWidth: number,
  sx: number,
  sy: number,
  width: number,
  height: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < height; y++) {
    const start = ((sy + y) * sourceWidth + sx) * 4;
    target.set(source.subarray(start, start + width * 4), ((dy + y) * targetWidth + dx) * 4);
  }
}

interface CookedAsset extends BattleImageRef {
  relative: string;
  rgba: Uint8Array;
  png: Uint8Array;
  source: string;
  sourceBytes: number;
  categories: Set<string>;
}

class BattleArtCooker {
  readonly assets = new Map<string, CookedAsset>();
  readonly animations = new Map<string, Omit<BattleAnimationRef, "flipAxes" | "loops">>();

  constructor(
    readonly sourceRoot: string,
    readonly outputRoot: string,
    readonly animationsTable: Record<string, Raw>,
  ) {}

  private sourcePath(relativePath: string): string {
    if (relativePath.includes("..") || relativePath.startsWith("/")) throw new Error(`battle art: unsafe source ${relativePath}`);
    const path = join(this.sourceRoot, "mods/tuxemon", relativePath);
    if (!existsSync(path)) throw new Error(`battle art: missing ${relativePath}`);
    return path;
  }

  private writeAsset(relativePath: string, rgba: Uint8Array, width: number, height: number, source: string, category: string, rect: [number, number, number, number]): BattleImageRef {
    if (width > 512 || height > 512 || nextPow2(width) !== width || nextPow2(height) !== height) {
      throw new Error(`battle art: ${relativePath} must be pow2 <=512, got ${width}x${height}`);
    }
    const cached = this.assets.get(relativePath);
    if (cached) {
      cached.categories.add(category);
      return { key: cached.key, width: cached.width, height: cached.height, rect };
    }
    const png = encodePNG(rgba, width, height);
    const path = join(this.outputRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    const key = `${IMAGE_KEY_PREFIX}${relativePath}`;
    this.assets.set(relativePath, {
      relative: relativePath,
      key,
      width,
      height,
      rect,
      rgba,
      png,
      source,
      sourceBytes: statSync(this.sourcePath(source)).size,
      categories: new Set([category]),
    });
    return { key, width, height, rect };
  }

  staticImage(source: string, category: string): BattleImageRef {
    const relativePath = `assets/battle/${source}`;
    const cached = this.assets.get(relativePath);
    if (cached) {
      cached.categories.add(category);
      return { key: cached.key, width: cached.width, height: cached.height, rect: cached.rect };
    }
    const image = decodePng(new Uint8Array(readFileSync(this.sourcePath(source))), source);
    const width = nextPow2(image.width);
    const height = nextPow2(image.height);
    if (width > 512 || height > 512) throw new Error(`battle art: ${source} pads to ${width}x${height}`);
    const rgba = new Uint8Array(width * height * 4);
    blit(rgba, width, image.rgba, image.width, 0, 0, image.width, image.height, 0, 0);
    return this.writeAsset(relativePath, rgba, width, height, source, category, [0, 0, image.width, image.height]);
  }

  animation(slug: string, category: string, visuals: Raw): BattleAnimationRef {
    let cached = this.animations.get(slug);
    if (!cached) {
      const meta = this.animationsTable[slug];
      if (!meta) throw new Error(`battle art: animation metadata missing for ${slug}`);
      const frameContentWidth = Math.trunc(number(meta.frame_x));
      const frameContentHeight = Math.trunc(number(meta.frame_y));
      if (frameContentWidth <= 0 || frameContentHeight <= 0) throw new Error(`battle art: ${slug} has invalid frame dimensions`);
      const source = `animations/${string(meta.file)}/${slug}.png`;
      const image = decodePng(new Uint8Array(readFileSync(this.sourcePath(source))), source);
      const sourceColumns = Math.floor(image.width / frameContentWidth);
      const sourceRows = Math.floor(image.height / frameContentHeight);
      const frameCount = sourceColumns * sourceRows;
      if (!frameCount) throw new Error(`battle art: ${slug} has no complete frames`);
      const frameWidth = nextPow2(frameContentWidth);
      const frameHeight = nextPow2(frameContentHeight);
      if (frameWidth > 512 || frameHeight > 512) throw new Error(`battle art: ${slug} frame exceeds 512px`);
      const maxColumns = Math.floor(512 / frameWidth);
      const maxRows = Math.floor(512 / frameHeight);
      const pageCapacity = maxColumns * maxRows;
      const pages: import("./battle-schema.ts").BattleAnimationPage[] = [];
      for (let firstFrame = 0, page = 0; firstFrame < frameCount; firstFrame += pageCapacity, page++) {
        const frames = Math.min(pageCapacity, frameCount - firstFrame);
        const columns = Math.min(maxColumns, frames);
        const rows = Math.ceil(frames / columns);
        const width = nextPow2(columns * frameWidth);
        const height = nextPow2(rows * frameHeight);
        const rgba = new Uint8Array(width * height * 4);
        for (let local = 0; local < frames; local++) {
          const sourceFrame = firstFrame + local;
          blit(
            rgba,
            width,
            image.rgba,
            image.width,
            (sourceFrame % sourceColumns) * frameContentWidth,
            Math.floor(sourceFrame / sourceColumns) * frameContentHeight,
            frameContentWidth,
            frameContentHeight,
            (local % columns) * frameWidth,
            Math.floor(local / columns) * frameHeight,
          );
        }
        const stem = source.slice(0, -4);
        const ref = this.writeAsset(
          `assets/battle/${stem}.page-${page}.png`,
          rgba,
          width,
          height,
          source,
          category,
          [0, 0, width, height],
        );
        pages.push({
          ...ref,
          firstFrame,
          frames,
          columns,
          frameWidth,
          frameHeight,
          contentWidth: frameContentWidth,
          contentHeight: frameContentHeight,
        });
      }
      cached = { slug, pages, durationMs: Math.round(number(meta.duration, 0.1) * 1000) };
      this.animations.set(slug, cached);
    } else {
      for (const page of cached.pages) this.assets.get(page.key.slice(IMAGE_KEY_PREFIX.length))!.categories.add(category);
    }
    return {
      ...cached,
      flipAxes: string(visuals.flip_axes),
      loops: Math.trunc(number(visuals.loop)),
    };
  }

  stats(): BattleImportReport["art"] {
    const all = [...this.assets.values()].sort((a, b) => a.relative.localeCompare(b.relative));
    const categories: Record<string, BattleAssetStats> = {};
    const categoryNames = [...new Set(all.flatMap((asset) => [...asset.categories]))].sort();
    for (const category of categoryNames) {
      const assets = all.filter((asset) => asset.categories.has(category));
      categories[category] = {
        sourceFiles: new Set(assets.map((asset) => asset.source)).size,
        files: assets.length,
        sourceBytes: [...new Map(assets.map((asset) => [asset.source, asset.sourceBytes])).values()]
          .reduce((sum, bytes) => sum + bytes, 0),
        pngBytes: assets.reduce((sum, asset) => sum + asset.png.byteLength, 0),
        textureBytes: assets.reduce((sum, asset) => sum + asset.width * asset.height * 2 + 8, 0),
      };
    }
    return {
      sourceFiles: new Set(all.map((asset) => asset.source)).size,
      files: all.length,
      sourceBytes: [...new Map(all.map((asset) => [asset.source, asset.sourceBytes])).values()]
        .reduce((sum, bytes) => sum + bytes, 0),
      pngBytes: all.reduce((sum, asset) => sum + asset.png.byteLength, 0),
      textureBytes: all.reduce((sum, asset) => sum + asset.width * asset.height * 2 + 8, 0),
      pakBytes: 0,
      maxWidth: Math.max(...all.map((asset) => asset.width)),
      maxHeight: Math.max(...all.map((asset) => asset.height)),
      categories,
    };
  }
}

function sourceRevision(sourceRoot: string): string {
  const proc = Bun.spawnSync({ cmd: ["git", "rev-parse", "HEAD"], cwd: sourceRoot, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`battle importer: cannot read source revision: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

function animationFor(cooker: BattleArtCooker, raw: Raw, category: string): BattleAnimationRef | undefined {
  const visuals = object(raw.visuals);
  const slug = optionalString(visuals.animation);
  return slug ? cooker.animation(slug, category, visuals) : undefined;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 1) + "\n");
}

/** Project the validated import down to fields read by spawn.ts,
 * from-battle-db.ts, runtime.ts, and the minimal scene. The complete database
 * remains the canonical artifact and pak entry; this smaller generated view
 * avoids retaining unrelated item/NPC/animation metadata in QuickJS. */
export function runtimeBattleDb(db: BattleDb): BattleDb {
  const monsters = Object.fromEntries(Object.entries(db.monsters).map(([slug, monster]) => [slug, {
    shape: monster.shape,
    stage: monster.stage,
    types: monster.types,
    height: monster.height,
    weight: monster.weight,
    genderWeights: monster.genderWeights,
    moveset: monster.moveset,
    art: monster.art,
  }]));
  const techniques = Object.fromEntries(Object.entries(db.techniques).map(([slug, technique]) => [slug, {
    sort: technique.sort,
    range: technique.range,
    speed: technique.speed,
    accuracy: technique.accuracy,
    potency: technique.potency,
    power: technique.power,
    healingPower: technique.healingPower,
    recharge: technique.recharge,
    types: technique.types,
    target: technique.target,
    effects: technique.effects,
    conditions: technique.conditions,
    statModifiers: technique.statModifiers,
  }]));
  const statuses = Object.fromEntries(Object.entries(db.statuses).map(([slug, status]) => [slug, {
    category: status.category,
    behaviors: status.behaviors,
    effects: status.effects,
    conditions: status.conditions,
    positiveTransition: status.positiveTransition,
    negativeTransition: status.negativeTransition,
    duration: status.duration,
    bond: status.bond,
    onTechniqueUse: status.onTechniqueUse,
    onItemUse: status.onItemUse,
    maxStacks: status.maxStacks,
    statModifiers: status.statModifiers,
    modifiers: status.modifiers,
  }]));
  return {
    format: db.format,
    sourceRevision: db.sourceRevision,
    scope: db.scope,
    rules: db.rules,
    shapes: db.shapes,
    elements: Object.fromEntries(Object.entries(db.elements).map(([slug, element]) => [slug, {
      multipliers: element.multipliers,
    }])),
    elementOrder: db.elementOrder,
    tastes: db.tastes,
    tasteOrder: db.tasteOrder,
    monsters,
    techniques,
    statuses,
    encounters: db.encounters,
    environments: Object.fromEntries(Object.entries(db.environments).map(([slug, environment]) => [slug, {
      background: environment.background,
    }])),
  } as unknown as BattleDb;
}

/** Build and materialise one battle-db/art scope. */
export function writeBattleArtifacts(options: BattleImportOptions): BattleBuild {
  const outputRoot = normalize(options.outputRoot);
  const sourceRoot = normalize(options.sourceRoot ?? TUXEMON_SRC);
  const scope = options.scope ?? "spyder";
  if (sourceRoot !== normalize(TUXEMON_SRC)) {
    throw new Error(`battle importer: sourceRoot ${sourceRoot} must match TUXEMON_SRC ${normalize(TUXEMON_SRC)}`);
  }
  const tables = loadTables(sourceRoot);
  const selection = buildSelection(scope, tables, loadAllMaps(), sourceRoot);
  const battleDir = join(outputRoot, "assets/battle");
  rmSync(battleDir, { recursive: true, force: true });
  mkdirSync(battleDir, { recursive: true });
  const cooker = new BattleArtCooker(sourceRoot, outputRoot, tables.animation);

  const shapes: BattleDb["shapes"] = {};
  for (const slug of sortedKeys(tables.shape)) {
    const attrs = object(tables.shape[slug]!.attributes);
    shapes[slug] = Object.fromEntries(STATS.map((stat) => [stat, number(attrs[stat])])) as Record<BattleStat, number>;
  }

  const elements: BattleDb["elements"] = {};
  for (const slug of sortedKeys(tables.element)) {
    const raw = tables.element[slug]!;
    const multipliers = Object.fromEntries(list<Raw>(raw.types)
      .map((row): [string, number] => [string(row.against), number(row.multiplier, 1)])
      .sort(([a], [b]) => a.localeCompare(b)));
    elements[slug] = {
      multipliers,
      icon: cooker.staticImage(string(raw.icon), "element-icons"),
      smallIcon: cooker.staticImage(`gfx/ui/icons/element/${slug}_type_small.png`, "element-icons"),
    };
  }
  const elementOrder = [...ELEMENT_ORDER];
  if (elementOrder.length !== Object.keys(elements).length || !elementOrder.every((slug) => slug in elements)) {
    throw new Error("battle importer: pinned ELEMENT_ORDER no longer matches mods/tuxemon/db/element; recapture element_order from tools/battle-oracle/export_data.py");
  }

  const tastes: BattleDb["tastes"] = {};
  const tasteOrder = Object.keys(tables.taste);
  for (const slug of sortedKeys(tables.taste)) {
    const raw = tables.taste[slug]!;
    const modifier = list<Raw>(raw.modifiers)[0] ?? {};
    const stat = string(list<unknown>(modifier.values)[0]) as BattleStat;
    tastes[slug] = {
      type: raw.taste_type === "warm" ? "warm" : "cold",
      rarity: number(raw.rarity_score, 1),
      stat,
      multiplier: number(modifier.multiplier, 1),
    };
  }

  const monsters: BattleDb["monsters"] = {};
  for (const slug of [...selection.monsters].sort()) {
    const raw = tables.monster[slug]!;
    const sheet = cooker.staticImage(`gfx/sprites/battle/${slug}-sheet.png`, "monster-sheets");
    monsters[slug] = {
      species: string(raw.species, slug),
      txmnId: Math.trunc(number(raw.txmn_id)),
      shape: string(raw.shape),
      stage: string(raw.stage),
      types: list<unknown>(raw.types).map(String),
      tags: list<unknown>(raw.tags).map(String),
      terrains: list<unknown>(raw.terrains).map(String),
      height: number(raw.height),
      weight: number(raw.weight),
      genderWeights: Object.fromEntries(Object.entries(object(raw.gender_weights)).map(([key, value]) => [key, number(value)])),
      catchRate: number(raw.catch_rate),
      catchResistance: [number(raw.lower_catch_resistance), number(raw.upper_catch_resistance)],
      moveset: list<Raw>(raw.moveset)
        .filter((move) => selection.techniques.has(string(move.technique)))
        .map((move) => ({
          technique: string(move.technique),
          level: Math.trunc(number(move.level_learned)),
          method: string(move.learning_method, "level_up"),
          ...(optionalString(move.evolution_stage_learned) ? { evolutionStage: string(move.evolution_stage_learned) } : {}),
        })),
      evolutions: list<Raw>(raw.evolutions)
        .filter((evolution) => !evolution.monster_slug || selection.monsters.has(string(evolution.monster_slug))),
      art: {
        sheet,
        front: [0, 0, 64, 64],
        back: [64, 0, 64, 64],
        menu: [[0, 64, 24, 24], [24, 64, 24, 24]],
      },
    };
  }

  const techniques: BattleDb["techniques"] = {};
  for (const slug of [...selection.techniques].sort()) {
    const raw = tables.technique[slug]!;
    const animation = animationFor(cooker, raw, "technique-animations");
    techniques[slug] = {
      id: Math.trunc(number(raw.tech_id)),
      sort: string(raw.sort),
      category: string(raw.category),
      range: string(raw.range),
      speed: string(raw.speed),
      accuracy: number(raw.accuracy),
      potency: number(raw.potency),
      power: number(raw.power),
      healingPower: number(raw.healing_power),
      recharge: number(raw.recharge),
      types: list<unknown>(raw.types).map(String),
      target: Object.fromEntries(Object.entries(object(raw.target)).map(([key, value]) => [key, Boolean(value)])),
      behaviors: object(raw.behaviors),
      effects: plugins(raw.effects),
      conditions: plugins(raw.conditions),
      statModifiers: expandStatModifiers(raw.stat_modifiers),
      messages: { use: optionalString(raw.use_tech), success: optionalString(raw.use_success), failure: optionalString(raw.use_failure) },
      ...(animation ? { animation } : {}),
    };
  }

  const items: BattleDb["items"] = {};
  for (const slug of [...selection.items].sort()) {
    const raw = tables.item[slug]!;
    const category = string(raw.category);
    const animation = animationFor(cooker, raw, "item-status-animations");
    items[slug] = {
      sort: string(raw.sort),
      category,
      usableIn: list<unknown>(raw.usable_in).map(String),
      cost: raw.cost === undefined || raw.cost === null ? null : number(raw.cost),
      consumable: raw.behaviors?.consumable !== false,
      effects: plugins(raw.effects),
      conditions: plugins(raw.conditions),
      behaviors: { ...ITEM_BEHAVIOR_DEFAULTS, ...object(raw.behaviors) },
      modifiers: list(raw.modifiers),
      statModifiers: expandStatModifiers(raw.stat_modifiers),
      immunityToStatus: list<unknown>(raw.immunity_to_status).map(String),
      ...(category === "capture" ? { captureSprite: cooker.staticImage(string(raw.sprite), "capture-devices") } : {}),
      ...(animation ? { animation } : {}),
    };
  }

  const statuses: BattleDb["statuses"] = {};
  for (const slug of sortedKeys(tables.status)) {
    const raw = tables.status[slug]!;
    const animation = animationFor(cooker, raw, "item-status-animations");
    statuses[slug] = {
      sort: string(raw.sort),
      category: optionalString(raw.category),
      behaviors: { persists_after_combat: false, ...object(raw.behaviors) },
      effects: plugins(raw.effects),
      conditions: plugins(raw.conditions),
      positiveTransition: optionalString(raw.on_positive_status),
      negativeTransition: optionalString(raw.on_negative_status),
      duration: raw.duration === undefined ? 0 : number(raw.duration),
      bond: Boolean(raw.bond),
      stepInterval: raw.step_interval === undefined ? 0 : number(raw.step_interval),
      stepEffectValue: raw.step_effect_value === undefined ? 0 : number(raw.step_effect_value),
      stepEffectType: optionalString(raw.step_effect_type),
      onTechniqueUse: optionalString(raw.on_tech_use),
      onItemUse: optionalString(raw.on_item_use),
      gainCondition: optionalString(raw.gain_cond),
      maxStacks: Math.trunc(number(raw.max_stacks, 5)),
      statModifiers: expandStatModifiers(raw.stat_modifiers),
      modifiers: statusModifiers(raw.modifiers),
      icon: cooker.staticImage(string(raw.icon), "status-icons"),
      ...(animation ? { animation } : {}),
    };
  }

  const encounters: BattleDb["encounters"] = {};
  for (const slug of [...selection.encounters].sort()) {
    const raw = tables.encounter[slug]!;
    const rows = list<Raw>(raw.monsters).length ? list<Raw>(raw.monsters) : list<Raw>(object(raw.horde).monsters);
    encounters[slug] = {
      type: string(raw.encounter_type, "single"),
      monsters: rows
        .filter((row) => selection.monsters.has(string(row.monster)))
        .map((row) => {
          const level = list<unknown>(row.level_range);
          return {
            monster: string(row.monster),
            level: [Math.trunc(number(level[0])), Math.trunc(number(level[1], number(level[0])))],
            weight: number(row.encounter_rate),
            experienceModifier: number(row.exp_req_mod, 1),
            heldItems: list(row.held_items),
            variables: list<Raw>(row.variables).map((variable) => ({ key: string(variable.key), value: String(variable.value) })),
          };
        }),
    };
  }

  const trainerSheets: Record<string, BattleImageRef> = {};
  for (const slug of [...selection.trainerSheets].sort()) {
    trainerSheets[slug] = cooker.staticImage(`gfx/sprites/player/${slug}.png`, "trainer-sheets");
  }
  const npcs: BattleDb["npcs"] = {};
  for (const slug of [...selection.npcs].sort()) {
    const raw = tables.npc[slug] ?? {};
    const combatSheet = optionalString(raw.template?.combat_sheet);
    npcs[slug] = {
      combat: object(raw.combat),
      items: list<Raw>(raw.items).map((row) => ({ slug: string(row.slug), ...(row.quantity === undefined ? {} : { quantity: number(row.quantity) }) })),
      combatSheet,
      ...(combatSheet && trainerSheets[combatSheet] ? { art: trainerSheets[combatSheet] } : {}),
    };
  }

  const environments: BattleDb["environments"] = {};
  for (const slug of [...selection.environments].sort()) {
    const graphics = object(tables.environment[slug]!.battle_graphics);
    const hud = object(graphics.hud);
    const icons = object(graphics.icons);
    const hudPaths: Record<string, string> = {
      player: string(hud.hud_player),
      opponent: string(hud.hud_opponent),
      playerTray: string(hud.tray_player),
      opponentTray: string(hud.tray_opponent),
      doublePlayer: string(hud.double_player, "gfx/ui/combat/double_player.png"),
      doubleOpponent: string(hud.double_opponent, "gfx/ui/combat/double_opponent.png"),
    };
    environments[slug] = {
      background: cooker.staticImage(string(graphics.background), "backgrounds"),
      island: cooker.staticImage(string(graphics.island_sheet), "islands"),
      hud: Object.fromEntries(Object.entries(hudPaths).map(([key, path]) => [key, cooker.staticImage(path, "hud")])),
      partyIcons: Object.fromEntries(Object.entries(icons).sort(([a], [b]) => a.localeCompare(b)).map(([key, path]) => [key, cooker.staticImage(string(path), "hud")])),
    };
  }

  const rangeIcons = Object.fromEntries(readdirSync(join(sourceRoot, "mods/tuxemon/gfx/ui/icons/range"))
    .filter((file) => file.endsWith(".png")).sort().map((file) => [file.slice(0, -4), cooker.staticImage(`gfx/ui/icons/range/${file}`, "range-speed-icons")]));
  const speedIcons = Object.fromEntries(readdirSync(join(sourceRoot, "mods/tuxemon/gfx/ui/icons/speed"))
    .filter((file) => file.endsWith(".png")).sort().map((file) => [file.slice(0, -4), cooker.staticImage(`gfx/ui/icons/speed/${file}`, "range-speed-icons")]));

  const monsterConfig = object(readYaml(join(sourceRoot, "mods/config_monster.yaml")));
  const combatConfig = object(readYaml(join(sourceRoot, "mods/config_combat.yaml")));
  const rawRangeMap = object(readYaml(join(sourceRoot, "mods/range_map.yaml")));
  const captureConfig = object(readYaml(join(sourceRoot, "mods/config_capture.yaml")));
  const rawCaptureDevices = object(readYaml(join(sourceRoot, "mods/capture_devices.yaml")));
  const selectedCapture = new Set([...selection.items].filter((slug) => tables.item[slug]?.category === "capture"));
  const captureDevices = {
    statusModifier: number(rawCaptureDevices.status_modifier, 1),
    deviceModifier: number(rawCaptureDevices.capdev_modifier, 1),
    items: Object.fromEntries([...selectedCapture].sort().map((slug) => [slug, {
      ...CAPTURE_DEVICE_DEFAULTS,
      ...object(rawCaptureDevices.items?.[slug]),
    }])),
  };
  const stages: Record<string, number> = {};
  for (let stage = -6; stage <= 6; stage++) stages[String(stage)] = stage < 0 ? 2 / (2 - stage) : (2 + stage) / 2;
  const rangeMap: Record<string, BattleRangeRule> = {};
  for (const slug of sortedKeys(rawRangeMap)) {
    const entries = list<Raw>(rawRangeMap[slug]);
    const user = entries.find((entry) => optionalString(entry.user_stat));
    const target = entries.find((entry) => optionalString(entry.target_stat));
    if (!user || !target) throw new Error(`battle importer: range ${slug} must define user_stat and target_stat`);
    rangeMap[slug] = {
      user: { stat: string(user.user_stat) as BattleRangeRule["user"]["stat"], weight: number(user.weight, 1) },
      target: { stat: string(target.target_stat) as BattleRangeRule["target"]["stat"], weight: number(target.weight, 1) },
    };
  }
  const experienceGroups = Object.fromEntries(sortedKeys(object(monsterConfig.experience_groups)).map((slug) => {
    const raw = object(monsterConfig.experience_groups[slug]);
    return [slug, {
      multiplier: number(raw.multiplier, 1),
      experienceCoefficient: number(raw.experience_coefficient, 3),
    }];
  }));

  const trainerParties: BattleDb["trainerParties"] = selection.parties.map((party, index) => ({
    id: `trainer.${party.opponent}.${String(index + 1).padStart(3, "0")}`,
    opponent: party.opponent,
    kind: party.kind,
    party: party.party.map((member) => ({
      species: member.species,
      ...(member.rawSpecies in tables.monster ? {} : { speciesVariable: member.rawSpecies }),
      level: member.level,
      experienceModifier: member.experienceModifier,
      moneyModifier: member.moneyModifier,
    })),
    sources: party.sources,
  }));

  const db: BattleDb = {
    format: "pocket-tuxemon/battle-db/v1",
    sourceRevision: sourceRevision(sourceRoot),
    scope,
    rules: {
      levelRange: [Math.trunc(number(list(monsterConfig.level_range)[0])), Math.trunc(number(list(monsterConfig.level_range)[1], 100))],
      trainingPoints: {
        maxPerStat: Math.trunc(number(monsterConfig.max_tps, 150)),
        maxTotal: Math.trunc(number(monsterConfig.max_total_tps, 300)),
        defaultGain: Math.trunc(number(monsterConfig.default_tp_gain, 1)),
      },
      statCoefficient: Math.trunc(number(monsterConfig.coeff_stats, 7)),
      ivRange: [Math.trunc(number(list(monsterConfig.iv_range)[0])), Math.trunc(number(list(monsterConfig.iv_range)[1], 15))],
      sizeVariation: {
        height: [number(list(monsterConfig.height_range)[0]), number(list(monsterConfig.height_range)[1])],
        weight: [number(list(monsterConfig.weight_range)[0]), number(list(monsterConfig.weight_range)[1])],
      },
      maxMoves: Math.trunc(number(monsterConfig.max_moves, 4)),
      catchRateRange: [number(list(monsterConfig.catch_rate_range)[0]), number(list(monsterConfig.catch_rate_range)[1], 100)],
      catchResistanceRange: [number(list(monsterConfig.catch_resistance_range)[0]), number(list(monsterConfig.catch_resistance_range)[1], 2)],
      experience: {
        acquisitionMultipliers: Object.fromEntries(sortedKeys(object(monsterConfig.experience_multipliers)).map((method) => [method, number(monsterConfig.experience_multipliers[method], 1)])),
        groups: experienceGroups,
      },
      statStages: stages,
      actionOrder: {
        sortOrder: list<unknown>(combatConfig.sort_order).map(String),
        speedTiers: TECHNIQUE_SPEED_TIERS,
        speedFactor: number(combatConfig.speed_factor, 0.25),
        dodgeModifier: number(combatConfig.dodge_modifier, 0.01),
        baseSpeedBonus: number(combatConfig.base_speed_bonus, 1),
        minSpeedModifier: number(combatConfig.min_speed_modifier, 1),
      },
      damage: {
        affinityMultiplierRange: [number(list(combatConfig.multiplier_range)[0], 0.25), number(list(combatConfig.multiplier_range)[1], 4)],
        rangeMap,
      },
      capture: captureConfig,
      captureDevices,
    },
    shapes,
    elements,
    elementOrder,
    tastes,
    tasteOrder,
    monsters,
    techniques,
    items,
    statuses,
    encounters,
    npcs,
    trainerParties,
    environments,
    ui: {
      hpBar: cooker.staticImage("gfx/ui/monster/hp_bar.png", "ui"),
      expBar: cooker.staticImage("gfx/ui/monster/exp_bar.png", "ui"),
      crosshairs: cooker.staticImage("gfx/ui/combat/crosshairs.png", "ui"),
      missingMonster: cooker.staticImage("gfx/sprites/battle/missing.png", "ui"),
      rangeIcons,
      speedIcons,
      trainerSheets,
    },
  };

  const pakKeys = new Set([...cooker.assets.values()].map((asset) => asset.key));
  validateBattleDb(db, pakKeys);
  const dbData = jsonBytes(db);
  const runtimeDbData = jsonBytes(runtimeBattleDb(db));
  const blobs: PakBlob[] = [...cooker.assets.values()].sort((a, b) => a.key.localeCompare(b.key)).map((asset) => ({
    key: asset.key,
    dtype: PAK_DTYPE.u8,
    data: encodeImageEntry({ width: asset.width, height: asset.height, rgba: asset.rgba }, PSM_4444),
  }));
  blobs.push({ key: DB_PAK_KEY, dtype: PAK_DTYPE.u8, data: dbData });
  const art = cooker.stats();
  art.pakBytes = pack(blobs).byteLength;

  const report: BattleImportReport = {
    format: "pocket-tuxemon/battle-import-report/v1",
    sourceRevision: db.sourceRevision,
    scope,
    counts: {
      monsters: Object.keys(monsters).length,
      techniques: Object.keys(techniques).length,
      items: Object.keys(items).length,
      elements: Object.keys(elements).length,
      tastes: Object.keys(tastes).length,
      statuses: Object.keys(statuses).length,
      encounters: Object.keys(encounters).length,
      npcs: Object.keys(npcs).length,
      environments: Object.keys(environments).length,
      trainerParties: trainerParties.length,
      trainerMonsterSlots: selection.eventCounts.trainerMonsterSlots,
      battleSlots: selection.eventCounts.battleSlots,
      randomEncounterUses: selection.eventCounts.randomEncounterUses,
      wildEncounterUses: selection.eventCounts.wildEncounterUses,
    },
    art,
    battleDbBytes: dbData.byteLength,
    runtimeDbBytes: runtimeDbData.byteLength,
    pakKey: DB_PAK_KEY,
  };

  mkdirSync(join(outputRoot, "data"), { recursive: true });
  mkdirSync(join(outputRoot, "ui"), { recursive: true });
  writeFileSync(join(outputRoot, "data/battle-db.json"), dbData);
  writeFileSync(join(outputRoot, "data/battle-runtime-db.json"), runtimeDbData);
  writeFileSync(join(outputRoot, "data/battle-assets-report.json"), jsonBytes(report));
  const paths = [...cooker.assets.keys()].sort();
  const source = "// AUTO-GENERATED by gen-assets.ts — do not edit.\n" +
    "// Keeping these literal paths reachable makes PocketJS bake every battle texture into the app pak.\n" +
    `export const BATTLE_ASSET_PATHS = ${JSON.stringify(paths, null, 2)} as const;\n`;
  writeFileSync(join(outputRoot, "ui/battle-assets.ts"), source);
  return {
    db,
    report,
    imagesJson: Object.fromEntries(paths.map((path) => [path, { psm: PSM_4444 }])),
    assetPaths: paths,
  };
}

export function appendBattleDbPakEntry(manifest: Array<{ key: string; file: string }>): Array<{ key: string; file: string }> {
  const entry = { key: DB_PAK_KEY, file: "data/battle-db.json" };
  return [...manifest.filter((candidate) => candidate.key !== DB_PAK_KEY), entry];
}

export function battleArtifactPaths(root: string): string[] {
  const base = join(root, "assets/battle");
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [relative(root, join(directory, entry.name)).replaceAll("\\", "/")]);
  return existsSync(base) ? walk(base).sort() : [];
}

export { DB_PAK_KEY };
