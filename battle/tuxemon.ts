import {
  advanceBattle,
  enqueueAction,
  makePendingAction,
  nextRandom,
  randomChoice,
  randomIntInclusive,
  submitDecision,
  type BattleAction,
  type BattleCoreRules,
} from "./core.ts";
import { applyStatModifier, combatStats, monsterFromSnapshot, pythonRound } from "./stats.ts";
import {
  STAT_NAMES,
  type BattleMonster,
  type BattleStart,
  type BattleStatus,
  type DbRule,
  type DbTechnique,
  type PlayerPolicy,
  type StatName,
  type Stats,
  type TuxemonBattleDb,
  type TuxemonBattleDecision,
  type TuxemonBattleState,
} from "./types.ts";

const SORT_ORDER = ["potion", "utility", "quest", "meta", "damage"];
const TARGET_ORDER = [
  "enemy_monster",
  "own_monster",
  "enemy_team",
  "own_team",
  "enemy_trainer",
  "own_trainer",
] as const;
const RANGE_MAP: Record<string, readonly [StatName | "level", StatName | "resist"]> = {
  melee: ["melee", "armour"],
  touch: ["melee", "dodge"],
  ranged: ["ranged", "dodge"],
  reach: ["ranged", "armour"],
  reliable: ["level", "resist"],
};
const PERSISTENT_STATUSES = new Set(["burn", "poison"]);
const BOND_STATUSES = new Set(["grabbed", "lifeleech", "lifegift"]);

interface TechniqueResult {
  success: boolean;
  damage: number;
  multiplier: number;
  shouldTackle: boolean;
  hit: boolean;
  /** Upstream ScopeEffect's stat readout; combat_scope renders it as "AR:{AR} DE:{DE} ME:{ME} RD:{RD} SD:{SD}". */
  scope: Pick<Stats, "armour" | "dodge" | "melee" | "ranged" | "speed"> | null;
}

export function cloneBattleState(state: TuxemonBattleState): TuxemonBattleState {
  return JSON.parse(JSON.stringify(state)) as TuxemonBattleState;
}

export function getMonster(state: TuxemonBattleState, uid: number): BattleMonster {
  for (const party of state.parties) {
    const monster = party.find((candidate) => candidate.uid === uid);
    if (monster) return monster;
  }
  throw new Error(`battle: unknown monster uid ${uid}`);
}

export function getSide(state: TuxemonBattleState, uid: number): 0 | 1 {
  if (state.parties[0].some((monster) => monster.uid === uid)) return 0;
  if (state.parties[1].some((monster) => monster.uid === uid)) return 1;
  throw new Error(`battle: uid ${uid} has no owner`);
}

function activeOnSide(state: TuxemonBattleState, side: 0 | 1): BattleMonster[] {
  return state.field
    .filter((uid) => getSide(state, uid) === side)
    .map((uid) => getMonster(state, uid));
}

function aliveParty(state: TuxemonBattleState, side: 0 | 1): BattleMonster[] {
  return state.parties[side].filter((monster) => monster.currentHp > 0);
}

function targetGroup(
  state: TuxemonBattleState,
  objective: string,
  user: BattleMonster,
  target: BattleMonster,
): BattleMonster[] {
  const userSide = getSide(state, user.uid);
  const targetSide = getSide(state, target.uid);
  switch (objective) {
    case "enemy_monster": return [target];
    case "own_monster": return [user];
    case "enemy_team": return activeOnSide(state, targetSide);
    case "own_team": return activeOnSide(state, userSide);
    case "enemy_trainer": return aliveParty(state, targetSide);
    case "own_trainer": return aliveParty(state, userSide);
    default: throw new Error(`battle: unknown target objective '${objective}'`);
  }
}

/** Target order is deliberately stable; this is the documented set-order exemption. */
function objectiveTargets(
  state: TuxemonBattleState,
  objectives: readonly string[],
  user: BattleMonster,
  target: BattleMonster,
): BattleMonster[] {
  const seen = new Set<number>();
  const result: BattleMonster[] = [];
  for (const objective of objectives) {
    for (const monster of targetGroup(state, objective, user, target)) {
      if (!seen.has(monster.uid)) {
        seen.add(monster.uid);
        result.push(monster);
      }
    }
  }
  return result;
}

function techniqueTargets(
  state: TuxemonBattleState,
  technique: DbTechnique,
  user: BattleMonster,
  target: BattleMonster,
): BattleMonster[] {
  return objectiveTargets(
    state,
    TARGET_ORDER.filter((objective) => technique.target[objective]),
    user,
    target,
  );
}

function statusRecord(slug: string, linked: number | null, db: TuxemonBattleDb): BattleStatus {
  const model = db.status[slug];
  if (!model) throw new Error(`battle: unknown status '${slug}'`);
  return {
    slug,
    turn: (model.duration ?? 0) > 0 ? 1 : 0,
    stack: 1,
    uses: 0,
    linked,
    appliedEffects: [],
  };
}

function resetMoveStats(db: TuxemonBattleDb, monster: BattleMonster): void {
  for (const move of monster.moves) {
    const model = db.technique[move.slug];
    move.power = model.power;
    move.potency = model.potency;
  }
}

