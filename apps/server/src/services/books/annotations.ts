import { randomUUID } from "node:crypto";
import {
  ANNOTATION_COLORS,
  ANNOTATION_TYPES,
  type AnnotationColor,
  type AnnotationItem,
  type AnnotationType,
  type NoteItem,
} from "@legado/shared";
import { getDb } from "../../db/index.js";

/** 一条划线最长 8000 字（整段复制粘贴也不至于爆掉），上下文各留 40 字。 */
const MAX_SPAN = 8000;
const MAX_QUOTE = 400;
const MAX_CONTEXT = 40;
const MAX_COMMENT = 2000;
const MAX_TITLE = 200;
const MAX_ID = 64;

export interface AnnotationInput {
  id?: string;
  type?: string;
  chapterIndex?: number;
  chapterTitle?: string;
  start?: number;
  end?: number;
  quote?: string;
  prefix?: string;
  suffix?: string;
  comment?: string;
  color?: string;
}

export type AnnotationResult =
  | { ok: true; item: AnnotationItem }
  | { ok: false; status: number; body: { error: string; message: string } };

function pickColor(value: unknown): AnnotationColor {
  const text = String(value ?? "");
  return (ANNOTATION_COLORS as readonly string[]).includes(text) ? (text as AnnotationColor) : "yellow";
}

function pickType(value: unknown): AnnotationType {
  const text = String(value ?? "");
  return (ANNOTATION_TYPES as readonly string[]).includes(text) ? (text as AnnotationType) : "highlight";
}

