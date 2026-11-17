/**
 * 书籍详情页目录搜索的纯函数。
 *
 * 详情页一次只渲染 300 行（「显示更多」再追加），千章的书靠滚动找一章很费劲；
 * 这里只做标题匹配与截断，渲染仍交给 BookPage，方便在 vitest 里直接断言。
 */
import { normalizeQuery } from "./reader-search";

export interface TocSearchResult<T> {
  /** 截断后的命中项。 */
  items: T[];
  /** 命中总数（截断前）。 */
  matched: number;
  /** 命中数超过 limit。 */
  truncated: boolean;
}

/**
 * 按章节标题搜索；query 为空时返回空结果，调用方继续用原来的分页列表。
 * limit 至少为 1，避免传 0 时把「有命中」误判成「没命中」。
 */
export function searchToc<T extends { title: string }>(items: T[], query: string, limit = 300): TocSearchResult<T> {
  const needle = normalizeQuery(query).toLowerCase();
  if (!needle) return { items: [], matched: 0, truncated: false };
  const matched = items.filter((item) => String(item.title ?? "").toLowerCase().includes(needle));
  const raw = Number(limit);
  const max = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 300;
  return {
    items: matched.slice(0, max),
    matched: matched.length,
    truncated: matched.length > max,
  };
}