function applyStatusStart(db: TuxemonBattleDb, monster: BattleMonster): void {
  const current = monster.status;
  if (!current) return;
  const model = db.status[current.slug];
  for (const effect of model.effects) {
    if (effect.type !== "statchange" || current.appliedEffects.includes(effect.type)) continue;
    for (const [stat, modifier] of Object.entries(model.stat_modifiers ?? {})) {
      if (modifier) applyStatModifier(monster, stat as StatName, modifier, null, true);
    }
    current.appliedEffects.push(effect.type);
  }
}

function clearStatus(db: TuxemonBattleDb, monster: BattleMonster): void {
  if (!monster.status) return;
  monster.status = null;
  monster.statusBoosts = {};
  resetMoveStats(db, monster);
}

function applyStatus(
  db: TuxemonBattleDb,
  monster: BattleMonster,
  slug: string,
  linked: number | null,
): boolean {
  const incoming = db.status[slug];
  if (!incoming) throw new Error(`battle: unknown status '${slug}'`);
  const current = monster.status;
  if (current?.slug === slug) {
    current.stack = Math.min(current.stack + 1, incoming.max_stacks ?? 5);
    current.turn = 0;
    current.uses = 0;
    return false;
  }
  if (current) {
    const reaction = incoming.category === "positive"
      ? db.status[current.slug].on_positive_status
      : incoming.category === "negative"
        ? db.status[current.slug].on_negative_status
        : "replaced";
    if (reaction === "removed") {
      clearStatus(db, monster);
      return false;
    }
    if (reaction !== "replaced") return false;
    clearStatus(db, monster);
  }
  monster.status = statusRecord(slug, linked, db);
  applyStatusStart(db, monster);
  return true;
}

function statusConditionsPass(db: TuxemonBattleDb, monster: BattleMonster): boolean {
  if (!monster.status) return false;
  for (const condition of db.status[monster.status.slug].conditions ?? []) {
    if (condition.type !== "current_hp") continue;
    const [operator, raw] = condition.parameters;
    const right = Number(raw);
    const left = monster.currentHp / monster.base.hp;
    const passed = operator === ">" ? left > right
      : operator === ">=" ? left >= right
        : operator === "<" ? left < right
          : operator === "<=" ? left <= right
            : operator === "==" || operator === "=" ? left === right
              : operator === "!=" ? left !== right : false;
    if ((condition.operator === "not") === passed) return false;
  }
  return true;
}

function techniqueConditionsPass(
  technique: DbTechnique,
  target: BattleMonster,
): boolean {
  for (const condition of technique.conditions ?? []) {
    if (condition.type !== "status") return false;
    const actual = target.status?.slug === condition.parameters[0];
    if (condition.operator === "not" ? actual : !actual) return false;
  }
  return true;
}

function usableMoves(
  db: TuxemonBattleDb,
  monster: BattleMonster,
  target: BattleMonster,
): Array<{ moveIndex: number; slug: string }> {
  return monster.moves.flatMap((move, moveIndex) =>
    move.cooldown === 0 && techniqueConditionsPass(db.technique[move.slug], target)
      ? [{ moveIndex, slug: move.slug }]
      : [],
  );
}

function applyPreChecking(
  db: TuxemonBattleDb,
  state: TuxemonBattleState,
  user: BattleMonster,
  target: BattleMonster,
  selected: { moveIndex?: number; slug: string },
): { moveIndex?: number; slug: string } {
  const status = user.status;
  if (!status) return selected;
  const effect = db.status[status.slug].effects.find((candidate) =>
    ["charmed", "confused", "flinching", "noddingoff", "wild"].includes(candidate.type),
  );
  if (!effect) return selected;
  const p = effect.parameters;
  let replacements: Array<{ moveIndex?: number; slug: string }> = [];
  if (effect.type === "charmed") {
    if (nextRandom(state) > Number(p[0])) {
      const tech = db.technique[selected.slug];
      if (tech.target.enemy_monster || tech.target.enemy_team || tech.target.enemy_trainer) {
        state.hitRolls[String(user.uid)] = 1.1;
      }
    }
  } else if (effect.type === "confused") {
    user.isConfused = nextRandom(state) < Number(p[0]);
    if (user.isConfused) {
      const available = user.moves.flatMap((move, moveIndex) => {
        const tech = db.technique[move.slug];
        return move.cooldown === 0 && !tech.effects.some((rule) =>
          rule.type === "give" && rule.parameters.includes("confused"),
        ) ? [{ moveIndex, slug: move.slug }] : [];
      });
      if (available.length > 0) replacements = [randomChoice(state, available)];
      else replacements = [{ slug: db.status[status.slug].on_tech_use ?? "empty" }];
    }
  } else if (effect.type === "flinching") {
    if (nextRandom(state) > Number(p[0])) {
      replacements = [{ slug: db.status[status.slug].on_tech_use ?? "empty" }];
      status.uses++;
      if (status.uses >= 1) clearStatus(db, user);
    }
  } else if (effect.type === "noddingoff") {
    replacements = [{ slug: db.status[status.slug].on_tech_use ?? "empty" }];
  } else if (effect.type === "wild") {
    if (nextRandom(state) < Number(p[0])) {
      replacements = [{ slug: db.status[status.slug].on_tech_use ?? "empty" }];
      user.currentHp = Math.max(0, user.currentHp - Math.trunc(user.base.hp / Number(p[1])));
    }
  }
  // CombatSession.pre_checking performs a second random.choice even though
  // every current status plugin returns at most one replacement.
  return replacements.length > 0 ? randomChoice(state, replacements) : selected;
}

