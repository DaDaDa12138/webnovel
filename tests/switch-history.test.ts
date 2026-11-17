import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  dropSwitchHistory,
  latestSwitchHistory,
  listSwitchHistory,
  recordSwitchHistory,
} from "../apps/server/src/services/books/switch-book";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE book_sources (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE switch_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      source_id INTEGER,
      book_url TEXT NOT NULL DEFAULT '',
      book_name TEXT NOT NULL DEFAULT '',
      chapters INTEGER NOT NULL DEFAULT 0,
      chapter_index INTEGER NOT NULL DEFAULT 0,
      chapter_title TEXT NOT NULL DEFAULT '',
      char_offset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reanchor_snapshot TEXT,
      kind TEXT NOT NULL DEFAULT 'manual'
    );
    INSERT INTO book_sources (id, name) VALUES (7, '旧书源'), (8, '新书源');
  `);
  return db;
}

function makeAdder(db: Database.Database) {
  let seq = 0;
  return function add(kind: "manual" | "auto", sourceId = 7) {
    seq += 1;
    return recordSwitchHistory(db, 1, {
      source_id: sourceId,
      book_url: `https://source/${seq}`,
      book_name: `书 ${seq}`,
      chapters: 100 + seq,
      chapter_index: seq,
      chapter_title: `第 ${seq} 章`,
      char_offset: seq * 10,
      reanchor_snapshot: seq === 2 ? '{"annotations":[],"bookmarks":[]}' : null,
      kind,
    });
  };
}

describe("switch history", () => {
  it("records entries and returns increasing ids with the right kind", () => {
    const db = makeDb();
    const add = makeAdder(db);
    const first = add("manual");
    const second = add("auto");
    expect(second).toBeGreaterThan(first);
    const latest = latestSwitchHistory(1, db);
    expect(latest).toMatchObject({
      id: second,
      kind: "auto",
      chapters: 102,
      chapter_index: 2,
      char_offset: 20,
    });
    expect(latest?.reanchor_snapshot).toContain("annotations");
  });

  it("keeps only the latest five entries per book", () => {
    const db = makeDb();
    const add = makeAdder(db);
    const ids = [1, 2, 3, 4, 5, 6].map((_, i) => add(i % 2 ? "auto" : "manual"));
    const rows = db.prepare("SELECT id FROM switch_history WHERE book_id = 1 ORDER BY id").all() as Array<{ id: number }>;
    expect(rows.map((row) => row.id)).toEqual(ids.slice(1));
    expect(latestSwitchHistory(1, db)?.id).toBe(ids[5]);
  });

  it("lists newest first with source names and clamps the limit", () => {
    const db = makeDb();
    const add = makeAdder(db);
    add("manual", 7);
    add("auto", 8);
    add("manual", 7);
    const items = listSwitchHistory(1, 2, db);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "manual", source_name: "旧书源", chapters: 103 });
    expect(items[1]).toMatchObject({ kind: "auto", source_name: "新书源" });
    expect(listSwitchHistory(1, 0, db)).toHaveLength(1);
  });

  it("falls back to 原来源 when the old source row is gone", () => {
    const db = makeDb();
    const add = makeAdder(db);
    add("auto", 99);
    expect(listSwitchHistory(1, 5, db)[0]?.source_name).toBe("原来源");
  });

  it("drops a single history entry", () => {
    const db = makeDb();
    const add = makeAdder(db);
    const id = add("manual");
    expect(latestSwitchHistory(1, db)?.id).toBe(id);
    dropSwitchHistory(id, db);
    expect(latestSwitchHistory(1, db)).toBeUndefined();
  });
});
