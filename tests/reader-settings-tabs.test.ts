import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, normalizeTab } from "../apps/web/src/lib/reader-settings-tabs";

describe("settings tabs", () => {
  it("ships four groups in reading order", () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual(["显示", "排版", "翻页", "朗读"]);
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual(["display", "type", "turn", "speech"]);
  });

  it("keeps a known group and falls back to the first one", () => {
    expect(normalizeTab("turn")).toBe("turn");
    expect(normalizeTab("speech")).toBe("speech");
    expect(normalizeTab("bogus")).toBe("display");
    expect(normalizeTab("")).toBe("display");
    expect(normalizeTab(null)).toBe("display");
    expect(normalizeTab(undefined)).toBe("display");
  });
});