function applyPerformTechniqueStatus(
  db: TuxemonBattleDb,
  state: TuxemonBattleState,
  user: BattleMonster,
  preStatus: BattleStatus | null,
): void {
  if (!preStatus || user.status !== preStatus) return;
  const model = db.status[preStatus.slug];
  let followups: string[] = [];
  for (const effect of model.effects) {
    if (["chargedup", "charging", "exhausted"].includes(effect.type)) {
      clearStatus(db, user);
      if (model.on_tech_use) followups.push(model.on_tech_use);
    } else if (effect.type === "noddingoff" && preStatus.turn > 1) {
      if (nextRandom(state) > Number(effect.parameters[0]) ||
          ((model.duration ?? 0) > 0 && preStatus.turn > (model.duration ?? 0))) {
        clearStatus(db, user);
      }
    } else if (effect.type === "confused" && user.isConfused) {
      user.isConfused = false;
    }
  }
  if (followups.length === 0) return;
  // Upstream applies PERFORM_TECH's returned status in CombatSession and
  // again in CombatState. Keep both choices/draws for differential parity.
  const first = randomChoice(state, followups);
  applyStatus(db, user, first, null);
  const second = randomChoice(state, followups);
  applyStatus(db, user, second, null);
}

function affinity(db: TuxemonBattleDb, attack: string[], defend: string[]): number {
  let multiplier = 1;
  for (const attackType of attack) {
    for (const defendType of defend) {
      const row = db.element[attackType]?.types.find((entry) => entry.against === defendType);
      multiplier *= row?.multiplier ?? 1;
    }
  }
  return Math.max(0.25, Math.min(4, multiplier));
}

export function calculateDamage(
  db: TuxemonBattleDb,
  technique: DbTechnique,
  move: { power: number },
  user: BattleMonster,
  target: BattleMonster,
): readonly [number, number] {
  const range = RANGE_MAP[technique.range];
  if (!range) return [0, 0];
  const userStats = combatStats(user);
  const targetStats = combatStats(target);
  const strength = range[0] === "level"
    ? 7 + user.level
    : userStats[range[0]] * (7 + user.level);
  const resistance = Math.max(1, range[1] === "resist" ? 1 : targetStats[range[1]]);
  const multiplier = affinity(db, technique.types, target.types);
  return [Math.trunc(strength * move.power * multiplier / resistance), multiplier];
}

function recordDamage(
  state: TuxemonBattleState,
  attacker: BattleMonster,
  defender: BattleMonster,
): void {
  const key = String(defender.uid);
  const attackers = state.damageByDefender[key] ?? (state.damageByDefender[key] = []);
  if (!attackers.includes(attacker.uid)) attackers.push(attacker.uid);
}

function statusModifier(db: TuxemonBattleDb, status: string, host: BattleMonster): number {
  const applicable = (db.status[status].modifiers ?? [])
    .filter((modifier) => modifier.attribute === "type" && modifier.values.some((type) => host.types.includes(type)))
    .map((modifier) => modifier.multiplier);
  return applicable.length === 0 ? 1 : Math.min(...applicable);
}

function applyStatusTick(
  db: TuxemonBattleDb,
  state: TuxemonBattleState,
  host: BattleMonster,
  slug: string,
): boolean {
  const status = host.status;
  if (!status || status.slug !== slug) return false;
  let success = false;
  for (const effect of db.status[slug].effects) {
    const p = effect.parameters;
    switch (effect.type) {
      case "burnt":
      case "poisoned": {
        const damage = Math.trunc(host.base.hp / Number(p[0]) * statusModifier(db, slug, host));
        if (damage > 0) {
          host.currentHp = Math.max(0, host.currentHp - damage);
          success = true;
        } else clearStatus(db, host);
        break;
      }
      case "recover": {
        const heal = Math.min(Math.trunc(host.base.hp / Number(p[0])), host.base.hp - host.currentHp);
        host.currentHp += heal;
        success ||= heal > 0;
        break;
      }
      case "lifeleech": {
        if (status.linked !== null) {
          const linked = getMonster(state, status.linked);
          if (linked.currentHp > 0) {
            const amount = Math.min(
              Math.trunc(host.base.hp / Number(p[0])),
              host.currentHp,
              linked.base.hp - linked.currentHp,
            );
            host.currentHp -= amount;
            linked.currentHp += amount;
            success = true;
          } else clearStatus(db, host);
        }
        break;
      }
      case "lifegift": {
        if (status.linked !== null) {
          const linked = getMonster(state, status.linked);
          if (linked.currentHp > 0) {
            const amount = Math.min(
              Math.trunc(linked.base.hp / Number(p[0])),
              linked.currentHp,
              host.base.hp - host.currentHp,
            );
            linked.currentHp -= amount;
            host.currentHp += amount;
            success = true;
          } else clearStatus(db, host);
        }
        break;
      }
      case "grabbed":
      case "stuck": {
        const ranges = p[1]!.split(":");
        for (const move of host.moves) {
          if (ranges.includes(db.technique[move.slug].range)) {
            move.power = db.technique[move.slug].power / Number(p[0]);
            move.potency = db.technique[move.slug].potency / Number(p[0]);
          }
        }
        success = true;
        break;
      }
      case "wasting": {
        const damage = Math.trunc(host.base.hp / Number(p[0])) * status.turn;
        host.currentHp = Math.max(0, host.currentHp - damage);
        success = host.currentHp > 0;
        break;
      }
      // The upstream queue removes a performed action from history before
      // these hooks query it. Preserve that observable no-op.
      case "elemental_shield":
      case "feedback":
      case "prickly":
      case "retaliate":
      case "revenge":
        break;
      default:
        // statchange is ON_START/ON_END; the remaining main-line effects are
        // PRE_CHECKING, PERFORM_TECH, CHECK_PARTY_HP, or item/swap hooks.
        success = true;
    }
  }
  state.events.push({
    type: "status",
    turn: state.turn,
    status: slug,
    target: host.uid,
    success,
    hp: partyHp(state),
  });
  return success;
}

