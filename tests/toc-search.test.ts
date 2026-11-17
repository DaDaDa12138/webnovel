import { describe, expect, it } from "vitest";
import { searchToc } from "../apps/web/src/lib/toc-search";

const chapters = [
  { idx: 0, title: "第一章 初见" },
  { idx: 1, title: "第二章 风起" },
  { idx: 2, title: "第三章 风再起" },
  { idx: 3, title: "Chapter 4 Wind" },
];

describe("searchToc", () => {
  it("returns nothing for an empty query", () => {
    expect(searchToc(chapters, "   ")).toEqual({ items: [], matched: 0, truncated: false });
  });

  it("matches Chinese titles after trimming", () => {
    const result = searchToc(chapters, " 风 ");
    expect(result.matched).toBe(2);
    expect(result.items.map((item) => item.idx)).toEqual([1, 2]);
    expect(result.truncated).toBe(false);
  });

  it("matches Latin titles case-insensitively", () => {
    expect(searchToc(chapters, "chapter 4").items[0].idx).toBe(3);
    expect(searchToc(chapters, "WIND").matched).toBe(1);
  });

  it("truncates large result sets and reports the full count", () => {
    const result = searchToc(chapters, "风", 1);
    expect(result.items).toHaveLength(1);
    expect(result.matched).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("keeps a positive limit even when the caller passes zero", () => {
    const result = searchToc(chapters, "风", 0);
    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("tolerates a missing title", () => {
    const result = searchToc([{ title: "" }, { title: "有风" }] as Array<{ title: string }>, "风");
    expect(result.items).toHaveLength(1);
  });
});
