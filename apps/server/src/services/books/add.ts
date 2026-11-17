import type { BookInfo } from "@legado/engine";
import { nameFromUrl } from "@legado/engine";
import { getDb } from "../../db/index.js";
import { fetchBookInfo, fetchToc } from "../engine.js";
import { cleanCover, cleanWordCount, firstNonEmpty } from "../text.js";
import { MAX_CHAPTERS, bookPayload, countChapters, saveChapters, type BookRow } from "./store.js";

export interface CreateBookInput {
  sourceId?: number;
  bookUrl?: string;
  name?: string;
  author?: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  wordCount?: string;
  /**
   * true = 只建一条「预览」记录：不入书架、不联网抓详情/目录。
   * 发现页点一本书先看简介，用户再决定要不要加入书架——第一步不该偷偷入架。
   */
  preview?: boolean;
}

export type CreateBookResult =
  | { ok: true; payload: { book: ReturnType<typeof bookPayload>; existed: boolean; infoError: string | null; tocError: string | null } }
  | { ok: false; status: number; body: Record<string, unknown> };

/** 加进书架。详情页打不开也要能加：拿搜索结果的字段兜底，绝不因为源规则坏了就拒绝。 */
export async function addBookToShelf(body: CreateBookInput): Promise<CreateBookResult> {
  const sourceId = Number(body.sourceId ?? 0);
  const bookUrl = (body.bookUrl ?? "").trim();
  if (!sourceId || !bookUrl) return { ok: false, status: 400, body: { error: "missing_source_or_url", message: "缺少书源或书籍地址" } };

  const db = getDb();
  const existing = db.prepare("SELECT * FROM books WHERE book_url = ? AND source_id = ?").get(bookUrl, sourceId) as BookRow | undefined;
  const preview = body.preview === true;

  let info: BookInfo | null = null;
  let infoError: string | null = null;
  // 预览不抓详情页：发现页列表里已经有书名/作者/封面/简介，先让用户秒开详情页；
  // 目录等用户真要看的时候由详情页按需拉（BookPage 的 ensureToc）。
  if (!preview) {
    try {
      info = await fetchBookInfo(sourceId, bookUrl);
    } catch (err) {
      infoError = String((err as Error).message ?? err);
    }
  }

  const sourceRow = db.prepare("SELECT name FROM book_sources WHERE id = ?").get(sourceId) as { name: string } | undefined;
  const name = firstNonEmpty(body.name, info?.name, existing?.name as string, nameFromUrl(bookUrl), "未命名书籍").slice(0, 120);
  const cover = cleanCover(body.coverUrl, info?.coverUrl, existing?.cover_url as string);
  const author = firstNonEmpty(body.author, info?.author, existing?.author as string).slice(0, 60);
  const intro = firstNonEmpty(body.intro, info?.intro, existing?.intro as string).slice(0, 4000);
  const kind = firstNonEmpty(body.kind, info?.kind, existing?.kind as string).slice(0, 40);
  const lastChapter = firstNonEmpty(body.lastChapter, info?.lastChapter, existing?.last_chapter as string).slice(0, 120);
  const wordCount = firstNonEmpty(cleanWordCount(body.wordCount), cleanWordCount(info?.wordCount), cleanWordCount(existing?.word_count as string));
  const tocUrl = info?.tocUrl ?? (existing?.toc_url as string) ?? bookUrl;

  // 预览碰到已在书架的书时不能把 in_shelf 改回 0——只有新建才是 0。
  const upsert = preview
    ? `INSERT INTO books (book_url, source_id, name, author, cover_url, intro, kind, last_chapter, word_count, toc_url, origin, origin_name, in_shelf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(book_url, source_id) DO UPDATE SET
         name=excluded.name, author=excluded.author, cover_url=excluded.cover_url, intro=excluded.intro,
         kind=excluded.kind, last_chapter=excluded.last_chapter, word_count=excluded.word_count,
         updated_at=datetime('now')`
    : `INSERT INTO books (book_url, source_id, name, author, cover_url, intro, kind, last_chapter, word_count, toc_url, origin, origin_name, in_shelf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(book_url, source_id) DO UPDATE SET
         name=excluded.name, author=excluded.author, cover_url=excluded.cover_url, intro=excluded.intro,
         kind=excluded.kind, last_chapter=excluded.last_chapter, word_count=excluded.word_count,
         toc_url=excluded.toc_url, in_shelf=1, updated_at=datetime('now')`;
  db.prepare(upsert).run(
    bookUrl,
    sourceId,
    name,
    author,
    cover,
    intro,
    kind,
    lastChapter,
    wordCount,
    tocUrl,
    info?.origin ?? "",
    info?.originName ?? sourceRow?.name ?? "",
  );

  const row = db.prepare("SELECT * FROM books WHERE book_url = ? AND source_id = ?").get(bookUrl, sourceId) as BookRow;
  let chapters = countChapters(row.id);
  let tocError: string | null = null;
  if (!chapters && !preview) {
    try {
      const list = await fetchToc(sourceId, info ?? ({ bookUrl, tocUrl } as BookInfo));
      if (list.length > MAX_CHAPTERS) {
        tocError = `目录异常：解析出 ${list.length} 章（上限 ${MAX_CHAPTERS}），已跳过保存`;
      } else if (list.length) {
        saveChapters(row.id, bookUrl, list);
        chapters = list.length;
      }
    } catch (err) {
      tocError = String((err as Error).message ?? err);
    }
  }
  return { ok: true, payload: { book: bookPayload(row, chapters), existed: Boolean(existing), infoError, tocError } };
}
