import { getDb } from "../../db/index.js";
import { loadChapterBody } from "./content.js";
import { scanChapter } from "./search-text.js";
import { countChapters, getBook, type BookRow } from "./store.js";

/** 一条命中：只回章节坐标与摘录，正文由客户端按需再取。 */
export interface BookSearchHit {
  chapterIndex: number;
  chapterTitle: string;
  /** 本章命中次数（只统计到 limitPerChapter）。 */
  count: number;
  /** 第一处命中的章节内字符偏移，点进去直接落到那一行。 */
  offset: number;
  excerpt: string;
}

export interface SearchBookOptions {
  /** 从第几章开始扫（「继续扫描」用）。 */
  from?: number;
  /** 最多返回多少章命中。 */
  limit?: number;
  /** 每章最多数几处命中（摘录只取第一处）。 */
  limitPerChapter?: number;
  concurrency?: number;
  /** 联网抓取的预算；缓存扫描不受它限制。 */
  budgetMs?: number;
  onHit?: (hit: BookSearchHit) => void;
  onProgress?: (done: number, total: number) => void;
  shouldStop?: () => boolean;
}

export interface SearchBookResult {
  /** 已找到的命中章数。 */
  hits: number;
  scanned: number;
  total: number;
  /** 下次「继续扫描」的起点；等于 total 表示扫完了。 */
  nextIndex: number;
  stopped: boolean;
}

/**
 * 全书搜索。
 *
 * 先扫 chapter_contents（整本离线过的书这一步就够，几百章也是毫秒级），再按章节顺序
 * 联网补抓没缓存的部分，命中边抓边推。抓取有预算，超时就把 nextIndex 交回客户端，
 * 用户可以「继续扫描」——不假装一次能扫完一千章。
 */
export async function searchBook(bookId: number, query: string, options: SearchBookOptions = {}): Promise<SearchBookResult> {
  const db = getDb();
  const book = getBook(bookId) as BookRow | undefined;
  if (!book) return { hits: 0, scanned: 0, total: 0, nextIndex: 0, stopped: true };
  const total = countChapters(bookId);
  const from = Math.max(0, Math.min(total, Math.floor(options.from ?? 0)));
  const limit = Math.max(1, Math.min(200, options.limit ?? 60));
  const limitPerChapter = Math.max(1, Math.min(20, options.limitPerChapter ?? 5));
  const budgetMs = Math.max(2_000, options.budgetMs ?? 60_000);
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));

  let scanned = 0;
  let hits = 0;
  let stopped = false;
  /** 还没扫完时的断点；默认 total 表示「扫完了」。 */
  let nextIndex = total;
  /** 抓完的章节号：停下时用它算出「从哪一章继续」，避免重复命中。 */
  const completed = new Set<number>();

  const emitHit = (chapterIndex: number, chapterTitle: string, found: { count: number; offset: number; excerpt: string }): void => {
    hits += 1;
    options.onHit?.({ chapterIndex, chapterTitle, count: found.count, offset: found.offset, excerpt: found.excerpt });
  };

  const cached = db
    .prepare(
      `SELECT c.idx AS idx, c.title AS title, cc.content AS content
         FROM chapters c JOIN chapter_contents cc ON cc.chapter_id = c.id
        WHERE c.book_id = ? AND c.idx >= ?
        ORDER BY c.idx`,
    )
    .all(bookId, from) as Array<{ idx: number; title: string; content: string }>;

  for (const row of cached) {
    if (options.shouldStop?.() || hits >= limit) {
      stopped = true;
      // 断点取「这一章」而不是「下一章」：缓存里可能只有最后一章，拿 idx+1 会让下一轮
      // 从书末开始，什么也扫不到。
      nextIndex = row.idx;
      break;
    }
    scanned += 1;
    completed.add(row.idx);
    const found = scanChapter(row.content, query, limitPerChapter);
    if (found) emitHit(row.idx, row.title, found);
  }
  options.onProgress?.(scanned, total);

  if (!stopped) {
    const missing = db
      .prepare(
        `SELECT c.* FROM chapters c
           LEFT JOIN chapter_contents cc ON cc.chapter_id = c.id
          WHERE c.book_id = ? AND c.idx >= ? AND cc.chapter_id IS NULL
          ORDER BY c.idx`,
      )
      .all(bookId, from) as Array<Record<string, unknown>>;

    const deadline = Date.now() + budgetMs;
    let cursor = 0;
    let lastReport = 0;
    const workers = new Array(Math.min(concurrency, Math.max(1, missing.length))).fill(0).map(async () => {
      while (cursor < missing.length) {
        if (options.shouldStop?.() || hits >= limit || Date.now() > deadline) {
          stopped = true;
          return;
        }
        const chapter = missing[cursor];
        cursor += 1;
        let text = "";
        try {
          const body = await loadChapterBody(db, book, chapter);
          text = body.content;
        } catch {
          text = "";
        }
        scanned += 1;
        completed.add(Number(chapter.idx));
        if (Date.now() - lastReport > 400) {
          lastReport = Date.now();
          options.onProgress?.(scanned, total);
        }
        if (!text) continue;
        const found = scanChapter(text, query, limitPerChapter);
        if (found) emitHit(Number(chapter.idx), String(chapter.title ?? ""), found);
      }
    });
    await Promise.all(workers);
    if (stopped) {
      // 并发抓取会打乱顺序：从「还没抓完的最小章节」继续，已抓过的不会重复命中。
      const pending = missing.find((row) => !completed.has(Number(row.idx)));
      nextIndex = pending ? Number(pending.idx) : total;
    } else {
      nextIndex = total;
    }
    options.onProgress?.(scanned, total);
  }

  if (hits >= limit) stopped = true;
  if (!stopped) nextIndex = total;
  return { hits, scanned, total, nextIndex: Math.min(total, Math.max(from, nextIndex)), stopped };
}
