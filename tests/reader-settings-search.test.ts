import { describe, expect, it } from "vitest";
import { SETTING_SEARCH_ENTRIES, searchSettings, settingTabLabel } from "../apps/web/src/lib/reader-settings-search";

describe("reader settings search", () => {
  it("finds a setting by its Chinese label and puts exact matches first", () => {
    const results = searchSettings("行距");
    expect(results[0]?.label).toBe("行距");
    expect(results[0]?.tab).toBe("type");
    expect(results.some((item) => item.label === "字间距")).toBe(false);
  });

  it("matches aliases and English keywords", () => {
    expect(searchSettings("font size")[0]?.key).toBe("font-size");
    expect(searchSettings("夜间模式")[0]?.key).toBe("theme");
    expect(searchSettings("wake lock")[0]?.key).toBe("keep-awake");
    expect(searchSettings("自动翻页")[0]?.key).toBe("auto-scroll");
  });

  it("requires every space-separated token to match", () => {
    expect(searchSettings("字体 大小")[0]?.key).toBe("font-size");
    expect(searchSettings("字体 睡眠")).toEqual([]);
  });

  it("returns nothing for blank queries and caps the result count", () => {
    expect(searchSettings("   ")).toEqual([]);
    expect(searchSettings("设置").length).toBeLessThanOrEqual(8);
    expect(searchSettings("a", 3)).toHaveLength(3);
  });

  it("maps every entry to a real tab and a non-empty target", () => {
    for (const entry of SETTING_SEARCH_ENTRIES) {
      expect(entry.target.length).toBeGreaterThan(0);
      expect(["display", "type", "turn", "speech"]).toContain(entry.tab);
      expect(settingTabLabel(entry.tab).length).toBeGreaterThan(0);
    }
    const keys = SETTING_SEARCH_ENTRIES.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("finds the half-screen panel control", () => {
    expect(searchSettings("半屏")[0]?.key).toBe("sheet-size");
    expect(searchSettings("面板高度")[0]?.key).toBe("sheet-size");
  });

  it("finds paragraph sub-options through the smart paragraph row", () => {
    const results = searchSettings("对话独立");
    expect(results[0]?.key).toBe("paragraph");
    expect(results[0]?.target).toBe("paragraph");
  });

  it("finds the special paragraph style switch", () => {
    expect(searchSettings("特殊段落")[0]?.key).toBe("special");
    expect(searchSettings("诗歌")[0]?.key).toBe("special");
    expect(searchSettings("分节线")[0]?.target).toBe("special");
  });
});
