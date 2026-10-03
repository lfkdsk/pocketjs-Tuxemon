#!/usr/bin/env bun
// zh_CN merged-catalog checker.
//
// Usage: bun run check:l10n
//
// Checks (all must pass):
//   1. coverage:   all catalog layers cover every en_US msgid
//   2. placeholders: each project-authored translation keeps the exact
//                    placeholder multiset and escaped-newline count
//   3. no empty translations
//   4. no residual English paragraphs (proper nouns must be glossary-listed)
//   5. terminology: glossary terms are enforced against the final merged text
//   6. supplement only fills gaps: it never overrides an upstream translation
//   7. override contract: each correction targets upstream and carries a
//                    category, reason, and exact en_US snapshot
//   8. explicit terminology exceptions have a non-empty reason
//   9. upstream consistency: every glossary row tagged source=upstream must
//                    agree with the upstream catalog (exact msgstr match, or
//                    the rendering appears in some upstream translation)

import { existsSync, readFileSync } from "node:fs";
import {
  ALLOWED_ENGLISH_TOKENS,
  EN_PO,
  GLOSSARY_TSV,
  OVERRIDES_PO,
  OVERRIDE_CATEGORIES,
  REVIEW_CATEGORIES,
  SUPPLEMENT_PO,
  UPSTREAM_REVIEW_JSONL,
  ZH_UPSTREAM_PO,
  countEscapedNewlines,
  englishRuns,
  isSuspiciousRun,
  loadGlossary,
  loadOverrideAnnotations,
  loadUpstreamReview,
  parsePo,
  runWhitelisted,
  samePlaceholderSet,
  stripPlaceholders,
  type GlossaryEntry,
  type OverrideAnnotations,
  type UpstreamReview,
} from "./l10n-lib.ts";
import { buildZhCatalog, normalizeZhPunctuation, ZH_BUILTIN_STRINGS } from "../importer/l10n.ts";

const EXCEPTIONS_FILE = GLOSSARY_TSV.replace("glossary.tsv", "glossary-exceptions.txt");
const MAX_FAILURES = 20;

export interface CheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

export interface L10nData {
  en: Map<string, string>;
  zhUpstream: Map<string, string>;
  overrides: Map<string, string>;
  supplement: Map<string, string>;
  merged: Map<string, string>;
  overrideAnnotations: OverrideAnnotations;
  review: UpstreamReview;
  glossary: GlossaryEntry[];
  exceptions: Map<string, string>;
}

export function loadData(): L10nData {
  for (const p of [EN_PO, ZH_UPSTREAM_PO, OVERRIDES_PO, SUPPLEMENT_PO, GLOSSARY_TSV]) {
    if (!existsSync(p)) throw new Error(`missing required file: ${p}`);
  }
  const exceptions = new Map<string, string>();
  if (existsSync(EXCEPTIONS_FILE)) {
    for (const [index, line] of readFileSync(EXCEPTIONS_FILE, "utf8").split("\n").entries()) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [id, term, ...reasonParts] = t.split("\t");
      if (!id || !term) throw new Error(`${EXCEPTIONS_FILE}:${index + 1}: expected msgid<TAB>term<TAB>reason`);
      exceptions.set(`${id}\t${term}`, reasonParts.join("\t").trim());
    }
  }
  return {
    en: parsePo(EN_PO),
    zhUpstream: parsePo(ZH_UPSTREAM_PO),
    overrides: parsePo(OVERRIDES_PO),
    supplement: parsePo(SUPPLEMENT_PO),
    merged: buildZhCatalog(),
    overrideAnnotations: loadOverrideAnnotations(),
    review: loadUpstreamReview(),
    glossary: loadGlossary(),
    exceptions,
  };
}

// --- 1. coverage -----------------------------------------------------------

