// Shared helpers for the zh_CN translation supplement and its checks.
//
// The upstream Tuxemon sources (en_US / zh_CN .po) live under TUXEMON_SRC
// (defaults to the in-repo .tuxemon-src, override with the env var, same
// convention as the importer). Our own outputs live in l10n/zh_CN/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePo } from "../importer/source.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..");
export const TUXEMON_SRC = process.env.TUXEMON_SRC ?? resolve(REPO_ROOT, ".tuxemon-src");

export const EN_PO = join(TUXEMON_SRC, "mods/tuxemon/l18n/en_US/LC_MESSAGES/base.po");
export const ZH_UPSTREAM_PO = join(TUXEMON_SRC, "mods/tuxemon/l18n/zh_CN/LC_MESSAGES/base.po");
export const L10N_DIR = join(REPO_ROOT, "l10n/zh_CN");
export const GLOSSARY_TSV = join(L10N_DIR, "glossary.tsv");
export const SUPPLEMENT_PO = join(L10N_DIR, "supplement.po");

export { parsePo };

// ---------------------------------------------------------------------------
// Placeholders
//
// In-game texts use two placeholder shapes: ${...} for template variables and
// {name} for dialogue substitution. Newlines are the two-character sequence
// "\n" (the importer's parsePo keeps them escaped, and the game splits on
// that sequence), so they are counted as a placeholder too.
// ---------------------------------------------------------------------------

const BRACE_RE = /\$\{\{[^{}]*\}\}|\$\{[^{}]*\}|\{[^{}]*\}/g;

export function extractPlaceholders(text: string): string[] {
  return text.match(BRACE_RE) ?? [];
}

/** Same multiset of placeholders (order-insensitive, multiplicity matters). */
export function samePlaceholderSet(a: string, b: string): boolean {
  const ca = countMap(extractPlaceholders(a));
  const cb = countMap(extractPlaceholders(b));
  if (ca.size !== cb.size) return false;
  for (const [k, v] of ca) if (cb.get(k) !== v) return false;
  return true;
}

function countMap(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
}

export function countEscapedNewlines(text: string): number {
  return text.split("\\n").length - 1;
}

/** Remove placeholders and escaped newlines so their inner letters are not
 * seen as English text (the "n" of a "\n" escape would otherwise glue onto a
 * following Latin word, e.g. "\nTuxemon" -> "nTuxemon"). */
export function stripPlaceholders(text: string): string {
  return text.replace(BRACE_RE, " ").replace(/\\[nt]/g, " ");
}

// ---------------------------------------------------------------------------
// PO writing
//
// Standard gettext output. Translations carry "\n" as the two-character
// escape sequence (matching the upstream files); a bare backslash anywhere
// else is rejected so the file stays unambiguous for real gettext tooling.
//
// The header entry follows the gettext convention: every header field ends
// with "\n" *inside* its quoted string (gettext concatenates continuation
// strings, so without the escapes all fields merge into one unparseable
// line). `headerComments` are emitted as "#" lines before the header entry;
// use them for provenance/license notes, since the X-Comment field is not
// shown by all gettext tools.
// ---------------------------------------------------------------------------

