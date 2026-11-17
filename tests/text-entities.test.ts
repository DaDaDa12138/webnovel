import { describe, expect, it } from "vitest";
import { decodeEntitiesDeep, normalizeText } from "@legado/engine";

describe("deep entity decoding", () => {
  it("decodes entities that were escaped twice", () => {
    expect(decodeEntitiesDeep("四·二八兵团&amp;quot;总部大楼")).toBe('四·二八兵团"总部大楼');
    expect(normalizeText("&amp;ldquo;你好&amp;rdquo;")).toBe("“你好”");
  });

  it("leaves ordinary text and unknown entities alone", () => {
    expect(decodeEntitiesDeep("普通正文 &unknown;")).toBe("普通正文 &unknown;");
    expect(normalizeText("A &amp; B")).toBe("A & B");
  });

  it("does not decode more than the requested passes", () => {
    expect(decodeEntitiesDeep("&amp;quot;", 1)).toBe("&quot;");
    expect(decodeEntitiesDeep("&amp;quot;", 2)).toBe('"');
  });
});