export function checkCoverage(d: L10nData): CheckResult {
  const details: string[] = [];
  const covered = new Set([...d.zhUpstream.keys(), ...d.supplement.keys()]);
  const missing = [...d.en.keys()].filter((k) => !covered.has(k));
  const invented = [...d.supplement.keys()].filter((k) => !d.en.has(k));
  details.push(`en_US msgids: ${d.en.size}`);
  details.push(`override corrections: ${d.overrides.size}`);
  details.push(`upstream zh_CN translations: ${d.zhUpstream.size}`);
  details.push(`supplement translations: ${d.supplement.size}`);
  details.push(`importer built-in entries: ${Object.keys(ZH_BUILTIN_STRINGS).length}`);
  details.push(`final merged catalog entries: ${d.merged.size}`);
  details.push(`English fallbacks needed: ${[...d.en.keys()].filter((k) => !d.merged.has(k)).length}`);
  if (missing.length) details.push(`MISSING ${missing.length}: ${missing.slice(0, MAX_FAILURES).join(", ")}`);
  if (invented.length) details.push(`INVENTED ${invented.length}: ${invented.slice(0, MAX_FAILURES).join(", ")}`);
  return { name: "coverage", ok: missing.length === 0 && invented.length === 0, details };
}

// --- 2. placeholders --------------------------------------------------------

export function checkPlaceholders(d: L10nData): CheckResult {
  const details: string[] = [];
  const bad: string[] = [];
  const authored = [...d.supplement.entries(), ...d.overrides.entries()];
  for (const [id, zh] of authored) {
    const en = d.en.get(id);
    if (en === undefined) {
      bad.push(`${id}: no current en_US source`);
      continue;
    }
    if (!samePlaceholderSet(en, zh)) {
      bad.push(`${id}: en=[${extractList(en)}] zh=[${extractList(zh)}]`);
    } else if (countEscapedNewlines(en) !== countEscapedNewlines(zh)) {
      bad.push(`${id}: newline count ${countEscapedNewlines(en)} != ${countEscapedNewlines(zh)}`);
    }
  }
  details.push(`checked ${d.supplement.size} supplement + ${d.overrides.size} override translations`);
  if (bad.length) details.push(`FAILURES ${bad.length}:\n  ${bad.slice(0, MAX_FAILURES).join("\n  ")}`);
  return { name: "placeholders", ok: bad.length === 0, details };
}

function extractList(s: string): string {
  const ph = s.match(/\$\{\{[^{}]*\}\}|\$\{[^{}]*\}|\{[^{}]*\}/g) ?? [];
  return [...ph, ...Array(countEscapedNewlines(s)).fill("\\n")].join(" ");
}

// --- 3. empty translations --------------------------------------------------

export function checkEmpty(d: L10nData): CheckResult {
  const details: string[] = [];
  // An English source that is itself blank (e.g. combat_none = " ") is an
  // intentionally empty UI string; its translation may be blank as well.
  const empty = [...d.supplement.entries(), ...d.overrides.entries()]
    .filter(([k, v]) => !v.trim() && d.en.get(k)?.trim())
    .map(([k]) => k);
  details.push(`checked ${d.supplement.size} supplement + ${d.overrides.size} override translations`);
  if (empty.length) details.push(`EMPTY ${empty.length}: ${empty.slice(0, MAX_FAILURES).join(", ")}`);
  return { name: "no-empty", ok: empty.length === 0, details };
}

// --- 4. residual English ----------------------------------------------------

export function englishWhitelist(glossary: GlossaryEntry[]): Set<string> {
  const wl = new Set<string>([...ALLOWED_ENGLISH_TOKENS]);
  for (const g of glossary) {
    for (const w of g.en.toLowerCase().split(/[^a-z0-9]+/i)) {
      if (w) wl.add(w);
    }
  }
  return wl;
}

export function checkResidualEnglish(d: L10nData): CheckResult {
  const details: string[] = [];
  const wl = englishWhitelist(d.glossary);
  const bad: string[] = [];
  const authored = [...d.supplement.entries(), ...d.overrides.entries()];
  for (const [id, zh] of authored) {
    for (const run of englishRuns(stripPlaceholders(zh))) {
      if (isSuspiciousRun(run) && !runWhitelisted(run, wl)) {
        bad.push(`${id}: "${run.text}"`);
      }
    }
  }
  details.push(`checked ${authored.length} project-authored translations, whitelist ${wl.size} tokens`);
  if (bad.length) details.push(`FAILURES ${bad.length}:\n  ${bad.slice(0, MAX_FAILURES).join("\n  ")}`);
  return { name: "no-residual-english", ok: bad.length === 0, details };
}

