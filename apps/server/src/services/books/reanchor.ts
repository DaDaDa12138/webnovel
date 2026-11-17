import { matchChapter } from "@legado/engine";
import type { ReanchorFailure, ReanchorFailureReason, SwitchReanchor, SwitchReanchorCount } from "@legado/shared";
import { getDb, type DB } from "../../db/index.js";
import { fetchChapterContentWithImages } from "../engine.js";

/**
 * 换源 3.0：把标注与书签从旧源「搬」到新源。
 *
 * 章节号在换源后没有任何意义（镜像站会少广告章、合并分卷），所以位置必须重新按
 * 文本找：标注用 quote（前 400 字）做锚，书签用 excerpt（前 80–200 字）做锚。
 * 找不到就老实记 failed，绝不把标注硬塞到同章号的另一段——那比丢位置更糟。
 */
const MAX_ITEMS = 200;
const MAX_FETCH_CHAPTERS = 12;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const REANCHOR_BUDGET_MS = 8_000;
const NAME_EVIDENCE = new Set(["exact", "core", "cleaned", "similar"]);

export interface SnapshotAnnotation {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface SnapshotBookmark {
  id: number;
  chapterIndex: number;
  title: string;
  excerpt: string;
  charOffset: number;
}

export interface ReanchorSnapshot {
  version: 1;
  at: string;
  chapters: Array<{ index: number; title: string }>;
  annotations: SnapshotAnnotation[];
  bookmarks: SnapshotBookmark[];
  /** 超过 200 条时只存前 200 条；重贴报告会标 partial。 */
  truncated?: boolean;
}

export interface ReanchorApplied {
  annotations: number;
  bookmarks: number;
}

/** 与阅读页 splitParagraphs 完全一致：标注 offset 的坐标系就是这段文本。 */
export function chapterDisplayText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export interface QuoteMatch {
  start: number;
  end: number;
  score: number;
  candidates: number;
  /** 多个同分候选且附近没有唯一解：调用方应记 failed，不要赌。 */
  ambiguous: boolean;
}

interface Compact {
  text: string;
  map: number[];
}

/** 去掉所有空白但保留「紧凑串第 i 个字 → 原文第 map[i] 个字」的映射。 */
function compactWithMap(text: string): Compact {
  let compact = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (/\s/.test(ch)) continue;
    compact += ch;
    map.push(i);
  }
  return { text: compact, map };
}

/**
 * 在章节文本里找 quote。先按整段匹配，整段太长时用前 80 字做探针；
 * expectedRatio 是旧位置在旧章里的相对位置，用来在多处重复时选最接近的一处。
 */
export function locateQuote(text: string, quote: string, expectedRatio = 0): QuoteMatch | null {
  const source = String(text ?? "");
  const wantedRaw = String(quote ?? "").replace(/\s+/g, " ").trim();
  if (!source || !wantedRaw) return null;
  const wanted = compactWithMap(wantedRaw).text;
  if (wanted.length < 2) return null;
  const { text: haystack, map } = compactWithMap(source);
  const probe = wanted.slice(0, Math.min(80, wanted.length));
  const hits: number[] = [];
  let from = 0;
  while (hits.length < 60) {
    const at = haystack.indexOf(probe, from);
    if (at < 0) break;
    hits.push(at);
    from = at + Math.max(1, probe.length);
  }
  if (!hits.length) return null;
  const target = Math.max(0, Math.min(1, Number(expectedRatio) || 0)) * Math.max(1, haystack.length);
  let best: { at: number; score: number; end: number } | null = null;
  for (const at of hits) {
    const full = haystack.startsWith(wanted, at);
    const score = full ? 1 : probe.length >= 24 ? 0.78 : 0.55;
    const endCompact = full ? at + wanted.length : Math.min(haystack.length, at + probe.length);
    const start = map[at] ?? 0;
    const end = endCompact > at ? (map[endCompact - 1] ?? start) + 1 : start + probe.length;
    const distance = Math.abs(at - target);
    if (!best || score > best.score + 1e-6 || (Math.abs(score - best.score) <= 1e-6 && distance < Math.abs(best.at - target))) {
      best = { at, score, end };
    }
  }
  if (!best) return null;
  const bestDistance = Math.abs(best.at - target) / Math.max(1, haystack.length);
  const sameScore = hits.filter((at) => {
    const full = haystack.startsWith(wanted, at);
    return full === (best!.score === 1);
  }).length;
  // 短引文重复出现时，即使每处都「整段命中」也无法确定是哪一处；
  // 长引文才允许按 expectedRatio 选最近的一处。
  const shortRepeated = wanted.length < 8 && hits.length > 1;
  return {
    start: map[best.at] ?? 0,
    end: best.end,
    score: best.score,
    candidates: hits.length,
    ambiguous: shortRepeated || (best.score < 0.9 && (hits.length > 2 || bestDistance > 0.35) && sameScore > 2),
  };
}

