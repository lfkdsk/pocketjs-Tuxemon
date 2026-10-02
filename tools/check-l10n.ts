#!/usr/bin/env bun
// zh_CN translation supplement checker.
//
// Usage: bun run check:l10n
//
// Checks (all must pass):
//   1. coverage:   upstream zh_CN + supplement cover every en_US msgid
//   2. placeholders: each supplement translation keeps the exact placeholder
//                    multiset and the same number of "\n" as the English text
//   3. no empty translations
//   4. no residual English paragraphs (proper nouns must be glossary-listed)
//   5. terminology: glossary English terms appearing in the English text must
//                    have their Chinese counterpart in the translation
//   6. supplement only fills gaps: it never overrides an upstream translation
//   7. upstream consistency: every glossary row tagged source=upstream must
//                    agree with the upstream catalog (exact msgstr match, or
//                    the rendering appears in some upstream translation)

import { existsSync, readFileSync } from "node:fs";
import {
  ALLOWED_ENGLISH_TOKENS,
  EN_PO,
  GLOSSARY_TSV,
  SUPPLEMENT_PO,
  ZH_UPSTREAM_PO,
  countEscapedNewlines,
  englishRuns,
  isSuspiciousRun,
  loadGlossary,
  parsePo,
  runWhitelisted,
  samePlaceholderSet,
  stripPlaceholders,
  type GlossaryEntry,
} from "./l10n-lib.ts";

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
  supplement: Map<string, string>;
  glossary: GlossaryEntry[];
  exceptions: Set<string>;
}

export function loadData(): L10nData {
  for (const p of [EN_PO, ZH_UPSTREAM_PO, SUPPLEMENT_PO, GLOSSARY_TSV]) {
    if (!existsSync(p)) throw new Error(`missing required file: ${p}`);
  }
  const exceptions = new Set<string>();
  if (existsSync(EXCEPTIONS_FILE)) {
    for (const line of readFileSync(EXCEPTIONS_FILE, "utf8").split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) exceptions.add(t);
    }
  }
  return {
    en: parsePo(EN_PO),
    zhUpstream: parsePo(ZH_UPSTREAM_PO),
    supplement: parsePo(SUPPLEMENT_PO),
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
  details.push(`upstream zh_CN translations: ${d.zhUpstream.size}`);
  details.push(`supplement translations: ${d.supplement.size}`);
  if (missing.length) details.push(`MISSING ${missing.length}: ${missing.slice(0, MAX_FAILURES).join(", ")}`);
  if (invented.length) details.push(`INVENTED ${invented.length}: ${invented.slice(0, MAX_FAILURES).join(", ")}`);
  return { name: "coverage", ok: missing.length === 0 && invented.length === 0, details };
}

// --- 2. placeholders --------------------------------------------------------

export function checkPlaceholders(d: L10nData): CheckResult {
  const details: string[] = [];
  const bad: string[] = [];
  for (const [id, zh] of d.supplement) {
    const en = d.en.get(id)!;
    if (!samePlaceholderSet(en, zh)) {
      bad.push(`${id}: en=[${extractList(en)}] zh=[${extractList(zh)}]`);
    } else if (countEscapedNewlines(en) !== countEscapedNewlines(zh)) {
      bad.push(`${id}: newline count ${countEscapedNewlines(en)} != ${countEscapedNewlines(zh)}`);
    }
  }
  details.push(`checked ${d.supplement.size} translations`);
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
  const empty = [...d.supplement.entries()]
    .filter(([k, v]) => !v.trim() && d.en.get(k)?.trim())
    .map(([k]) => k);
  details.push(`checked ${d.supplement.size} translations`);
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
  for (const [id, zh] of d.supplement) {
    for (const run of englishRuns(stripPlaceholders(zh))) {
      if (isSuspiciousRun(run) && !runWhitelisted(run, wl)) {
        bad.push(`${id}: "${run.text}"`);
      }
    }
  }
  details.push(`checked ${d.supplement.size} translations, whitelist ${wl.size} tokens`);
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
  return glossaryZh.split(/[／/]/).some((alt) => zh.includes(alt));
}

export function checkTerminology(d: L10nData): CheckResult {
  const details: string[] = [];
  const enforceable = d.glossary.filter((g) => isEnforceableTerm(g.en));
  const bad: string[] = [];
  let hits = 0;
  for (const [id, zh] of d.supplement) {
    const en = d.en.get(id)!;
    for (const g of enforceable) {
      if (!termRegex(g).test(en)) continue;
      hits++;
      if (termSatisfied(zh, g.zh)) continue;
      if (d.exceptions.has(`${id}\t${g.en}`)) continue;
      bad.push(`${id}: "${g.en}" -> expected "${g.zh}" in: ${zh.slice(0, 60)}`);
    }
  }
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
    checkEmpty(d),
    checkPlaceholders(d),
    checkResidualEnglish(d),
    checkTerminology(d),
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
