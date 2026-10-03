#!/usr/bin/env bun
// Rebuild the reviewed upstream correction layer from the exhaustive JSONL
// manifest. The fixed header date keeps output byte-stable across runs.

import { writeFileSync } from "node:fs";
import {
  EN_PO,
  OVERRIDES_PO,
  REVIEW_CATEGORIES,
  UPSTREAM_REVIEW_JSONL,
  ZH_UPSTREAM_PO,
  countEscapedNewlines,
  loadUpstreamReview,
  parsePo,
  poEscape,
  samePlaceholderSet,
} from "./l10n-lib.ts";

const review = loadUpstreamReview();
if (review.parseErrors.length || review.duplicateIds.length) {
  throw new Error(`invalid ${UPSTREAM_REVIEW_JSONL}: ${[
    ...review.parseErrors,
    ...review.duplicateIds.map((id) => `duplicate ${id}`),
  ].join("; ")}`);
}
const en = parsePo(EN_PO);
const upstream = parsePo(ZH_UPSTREAM_PO);
const problems: string[] = [];
for (const id of upstream.keys()) if (!review.entries.has(id)) problems.push(`${id}: missing review row`);
for (const [id, row] of review.entries) {
  if (!upstream.has(id)) problems.push(`${id}: not an upstream key`);
  if (!(REVIEW_CATEGORIES as readonly string[]).includes(row.category)) problems.push(`${id}: invalid category`);
  const source = en.get(id);
  if (source === undefined) {
    if (!row.orphan || row.action !== "keep") problems.push(`${id}: current-en_US orphan must be marked and kept`);
    continue;
  }
  if (row.orphan) problems.push(`${id}: current en_US exists but row is marked orphan`);
  const mandatory = row.category === "drift" || row.category === "mistranslation"
    || row.category === "omission" || row.category === "glossary";
  if (mandatory && row.action !== "override") problems.push(`${id}: ${row.category} must be overridden`);
  if (row.category === "ok" && row.action !== "keep") problems.push(`${id}: ok entry cannot be overridden`);
  if (row.category !== "ok" && !row.reason?.trim()) problems.push(`${id}: non-ok entry needs a reason`);
  if (row.action === "override") {
    if (!row.translation) problems.push(`${id}: missing override translation`);
    else if (!samePlaceholderSet(source, row.translation)
      || countEscapedNewlines(source) !== countEscapedNewlines(row.translation)) {
      problems.push(`${id}: placeholder or escaped-newline mismatch`);
    } else if (row.translation === upstream.get(id)) {
      problems.push(`${id}: override does not change upstream text`);
    }
  }
}
if (problems.length) {
  throw new Error(`refusing to rewrite overrides: ${problems.slice(0, 20).join("; ")}`);
}
const rows = [...review.entries.values()]
  .filter((row) => row.action === "override")
  .sort((a, b) => a.msgid.localeCompare(b.msgid, "en"));

const lines = [
  "# Pocket Tuxemon zh_CN corrections to the upstream Weblate catalog",
  "# Each entry records why it differs and snapshots the reviewed en_US source.",
  "# License: same terms as the Tuxemon text it translates.",
  'msgid ""',
  'msgstr ""',
  '"Project-Id-Version: Pocket Tuxemon zh_CN upstream overrides\\n"',
  '"Report-Msgid-Bugs-To: \\n"',
  '"PO-Revision-Date: 2026-10-02 00:00+0000\\n"',
  '"Last-Translator: Pocket Tuxemon project\\n"',
  '"Language-Team: Pocket Tuxemon\\n"',
  '"Language: zh_CN\\n"',
  '"MIME-Version: 1.0\\n"',
  '"Content-Type: text/plain; charset=UTF-8\\n"',
  '"Content-Transfer-Encoding: 8bit\\n"',
  '"X-Generator: Pocket Tuxemon upstream review\\n"',
  "",
];
for (const row of rows) {
  const snapshot = en.get(row.msgid);
  if (snapshot === undefined || !row.reason || !row.translation) {
    throw new Error(`${row.msgid}: override row lacks current English, reason, or translation`);
  }
  if (/\r|\n/.test(row.reason)) throw new Error(`${row.msgid}: reason must fit on one comment line`);
  lines.push(
    `#. category: ${row.category}`,
    `#. reason: ${row.reason}`,
    `#. en: ${JSON.stringify(snapshot)}`,
    `msgid "${poEscape(row.msgid)}"`,
    `msgstr "${poEscape(row.translation)}"`,
    "",
  );
}
writeFileSync(OVERRIDES_PO, lines.join("\n"));
console.log(`wrote ${rows.length} reviewed corrections to ${OVERRIDES_PO}`);
