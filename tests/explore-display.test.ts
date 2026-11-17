import { describe, expect, it } from "vitest";
import type { SearchBook } from "@legado/shared";
import { normalizeExploreDisplay } from "../apps/server/src/services/explore-display.js";

function book(overrides: Partial<SearchBook> = {}): SearchBook {
  return {
    name: "测试书",
    author: "测试作者",
    bookUrl: "https://example.com/book/1",
    coverUrl: "",
    intro: "",
    kind: "",
    lastChapter: "",
    wordCount: "",
    origin: "",
    originName: "",
    sourceId: 1,
    ...overrides,
  };
}

describe("explore display normalization", () => {
  it("splits the four-line QQ kind into rating, category, status and update date", () => {
    const display = normalizeExploreDisplay(
      book({
        kind: "9.8分\n都市\n连载中\n2026-11-04",
        wordCount: "27030426",
        lastChapter: "第13281章 新的开始",
        intro: "“一本很好看的小说”",
        coverUrl: "https://example.com/1.jpg",
      }),
    );
    expect(display.rating).toBe(9.8);
    expect(display.categories).toEqual(["都市"]);
    expect(display.status).toBe("连载中");
    expect(display.updatedAt).toBe("2026-11-04");
    expect(display.wordCount).toBe(27030426);
    expect(display.wordCountText).toBe("2703万字");
    expect(display.lastChapter).toBe("第13281章 新的开始");
    expect(display.intro).toBe("一本很好看的小说");
    expect(display.completeness).toBe("rich");
  });

  it("splits combined category labels and recognizes 完本", () => {
    const display = normalizeExploreDisplay(book({ kind: "9.9分\n玄幻·东方玄幻\n已完结", wordCount: "2895074" }));
    expect(display.rating).toBe(9.9);
    expect(display.categories).toEqual(["玄幻", "东方玄幻"]);
    expect(display.status).toBe("已完结");
    expect(display.wordCountText).toBe("289.5万字");
  });

  it("repairs the labelled column shift used by source 6", () => {
    const display = normalizeExploreDisplay(
      book({
        name: "三生愚作品",
        author: "第三百七十三章 归来",
        kind: "状态：连载",
        lastChapter: "字数：23万字",
        wordCount: "作者：三生愚",
      }),
    );
    expect(display.author).toBe("三生愚");
    expect(display.status).toBe("连载中");
    expect(display.wordCount).toBe(230000);
    expect(display.wordCountText).toBe("23万字");
    expect(display.lastChapter).toBe("第三百七十三章 归来");
  });

  it("does not invent an author or chapter for source 13's duplicate date columns", () => {
    const display = normalizeExploreDisplay(
      book({ name: "金丝雀", author: "金丝雀", kind: "2026-11-05", lastChapter: "金丝雀", wordCount: "2026-11-05" }),
    );
    expect(display.author).toBe("");
    expect(display.lastChapter).toBe("");
    expect(display.wordCount).toBeNull();
    expect(display.updatedAt).toBe("2026-11-05");
    expect(display.completeness).toBe("minimal");
  });

  it("keeps slash-separated tags from 书山聚合", () => {
    const display = normalizeExploreDisplay(book({ author: "某作者", kind: "都市高武/悬疑脑洞" }));
    expect(display.categories).toEqual(["都市高武", "悬疑脑洞"]);
    expect(display.completeness).toBe("partial");
  });

  it("parses 大灰狼-style decimal 万字", () => {
    const display = normalizeExploreDisplay(book({ wordCount: "15.82 万字", kind: "都市" }));
    expect(display.wordCount).toBe(158200);
    expect(display.wordCountText).toBe("15.8万字");
  });

  it("drops a duplicate author equal to the book name", () => {
    const display = normalizeExploreDisplay(book({ name: "凡人修仙传", author: "凡人修仙传", kind: "" }));
    expect(display.author).toBe("");
    expect(display.completeness).toBe("minimal");
  });

  it("treats a 分 label that is not a rating as a category", () => {
    const display = normalizeExploreDisplay(book({ kind: "分类：玄幻" }));
    expect(display.categories).toEqual(["玄幻"]);
    expect(display.rating).toBeNull();
  });

  it("ignores malformed dates instead of shifting them into word count", () => {
    const display = normalizeExploreDisplay(book({ kind: "2026-13-40", wordCount: "2026-11-05" }));
    expect(display.updatedAt).toBe("2026-11-05");
    expect(display.wordCount).toBeNull();
    expect(display.categories).toEqual([]);
  });

  it("handles empty fields without throwing", () => {
    const display = normalizeExploreDisplay(book({ author: "", kind: "", lastChapter: "", wordCount: "", intro: "" }));
    expect(display).toMatchObject({ author: "", categories: [], status: "", rating: null, wordCount: null, completeness: "minimal" });
  });
});
