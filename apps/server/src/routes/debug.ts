import type { FastifyInstance } from "fastify";
import { BookSourceEngine, type BookInfo, type BookSource, type Chapter } from "@legado/engine";
import { getDb } from "../db/index.js";
import { isDahuilangSource } from "../services/dahuilang.js";
import { isShushanSource } from "../services/shushan.js";
import { loadSourceById } from "../services/engine.js";
import { projectLegacyStatus, recordCheck } from "../services/health.js";
import { probeSourceById } from "../services/source-probe.js";
import { traceSource } from "../services/source-trace.js";
import { openSse } from "../services/sse.js";

interface DebugEvent {
  stage: string;
  [key: string]: unknown;
}

export async function debugRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { key?: string; page?: string } }>("/api/sources/:id/debug", async (req, reply) => {
    const id = Number(req.params.id);
    const loaded = loadSourceById(id);
    if (!loaded) return reply.code(404).send({ error: "not_found" });
    const key = (req.query.key ?? "诡秘之主").trim();
    const page = Number(req.query.page ?? 1) || 1;
    if (isDahuilangSource({ bookSourceUrl: String(loaded.row.url ?? "") }) || isShushanSource({ bookSourceUrl: String(loaded.row.url ?? "") })) {
      return {
        source: { id, name: loaded.row.name, url: loaded.row.url, group: loaded.row.group_name, status: loaded.row.status },
        rules: {},
        keyword: key,
        page,
        ms: 0,
        error: "内置聚合源由服务端 provider 处理，请在「健康体检」中测试。",
        total: 0,
        books: [],
        events: [],
      };
    }
    const events: DebugEvent[] = [];
    const engine = new BookSourceEngine({
      timeoutMs: 25000,
      maxTocPages: 5,
      maxContentPages: 3,
      onDebug: (event) => {
        events.push(event as DebugEvent);
      },
    });
    const started = Date.now();
    let books: unknown[] = [];
    let error: string | null = null;
    try {
      books = await engine.search(loaded.source as BookSource, key, page);
    } catch (err) {
      error = String((err as Error).message);
    }
    const ms = Date.now() - started;
    const db = getDb();
    recordCheck(db, id, { error: error ?? "", count: books.length, ms });
    return {
      source: { id, name: loaded.row.name, url: loaded.row.url, group: loaded.row.group_name, status: loaded.row.status },
      rules: {
        searchUrl: loaded.source.searchUrl ?? "",
        ruleSearch: loaded.source.ruleSearch ?? {},
        ruleBookInfo: loaded.source.ruleBookInfo ?? {},
        ruleToc: loaded.source.ruleToc ?? {},
        ruleContent: loaded.source.ruleContent ?? {},
        ruleExplore: loaded.source.ruleExplore ?? {},
      },
      keyword: key,
      page,
      ms,
      error,
      total: books.length,
      books,
      events: events.slice(-80),
    };
  });

  interface TraceBody {
    stage?: "pipeline" | "search" | "detail" | "toc" | "content";
    key?: string;
    page?: number;
    bookUrl?: string;
    chapterUrl?: string;
    maxItems?: number;
    maxPages?: number;
  }

  /** 解析追踪：逐字段展示规则命中值，失败时给可操作的错误分类。只读，不写健康档案。 */
  app.post<{ Params: { id: string }; Body: TraceBody }>("/api/sources/:id/trace", async (req, reply) => {
    const id = Number(req.params.id);
    const loaded = loadSourceById(id);
    if (!loaded) return reply.code(404).send({ error: "not_found" });
    if (isDahuilangSource({ bookSourceUrl: String(loaded.row.url ?? "") }) || isShushanSource({ bookSourceUrl: String(loaded.row.url ?? "") })) {
      return reply.code(400).send({ error: "builtin_source", message: "内置聚合源由服务端 provider 处理，没有可追踪的规则。" });
    }
    const body = req.body ?? {};
    return traceSource(
      loaded.source as BookSource,
      {
        id,
        name: String(loaded.row.name ?? ""),
        url: String(loaded.row.url ?? ""),
        group: String(loaded.row.group_name ?? ""),
        status: String(loaded.row.status ?? ""),
      },
      {
        stage: body.stage ?? "pipeline",
        key: body.key,
        page: body.page,
        bookUrl: body.bookUrl,
        chapterUrl: body.chapterUrl,
        maxItems: body.maxItems,
        maxPages: body.maxPages,
      },
    );
  });

  interface PreviewBody {
    key?: string;
    bookUrl?: string;
    chapterUrl?: string;
    maxPages?: number;
  }

  /**
   * 正文分页预览：按真实阅读链路 search → bookInfo → toc → content 跑一遍，
   * 把 nextContentUrl 的每一页单独列出来。只读调试，不写书架，也不改健康档案。
   */
  app.post<{ Params: { id: string }; Body: PreviewBody }>("/api/sources/:id/content-preview", async (req, reply) => {
    const id = Number(req.params.id);
    const loaded = loadSourceById(id);
    if (!loaded) return reply.code(404).send({ error: "not_found" });
    const source = loaded.source as BookSource;
    const body = req.body ?? {};
    const key = (body.key ?? "诡秘之主").trim() || "诡秘之主";
    const maxPages = Math.max(1, Math.min(20, Number(body.maxPages ?? 10) || 10));
    if (isDahuilangSource({ bookSourceUrl: String(loaded.row.url ?? "") }) || isShushanSource({ bookSourceUrl: String(loaded.row.url ?? "") })) {
      return reply.code(400).send({ ok: false, stage: "source", error: "内置聚合源由服务端 provider 处理，没有可预览的规则正文。" });
    }

    const engine = new BookSourceEngine({ timeoutMs: 30_000, maxTocPages: 5, maxContentPages: maxPages });
    const started = Date.now();
    const fail = (stage: string, error: string, extra: Record<string, unknown> = {}) => ({
      ok: false,
      stage,
      error: String(error).slice(0, 400),
      ms: Date.now() - started,
      ...extra,
    });

    let book: BookInfo | null = null;
    let chapters: Chapter[] = [];
    let candidates: Chapter[] = [];
    let stage = "search";
    try {
      if (body.chapterUrl?.trim()) {
        stage = "content";
        candidates = [{ title: "手动指定章节", url: body.chapterUrl.trim(), isVip: false, isVolume: false }];
      } else {
        let bookUrl = (body.bookUrl ?? "").trim();
        if (!bookUrl) {
          const books = await engine.search(source, key, 1);
          if (!books.length) return fail("search", "搜索没有返回结果");
          bookUrl = books[0].bookUrl;
        }
        stage = "detail";
        book = await engine.bookInfo(source, bookUrl);
        stage = "toc";
        chapters = await engine.toc(source, book);
        const usable = chapters.filter((c) => !c.isVolume);
        candidates = [...usable.filter((c) => !c.isVip), ...usable.filter((c) => c.isVip)].slice(0, 3);
        if (!candidates.length) return fail("toc", "目录里没有可预览的章节");
        stage = "content";
      }

      let lastError = "";
      for (const chapter of candidates) {
        try {
          const result = await engine.contentWithImages(source, chapter);
          const text = result.text;
          return {
            ok: true,
            ms: Date.now() - started,
            book: book ? { name: book.name, author: book.author, bookUrl: book.bookUrl, tocUrl: book.tocUrl } : null,
            chapter: { title: chapter.title, url: chapter.url, isVip: chapter.isVip },
            chapterCount: chapters.length,
            pages: result.pages,
            pageCount: result.pages.length,
            chars: text.length,
            images: result.images.slice(0, 8).map((img) => img.src),
            imageCount: result.images.length,
            text: text.slice(0, 20_000),
            truncated: text.length > 20_000,
          };
        } catch (err) {
          lastError = String((err as Error)?.message ?? err);
        }
      }
      return fail("content", lastError || "正文为空");
    } catch (err) {
      return fail(stage, String((err as Error)?.message ?? err), {
        book: book ? { name: book.name, author: book.author, bookUrl: book.bookUrl } : null,
      });
    }
  });

  interface CheckStreamBody {
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
  }

  app.post<{ Body: CheckStreamBody }>("/api/sources/check/stream", async (req, reply) => {
    const body = req.body ?? {};
    const db = getDb();
    let ids = (body.ids ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (body.all) {
      const where: string[] = [];
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
      if (body.stage && body.stageStatus) {
        where.push(`json_extract(health_json, '$.stages.${body.stage}.status') = ?`);
        params.push(body.stageStatus);
      }
      if (body.q) {
        where.push("(name LIKE ? OR url LIKE ?)");
        params.push(`%${body.q}%`, `%${body.q}%`);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      ids = (db.prepare(`SELECT id FROM book_sources ${clause} ORDER BY id`).all(...params) as Array<{ id: number }>).map((r) => r.id);
    }
    if (!ids.length) return reply.code(400).send({ error: "no_sources" });

    const key = (body.key ?? "诡秘之主").trim() || "诡秘之主";
    const mode = body.mode === "full" ? "full" : "quick";
    const fallbackConcurrency = mode === "full" ? 6 : 12;
    const concurrency = Math.max(1, Math.min(16, Number(body.concurrency ?? fallbackConcurrency)));
    const sse = openSse(req, reply);

    const total = ids.length;
    const startedAt = Date.now();
    let cursor = 0;
    let done = 0;
    let ok = 0;
    let failed = 0;
    const health: Record<string, number> = {};
    sse.send("start", { total, key, mode, concurrency });

    async function worker(): Promise<void> {
      while (cursor < ids.length && !sse.isClosed()) {
        const id = ids[cursor++];
        const loaded = loadSourceById(id);
        if (!loaded) {
          done += 1;
          failed += 1;
          sse.send("source", { id, name: "", ok: false, count: 0, error: "source_not_found", ms: 0, status: "retest" });
          sse.send("progress", { done, total, ok, failed });
          continue;
        }
        const started = Date.now();
        try {
          const report = await probeSourceById(id, { mode, key });
          const state = report.health.state;
          const count = report.stages.search?.count ?? 0;
          const error = report.error ?? null;
          health[state] = (health[state] ?? 0) + 1;
          done += 1;
          if (state === "healthy" || state === "partial") ok += 1;
          if (state === "broken") failed += 1;
          if (!sse.isClosed()) {
            sse.send("source", {
              id,
              name: String(loaded.row.name),
              ok: state === "healthy" || state === "partial",
              count,
              error,
              ms: Date.now() - started,
              status: projectLegacyStatus(state),
              healthState: state,
              healthScore: report.health.score,
              stages: report.stages,
            });
            sse.send("progress", { done, total, ok, failed, health: { ...health } });
          }
        } catch (err) {
          const message = String((err as Error)?.message ?? err).slice(0, 300);
          done += 1;
          failed += 1;
          if (!sse.isClosed()) {
            sse.send("source", { id, name: String(loaded.row.name), ok: false, count: 0, error: message, ms: Date.now() - started, status: "error", healthState: "broken", healthScore: 0, stages: {} });
            sse.send("progress", { done, total, ok, failed, health: { ...health } });
          }
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
      sse.send("done", { total, done, ok, failed, health, elapsedMs: Date.now() - startedAt });
    } finally {
      sse.end();
    }
  });

  app.post<{ Body: { ids?: number[]; key?: string; concurrency?: number } }>("/api/sources/check", async (req) => {
    const body = req.body ?? {};
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n)).slice(0, 200);
    const key = (body.key ?? "诡秘之主").trim();
    const concurrency = Math.max(1, Math.min(8, Number(body.concurrency ?? 4)));
    const db = getDb();
    const results: Array<{ id: number; name: string; ok: boolean; count: number; error: string | null; ms: number }> = [];
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const loaded = loadSourceById(id);
        if (!loaded) continue;
        const engine = new BookSourceEngine({ timeoutMs: 20000 });
        const started = Date.now();
        try {
          const books = await engine.search(loaded.source as BookSource, key, 1);
          const ms = Date.now() - started;
          results.push({ id, name: String(loaded.row.name), ok: books.length > 0, count: books.length, error: null, ms });
          recordCheck(db, id, { count: books.length, ms });
        } catch (err) {
          const ms = Date.now() - started;
          const message = String((err as Error).message).slice(0, 300);
          results.push({ id, name: String(loaded.row.name), ok: false, count: 0, error: message, ms });
          recordCheck(db, id, { error: message, ms });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, () => worker()));
    return { total: results.length, ok: results.filter((r) => r.ok).length, items: results };
  });
}