import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { recordCheck } from "../apps/server/src/services/health";

type Db = Parameters<typeof recordCheck>[0];

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE book_sources (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'retest',
      last_error TEXT NOT NULL DEFAULT '',
      last_ms INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_check_at TEXT,
      health_score INTEGER NOT NULL DEFAULT 0,
      health_state TEXT NOT NULL DEFAULT 'unknown',
      health_json TEXT NOT NULL DEFAULT '{}',
      health_checks INTEGER NOT NULL DEFAULT 0,
      health_ok INTEGER NOT NULL DEFAULT 0,
      avg_ms INTEGER NOT NULL DEFAULT 0,
      last_ok_at TEXT,
      last_fail_at TEXT,
      last_stage TEXT NOT NULL DEFAULT '',
      last_stage_error TEXT NOT NULL DEFAULT '',
      last_stage_at TEXT
    );
    CREATE TABLE source_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0,
      code TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      meta TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO book_sources (id) VALUES (1);
  `);
  return db;
}

function row(db: Database.Database) {
  return db.prepare("SELECT status, fail_count, last_error, last_ms FROM book_sources WHERE id = 1").get() as {
    status: string;
    fail_count: number;
    last_error: string;
    last_ms: number;
  };
}

describe("recordCheck", () => {
  it("marks a source usable and clears earlier failures", () => {
    const db = makeDb();
    recordCheck(db as unknown as Db, 1, { error: "boom", ms: 500 });
    expect(row(db).fail_count).toBe(1);
    recordCheck(db as unknown as Db, 1, { count: 12, ms: 800 });
    expect(row(db)).toMatchObject({ status: "ok", fail_count: 0, last_error: "", last_ms: 800 });
  });

  it("keeps a reachable-but-empty source in retest without counting a failure", () => {
    const db = makeDb();
    recordCheck(db as unknown as Db, 1, { count: 0, ms: 300 });
    expect(row(db)).toMatchObject({ status: "retest", fail_count: 0 });
  });

  it("only declares a source broken after two consecutive hard failures", () => {
    const db = makeDb();
    recordCheck(db as unknown as Db, 1, { error: "timeout", ms: 12000 });
    expect(row(db)).toMatchObject({ status: "retest", fail_count: 1 });
    recordCheck(db as unknown as Db, 1, { error: "timeout", ms: 12000 });
    expect(row(db)).toMatchObject({ status: "error", fail_count: 2 });
    recordCheck(db as unknown as Db, 1, { count: 3, ms: 900 });
    expect(row(db)).toMatchObject({ status: "ok", fail_count: 0 });
  });

  it("keeps a verified source ok when a search simply finds nothing", () => {
    const db = makeDb();
    recordCheck(db as unknown as Db, 1, { count: 5, ms: 700 });
    expect(row(db).status).toBe("ok");
    // 换一本书搜不到时不能把刚验证过的源打回 retest。
    recordCheck(db as unknown as Db, 1, { count: 0, ms: 400 }, { keepStatusWhenEmpty: true });
    expect(row(db)).toMatchObject({ status: "ok", last_ms: 400 });
  });

  it("leaves a verified source untouched when an ordinary search times out", () => {
    const db = makeDb();
    recordCheck(db as unknown as Db, 1, { count: 5, ms: 700 });
    recordCheck(db as unknown as Db, 1, { error: "timeout after 20000ms", ms: 20000 }, { countFailure: false });
    expect(row(db)).toMatchObject({ status: "ok", fail_count: 0 });
  });

  it("does not accumulate failures from ordinary searches", () => {
    const db = makeDb();
    recordCheck(db as unknown as Db, 1, { error: "timeout" }, { countFailure: false });
    recordCheck(db as unknown as Db, 1, { error: "timeout" }, { countFailure: false });
    expect(row(db)).toMatchObject({ status: "retest", fail_count: 0 });
  });
});