function applyTechniqueStatChanges(
  state: TuxemonBattleState,
  technique: DbTechnique,
  targets: BattleMonster[],
): void {
  for (const target of targets) {
    for (const [stat, modifier] of Object.entries(technique.stat_modifiers ?? {})) {
      if (!modifier) continue;
      const deviation = modifier.max_deviation
        ? randomIntInclusive(state, -modifier.max_deviation, modifier.max_deviation)
        : null;
      applyStatModifier(target, stat as StatName | "current_hp", modifier, deviation);
    }
  }
}

function partyHp(state: TuxemonBattleState): Record<string, number> {
  return Object.fromEntries(
    state.field.map((uid) => {
      const monster = getMonster(state, uid);
      return [String(uid), monster.currentHp];
    }),
  );
}

function partyStatuses(state: TuxemonBattleState): Record<string, string | null> {
  return Object.fromEntries(
    state.field.map((uid) => {
      const monster = getMonster(state, uid);
      return [String(uid), monster.status?.slug ?? null];
    }),
  );
}

function performTechnique(
  db: TuxemonBattleDb,
  state: TuxemonBattleState,
  action: BattleAction,
): void {
  const user = getMonster(state, action.user!);
  const target = getMonster(state, action.target);
  const technique = db.technique[action.ref];
  if (!technique) throw new Error(`battle: unknown technique '${action.ref}'`);
  const liveMove = action.moveIndex === undefined ? undefined : user.moves[action.moveIndex];
  const move = liveMove && liveMove.slug === action.ref
    ? liveMove
    : {
        slug: action.ref,
        cooldown: 0,
        power: technique.power,
        potency: technique.potency,
        hit: user.fallbackHit,
      };
  const before = partyHp(state);
  const preStatus = user.status;
  const result: TechniqueResult = {
    success: false,
    damage: 0,
    multiplier: 0,
    shouldTackle: false,
    hit: move.hit,
    scope: null,
  };
  const setHit = (hit: boolean): void => {
    result.hit = hit;
    move.hit = hit;
    if (!liveMove) user.fallbackHit = hit;
  };
  const targetWasOutOfRange = target.outOfRange;

  for (const effect of technique.effects) {
    if (targetWasOutOfRange && effect.type !== "appear") continue;
    const parameters = effect.parameters ?? [];
    const hitRoll = state.hitRolls[String(user.uid)] ?? 0;
    switch (effect.type) {
      case "damage": {
        setHit(technique.accuracy >= hitRoll);
        // DamageEffect reports the neutral multiplier even on a miss.
        if (!result.hit) {
          result.multiplier += 1;
          break;
        }
        const targets = techniqueTargets(state, technique, user, target);
        const enemySide = activeOnSide(state, getSide(state, target.uid));
        const spread = targets.filter((candidate) => enemySide.includes(candidate)).length > 1;
        for (const victim of targets) {
          let [damage, multiplier] = calculateDamage(db, technique, move, user, victim);
          if (spread && enemySide.includes(victim)) damage = Math.trunc(damage * 0.75);
          victim.currentHp = Math.max(0, victim.currentHp - damage);
          if (victim.uid === target.uid) {
            result.damage += damage;
            result.multiplier += multiplier;
          } else if (damage > 0) recordDamage(state, user, victim);
          result.success ||= damage > 0;
          result.shouldTackle ||= damage > 0;
        }
        break;
      }
      case "give": {
        const potency = nextRandom(state);
        if (move.potency < potency || technique.accuracy < hitRoll) break;
        const [condition, objectives] = parameters;
        const targets = objectiveTargets(state, objectives!.split(":"), user, target);
        for (const recipient of targets) {
          const linked = db.status[condition!].bond ? user.uid : null;
          applyStatus(db, recipient, condition!, linked);
        }
        result.success ||= targets.length > 0;
        break;
      }
      case "splash": {
        setHit(technique.accuracy >= hitRoll);
        let [damage, multiplier] = calculateDamage(db, technique, move, user, target);
        if (!result.hit) damage = Math.trunc(damage / Number(parameters[0]));
        const targets = techniqueTargets(state, technique, user, target);
        const enemySide = activeOnSide(state, getSide(state, target.uid));
        if (targets.filter((candidate) => enemySide.includes(candidate)).length > 1) {
          damage = Math.trunc(damage * 0.75);
        }
        for (const victim of targets) {
          victim.currentHp = Math.max(0, victim.currentHp - damage);
          if (victim.uid !== target.uid && damage > 0) recordDamage(state, user, victim);
        }
        result.damage += damage;
        result.multiplier += multiplier;
        result.success ||= damage > 0;
        result.shouldTackle ||= damage > 0;
        break;
      }
      case "healing": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        const targets = parameters[0]
          ? targetGroup(state, parameters[0], user, target)
          : techniqueTargets(state, technique, user, target);
        let changed = false;
        for (const recipient of targets) {
          const heal = Math.trunc(7 + recipient.level * technique.healing_power);
          const amount = Math.min(heal, recipient.base.hp - recipient.currentHp);
          recipient.currentHp += amount;
          changed ||= amount > 0;
        }
        result.success ||= changed;
        break;
      }
      case "switch": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        const targets = objectiveTargets(state, parameters[0]!.split(":"), user, target);
        const element = parameters[1] === "random"
          ? randomChoice(state, db.element_order ?? Object.keys(db.element))
          : parameters[1]!;
        for (const recipient of targets) {
          if (!recipient.types.includes(element)) recipient.types = [element];
        }
        result.success = true;
        break;
      }
      case "multiattack": {
        let hits = 0;
        let damage = 0;
        for (let index = 0; index < Number(parameters[0]); index++) {
          state.hitRolls[String(user.uid)] = nextRandom(state);
          if (technique.accuracy < state.hitRolls[String(user.uid)]!) break;
          hits++;
          damage += calculateDamage(db, technique, move, user, target)[0];
        }
        if (hits > 0) target.currentHp = Math.max(0, target.currentHp - damage);
        result.damage += damage;
        result.success ||= hits > 0;
        result.shouldTackle ||= hits > 0;
        break;
      }
      case "statchange": {
        if (!parameters[0]) break;
        const potency = nextRandom(state);
        if (move.potency < potency || technique.accuracy < hitRoll) break;
        applyTechniqueStatChanges(
          state,
          technique,
          objectiveTargets(state, parameters[0].split(":"), user, target),
        );
        result.success = true;
        break;
      }
      case "remove": {
        const potency = nextRandom(state);
        if (move.potency < potency || technique.accuracy < hitRoll) break;
        const targets = objectiveTargets(state, parameters[1]!.split(":"), user, target);
        for (const recipient of targets) {
          const current = recipient.status && db.status[recipient.status.slug];
          if (parameters[0] === "all" || current?.slug === parameters[0] || current?.category === parameters[0]) {
            clearStatus(db, recipient);
          }
        }
        result.success ||= targets.length > 0;
        break;
      }
      case "disappear": {
        user.outOfRange = true;
        const scheduled = makePendingAction(state, {
          kind: "technique",
          user: user.uid,
          target: target.uid,
          ref: parameters[0]!,
        });
        state.pending.push({ turn: state.turn + 1, action: scheduled });
        result.success = true;
        break;
      }
      case "appear": {
        user.outOfRange = false;
        result.success ||= !target.outOfRange;
        result.shouldTackle ||= !target.outOfRange;
        break;
      }
      case "prop_healing": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        const targets = objectiveTargets(state, parameters[0]!.split(":"), user, target);
        const amount = Math.trunc(user.base.hp * Number(parameters[1]));
        for (const recipient of targets) {
          recipient.currentHp = Math.min(recipient.base.hp, recipient.currentHp + amount);
        }
        result.success = true;
        break;
      }
      case "prop_damage": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        const targets = objectiveTargets(state, parameters[0]!.split(":"), user, target);
        const damage = Math.trunc(target.base.hp * Number(parameters[1]));
        for (const victim of targets) {
          victim.currentHp = Math.max(0, victim.currentHp - damage);
          if (victim.uid !== target.uid && damage > 0) recordDamage(state, user, victim);
        }
        result.damage += damage;
        result.success = true;
        result.shouldTackle = true;
        break;
      }
      case "cooldown_modifier": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        const targets = objectiveTargets(state, parameters[0]!.split(":"), user, target);
        const amount = Number(parameters[1]);
        const parameter = parameters[2]!;
        const value = parameters[3]!;
        for (const recipient of targets) {
          for (const candidate of recipient.moves) {
            const model = db.technique[candidate.slug];
            const selected = parameter === "types"
              ? model.types.includes(value)
              : String((model as unknown as Record<string, unknown>)[parameter]) !== value;
            if (!selected) continue;
            if (amount === 0) candidate.cooldown = Math.max(0, candidate.cooldown - 1);
            else if (candidate.cooldown <= model.recharge) candidate.cooldown = Math.min(10, candidate.cooldown + amount);
          }
        }
        result.success = true;
        break;
      }
      case "photogenesis": {
        if (state.inside) break;
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        if (user.currentHp >= user.base.hp) {
          result.success = true;
          break;
        }
        let [start, peak, end] = parameters.map(Number);
        let hour = state.hour;
        if (end! < start!) end! += 24;
        if (hour < start!) hour += 24;
        if (peak! < start!) peak! += 24;
        let multiplier = 0;
        if (end! <= 47 && hour <= 47 && peak! <= 47 && start! <= hour && hour < end!) {
          let distance = Math.abs(hour - peak!);
          if (distance > (end! - start!) / 2) distance = end! - start! - distance;
          multiplier = Math.max((db.shape[db.monster[user.slug].shape].attributes.hp / 2) *
            (1 - (distance / ((end! - start!) / 2)) ** 2), 0);
        }
        const heal = Math.trunc((7 + user.level * technique.healing_power) * multiplier);
        if (heal > 0) {
          user.currentHp += Math.min(heal, user.base.hp - user.currentHp);
          result.success = true;
        }
        break;
      }
      case "money": {
        setHit(technique.accuracy >= hitRoll);
        const damage = calculateDamage(db, technique, move, user, target)[0];
        if (result.hit) {
          if (getSide(state, user.uid) === 0) state.techniqueGold += damage;
        } else user.currentHp = Math.max(0, user.currentHp - damage);
        result.success ||= result.hit;
        result.shouldTackle ||= result.hit;
        break;
      }
      case "reverse": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        for (const recipient of objectiveTargets(state, parameters[0]!.split(":"), user, target)) {
          recipient.types = [...recipient.originalTypes];
        }
        result.success = true;
        break;
      }
      case "transfer": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        const [source, destination] = parameters[1] === "user_to_target"
          ? [user, target]
          : [target, user];
        if (source.status?.slug === parameters[0]) {
          clearStatus(db, source);
          // Upstream deliberately bypasses transition and ON_START here.
          destination.status = statusRecord(parameters[0]!, null, db);
          destination.status.turn = 0;
          result.success = true;
        }
        break;
      }
      case "sacrifice": {
        setHit(technique.accuracy >= hitRoll);
        if (!result.hit) break;
        const damage = Math.trunc(user.currentHp * Number(parameters[0]));
        user.currentHp = 0;
        target.currentHp = Math.max(0, target.currentHp - damage);
        result.damage += damage;
        result.success = true;
        result.shouldTackle = true;
        break;
      }
      case "empty":
        setHit(technique.accuracy >= hitRoll);
        result.success ||= result.hit;
        break;
      case "scope": {
        // Upstream ScopeEffect only formats a stat readout; it never rolls
        // accuracy or touches state, so `hit` persists its prior value.
        // It also reads target.armour/dodge/melee/ranged/speed directly
        // (scope.py:40-47), which are the monster's base_stats
        // (monster.py:350-372) with no stage or status modifier applied, so
        // this reads `target.base` rather than `combatStats(target)`.
        result.success = true;
        const { armour, dodge, melee, ranged, speed } = target.base;
        result.scope = { armour, dodge, melee, ranged, speed };
        break;
      }
      default:
        throw new Error(`battle: unsupported technique effect '${effect.type}' on '${technique.slug}'`);
    }
  }

  move.cooldown = technique.recharge;
  applyPerformTechniqueStatus(db, state, user, preStatus);
  if (result.shouldTackle) recordDamage(state, user, target);
  state.events.push({
    type: "technique",
    turn: state.turn,
    user: user.uid,
    target: target.uid,
    technique: technique.slug,
    hit: move.hit,
    success: result.success,
    damage: result.damage,
    multiplier: result.multiplier,
    // Omitted unless a scope-effect technique ran, so the oracle golden
    // trace (which predates this readout and never carries the key for the
    // trainer corpus, since `scope` isn't in it) stays byte-identical.
    ...(result.scope ? { scope: result.scope } : {}),
    hpBefore: before,
    hp: partyHp(state),
    statuses: partyStatuses(state),
  });
}