// --- 5. terminology ---------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Enforce multi-word terms, long words (>=5 letters) and internally-capitalized
 * names. Short common words (Bomb, Kiss, Surf, ...) double as ordinary English
 * vocabulary, so they are enforced only when they are part of a longer term.
 *
 * A glossary zh value may list alternatives separated by a slash
 * (e.g. "Tuxemon／精灵"): any alternative appearing in the translation passes.
 */
export function isEnforceableTerm(en: string): boolean {
  const words = en.split(/\s+/);
  if (words.length >= 2) return true;
  if (en.length >= 5) return true;
  return /[A-Z]/.test(en.slice(1));
}

/**
 * Categories whose English names are proper nouns (or game jargon) rather
 * than ordinary vocabulary: matched case-insensitively, with English plural
 * and possessive inflections ("tuxeballs", "Tuxeball's", "Tuxeballs'").
 * Other categories (element, technique, menu) keep case-sensitive whole-word
 * matching because their entries double as common words ("fire", "strike").
 */
const INFLECTING_CATEGORIES = new Set(["monster", "item", "npc", "place", "other"]);

export function termRegex(g: GlossaryEntry): RegExp {
  const core = escapeRe(g.en);
  if (!INFLECTING_CATEGORIES.has(g.category)) {
    return new RegExp(`\\b${core}\\b`);
  }
  return new RegExp(`\\b${core}(?:s['’]?|['’]s)?(?![\\w'])`, "i");
}

export function termSatisfied(zh: string, glossaryZh: string): boolean {
  return glossaryZh.split(/[／/]/).some((alt) => zh.includes(normalizeZhPunctuation(alt)));
}

export function checkTerminology(d: L10nData): CheckResult {
  const details: string[] = [];
  const enforceable = d.glossary.filter((g) => isEnforceableTerm(g.en));
  const bad: string[] = [];
  let hits = 0;
  for (const [id, en] of d.en) {
    const zh = d.merged.get(id);
    if (zh === undefined) continue;
    const matched = enforceable.filter((g) => termRegex(g).test(en));
    // Prefer the most specific glossary phrase at an overlapping site. This
    // avoids contradictory demands such as Imperial -> 英制 inside the
    // separately defined item Imperial Potion -> 皇室治疗药水.
    const maximal = matched.filter((g) => !matched.some((other) =>
      other !== g
      && other.en.length > g.en.length
      && other.en.toLocaleLowerCase("en").includes(g.en.toLocaleLowerCase("en"))
    ));
    for (const g of maximal) {
      hits++;
      if (termSatisfied(zh, g.zh)) continue;
      if (d.exceptions.has(`${id}\t${g.en}`)) continue;
      bad.push(`${id}: "${g.en}" -> expected "${g.zh}" in: ${zh.slice(0, 60)}`);
    }
  }
  details.push(`checked final merged catalog (${d.en.size} en_US keys)`);
  details.push(`enforceable terms: ${enforceable.length}, term hits in texts: ${hits}`);
  if (bad.length) details.push(`FAILURES ${bad.length}:\n  ${bad.slice(0, MAX_FAILURES).join("\n  ")}`);
  return { name: "terminology", ok: bad.length === 0, details };
}

// --- 6. no overlap with upstream --------------------------------------------

export function checkNoOverlap(d: L10nData): CheckResult {
  const details: string[] = [];
  const overlap = [...d.supplement.keys()].filter((k) => d.zhUpstream.has(k));
  details.push(`supplement entries: ${d.supplement.size}`);
  if (overlap.length) details.push(`OVERLAP ${overlap.length}: ${overlap.slice(0, MAX_FAILURES).join(", ")}`);
  return { name: "no-overlap", ok: overlap.length === 0, details };
}

// --- 7. override contract ---------------------------------------------------

