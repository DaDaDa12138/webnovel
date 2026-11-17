import type { BookmarkItem } from "@legado/shared";
import { getDb } from "../../db/index.js";

export function listBookmarks(bookId: number): BookmarkItem[] {
  const rows = getDb()
    .prepare(
      "SELECT id, chapter_index, title, excerpt, char_offset, created_at FROM bookmarks WHERE book_id = ? ORDER BY chapter_index ASC, char_offset ASC, id ASC",
    )
    .all(bookId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    chapterIndex: Number(r.chapter_index ?? 0),
    title: String(r.title ?? ""),
    excerpt: String(r.excerpt ?? ""),
    charOffset: Number(r.char_offset ?? 0),
    createdAt: String(r.created_at ?? ""),
  }));
}

export interface BookmarkInput {
  chapterIndex?: number;
  title?: string;
  excerpt?: string;
  charOffset?: number;
}

/** 段落锚点是身份：同一个 charOffset 重复点只算一条书签。 */
export function addBookmark(bookId: number, body: BookmarkInput): { id: number; existed: boolean } {
  const db = getDb();
  const chapterIndex = Math.max(0, Math.floor(Number(body.chapterIndex ?? 0)));
  const charOffset = Math.max(0, Math.round(Number(body.charOffset ?? 0)));
  const title = String(body.title ?? "").slice(0, 200);
  const existing = charOffset
    ? (db
        .prepare("SELECT id FROM bookmarks WHERE book_id = ? AND chapter_index = ? AND char_offset = ?")
        .get(bookId, chapterIndex, charOffset) as { id: number } | undefined)
    : (db
        .prepare("SELECT id FROM bookmarks WHERE book_id = ? AND chapter_index = ? AND title = ?")
        .get(bookId, chapterIndex, title) as { id: number } | undefined);
  if (existing) return { id: existing.id, existed: true };
  const chapter = db.prepare("SELECT id FROM chapters WHERE book_id = ? AND idx = ?").get(bookId, chapterIndex) as { id: number } | undefined;
  const info = db
    .prepare("INSERT INTO bookmarks (book_id, chapter_id, chapter_index, title, excerpt, char_offset) VALUES (?, ?, ?, ?, ?, ?)")
    .run(bookId, chapter?.id ?? null, chapterIndex, title, String(body.excerpt ?? "").slice(0, 200), charOffset);
  return { id: Number(info.lastInsertRowid), existed: false };
}

export function removeBookmark(bookId: number, bookmarkId: number): void {
  getDb().prepare("DELETE FROM bookmarks WHERE id = ? AND book_id = ?").run(bookmarkId, bookId);
}

/**
 * 按锚点删除。离线队列里存不了自增 id（书签可能是断网时新建、服务端从没见过的），
 * 所以补传时用「第几章 + 第几个字」定位——这和 addBookmark 判重用的是同一套身份。
 */
export function removeBookmarkByAnchor(bookId: number, chapterIndex: number, charOffset: number): number {
  const info = getDb()
    .prepare("DELETE FROM bookmarks WHERE book_id = ? AND chapter_index = ? AND char_offset = ?")
    .run(bookId, Math.max(0, Math.floor(chapterIndex)), Math.max(0, Math.round(charOffset)));
  return Number(info.changes);
}