function statusSwapHook(db: TuxemonBattleDb, monster: BattleMonster): void {
  const current = monster.status;
  if (!current) return;
  for (const effect of db.status[current.slug].effects) {
    if (effect.type === "harpooned" || effect.type === "spiky") {
      monster.currentHp = Math.max(0, monster.currentHp - Math.trunc(monster.base.hp / Number(effect.parameters[0])));
    }
  }
}

function pruneMonsterActions(state: TuxemonBattleState, uid: number): void {
  state.queue = state.queue.filter((action) => action.user !== uid && action.target !== uid);
  state.pending = state.pending.filter(({ action }) => action.user !== uid && action.target !== uid);
}

function awardDefeat(state: TuxemonBattleState, loser: BattleMonster): void {
  const participants = (state.damageByDefender[String(loser.uid)] ?? [])
    .map((uid) => getMonster(state, uid));
  const playerParticipants = participants.filter((monster) =>
    getSide(state, monster.uid) === 0 && monster.currentHp > 0,
  );
  const reward = { loser: loser.uid, winners: [] as Array<{ uid: number; experience: number; trainingPoints: StatName[] }>, prize: 0 };
  for (const winner of playerParticipants) {
    // Tuxemon floors total XP by level before applying the species modifier,
    // rounds the resulting pool, then floor-divides it among participants.
    const baseExperience = Math.trunc(
      Math.floor(loser.totalExperience / loser.level) * loser.experienceModifier,
    );
    const awarded = winner.level >= 100
      ? 0
      : Math.floor(pythonRound(baseExperience) / Math.max(1, participants.length));
    winner.totalExperience += awarded;
    const gained: StatName[] = [];
    for (const stat of STAT_NAMES) {
      if (loser.base[stat] > winner.base[stat]) {
        const total = STAT_NAMES.reduce((sum, name) => sum + winner.trainingPoints[name], 0);
        if (total < 300 && winner.trainingPoints[stat] < 150) {
          winner.trainingPoints[stat]++;
          gained.push(stat);
        }
      }
    }
    winner.bond = Math.min(100, winner.bond + 3);
    reward.winners.push({ uid: winner.uid, experience: awarded, trainingPoints: gained });
  }
  if (state.kind === "trainer" && participants.some((monster) => getSide(state, monster.uid) === 0)) {
    if (state.moneyMethod === "conserved") reward.prize = Math.trunc(loser.level * loser.moneyModifier);
    else reward.prize = participants.filter((monster) =>
      getSide(state, monster.uid) === 0 && monster.currentHp > 0,
    ).length * Math.trunc(loser.level * loser.moneyModifier);
    state.prize += reward.prize;
  }
  state.rewards.push(reward);
  delete state.damageByDefender[String(loser.uid)];
  for (const attackers of Object.values(state.damageByDefender)) {
    const index = attackers.indexOf(loser.uid);
    if (index >= 0) attackers.splice(index, 1);
  }
}

