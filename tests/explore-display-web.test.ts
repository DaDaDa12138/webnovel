import { describe, expect, it } from "vitest";
import type { SearchBook } from "@legado/shared";
import {
  authorLabel,
  categoryLine,
  detailLine,
  displayOf,
  gridMeta,
  statusTone,
  updateLabel,
} from "../apps/web/src/lib/explore-display";

function book(patch: Partial<SearchBook> = {}): SearchBook {
  return {
    name: "测试书",
    author: "",
    bookUrl: "/book/1",
    coverUrl: "",
    intro: "",
    kind: "",
    lastChapter: "",
    wordCount: "",
    origin: "",
    originName: "",
    sourceId: 1,
    ...patch,
  };
}

describe("explore display helpers", () => {
  it("formats relative update dates", () => {
    const now = new Date(2026, 10, 5);
    expect(updateLabel("2026-11-05", now)).toBe("今天更新");
    expect(updateLabel("2026-11-04", now)).toBe("昨天更新");
    expect(updateLabel("2026-11-02", now)).toBe("3 天前");
    expect(updateLabel("2026-10-20", now)).toBe("10-20");
    expect(updateLabel("2025-12-31", now)).toBe("2025-12-31");
    expect(updateLabel("", now)).toBe("");
  });

  it("maps status to a tone", () => {
    expect(statusTone("连载中")).toBe("ongoing");
    expect(statusTone("已完结")).toBe("done");
    expect(statusTone("暂停")).toBe("paused");
    expect(statusTone("")).toBe("");
  });

  it("falls back from display to raw SearchBook without inventing fields", () => {
    const display = displayOf(book({ author: "作者甲", kind: "玄幻·都市", lastChapter: "第 10 章" }));
    expect(display.author).toBe("作者甲");
    expect(display.categories).toEqual(["玄幻", "都市"]);
    expect(display.lastChapter).toBe("第 10 章");
    expect(display.completeness).toBe("minimal");
  });

  it("prefers the latest chapter for the list detail line", () => {
    const display = displayOf(book({ intro: "一段简介", lastChapter: "第 10 章" }));
    expect(detailLine(display)).toBe("最新 第 10 章");
    expect(detailLine(displayOf(book({ intro: "一段简介" })))).toBe("一段简介");
  });

  it("uses author then category then a neutral fallback", () => {
    expect(gridMeta(displayOf(book({ author: "作者甲", kind: "玄幻" })))).toBe("作者甲");
    expect(gridMeta(displayOf(book({ kind: "玄幻" })))).toBe("玄幻");
    expect(gridMeta(displayOf(book()))).toBe("作者未知");
    expect(authorLabel(displayOf(book()))).toBe("作者未知");
  });

  it("limits category chips to two", () => {
    const display = displayOf(book({ kind: "玄幻·都市·历史" }));
    expect(categoryLine(display)).toEqual(["玄幻", "都市"]);
  });
});
