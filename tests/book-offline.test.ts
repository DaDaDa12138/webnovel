import { describe, expect, it } from "vitest";
import { chapterContentUrl, filterChapterKeys } from "../apps/web/src/lib/book-offline";

describe("filterChapterKeys", () => {
  it("只挑出这本书的章节，并忽略查询串", () => {
    const keys = [
      "http://127.0.0.1:5173/api/books/17/chapters/3/content",
      "/api/books/17/chapters/12/content?t=1",
      "https://example.com/api/books/18/chapters/5/content",
      "/api/books/17/chapters",
      "/api/img?url=x",
    ];
    expect(filterChapterKeys(keys, 17)).toEqual([3, 12]);
    expect(filterChapterKeys(keys, 18)).toEqual([5]);
  });

  it("按章节号升序返回，方便显示进度", () => {
    expect(
      filterChapterKeys(["/api/books/1/chapters/9/content", "/api/books/1/chapters/2/content"], 1),
    ).toEqual([2, 9]);
  });

  it("没有匹配时返回空数组", () => {
    expect(filterChapterKeys([], 1)).toEqual([]);
  });
});

describe("chapterContentUrl", () => {
  it("和 api.content 用同一个路径，缓存键才对得上", () => {
    expect(chapterContentUrl(17, 0)).toBe("/api/books/17/chapters/0/content");
  });
});
