/**
 * 划线 / 笔记的纯函数：定位、切片、重定位、导出。
 *
 * 坐标只有一种：**章节内字符偏移**，和阅读进度用的 charOffset 完全一致
 * （段落起点表由 reader-progress 的 buildStarts 生成，段落之间用 1 个字符分隔）。
 * 这样「读到哪」和「划到哪」共用一套数字，不需要在页/列/像素之间换算。
 */

export interface AnnotationRange {
  id: string;
  start: number;
  end: number;
  color: string;
}

export interface TextSegment {
  text: string;
  mark: { id: string; color: string } | null;
}

export interface AnnotationAnchor {
  start: number;
  end: number;
  quote: string;
  prefix?: string;
  suffix?: string;
}

/** 排序并丢掉空区间/负数：同一段文本上的多条划线按 start 决定谁先切。 */
export function normalizeRanges(ranges: AnnotationRange[]): AnnotationRange[] {
  return ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ ...r, start: Math.max(0, Math.floor(r.start)), end: Math.max(0, Math.floor(r.end)) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

/**
 * 把一段正文按落在它上面的划线切成若干片，**拼接结果必须等于原文**。
 * 重叠时先开始的那条赢（后开始的重叠部分并入前一条），保证不会出现嵌套的 mark。
 */
export function paragraphSegments(text: string, paraStart: number, ranges: AnnotationRange[]): TextSegment[] {
  const paraEnd = paraStart + text.length;
  const hits = normalizeRanges(ranges)
    .map((r) => ({ ...r, from: Math.max(paraStart, r.start), to: Math.min(paraEnd, r.end) }))
    .filter((r) => r.to > r.from);
  if (!text) return [];
  if (!hits.length) return [{ text, mark: null }];
  const out: TextSegment[] = [];
  let cursor = paraStart;
  for (const hit of hits) {
    const from = Math.max(cursor, hit.from);
    if (from > cursor) out.push({ text: text.slice(cursor - paraStart, from - paraStart), mark: null });
    if (hit.to > from) {
      out.push({ text: text.slice(from - paraStart, hit.to - paraStart), mark: { id: hit.id, color: hit.color } });
      cursor = hit.to;
    }
  }
  if (cursor < paraEnd) out.push({ text: text.slice(cursor - paraStart), mark: null });
  return out.filter((segment) => segment.text.length > 0);
}

/** 段落内偏移 → 章节内偏移。 */
export function charOffsetOf(starts: number[], para: number, offsetInPara: number): number {
  const base = starts[Math.max(0, Math.min(starts.length - 1, para))] ?? 0;
  return base + Math.max(0, Math.round(offsetInPara));
}

/** 章节内偏移 → 段落与段落内偏移（二分，段落数上千也不慢）。 */
export function locateOffset(starts: number[], offset: number): { para: number; offset: number } {
  if (!starts.length) return { para: 0, offset: 0 };
  const target = Math.max(0, Math.round(offset));
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((starts[mid] ?? 0) <= target) lo = mid;
    else hi = mid - 1;
  }
  return { para: lo, offset: Math.max(0, target - (starts[lo] ?? 0)) };
}

/** 选中一段文本时顺手记下上下文，供正文变动后重定位。 */
export function quoteAround(
  text: string,
  start: number,
  end: number,
  context = 20,
): { quote: string; prefix: string; suffix: string } {
  const s = Math.max(0, Math.min(text.length, Math.floor(start)));
  const e = Math.max(s, Math.min(text.length, Math.floor(end)));
  return {
    quote: text.slice(s, e).slice(0, 400),
    prefix: text.slice(Math.max(0, s - context), s),
    suffix: text.slice(e, Math.min(text.length, e + context)),
  };
}

/**
 * 把标注重新贴回正文：先信偏移，偏移处的引文对不上就用 prefix+quote+suffix 找唯一位置，
 * 再退到「全文唯一出现的引文」。**歧义时返回 null**——宁可这条划线暂时不显示，
 * 也不能把它挪到别的句子上。
 */
export function matchAnnotation(text: string, anchor: AnnotationAnchor): { start: number; end: number } | null {
  const quote = anchor.quote ?? "";
  if (!quote) return null;
  if (anchor.start >= 0 && anchor.end <= text.length && text.slice(anchor.start, anchor.end) === quote) {
    return { start: anchor.start, end: anchor.end };
  }
  const prefix = anchor.prefix ?? "";
  const suffix = anchor.suffix ?? "";
  if (prefix || suffix) {
    const needle = prefix + quote + suffix;
    const at = text.indexOf(needle);
    if (at >= 0 && text.indexOf(needle, at + 1) < 0) {
      return { start: at + prefix.length, end: at + prefix.length + quote.length };
    }
  }
  const first = text.indexOf(quote);
  if (first >= 0 && text.indexOf(quote, first + 1) < 0) {
    return { start: first, end: first + quote.length };
  }
  return null;
}

export interface AnnotationExportItem {
  chapterIndex: number;
  chapterTitle: string;
  quote: string;
  comment: string;
  type: string;
}

/** 导出 Markdown：按章分组，摘录用引用块，批注挂在摘录下面。 */
export function annotationsMarkdown(bookName: string, items: AnnotationExportItem[]): string {
  const title = (bookName || "未命名").trim();
  if (!items.length) return "# 《" + title + "》\n\n> 还没有划线与笔记。\n";
  const groups = new Map<number, AnnotationExportItem[]>();
  for (const item of items) {
    const key = Math.max(0, Math.floor(item.chapterIndex));
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  const lines: string[] = ["# 《" + title + "》划线笔记", "", "> 共 " + items.length + " 条 · 导出自 legado-web", ""];
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const bucket = groups.get(key) ?? [];
    const chapterTitle = bucket[0]?.chapterTitle?.trim() || "第 " + (key + 1) + " 章";
    lines.push("## " + chapterTitle, "");
    for (const item of bucket) {
      const quote = item.quote.trim();
      if (quote) lines.push("> " + quote.replace(/\n+/g, " "), "");
      const comment = item.comment.trim();
      if (comment) lines.push(comment.replace(/\n+/g, " "), "");
      if (!quote && !comment) lines.push("（第 " + (key + 1) + " 章书签）", "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