function makeRules(db: TuxemonBattleDb): BattleCoreRules<BattleMonster, TuxemonBattleState> {
  function primaryTarget(state: TuxemonBattleState, uid: number): BattleMonster {
    const side = getSide(state, uid);
    const target = activeOnSide(state, side === 0 ? 1 : 0)[0];
    if (!target) throw new Error(`battle: monster ${uid} has no target`);
    return target;
  }

  function selectAction(
    state: TuxemonBattleState,
    uid: number,
    policy: PlayerPolicy | "ai",
    choice: number,
  ): Omit<BattleAction, "subPriority"> {
    const user = getMonster(state, uid);
    const targets = activeOnSide(state, getSide(state, uid) === 0 ? 1 : 0);
    const candidates = user.moves.flatMap((move, moveIndex) => targets.flatMap((target) =>
      move.cooldown === 0 && techniqueConditionsPass(db.technique[move.slug], target)
        ? [{ moveIndex, slug: move.slug, target }]
        : [],
    ));
    let selected: { moveIndex?: number; slug: string; target: BattleMonster };
    if (candidates.length === 0) {
      selected = { slug: user.fallback, target: targets[0]! };
      if (policy === "ai") selected = randomChoice(state, [selected]);
    } else if (policy === "ai") selected = randomChoice(state, candidates);
    else selected = candidates[Math.max(0, choice) % candidates.length]!;
    const checked = applyPreChecking(db, state, user, selected.target, selected);
    state.events.push({
      type: "decision",
      turn: state.turn,
      side: getSide(state, uid),
      user: uid,
      technique: checked.slug,
      target: selected.target.uid,
    });
    return {
      kind: "technique",
      user: uid,
      target: selected.target.uid,
      ref: checked.slug,
      moveIndex: checked.moveIndex,
    };
  }

  return {
    uid: (monster) => monster.uid,
    side: getSide,
    monster: getMonster,
    fainted: (monster) => monster.currentHp <= 0,
    fillPositions(state) {
      // Upstream restores a disappeared monster when its scheduled return
      // action was discarded (for example because that action's target
      // fainted). Due pending actions have already moved into our queue.
      for (const uid of state.field) {
        const monster = getMonster(state, uid);
        const hasReturnAction = state.queue.some((action) => action.user === uid) ||
          state.pending.some(({ action }) => action.user === uid);
        if (monster.outOfRange && !hasReturnAction) monster.outOfRange = false;
      }
      for (const side of [1, 0] as const) {
        while (activeOnSide(state, side).length < state.fieldSize) {
          const replacement = state.parties[side].find((monster) =>
            monster.currentHp > 0 && !state.field.includes(monster.uid),
          );
          if (!replacement) break;
          state.field.push(replacement.uid);
          // FieldMonsters retains trainer dictionary order: AI then player.
          state.field.sort((a, b) => getSide(state, b) - getSide(state, a));
          for (const active of state.field.map((uid) => getMonster(state, uid))) {
            if (active.status && BOND_STATUSES.has(active.status.slug)) clearStatus(db, active);
          }
          statusSwapHook(db, replacement);
          state.events.push({ type: "sendOut", turn: state.turn, side, monster: replacement.uid });
        }
      }
    },
    onDecisionStart(state, uid) {
      const monster = getMonster(state, uid);
      for (const move of monster.moves) move.cooldown = Math.max(0, move.cooldown - 1);
    },
    skipsDecision(state, uid) {
      const monster = getMonster(state, uid);
      return monster.outOfRange || state.pending.some(({ action }) => action.user === uid);
    },
    decideAi(state, uid) {
      return selectAction(state, uid, "ai", 0);
    },
    playerAction(state, uid, choice) {
      return selectAction(state, uid, state.policy, choice);
    },
    sortKey(state, action) {
      if (action.user === null) return [0, 0, 0];
      const technique = db.technique[action.ref];
      const primary = SORT_ORDER.indexOf(technique.sort);
      const order = primary < 0 ? SORT_ORDER.length : primary;
      const monster = getMonster(state, action.user);
      const speed = technique.sort === "meta" || technique.sort === "potion" ? 0 : Math.trunc(
        Math.max(combatStats(monster).speed, 0) *
        (1 + (db.technique_speed[technique.slug] ?? 0) * 0.25) +
        Math.max(combatStats(monster).dodge, 0) * 0.01,
      );
      // meta/potion actions really use zero; only speed_test clamps ordinary
      // techniques to a minimum of one.
      return [-order, speed, action.subPriority];
    },
    perform(state, action) {
      if (action.kind === "status") {
        applyStatusTick(db, state, getMonster(state, action.target), action.ref);
      } else if (action.kind === "technique") {
        performTechnique(db, state, action);
      } else {
        throw new Error("battle: item actions are reserved for GB3");
      }
    },
    checkParty(state) {
      for (const uid of [...state.field]) {
        const monster = getMonster(state, uid);
        if (monster.status?.slug === "diehard") {
          if (monster.currentHp === 1) clearStatus(db, monster);
          if (monster.currentHp <= 0) {
            monster.currentHp = 1;
            clearStatus(db, monster);
          }
        }
        if (monster.status?.slug === "recover" && monster.currentHp >= monster.base.hp) {
          monster.currentHp = monster.base.hp;
          clearStatus(db, monster);
        }
        if (monster.currentHp > 0) continue;
        pruneMonsterActions(state, uid);
        awardDefeat(state, monster);
        state.field = state.field.filter((candidate) => candidate !== uid);
        state.events.push({ type: "faint", turn: state.turn, monster: uid });
      }
    },
    queuePostActions(state) {
      for (const uid of state.field) {
        const monster = getMonster(state, uid);
        if (!monster.status || !statusConditionsPass(db, monster)) continue;
        if ((db.status[monster.status.slug].duration ?? 0) > 0) monster.status.turn++;
        enqueueAction(state, {
          kind: "status",
          user: null,
          target: uid,
          ref: monster.status.slug,
        });
      }
    },
    finish(state) {
      for (const monster of [...state.parties[0], ...state.parties[1]]) {
        monster.stages = {};
        monster.statusBoosts = {};
        monster.types = [...monster.originalTypes];
        monster.outOfRange = false;
        monster.isConfused = false;
        resetMoveStats(db, monster);
        for (const move of monster.moves) move.cooldown = 0;
        if (monster.currentHp <= 0) {
          monster.currentHp = 0;
          clearStatus(db, monster);
          monster.status = statusRecord("faint", null, db);
        } else if (monster.status && !PERSISTENT_STATUSES.has(monster.status.slug)) {
          clearStatus(db, monster);
        }
      }
      const outcome = state.outcome!;
      state.result = {
        outcome,
        playerDefeated: outcome === "lost" || outcome === "draw",
        battleLastResult: outcome === "ran" ? "run" : outcome,
        gold: state.techniqueGold + (outcome === "won" && state.kind === "trainer" ? state.prize : 0),
      };
    },
  };
}

