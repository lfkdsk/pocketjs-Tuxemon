// CJK subset coverage: the committed Noto Sans CJK subset and charset must
// cover every character the zh_CN build displays (dist/zh-text.txt, written
// by the importer, plus the zh shells bundled into the app). Runs the kit's
// offline --check.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

describe.skipIf(!existsSync(join(ROOT, "dist/zh-text.txt")))("CJK font subset", () => {
  test("the committed subset covers every zh_CN character (--check)", () => {
    // The kit's check is offline: it reads fonts.json, the charset, the
    // subset otf and the license, and verifies the scan text is covered.
    let out = "";
    try {
      out = execFileSync(
        "bun",
        ["vendor/pocket-rpgkit/tools/cjk-font.ts", "--app=.", "--scan=dist/zh-text.txt", "--check"],
        { cwd: ROOT, encoding: "utf8" },
      );
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; status?: number };
      throw new Error(`cjk-font --check exited ${e.status}: ${e.stdout ?? ""} ${e.stderr ?? ""}`);
    }
    expect(out).toContain("covered");
  }, 30_000);
});
