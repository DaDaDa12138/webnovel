import { getDb } from "../../db/index.js";

/**
 * 已读标记：目录里把读过的章压暗，读者一眼知道自己走到哪。
 *
 * 只记第一次打开的时间（INSERT OR IGNORE）：重复打开不重复写，也保留「最初
 * 什么时候读的」；不存位置，位置仍由 reading_progress 负责。
 */

export function markChapterRead(bookId: number, chapterIndex: number, charOffset = 0): boolean {
  const db = getDb();
  const index = Math.max(0, Math.floor(chapterIndex));
  const offset = Math.max(0, Math.round(Number(charOffset) || 0));
  const chapter = db.prepare("SELECT 1 AS ok FROM chapters WHERE book_id = ? AND idx = ?").get(bookId, index) as
    | { ok?: number }
    | undefined;
  if (!chapter) return false;
  // 只向前推进：回翻、重读不该让「读到多少」缩水。
  db.prepare(
    `INSERT INTO chapter_reads (book_id, chapter_index, max_char_offset) VALUES (?, ?, ?)
     ON CONFLICT(book_id, chapter_index) DO UPDATE SET
       max_char_offset = MAX(chapter_reads.max_char_offset, excluded.max_char_offset)`,
  ).run(bookId, index, offset);
  return true;
}

export function listReadChapters(bookId: number): number[] {
  const rows = getDb()
    .prepare("SELECT chapter_index FROM chapter_reads WHERE book_id = ? ORDER BY chapter_index")
    .all(bookId) as Array<{ chapter_index: number }>;
  return rows.map((row) => Number(row.chapter_index));
}

export function countReadChapters(bookId: number): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM chapter_reads WHERE book_id = ?").get(bookId) as
    | { n?: number }
    | undefined;
  return Number(row?.n ?? 0);
}

export interface BookReadStats {
  /** 打开过的章节数（目录里的「已读」）。 */
  chapters: number;
  /** 各章实际读到的最远字符数之和，上限为该章正文长度。 */
  words: number;
}

/**
 * 本书已读字数：按每章记录的最远 charOffset 累加，而不是把打开过的整章都算进来。
 *
 * 只统计正文仍在缓存里的章节：缓存被「清理缓存」删掉后字数会回落，这是真实可解释的
 * 行为，比用目录字数估算更诚实——不同书源的章节字数口径差别很大。
 */
export function readStats(bookId: number): BookReadStats {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS chapters,
              COALESCE(SUM(MIN(LENGTH(cc.content), cr.max_char_offset)), 0) AS words
       FROM chapter_reads cr
       JOIN chapters c ON c.book_id = cr.book_id AND c.idx = cr.chapter_index
       LEFT JOIN chapter_contents cc ON cc.chapter_id = c.id
       WHERE cr.book_id = ?`,
    )
    .get(bookId) as { chapters?: number; words?: number } | undefined;
  return { chapters: Number(row?.chapters ?? 0), words: Number(row?.words ?? 0) };
}

/** 全站已读字数：阅读记录页的累计字数，口径与 readStats 一致。 */
export function totalReadWords(): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(MIN(LENGTH(cc.content), cr.max_char_offset)), 0) AS n
       FROM chapter_reads cr
       JOIN chapters c ON c.book_id = cr.book_id AND c.idx = cr.chapter_index
       JOIN chapter_contents cc ON cc.chapter_id = c.id`,
    )
    .get() as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}