export function createBattle(db: TuxemonBattleDb, start: BattleStart): TuxemonBattleState {
  let uid = 1;
  const state: TuxemonBattleState = {
    version: 1,
    kind: start.kind ?? "trainer",
    opponent: start.opponent ?? "opponent",
    policy: start.policy ?? "first",
    inside: start.inside ?? false,
    hour: start.hour ?? 12,
    fieldSize: start.fieldSize ?? 1,
    moneyMethod: start.moneyMethod ?? "conserved",
    rng: start.seed >>> 0,
    rngDraws: 0,
    turn: 0,
    phase: "housekeeping",
    parties: [
      start.player.map((snapshot) => monsterFromSnapshot(db, uid++, snapshot)),
      start.enemy.map((snapshot) => monsterFromSnapshot(db, uid++, snapshot)),
    ],
    field: [],
    queue: [],
    pending: [],
    hitRolls: {},
    decisionQueue: [],
    awaiting: null,
    outcome: null,
    events: [],
    rewards: [],
    prize: 0,
    techniqueGold: 0,
    damageByDefender: {},
    result: null,
    runAttempts: start.runAttempts ?? 0,
  };
  return advanceBattle(state, makeRules(db));
}

/** Immutable reducer entry point. Every returned value is ordinary JSON. */
export function reduceBattle(
  db: TuxemonBattleDb,
  previous: TuxemonBattleState,
  decision: TuxemonBattleDecision,
): TuxemonBattleState {
  const state = cloneBattleState(previous);
  if (decision.type !== "technique") {
    throw new Error(`battle: '${decision.type}' is reserved for GB3`);
  }
  return submitDecision(state, makeRules(db), decision.choice);
}

/** Deterministic headless helper used by golden tests and the future autoplay driver. */
export function runPolicyBattle(
  db: TuxemonBattleDb,
  start: BattleStart,
  maxDecisions = 10_000,
): TuxemonBattleState {
  let state = createBattle(db, start);
  for (let guard = 0; state.phase !== "ended" && guard < maxDecisions; guard++) {
    if (!state.awaiting) throw new Error(`battle: stalled in ${state.phase}`);
    const choice = state.policy === "cycle" ? state.turn - 1 : 0;
    state = reduceBattle(db, state, { type: "technique", choice });
  }
  if (state.phase !== "ended") throw new Error("battle: decision limit exceeded");
  return state;
}

export { applyStatus, clearStatus, makeRules, statusSwapHook, usableMoves };