export interface QuoteCandidate {
  start: number;
  end: number;
  score: number;
  /** 前后各约 60 字，够用户在面板里认出是哪一段。 */
  context: string;
}

/**
 * 手动定位用：把 quote 在正文里的所有命中都列出来（最多 limit 条）。
 * 与 locateQuote 不同，这里不替用户做「唯一解」判断，歧义时全部展示。
 */
export function findQuoteCandidates(text: string, quote: string, limit = 8): QuoteCandidate[] {
  const source = String(text ?? "");
  const wantedRaw = String(quote ?? "").replace(/\s+/g, " ").trim();
  if (!source || !wantedRaw) return [];
  const wanted = compactWithMap(wantedRaw).text;
  if (wanted.length < 2) return [];
  const { text: haystack, map } = compactWithMap(source);
  const probe = wanted.slice(0, Math.min(80, wanted.length));
  const hits: number[] = [];
  let from = 0;
  while (hits.length < 60) {
    const at = haystack.indexOf(probe, from);
    if (at < 0) break;
    hits.push(at);
    from = at + Math.max(1, probe.length);
  }
  const out: QuoteCandidate[] = [];
  for (const at of hits) {
    if (out.length >= Math.max(1, Math.min(20, limit))) break;
    const full = haystack.startsWith(wanted, at);
    const endCompact = full ? at + wanted.length : Math.min(haystack.length, at + probe.length);
    const start = map[at] ?? 0;
    const end = endCompact > at ? (map[endCompact - 1] ?? start) + 1 : start + probe.length;
    const context = source.slice(Math.max(0, start - 60), Math.min(source.length, end + 60)).replace(/\s+/g, " ").trim();
    out.push({ start, end, score: full ? 1 : probe.length >= 24 ? 0.78 : 0.55, context });
  }
  return out;
}

interface ChapterRow {
  idx: number;
  title: string;
  url: string;
}

function readLatestSnapshot(bookId: number): ReanchorSnapshot | null {
  const db = getDb();
  const row = db
    .prepare("SELECT reanchor_snapshot FROM switch_history WHERE book_id = ? ORDER BY id DESC LIMIT 1")
    .get(bookId) as { reanchor_snapshot?: string | null } | undefined;
  return parseReanchorSnapshot(row?.reanchor_snapshot);
}

function findSnapshotItem(snapshot: ReanchorSnapshot, kind: "annotation" | "bookmark", id: string | number): SnapshotAnnotation | SnapshotBookmark | null {
  if (kind === "annotation") return snapshot.annotations.find((item) => String(item.id) === String(id)) ?? null;
  return snapshot.bookmarks.find((item) => String(item.id) === String(id)) ?? null;
}

export class ReanchorLocateError extends Error {
  constructor(
    readonly code: "no_snapshot" | "item_not_found" | "chapter_not_found" | "no_source" | "chapter_fetch",
    message: string,
  ) {
    super(message);
    this.name = "ReanchorLocateError";
  }
}

