import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { importSources, normalizePayload } from "../services/importer.js";
import { auditStatus, resumeAudit, startAudit, stopAudit } from "../services/audit.js";
import { shushanAuth, shushanConfigured, shushanSourceId } from "../services/shushan.js";
import { dahuilangAuth, dahuilangConfigured, dahuilangSourceId } from "../services/dahuilang.js";
import { hostKey } from "../services/normalize.js";
import { healthFromRow, parseSourceHealth, sourceHealthSummary } from "../services/health.js";
import { probeSourceById } from "../services/source-probe.js";
import { auditSource } from "../services/source-audit.js";
import { probeSourceAccess, readSourceRequestSettings, updateSourceRequestSettings, validateSourceHeader } from "../services/source-request.js";

interface ListQuery {
  q?: string;
  status?: string;
  health?: string;
  stage?: string;
  stageStatus?: string;
  group?: string;
  sort?: string;
  minScore?: string;
  maxScore?: string;
  enabled?: string;
  page?: string;
  pageSize?: string;
}

const HEALTH_STAGE_NAMES = ["search", "detail", "toc", "content"] as const;
const STAGE_STATUS_NAMES = ["ok", "empty", "blocked", "fail", "skip"] as const;

function listHealthSummary(row: Record<string, unknown>) {
  return sourceHealthSummary(healthFromRow(row));
}

