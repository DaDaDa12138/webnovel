import { describe, expect, it } from "vitest";
import { REPLACE_PRESETS } from "../apps/server/src/services/replace-presets";

describe("replace presets", () => {
  it("ships eight unique presets with valid regexes", () => {
    expect(REPLACE_PRESETS).toHaveLength(8);
    expect(new Set(REPLACE_PRESETS.map((preset) => preset.key)).size).toBe(8);
    for (const preset of REPLACE_PRESETS) {
      expect(() => new RegExp(preset.pattern, "g"), preset.key).not.toThrow();
    }
  });

  it("strips urls and site promotions", () => {
    const url = REPLACE_PRESETS.find((preset) => preset.key === "strip-url");
    const promo = REPLACE_PRESETS.find((preset) => preset.key === "strip-site-promo");
    expect(url).toBeTruthy();
    expect(promo).toBeTruthy();
    expect("正文 https://example.com 完".replace(new RegExp(url!.pattern, "g"), url!.replacement)).not.toContain("example.com");
    expect("正文 笔趣阁 www.example.com 完".replace(new RegExp(promo!.pattern, "g"), promo!.replacement)).not.toContain("笔趣阁");
  });
});
