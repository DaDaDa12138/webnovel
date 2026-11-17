import type { FastifyInstance } from "fastify";
import { searchableSources, searchSources, type SearchSourceResult } from "../services/engine.js";
import { normalizeSearchHealthScope } from "../services/search-scope.js";
import { getSetting } from "../services/settings.js";
import { getDb } from "../db/index.js";
import { openSse } from "../services/sse.js";

/** Record a search for the hot/recent lists; identical back-to-back queries are ignored. */
function recordSearch(key: string, author = ""): void {
  // Author-only searches have no title keyword; both fields are optional as long
  // as at least one is long enough to be meaningful.
  if (key.length < 2 && author.length < 2) return;
  const db = getDb();
  const recent = db
    .prepare(
      "SELECT id FROM search_history WHERE keyword = ? AND author = ? AND created_at > datetime('now','-10 seconds') LIMIT 1",
    )
    .get(key, author);
  if (recent) return;
  db.prepare("INSERT INTO search_history (keyword, author) VALUES (?, ?)").run(key.slice(0, 60), author.slice(0, 60));
}

interface SearchQuery {
  key?: string;
  author?: string;
  sources?: string;
  limit?: string;
  concurrency?: string;
  budget?: string;
  /** all | usable | healthy；显式 sources 时忽略。 */
  health?: string;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: SearchQuery }>("/api/search", async (req, reply) => {
    const key = (req.query.key ?? "").trim();
    const author = (req.query.author ?? "").trim();
    if (!key && !author) return reply.code(400).send({ error: "missing_key_or_author" });
    const searchKey = key || author;
    const sourceIds = (req.query.sources ?? "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0);
    const limit = Number(req.query.limit ?? 0) || 0;
    const concurrency = Number(req.query.concurrency ?? getSetting("searchConcurrency", "16")) || 16;
    const healthIgnored = sourceIds.length > 0;
    const healthScope = healthIgnored ? "all" : normalizeSearchHealthScope(req.query.health);
    recordSearch(key, author);
    const results = await searchSources(searchKey, { sourceIds, concurrency, author, authorOnly: !key, healthScope });
    const books = results.flatMap((r) =>
      r.books.map((b) => ({ ...b, sourceId: r.sourceId, healthState: r.healthState, healthScore: r.healthScore })),
    );
    const trimmed = limit > 0 ? books.slice(0, limit) : books;
    return {
      key,
      author,
      authorOnly: !key,
      health: healthScope,
      healthIgnored,
      total: trimmed.length,
      sources: results.length,
      okSources: results.filter((r) => r.books.length).length,
      failedSources: results.filter((r) => r.error).length,
      items: trimmed,
      detail: results.map((r) => ({ sourceId: r.sourceId, sourceName: r.sourceName, count: r.books.length, error: r.error ?? null, ms: r.ms })),
    };
  });

  app.get("/api/search/suggest", async () => {
    const db = getDb();
    const hot = db
      .prepare(
        `SELECT keyword, author, COUNT(*) AS count FROM search_history
         WHERE created_at >= datetime('now','-30 days') GROUP BY keyword, author
         ORDER BY count DESC, MAX(created_at) DESC LIMIT 12`,
      )
      .all() as Array<{ keyword: string; author: string; count: number }>;
    const recent = db
      .prepare(
        "SELECT keyword, author FROM search_history GROUP BY keyword, author ORDER BY MAX(created_at) DESC LIMIT 8",
      )
      .all() as Array<{ keyword: string; author: string }>;
    return { hot, recent };
  });

  app.delete("/api/search/history", async (_req, reply) => {
    getDb().prepare("DELETE FROM search_history").run();
    return reply.send({ ok: true });
  });

  app.get<{ Querystring: SearchQuery }>("/api/search/stream", async (req, reply) => {
    const key = (req.query.key ?? "").trim();
    const author = (req.query.author ?? "").trim();
    if (!key && !author) return reply.code(400).send({ error: "missing_key_or_author" });
    const searchKey = key || author;
    const sourceIds = (req.query.sources ?? "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0);
    const healthIgnored = sourceIds.length > 0;
    const healthScope = healthIgnored ? "all" : normalizeSearchHealthScope(req.query.health);
    recordSearch(key, author);
    const sse = openSse(req, reply);
    sse.send("start", {
      key,
      author,
      authorOnly: !key,
      health: healthScope,
      healthIgnored,
      total: sourceIds.length || searchableSources(healthScope).length,
    });
    // Searching 800+ sites takes minutes; verified sources finish first and the
    // long tail gets a budget so the page can settle instead of spinning forever.
    const budget = Math.max(5000, Number(req.query.budget ?? 0) || 12_000);
    const deadline = sourceIds.length ? undefined : Date.now() + budget;
    // 结果边搜边推，done 却要等 searchSources 里所有 worker 退出：预算到点后还在跑的
    // 十几个慢站（每个最多 20s 超时）会把「搜索完成」拖到半分钟，前端进度条就卡在 15%。
    // 这里自己攒结果，预算到点后再给 2.5s 让最后几条落地，然后先收尾。
    const collected: SearchSourceResult["books"] = [];
    let lastEventAt = Date.now();
    const search = searchSources(searchKey, {
      sourceIds,
      author,
      authorOnly: !key,
      concurrency: Number(req.query.concurrency ?? getSetting("searchConcurrency", "16")) || 16,
      healthScope,
      deadline,
      onProgress: (r: SearchSourceResult) => {
        lastEventAt = Date.now();
        collected.push(...r.books);
        if (!sse.isClosed()) {
          sse.send("source", {
            sourceId: r.sourceId,
            sourceName: r.sourceName,
            count: r.books.length,
            error: r.error ?? null,
            ms: r.ms,
            healthState: r.healthState,
            healthScore: r.healthScore,
            items: r.books,
          });
        }
      },
    });
    // 后台继续跑完的那些源不该以 unhandled rejection 的形式炸掉进程。
    search.catch(() => undefined);
    let finished = false;
    const settle = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (finished) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (!deadline) return;
        const now = Date.now();
        // 慢站每 20s 冒一条超时事件，会把 lastEventAt 一直刷新；加一个硬上限，
        // 预算到点 6s 后无论有没有新事件都收尾。
        if (now > deadline + 6_000 || (now > deadline + 2_500 && now - lastEventAt >= 1_500)) {
          clearInterval(timer);
          resolve();
        }
      }, 400);
      timer.unref?.();
    });
    try {
      await Promise.race([search, settle]);
      finished = true;
      sse.send("done", { total: collected.length, items: collected });
    } catch (err) {
      sse.send("error", { message: String((err as Error).message) });
    } finally {
      sse.end();
    }
  });
}
