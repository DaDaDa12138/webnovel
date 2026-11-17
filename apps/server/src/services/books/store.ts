import type { BookSummary } from "@legado/shared";
import { matchChapter } from "@legado/engine";
import { getDb, type DB } from "../../db/index.js";
import type { fetchToc } from "../engine.js";

/** books 表一行：列名 snake_case，接口是 camelCase，转换只在 bookPayload 里做一次。 */
export interface BookRow extends Record<string, unknown> {
  id: number;
}

export interface ChapterRow {
  id: number;
  idx: number;
  title: string;
  url: string;
  base_url: string;
  is_vip: number;
  is_volume: number;
}

/** A sane upper bound: no real book has more chapters, and a broken rule can otherwise
 *  insert tens of thousands of rows (a 37MB "whole site" JSON once produced 99,999 rows). */
export const MAX_CHAPTERS = 20000;

/** Chapter rows plus the cached text length, so the catalogue can show "N 字" for
 *  chapters that were already read without fetching every chapter up front. */
export const CHAPTER_SELECT = `SELECT c.id, c.idx, c.title, c.url, c.is_vip, c.is_volume,
         (SELECT LENGTH(cc.content) FROM chapter_contents cc WHERE cc.chapter_id = c.id) AS content_length
       FROM chapters c WHERE c.book_id = ? ORDER BY c.idx ASC`;

export function getBook(id: number): BookRow | undefined {
  return getDb().prepare("SELECT * FROM books WHERE id = ?").get(id) as BookRow | undefined;
}

export function bookPayload(row: BookRow, chapterCount: number): BookSummary {
  return {
    id: row.id,
    name: String(row.name ?? ""),
    author: String(row.author ?? ""),
    coverUrl: String(row.cover_url ?? ""),
    intro: String(row.intro ?? ""),
    kind: String(row.kind ?? ""),
    lastChapter: String(row.last_chapter ?? ""),
    wordCount: String(row.word_count ?? ""),
    tocUrl: String(row.toc_url ?? ""),
    sourceId: Number(row.source_id ?? 0),
    originName: String(row.origin_name ?? ""),
    note: String(row.note ?? ""),
    groupId: Number(row.group_id ?? 0),
    newChapters: Number(row.new_chapters ?? 0),
    lastCheckedAt: (row.last_checked_at as string | null) ?? null,
    inShelf: Boolean(row.in_shelf),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    chapterCount,
  };
}

export function countChapters(bookId: number): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?").get(bookId) as { n: number };
  return row.n;
}

export function saveChapters(bookId: number, bookUrl: string, chapters: Awaited<ReturnType<typeof fetchToc>>): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO chapters (book_id, idx, title, url, base_url, is_vip, is_volume) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id, url) DO UPDATE SET idx=excluded.idx, title=excluded.title, is_vip=excluded.is_vip`,
  );
  db.transaction(() => {
    chapters.forEach((chapter, index) => {
      insert.run(bookId, index, chapter.title, chapter.url, bookUrl, chapter.isVip ? 1 : 0, chapter.isVolume ? 1 : 0);
    });
  })();
}

/** 整表替换：换源/刷新时章节地址与顺序都可能变，留着旧行只会积累僵尸章节。 */
export function replaceChapters(bookId: number, bookUrl: string, chapters: Awaited<ReturnType<typeof fetchToc>>): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM chapters WHERE book_id = ?").run(bookId);
    if (chapters.length) saveChapters(bookId, bookUrl, chapters);
  })();
}

export interface ProgressRow {
  chapter_id: number | null;
  chapter_index: number | null;
  offset: number;
  char_offset: number;
  chapter_percent: number;
  percent: number;
  chapter_title: string | null;
}

export function readProgress(db: DB, bookId: number): ProgressRow | undefined {
  return db
    .prepare(
      `SELECT p.chapter_id, p.chapter_index, p.offset, p.char_offset, p.chapter_percent, p.percent, c.title AS chapter_title
         FROM reading_progress p LEFT JOIN chapters c ON c.id = p.chapter_id WHERE p.book_id = ?`,
    )
    .get(bookId) as ProgressRow | undefined;
}

/** 换源后把阅读进度搬到新目录的同名/同章号章节上。换源以前是直接 DELETE 进度，
 *  读者一换源就回到第 1 章，这是「换源体验差」里最伤人的一条。 */
export function restoreProgress(
  db: DB,
  bookId: number,
  previous: ProgressRow | undefined,
  previousTotal = 0,
): { matched: boolean; index: number; title: string } | null {
  if (!previous) return null;
  const rows = db.prepare("SELECT id, idx, title FROM chapters WHERE book_id = ? ORDER BY idx ASC").all(bookId) as Array<{
    id: number;
    idx: number;
    title: string;
  }>;
  if (!rows.length) return null;
  const wanted = String(previous.chapter_title ?? "").trim();
  // 章节名优先：盗版站目录经常少章/多章/分卷重复编号，按章号找会稳定地落到邻章，
  // 章节名基本不会变。matchChapter 在没有任何名字证据时才退回同下标（reason=index）。
  // previousTotal：旧目录章数。给了它，名字对不上时按比例换算位置，而不是硬取同下标
  // （旧 884 章的第 700 章 ≈ 新 837 章的第 663 章；硬取会把人送回几十章之前）。
  const match = matchChapter(rows, wanted, Number(previous.chapter_index ?? 0), previousTotal);
  const chapter = rows[match.index] ?? rows[0];
  // 换源只保证「章」对得上，章内位置一律回到开头：像素偏移是旧源排版下的 scrollTop，
  // 字符偏移也受分段方式影响，照搬会把人送到章尾甚至下一章（实测就是「换源后跳了一章」）。
  const offset = 0;
  const charOffset = 0;
  const chapterPercent = 0;
  const percent = Math.max(0, Math.min(100, ((chapter.idx + 1) / rows.length) * 100));
  db.prepare(
    `UPDATE reading_progress SET chapter_id = ?, chapter_index = ?, offset = ?, char_offset = ?, chapter_percent = ?, percent = ?,
       updated_at = datetime('now') WHERE book_id = ?`,
  ).run(chapter.id, chapter.idx, offset, charOffset, chapterPercent, percent, bookId);
  return { matched: match.reason !== "index", index: chapter.idx, title: chapter.title };
}

export function deleteBookRows(db: DB, id: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM chapter_contents WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)").run(id);
    db.prepare("DELETE FROM chapters WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM reading_progress WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM switch_anchors WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM bookmarks WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM reading_sessions WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM books WHERE id = ?").run(id);
  })();
}
