import type { SwitchAnchorPayload } from "@legado/shared";
import type { DB } from "../../db/index.js";

/**
 * 换源锚点：换源前读者读到的那一句。
 *
 * 客户端原本把锚点存在 sessionStorage，换源整页重载后还能用；但换一台设备就丢了。
 * 服务端按书存一份，任何设备打开同一本书都能把锚点取回来。锚点只保留 24 小时：
 * 它描述的是「旧源正文里的位置」，放久了正文早被读者读过去了，再贴回去反而添乱。
 */
export const SWITCH_ANCHOR_TTL_HOURS = 24;
const MAX_QUOTE = 400;
const MAX_CONTEXT = 80;
const MAX_TITLE = 120;
const MAX_OFFSET = 10_000_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** 只接受带引文的锚点：没有 quote 就无法在新源里重新定位。 */
export function normalizeSwitchAnchor(input: unknown): SwitchAnchorPayload | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const quote = text(raw.quote, MAX_QUOTE);
  if (!quote) return null;
  return {
    chapterIndex: clamp(count(raw.chapterIndex), 0, MAX_OFFSET),
    chapterTitle: text(raw.chapterTitle, MAX_TITLE),
    charOffset: clamp(count(raw.charOffset), 0, MAX_OFFSET),
    chapterPercent: clamp(Number.isFinite(Number(raw.chapterPercent)) ? Number(raw.chapterPercent) : 0, 0, 1),
    quote,
    prefix: text(raw.prefix, MAX_CONTEXT),
    suffix: text(raw.suffix, MAX_CONTEXT),
    quoteStart: clamp(count(raw.quoteStart), 0, MAX_OFFSET),
  };
}

/**
 * 落库。传 null/坏锚点会清掉旧锚点：一次没有锚点的换源之后，不应该还留着上一次的旧句子。
 * target 是换源后实际落到的章：旧锚点的 chapterIndex 是旧目录的编号，不能直接拿来用。
 */
export function saveSwitchAnchor(
  db: DB,
  bookId: number,
  input: unknown,
  target?: { index: number; title: string },
): SwitchAnchorPayload | null {
  const anchor = normalizeSwitchAnchor(input);
  if (!anchor) {
    clearSwitchAnchor(db, bookId);
    return null;
  }
  if (target) {
    anchor.chapterIndex = clamp(Math.round(target.index), 0, MAX_OFFSET);
    anchor.chapterTitle = text(target.title, MAX_TITLE);
  }
  db.prepare(
    `INSERT INTO switch_anchors (book_id, chapter_index, chapter_title, char_offset, chapter_percent, quote, prefix, suffix, quote_start, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(book_id) DO UPDATE SET
       chapter_index = excluded.chapter_index,
       chapter_title = excluded.chapter_title,
       char_offset = excluded.char_offset,
       chapter_percent = excluded.chapter_percent,
       quote = excluded.quote,
       prefix = excluded.prefix,
       suffix = excluded.suffix,
       quote_start = excluded.quote_start,
       created_at = datetime('now')`,
  ).run(
    bookId,
    anchor.chapterIndex,
    anchor.chapterTitle,
    anchor.charOffset,
    anchor.chapterPercent,
    anchor.quote,
    anchor.prefix,
    anchor.suffix,
    anchor.quoteStart,
  );
  return anchor;
}

interface SwitchAnchorRow {
  chapter_index: number;
  chapter_title: string;
  char_offset: number;
  chapter_percent: number;
  quote: string;
  prefix: string;
  suffix: string;
  quote_start: number;
}

/** 读当前书仍然有效的锚点；过期的不返回（但保留到下一次换源覆盖）。 */
export function readSwitchAnchor(db: DB, bookId: number): SwitchAnchorPayload | null {
  const row = db
    .prepare(
      `SELECT chapter_index, chapter_title, char_offset, chapter_percent, quote, prefix, suffix, quote_start
         FROM switch_anchors
        WHERE book_id = ? AND created_at >= datetime('now', ?)`,
    )
    .get(bookId, `-${SWITCH_ANCHOR_TTL_HOURS} hours`) as SwitchAnchorRow | undefined;
  if (!row) return null;
  return {
    chapterIndex: Number(row.chapter_index ?? 0),
    chapterTitle: String(row.chapter_title ?? ""),
    charOffset: Number(row.char_offset ?? 0),
    chapterPercent: Number(row.chapter_percent ?? 0),
    quote: String(row.quote ?? ""),
    prefix: String(row.prefix ?? ""),
    suffix: String(row.suffix ?? ""),
    quoteStart: Number(row.quote_start ?? 0),
  };
}

export function clearSwitchAnchor(db: DB, bookId: number): void {
  db.prepare("DELETE FROM switch_anchors WHERE book_id = ?").run(bookId);
}
