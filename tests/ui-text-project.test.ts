import { describe, expect, test } from "bun:test";

import { loadZhUiText } from "../importer/l10n.ts";
import { buildProject, setImportLang } from "../importer/project.ts";

describe("language-specific project uiText", () => {
  test("the zh_CN project owns the complete table and en_US stays absent", () => {
    try {
      setImportLang("zh_CN");
      const zh = buildProject(["spyder_bedroom"]).project;
      expect(zh.uiText).toEqual(loadZhUiText());

      setImportLang("en_US");
      const en = buildProject(["spyder_bedroom"]).project;
      expect(Object.prototype.hasOwnProperty.call(en, "uiText")).toBeFalse();
    } finally {
      setImportLang("en_US");
    }
  });
});