function rowToItem(row: Record<string, unknown>): AnnotationItem {
  return {
    id: String(row.id ?? ""),
    bookId: Number(row.book_id ?? 0),
    type: pickType(row.type),
    chapterIndex: Number(row.chapter_index ?? 0),
    chapterTitle: String(row.chapter_title ?? ""),
    start: Number(row.start_offset ?? 0),
    end: Number(row.end_offset ?? 0),
    quote: String(row.quote ?? ""),
    prefix: String(row.prefix ?? ""),
    suffix: String(row.suffix ?? ""),
    comment: String(row.comment ?? ""),
    color: pickColor(row.color),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const SELECT = `SELECT id, book_id, type, chapter_index, chapter_title, start_offset, end_offset,
  quote, prefix, suffix, comment, color, created_at, updated_at FROM annotations`;

export function listAnnotations(bookId: number, chapterIndex?: number): AnnotationItem[] {
  const db = getDb();
  const rows = (
    chapterIndex === undefined
      ? db.prepare(`${SELECT} WHERE book_id = ? AND deleted = 0 ORDER BY chapter_index ASC, start_offset ASC, id ASC`).all(bookId)
      : db
          .prepare(`${SELECT} WHERE book_id = ? AND chapter_index = ? AND deleted = 0 ORDER BY start_offset ASC, id ASC`)
          .all(bookId, chapterIndex)
  ) as Array<Record<string, unknown>>;
  return rows.map(rowToItem);
}

export function getAnnotation(bookId: number, id: string): AnnotationItem | null {
  const row = getDb().prepare(`${SELECT} WHERE book_id = ? AND id = ? AND deleted = 0`).get(bookId, id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToItem(row) : null;
}

function bookExists(bookId: number): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM books WHERE id = ?").get(bookId));
}

/**
 * 客户端生成 id 的 upsert：同一 id 重复提交只更新，不新增。
 * 归属不符（同一个 id 已经被别的书占用）直接 409，绝不静默改写别人的划线。
 */
export function upsertAnnotation(bookId: number, body: AnnotationInput): AnnotationResult {
  if (!bookExists(bookId)) return { ok: false, status: 404, body: { error: "book_not_found", message: "书籍不存在" } };
  const db = getDb();
  const rawId = String(body.id ?? "").trim();
  if (rawId.length > MAX_ID) return { ok: false, status: 400, body: { error: "bad_id", message: "标注 id 过长" } };
  const id = rawId || randomUUID();

  const chapterIndex = Math.max(0, Math.floor(Number(body.chapterIndex ?? 0)));
  const start = Math.max(0, Math.floor(Number(body.start ?? 0)));
  const end = Math.max(start, Math.floor(Number(body.end ?? start)));
  if (end - start > MAX_SPAN) {
    return { ok: false, status: 400, body: { error: "range_too_long", message: "选中的内容太长" } };
  }
  const quote = String(body.quote ?? "").slice(0, MAX_QUOTE);
  const type = pickType(body.type);

  const owner = db.prepare("SELECT book_id FROM annotations WHERE id = ?").get(id) as { book_id: number } | undefined;
  if (owner && Number(owner.book_id) !== bookId) {
    return { ok: false, status: 409, body: { error: "id_conflict", message: "该标注属于另一本书" } };
  }

  const existing = db.prepare("SELECT id FROM annotations WHERE id = ?").get(id) as { id: string } | undefined;
  if (existing) {
    // 只覆盖调用方明确给过的字段，避免 PATCH 语义被 POST 悄悄清空。
    db.prepare(
      `UPDATE annotations SET type = ?, chapter_index = ?, chapter_title = ?, start_offset = ?, end_offset = ?,
         quote = ?, prefix = ?, suffix = ?, comment = ?, color = ?, deleted = 0, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      type,
      chapterIndex,
      String(body.chapterTitle ?? "").slice(0, MAX_TITLE),
      start,
      end,
      quote,
      String(body.prefix ?? "").slice(0, MAX_CONTEXT),
      String(body.suffix ?? "").slice(0, MAX_CONTEXT),
      String(body.comment ?? "").slice(0, MAX_COMMENT),
      pickColor(body.color),
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO annotations (id, book_id, type, chapter_index, chapter_title, start_offset, end_offset,
         quote, prefix, suffix, comment, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      bookId,
      type,
      chapterIndex,
      String(body.chapterTitle ?? "").slice(0, MAX_TITLE),
      start,
      end,
      quote,
      String(body.prefix ?? "").slice(0, MAX_CONTEXT),
      String(body.suffix ?? "").slice(0, MAX_CONTEXT),
      String(body.comment ?? "").slice(0, MAX_COMMENT),
      pickColor(body.color),
    );
  }
  const item = getAnnotation(bookId, id);
  if (!item) return { ok: false, status: 500, body: { error: "write_failed", message: "标注写入失败" } };
  return { ok: true, item };
}

/** 只改批注 / 颜色 / 类型；位置与引文不动（改位置等于换一条标注）。 */
export function patchAnnotation(bookId: number, id: string, body: AnnotationInput): AnnotationResult {
  const current = getAnnotation(bookId, id);
  if (!current) return { ok: false, status: 404, body: { error: "not_found", message: "标注不存在" } };
  getDb()
    .prepare(
      `UPDATE annotations SET comment = ?, color = ?, type = ?, updated_at = datetime('now')
       WHERE book_id = ? AND id = ?`,
    )
    .run(
      body.comment === undefined ? current.comment : String(body.comment).slice(0, MAX_COMMENT),
      body.color === undefined ? current.color : pickColor(body.color),
      body.type === undefined ? current.type : pickType(body.type),
      bookId,
      id,
    );
  const item = getAnnotation(bookId, id);
  if (!item) return { ok: false, status: 500, body: { error: "write_failed", message: "标注写入失败" } };
  return { ok: true, item };
}

/** 墓碑删除：保留行，删除过的标注不会被离线设备重新写回来。 */
export function removeAnnotation(bookId: number, id: string): boolean {
  const info = getDb()
    .prepare("UPDATE annotations SET deleted = 1, updated_at = datetime('now') WHERE book_id = ? AND id = ? AND deleted = 0")
    .run(bookId, id);
  return info.changes > 0;
}

export function countAnnotations(bookId: number): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM annotations WHERE book_id = ? AND deleted = 0").get(bookId) as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}

export interface NoteQuery {
  q?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

/**
 * 跨书笔记列表（笔记中心用）。
 *
 * 搜索走 instr(lower(...)) 而不是 LIKE：LIKE 里的 % 与 _ 是通配符，
 * 用户搜「100%」时会把整库都匹配出来，转义又容易和 SQL 的 ESCAPE 打架。
 */
export function listNotes(query: NoteQuery = {}): { total: number; items: NoteItem[] } {
  const db = getDb();
  const term = String(query.q ?? "").trim().toLowerCase();
  const type = (ANNOTATION_TYPES as readonly string[]).includes(String(query.type ?? "")) ? String(query.type) : "";
  const limit = Math.min(200, Math.max(1, Math.floor(Number(query.limit ?? 50)) || 50));
  const offset = Math.max(0, Math.floor(Number(query.offset ?? 0)) || 0);
  const where = `a.deleted = 0
    AND (? = '' OR instr(lower(a.quote), ?) > 0 OR instr(lower(a.comment), ?) > 0
         OR instr(lower(a.chapter_title), ?) > 0 OR instr(lower(b.name), ?) > 0)
    AND (? = '' OR a.type = ?)`;
  const params = [term, term, term, term, term, type, type];

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM annotations a JOIN books b ON b.id = a.book_id WHERE ${where}`)
    .get(...params) as { n: number } | undefined;
  const rows = db
    .prepare(
      `SELECT a.id, a.book_id, a.type, a.chapter_index, a.chapter_title, a.start_offset, a.end_offset,
          a.quote, a.prefix, a.suffix, a.comment, a.color, a.created_at, a.updated_at,
          b.name AS book_name, b.author AS book_author, b.cover_url AS book_cover
         FROM annotations a JOIN books b ON b.id = a.book_id
        WHERE ${where}
        ORDER BY a.updated_at DESC, a.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  return {
    total: Number(countRow?.n ?? 0),
    items: rows.map((row) => ({
      ...rowToItem(row),
      bookName: String(row.book_name ?? ""),
      bookAuthor: String(row.book_author ?? ""),
      bookCover: String(row.book_cover ?? ""),
    })),
  };
}
