import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  backfillSourceHealth,
  computeHealthScore,
  computeHealthState,
  emptyHealth,
  healthFromRow,
  parseSourceHealth,
  projectLegacyStatus,
  pruneSourceChecks,
  recordStageResults,
} from "../apps/server/src/services/health";
import type { SourceHealth, StageHealth } from "@legado/shared";

type Db = Parameters<typeof recordStageResults>[0];

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE book_sources (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '',
      type INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      enabled_explore INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
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
  `);
  return db;
}

function stage(status: StageHealth["status"], extra: Partial<StageHealth> = {}): StageHealth {
  return { status, at: "2026-01-01T00:00:00.000Z", ms: 500, ...extra };
}

function fullHealth(): SourceHealth {
  return {
    ...emptyHealth(),
    checks: 4,
    ok: 4,
    avgMs: 500,
    stages: {
      search: stage("ok", { count: 10 }),
      detail: stage("ok"),
      toc: stage("ok", { count: 30 }),
      content: stage("ok", { chars: 1200 }),
    },
  };
}

describe("health score and state", () => {
  it("scores an all-ok source as healthy", () => {
    const health = fullHealth();
    health.score = computeHealthScore(health);
    expect(health.score).toBeGreaterThanOrEqual(75);
    expect(computeHealthState(health)).toBe("healthy");
  });

  it("treats a blocked content stage as blocked, not broken", () => {
    const health = fullHealth();
    health.stages.content = stage("blocked", { code: "vip_required", message: "需要会员" });
    health.score = computeHealthScore(health);
    expect(computeHealthState(health)).toBe("blocked");
    expect(projectLegacyStatus("blocked")).toBe("retest");
  });

  it("treats a search-only empty result as partial, not degraded", () => {
    const health = { ...emptyHealth(), checks: 1, ok: 0, stages: { search: stage("empty", { count: 0 }) } };
    health.score = computeHealthScore(health);
    expect(computeHealthState(health)).toBe("partial");
    expect(projectLegacyStatus("partial")).toBe("ok");
  });

  it("still degrades when an empty search is followed by another empty stage", () => {
    const health = {
      ...emptyHealth(),
      checks: 2,
      ok: 0,
      stages: { search: stage("empty", { count: 0 }), toc: stage("empty", { count: 0 }) },
    };
    health.score = computeHealthScore(health);
    expect(computeHealthState(health)).toBe("degraded");
  });

  it("only becomes broken after two consecutive hard failures", () => {
    const health = { ...emptyHealth(), checks: 2, ok: 0, failStreak: 1, stages: { search: stage("fail") } };
    health.score = computeHealthScore(health);
    expect(computeHealthState(health)).toBe("degraded");
    health.failStreak = 2;
    expect(computeHealthState(health)).toBe("broken");
  });

  it("keeps a passive search failure at degraded instead of broken", () => {
    const health = { ...emptyHealth(), checks: 1, ok: 0, stages: { search: stage("fail") } };
    health.score = computeHealthScore(health);
    expect(computeHealthState(health, false)).toBe("degraded");
  });

  it("returns partial for a source with only a successful search stage", () => {
    const health = { ...emptyHealth(), checks: 1, ok: 1, avgMs: 300, stages: { search: stage("ok", { count: 5 }) } };
    health.score = computeHealthScore(health);
    expect(computeHealthState(health)).toBe("partial");
    expect(projectLegacyStatus("partial")).toBe("ok");
  });

  it("gives a fully covered source a higher score than a search-only one", () => {
    const full = fullHealth();
    full.score = computeHealthScore(full);
    const partial = { ...emptyHealth(), checks: 1, ok: 1, avgMs: 500, stages: { search: stage("ok", { count: 10 }) } };
    partial.score = computeHealthScore(partial);
    expect(full.score).toBeGreaterThan(partial.score);
  });

  it("parses corrupt health_json as an empty snapshot", () => {
    expect(parseSourceHealth("{oops").state).toBe("unknown");
    expect(parseSourceHealth("").checks).toBe(0);
  });
});

describe("recordStageResults", () => {
  it("writes materialized columns and one source_checks row", () => {
    const db = makeDb();
    db.prepare("INSERT INTO book_sources (id, name) VALUES (1, '测试源')").run();
    const health = recordStageResults(
      db as unknown as Db,
      1,
      {
        search: stage("ok", { count: 8, ms: 400 }),
        detail: stage("ok", { ms: 300 }),
        toc: stage("ok", { count: 20 }),
        content: stage("blocked", { code: "login_required", message: "请先登录" }),
      },
      { active: true, elapsedMs: 1200, recordCheck: true },
    );
    expect(health.state).toBe("blocked");
    expect(health.checks).toBe(4);
    expect(health.ok).toBe(4);
    expect(health.avgMs).toBeGreaterThan(0);
    const row = db.prepare("SELECT health_state, health_checks, health_json, status, fail_count FROM book_sources WHERE id = 1").get() as Record<string, unknown>;
    expect(row.health_state).toBe("blocked");
    expect(Number(row.health_checks)).toBe(4);
    expect(JSON.parse(String(row.health_json)).stages.content.status).toBe("blocked");
    expect(row.status).toBe("retest");
    expect(Number(row.fail_count)).toBe(0);
    const checks = db.prepare("SELECT kind, ok, code FROM source_checks WHERE source_id = 1").all() as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(1);
    expect(checks[0].kind).toBe("health");
    expect(checks[0].ok).toBe(0);
    expect(checks[0].code).toBe("blocked");
  });

  it("does not count skipped stages as checks", () => {
    const db = makeDb();
    db.prepare("INSERT INTO book_sources (id) VALUES (1)").run();
    const health = recordStageResults(
      db as unknown as Db,
      1,
      { search: stage("fail", { code: "search_failed" }), detail: stage("skip"), toc: stage("skip"), content: stage("skip") },
      { active: true },
    );
    expect(health.checks).toBe(1);
    expect(health.failStreak).toBe(1);
  });
});

describe("backfillSourceHealth", () => {
  it("maps legacy statuses without changing them", () => {
    const db = makeDb();
    db.prepare("INSERT INTO book_sources (id, status, last_error, last_ms) VALUES (1, 'ok', '', 500)").run();
    db.prepare("INSERT INTO book_sources (id, status, last_error, last_ms) VALUES (2, 'retest', 'timeout', 2000)").run();
    db.prepare("INSERT INTO book_sources (id, status, last_error, last_ms) VALUES (3, 'error', 'boom', 9000)").run();
    db.prepare("INSERT INTO book_sources (id, status) VALUES (4, 'unknown')").run();
    const count = backfillSourceHealth(db as unknown as Db);
    expect(count).toBe(3);
    const rows = db.prepare("SELECT id, status, health_state, health_score, health_checks FROM book_sources ORDER BY id").all() as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ status: "ok", health_state: "partial", health_checks: 1 });
    expect(Number(rows[0].health_score)).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ status: "retest", health_state: "degraded" });
    expect(rows[2]).toMatchObject({ status: "error", health_state: "broken" });
    expect(rows[3]).toMatchObject({ status: "unknown", health_state: "unknown" });
    expect(backfillSourceHealth(db as unknown as Db)).toBe(0);
  });

  it("prunes health checks to 50 per source and 90 days", () => {
    const db = makeDb();
    const insert = db.prepare("INSERT INTO source_checks (source_id, kind, ok, created_at) VALUES (?, 'health', 1, ?)");
    const recent = new Date().toISOString().slice(0, 19).replace("T", " ");
    for (let i = 0; i < 55; i += 1) insert.run(1, recent);
    insert.run(1, "2020-01-01 00:00:00");
    insert.run(2, recent);
    insert.run(2, "2020-01-01 00:00:00");
    const removed = pruneSourceChecks(db as unknown as Db);
    expect(removed).toBe(7);
    expect((db.prepare("SELECT COUNT(*) AS n FROM source_checks WHERE source_id = 1").get() as { n: number }).n).toBe(50);
    expect((db.prepare("SELECT COUNT(*) AS n FROM source_checks WHERE source_id = 2").get() as { n: number }).n).toBe(1);
  });

  it("scopes health check pruning to one source", () => {
    const db = makeDb();
    const insert = db.prepare("INSERT INTO source_checks (source_id, kind, ok) VALUES (?, 'health', 1)");
    for (let i = 0; i < 55; i += 1) insert.run(1);
    for (let i = 0; i < 55; i += 1) insert.run(2);
    expect(pruneSourceChecks(db as unknown as Db, 1)).toBe(5);
    expect((db.prepare("SELECT COUNT(*) AS n FROM source_checks WHERE source_id = 1").get() as { n: number }).n).toBe(50);
    expect((db.prepare("SELECT COUNT(*) AS n FROM source_checks WHERE source_id = 2").get() as { n: number }).n).toBe(55);
  });

  it("reads materialized columns through healthFromRow", () => {
    const health = healthFromRow({
      health_score: 88,
      health_state: "healthy",
      health_json: JSON.stringify(fullHealth()),
      health_checks: 4,
      health_ok: 4,
      avg_ms: 420,
    });
    expect(health.state).toBe("healthy");
    expect(health.score).toBe(88);
    expect(health.avgMs).toBe(420);
    expect(health.stages.search?.status).toBe("ok");
  });
});