export interface ReanchorLocateResult {
  kind: "annotation" | "bookmark";
  id: string | number;
  chapterIndex: number;
  chapterTitle: string;
  quote: string;
  /** 章节名能可靠对上时的目标章；对不上时前端让用户从 chapters 里选。 */
  targetChapterIndex: number | null;
  targetChapterTitle: string | null;
  candidates: QuoteCandidate[];
  chapters: Array<{ index: number; title: string }>;
  textLength: number;
}

/**
 * 手动定位第一步：根据最近一次换源快照，把某条标注/书签的引文在新源目标章里
 * 的所有命中列出来。用户选定后再调用 applyManualReanchor 写回。
 */
export async function locateReanchorItem(
  bookId: number,
  kind: "annotation" | "bookmark",
  id: string | number,
  overrideChapter?: number,
): Promise<ReanchorLocateResult> {
  const snapshot = readLatestSnapshot(bookId);
  if (!snapshot) throw new ReanchorLocateError("no_snapshot", "没有可用的换源快照");
  const item = findSnapshotItem(snapshot, kind, id);
  if (!item) throw new ReanchorLocateError("item_not_found", "这条标注/书签不在最近一次换源快照里");
  const db = getDb();
  const book = db.prepare("SELECT source_id, book_url FROM books WHERE id = ?").get(bookId) as
    | { source_id: number | null; book_url: string }
    | undefined;
  if (!book?.source_id) throw new ReanchorLocateError("no_source", "书籍没有可用书源");
  const rows = db.prepare("SELECT idx, title, url FROM chapters WHERE book_id = ? ORDER BY idx ASC").all(bookId) as ChapterRow[];
  if (!rows.length) throw new ReanchorLocateError("chapter_not_found", "书籍目录为空");

  let target: number | null = null;
  if (overrideChapter !== undefined && Number.isInteger(overrideChapter)) {
    if (!rows[overrideChapter]) throw new ReanchorLocateError("chapter_not_found", "目标章节不存在");
    target = overrideChapter;
  } else {
    const match = matchChapter(rows, "chapterTitle" in item ? item.chapterTitle : item.title, item.chapterIndex, snapshot.chapters.length);
    if (NAME_EVIDENCE.has(match.reason)) target = match.index;
  }

  const chapters = rows.map((row) => ({ index: Number(row.idx), title: String(row.title ?? "") }));
  const quote = "quote" in item ? item.quote : item.excerpt;
  if (target === null) {
    return {
      kind,
      id: item.id,
      chapterIndex: item.chapterIndex,
      chapterTitle: "chapterTitle" in item ? item.chapterTitle : item.title,
      quote,
      targetChapterIndex: null,
      targetChapterTitle: null,
      candidates: [],
      chapters,
      textLength: 0,
    };
  }

  const chapter = rows[target];
  let text = "";
  try {
    const fetched = await Promise.race([
      fetchChapterContentWithImages(Number(book.source_id), chapter.url, String(book.book_url ?? "")),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("locate timeout")), 6_000)),
    ]);
    text = chapterDisplayText(fetched.text);
  } catch {
    throw new ReanchorLocateError("chapter_fetch", "抓取目标章节失败，稍后再试");
  }
  return {
    kind,
    id: item.id,
    chapterIndex: item.chapterIndex,
    chapterTitle: "chapterTitle" in item ? item.chapterTitle : item.title,
    quote,
    targetChapterIndex: target,
    targetChapterTitle: String(chapter.title ?? ""),
    candidates: findQuoteCandidates(text, quote),
    chapters,
    textLength: text.length,
  };
}

export interface ManualReanchorApplied {
  kind: "annotation" | "bookmark";
  id: string | number;
  chapterIndex: number;
  chapterTitle: string;
  start: number;
  end: number;
}

