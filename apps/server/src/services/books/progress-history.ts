import { getDb } from "../../db/index.js";

/**
 * 阅读位置历史。
 *
 * reading_progress 只回答「我在哪」，回答不了「我曾经在哪」：误点目录、换设备、
 * 翻页翻过头，都需要能退回去。但滚动时前端每 800ms 就有一次防抖保存，直接逐条记录
 * 会把表刷爆，所以同一章 30 分钟内的连续保存合并成一行（保留首次创建时间，更新位置）。
 */
export interface ProgressHistoryItem {
  id: number;
  chapterIndex: number;
  chapterTitle: string;
  charOffset: number;
  percent: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressHistoryInput {
  chapterIndex: number;
  charOffset: number;
  chapterPercent: number;
  percent: number;
}

/** 每本书只留最近 100 条，够回溯几天的阅读轨迹，又不会无限长。 */
const KEEP = 100;
const MERGE_MINUTES = 30;
const MERGE_PERCENT = 5;

function chapterTitleOf(bookId: number, chapterIndex: number): string {
  const row = getDb()
    .prepare("SELECT title FROM chapters WHERE book_id = ? AND idx = ?")
    .get(bookId, chapterIndex) as { title: string } | undefined;
  return row?.title ?? "";
}

export function recordProgressHistory(bookId: number, input: ProgressHistoryInput): void {
  const db = getDb();
  const chapterIndex = Math.max(0, Math.floor(input.chapterIndex));
  const charOffset = Math.max(0, Math.round(input.charOffset));
  const chapterPercent = Math.max(0, Math.min(1, input.chapterPercent));
  const percent = Math.max(0, Math.min(100, input.percent));

  const latest = db
    .prepare(
      `SELECT id, chapter_index AS chapterIndex, percent, updated_at AS updatedAt
       FROM reading_progress_history
       WHERE book_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .get(bookId) as { id: number; chapterIndex: number; percent: number; updatedAt: string } | undefined;

  const merge =
    latest !== undefined &&
    latest.chapterIndex === chapterIndex &&
    Math.abs(latest.percent - percent) < MERGE_PERCENT &&
    (db
      .prepare("SELECT ? >= datetime('now', ?) AS fresh")
      .get(latest.updatedAt, `-${MERGE_MINUTES} minutes`) as { fresh: number } | undefined)?.fresh === 1;

  if (merge && latest) {
    db.prepare(
      `UPDATE reading_progress_history
       SET char_offset = ?, chapter_percent = ?, percent = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(charOffset, chapterPercent, percent, latest.id);
    return;
  }

  db.prepare(
    `INSERT INTO reading_progress_history (book_id, chapter_index, chapter_title, char_offset, chapter_percent, percent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(bookId, chapterIndex, chapterTitleOf(bookId, chapterIndex), charOffset, chapterPercent, percent);

  db.prepare(
    `DELETE FROM reading_progress_history
     WHERE book_id = ?
       AND id NOT IN (
         SELECT id FROM reading_progress_history WHERE book_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?
       )`,
  ).run(bookId, bookId, KEEP);
}

export function listProgressHistory(bookId: number, limit = 50): ProgressHistoryItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, chapter_index AS chapterIndex, chapter_title AS chapterTitle,
              char_offset AS charOffset, percent, created_at AS createdAt, updated_at AS updatedAt
       FROM reading_progress_history
       WHERE book_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    )
    .all(bookId, Math.max(1, Math.min(200, limit))) as ProgressHistoryItem[];
  return rows;
}

export function clearProgressHistory(bookId: number): number {
  const info = getDb().prepare("DELETE FROM reading_progress_history WHERE book_id = ?").run(bookId);
  return Number(info.changes);
}
