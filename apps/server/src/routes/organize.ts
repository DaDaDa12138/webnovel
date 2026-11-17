import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";

interface SourceRow {
  id: number;
  name: string;
  url: string;
  host_key: string;
  group_name: string;
  type: number;
  enabled: number;
  status: string;
  health_state: string;
  health_score: number;
  last_error: string;
  last_check_at: string;
  json: string;
}

/** Rough rule-completeness score: a source with a full search/toc/content chain wins over a stub. */
export function ruleScore(json: string): number {
  try {
    const src = JSON.parse(json) as Record<string, Record<string, unknown> | unknown>;
    const search = (src.ruleSearch ?? {}) as Record<string, unknown>;
    const info = (src.ruleBookInfo ?? {}) as Record<string, unknown>;
    const toc = (src.ruleToc ?? {}) as Record<string, unknown>;
    const content = (src.ruleContent ?? {}) as Record<string, unknown>;
    let score = 0;
    if (search.bookList) score += 4;
    for (const field of ["name", "bookUrl", "author", "coverUrl", "intro", "kind", "lastChapter"]) {
      if (search[field]) score += 1;
    }
    if (info.init) score += 2;
    for (const field of ["name", "author", "coverUrl", "intro"]) {
      if (info[field]) score += 1;
    }
    if (toc.chapterList) score += 4;
    for (const field of ["chapterName", "chapterUrl", "nextTocUrl"]) {
      if (toc[field]) score += 1;
    }
    if (content.content) score += 4;
    if (src.exploreUrl) score += 1;
    return score;
  } catch {
    return -1;
  }
}

/** Same site often appears several times with different paths (/search, /index.html); group by hostname. */
function groupKey(row: SourceRow): string {
  try {
    const host = new URL(row.url).hostname.toLowerCase().replace(/^www\./, "");
    return host || row.host_key;
  } catch {
    return row.host_key;
  }
}

function pickKeep(rows: SourceRow[]): SourceRow {
  return [...rows].sort((a, b) => {
    const okA = a.status === "ok" ? 1 : 0;
    const okB = b.status === "ok" ? 1 : 0;
    if (okA !== okB) return okB - okA;
    const scoreDiff = ruleScore(b.json) - ruleScore(a.json);
    if (scoreDiff !== 0) return scoreDiff;
    if (b.json.length !== a.json.length) return b.json.length - a.json.length;
    return a.id - b.id;
  })[0]!;
}

