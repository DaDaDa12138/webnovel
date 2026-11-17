import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  clearSwitchAnchor,
  normalizeSwitchAnchor,
  readSwitchAnchor,
  saveSwitchAnchor,
} from "../apps/server/src/services/books/switch-anchors";
import { fromServerSwitchAnchor, makeSwitchAnchor, toSwitchAnchorPayload } from "../apps/web/src/lib/switch-anchor";

type Db = Parameters<typeof readSwitchAnchor>[0];

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE books (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
    INSERT INTO books (id, name) VALUES (1, '三体');
    CREATE TABLE switch_anchors (
      book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL,
      char_offset INTEGER NOT NULL,
      chapter_percent REAL NOT NULL,
      quote TEXT NOT NULL,
      prefix TEXT NOT NULL,
      suffix TEXT NOT NULL,
      quote_start INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

const payload = {
  chapterIndex: 3,
  chapterTitle: "第三章",
  charOffset: 120,
  chapterPercent: 0.25,
  quote: "主角从城门走进来",
  prefix: "第一段",
  suffix: "雨还没停",
  quoteStart: 100,
};

describe("switch anchor payload", () => {
  it("keeps only the fields the server stores", () => {
    const anchor = makeSwitchAnchor({
      bookId: "book-1",
      chapterIndex: 0,
      chapterTitle: "第一章",
      text: "第一段写了一些铺垫，主角从城门走进来，雨还没停。",
      charOffset: 10,
      chapterPercent: 0.2,
    })!;
    const wire = toSwitchAnchorPayload(anchor);
    expect(Object.keys(wire).sort()).toEqual([
      "chapterIndex",
      "chapterPercent",
      "chapterTitle",
      "charOffset",
      "prefix",
      "quote",
      "quoteStart",
      "suffix",
    ]);
    expect(wire).not.toHaveProperty("bookId");
    expect(wire).not.toHaveProperty("at");
  });

  it("turns a server payload back into a local anchor", () => {
    const anchor = fromServerSwitchAnchor("7", payload);
    expect(anchor).toMatchObject(payload);
    expect(anchor.bookId).toBe("7");
    expect(anchor.at).toBeGreaterThan(0);
  });
});

describe("switch anchor storage", () => {
  it("normalizes and clamps a payload", () => {
    const anchor = normalizeSwitchAnchor({
      ...payload,
      chapterIndex: -4,
      charOffset: 99999999,
      chapterPercent: 3,
      quote: "  主角从城门走进来  ",
    });
    expect(anchor).toMatchObject({
      chapterIndex: 0,
      charOffset: 10_000_000,
      chapterPercent: 1,
      quote: "主角从城门走进来",
    });
  });

  it("rejects a payload without a quote", () => {
    expect(normalizeSwitchAnchor({ ...payload, quote: "   " })).toBeNull();
    expect(normalizeSwitchAnchor(null)).toBeNull();
  });

  it("saves, overwrites and reads a book anchor", () => {
    const db = makeDb();
    saveSwitchAnchor(db as unknown as Db, 1, payload);
    expect(readSwitchAnchor(db as unknown as Db, 1)).toMatchObject(payload);
    saveSwitchAnchor(db as unknown as Db, 1, { ...payload, quote: "新的句子" });
    expect(readSwitchAnchor(db as unknown as Db, 1)?.quote).toBe("新的句子");
  });

  it("uses the post-switch chapter and title when given a target", () => {
    const db = makeDb();
    saveSwitchAnchor(db as unknown as Db, 1, payload, { index: 9, title: "第九章" });
    expect(readSwitchAnchor(db as unknown as Db, 1)).toMatchObject({
      chapterIndex: 9,
      chapterTitle: "第九章",
      quote: payload.quote,
    });
  });

  it("hides an anchor after 24 hours", () => {
    const db = makeDb();
    saveSwitchAnchor(db as unknown as Db, 1, payload);
    db.prepare("UPDATE switch_anchors SET created_at = datetime('now', '-25 hours') WHERE book_id = 1").run();
    expect(readSwitchAnchor(db as unknown as Db, 1)).toBeNull();
  });

  it("clears on null and on an explicit clear", () => {
    const db = makeDb();
    saveSwitchAnchor(db as unknown as Db, 1, payload);
    expect(saveSwitchAnchor(db as unknown as Db, 1, null)).toBeNull();
    expect(readSwitchAnchor(db as unknown as Db, 1)).toBeNull();
    saveSwitchAnchor(db as unknown as Db, 1, payload);
    clearSwitchAnchor(db as unknown as Db, 1);
    expect(readSwitchAnchor(db as unknown as Db, 1)).toBeNull();
  });
});
