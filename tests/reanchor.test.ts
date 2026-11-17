import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  applyReanchorSnapshot,
  captureReanchorSnapshot,
  chapterDisplayText,
  findQuoteCandidates,
  locateQuote,
  parseReanchorSnapshot,
} from "../apps/server/src/services/books/reanchor";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE books (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE annotations (
      id TEXT PRIMARY KEY,
      book_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'highlight',
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL DEFAULT '',
      start_offset INTEGER NOT NULL DEFAULT 0,
      end_offset INTEGER NOT NULL DEFAULT 0,
      quote TEXT NOT NULL DEFAULT '',
      prefix TEXT NOT NULL DEFAULT '',
      suffix TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_id INTEGER,
      chapter_index INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      char_offset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO books (id, name) VALUES (1, '测试书');
    INSERT INTO chapters (book_id, idx, title, url) VALUES
      (1, 0, '第一章 初见', 'https://a/1'),
      (1, 1, '第二章 夜行', 'https://a/2');
  `);
  return db;
}

type DbArg = Parameters<typeof captureReanchorSnapshot>[1];

describe("chapterDisplayText", () => {
  it("normalizes exactly like the reader: CRLF, NBSP, blank lines", () => {
    expect(chapterDisplayText("第一段\r\n\r\n第二段\u00a0内容\n\n\n第三段  ")).toBe(
      "第一段\n第二段 内容\n第三段",
    );
  });
});

describe("locateQuote", () => {
  it("finds an exact quote and returns absolute offsets", () => {
    const text = "第一段。主角从城门走进来，雨还没停。";
    const found = locateQuote(text, "主角从城门走进来");
    expect(found).toMatchObject({ start: 4, end: 12, score: 1, ambiguous: false });
  });

  it("ignores whitespace differences between sources", () => {
    const text = "他 走 了，没有回头。";
    const found = locateQuote(text, "他走了");
    expect(found).toMatchObject({ start: 0, end: 5, score: 1 });
  });

  it("picks the occurrence nearest the old relative position", () => {
    const text = "风起了。中间隔了一段。风起了。";
    const found = locateQuote(text, "风起了。", 0.95);
    expect(found?.start).toBe(11);
    expect(found?.score).toBe(1);
  });

  it("marks a short repeated quote as ambiguous instead of guessing", () => {
    const found = locateQuote("好好。好好。好好。", "好好");
    expect(found?.ambiguous).toBe(true);
  });

  it("returns null when the quote is absent", () => {
    expect(locateQuote("今天下雨。", "主角从城门走进来")).toBeNull();
    expect(locateQuote("", "任何内容")).toBeNull();
  });

  it("lists every candidate with readable context for manual locating", () => {
    const text = "第一段。\n他推开门，雨声涌了进来。\n第二段。\n他推开门，雨声涌了进来。";
    const found = findQuoteCandidates(text, "他推开门，雨声涌了进来");
    expect(found).toHaveLength(2);
    expect(found[0].start).toBe(5);
    expect(found[0].end).toBe(5 + "他推开门，雨声涌了进来".length);
    expect(found[0].score).toBe(1);
    expect(found[0].context).toContain("雨声");
    expect(found[1].start).toBeGreaterThan(found[0].end);
  });

  it("respects the candidate limit and rejects empty input", () => {
    const quote = "他推开门，雨声涌了进来";
    const text = `开头。${quote}。中间。${quote}。结尾。`;
    const found = findQuoteCandidates(text, quote, 1);
    expect(found).toHaveLength(1);
    expect(found[0].score).toBe(1);
    expect(found[0].context).toContain("雨声");
    expect(findQuoteCandidates(text, quote, 8)).toHaveLength(2);
    expect(findQuoteCandidates(text, "")).toEqual([]);
  });
});

describe("reanchor snapshot", () => {
  it("returns null for a book without annotations or bookmarks", () => {
    const db = makeDb();
    expect(captureReanchorSnapshot(1, db as unknown as DbArg)).toBeNull();
  });

  it("captures positions and parses back", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO annotations (id, book_id, chapter_index, chapter_title, start_offset, end_offset, quote, prefix, suffix)
       VALUES ('a1', 1, 1, '第二章 夜行', 12, 20, '雨还没停', '走进来，', '。')`,
    ).run();
    db.prepare(
      "INSERT INTO bookmarks (book_id, chapter_index, title, excerpt, char_offset) VALUES (1, 0, '第一章 初见', '主角出场', 8)",
    ).run();
    const snapshot = captureReanchorSnapshot(1, db as unknown as DbArg)!;
    expect(snapshot.version).toBe(1);
    expect(snapshot.chapters).toEqual([
      { index: 0, title: "第一章 初见" },
      { index: 1, title: "第二章 夜行" },
    ]);
    expect(snapshot.annotations[0]).toMatchObject({ id: "a1", chapterIndex: 1, start: 12, end: 20, quote: "雨还没停" });
    expect(snapshot.bookmarks[0]).toMatchObject({ chapterIndex: 0, charOffset: 8, excerpt: "主角出场" });
    expect(parseReanchorSnapshot(JSON.stringify(snapshot))?.annotations).toHaveLength(1);
    expect(parseReanchorSnapshot("not json")).toBeNull();
    expect(parseReanchorSnapshot(null)).toBeNull();
  });

  it("skips chapter notes that have no quote", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO annotations (id, book_id, chapter_index, chapter_title, start_offset, end_offset, quote, comment)
       VALUES ('note1', 1, 0, '第一章 初见', 20, 20, '', '这一章的想法')`,
    ).run();
    db.prepare(
      "INSERT INTO bookmarks (book_id, chapter_index, title, excerpt, char_offset) VALUES (1, 0, '第一章 初见', '主角出场', 8)",
    ).run();
    const snapshot = captureReanchorSnapshot(1, db as unknown as DbArg)!;
    expect(snapshot.annotations).toHaveLength(0);
    expect(snapshot.bookmarks).toHaveLength(1);
  });

  it("restores annotation and bookmark positions exactly", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO annotations (id, book_id, chapter_index, chapter_title, start_offset, end_offset, quote, prefix, suffix)
       VALUES ('a1', 1, 1, '第二章 夜行', 12, 20, '雨还没停', '', '')`,
    ).run();
    db.prepare(
      "INSERT INTO bookmarks (book_id, chapter_id, chapter_index, title, excerpt, char_offset) VALUES (1, 2, 1, '第二章 夜行', '雨还没停', 12)",
    ).run();
    const snapshot = captureReanchorSnapshot(1, db as unknown as DbArg)!;
    // 模拟换源后位置被搬到别处
    db.prepare("UPDATE annotations SET chapter_index = 0, chapter_title = '第一章', start_offset = 1, end_offset = 2").run();
    db.prepare("UPDATE bookmarks SET chapter_index = 0, chapter_id = 1, char_offset = 3").run();
    const applied = applyReanchorSnapshot(1, snapshot, db as unknown as DbArg);
    expect(applied).toEqual({ annotations: 1, bookmarks: 1 });
    const annotation = db.prepare("SELECT chapter_index, start_offset, end_offset FROM annotations WHERE id = 'a1'").get() as Record<string, number>;
    expect(annotation).toMatchObject({ chapter_index: 1, start_offset: 12, end_offset: 20 });
    const bookmark = db.prepare("SELECT chapter_index, chapter_id, char_offset FROM bookmarks").get() as Record<string, number>;
    expect(bookmark).toMatchObject({ chapter_index: 1, chapter_id: 2, char_offset: 12 });
  });
});
