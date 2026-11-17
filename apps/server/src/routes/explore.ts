import type { FastifyInstance } from "fastify";
import type { SearchBook } from "@legado/shared";
import { getDb } from "../db/index.js";
import { exploreGroups, exploreSource } from "../services/engine.js";
import { classifyExploreGroup } from "../services/explore-classify.js";
import { withExploreDisplay } from "../services/explore-display.js";

const RANKINGS_CACHE_MS = 30 * 60 * 1000;
const AUDIT_TTL_HOURS = 6;
// 841 个书源里 status='ok' 只有 30 出头，其余全是 seed 的默认值 'retest'。
// 只扫 ok 会让发现/榜单永远只有 25 个源，所以带上 retest（ok 优先）。
const MAX_AUDIT_SOURCES = 60;
const MAX_GROUPS_PER_SOURCE = 3;
let rankingsCache: { at: number; data: unknown } | null = null;

type RankGroup = {
  title: string;
  url: string;
  count: number;
  score: number;
  ms: number;
  sample?: Array<{ name: string; coverUrl: string }>;
};

function saveAudit(
  sourceId: number,
  sourceName: string,
  group: { title: string; url: string; score: number },
  itemCount: number,
  error: string,
  elapsedMs: number,
  sample: Array<{ name: string; coverUrl: string }> = [],
): void {
  getDb()
    .prepare(
      `INSERT INTO explore_audit (source_id, source_name, group_title, group_url, kind, score, item_count, error, elapsed_ms, sample, checked_at)
       VALUES (?, ?, ?, ?, 'ranking', ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(source_id, group_url, group_title) DO UPDATE SET
         source_name = excluded.source_name,
         kind = excluded.kind,
         score = excluded.score,
         item_count = excluded.item_count,
         error = excluded.error,
         elapsed_ms = excluded.elapsed_ms,
         sample = excluded.sample,
         checked_at = excluded.checked_at`,
    )
    .run(sourceId, sourceName, group.title, group.url, group.score, itemCount, error, elapsedMs, JSON.stringify(sample));
}

