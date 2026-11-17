import type { BookSummary } from "@legado/shared";
import type { BookInfo } from "@legado/engine";
import { getDb } from "../../db/index.js";
import { fetchBookInfo, fetchToc, loadSourceById } from "../engine.js";
import { cleanCover, cleanWordCount, firstNonEmpty } from "../text.js";
import { MAX_CHAPTERS, bookPayload, countChapters, getBook, replaceChapters, type BookRow } from "./store.js";

export interface RefreshBookPayload {
  book: BookSummary;
  chapters: number;
  infoError: string | null;
  tocError: string | null;
}

export type RefreshBookResult = { ok: true; payload: RefreshBookPayload } | { ok: false; status: number; body: Record<string, unknown> };

/** 重新抓详情 + 目录（修「书是在规则坏掉时加进书架」留下的空目录/旧封面）。 */
export async function refreshBookFromSource(bookId: number): Promise<RefreshBookResult> {
  const db = getDb();
  const book = getBook(bookId);
  if (!book) return { ok: false, status: 404, body: { error: "not_found", message: "书籍不存在" } };
  const sourceId = Number(book.source_id);
  if (!loadSourceById(sourceId)) return { ok: false, status: 400, body: { error: "source_missing", message: "书源已被删除" } };

  let infoError: string | null = null;
  let tocError: string | null = null;
  let info: BookInfo | null = null;
  try {
    info = await fetchBookInfo(sourceId, String(book.book_url));
  } catch (err) {
    infoError = String((err as Error).message ?? err);
  }
  if (info) {
    db.prepare(
      `UPDATE books SET name = ?, author = ?, cover_url = ?, intro = ?, kind = ?, last_chapter = ?, word_count = ?,
         toc_url = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      firstNonEmpty(info.name, book.name as string),
      firstNonEmpty(info.author, book.author as string),
      cleanCover(info.coverUrl, book.cover_url as string),
      firstNonEmpty(info.intro, book.intro as string),
      firstNonEmpty(info.kind, book.kind as string),
      firstNonEmpty(info.lastChapter, book.last_chapter as string),
      firstNonEmpty(cleanWordCount(info.wordCount), cleanWordCount(book.word_count as string)),
      info.tocUrl || String(book.toc_url ?? ""),
      book.id,
    );
  }
  let chapters = 0;
  try {
    const list = await fetchToc(sourceId, (info ?? { bookUrl: book.book_url, tocUrl: book.toc_url }) as BookInfo);
    if (list.length > MAX_CHAPTERS) {
      tocError = `目录异常：解析出 ${list.length} 章（上限 ${MAX_CHAPTERS}），已跳过保存`;
    } else if (list.length) {
      // 整表替换：章节地址和顺序在两次刷新之间都可能变，留着旧行只会积累僵尸章节。
      replaceChapters(book.id, String(book.book_url), list);
      chapters = list.length;
    }
  } catch (err) {
    tocError = String((err as Error).message ?? err);
  }
  const row = getBook(book.id) as BookRow;
  return { ok: true, payload: { book: bookPayload(row, chapters || countChapters(book.id)), chapters, infoError, tocError } };
}
