import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GLOSSARY_TSV,
  GLOSSARY_CATEGORIES,
  SUPPLEMENT_PO,
  loadGlossary,
  countEscapedNewlines,
  extractPlaceholders,
  samePlaceholderSet,
  englishRuns,
  isSuspiciousRun,
  runWhitelisted,
  stripPlaceholders,
  writePo,
  parsePo,
  ALLOWED_ENGLISH_TOKENS,
  type GlossaryEntry,
} from "../tools/l10n-lib.ts";
import {
  checkCoverage,
  checkEmpty,
  checkNoOverlap,
  checkPlaceholders,
  checkResidualEnglish,
  checkTerminology,
  checkUpstreamConsistency,
  englishWhitelist,
  isEnforceableTerm,
  termRegex,
  type L10nData,
} from "../tools/check-l10n.ts";

function fixture(
  en: Record<string, string>,
  supplement: Record<string, string>,
  glossary: GlossaryEntry[] = [],
  upstream: Record<string, string> = {},
  exceptions: string[] = [],
): L10nData {
  return {
    en: new Map(Object.entries(en)),
    zhUpstream: new Map(Object.entries(upstream)),
    supplement: new Map(Object.entries(supplement)),
    glossary: glossary.map((g) => ({ ...g })),
    exceptions: new Set(exceptions),
  };
}

// ---------------------------------------------------------------------------
// Glossary (step 2 acceptance)
// ---------------------------------------------------------------------------

describe("glossary", () => {
  test("file exists and parses", () => {
    expect(existsSync(GLOSSARY_TSV)).toBe(true);
    const rows = loadGlossary();
    expect(rows.length).toBeGreaterThanOrEqual(900);
  });

  test("every row has a known category and source", () => {
    for (const row of loadGlossary()) {
      expect(GLOSSARY_CATEGORIES).toContain(row.category);
      expect(["upstream", "supplement"]).toContain(row.source);
      expect(row.en.length).toBeGreaterThan(0);
      expect(row.zh.length).toBeGreaterThan(0);
    }
  });

  test("no duplicate English terms", () => {
    const seen = new Set<string>();
    for (const row of loadGlossary()) {
      expect(seen.has(row.en)).toBe(false);
      seen.add(row.en);
    }
  });

  test("covers the db proper-noun categories", () => {
    const rows = loadGlossary();
    const count = (cat: string) => rows.filter((r) => r.category === cat).length;
    expect(count("monster")).toBeGreaterThanOrEqual(400);
    expect(count("technique")).toBeGreaterThanOrEqual(270);
    expect(count("item")).toBeGreaterThanOrEqual(220);
  });
});

// ---------------------------------------------------------------------------
// Placeholder helpers (unit tests for the check logic)
// ---------------------------------------------------------------------------

