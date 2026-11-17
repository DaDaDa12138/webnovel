import { describe, expect, it } from "vitest";
import { scanChapter } from "../apps/server/src/services/books/search-text";

const text = "第一段没有。\n第二段提到了灵气复苏，而且灵气复苏很重要。\n第三段也有灵气复苏。";

describe("book search text scan", () => {
  it("counts occurrences and keeps the first offset", () => {
    const hit = scanChapter(text, "灵气复苏");
    expect(hit).not.toBeNull();
    expect(hit!.count).toBe(3);
    expect(hit!.offset).toBe(text.indexOf("灵气复苏"));
    expect(hit!.excerpt).toContain("灵气复苏");
  });

  it("returns null when the query is missing or empty", () => {
    expect(scanChapter(text, "不存在")).toBeNull();
    expect(scanChapter(text, "   ")).toBeNull();
    expect(scanChapter("", "灵气")).toBeNull();
  });

  it("caps the per-chapter count", () => {
    expect(scanChapter(text, "灵气复苏", 2)!.count).toBe(2);
  });

  it("treats regex characters literally and ignores case", () => {
    expect(scanChapter("a.b*c A.B*C", "b*")).toMatchObject({ count: 2 });
    expect(scanChapter("Alpha alpha ALPHA", "alpha")!.count).toBe(3);
  });

  it("collapses whitespace in the excerpt and marks truncation", () => {
    const long = "铺垫".repeat(40) + "关键词" + "收尾".repeat(40);
    const hit = scanChapter(long, "关键词")!;
    expect(hit.excerpt.startsWith("…")).toBe(true);
    expect(hit.excerpt.endsWith("…")).toBe(true);
    expect(hit.excerpt).not.toContain("\n");
  });
});
