import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { pruneSwitchCache } from "../apps/server/src/services/switch-cache";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE switch_candidates (id INTEGER PRIMARY KEY, checked_at TEXT NOT NULL);
    CREATE TABLE switch_chapter_measures (id INTEGER PRIMARY KEY, checked_at TEXT NOT NULL);
  `);
  return db;
}

describe("switch cache retention", () => {
  it("removes candidate and chapter rows older than 30 days, keeping recent rows", () => {
    const db = makeDb();
    const candidate = db.prepare("INSERT INTO switch_candidates (checked_at) VALUES (?)");
    const measure = db.prepare("INSERT INTO switch_chapter_measures (checked_at) VALUES (?)");
    const recent = new Date().toISOString().slice(0, 19).replace("T", " ");
    candidate.run("2020-01-01 00:00:00");
    candidate.run(recent);
    measure.run("2020-01-01 00:00:00");
    measure.run(recent);
    expect(pruneSwitchCache(30, db as never)).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM switch_candidates").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM switch_chapter_measures").get() as { n: number }).n).toBe(1);
  });

  it("does not touch rows when the window is zero (clamped to one day)", () => {
    const db = makeDb();
    db.prepare("INSERT INTO switch_candidates (checked_at) VALUES (datetime('now'))").run();
    expect(pruneSwitchCache(0, db as never)).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM switch_candidates").get() as { n: number }).n).toBe(1);
  });
});