export function poEscape(text: string): string {
  if (/\\(?!n)/.test(text)) {
    throw new Error(`refusing to escape backslash not followed by n: ${JSON.stringify(text)}`);
  }
  return text.replace(/\\n/g, "\n").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

export function writePo(
  path: string,
  headerLines: string[],
  entries: Array<[string, string]>,
  headerComments: string[] = [],
): void {
  const lines: string[] = [];
  for (const c of headerComments) lines.push(`# ${c}`);
  lines.push("msgid \"\"", "msgstr \"\"");
  for (const h of headerLines) lines.push(`"${h}\\n"`);
  lines.push("");
  for (const [msgid, msgstr] of entries) {
    lines.push(`msgid "${poEscape(msgid)}"`);
    lines.push(`msgstr "${poEscape(msgstr)}"`);
    lines.push("");
  }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export const GLOSSARY_CATEGORIES = [
  "monster",
  "technique",
  "item",
  "npc",
  "place",
  "element",
  "menu",
  "other",
] as const;
export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

export interface GlossaryEntry {
  en: string;
  zh: string;
  category: GlossaryCategory;
  source: "upstream" | "supplement";
}

export function loadGlossary(path: string = GLOSSARY_TSV): GlossaryEntry[] {
  if (!existsSync(path)) return [];
  const rows: GlossaryEntry[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [i, line] of lines.entries()) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length !== 4) {
      throw new Error(`${path}:${i + 1}: expected 4 tab-separated columns, got ${cols.length}`);
    }
    const [en, zh, category, source] = cols.map((c) => c.trim());
    if (!en || !zh) throw new Error(`${path}:${i + 1}: empty en/zh column`);
    if (!(GLOSSARY_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error(`${path}:${i + 1}: unknown category ${category}`);
    }
    if (source !== "upstream" && source !== "supplement") {
      throw new Error(`${path}:${i + 1}: source must be upstream|supplement, got ${source}`);
    }
    rows.push({ en, zh, category: category as GlossaryCategory, source });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Residual-English detection
//
// A "run" is a maximal stretch of ASCII letters/digits and the separators
// commonly found inside names (space, dot, apostrophe, ampersand, hyphen).
// Single short words (Tuxemon, HP, TM, ...) are fine; multi-word runs and
// long words must consist entirely of whitelisted tokens (glossary English
// names plus a small built-in list).
// ---------------------------------------------------------------------------

const RUN_RE = /[A-Za-z][A-Za-z0-9.'&-]*(?:[ ][A-Za-z0-9.'&-]+)*/g;

export const ALLOWED_ENGLISH_TOKENS = new Set([
  "tuxemon", "tuxepedia", "tm", "hm", "hp", "xp", "ok", "no", "on", "off",
  "tv", "dj", "id", "gb", "psp", "rpg", "npc", "fm", "am", "pm", "mr", "ms",
  "dr", "st", "vs", "jr", "sr", "ii", "iii", "iv", "v", "vi", "x", "y", "z",
  "g", "kg", "cm", "km", "hp", "mp", "xp", "bp", "ap", "pp", "lv", "dps",
  "cc", "dd", "ss", "mm", "aa", "bb", "ee", "ff", "hh", "ii", "jj", "kk",
  "ll", "nn", "oo", "pp", "qq", "rr", "tt", "uu", "ww", "xx", "yy", "zz",
  "a", "an", "the", "of", "to", "in", "is", "it", "and", "for", "be", "i",
  "you", "we", "he", "she", "they", "my", "your", "our", "his", "her",
  // intentional Latin kept in a few translations (file names, kernel trace
  // tokens, a creator's handle, a Greek etymon)
  "r", "b", "jas", "keri", "bit", "xenos", "swapper", "cut", "intro",
  "el6", "x86",
]);

export interface EnglishRun {
  text: string;
  words: string[];
}

export function englishRuns(text: string): EnglishRun[] {
  const runs: EnglishRun[] = [];
  for (const m of text.matchAll(RUN_RE)) {
    const words = m[0].split(/[ .'&-]+/).filter(Boolean);
    if (words.length === 0) continue;
    runs.push({ text: m[0], words });
  }
  return runs;
}

/** A run is suspicious when it has >=2 words, or a single word of >=5 letters. */
export function isSuspiciousRun(run: EnglishRun): boolean {
  if (run.words.length >= 2) return true;
  return /[A-Za-z]{5,}/.test(run.text);
}

export function runWhitelisted(run: EnglishRun, whitelist: Set<string>): boolean {
  return run.words.every((w) => /^\d+$/.test(w) || whitelist.has(w.toLowerCase()));
}
