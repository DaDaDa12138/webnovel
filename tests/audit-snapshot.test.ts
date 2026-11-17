import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  AUDIT_SNAPSHOT_KEY,
  readAuditSnapshot,
  restoreAudit,
} from "../apps/server/src/services/audit";

type Db = Parameters<typeof readAuditSnapshot>[0];

function makeDb(value?: string): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  if (value !== undefined) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(AUDIT_SNAPSHOT_KEY, value);
  }
  return db;
}

function snapshot(patch: { running?: boolean; remaining?: number[] } = {}) {
  return JSON.stringify({
    version: 1,
    state: {
      running: patch.running ?? true,
      key: "诡秘之主",
      mode: "full",
      total: 2,
      done: 1,
      ok: 1,
      failed: 0,
      current: "第二源",
      startedAt: 1,
      finishedAt: 0,
      stopped: false,
      cursor: 1,
      stages: {},
      health: { healthy: 1 },
      errors: [],
    },
    ids: [1, 2],
    remaining: patch.remaining ?? [2],
    options: { key: "诡秘之主", mode: "full", concurrency: 6 },
    savedAt: 1,
  });
}

describe("audit snapshot persistence", () => {
  it("returns null when there is no snapshot", () => {
    expect(readAuditSnapshot(makeDb() as unknown as Db)).toBeNull();
  });

  it("reads ids, remaining, options and sanitizes malformed values", () => {
    const db = makeDb(JSON.stringify({
      version: 1,
      state: {},
      ids: [1, 2, 2, -3, "x"],
      remaining: [2, 9],
      options: { key: "  ", mode: "weird", concurrency: 999 },
      savedAt: "12",
    }));
    const saved = readAuditSnapshot(db as unknown as Db);
    expect(saved?.ids).toEqual([1, 2]);
    expect(saved?.remaining).toEqual([2]);
    expect(saved?.options).toEqual({ key: "", mode: "quick", concurrency: 24 });
  });

  it("marks an interrupted audit as resumable, then clears after completion", () => {
    const db = makeDb(snapshot());
    const state = restoreAudit(db as unknown as Db);
    expect(state?.running).toBe(false);
    expect(state?.interrupted).toBe(true);
    expect(state?.canResume).toBe(true);
    expect(state?.total).toBe(2);
    expect(state?.done).toBe(1);

    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(snapshot({ running: false, remaining: [] }), AUDIT_SNAPSHOT_KEY);
    expect(readAuditSnapshot(db as unknown as Db)?.remaining).toEqual([]);
  });

  it("rejects a broken or wrong-version snapshot", () => {
    expect(readAuditSnapshot(makeDb("{") as unknown as Db)).toBeNull();
    expect(readAuditSnapshot(makeDb(JSON.stringify({ version: 2, ids: [], remaining: [] })) as unknown as Db)).toBeNull();
  });
});
