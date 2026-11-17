/**
 * 全书搜索的文本匹配：纯函数，和数据库/抓取分开，方便单测。
 */

const EXCERPT_RADIUS = 26;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function excerptAt(text: string, at: number, length: number): string {
  const from = Math.max(0, at - EXCERPT_RADIUS);
  const to = Math.min(text.length, at + length + EXCERPT_RADIUS);
  return (from > 0 ? "…" : "") + collapse(text.slice(from, to)) + (to < text.length ? "…" : "");
}

export interface ChapterScan {
  /** 本章命中次数（数到 limitPerChapter 就停）。 */
  count: number;
  /** 第一处命中的字符偏移。 */
  offset: number;
  excerpt: string;
}

/** 数本章命中；搜索词按字面量比较（不转正则，避免 . * 这类字符把匹配打偏）。 */
export function scanChapter(text: string, query: string, limitPerChapter = 5): ChapterScan | null {
  const needle = query.trim();
  if (!needle || !text) return null;
  const hay = text.toLowerCase();
  const low = needle.toLowerCase();
  let at = hay.indexOf(low);
  if (at < 0) return null;
  const offset = at;
  let count = 0;
  while (at >= 0 && count < limitPerChapter) {
    count += 1;
    at = hay.indexOf(low, at + Math.max(1, needle.length));
  }
  return { count, offset, excerpt: excerptAt(text, offset, needle.length) };
}
