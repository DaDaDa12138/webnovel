import type { FastifyInstance } from "fastify";
import type { BookInfo } from "@legado/engine";
import type { SwitchCandidate, SwitchHistoryItem } from "@legado/shared";
import { getDb } from "../db/index.js";
import { fetchBookInfo, fetchToc, loadSourceById } from "../services/engine.js";
import { refreshBookMeta } from "../services/updater.js";
import { measureCandidates, streamSwitchCandidates, switchSourcePoolSize } from "../services/switch.js";
import {
  chapterKey,
  loadSwitchCandidates,
  markSourcesSearched,
  recentlyCheckedSourceIds,
  saveSwitchCandidates,
  saveSwitchMeasures,
} from "../services/switch-cache.js";
import { openSse } from "../services/sse.js";
import { addBookToShelf, type CreateBookInput } from "../services/books/add.js";
import { listShelf, type ShelfQuery } from "../services/books/shelf.js";
import { bookPayload, countChapters, deleteBookRows, getBook } from "../services/books/store.js";
import { listChapters } from "../services/books/chapters.js";
import { readChapter } from "../services/books/content.js";
import { searchBook } from "../services/books/search.js";
import { saveProgress, type ProgressInput } from "../services/books/progress.js";
import { normalizeBookMeta } from "../services/books/meta.js";
import { clearProgressHistory, listProgressHistory } from "../services/books/progress-history.js";
import { countReadChapters, listReadChapters, markChapterRead, readStats } from "../services/books/reads.js";
import { addBookmark, listBookmarks, removeBookmark, type BookmarkInput } from "../services/books/bookmarks.js";
import {
  listAnnotations,
  patchAnnotation,
  removeAnnotation,
  upsertAnnotation,
  type AnnotationInput,
} from "../services/books/annotations.js";
import { refreshBookFromSource } from "../services/books/refresh.js";
import { countCachedChapters, exportBook } from "../services/books/export.js";
import {
  dropSwitchHistory,
  latestSwitchHistory,
  listSwitchHistory,
  switchBookToSource,
  type SwitchInput,
} from "../services/books/switch-book.js";
import { readSwitchAnchor } from "../services/books/switch-anchors.js";
import {
  applyManualReanchor,
  applyReanchorSnapshot,
  locateReanchorItem,
  parseReanchorSnapshot,
  reanchorAfterSwitch,
  ReanchorLocateError,
} from "../services/books/reanchor.js";

/**
 * 书籍相关路由：只负责 HTTP（参数解析、状态码），业务都在 services/books/*。
 * 这个文件曾经 910 行、把 SQL、抓取、匹配、换源、进度接续全塞在一起。
 */