describe("placeholder extraction", () => {
  test("extracts both brace shapes", () => {
    expect(extractPlaceholders("Hello {name}, ${{currency}} and {target}{target}")).toEqual([
      "{name}",
      "${{currency}}",
      "{target}",
      "{target}",
    ]);
  });

  test("samePlaceholderSet compares multisets", () => {
    expect(samePlaceholderSet("{a}{b}", "{b}{a}")).toBe(true);
    expect(samePlaceholderSet("{a}{a}", "{a}")).toBe(false);
    expect(samePlaceholderSet("${{x}}", "{x}")).toBe(false);
  });

  test("counts escaped newlines", () => {
    expect(countEscapedNewlines("a\\nb\\nc")).toBe(2);
    expect(countEscapedNewlines("no newline")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Residual-English detection (unit tests)
// ---------------------------------------------------------------------------

describe("english runs", () => {
  test("finds multi-word runs", () => {
    const runs = englishRuns("你好 Battle Area Master 再见");
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("Battle Area Master");
    expect(isSuspiciousRun(runs[0])).toBe(true);
  });

  test("short single words are not suspicious", () => {
    const runs = englishRuns("买一个 HP 药水");
    expect(runs).toHaveLength(1);
    expect(isSuspiciousRun(runs[0])).toBe(false);
  });

  test("kept-Latin names are suspicious but whitelisted via the glossary", () => {
    const runs = englishRuns("买一个 Tuxemon 球");
    expect(runs).toHaveLength(1);
    expect(isSuspiciousRun(runs[0])).toBe(true);
    const wl = new Set([...ALLOWED_ENGLISH_TOKENS, "tuxemon"]);
    expect(runWhitelisted(runs[0], wl)).toBe(true);
  });

  test("long single words are suspicious", () => {
    const runs = englishRuns("看 Omnichannel 公司");
    expect(runs.some((r) => isSuspiciousRun(r))).toBe(true);
  });

  test("whitelist accepts glossary names", () => {
    const wl = new Set([...ALLOWED_ENGLISH_TOKENS, "battle", "area", "master"]);
    const runs = englishRuns("Battle Area Master");
    expect(runWhitelisted(runs[0], wl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Check-tool behaviors (step 3 acceptance), one describe per check
// ---------------------------------------------------------------------------

const GLOSS = [
  { en: "Spyder", zh: "斯派德", category: "other", source: "supplement" },
  { en: "Cotton Town", zh: "暖棉镇", category: "other", source: "supplement" },
  { en: "Tuxemon", zh: "Tuxemon", category: "other", source: "supplement" },
  { en: "Bomb", zh: "炸弹", category: "technique", source: "supplement" },
  { en: "Rockitten", zh: "小岩猫", category: "monster", source: "upstream" },
] as const;

describe("check: coverage", () => {
  test("full coverage passes", () => {
    const d = fixture({ a: "A", b: "B" }, { a: "甲" }, [], { b: "乙" });
    expect(checkCoverage(d).ok).toBe(true);
  });
  test("missing msgid fails", () => {
    const d = fixture({ a: "A", b: "B" }, { a: "甲" });
    const r = checkCoverage(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("MISSING 1");
  });
  test("invented msgid fails", () => {
    const d = fixture({ a: "A" }, { a: "甲", x: "X" });
    const r = checkCoverage(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("INVENTED 1");
  });
});

describe("check: no-overlap", () => {
  test("supplement entry already upstream fails", () => {
    const d = fixture({ a: "A" }, { a: "甲" }, [], { a: "A-up" });
    const r = checkNoOverlap(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("OVERLAP 1");
  });
  test("disjoint sets pass", () => {
    const d = fixture({ a: "A", b: "B" }, { a: "甲" }, [], { b: "乙" });
    expect(checkNoOverlap(d).ok).toBe(true);
  });
});

describe("check: no-empty", () => {
  test("empty msgstr fails", () => {
    const d = fixture({ a: "A", b: "B" }, { a: "甲", b: "  " });
    const r = checkEmpty(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("b");
  });
  test("blank English source may stay blank", () => {
    const d = fixture({ a: "A", b: " " }, { a: "甲", b: " " });
    expect(checkEmpty(d).ok).toBe(true);
  });
});

describe("check: placeholders", () => {
  test("same set in different order passes", () => {
    const d = fixture({ a: "{x} and {y}" }, { a: "{y}和{x}" });
    expect(checkPlaceholders(d).ok).toBe(true);
  });
  test("missing placeholder fails", () => {
    const d = fixture({ a: "{x} and {y}" }, { a: "只有{x}" });
    const r = checkPlaceholders(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("FAILURES 1");
  });
  test("newline count must match", () => {
    const d = fixture({ a: "line1\\nline2" }, { a: "一行" });
    const r = checkPlaceholders(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("newline count");
  });
  test("template placeholder shape is distinct", () => {
    const d = fixture({ a: "${{name}}" }, { a: "{name}" });
    expect(checkPlaceholders(d).ok).toBe(false);
  });
});

describe("check: residual english", () => {
  test("glossary name kept in Latin passes", () => {
    const d = fixture({ a: "I love Tuxemon" }, { a: "我喜欢Tuxemon" }, [...GLOSS]);
    expect(checkResidualEnglish(d).ok).toBe(true);
  });
  test("untranslated English sentence fails", () => {
    const d = fixture({ a: "Hello there" }, { a: "Hello there 朋友" }, [...GLOSS]);
    const r = checkResidualEnglish(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("Hello there");
  });
  test("letters inside placeholders are ignored", () => {
    const d = fixture({ a: "Use {target} now" }, { a: "现在用{target}" }, [...GLOSS]);
    expect(checkResidualEnglish(d).ok).toBe(true);
  });
  test("whitelist built from glossary words", () => {
    const wl = englishWhitelist([...GLOSS]);
    expect(wl.has("spyder")).toBe(true);
    expect(wl.has("cotton")).toBe(true);
  });
});

describe("check: terminology", () => {
  test("glossary term in English text must appear in Chinese", () => {
    const d = fixture({ a: "Spyder is here" }, { a: "斯派德在这里" }, [...GLOSS]);
    expect(checkTerminology(d).ok).toBe(true);
    const bad = fixture({ a: "Spyder is here" }, { a: "有人来了" }, [...GLOSS]);
    const r = checkTerminology(bad);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("Spyder");
  });
  test("multi-word term matches as a phrase", () => {
    const d = fixture({ a: "Welcome to Cotton Town" }, { a: "欢迎来到暖棉镇" }, [...GLOSS]);
    expect(checkTerminology(d).ok).toBe(true);
  });
  test("case-sensitive: lowercase common word is not the term", () => {
    const d = fixture({ a: "a bomb scare" }, { a: "一场惊吓" }, [...GLOSS]);
    expect(checkTerminology(d).ok).toBe(true);
  });
  test("short common-word terms are not enforced", () => {
    expect(isEnforceableTerm("Bomb")).toBe(false);
    expect(isEnforceableTerm("Spyder")).toBe(true);
    expect(isEnforceableTerm("Cotton Town")).toBe(true);
  });
  test("exception file entry is honored", () => {
    const d = fixture({ a: "Spyder is here" }, { a: "有人来了" }, [...GLOSS], {}, ["a\tSpyder"]);
    expect(checkTerminology(d).ok).toBe(true);
  });
  test("lowercase plural tuxeballs is enforced (mutation regression)", () => {
    const gloss = [...GLOSS, { en: "Tuxeball", zh: "精灵球", category: "item", source: "upstream" }] as GlossaryEntry[];
    const en = { a: "Bring me some tuxeballs from the mart" };
    expect(checkTerminology(fixture(en, { a: "从超市给我带些精灵球回来" }, gloss)).ok).toBe(true);
    const r = checkTerminology(fixture(en, { a: "从超市给我带些捕捉器回来" }, gloss));
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("Tuxeball");
  });
});

describe("termRegex", () => {
  const g = (en: string, category: GlossaryEntry["category"]): GlossaryEntry =>
    ({ en, zh: "x", category, source: "supplement" });
  test("proper-noun categories match case-insensitively with inflections", () => {
    const re = termRegex(g("Tuxeball", "item"));
    expect(re.test("buy a Tuxeball")).toBe(true);
    expect(re.test("buy some tuxeballs")).toBe(true);
    expect(re.test("Tuxeball's price")).toBe(true);
    expect(re.test("the tuxeballs' price")).toBe(true);
    expect(re.test("Tuxeballx")).toBe(false);
  });
  test("element/technique/menu categories stay case-sensitive whole-word", () => {
    const fire = termRegex(g("Fire", "element"));
    expect(fire.test("Fire attack")).toBe(true);
    expect(fire.test("fire attack")).toBe(false);
    expect(fire.test("Fires")).toBe(false);
  });
  test("multi-word terms take the inflection on the last word", () => {
    const re = termRegex(g("Paper Town", "place"));
    expect(re.test("welcome to paper town")).toBe(true);
    expect(re.test("Paper Towns")).toBe(true);
    expect(re.test("Paper Town's sign")).toBe(true);
  });
});

describe("check: upstream consistency", () => {
  test("upstream-source row agreeing with the upstream msgstr passes", () => {
    const d = fixture(
      { paper_town: "Paper Town" },
      {},
      [{ en: "Paper Town", zh: "方絮镇", category: "place", source: "upstream" }],
      { paper_town: "方絮" },
    );
    expect(checkUpstreamConsistency(d).ok).toBe(true);
  });
  test("upstream-source row disagreeing with upstream fails", () => {
    const d = fixture(
      { paper_town: "Paper Town" },
      {},
      [{ en: "Paper Town", zh: "纸镇", category: "place", source: "upstream" }],
      { paper_town: "方絮" },
    );
    const r = checkUpstreamConsistency(d);
    expect(r.ok).toBe(false);
    expect(r.details.join()).toContain("UNVERIFIED");
  });
  test("any one of several upstream renderings is accepted", () => {
    const d = fixture(
      { nudiflot: "Nudiflot" },
      {},
      [{ en: "Nudiflot", zh: "浮蛞蝓♂", category: "monster", source: "upstream" }],
      { nudiflot: "浮蛞蝓♀" },
    );
    // disagreeing with the single rendering here must fail
    expect(checkUpstreamConsistency(d).ok).toBe(false);
    const both = fixture(
      { nudiflot: "Nudiflot", nudiflot2: "Nudiflot" },
      {},
      [{ en: "Nudiflot", zh: "浮蛞蝓♂", category: "monster", source: "upstream" }],
      { nudiflot: "浮蛞蝓♀", nudiflot2: "浮蛞蝓♂" },
    );
    expect(checkUpstreamConsistency(both).ok).toBe(true);
  });
  test("tier 2: rendering appearing in any upstream entry passes", () => {
    const d = fixture(
      { some_id: "Other text" },
      {},
      [{ en: "Omnichannel", zh: "全能公司", category: "other", source: "upstream" }],
      { plaque: "由全能公司赞助" },
    );
    expect(checkUpstreamConsistency(d).ok).toBe(true);
  });
  test("supplement-source rows are not checked", () => {
    const d = fixture(
      { a: "A" },
      {},
      [{ en: "Newcoin", zh: "新币", category: "other", source: "supplement" }],
      {},
    );
    expect(checkUpstreamConsistency(d).ok).toBe(true);
  });
});

describe("stripPlaceholders", () => {
  test("removes both brace shapes", () => {
    expect(stripPlaceholders("a {x} b ${{y}} c")).toBe("a   b   c");
  });
});

describe("english runs: numbers", () => {
  test("version strings with digits are whitelisted", () => {
    const runs = englishRuns("OmniOS 6.20.4 已发布");
    const wl = new Set([...ALLOWED_ENGLISH_TOKENS, "omnios"]);
    expect(runs).toHaveLength(1);
    expect(runWhitelisted(runs[0], wl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gettext header (B3 acceptance): the supplement header must be a real
// gettext header — every field "\n"-terminated inside its quoted string,
// provenance/license as "#" comments — so standard tooling can parse it and
// compile it to a loadable .mo. The parser below is intentionally written
// from scratch (not reusing tools/l10n-lib.ts) so it double-checks the
// library's own output.
// ---------------------------------------------------------------------------

interface StrictHeader {
  comments: string[];
  fields: Record<string, string>;
}

function strictParseHeader(path: string): StrictHeader {
  const lines = readFileSync(path, "utf8").split("\n");
  const comments: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i].startsWith("#")) {
    comments.push(lines[i]);
    i++;
  }
  if (lines[i] !== 'msgid ""') throw new Error("header entry must follow the comments");
  if (lines[++i] !== 'msgstr ""') throw new Error("msgstr must follow msgid");
  i++;
  let raw = "";
  while (i < lines.length && lines[i].startsWith('"')) {
    const line = lines[i];
    if (!line.endsWith('"')) throw new Error(`unterminated header line: ${line}`);
    const body = line.slice(1, -1);
    if (!body.endsWith("\\n")) throw new Error(`header field not \\n-terminated: ${line}`);
    raw += body;
    i++;
  }
  const fields: Record<string, string> = {};
  for (const seg of raw.replace(/\\n/g, "\n").split("\n")) {
    if (!seg) continue;
    const ci = seg.indexOf(":");
    if (ci < 0) throw new Error(`header field without colon: ${seg}`);
    fields[seg.slice(0, ci)] = seg.slice(ci + 1).trim();
  }
  return { comments, fields };
}

/** Minimal GNU .mo compiler (little-endian, no hash table). */
function compileMo(entries: Array<[string, string]>): Buffer {
  const kData: Buffer[] = [];
  const vData: Buffer[] = [];
  const kOffsets: Array<[number, number]> = [];
  const vOffsets: Array<[number, number]> = [];
  let o = 7 * 4 + 16 * entries.length;
  for (const [k] of entries) {
    const kb = Buffer.from(k, "utf8");
    kOffsets.push([kb.length, o]);
    kData.push(kb, Buffer.from([0]));
    o += kb.length + 1;
  }
  for (const [, v] of entries) {
    const vb = Buffer.from(v, "utf8");
    vOffsets.push([vb.length, o]);
    vData.push(vb, Buffer.from([0]));
    o += vb.length + 1;
  }
  const header = Buffer.alloc(7 * 4);
  header.writeUInt32LE(0x950412de, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt32LE(7 * 4, 12);
  header.writeUInt32LE(7 * 4 + 8 * entries.length, 16);
  const tables = Buffer.alloc(16 * entries.length);
  let p = 0;
  for (const [l, off] of kOffsets) {
    tables.writeUInt32LE(l, p);
    tables.writeUInt32LE(off, p + 4);
    p += 8;
  }
  for (const [l, off] of vOffsets) {
    tables.writeUInt32LE(l, p);
    tables.writeUInt32LE(off, p + 4);
    p += 8;
  }
  return Buffer.concat([header, tables, ...kData, ...vData]);
}

describe("gettext header", () => {
  test("supplement.po header parses as a standard gettext header", () => {
    const { comments, fields } = strictParseHeader(SUPPLEMENT_PO);
    expect(fields["Language"]).toBe("zh_CN");
    expect(fields["Content-Type"]).toContain("charset=UTF-8");
    expect(fields["Project-Id-Version"]).toContain("Pocket Tuxemon");
    expect(fields["MIME-Version"]).toBe("1.0");
    expect(fields["Content-Transfer-Encoding"]).toBe("8bit");
    // provenance/license live in "#" comments, not in a broken X-Comment field
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.join("\n")).toContain("NOT the Tuxemon");
  });

  test("writePo emits \\n-terminated fields and # comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "l10n-po-"));
    const path = join(dir, "out.po");
    writePo(
      path,
      [
        "Project-Id-Version: test",
        "Language: zh_CN",
        "Content-Type: text/plain; charset=UTF-8",
      ],
      [
        ["hello", "你好"],
        ["line \"quote\" and \\n break", "引号\"和\\n换行"],
      ],
      ["first comment", "second comment"],
    );
    const text = readFileSync(path, "utf8");
    expect(text.startsWith("# first comment\n# second comment\nmsgid \"\"")).toBe(true);
    const { comments, fields } = strictParseHeader(path);
    expect(comments).toEqual(["# first comment", "# second comment"]);
    expect(fields["Language"]).toBe("zh_CN");
    expect(fields["Content-Type"]).toContain("charset=UTF-8");
    // entries round-trip through the importer's parser
    const round = parsePo(path);
    expect(round.get("hello")).toBe("你好");
    expect(round.get('line "quote" and \\n break')).toBe('引号"和\\n换行');
  });

  test("compiles to a .mo loadable by Python gettext", () => {
    const python = Bun.which("python3");
    if (!python) return; // tool unavailable; the strict-parse test above still guards the header
    const { fields } = strictParseHeader(SUPPLEMENT_PO);
    const headerString = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n";
    const mo = compileMo([
      ["", headerString],
      ["cosmic_berry", "宇宙浆果"],
      ["menu_monster", "精灵"],
    ]);
    const dir = mkdtempSync(join(tmpdir(), "l10n-mo-"));
    const moPath = join(dir, "supplement.mo");
    writeFileSync(moPath, mo);
    const script = `
import gettext, sys
with open(sys.argv[1], "rb") as f:
    t = gettext.GNUTranslations(f)
print(t.info().get("language"))
print(t.gettext("cosmic_berry"))
print(t.gettext("menu_monster"))
`;
    const proc = Bun.spawnSync({
      cmd: [python, "-c", script, moPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString().trim();
    if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
    expect(out).toBe("zh_CN\n宇宙浆果\n精灵");
  });
});