export async function sourcesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery }>("/api/sources", async (req) => {
    const db = getDb();
    const q = (req.query.q ?? "").trim();
    const status = (req.query.status ?? "").trim();
    const health = (req.query.health ?? "").trim();
    const stage = HEALTH_STAGE_NAMES.includes(req.query.stage as (typeof HEALTH_STAGE_NAMES)[number])
      ? String(req.query.stage)
      : "";
    const stageStatus = STAGE_STATUS_NAMES.includes(req.query.stageStatus as (typeof STAGE_STATUS_NAMES)[number])
      ? String(req.query.stageStatus)
      : "";
    const group = (req.query.group ?? "").trim();
    const sort = String(req.query.sort ?? "").trim();
    const minScore = Number(req.query.minScore);
    const maxScore = Number(req.query.maxScore);
    const enabled = req.query.enabled === "0" || req.query.enabled === "1" ? req.query.enabled : "";
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50) || 50));

    const where: string[] = [];
    const params: unknown[] = [];
    if (q) {
      where.push("(name LIKE ? OR url LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (health) {
      where.push("health_state = ?");
      params.push(health);
    }
    if (stage && stageStatus) {
      where.push(`json_extract(health_json, '$.stages.${stage}.status') = ?`);
      params.push(stageStatus);
    }
    if (group) {
      where.push("group_name = ?");
      params.push(group);
    }
    if (enabled) {
      where.push("enabled = ?");
      params.push(Number(enabled));
    }
    if (Number.isFinite(minScore)) {
      where.push("health_score >= ?");
      params.push(minScore);
    }
    if (Number.isFinite(maxScore)) {
      where.push("health_score <= ?");
      params.push(maxScore);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM book_sources ${clause}`).get(...params) as { n: number }).n;
    const order =
      sort === "score" ? "health_score DESC, custom_order DESC, id ASC" :
      sort === "avgMs" ? "CASE WHEN avg_ms > 0 THEN avg_ms ELSE 999999 END ASC, custom_order DESC, id ASC" :
      sort === "lastCheck" ? "last_check_at DESC, id ASC" :
      sort === "health" ? "CASE health_state WHEN 'healthy' THEN 0 WHEN 'partial' THEN 1 WHEN 'degraded' THEN 2 WHEN 'blocked' THEN 3 WHEN 'broken' THEN 4 ELSE 5 END, health_score DESC, custom_order DESC, id ASC" :
      "custom_order DESC, id ASC";
    const rows = db
      .prepare(
        `SELECT id, name, url, group_name, type, enabled, enabled_explore, status, flag, last_error, last_check_at, last_ms,
                health_score, health_state, health_json, health_checks, health_ok, avg_ms, last_ok_at, last_fail_at,
                last_stage, last_stage_error, last_stage_at
         FROM book_sources ${clause}
         ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;

    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        group: r.group_name,
        type: r.type,
        enabled: Boolean(r.enabled),
        enabledExplore: Boolean(r.enabled_explore),
        status: r.status,
        flag: r.flag,
        lastError: r.last_error,
        lastCheckAt: r.last_check_at,
        lastMs: Number(r.last_ms ?? 0),
        ...listHealthSummary(r),
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/sources/:id", async (req, reply) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM book_sources WHERE id = ?").get(Number(req.params.id)) as
      | Record<string, unknown>
      | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    const json = JSON.parse(String(row.json)) as Record<string, unknown>;
    return {
      ...row,
      json,
      health: parseSourceHealth(row.health_json),
      audit: auditSource(json as never),
      request: readSourceRequestSettings(json),
    };
  });

  app.get<{ Params: { id: string } }>("/api/sources/:id/health", async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM book_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    const checks = db
      .prepare(
        `SELECT id, kind, ok, code, message, elapsed_ms, created_at
         FROM source_checks WHERE source_id = ? ORDER BY id DESC LIMIT 20`,
      )
      .all(id) as Array<Record<string, unknown>>;
    return {
      source: {
        id: row.id,
        name: row.name,
        url: row.url,
        group: row.group_name,
        status: row.status,
        enabled: Boolean(row.enabled),
      },
      health: healthFromRow(row),
      checks: checks.map((r) => ({
        id: r.id,
        kind: r.kind,
        ok: Boolean(r.ok),
        code: r.code,
        message: r.message,
        elapsedMs: Number(r.elapsed_ms ?? 0),
        createdAt: r.created_at,
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: { mode?: "quick" | "full"; key?: string; bookUrl?: string; chapterUrl?: string } }>(
    "/api/sources/:id/probe",
    async (req, reply) => {
      const id = Number(req.params.id);
      const db = getDb();
      if (!db.prepare("SELECT id FROM book_sources WHERE id = ?").get(id)) return reply.code(404).send({ error: "not_found" });
      try {
        return await probeSourceById(id, req.body ?? {});
      } catch (err) {
        return reply.code(500).send({ error: "probe_failed", message: String((err as Error)?.message ?? err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/sources/:id/audit", async (req, reply) => {
    const db = getDb();
    const row = db.prepare("SELECT id, json FROM book_sources WHERE id = ?").get(Number(req.params.id)) as
      | { id: number; json: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    return auditSource(JSON.parse(row.json) as never);
  });

  app.patch<{
    Params: { id: string };
    Body: { header?: string; loginUrl?: string; enabledCookieJar?: boolean };
  }>("/api/sources/:id/request", async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const body = req.body ?? {};
    if (body.header !== undefined) {
      const problem = validateSourceHeader(body.header);
      if (problem) return reply.code(400).send({ error: "invalid_header", message: problem });
    }
    if (body.loginUrl !== undefined && body.loginUrl.trim()) {
      try {
        const parsed = new URL(body.loginUrl.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
      } catch {
        return reply.code(400).send({ error: "invalid_login_url", message: "登录页地址必须是 http(s) URL" });
      }
    }
    try {
      const request = updateSourceRequestSettings(db, id, body);
      return { ok: true, request };
    } catch (err) {
      if (String((err as Error).message) === "not_found") return reply.code(404).send({ error: "not_found" });
      return reply.code(500).send({ error: "update_failed", message: String((err as Error).message) });
    }
  });

  app.post<{ Params: { id: string }; Body: { url?: string } }>("/api/sources/:id/request/probe", async (req, reply) => {
    const db = getDb();
    const row = db.prepare("SELECT json FROM book_sources WHERE id = ?").get(Number(req.params.id)) as
      | { json: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    return probeSourceAccess(JSON.parse(row.json) as Record<string, unknown>, req.body?.url);
  });

  app.post<{ Params: { id: string } }>("/api/sources/:id/health/reset", async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const row = db.prepare("SELECT id FROM book_sources WHERE id = ?").get(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    db.prepare(
      `UPDATE book_sources SET health_score = 0, health_state = 'unknown', health_json = '{}',
        health_checks = 0, health_ok = 0, avg_ms = 0, last_ok_at = NULL, last_fail_at = NULL,
        last_stage = '', last_stage_error = '', last_stage_at = NULL,
        status = 'unknown', fail_count = 0, last_error = '', updated_at = datetime('now') WHERE id = ?`,
    ).run(id);
    return { ok: true, health: healthFromRow(db.prepare("SELECT * FROM book_sources WHERE id = ?").get(id) as Record<string, unknown>) };
  });

  app.post("/api/sources/import", async (req, reply) => {
    const body = req.body as { json?: string; sources?: unknown; url?: string } | undefined;
    if (!body || (!body.json && !body.sources && !body.url)) {
      return reply.code(400).send({ error: "body must contain json, sources or url" });
    }
    let payload: unknown = body.sources;
    if (body.json) {
      try {
        payload = JSON.parse(body.json);
      } catch {
        return reply.code(400).send({ error: "invalid_json" });
      }
    }
    if (body.url) {
      try {
        const res = await fetch(body.url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) return reply.code(502).send({ error: `upstream_${res.status}` });
        payload = await res.json();
      } catch (err) {
        return reply.code(502).send({ error: "fetch_failed", message: String(err) });
      }
    }
    const db = getDb();
    const result = importSources(db, payload);
    if (result.total === 0) return reply.code(400).send({ error: "no_sources_found", ...result });
    return result;
  });

  app.patch<{
    Params: { id: string };
    Body: { enabled?: boolean; enabledExplore?: boolean; name?: string; group?: string; force?: boolean };
  }>(
    "/api/sources/:id",
    async (req, reply) => {
      const db = getDb();
      const id = Number(req.params.id);
      const row = db.prepare("SELECT id, json FROM book_sources WHERE id = ?").get(id) as
        | { id: number; json: string }
        | undefined;
      if (!row) return reply.code(404).send({ error: "not_found" });
      const body = req.body ?? {};
      if (body.enabled === true && body.force !== true) {
        const audit = auditSource(JSON.parse(row.json) as never);
        if (audit.errors > 0) {
          return reply.code(422).send({
            error: "source_audit_failed",
            message: `书源有 ${audit.errors} 个静态错误，先修复或传 force=true 强制启用`,
            audit,
          });
        }
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      if (typeof body.enabled === "boolean") {
        sets.push("enabled = ?");
        params.push(body.enabled ? 1 : 0);
      }
      if (typeof body.enabledExplore === "boolean") {
        sets.push("enabled_explore = ?");
        params.push(body.enabledExplore ? 1 : 0);
      }
      if (typeof body.name === "string" && body.name.trim()) {
        sets.push("name = ?");
        params.push(body.name.trim());
      }
      if (typeof body.group === "string") {
        sets.push("group_name = ?");
        params.push(body.group);
      }
      if (!sets.length) return reply.code(400).send({ error: "nothing_to_update" });
      sets.push("updated_at = datetime('now')");
      db.prepare(`UPDATE book_sources SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/sources/:id", async (req) => {
    const db = getDb();
    db.prepare("DELETE FROM book_sources WHERE id = ?").run(Number(req.params.id));
    return { ok: true };
  });

  app.post<{ Body: { ids?: number[] } }>("/api/sources/batch-delete", async (req, reply) => {
    const ids = (req.body?.ids ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (!ids.length) return reply.code(400).send({ error: "missing_ids" });
    const db = getDb();
    const placeholders = ids.map(() => "?").join(",");
    const result = db.prepare(`DELETE FROM book_sources WHERE id IN (${placeholders})`).run(...ids);
    return { ok: true, deleted: result.changes };
  });

  app.get("/api/stats", async () => {
    const db = getDb();
    const total = (db.prepare("SELECT COUNT(*) AS n FROM book_sources").get() as { n: number }).n;
    const byStatus = db.prepare("SELECT status, COUNT(*) AS n FROM book_sources GROUP BY status").all() as Array<{
      status: string;
      n: number;
    }>;
    const byType = db.prepare("SELECT type, COUNT(*) AS n FROM book_sources GROUP BY type").all() as Array<{
      type: number;
      n: number;
    }>;
    const byHealth = db.prepare("SELECT health_state AS state, COUNT(*) AS n FROM book_sources GROUP BY health_state").all() as Array<{
      state: string;
      n: number;
    }>;
    const byHealthEnabled = db
      .prepare("SELECT health_state AS state, COUNT(*) AS n FROM book_sources WHERE enabled = 1 GROUP BY health_state")
      .all() as Array<{ state: string; n: number }>;
    const enabledCount = (db.prepare("SELECT COUNT(*) AS n FROM book_sources WHERE enabled = 1").get() as { n: number }).n;
    const groups = db
      .prepare("SELECT group_name AS name, COUNT(*) AS n FROM book_sources WHERE group_name <> '' GROUP BY group_name ORDER BY n DESC LIMIT 20")
      .all() as Array<{ name: string; n: number }>;
    const stages: Record<string, Record<string, number>> = {};
    for (const stage of HEALTH_STAGE_NAMES) {
      const rows = db
        .prepare(`SELECT json_extract(health_json, '$.stages.${stage}.status') AS status, COUNT(*) AS n
                  FROM book_sources WHERE json_extract(health_json, '$.stages.${stage}.status') IS NOT NULL
                  GROUP BY status`)
        .all() as Array<{ status: string; n: number }>;
      stages[stage] = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    }
    const groupsHealth = db
      .prepare(`SELECT group_name AS name, COUNT(*) AS total,
                       SUM(CASE WHEN health_state IN ('healthy','partial') THEN 1 ELSE 0 END) AS healthy,
                       SUM(CASE WHEN health_state = 'broken' THEN 1 ELSE 0 END) AS broken
                FROM book_sources WHERE group_name <> '' GROUP BY group_name ORDER BY total DESC LIMIT 20`)
      .all() as Array<{ name: string; total: number; healthy: number; broken: number }>;
    return {
      total,
      enabled: enabledCount,
      disabled: total - enabledCount,
      status: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
      health: Object.fromEntries(byHealth.map((r) => [r.state, r.n])),
      healthEnabled: Object.fromEntries(byHealthEnabled.map((r) => [r.state, r.n])),
      stages,
      types: Object.fromEntries(byType.map((r) => [String(r.type), r.n])),
      groups,
      groupsHealth,
    };
  });

  app.post("/api/sources/check-duplicates", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT id, name, url, host_key FROM book_sources ORDER BY id").all() as Array<{
      id: number;
      name: string;
      url: string;
      host_key: string;
    }>;
    const seen = new Map<string, number>();
    const duplicates: Array<{ hostKey: string; ids: number[] }> = [];
    for (const r of rows) {
      const key = r.host_key || hostKey(r.url);
      const first = seen.get(key);
      if (first === undefined) seen.set(key, r.id);
      else duplicates.push({ hostKey: key, ids: [first, r.id] });
    }
    return { duplicates: duplicates.length, samples: duplicates.slice(0, 20) };
  });

  app.post<{
    Body: {
      ids?: number[];
      all?: boolean;
      status?: string;
      health?: string;
      stage?: string;
      stageStatus?: string;
      group?: string;
      q?: string;
      key?: string;
      mode?: "quick" | "full";
      concurrency?: number;
    };
  }>("/api/sources/audit/start", async (req, reply) => {
    const body = req.body ?? {};
    const db = getDb();
    let ids = (body.ids ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (body.all) {
      const where = ["enabled = 1"];
      const params: unknown[] = [];
      if (body.status) {
        where.push("status = ?");
        params.push(body.status);
      }
      if (body.health) {
        where.push("health_state = ?");
        params.push(body.health);
      }
      if (body.group) {
        where.push("group_name = ?");
        params.push(body.group);
      }
      if (body.stage && body.stageStatus && HEALTH_STAGE_NAMES.includes(body.stage as (typeof HEALTH_STAGE_NAMES)[number])) {
        where.push(`json_extract(health_json, '$.stages.${body.stage}.status') = ?`);
        params.push(body.stageStatus);
      }
      if (body.q) {
        where.push("(name LIKE ? OR url LIKE ?)");
        params.push(`%${body.q}%`, `%${body.q}%`);
      }
      ids = (
        db.prepare(`SELECT id FROM book_sources WHERE ${where.join(" AND ")} ORDER BY id`).all(...params) as Array<{ id: number }>
      ).map((r) => r.id);
    }
    if (!ids.length) return reply.code(400).send({ error: "no_sources" });
    const key = (body.key ?? "诡秘之主").trim() || "诡秘之主";
    return startAudit(db, ids, { key, mode: body.mode, concurrency: body.concurrency });
  });

  app.get("/api/sources/audit/status", async () => auditStatus());

  app.post("/api/sources/audit/stop", async () => stopAudit());

  app.post("/api/sources/audit/resume", async (_req, reply) => {
    const state = resumeAudit(getDb());
    if (!state) return reply.code(400).send({ error: "no_resume", message: "没有可继续的巡检，或上次已经跑完。" });
    return state;
  });

  /** 两条内置聚合源没有普通规则 JSON，单独给设置页/书源页一张健康卡。 */
  app.get("/api/sources/builtins", async () => {
    const db = getDb();
    const card = (
      kind: "shushan" | "dahuilang",
      name: string,
      sourceId: number | null,
      configured: boolean,
      account: string,
      plan: string,
      server?: string,
    ) => {
      const row = sourceId
        ? (db.prepare("SELECT * FROM book_sources WHERE id = ?").get(sourceId) as Record<string, unknown> | undefined)
        : undefined;
      return {
        kind,
        name,
        sourceId: row ? Number(row.id) : Number(sourceId ?? 0),
        configured,
        account,
        plan,
        server: server ?? "",
        enabled: row ? Boolean(row.enabled) : false,
        ...sourceHealthSummary(healthFromRow(row)),
      };
    };
    const ss = shushanAuth();
    const dhl = dahuilangAuth();
    return {
      items: [
        card("shushan", "书山聚合", shushanSourceId(), shushanConfigured(), ss.email || ss.nickname || "", ss.member ? "会员" : "免费账号", ""),
        card("dahuilang", "大灰狼聚合", dahuilangSourceId(), dahuilangConfigured(), dhl.email || dhl.nickname || "", dhl.vipLabel || (dhl.member ? "会员" : "免费账号"), dhl.server),
      ],
    };
  });

  app.get("/api/sources/export", async (_req, reply) => {
    const db = getDb();
    const rows = db.prepare("SELECT json FROM book_sources ORDER BY id").all() as Array<{ json: string }>;
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="bookSources.json"');
    return `[${rows.map((r) => r.json).join(",")}]`;
  });

  app.get("/api/import/parse", async (req, reply) => {
    const url = String((req.query as { url?: string }).url ?? "");
    if (!url) return reply.code(400).send({ error: "missing_url" });
    const match = /^legado:\/\/import\/bookSource\?src=(.+)$/.exec(url);
    if (!match) return reply.code(400).send({ error: "unsupported_scheme" });
    const target = decodeURIComponent(match[1]);
    return { url: target };
  });
}