/** Recently audited ranking groups, grouped by source. Survives restarts. */
function loadAudit(): { total: number; items: Array<{ sourceId: number; sourceName: string; groups: RankGroup[] }> } {
  const rows = getDb()
    .prepare(
      `SELECT source_id, source_name, group_title, group_url, score, item_count, elapsed_ms, sample
       FROM explore_audit
       WHERE kind = 'ranking' AND item_count > 0 AND checked_at >= datetime('now', ?)
       ORDER BY score DESC, item_count DESC`,
    )
    .all(`-${AUDIT_TTL_HOURS} hours`) as Array<{
    source_id: number;
    source_name: string;
    group_title: string;
    group_url: string;
    score: number;
    item_count: number;
    elapsed_ms: number;
    sample: string;
  }>;
  const bySource = new Map<number, { sourceId: number; sourceName: string; groups: RankGroup[] }>();
  for (const row of rows) {
    let entry = bySource.get(row.source_id);
    if (!entry) {
      entry = { sourceId: row.source_id, sourceName: row.source_name, groups: [] };
      bySource.set(row.source_id, entry);
    }
    if (entry.groups.length >= MAX_GROUPS_PER_SOURCE) continue;
    let sample: RankGroup["sample"];
    if (row.sample) {
      try {
        const parsed = JSON.parse(row.sample) as RankGroup["sample"];
        if (Array.isArray(parsed) && parsed.length) sample = parsed;
      } catch {
        /* 旧数据没有 sample 或已经损坏，退回「暂无样本」 */
      }
    }
    entry.groups.push({
      title: row.group_title,
      url: row.group_url,
      count: row.item_count,
      score: row.score,
      ms: row.elapsed_ms,
      sample,
    });
  }
  const items = [...bySource.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName, "zh-Hans-CN"));
  return { total: items.length, items };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function exploreRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Ranking entries that were actually verified to return books.
   *
   * The old version matched group titles against a regex and never opened the
   * group, so "热门推荐" style categories showed up as empty rankings. We now
   * classify titles (see explore-classify.ts), fetch page 1 of the top groups
   * and persist the result in explore_audit. The tab can be served from that
   * audit for six hours, which keeps the first paint fast after a restart.
   */
  app.get<{ Querystring: { refresh?: string } }>("/api/explore/rankings", async (req) => {
    if (req.query.refresh !== "1" && rankingsCache && Date.now() - rankingsCache.at < RANKINGS_CACHE_MS) {
      return rankingsCache.data;
    }
    if (req.query.refresh !== "1") {
      const cached = loadAudit();
      if (cached.items.length) {
        const data = { ...cached, scanned: 0, cached: true, auditedAt: new Date().toISOString() };
        rankingsCache = { at: Date.now(), data };
        return data;
      }
    }
    const rows = getDb()
      .prepare(
        "SELECT id, name FROM book_sources WHERE enabled = 1 AND enabled_explore = 1 AND status IN ('ok', 'retest') ORDER BY (status = 'ok') DESC, custom_order DESC, id ASC LIMIT ?",
      )
      .all(MAX_AUDIT_SOURCES) as Array<{ id: number; name: string }>;
    const items: Array<{ sourceId: number; sourceName: string; groups: RankGroup[] }> = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        try {
          const groups = await withTimeout(exploreGroups(row.id), 8000);
          const candidates = groups
            .map((group) => ({ ...group, ...classifyExploreGroup(group.title, group.url) }))
            .filter((group) => group.kind === "ranking")
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_GROUPS_PER_SOURCE);
          const verified: RankGroup[] = [];
          const seenTitles = new Set<string>();
          for (const group of candidates) {
            const startedAt = Date.now();
            try {
              const books = await withTimeout(exploreSource(row.id, group.url, 1, group.title), 8000);
              const ms = Date.now() - startedAt;
              const sample = books.slice(0, 3).map((book) => ({ name: book.name, coverUrl: book.coverUrl }));
              saveAudit(row.id, row.name, group, books.length, "", ms, sample);
              if (!books.length || seenTitles.has(group.title)) continue;
              seenTitles.add(group.title);
              verified.push({
                title: group.title,
                url: group.url,
                count: books.length,
                score: group.score,
                ms,
                sample,
              });
            } catch (err) {
              saveAudit(row.id, row.name, group, 0, String((err as Error).message), Date.now() - startedAt);
            }
          }
          if (verified.length) items.push({ sourceId: row.id, sourceName: row.name, groups: verified });
        } catch {
          /* one slow or broken source must not block the aggregate */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, rows.length || 1) }, () => worker()));
    items.sort((a, b) => a.sourceName.localeCompare(b.sourceName, "zh-Hans-CN"));
    const data = { total: items.length, scanned: rows.length, cached: false, auditedAt: new Date().toISOString(), items };
    rankingsCache = { at: Date.now(), data };
    return data;
  });
  app.get("/api/explore/sources", async () => {
    const rows = getDb()
      .prepare("SELECT id, name, group_name, status, json FROM book_sources WHERE enabled = 1 AND enabled_explore = 1")
      .all() as Array<{ id: number; name: string; group_name: string; status: string; json: string }>;
    // Sources without exploreUrl used to show up here (142 of 707) and every one of
    // them failed before making a request. Filter them out instead of asking the UI
    // to auto-skip them one by one.
    const items = rows
      .map((row) => {
        let source: Record<string, unknown> = {};
        try {
          source = JSON.parse(row.json) as Record<string, unknown>;
        } catch {
          return null;
        }
        const exploreUrl = String(source.exploreUrl ?? "").trim();
        if (!exploreUrl) return null;
        const ruleExplore = (source.ruleExplore ?? {}) as Record<string, unknown>;
        const hasExploreRule = Boolean(String(ruleExplore.bookList ?? "").trim());
        const sourceUrl = String(source.bookSourceUrl ?? "");
        const builtinKind = sourceUrl.startsWith("shushan://")
          ? "shushan"
          : sourceUrl.startsWith("dhl://")
            ? "dahuilang"
            : undefined;
        return {
          id: row.id,
          name: row.name,
          group: row.group_name,
          status: row.status,
          hasExploreRule,
          // 内置聚合源排在发现页最前：它一个源就覆盖 32 个站，用户不该先翻 700 个空源。
          builtin: Boolean(builtinKind),
          builtinKind,
          exploreKind: exploreUrl.startsWith("@js:") || exploreUrl.startsWith("<js>") ? "js" : exploreUrl.startsWith("[") ? "json" : "text",
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort(
        (a, b) =>
          Number(b.builtin) - Number(a.builtin) ||
          Number(b.status === "ok") - Number(a.status === "ok") ||
          Number(b.hasExploreRule) - Number(a.hasExploreRule) ||
          a.id - b.id,
      );
    return { total: items.length, items };
  });

  app.get<{ Params: { sourceId: string } }>("/api/explore/:sourceId/groups", async (req, reply) => {
    const sourceId = Number(req.params.sourceId);
    try {
      const groups = await exploreGroups(sourceId);
      return { groups, total: groups.length };
    } catch (err) {
      // An unreachable or rule-less source is not a server error: the client falls
      // through to the next source. Keeping HTTP 200 also avoids console noise.
      return { groups: [], total: 0, error: String((err as Error).message) };
    }
  });

  app.get<{ Params: { sourceId: string }; Querystring: { url?: string; page?: string; title?: string } }>(
    "/api/explore/:sourceId/items",
    async (req, reply) => {
    const sourceId = Number(req.params.sourceId);
    const url = (req.query.url ?? "").trim();
    if (!url) return reply.code(400).send({ error: "missing_url" });
    const page = Number(req.query.page ?? 1) || 1;
    try {
      const items = await exploreSource(sourceId, url, page, (req.query.title ?? "").trim());
      // 发现页卡片单独做展示清洗；搜索/换源继续用原始 SearchBook，互不影响。
      return {
        total: items.length,
        // engine 的 SearchBook 允许 sourceId 为空，展示层补上当前书源 id 后再清洗。
        items: items.map((book) => withExploreDisplay({ ...book, sourceId: book.sourceId ?? sourceId } as SearchBook)),
      };
    } catch (err) {
      return { total: 0, items: [], error: String((err as Error).message) };
    }
  },
  );
}
