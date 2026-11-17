import { describe, expect, it } from "vitest";
import { normalizeBookMeta } from "../apps/server/src/services/books/meta";

describe("normalizeBookMeta", () => {
  it("trims and caps the fields users can edit", () => {
    const result = normalizeBookMeta({
      name: "  长夜  余烬  ",
      author: "  远瞳 ",
      intro: " 第一段\n\n第二段 ",
      coverUrl: "  https://example.com/a.jpg  ",
    });
    expect(result.error).toBe("");
    expect(result.patch.name).toBe("长夜 余烬");
    expect(result.patch.author).toBe("远瞳");
    expect(result.patch.intro).toBe("第一段\n\n第二段");
    expect(result.patch.coverUrl).toBe("https://example.com/a.jpg");
  });

  it("rejects an empty or non-string name", () => {
    expect(normalizeBookMeta({ name: "   " }).error).toContain("书名不能为空");
    expect(normalizeBookMeta({ name: 3 }).error).toContain("书名格式不对");
  });

  it("allows clearing author, intro and cover", () => {
    const result = normalizeBookMeta({ name: "书", author: "", intro: "", coverUrl: "" });
    expect(result.error).toBe("");
    expect(result.patch.author).toBe("");
    expect(result.patch.intro).toBe("");
    expect(result.patch.coverUrl).toBe("");
  });

  it("accepts local and data cover urls but rejects script urls", () => {
    expect(normalizeBookMeta({ coverUrl: "/api/local-images/abc/a.png" }).error).toBe("");
    expect(normalizeBookMeta({ coverUrl: "data:image/png;base64,AAAA" }).error).toBe("");
    expect(normalizeBookMeta({ coverUrl: "javascript:alert(1)" }).error).toContain("封面地址");
  });

  it("leaves unrelated patches untouched", () => {
    const result = normalizeBookMeta({ note: "备注", groupId: 2 });
    expect(result.error).toBe("");
    expect(result.patch).toEqual({});
  });
});