/** 手动定位第二步：把用户选中的位置写回标注/书签，并用新正文生成前后缀。 */
export async function applyManualReanchor(
  bookId: number,
  kind: "annotation" | "bookmark",
  id: string | number,
  chapterIndex: number,
  start: number,
  end: number,
): Promise<ManualReanchorApplied> {
  if (!Number.isInteger(chapterIndex) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    throw new ReanchorLocateError("chapter_not_found", "位置参数不合法");
  }
  const db = getDb();
  const book = db.prepare("SELECT source_id, book_url FROM books WHERE id = ?").get(bookId) as
    | { source_id: number | null; book_url: string }
    | undefined;
  if (!book?.source_id) throw new ReanchorLocateError("no_source", "书籍没有可用书源");
  const chapter = db.prepare("SELECT idx, title, url FROM chapters WHERE book_id = ? AND idx = ?").get(bookId, chapterIndex) as ChapterRow | undefined;
  if (!chapter) throw new ReanchorLocateError("chapter_not_found", "目标章节不存在");
  let text = "";
  try {
    const fetched = await Promise.race([
      fetchChapterContentWithImages(Number(book.source_id), chapter.url, String(book.book_url ?? "")),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("apply timeout")), 6_000)),
    ]);
    text = chapterDisplayText(fetched.text);
  } catch {
    throw new ReanchorLocateError("chapter_fetch", "抓取目标章节失败，稍后再试");
  }
  if (end > text.length || !text.slice(start, end).trim()) {
    throw new ReanchorLocateError("chapter_not_found", "选中的位置超出本章正文范围");
  }
  const prefix = text.slice(Math.max(0, start - 40), start);
  const suffix = text.slice(end, Math.min(text.length, end + 40));
  const title = String(chapter.title ?? "").slice(0, 200);
  if (kind === "annotation") {
    const info = db
      .prepare(
        "UPDATE annotations SET chapter_index = ?, chapter_title = ?, start_offset = ?, end_offset = ?, prefix = ?, suffix = ?, updated_at = datetime('now') " +
          "WHERE book_id = ? AND id = ? AND deleted = 0",
      )
      .run(chapterIndex, title, start, end, prefix.slice(0, 40), suffix.slice(0, 40), bookId, id);
    if (!info.changes) throw new ReanchorLocateError("item_not_found", "标注不存在或已删除");
  } else {
    const info = db
      .prepare(
        "UPDATE bookmarks SET chapter_index = ?, chapter_id = (SELECT id FROM chapters WHERE book_id = ? AND idx = ?), title = ?, char_offset = ? " +
          "WHERE book_id = ? AND id = ?",
      )
      .run(chapterIndex, bookId, chapterIndex, title, start, bookId, id);
    if (!info.changes) throw new ReanchorLocateError("item_not_found", "书签不存在");
  }
  return { kind, id, chapterIndex, chapterTitle: title, start, end };
}

