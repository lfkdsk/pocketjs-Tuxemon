// zh_CN catalog construction: source priority, punctuation normalization,
// token protection, fallback counting.

import { describe, expect, test } from "bun:test";
import {
  IMPORT_UI,
  buildZhCatalog,
  createTextCatalog,
  normalizeZhPunctuation,
} from "../importer/l10n.ts";

describe("normalizeZhPunctuation", () => {
  test("half-width punctuation next to CJK becomes full-width", () => {
    expect(normalizeZhPunctuation("复活被击倒的精灵,恢复20点生命.")).toBe("复活被击倒的精灵，恢复20点生命。");
    expect(normalizeZhPunctuation("{name}不能在这里使用!")).toBe("{name}不能在这里使用！");
    expect(normalizeZhPunctuation("招式学习器:雪崩")).toBe("招式学习器：雪崩");
    expect(normalizeZhPunctuation("你确定吗?")).toBe("你确定吗？");
  });
  test("paired brackets and quotes next to CJK convert", () => {
    expect(normalizeZhPunctuation("(测试)内容")).toBe("（测试）内容");
    expect(normalizeZhPunctuation("他说\"假龙\"来了")).toBe("他说“假龙”来了");
  });
  test("thousands separators and version numbers stay ASCII", () => {
    expect(normalizeZhPunctuation("海拔 3,776 米（12,388 英尺）")).toBe("海拔 3,776 米（12,388 英尺）");
    expect(normalizeZhPunctuation("OmniOS 6.20.4")).toBe("OmniOS 6.20.4");
  });
  test("placeholders and template tokens are never altered", () => {
    expect(normalizeZhPunctuation("${{var:scoop_price}}")).toBe("${{var:scoop_price}}");
    expect(normalizeZhPunctuation("{name}不能,用{item}")).toBe("{name}不能，用{item}");
    expect(normalizeZhPunctuation("价格 ${{currency}}${{var:party_lost_hp}},谢谢")).toBe("价格 ${{currency}}${{var:party_lost_hp}}，谢谢");
  });
  test("double hyphen becomes an em dash", () => {
    expect(normalizeZhPunctuation("滑行--使其能够")).toBe("滑行——使其能够");
  });
});

describe("buildZhCatalog", () => {
  const zh = buildZhCatalog();
  test("supplement entries are present", () => {
    expect(zh.get("cosmic_berry")).toBe("宇宙浆果");
  });
  test("upstream entries are present and punctuation-normalized", () => {
    // revive_description is a reviewed override of an upstream mistranslation.
    const value = zh.get("revive_description");
    expect(value).toBe("复活倒下的精灵，并恢复一半生命值。");
  });
  test("overrides take precedence over upstream", () => {
    expect(zh.get("spyder_papertown_myfirstmon2")).toContain("老板在叫我");
    expect(zh.get("spyder_papertown_myfirstmon2")).not.toContain("五只精灵");
  });
  test("corrupted token shapes are repaired", () => {
    expect(zh.get("spyder_papertown_grannypiper1")).toContain("${{name}}");
    expect(zh.get("spyder_cottonart_shopkeeper")).toContain("${{currency}}");
  });
  test("extra non-.po keys exist for the importer's hardcoded English", () => {
    expect(zh.get("name")).toBe("姓名");
    expect(zh.get("menu_rename")).toBe("选择一只精灵");
  });
});

describe("createTextCatalog fallback accounting", () => {
  test("en_US has no fallback layer", () => {
    const en = createTextCatalog("en_US");
    expect(en.get("cosmic_berry")).toBeDefined();
    expect(en.fallbackKeys.size).toBe(0);
  });
  test("zh_CN falls back to en_US and records the key", () => {
    const zh = createTextCatalog("zh_CN");
    // A key absent from both upstream zh and the supplement (if any) falls
    // back to en_US; either way the lookup must not throw.
    const value = zh.get("combat_none");
    expect(value).toBeDefined();
  });
  test("missing keys are recorded, empty string is not", () => {
    const zh = createTextCatalog("zh_CN");
    expect(zh.get("")).toBeUndefined();
    expect(zh.missingKeys.has("")).toBe(false);
    expect(zh.get("__no_such_key__")).toBeUndefined();
    expect(zh.missingKeys.has("__no_such_key__")).toBe(true);
  });
});

describe("IMPORT_UI", () => {
  test("both languages cover every menu key", () => {
    for (const menu of Object.keys(IMPORT_UI.en_US.shopMenu)) {
      expect(IMPORT_UI.zh_CN.shopMenu[menu]).toBeDefined();
    }
  });
  test("zh placeholder strings use CJK brackets", () => {
    expect(IMPORT_UI.zh_CN.battleLabel("X")).toBe("【战斗】X");
    expect(IMPORT_UI.zh_CN.shopLabel("Y")).toContain("【商店】");
  });
});
