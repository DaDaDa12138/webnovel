import { describe, expect, it } from "vitest";
import { groupNotes, notesMarkdown } from "../apps/web/src/lib/notes-markdown";

const items = [
  { bookName: "甲书", chapterTitle: "第1章", quote: "第一段引文", comment: "" },
  { bookName: "甲书", chapterTitle: "第2章", quote: "第二段引文", comment: "这里要回看" },
  { bookName: "乙书", chapterTitle: "第1章", quote: "另一本书的引文", comment: "" },
  { bookName: "甲书", chapterTitle: "第1章", quote: "同一章的第二条", comment: "" },
];

describe("groupNotes", () => {
  it("groups by book first-seen order, then by chapter", () => {
    const books = groupNotes(items);
    expect(books.map((book) => book.name)).toEqual(["甲书", "乙书"]);
    expect(books[0].chapters.map((chapter) => chapter.title)).toEqual(["第1章", "第2章"]);
    expect(books[0].chapters[0].entries.map((entry) => entry.quote)).toEqual(["第一段引文", "同一章的第二条"]);
  });

  it("falls back to placeholder names", () => {
    const books = groupNotes([{ bookName: "", chapterTitle: "", quote: "x", comment: "" }]);
    expect(books[0].name).toBe("未命名书籍");
    expect(books[0].chapters[0].title).toBe("未知章节");
  });
});

describe("notesMarkdown", () => {
  it("writes a book/chapter/quote outline with comments", () => {
    const md = notesMarkdown(items);
    expect(md.startsWith("# 我的笔记")).toBe(true);
    expect(md).toContain("> 共 4 条 · 来自 2 本书");
    expect(md).toContain("## 《甲书》");
    expect(md).toContain("### 第2章");
    expect(md).toContain("> 第二段引文");
    expect(md).toContain("这里要回看");
    // 章标题重复也不能粘成一段
    expect(md.split("### 第1章").length).toBe(3);
  });

  it("collapses newlines inside a quote and keeps one trailing newline", () => {
    const md = notesMarkdown([{ bookName: "书", chapterTitle: "章", quote: "上\n下", comment: "" }]);
    expect(md).toContain("> 上 下");
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("returns a header-only document for no notes", () => {
    const md = notesMarkdown([]);
    expect(md).toContain("> 共 0 条 · 来自 0 本书");
  });
});