/** 换源前采集快照。只有标注/书签为 0 的书返回 null，历史表不必存空 JSON。 */
export function captureReanchorSnapshot(bookId: number, db: DB = getDb()): ReanchorSnapshot | null {
  const annotations = db
    .prepare(
      `SELECT id, chapter_index, chapter_title, start_offset, end_offset, quote, prefix, suffix
         FROM annotations WHERE book_id = ? AND deleted = 0 AND length(trim(quote)) > 0
         ORDER BY chapter_index ASC, start_offset ASC, id ASC`,
    )
    .all(bookId) as Array<Record<string, unknown>>;
  const bookmarks = db
    .prepare(
      `SELECT id, chapter_index, title, excerpt, char_offset
         FROM bookmarks WHERE book_id = ? ORDER BY chapter_index ASC, char_offset ASC, id ASC`,
    )
    .all(bookId) as Array<Record<string, unknown>>;
  if (!annotations.length && !bookmarks.length) return null;
  const chapters = db.prepare("SELECT idx, title FROM chapters WHERE book_id = ? ORDER BY idx ASC").all(bookId) as Array<{
    idx: number;
    title: string;
  }>;
  const snapshot: ReanchorSnapshot = {
    version: 1,
    at: new Date().toISOString(),
    chapters: chapters.map((row) => ({ index: Number(row.idx), title: String(row.title ?? "") })),
    annotations: annotations.slice(0, MAX_ITEMS).map((row) => ({
      id: String(row.id ?? ""),
      chapterIndex: Number(row.chapter_index ?? 0),
      chapterTitle: String(row.chapter_title ?? ""),
      start: Number(row.start_offset ?? 0),
      end: Number(row.end_offset ?? 0),
      quote: String(row.quote ?? ""),
      prefix: String(row.prefix ?? ""),
      suffix: String(row.suffix ?? ""),
    })),
    bookmarks: bookmarks.slice(0, MAX_ITEMS).map((row) => ({
      id: Number(row.id ?? 0),
      chapterIndex: Number(row.chapter_index ?? 0),
      title: String(row.title ?? ""),
      excerpt: String(row.excerpt ?? ""),
      charOffset: Number(row.char_offset ?? 0),
    })),
    truncated: annotations.length > MAX_ITEMS || bookmarks.length > MAX_ITEMS,
  };
  // 极端情况（每条 quote 都很长）仍可能超限：继续截断，宁可少搬几条也不能撑爆历史表。
  while (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_SNAPSHOT_BYTES) {
    if (snapshot.bookmarks.length > snapshot.annotations.length && snapshot.bookmarks.length > 20) snapshot.bookmarks.pop();
    else if (snapshot.annotations.length > 20) snapshot.annotations.pop();
    else break;
    snapshot.truncated = true;
  }
  return snapshot;
}

export function parseReanchorSnapshot(raw: string | null | undefined): ReanchorSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReanchorSnapshot>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.annotations) || !Array.isArray(parsed.bookmarks)) return null;
    return parsed as ReanchorSnapshot;
  } catch {
    return null;
  }
}

function emptyCount(): SwitchReanchorCount {
  return { total: 0, moved: 0, kept: 0, failed: 0 };
}

/**
 * 换源后重贴。只抓「有标注/书签命中」的章节，最多 12 章、8 秒；
 * 超预算记 partial，阅读页可以点重试继续（同一个快照幂等）。
 */
