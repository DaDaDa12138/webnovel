import type { BookItem } from "@legado/shared";
import { getDb } from "../../db/index.js";

export interface ShelfQuery {
  inShelf?: string;
  q?: string;
  sort?: string;
  group?: string;
}

/** 书架列表：过滤 + 排序 + 把 chapterIndex/chapterPercent 折算成整体百分比。 */
export function listShelf(query: ShelfQuery): BookItem[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.inShelf === "1") clauses.push("b.in_shelf = 1");
  const q = (query.q ?? "").trim();
  if (q) {
    clauses.push("(b.name LIKE ? OR b.author LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const group = (query.group ?? "").trim();
  if (group && group !== "all") {
    if (group === "0" || group === "none") clauses.push("b.group_id = 0");
    else if (/^\d+$/.test(group)) {
      clauses.push("b.group_id = ?");
      params.push(Number(group));
    }
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const sort = query.sort ?? "read";
  const order =
    sort === "updated"
      ? "b.updated_at DESC, b.id DESC"
      : sort === "name"
        ? "b.name COLLATE NOCASE ASC, b.id ASC"
        : sort === "added"
          ? "b.created_at DESC, b.id DESC"
          : "COALESCE(p.updated_at, b.updated_at) DESC, b.id DESC";
  const rows = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count,
              p.chapter_index, p.percent, p.offset, p.char_offset, p.chapter_percent, p.updated_at AS read_at
       FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id ${where}
       ORDER BY ${order}`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const chapterCount = Number(r.chapter_count ?? 0);
    const chapterIndex = Number(r.chapter_index ?? 0);
    const chapterPercent = Number(r.chapter_percent ?? r.percent ?? 0);
    // chapter_percent is a 0..1 fraction of the current chapter; percent is 0..100 overall.
    const percent = chapterCount ? Math.min(100, Math.round(((chapterIndex + chapterPercent) / chapterCount) * 100)) : 0;
    return {
      id: Number(r.id),
      name: String(r.name ?? ""),
      author: String(r.author ?? ""),
      coverUrl: String(r.cover_url ?? ""),
      intro: String(r.intro ?? ""),
      kind: String(r.kind ?? ""),
      lastChapter: String(r.last_chapter ?? ""),
      wordCount: String(r.word_count ?? ""),
      tocUrl: String(r.toc_url ?? ""),
      sourceId: Number(r.source_id ?? 0),
      originName: String(r.origin_name ?? ""),
      note: String(r.note ?? ""),
      groupId: Number(r.group_id ?? 0),
      newChapters: Number(r.new_chapters ?? 0),
      lastCheckedAt: (r.last_checked_at as string | null) ?? null,
      inShelf: Boolean(r.in_shelf),
      createdAt: String(r.created_at ?? ""),
      updatedAt: String(r.updated_at ?? ""),
      chapterCount,
      chapterIndex,
      chapterPercent,
      charOffset: Number(r.char_offset ?? 0),
      percent,
      readAt: (r.read_at as string | null) ?? null,
    };
  });
}