export async function booksRoutes(app: FastifyInstance): Promise<void> {
  /** Add (or re-add) a book to the shelf. Never fails because a source rule is broken. */
  app.post<{ Body: CreateBookInput }>("/api/books", async (req, reply) => {
    const result = await addBookToShelf(req.body ?? {});
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.send(result.payload);
  });

  app.get("/api/books", async (req) => {
    return { items: listShelf((req.query ?? {}) as ShelfQuery) };
  });

  app.get<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    const db = getDb();
    const book = getBook(Number(req.params.id));
    if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const raw = db.prepare("SELECT * FROM reading_progress WHERE book_id = ?").get(book.id) as Record<string, unknown> | undefined;
    const progress = raw
      ? {
          chapterIndex: Number(raw.chapter_index ?? 0),
          offset: Number(raw.offset ?? 0),
          charOffset: Number(raw.char_offset ?? 0),
          chapterPercent: Number(raw.chapter_percent ?? raw.percent ?? 0),
          percent: Number(raw.percent ?? 0),
          updatedAt: raw.updated_at ?? null,
        }
      : null;
    const sourceRow = db
      .prepare("SELECT name, url, status, health_state, health_score FROM book_sources WHERE id = ?")
      .get(book.source_id) as
      | { name: string; url: string; status: string; health_state: string | null; health_score: number | null }
      | undefined;
    const source = sourceRow
      ? {
          name: sourceRow.name,
          url: sourceRow.url,
          status: sourceRow.status,
          healthState: sourceRow.health_state ?? "unknown",
          healthScore: Number(sourceRow.health_score ?? 0),
        }
      : null;
    // 换源历史里的 source_id 是「换之前」的源；按钮文案要显示它，不能在没历史时给一个点了只报错的入口。
    const history = latestSwitchHistory(book.id);
    const oldSource = history?.source_id
      ? (db.prepare("SELECT name FROM book_sources WHERE id = ?").get(history.source_id) as { name: string } | undefined)
      : undefined;
    const lastSwitch = history
      ? {
          id: history.id,
          kind: history.kind,
          sourceId: history.source_id,
          sourceName: oldSource?.name || "原来源",
          chapters: history.chapters,
          chapterIndex: history.chapter_index,
          chapterTitle: history.chapter_title,
          createdAt: history.created_at,
        }
      : null;
    return { book: bookPayload(book, countChapters(book.id)), progress, source, lastSwitch, switchAnchor: readSwitchAnchor(db, book.id) };
  });

  app.patch<{
    Params: { id: string };
    Body: { inShelf?: boolean; note?: string; groupId?: number; name?: unknown; author?: unknown; intro?: unknown; coverUrl?: unknown };
  }>("/api/books/:id", async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const body = req.body ?? {};
    const meta = normalizeBookMeta(body as Record<string, unknown>);
    if (meta.error) return reply.code(400).send({ error: "bad_book_meta", message: meta.error });
    if (typeof body.inShelf === "boolean") {
      db.prepare("UPDATE books SET in_shelf = ?, updated_at = datetime('now') WHERE id = ?").run(body.inShelf ? 1 : 0, id);
    }
    if (typeof body.note === "string") {
      db.prepare("UPDATE books SET note = ?, updated_at = datetime('now') WHERE id = ?").run(body.note.slice(0, 500), id);
    }
    if (typeof body.groupId === "number") {
      db.prepare("UPDATE books SET group_id = ?, updated_at = datetime('now') WHERE id = ?").run(Math.max(0, Math.floor(body.groupId)), id);
    }
    if (meta.patch.name !== undefined) {
      db.prepare("UPDATE books SET name = ?, updated_at = datetime('now') WHERE id = ?").run(meta.patch.name, id);
    }
    if (meta.patch.author !== undefined) {
      db.prepare("UPDATE books SET author = ?, updated_at = datetime('now') WHERE id = ?").run(meta.patch.author, id);
    }
    if (meta.patch.intro !== undefined) {
      db.prepare("UPDATE books SET intro = ?, updated_at = datetime('now') WHERE id = ?").run(meta.patch.intro, id);
    }
    if (meta.patch.coverUrl !== undefined) {
      db.prepare("UPDATE books SET cover_url = ?, updated_at = datetime('now') WHERE id = ?").run(meta.patch.coverUrl, id);
    }
    return reply.send({ ok: true });
  });

  /** Re-fetch detail + table of contents (fixes books added while a source rule was broken). */
  app.post<{ Params: { id: string } }>("/api/books/:id/refresh", async (req, reply) => {
    const result = await refreshBookFromSource(Number(req.params.id));
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.send(result.payload);
  });

  /** Probe one switch candidate without touching the shelf: how fast it answers,
   *  how many chapters it has and what word count it claims. */
  app.post<{ Params: { id: string }; Body: { sourceId?: number; bookUrl?: string } }>(
    "/api/books/:id/switch/probe",
    async (req, reply) => {
      const book = getBook(Number(req.params.id));
      if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
      const sourceId = Number(req.body?.sourceId ?? 0);
      const bookUrl = String(req.body?.bookUrl ?? "").trim();
      if (!sourceId || !bookUrl) return reply.code(400).send({ error: "missing_source_or_url", message: "缺少书源或书籍地址" });
      if (!loadSourceById(sourceId)) return reply.code(404).send({ error: "source_not_found", message: "书源不存在" });
      const startedAt = Date.now();
      let info: BookInfo | null = null;
      try {
        info = await fetchBookInfo(sourceId, bookUrl);
      } catch (err) {
        return reply.send({ ok: false, ms: Date.now() - startedAt, error: String((err as Error).message ?? err).slice(0, 200) });
      }
      if (!info) return reply.send({ ok: false, ms: Date.now() - startedAt, error: "详情页没有返回内容" });
      let chapters = 0;
      let tocError: string | null = null;
      try {
        chapters = (await fetchToc(sourceId, info)).length;
      } catch (err) {
        tocError = String((err as Error).message ?? err).slice(0, 200);
      }
      return reply.send({
        ok: true,
        ms: Date.now() - startedAt,
        chapters,
        wordCount: info.wordCount || "",
        lastChapter: info.lastChapter || "",
        name: info.name || "",
        author: info.author || "",
        tocError,
      });
    },
  );

  /** 换源候选流水线（SSE）：服务端并发搜索 + 探测，边搜边把可用候选推给前端。
   *  一次请求就能看到「哪些源真的能打开、目录有多少章」，而不是前端一条条试点。 */
  app.get<{
    Params: { id: string };
    Querystring: {
      key?: string;
      limit?: string;
      budget?: string;
      concurrency?: string;
      chapter?: string;
      title?: string;
      deep?: string;
      /** 1 表示忽略缓存、全量重扫（面板上的「重新搜索」）。 */
      refresh?: string;
      /** 搜索阶段的并发，和探测并发分开调。 */
      searchConcurrency?: string;
    };
  }>(
    "/api/books/:id/switch/candidates",
    async (req, reply) => {
      const book = getBook(Number(req.params.id));
      if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
      const name = String(book.name ?? "");
      const author = String(book.author ?? "");
      const sourceId = Number(book.source_id ?? 0);
      const bookUrl = String(book.book_url ?? "");
      // 阅读中换源：带 chapter 就为每个可用候选实测这一章的正文，按字数排序。
      const chapterIndex = Number(req.query.chapter);
      const chapterWanted = Number.isFinite(chapterIndex) && chapterIndex >= 0;
      // 章节标题优先用客户端传来的「读者正在看的那一章」：库里按 idx 取到的是当前源的标题，
      // 而当前源正是那个目录错乱的站时，它会把人带到别的章上。
      let chapterTitle = String(req.query.title ?? "").trim();
      if (chapterWanted && !chapterTitle) {
        const row = getDb()
          .prepare("SELECT title FROM chapters WHERE book_id = ? AND idx = ?")
          .get(book.id, chapterIndex) as { title?: string } | undefined;
        chapterTitle = String(row?.title ?? "");
      }

      // 深度搜索：逐个源取目录，专门用来找「章数更全」的源；默认模式只搜前几十个源。
      const deep = req.query.deep === "1" || req.query.deep === "true";
      // 当前源的目录章数：深度模式探到两个更全的源就收手，不必搜完 788 个站。
      const minChapters = Number(
        (getDb().prepare("SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?").get(book.id) as { n?: number } | undefined)?.n ?? 0,
      );
      // 缓存分两层：目录（哪些源有这本书、多少章）按书复用；「这一章多少字 / 章名对不对得上」
      // 按「书 + 章节」复用。换到同一本书的别的章节时，目录不用重扫，但必须重测这一章。
      // refresh=1 表示「重新搜索」：忽略缓存，全量重扫。
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      const measureKey = chapterWanted ? chapterKey(chapterIndex, chapterTitle) : "";
      const cached = refresh ? [] : loadSwitchCandidates(book.id, measureKey);
      const skip = refresh ? new Set<number>() : recentlyCheckedSourceIds(book.id, measureKey);
      const toMeasure = chapterWanted ? cached.filter((item) => typeof item.chars !== "number" && !item.measureError) : [];
      // 缓存表里可能留着已经不参与搜索的源（被禁用/出错的），按池子大小夹一下再报给前端。
      const skippedCount = Math.min(skip.size, switchSourcePoolSize());
      // 内置源（书山聚合、大灰狼聚合）单独报状态：它们搜不到这本书时，面板要能说清
      // 「搜过了，没收录」，而不是让人以为根本没参与搜索。0.57 起两者都报。
      const builtinRows = getDb()
        .prepare(
          "SELECT id, name, url FROM book_sources WHERE url IN ('shushan://builtin', 'dhl://builtin') " +
            "ORDER BY CASE url WHEN 'shushan://builtin' THEN 0 ELSE 1 END",
        )
        .all() as Array<{ id: number; name: string; url: string }>;
      const builtin = builtinRows[0];
      const builtinId = Number(builtin?.id ?? 0);
      const builtinIds = new Set(builtinRows.map((row) => Number(row.id)));
      const builtinSearchedIds = new Set<number>();
      const sse = openSse(req, reply);
      const startedAt = Date.now();
      sse.send("start", {
        book: { id: book.id, name, author },
        sourceId,
        chapter: chapterWanted ? { index: chapterIndex, title: chapterTitle } : null,
        cached,
        skipped: skippedCount,
        pool: switchSourcePoolSize(),
        refresh,
        measuring: toMeasure.length,
        builtin: builtinId ? { id: builtinId, name: String(builtin?.name ?? "书山聚合") } : null,
        builtins: builtinRows.map((row) => ({
          id: Number(row.id),
          name: String(row.name || (row.url === "dhl://builtin" ? "大灰狼聚合" : "书山聚合")),
          searched: skip.has(Number(row.id)),
          found: false,
        })),
      });
      const searchedIds: number[] = [];
      const pendingCandidates: SwitchCandidate[] = [];
      let lastFlush = Date.now();
      // 面板可能被随手关掉（SSE 一断，服务端就提前收手）：候选和「查过、没有」必须边搜边落库，
      // 否则关掉面板等于白搜一轮。done 时再冲一次，把带字数的最终版本写进去。
      const flushCache = (): void => {
        if (pendingCandidates.length) saveSwitchCandidates(book.id, pendingCandidates.splice(0));
        if (searchedIds.length) markSourcesSearched(book.id, searchedIds.splice(0));
        lastFlush = Date.now();
      };
      // 缓存候选缺这一章的实测：和下面的搜索并行补测，谁先回先推给前端。
      const cachedMeasures = toMeasure.length
        ? measureCandidates(toMeasure, { index: chapterIndex, title: chapterTitle }, {
            concurrency: 4,
            onMeasure: (measure) => {
              if (!sse.isClosed()) sse.send("measure", measure);
            },
            shouldAbort: () => sse.isClosed(),
          })
        : Promise.resolve([]);
      try {
        const key = String(req.query.key ?? "").trim() || name;
        const candidates = await streamSwitchCandidates(
          { id: book.id, name: key, author, sourceId, bookUrl },
          {
            deep,
            shouldAbort: () => sse.isClosed(),
            concurrency: Number(req.query.concurrency) || (deep ? 4 : 6),
            searchConcurrency: Number(req.query.searchConcurrency) || undefined,
            budgetMs: Number(req.query.budget) || (deep ? 120_000 : 12_000),
            limit: Number(req.query.limit) || (deep ? 200 : 40),
            minChapters,
            chapter: chapterWanted ? { index: chapterIndex, title: chapterTitle } : undefined,
            onSearch: (progress) => {
              if (!sse.isClosed()) sse.send("search", progress);
            },
            onCandidate: (candidate) => {
              pendingCandidates.push(candidate);
              if (Date.now() - lastFlush > 1500) flushCache();
              if (!sse.isClosed()) sse.send("candidate", candidate);
            },
            onMeasure: (measure) => {
              if (!sse.isClosed()) sse.send("measure", measure);
            },
            skipSourceIds: skip,
            onSearched: (sourceId) => {
              if (builtinIds.has(sourceId)) builtinSearchedIds.add(sourceId);
              searchedIds.push(sourceId);
              if (Date.now() - lastFlush > 1500) flushCache();
            },
          },
        );
        await cachedMeasures;
        // 落库：探测过的候选整行覆盖，搜过但没这本书的源记成 status='none'。
        flushCache();
        // switch_candidates 以 (book_id, source_id) 为主键，一个源只能留一条。聚合源
        // （大灰狼/书山）一次会返回同一本书的多个版本（三体I、全集、同人），
        // candidates 已按质量/章数排序，必须保留每个源的第一条；否则后面的差版本
        // 会把好版本覆盖掉——实测 843 最后只剩 1,952 字的《三体！》，丢了 19 万字的《三体I》。
        const qualityOrder = (quality?: string): number =>
          quality === "ok" ? 0 : quality === "suspect" ? 1 : quality === "bad" ? 3 : 2;
        const responseOrder = (status?: string): number =>
          status === "ok" ? 0 : status === "warn" ? 1 : status === "pending" ? 2 : 3;
        const betterFresh = (left: SwitchCandidate, right: SwitchCandidate): boolean => {
          const leftRank = [
            qualityOrder(left.contentQuality),
            responseOrder(left.status),
            (left.chars ?? 0) > 0 ? 0 : 1,
            Math.abs(left.name.length - name.length),
            -left.chapters,
          ];
          const rightRank = [
            qualityOrder(right.contentQuality),
            responseOrder(right.status),
            (right.chars ?? 0) > 0 ? 0 : 1,
            Math.abs(right.name.length - name.length),
            -right.chapters,
          ];
          for (let i = 0; i < leftRank.length; i += 1) {
            if (leftRank[i] !== rightRank[i]) return leftRank[i] < rightRank[i];
          }
          return false;
        };
        const bestFresh = new Map<number, SwitchCandidate>();
        for (const item of candidates) {
          const current = bestFresh.get(item.sourceId);
          if (!current || betterFresh(item, current)) bestFresh.set(item.sourceId, item);
        }
        saveSwitchCandidates(book.id, Array.from(bestFresh.values()));
        // 缓存里被跳过的候选这次没重搜，done 必须把它们一起带上，否则客户端整表替换
        // 会「换个章节候选全没了」。同一个源以本次新探测的为准。
        const merged = new Map<number, SwitchCandidate>();
        for (const item of cached) merged.set(item.sourceId, item);
        for (const [sourceId, item] of bestFresh) merged.set(sourceId, item);
        const finalList = Array.from(merged.values());
        if (measureKey) saveSwitchMeasures(book.id, measureKey, finalList);
        const builtins = builtinRows.map((row) => {
          const id = Number(row.id);
          const candidate = finalList.find((item) => item.sourceId === id);
          return {
            id,
            name: String(row.name || (row.url === "dhl://builtin" ? "大灰狼聚合" : "书山聚合")),
            searched: builtinSearchedIds.has(id) || skip.has(id),
            found: Boolean(candidate && candidate.status !== "fail"),
          };
        });
        sse.send("done", {
          candidates: finalList,
          deep,
          ms: Date.now() - startedAt,
          skipped: skippedCount,
          measuring: toMeasure.length,
          // 兼容旧前端：第一个内置源仍放在 builtin；新前端读 builtins 展示全部。
          builtin: builtins[0] ?? null,
          builtins,
        });
      } catch (err) {
        sse.send("error", { message: String((err as Error).message ?? err).slice(0, 200) });
      } finally {
        // 中途断开也要把已经搜到的东西留下。
        flushCache();
        sse.end();
      }
    },
  );

  /** Switch a book to another source (Legado 的「换源」): refetch info + toc, carry progress over. */
  app.post<{ Params: { id: string }; Body: SwitchInput }>("/api/books/:id/switch", async (req, reply) => {
    const result = await switchBookToSource(Number(req.params.id), req.body ?? {});
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.send(result.payload);
  });

  /** 撤销上一次换源：换回 switch_history 里记着的源，并回到换源前的章节位置。 */
  app.post<{ Params: { id: string }; Body?: { chapterIndex?: number; chapterTitle?: string } }>(
    "/api/books/:id/switch/undo",
    async (req, reply) => {
    const bookId = Number(req.params.id);
    if (!getBook(bookId)) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const previous = latestSwitchHistory(bookId);
    if (!previous || !previous.source_id) return reply.code(404).send({ error: "no_history", message: "没有可撤销的换源记录" });
    // 自动换源可能由预取邻章触发；撤销时客户端把「正在看的那一章」带上来，别回到预取章。
    const overrideIndex = Number(req.body?.chapterIndex);
    const overrideTitle = String(req.body?.chapterTitle ?? "").trim();
    const result = await switchBookToSource(bookId, {
      sourceId: previous.source_id,
      bookUrl: previous.book_url,
      expectName: previous.book_name || undefined,
      // 换回去是读者的明确意图：书名/章数都按原样接受，不再走校验拦截。
      force: true,
      allowShorter: true,
      chapterIndex: Number.isInteger(overrideIndex) && overrideIndex >= 0 ? overrideIndex : previous.chapter_index,
      chapterTitle: overrideTitle || previous.chapter_title,
      // 撤销只该是一次性回程：不要再记一条「反向历史」，否则按钮会一直亮着。
      recordHistory: false,
      // 撤销用快照精确还原，不再根据新源正文猜一次。
      skipReanchor: true,
    });
    if (!result.ok) return reply.code(result.status).send(result.body);
    const snapshot = parseReanchorSnapshot(previous.reanchor_snapshot);
    if (snapshot) {
      const applied = applyReanchorSnapshot(bookId, snapshot);
      result.payload.reanchor = {
        annotations: { total: applied.annotations, moved: 0, kept: applied.annotations, failed: 0 },
        bookmarks: { total: applied.bookmarks, moved: 0, kept: applied.bookmarks, failed: 0 },
        chaptersFetched: 0,
        partial: false,
        ms: 0,
      };
    }
    dropSwitchHistory(previous.id);
    result.payload.canUndo = false;
    return reply.send(result.payload);
  });

  /** 换源记录：最近 5 次手动/自动换源，换源面板用它解释「从哪换来的」。 */
  app.get<{ Params: { id: string } }>("/api/books/:id/switch/history", async (req, reply) => {
    const bookId = Number(req.params.id);
    if (!getBook(bookId)) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const items: SwitchHistoryItem[] = listSwitchHistory(bookId).map((row) => ({
      id: row.id,
      kind: row.kind,
      sourceId: row.source_id,
      sourceName: row.source_name,
      chapters: row.chapters,
      chapterIndex: row.chapter_index,
      chapterTitle: row.chapter_title,
      createdAt: row.created_at,
      bookUrl: row.book_url,
      bookName: row.book_name,
      charOffset: row.char_offset,
    }));
    return { total: items.length, items };
  });

  /**
   * 重试重贴：换源时正文抓取超时/被限流，标注和书签会留在旧位置。
   * 这里用最近一次换源的快照再跑一遍，幂等，不改变书源。
   */
  app.post<{ Params: { id: string } }>("/api/books/:id/reanchor", async (req, reply) => {
    const bookId = Number(req.params.id);
    if (!getBook(bookId)) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const previous = latestSwitchHistory(bookId);
    const snapshot = parseReanchorSnapshot(previous?.reanchor_snapshot);
    if (!snapshot) return reply.code(404).send({ error: "no_snapshot", message: "没有可重贴的标注快照" });
    const reanchor = await reanchorAfterSwitch(bookId, snapshot);
    return reply.send({ ok: true, reanchor });
  });

  /** 手动定位第一步：列出引文在新源目标章里的所有命中。 */
  app.post<{ Params: { id: string } }>("/api/books/:id/reanchor/locate", async (req, reply) => {
    const bookId = Number(req.params.id);
    if (!getBook(bookId)) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const body = (req.body ?? {}) as { kind?: string; id?: string | number; chapterIndex?: number };
    if (body.kind !== "annotation" && body.kind !== "bookmark") {
      return reply.code(400).send({ error: "invalid_kind", message: "kind 只能是 annotation 或 bookmark" });
    }
    if (body.id === undefined || body.id === null || body.id === "") {
      return reply.code(400).send({ error: "invalid_id", message: "缺少标注/书签 id" });
    }
    try {
      const located = await locateReanchorItem(bookId, body.kind, body.id, body.chapterIndex);
      return reply.send({ ok: true, ...located });
    } catch (error) {
      if (error instanceof ReanchorLocateError) {
        const status = error.code === "chapter_fetch" ? 502 : error.code === "no_snapshot" || error.code === "item_not_found" || error.code === "chapter_not_found" ? 404 : 400;
        return reply.code(status).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  /** 手动定位第二步：写回用户选中的位置。 */
  app.post<{ Params: { id: string } }>("/api/books/:id/reanchor/apply", async (req, reply) => {
    const bookId = Number(req.params.id);
    if (!getBook(bookId)) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const body = (req.body ?? {}) as { kind?: string; id?: string | number; chapterIndex?: number; start?: number; end?: number };
    if (body.kind !== "annotation" && body.kind !== "bookmark") {
      return reply.code(400).send({ error: "invalid_kind", message: "kind 只能是 annotation 或 bookmark" });
    }
    if (body.id === undefined || body.id === null || body.id === "" || body.chapterIndex === undefined || body.start === undefined || body.end === undefined) {
      return reply.code(400).send({ error: "invalid_body", message: "缺少 kind/id/chapterIndex/start/end" });
    }
    try {
      const applied = await applyManualReanchor(bookId, body.kind, body.id, Number(body.chapterIndex), Number(body.start), Number(body.end));
      return reply.send({ ok: true, ...applied });
    } catch (error) {
      if (error instanceof ReanchorLocateError) {
        const status = error.code === "chapter_fetch" ? 502 : error.code === "item_not_found" || error.code === "chapter_not_found" ? 404 : 400;
        return reply.code(status).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/api/books/:id/chapters", async (req, reply) => {
    const list = await listChapters(Number(req.params.id));
    if (!list) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    return reply.send(list);
  });

  app.get<{ Params: { id: string; index: string } }>("/api/books/:id/chapters/:index/content", async (req, reply) => {
    const result = await readChapter(Number(req.params.id), Number(req.params.index));
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.send(result.payload);
  });

  /** 导出入口先问一句「有多少章可导出」，按钮才好显示「可导出 68/1081 章」。 */
  app.get<{ Params: { id: string } }>("/api/books/:id/export/info", async (req, reply) => {
    const book = getBook(Number(req.params.id));
    if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    return reply.send({ cached: countCachedChapters(book.id), total: countChapters(book.id) });
  });

  /**
   * 导出已缓存的章节：TXT 便于复制到别处，EPUB 给电纸书。
   * 不会为了导出回源抓没读过的章节 —— 一千章的书那样要跑几分钟，还容易被站点限流。
   */
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>("/api/books/:id/export", async (req, reply) => {
    const book = getBook(Number(req.params.id));
    if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const format = req.query.format === "epub" ? "epub" : "txt";
    const result = exportBook(book, format);
    if (!result.chapters) {
      return reply
        .code(409)
        .send({ error: "no_cached_chapters", message: "还没有缓存任何章节：先打开几章，或用「整本离线」下载后再导出" });
    }
    const encoded = encodeURIComponent(result.filename).replace(/'/g, "%27");
    reply.header("content-type", format === "epub" ? "application/epub+zip" : "text/plain; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="book-${book.id}.${format}"; filename*=UTF-8''${encoded}`);
    reply.header("x-export-chapters", `${result.chapters}/${result.total}`);
    return reply.send(result.body);
  });

  /**
   * 全书搜索（SSE）：先扫已缓存的正文，再按章节顺序联网补抓，命中边扫边推。
   * 抓取有预算，扫不完就把 nextIndex 交回去，客户端可以「继续扫描」。
   */
  app.get<{ Params: { id: string }; Querystring: { q?: string; from?: string; limit?: string; budget?: string } }>(
    "/api/books/:id/search",
    async (req, reply) => {
      const bookId = Number(req.params.id);
      if (!getBook(bookId)) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
      const query = String(req.query.q ?? "").replace(/\s+/g, " ").trim();
      if (!query) return reply.code(400).send({ error: "empty_query", message: "搜索词不能为空" });
      if (query.length > 60) return reply.code(400).send({ error: "query_too_long", message: "搜索词太长了" });
      const from = Math.max(0, Number(req.query.from ?? 0) || 0);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 60) || 60));
      const budget = Math.max(2_000, Math.min(120_000, Number(req.query.budget ?? 60_000) || 60_000));
      const total = countChapters(bookId);
      const sse = openSse(req, reply);
      sse.send("start", { query, from, total });
      try {
        const result = await searchBook(bookId, query, {
          from,
          limit,
          budgetMs: budget,
          onHit: (hit) => sse.send("hit", hit),
          onProgress: (done, all) => sse.send("progress", { done, total: all }),
          shouldStop: () => sse.isClosed(),
        });
        if (!sse.isClosed()) sse.send("done", { ...result, query });
      } catch (err) {
        if (!sse.isClosed()) sse.send("error", { message: String((err as Error).message ?? err) });
      } finally {
        sse.end();
      }
      return reply;
    },
  );

  app.put<{ Params: { id: string }; Body: ProgressInput }>("/api/books/:id/progress", async (req, reply) => {
    saveProgress(Number(req.params.id), req.body ?? {});
    return reply.send({ ok: true });
  });

  /** 位置历史：让「误点目录 / 翻过头」有路可退，也方便多设备之间手动对齐。 */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/books/:id/progress-history", async (req, reply) => {
    const items = listProgressHistory(Number(req.params.id), Number(req.query.limit ?? 50) || 50);
    return reply.send({ total: items.length, items });
  });

  app.delete<{ Params: { id: string } }>("/api/books/:id/progress-history", async (req, reply) => {
    return reply.send({ ok: true, removed: clearProgressHistory(Number(req.params.id)) });
  });

  /** 目录已读标记：GET 一次拿全书，打开章节时 POST 一条（重复打开是幂等的）。 */
  app.get<{ Params: { id: string } }>("/api/books/:id/read-stats", async (req, reply) => {
    const book = getBook(Number(req.params.id));
    if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    return reply.send(readStats(book.id));
  });

  app.get<{ Params: { id: string } }>("/api/books/:id/read-chapters", async (req, reply) => {
    const book = getBook(Number(req.params.id));
    if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const items = listReadChapters(book.id);
    return reply.send({ total: items.length, items });
  });

  app.post<{ Params: { id: string }; Body: { index?: number } }>("/api/books/:id/read-chapters", async (req, reply) => {
    const book = getBook(Number(req.params.id));
    if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const index = Number(req.body?.index);
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: "bad_index", message: "章节号不正确" });
    }
    if (!markChapterRead(book.id, index)) {
      return reply.code(404).send({ error: "chapter_not_found", message: "章节不存在" });
    }
    return reply.send({ ok: true, total: countReadChapters(book.id) });
  });

  app.get<{ Params: { id: string } }>("/api/books/:id/bookmarks", async (req, reply) => {
    const items = listBookmarks(Number(req.params.id));
    return reply.send({ total: items.length, items });
  });

  app.post<{ Params: { id: string }; Body: BookmarkInput }>("/api/books/:id/bookmarks", async (req, reply) => {
    const result = addBookmark(Number(req.params.id), req.body ?? {});
    return reply.send({ ok: true, id: result.id, existed: result.existed });
  });

  app.delete<{ Params: { id: string; bookmarkId: string } }>("/api/books/:id/bookmarks/:bookmarkId", async (req, reply) => {
    removeBookmark(Number(req.params.id), Number(req.params.bookmarkId));
    return reply.send({ ok: true });
  });

  /** 划线 / 笔记。id 由客户端生成，重复提交是 upsert 而不是新增。 */
  app.get<{ Params: { id: string }; Querystring: { chapter?: string } }>("/api/books/:id/annotations", async (req, reply) => {
    const raw = Number(req.query.chapter);
    const items = listAnnotations(Number(req.params.id), Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : undefined);
    return reply.send({ total: items.length, items });
  });

  app.post<{ Params: { id: string }; Body: AnnotationInput }>("/api/books/:id/annotations", async (req, reply) => {
    const result = upsertAnnotation(Number(req.params.id), req.body ?? {});
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.send({ ok: true, item: result.item });
  });

  app.patch<{ Params: { id: string; annotationId: string }; Body: AnnotationInput }>(
    "/api/books/:id/annotations/:annotationId",
    async (req, reply) => {
      const result = patchAnnotation(Number(req.params.id), req.params.annotationId, req.body ?? {});
      if (!result.ok) return reply.code(result.status).send(result.body);
      return reply.send({ ok: true, item: result.item });
    },
  );

  app.delete<{ Params: { id: string; annotationId: string } }>(
    "/api/books/:id/annotations/:annotationId",
    async (req, reply) => {
      const removed = removeAnnotation(Number(req.params.id), req.params.annotationId);
      return reply.send({ ok: true, removed });
    },
  );

  /** Batch shelf operations: remove / move to group / refresh metadata. */
  app.post<{ Body: { ids?: number[]; action?: string; groupId?: number } }>("/api/books/batch", async (req, reply) => {
    const db = getDb();
    const ids = (req.body?.ids ?? [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 500);
    const action = String(req.body?.action ?? "");
    if (!ids.length) return reply.code(400).send({ error: "missing_ids", message: "没有选中书籍" });
    if (action === "remove") {
      for (const id of ids) deleteBookRows(db, id);
      return reply.send({ ok: true, affected: ids.length });
    }
    if (action === "group") {
      const groupId = Math.max(0, Math.floor(Number(req.body?.groupId ?? 0)));
      const stmt = db.prepare("UPDATE books SET group_id = ?, updated_at = datetime('now') WHERE id = ?");
      db.transaction(() => {
        for (const id of ids) stmt.run(groupId, id);
      })();
      return reply.send({ ok: true, affected: ids.length, groupId });
    }
    if (action === "refresh") {
      const items: Array<{ id: number; ok: boolean; newChapters: number; error?: string }> = [];
      for (const id of ids) {
        try {
          const result = await refreshBookMeta(id);
          items.push({ id, ok: true, newChapters: result.newChapters });
        } catch (err) {
          items.push({ id, ok: false, newChapters: 0, error: String((err as Error).message ?? err) });
        }
      }
      return reply.send({ ok: true, affected: items.filter((item) => item.ok).length, items });
    }
    return reply.code(400).send({ error: "bad_action", message: "不支持的操作" });
  });

  /** Follow-up ("追更") for the whole shelf, streamed so the UI can show progress. */
  app.post<{ Querystring: { limit?: string } }>("/api/books/refresh-all", async (req, reply) => {
    const db = getDb();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 30) || 30));
    const rows = db
      .prepare(
        `SELECT id, name FROM books WHERE in_shelf = 1
         ORDER BY CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END, last_checked_at ASC, id DESC LIMIT ?`,
      )
      .all(limit) as Array<{ id: number; name: string }>;
    const sse = openSse(req, reply);
    sse.send("start", { total: rows.length });
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        try {
          const result = await refreshBookMeta(row.id);
          sse.send("progress", { bookId: row.id, name: row.name, ok: true, newChapters: result.newChapters, lastChapter: result.lastChapter });
        } catch (err) {
          sse.send("progress", { bookId: row.id, name: row.name, ok: false, newChapters: 0, error: String((err as Error).message ?? err) });
        }
        done += 1;
        sse.send("tick", { done, total: rows.length });
      }
    };
    try {
      await Promise.all([worker(), worker()]);
      sse.send("done", { total: rows.length });
    } catch (err) {
      sse.send("error", { message: String((err as Error).message ?? err) });
    } finally {
      sse.end();
    }
  });

  app.delete<{ Params: { id: string } }>("/api/books/:id", async (req, reply) => {
    deleteBookRows(getDb(), Number(req.params.id));
    return reply.send({ ok: true });
  });
}
