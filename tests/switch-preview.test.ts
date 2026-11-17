import { describe, expect, it } from "vitest";
import { previewFromText, SWITCH_PREVIEW_LIMIT } from "../apps/server/src/services/switch-preview.js";

describe("previewFromText", () => {
  it("keeps paragraph breaks but collapses noisy whitespace", () => {
    expect(previewFromText("  第一段。 \n\n\n 第二段\t结尾。  ")).toBe("第一段。\n\n第二段 结尾。");
  });

  it("strips control characters but keeps normal punctuation", () => {
    expect(previewFromText("a\u0000b\u0007c\u007f“引号”")).toBe("abc“引号”");
  });

  it("truncates to the requested length", () => {
    expect(previewFromText("字".repeat(50), 10)).toHaveLength(10);
  });

  it("uses a 600-character default", () => {
    expect(previewFromText("字".repeat(800))).toHaveLength(SWITCH_PREVIEW_LIMIT);
  });

  it("returns an empty string for empty input", () => {
    expect(previewFromText("   \n\n ")).toBe("");
  });
});
