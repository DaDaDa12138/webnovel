import type { ChapterList } from "@legado/shared";
import { getDb } from "../../db/index.js";
import { fetchBookInfo, fetchToc } from "../engine.js";
import { CHAPTER_SELECT, getBook, saveChapters } from "./store.js";

/**
 * 目录。空目录时回源重建一次（书可能是在书源规则坏掉的时候加进书架的），
 * 打开目录也算「看过了」，顺手把书架上的更新红点清掉。
 */
export async function listChapters(bookId: number): Promise<ChapterList | null> {
  const db = getDb();
  const book = getBook(bookId);
  if (!book) return null;
  let rows = db.prepare(CHAPTER_SELECT).all(bookId) as Array<Record<string, unknown>>;
  if (!rows.length) {
    try {
      const info = await fetchBookInfo(Number(book.source_id), String(book.book_url));
      const chapters = await fetchToc(Number(book.source_id), info);
      if (chapters.length) {
        saveChapters(bookId, String(book.book_url), chapters);
        rows = db.prepare(CHAPTER_SELECT).all(bookId) as Array<Record<string, unknown>>;
      }
    } catch {
      /* 回源失败就返回空目录，前端会提示「目录为空」 */
    }
  }
  db.prepare("UPDATE books SET new_chapters = 0 WHERE id = ? AND new_chapters > 0").run(bookId);
  return {
    total: rows.length,
    items: rows.map((r) => ({
      id: Number(r.id),
      idx: Number(r.idx),
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      isVip: Boolean(r.is_vip),
      isVolume: Boolean(r.is_volume),
      words: Number(r.content_length ?? 0),
    })),
  };
}