export function checkOverrides(d: L10nData): CheckResult {
  const details: string[] = [];
  const bad: string[] = [];
  const allowed = new Set<string>(OVERRIDE_CATEGORIES);
  for (const id of d.overrideAnnotations.duplicateIds) bad.push(`${id}: duplicate msgid`);
  for (const [id, zh] of d.overrides) {
    if (!d.zhUpstream.has(id)) bad.push(`${id}: override key is absent from upstream zh_CN`);
    const en = d.en.get(id);
    if (en === undefined) bad.push(`${id}: override key is absent from current en_US`);
    const meta = d.overrideAnnotations.entries.get(id);
    if (!meta) {
      bad.push(`${id}: missing annotation block`);
      continue;
    }
    if (!meta.category || !allowed.has(meta.category)) {
      bad.push(`${id}: invalid or missing category "${meta.category ?? ""}"`);
    }
    if (!meta.reason?.trim()) bad.push(`${id}: missing reason`);
    if (meta.en === undefined) bad.push(`${id}: missing en snapshot`);
    else if (en !== undefined && meta.en !== en) bad.push(`${id}: en snapshot is stale`);
    if (meta.duplicateFields.length) {
      bad.push(`${id}: duplicate annotation fields ${meta.duplicateFields.join(", ")}`);
    }
    if (d.zhUpstream.get(id) === zh) bad.push(`${id}: override does not change the upstream translation`);
  }
  for (const id of d.overrideAnnotations.entries.keys()) {
    if (!d.overrides.has(id)) bad.push(`${id}: annotations have no parsed override entry`);
  }
  details.push(`checked ${d.overrides.size} overrides in ${OVERRIDES_PO}`);
  if (bad.length) details.push(`FAILURES ${bad.length}:\n  ${bad.slice(0, MAX_FAILURES).join("\n  ")}`);
  return { name: "override-contract", ok: bad.length === 0, details };
}

// --- 8. exhaustive upstream review manifest --------------------------------

export function checkReviewManifest(d: L10nData): CheckResult {
  const details: string[] = [];
  const bad: string[] = [...d.review.parseErrors];
  const allowed = new Set<string>(REVIEW_CATEGORIES);
  for (const id of d.review.duplicateIds) bad.push(`${id}: duplicate review row`);
  for (const id of d.zhUpstream.keys()) {
    if (!d.review.entries.has(id)) bad.push(`${id}: missing review row`);
  }
  for (const [id, row] of d.review.entries) {
    const upstream = d.zhUpstream.get(id);
    const en = d.en.get(id);
    if (upstream === undefined) bad.push(`${id}: review row is not an upstream translation`);
    if (!allowed.has(row.category)) bad.push(`${id}: invalid category "${row.category}"`);
    if (row.action !== "keep" && row.action !== "override") bad.push(`${id}: invalid action "${row.action}"`);
    if (en === undefined) {
      if (!row.orphan || row.action !== "keep") bad.push(`${id}: current-en_US orphan must be marked orphan and kept`);
    } else if (row.orphan) {
      bad.push(`${id}: marked orphan but current en_US exists`);
    }
    const mandatory = row.category === "drift" || row.category === "mistranslation"
      || row.category === "omission" || row.category === "glossary";
    if (mandatory && row.action !== "override") bad.push(`${id}: ${row.category} must be overridden`);
    if (row.category === "ok" && row.action !== "keep") bad.push(`${id}: ok entry cannot be overridden`);
    if (row.category !== "ok" && !row.reason?.trim()) bad.push(`${id}: non-ok entry needs a reason`);
    if (row.action === "override") {
      if (!row.translation) bad.push(`${id}: override action needs a translation`);
      else if (d.overrides.get(id) !== row.translation) bad.push(`${id}: review translation differs from overrides.po`);
    } else if (d.overrides.has(id)) {
      bad.push(`${id}: overrides.po entry is not marked override in review`);
    }
  }
  const counts = new Map<string, number>();
  let fixed = 0;
  let orphans = 0;
  for (const row of d.review.entries.values()) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    if (row.action === "override") fixed++;
    if (row.orphan) orphans++;
  }
  details.push(`reviewed upstream entries: ${d.review.entries.size}/${d.zhUpstream.size}`);
  details.push(`categories: ${REVIEW_CATEGORIES.map((c) => `${c}=${counts.get(c) ?? 0}`).join(", ")}`);
  details.push(`override actions: ${fixed}; current-en_US orphans: ${orphans}`);
  details.push(`manifest: ${UPSTREAM_REVIEW_JSONL}`);
  if (bad.length) details.push(`FAILURES ${bad.length}:\n  ${bad.slice(0, MAX_FAILURES).join("\n  ")}`);
  return { name: "upstream-review", ok: bad.length === 0, details };
}

// --- 9. terminology exception reasons --------------------------------------