export async function organizeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sources/organize", async () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, url, host_key, group_name, type, enabled, status, health_state, health_score,
                last_error, last_check_at, json
         FROM book_sources ORDER BY id ASC`,
      )
      .all() as SourceRow[];

    const byKey = new Map<string, SourceRow[]>();
    for (const row of rows) {
      const key = groupKey(row);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row);
      else byKey.set(key, [row]);
    }

    const duplicates = [...byKey.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => {
        const keep = pickKeep(list);
        return {
          key,
          count: list.length,
          keep: { id: keep.id, name: keep.name, url: keep.url, status: keep.status, score: ruleScore(keep.json) },
          members: list.map((row) => ({
            id: row.id,
            name: row.name,
            url: row.url,
            status: row.status,
            score: ruleScore(row.json),
            keep: row.id === keep.id,
          })),
        };
      })
      .sort((a, b) => b.count - a.count);

    // 0.58 起失效只看 health_state='broken'：status='error' 是旧投影，
    // 会把「待复测/需登录」也算成失效。blocked 单列，不能当坏源清掉。
    const invalid = rows
      .filter((row) => row.health_state === "broken")
      .map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        status: row.status,
        healthState: row.health_state,
        healthScore: Number(row.health_score ?? 0),
        error: row.last_error,
        checkedAt: row.last_check_at,
        enabled: Boolean(row.enabled),
      }))
      .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1));
    const blocked = rows
      .filter((row) => row.health_state === "blocked")
      .map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        status: row.status,
        healthState: row.health_state,
        healthScore: Number(row.health_score ?? 0),
        error: row.last_error,
        checkedAt: row.last_check_at,
        enabled: Boolean(row.enabled),
      }))
      .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1));

    const groupMap = new Map<string, { name: string; count: number; ok: number; retest: number; blocked: number; broken: number }>();
    for (const row of rows) {
      const name = row.group_name.trim() || "未分组";
      const item = groupMap.get(name) ?? { name, count: 0, ok: 0, retest: 0, blocked: 0, broken: 0 };
      item.count += 1;
      if (row.health_state === "healthy" || row.health_state === "partial") item.ok += 1;
      else if (row.health_state === "blocked") item.blocked += 1;
      else if (row.health_state === "broken") item.broken += 1;
      else item.retest += 1;
      groupMap.set(name, item);
    }

    return {
      stats: {
        total: rows.length,
        ok: rows.filter((row) => row.health_state === "healthy" || row.health_state === "partial").length,
        invalid: invalid.length,
        blocked: blocked.length,
        retest: rows.filter((row) => row.health_state === "unknown" || row.health_state === "degraded").length,
        healthy: rows.filter((row) => row.health_state === "healthy").length,
        degraded: rows.filter((row) => row.health_state === "degraded").length,
        unknown: rows.filter((row) => row.health_state === "unknown").length,
        disabled: rows.filter((row) => !row.enabled).length,
        duplicateGroups: duplicates.length,
        duplicateExtra: duplicates.reduce((sum, group) => sum + group.count - 1, 0),
        groups: groupMap.size,
      },
      duplicates: duplicates.slice(0, 200),
      invalid: invalid.slice(0, 300),
      blocked: blocked.slice(0, 300),
      groups: [...groupMap.values()].sort((a, b) => b.count - a.count),
    };
  });

  app.post<{ Body: { keys?: string[]; all?: boolean } }>("/api/sources/organize/merge", async (req, reply) => {
    const body = req.body ?? {};
    const db = getDb();
    const rows = db.prepare("SELECT id, name, url, host_key, status, json FROM book_sources ORDER BY id ASC").all() as SourceRow[];
    const byKey = new Map<string, SourceRow[]>();
    for (const row of rows) {
      const key = groupKey(row);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row);
      else byKey.set(key, [row]);
    }
    const wanted = body.all ? new Set(byKey.keys()) : new Set((body.keys ?? []).map((key) => key.trim()).filter(Boolean));
    if (!wanted.size) return reply.code(400).send({ error: "nothing_selected" });

    const remove = db.prepare("DELETE FROM book_sources WHERE id = ?");
    let removed = 0;
    let mergedGroups = 0;
    db.transaction(() => {
      for (const key of wanted) {
        const list = byKey.get(key);
        if (!list || list.length < 2) continue;
        const keep = pickKeep(list);
        for (const row of list) {
          if (row.id === keep.id) continue;
          remove.run(row.id);
          removed += 1;
        }
        mergedGroups += 1;
      }
    })();
    return { ok: true, mergedGroups, removed };
  });

  app.post<{ Body: { ids?: number[]; action?: string; group?: string; targetGroup?: string } }>(
    "/api/sources/batch",
    async (req, reply) => {
      const body = req.body ?? {};
      const ids = (body.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
      const action = String(body.action ?? "");
      const group = String(body.group ?? "").trim();
      if (!ids.length && !group) return reply.code(400).send({ error: "no_ids" });
      const db = getDb();
      const clause = ids.length ? `id IN (${ids.map(() => "?").join(",")})` : "group_name = ?";
      const where = ids.length ? ids : [group];
      let affected = 0;
      if (action === "enable" || action === "disable") {
        affected = db
          .prepare(`UPDATE book_sources SET enabled = ?, updated_at = datetime('now') WHERE ${clause}`)
          .run(action === "enable" ? 1 : 0, ...where).changes;
      } else if (action === "delete") {
        affected = db.prepare(`DELETE FROM book_sources WHERE ${clause}`).run(...where).changes;
      } else if (action === "group") {
        affected = db
          .prepare(`UPDATE book_sources SET group_name = ?, updated_at = datetime('now') WHERE ${clause}`)
          .run(String(body.targetGroup ?? "").trim(), ...where).changes;
      } else {
        return reply.code(400).send({ error: "unknown_action" });
      }
      return { ok: true, affected };
    },
  );
}