export async function reanchorAfterSwitch(
  bookId: number,
  snapshot: ReanchorSnapshot | null,
  budgetMs = REANCHOR_BUDGET_MS,
): Promise<SwitchReanchor> {
  const report: SwitchReanchor = {
    annotations: emptyCount(),
    bookmarks: emptyCount(),
    chaptersFetched: 0,
    partial: Boolean(snapshot?.truncated),
    ms: 0,
    failures: [],
  };
  if (!snapshot) return report;
  const failures = report.failures as ReanchorFailure[];
  const failItem = (
    kind: "annotation" | "bookmark",
    item: SnapshotAnnotation | SnapshotBookmark,
    reason: ReanchorFailureReason,
    mapped?: { index: number; title: string; reliable: boolean },
  ): void => {
    if (failures.length >= 80) return;
    failures.push({
      kind,
      id: item.id,
      chapterIndex: item.chapterIndex,
      chapterTitle: "chapterTitle" in item ? item.chapterTitle : item.title,
      quote: ("quote" in item ? item.quote : item.excerpt).slice(0, 220),
      reason,
      targetChapterIndex: mapped?.reliable ? mapped.index : undefined,
      targetChapterTitle: mapped?.reliable ? mapped.title : undefined,
    });
  };
  const started = Date.now();
  const db = getDb();
  const book = db.prepare("SELECT source_id, book_url FROM books WHERE id = ?").get(bookId) as
    | { source_id: number | null; book_url: string }
    | undefined;
  const rows = db.prepare("SELECT idx, title, url FROM chapters WHERE book_id = ? ORDER BY idx ASC").all(bookId) as Array<{
    idx: number;
    title: string;
    url: string;
  }>;
  if (!book || !rows.length) {
    report.annotations.failed = snapshot.annotations.length;
    report.bookmarks.failed = snapshot.bookmarks.length;
    report.partial = true;
    return report;
  }
  const sourceId = Number(book.source_id ?? 0);
  const oldTotal = snapshot.chapters.length;
  const oldTitle = (index: number, fallback: string): string =>
    fallback || String(snapshot.chapters.find((row) => row.index === index)?.title ?? "");
  const mapping = new Map<number, { index: number; title: string; reliable: boolean }>();
  for (const chapter of snapshot.chapters) {
    const match = matchChapter(rows, chapter.title, chapter.index, oldTotal);
    mapping.set(chapter.index, {
      index: match.index,
      title: String(rows[match.index]?.title ?? chapter.title),
      reliable: NAME_EVIDENCE.has(match.reason),
    });
  }
  const texts = new Map<number, string | null>();
  const fetchChapter = async (index: number): Promise<string | null> => {
    if (texts.has(index)) return texts.get(index) ?? null;
    if (!sourceId || !rows[index]?.url) return null;
    try {
      const fetched = await Promise.race([
        fetchChapterContentWithImages(sourceId, rows[index].url, String(book.book_url ?? "")),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("reanchor timeout")), 3_000)),
      ]);
      const text = chapterDisplayText(fetched.text);
      texts.set(index, text);
      report.chaptersFetched += 1;
      return text;
    } catch {
      texts.set(index, null);
      return null;
    }
  };

  const annotationUpdates: Array<{ id: string; index: number; title: string; start: number; end: number; prefix: string; suffix: string }> = [];
  for (const item of snapshot.annotations) {
    report.annotations.total += 1;
    if (Date.now() - started > budgetMs) {
      report.annotations.failed += 1;
      report.partial = true;
      failItem("annotation", item, "budget", mapping.get(item.chapterIndex));
      continue;
    }
    const mapped = mapping.get(item.chapterIndex);
    if (!mapped?.reliable || !item.quote.trim()) {
      report.annotations.failed += 1;
      failItem("annotation", item, "chapter_unmatched", mapped);
      continue;
    }
    if (report.chaptersFetched >= MAX_FETCH_CHAPTERS && !texts.has(mapped.index)) {
      report.annotations.failed += 1;
      report.partial = true;
      failItem("annotation", item, "chapter_limit", mapped);
      continue;
    }
    const text = await fetchChapter(mapped.index);
    if (!text) {
      report.annotations.failed += 1;
      failItem("annotation", item, "chapter_fetch", mapped);
      continue;
    }
    const found = locateQuote(text, item.quote, 0);
    if (!found || found.ambiguous) {
      report.annotations.failed += 1;
      failItem("annotation", item, found?.ambiguous ? "quote_ambiguous" : "quote_missing", mapped);
      continue;
    }
    const prefix = text.slice(Math.max(0, found.start - 40), found.start);
    const suffix = text.slice(found.end, Math.min(text.length, found.end + 40));
    annotationUpdates.push({
      id: item.id,
      index: mapped.index,
      title: mapped.title,
      start: found.start,
      end: found.end,
      prefix,
      suffix,
    });
    if (mapped.index === item.chapterIndex && found.start === item.start && found.end === item.end) report.annotations.kept += 1;
    else report.annotations.moved += 1;
  }

  const bookmarkUpdates: Array<{ id: number; index: number; title: string; charOffset: number }> = [];
  for (const item of snapshot.bookmarks) {
    report.bookmarks.total += 1;
    if (Date.now() - started > budgetMs) {
      report.bookmarks.failed += 1;
      report.partial = true;
      failItem("bookmark", item, "budget", mapping.get(item.chapterIndex));
      continue;
    }
    const mapped = mapping.get(item.chapterIndex);
    if (!mapped?.reliable) {
      report.bookmarks.failed += 1;
      failItem("bookmark", item, "chapter_unmatched", mapped);
      continue;
    }
    if (!item.excerpt.trim()) {
      // 没摘录的书签只知道它属于哪一章：章节能可靠对上就算「跟过去了」，位置归零。
      bookmarkUpdates.push({ id: item.id, index: mapped.index, title: mapped.title, charOffset: 0 });
      report.bookmarks.moved += 1;
      continue;
    }
    if (report.chaptersFetched >= MAX_FETCH_CHAPTERS && !texts.has(mapped.index)) {
      report.bookmarks.failed += 1;
      report.partial = true;
      failItem("bookmark", item, "chapter_limit", mapped);
      continue;
    }
    const text = await fetchChapter(mapped.index);
    if (!text) {
      report.bookmarks.failed += 1;
      failItem("bookmark", item, "chapter_fetch", mapped);
      continue;
    }
    const found = locateQuote(text, item.excerpt, 0);
    if (!found || found.ambiguous) {
      report.bookmarks.failed += 1;
      failItem("bookmark", item, found?.ambiguous ? "quote_ambiguous" : "quote_missing", mapped);
      continue;
    }
    bookmarkUpdates.push({ id: item.id, index: mapped.index, title: mapped.title, charOffset: found.start });
    if (mapped.index === item.chapterIndex && found.start === item.charOffset) report.bookmarks.kept += 1;
    else report.bookmarks.moved += 1;
  }

  const apply = db.transaction(() => {
    const updateAnnotation = db.prepare(
      `UPDATE annotations SET chapter_index = ?, chapter_title = ?, start_offset = ?, end_offset = ?, prefix = ?, suffix = ?, updated_at = datetime('now')
       WHERE book_id = ? AND id = ? AND deleted = 0`,
    );
    for (const item of annotationUpdates) {
      updateAnnotation.run(item.index, item.title.slice(0, 200), item.start, item.end, item.prefix.slice(0, 40), item.suffix.slice(0, 40), bookId, item.id);
    }
    const updateBookmark = db.prepare(
      `UPDATE bookmarks SET chapter_index = ?, chapter_id = (SELECT id FROM chapters WHERE book_id = ? AND idx = ?), title = ?, char_offset = ?
       WHERE book_id = ? AND id = ?`,
    );
    for (const item of bookmarkUpdates) updateBookmark.run(item.index, bookId, item.index, item.title.slice(0, 200), item.charOffset, bookId, item.id);
  });
  apply();
  report.ms = Date.now() - started;
  return report;
}