export function checkExceptionReasons(d: L10nData): CheckResult {
  const details: string[] = [];
  const bad: string[] = [];
  const terms = new Set(d.glossary.map((g) => g.en));
  for (const [key, reason] of d.exceptions) {
    const split = key.indexOf("\t");
    const id = key.slice(0, split);
    const term = key.slice(split + 1);
    if (!d.en.has(id)) bad.push(`${key}: unknown msgid`);
    if (!terms.has(term)) bad.push(`${key}: term is absent from glossary`);
    if (!reason) bad.push(`${key}: missing reason`);
  }
  details.push(`explicit exceptions with reasons: ${d.exceptions.size}`);
  if (bad.length) details.push(`FAILURES ${bad.length}:\n  ${bad.slice(0, MAX_FAILURES).join("\n  ")}`);
  return { name: "exception-reasons", ok: bad.length === 0, details };
}

// --- 7. upstream consistency -------------------------------------------------

const squeeze = (s: string): string => s.replace(/\s+/g, "");
const agrees = (gzh: string, uzh: string): boolean => {
  const a = squeeze(gzh);
  const b = squeeze(uzh);
  return a.includes(b) || b.includes(a);
};

/**
 * Every glossary row tagged source=upstream must agree with the upstream
 * catalog, so the tag cannot be used for renderings upstream never had.
 *
 * Tier 1: the glossary English is itself an en_US msgstr. The corresponding
 * upstream zh msgstr must contain the glossary rendering (or vice versa;
 * either direction covers the map-name rule "方絮" -> "方絮镇" and the
 * professor title "凯·雷恩" -> "凯·雷恩教授"). When upstream itself has
 * several renderings for the same English (Nudiflot ♂/♀, Berserk 狂暴/狂怒),
 * agreeing with any one of them passes.
 *
 * Tier 2: no en_US msgstr match (Omnichannel, Scoop, Shaft, ...). The
 * glossary rendering must appear verbatim in at least one upstream entry.
 */
export function checkUpstreamConsistency(d: L10nData): CheckResult {
  const details: string[] = [];
  const upstreamRows = d.glossary.filter((g) => g.source === "upstream");
  const enByMsgstr = new Map<string, string[]>();
  for (const [id, en] of d.en) {
    const ids = enByMsgstr.get(en);
    if (ids) ids.push(id);
    else enByMsgstr.set(en, [id]);
  }
  const upstreamZh = [...d.zhUpstream.values()];
  const bad: string[] = [];
  let tier1 = 0;
  let tier2 = 0;
  for (const g of upstreamRows) {
    const renders = (enByMsgstr.get(g.en) ?? [])
      .map((id) => d.zhUpstream.get(id))
      .filter((v): v is string => v !== undefined);
    if (renders.length > 0) {
      tier1++;
      if (!renders.some((u) => agrees(g.zh, u))) {
        bad.push(`${g.en} -> ${g.zh} (upstream: ${renders.join(" / ")})`);
      }
      continue;
    }
    if (upstreamZh.some((u) => u.includes(g.zh))) {
      tier2++;
      continue;
    }
    bad.push(`${g.en} -> ${g.zh} (no such rendering in upstream)`);
  }
  details.push(`upstream-source rows: ${upstreamRows.length} (tier1 ${tier1}, tier2 ${tier2})`);
  if (bad.length) details.push(`UNVERIFIED ${bad.length}:\n  ${bad.slice(0, MAX_FAILURES).join("\n  ")}`);
  return { name: "upstream-consistency", ok: bad.length === 0, details };
}

// --- driver -----------------------------------------------------------------

export function runAllChecks(d: L10nData): CheckResult[] {
  return [
    checkCoverage(d),
    checkNoOverlap(d),
    checkOverrides(d),
    checkReviewManifest(d),
    checkEmpty(d),
    checkPlaceholders(d),
    checkResidualEnglish(d),
    checkTerminology(d),
    checkExceptionReasons(d),
    checkUpstreamConsistency(d),
  ];
}

if (import.meta.main) {
  const d = loadData();
  const results = runAllChecks(d);
  for (const r of results) {
    console.log(`\n== ${r.ok ? "PASS" : "FAIL"} ${r.name}`);
    for (const line of r.details) console.log(`  ${line}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
