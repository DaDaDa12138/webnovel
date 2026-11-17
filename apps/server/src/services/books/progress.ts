import { getDb } from "../../db/index.js";
import { countChapters } from "./store.js";
import { recordProgressHistory } from "./progress-history.js";
import { markChapterRead } from "./reads.js";

export interface ProgressInput {
  chapterIndex?: number;
  offset?: number;
  percent?: number;
  charOffset?: number;
  chapterPercent?: number;
}

/** 阅读位置落库。percent 是 0..100 的整体进度，chapterPercent 是本章 0..1。 */
export function saveProgress(bookId: number, body: ProgressInput): void {
  const db = getDb();
  const chapterIndex = Math.max(0, Math.floor(Number(body.chapterIndex ?? 0)));
  const offset = Math.max(0, Math.round(Number(body.offset ?? 0)));
  const charOffset = Math.max(0, Math.round(Number(body.charOffset ?? 0)));
  const chapterPercent = Math.max(0, Math.min(1, Number(body.chapterPercent ?? 0)));
  const total = countChapters(bookId);
  const percent =
    body.percent !== undefined && Number.isFinite(Number(body.percent))
      ? Math.max(0, Math.min(100, Number(body.percent)))
      : total
        ? Math.max(0, Math.min(100, ((chapterIndex + chapterPercent) / total) * 100))
        : 0;
  const chapter = db.prepare("SELECT id FROM chapters WHERE book_id = ? AND idx = ?").get(bookId, chapterIndex) as { id: number } | undefined;
  db.prepare(
    `INSERT INTO reading_progress (book_id, chapter_id, chapter_index, offset, char_offset, chapter_percent, percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(book_id) DO UPDATE SET chapter_id=excluded.chapter_id, chapter_index=excluded.chapter_index, offset=excluded.offset,
       char_offset=excluded.char_offset, chapter_percent=excluded.chapter_percent, percent=excluded.percent, updated_at=datetime('now')`,
  ).run(bookId, chapter?.id ?? null, chapterIndex, offset, charOffset, chapterPercent, percent);
  db.prepare("UPDATE books SET updated_at = datetime('now') WHERE id = ?").run(bookId);
  // 阅读统计和目录已读共用一张表；只前进不后退，回翻不会让已读字数缩水。
  try {
    markChapterRead(bookId, chapterIndex, charOffset);
  } catch {
    /* stats are best-effort */
  }
  // 位置历史是旁路：写失败不该让「保存进度」这个主流程报错。
  try {
    recordProgressHistory(bookId, { chapterIndex, charOffset, chapterPercent, percent });
  } catch {
    /* history is best-effort */
  }
}
