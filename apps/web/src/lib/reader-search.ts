/**
 * 阅读页搜索的纯函数：把「这一章里哪几处命中」算成字符区间。
 *
 * 和划线共用一套坐标（章节内字符偏移），所以命中可以直接交给 ChapterSection
 * 的切片逻辑渲染成 <mark>，不需要给文字包 span、也不用量像素。
 */
import type { AnnotationRange } from "./annotations";
import { paragraphAt } from "./reader-progress";

export interface SearchMatch {
  /** 章节内起始偏移（含）。 */
  start: number;
  /** 章节内结束偏移（不含）。 */
  end: number;
  /** 命中落在第几段，用于「第 N 段」这类提示。 */
  para: number;
  /** 命中前后的上下文，空白折叠成单空格。 */
  excerpt: string;
}

/** 搜索词归一化：全角空格与换行都当空白，折叠成一个空格。 */
export function normalizeQuery(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/** 截取命中前后各 radius 个字符；被截断的一侧加省略号。 */
export function excerptAround(text: string, start: number, end: number, radius = 18): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const body = text.slice(from, to).replace(/\s+/g, " ").trim();
  return (from > 0 ? "…" : "") + body + (to < text.length ? "…" : "");
}

/**
 * 在整章正文里找所有命中。
 *
 * 用 indexOf 而不是正则：搜索词里可能有 . * ( 这类字符，转义漏一处就会静默搜不到。
 * 大小写不敏感只对拉丁字母有意义，中文不受影响。
 */
export function findMatches(text: string, starts: number[], query: string, limit = 300): SearchMatch[] {
  const needle = normalizeQuery(query);
  if (!needle || !text) return [];
  const hay = text.toLowerCase();
  const low = needle.toLowerCase();
  const out: SearchMatch[] = [];
  let at = hay.indexOf(low);
  while (at >= 0 && out.length < limit) {
    const end = at + needle.length;
    out.push({ start: at, end, para: paragraphAt(starts, at), excerpt: excerptAround(text, at, end) });
    at = hay.indexOf(low, at + Math.max(1, needle.length));
  }
  return out;
}

/** 把命中转成可渲染的区间；active 那一条换一个颜色，方便看清「上一处 / 下一处」跳到哪。 */
export function hitRanges(matches: SearchMatch[], active: number): AnnotationRange[] {
  return matches.map((match, i) => ({
    id: "hit-" + i,
    start: match.start,
    end: match.end,
    color: i === active ? "hit-on" : "hit",
  }));
}

/** 单条命中（全书搜索点进来时只高亮这一处）。 */
export function singleRange(start: number, length: number): AnnotationRange[] {
  if (!Number.isFinite(start) || start < 0 || length <= 0) return [];
  return [{ id: "hit-on", start, end: start + length, color: "hit-on" }];
}

/** 章节标题里也命中时，列表里给个「章名命中」的标记。 */
export function titleMatched(title: string, query: string): boolean {
  const needle = normalizeQuery(query).toLowerCase();
  return Boolean(needle) && String(title ?? "").toLowerCase().includes(needle);
}