/** 撤销换源：用快照把标注/书签精确还原到换源前的位置（不再做文本猜测）。 */
export function applyReanchorSnapshot(bookId: number, snapshot: ReanchorSnapshot | null, db: DB = getDb()): ReanchorApplied {
  const applied: ReanchorApplied = { annotations: 0, bookmarks: 0 };
  if (!snapshot) return applied;
  db.transaction(() => {
    const updateAnnotation = db.prepare(
      `UPDATE annotations SET chapter_index = ?, chapter_title = ?, start_offset = ?, end_offset = ?, prefix = ?, suffix = ?, updated_at = datetime('now')
       WHERE book_id = ? AND id = ? AND deleted = 0`,
    );
    for (const item of snapshot.annotations) {
      const info = updateAnnotation.run(
        item.chapterIndex,
        item.chapterTitle.slice(0, 200),
        item.start,
        item.end,
        item.prefix.slice(0, 40),
        item.suffix.slice(0, 40),
        bookId,
        item.id,
      );
      applied.annotations += Number(info.changes);
    }
    const updateBookmark = db.prepare(
      `UPDATE bookmarks SET chapter_index = ?, chapter_id = (SELECT id FROM chapters WHERE book_id = ? AND idx = ?), title = ?, char_offset = ?
       WHERE book_id = ? AND id = ?`,
    );
    for (const item of snapshot.bookmarks) {
      const info = updateBookmark.run(
        item.chapterIndex,
        bookId,
        item.chapterIndex,
        item.title.slice(0, 200),
        item.charOffset,
        bookId,
        item.id,
      );
      applied.bookmarks += Number(info.changes);
    }
  })();
  return applied;
}
