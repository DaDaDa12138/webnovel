import type { SwitchCandidate } from "./switch.js";
import { getDb } from "../db/index.js";

/**
 * 换源候选缓存（两层）。
 *
 * 换源要横扫几百个书源：788 个源即使开 40 条并发也要一分钟。但「哪些源有这本书、
 * 目录多少章」和「读者正在看的这一章在对方站上多少字、章名对不对得上」是两件事：
 *
 * - 目录层（switch_candidates，按书）：几分钟内不会变，打开面板先展示上次结果；
 * - 章节层（switch_chapter_measures，按书 + 源 + 章节）：字符数和章名匹配只对那一章
 *   有效，换一章必须重测，否则面板会拿第 3 章的字数去比较第 40 章。
 *
 * 跳过规则同样分两层：书级的「查过、没有」永远可跳过；候选只有「这一章测过」才跳过，
 * 换了章节会把已有候选重新测一遍（而不是把整份目录再搜一遍）。
 */

/** 这些错误是「这次没测成」，不是「这个源不行」，不该缓存 30 分钟。 */
const TRANSIENT_MEASURE_ERROR = /超时|timeout|fetch failed|ECONNRESET|socket hang up|network|EAI_AGAIN/i;

export interface CachedSwitchCandidate extends SwitchCandidate {
  /** 这条结果是多少毫秒之前检测的（客户端显示「N 分钟前」）。 */
  ageMs: number;
  /** 这一章有没有测过（false 表示目录信息是缓存、字数需要重测）。 */
  measured?: boolean;
}

/**
 * 测字缓存的「版本号」。引擎修了取正文的 bug（0.24.1 的 ## 正则 / URL 选项）之后，
 * 旧缓存里那一批「Expected name, found ##…」会继续冒充失败 30 分钟——用户升级后
 * 看到的还是满屏「测字失败」。改一次 key 前缀，旧缓存自然失效，代价只是重测一轮。
 */
const MEASURE_KEY_VERSION = "v2";

/** 章节身份：优先用章名（目录错乱的站章号会漂），没有章名才退回序号。 */
export function chapterKey(index: number, title?: string): string {
  const name = String(title ?? "").replace(/\s+/g, "").trim();
  if (name) return MEASURE_KEY_VERSION + ":t:" + name;
  const idx = Number.isFinite(index) && index >= 0 ? Math.round(index) : 0;
  return MEASURE_KEY_VERSION + ":i:" + idx;
}

interface Row {
  source_id: number;
  book_url: string;
  toc_url: string;
  name: string;
  author: string;
  chapters: number;
  status: string;
  title_ok: number;
  author_ok: string;
  ms: number;
  checked_at: string;
  m_chars: number | null;
  m_chapter_title: string | null;
  m_matched: number | null;
  m_match_reason: string | null;
  m_match_score: number | null;
  m_error: string | null;
  m_ms: number | null;
  m_excerpt: string | null;
  m_preview: string | null;
  m_quality: string | null;
  m_quality_score: number | null;
  m_quality_reason: string | null;
  m_checked_at: string | null;
  source_health_state: string | null;
  source_health_score: number | null;
}

function parseUtc(value: string | null): number {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const iso = text.includes("T") ? text : text.replace(" ", "T") + "Z";
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}

function toCandidate(row: Row, sourceName: string, now: number): CachedSwitchCandidate {
  const checkedAt = parseUtc(row.checked_at);
  const candidate: CachedSwitchCandidate = {
    sourceId: row.source_id,
    sourceName,
    sourceStatus: "",
    sourceHealthState: (row.source_health_state as SwitchCandidate["sourceHealthState"]) ?? "unknown",
    sourceHealthScore: Number(row.source_health_score ?? 0),
    name: row.name,
    author: row.author,
    bookUrl: row.book_url,
    tocUrl: row.toc_url || undefined,
    coverUrl: "",
    kind: "",
    lastChapter: "",
    wordCount: "",
    duplicates: 1,
    status: (row.status === "ok" || row.status === "warn" || row.status === "fail" ? row.status : "pending") as SwitchCandidate["status"],
    chapters: row.chapters,
    ms: row.ms,
    titleOk: row.title_ok === 1,
    authorOk: row.author_ok === "true" ? true : row.author_ok === "false" ? false : "unknown",
    reason: "",
    error: "",
    ageMs: checkedAt ? Math.max(0, now - checkedAt) : 0,
  };
  const measuredAt = parseUtc(row.m_checked_at);
  if (row.m_chars !== null) candidate.chars = row.m_chars;
  if (row.m_chapter_title) candidate.chapterTitle = row.m_chapter_title;
  if (row.m_matched !== null) candidate.matched = row.m_matched === 1;
  if (row.m_match_reason) candidate.matchReason = row.m_match_reason;
  if (row.m_match_score !== null) candidate.matchScore = row.m_match_score;
  if (row.m_error) candidate.measureError = row.m_error;
  if (row.m_excerpt) candidate.excerpt = row.m_excerpt;
  if (row.m_preview) candidate.preview = row.m_preview;
  if (row.m_quality) candidate.contentQuality = row.m_quality as SwitchCandidate["contentQuality"];
  if (row.m_quality_score !== null) candidate.contentQualityScore = row.m_quality_score;
  if (row.m_quality_reason) candidate.contentQualityReason = row.m_quality_reason;
  if (row.m_ms !== null) candidate.measureMs = row.m_ms;
  candidate.measured = measuredAt > 0;
  return candidate;
}

/** 读缓存：目录层 + 指定章节的实测结果。 */
export function loadSwitchCandidates(bookId: number, key: string, maxAgeMinutes = 720): CachedSwitchCandidate[] {
  if (!Number.isFinite(bookId) || bookId <= 0) return [];
  const minutes = Math.max(1, Math.min(60 * 24 * 30, Math.round(maxAgeMinutes)));
  const rows = getDb()
    .prepare(
      `SELECT c.source_id, c.book_url, c.toc_url, c.name, c.author, c.chapters, c.status, c.title_ok, c.author_ok,
              c.ms, c.checked_at,
              m.chars AS m_chars, m.chapter_title AS m_chapter_title, m.matched AS m_matched,
              m.match_reason AS m_match_reason, m.match_score AS m_match_score, m.error AS m_error,
              m.ms AS m_ms, m.excerpt AS m_excerpt, m.preview AS m_preview,
              m.quality AS m_quality, m.quality_score AS m_quality_score, m.quality_reason AS m_quality_reason,
              m.checked_at AS m_checked_at,
              COALESCE(s.name, '') AS source_name, s.health_state AS source_health_state, s.health_score AS source_health_score
         FROM switch_candidates c
         LEFT JOIN book_sources s ON s.id = c.source_id
         LEFT JOIN switch_chapter_measures m
                ON m.book_id = c.book_id AND m.source_id = c.source_id AND m.chapter_key = ?
               AND m.checked_at >= datetime('now', '-30 minutes')
        WHERE c.book_id = ? AND c.status != 'none' AND c.checked_at >= datetime('now', ?)
        ORDER BY c.chapters DESC, c.ms ASC`,
    )
    .all(key, bookId, `-${minutes} minutes`) as Array<Row & { source_name: string }>;
  const now = Date.now();
  return rows.map((row) => toCandidate(row, String(row.source_name ?? ""), now));
}

/**
 * 这批源这次可以跳过：
 * - 「查过、没有这本书」是书级结论，换个章节也一样没这本书；
 * - 候选只有「这一章已经测过」才跳过，换章后要重新测字。
 */
export function recentlyCheckedSourceIds(bookId: number, key: string, maxAgeMinutes = 30): Set<number> {
  if (!Number.isFinite(bookId) || bookId <= 0) return new Set();
  const minutes = Math.max(1, Math.min(60 * 24 * 30, Math.round(maxAgeMinutes)));
  const rows = getDb()
    .prepare(
      `SELECT source_id FROM switch_candidates
         WHERE book_id = ? AND status = 'none' AND checked_at >= datetime('now', ?)
        UNION
       SELECT source_id FROM switch_chapter_measures
         WHERE book_id = ? AND chapter_key = ? AND checked_at >= datetime('now', ?)`,
    )
    .all(bookId, `-${minutes} minutes`, bookId, key, `-${minutes} minutes`) as Array<{ source_id: number }>;
  return new Set(rows.map((row) => Number(row.source_id)));
}

/** 落库目录层。只存探测过的候选（pending 是「搜到了但还没看目录」）。 */
export function saveSwitchCandidates(bookId: number, list: SwitchCandidate[]): number {
  if (!Number.isFinite(bookId) || bookId <= 0 || !list.length) return 0;
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO switch_candidates
       (book_id, source_id, book_url, toc_url, name, author, chapters, status, title_ok, author_ok, ms, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(book_id, source_id) DO UPDATE SET
       book_url = excluded.book_url,
       toc_url = excluded.toc_url,
       name = excluded.name,
       author = excluded.author,
       chapters = excluded.chapters,
       status = excluded.status,
       title_ok = excluded.title_ok,
       author_ok = excluded.author_ok,
       ms = excluded.ms,
       checked_at = excluded.checked_at`,
  );
  let saved = 0;
  const write = db.transaction((items: SwitchCandidate[]) => {
    for (const item of items) {
      if (item.status === "pending") continue;
      statement.run(
        bookId,
        item.sourceId,
        item.bookUrl,
        item.tocUrl ?? "",
        item.name,
        item.author,
        item.chapters,
        item.status,
        item.titleOk ? 1 : 0,
        item.authorOk === true ? "true" : item.authorOk === false ? "false" : "unknown",
        item.ms,
      );
      saved += 1;
    }
  });
  write(list);
  return saved;
}

/** 落库章节层：只写测过的那一章。 */
export function saveSwitchMeasures(bookId: number, key: string, list: SwitchCandidate[]): number {
  if (!Number.isFinite(bookId) || bookId <= 0 || !list.length) return 0;
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO switch_chapter_measures
       (book_id, source_id, chapter_key, chars, chapter_title, matched, match_reason, match_score, error, ms, excerpt, preview,
        quality, quality_score, quality_reason, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(book_id, source_id, chapter_key) DO UPDATE SET
       chars = excluded.chars,
       chapter_title = excluded.chapter_title,
       matched = excluded.matched,
       match_reason = excluded.match_reason,
       match_score = excluded.match_score,
       error = excluded.error,
       ms = excluded.ms,
       excerpt = excluded.excerpt,
       preview = excluded.preview,
       quality = excluded.quality,
       quality_score = excluded.quality_score,
       quality_reason = excluded.quality_reason,
       checked_at = excluded.checked_at`,
  );
  let saved = 0;
  const write = db.transaction((items: SwitchCandidate[]) => {
    for (const item of items) {
      const touched = typeof item.chars === "number" || Boolean(item.measureError) || typeof item.matched === "boolean";
      if (!touched) continue;
      // 临时失败（超时/连接断）不落库：缓存 30 分钟会让这一条一直显示「上次未测到」，
      // 而它下次打开面板时本来很可能 1 秒就测出来了。真结论（空正文、目录为空）才缓存。
      if (!item.chars && TRANSIENT_MEASURE_ERROR.test(item.measureError ?? "")) continue;
      statement.run(
        bookId,
        item.sourceId,
        key,
        typeof item.chars === "number" ? item.chars : null,
        item.chapterTitle ?? "",
        typeof item.matched === "boolean" ? (item.matched ? 1 : 0) : null,
        item.matchReason ?? "",
        typeof item.matchScore === "number" ? item.matchScore : null,
        item.measureError ?? "",
        item.measureMs ?? 0,
        item.excerpt ?? "",
        item.preview ?? "",
        item.contentQuality ?? "",
        item.contentQualityScore ?? 0,
        item.contentQualityReason ?? "",
      );
      saved += 1;
    }
  });
  write(list);
  return saved;
}

/**
 * 记下「这个源搜过了，没有这本书」。
 *
 * 788 个源里通常只有三十来个能搜到同名书，其余 750 个的搜索结果是空的——不记下来，
 * 每次打开面板都要把这 750 个再问一遍，而这正是耗时的大头。status='none' 的行只用来
 * 表示「查过、没有」，读缓存时会被过滤掉，不会冒充候选。
 */
export function markSourcesSearched(bookId: number, sourceIds: number[]): number {
  if (!Number.isFinite(bookId) || bookId <= 0 || !sourceIds.length) return 0;
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO switch_candidates (book_id, source_id, book_url, status, checked_at)
     VALUES (?, ?, '', 'none', datetime('now'))
     ON CONFLICT(book_id, source_id) DO UPDATE SET checked_at = excluded.checked_at
       WHERE switch_candidates.status = 'none'`,
  );
  let saved = 0;
  const write = db.transaction((ids: number[]) => {
    for (const id of ids) {
      statement.run(bookId, id);
      saved += 1;
    }
  });
  write(sourceIds);
  return saved;
}

/**
 * 换源缓存保留 30 天：目录/测字只对近期换源有意义，长期堆着会让面板读到
 * 已经改版的书站旧结论。正文缓存（chapter_contents）不在这里清。
 */
export function pruneSwitchCache(days = 30, db = getDb()): number {
  const window = `-${Math.max(1, Math.round(days))} days`;
  const candidates = db.prepare("DELETE FROM switch_candidates WHERE checked_at < datetime('now', ?)").run(window);
  const measures = db.prepare("DELETE FROM switch_chapter_measures WHERE checked_at < datetime('now', ?)").run(window);
  return Number(candidates.changes ?? 0) + Number(measures.changes ?? 0);
}

/** 书被删掉时外键会级联，这里只给「清空重新搜」用。 */
export function clearSwitchCandidates(bookId: number): number {
  const db = getDb();
  const info = db.prepare("DELETE FROM switch_candidates WHERE book_id = ?").run(bookId);
  db.prepare("DELETE FROM switch_chapter_measures WHERE book_id = ?").run(bookId);
  return Number(info.changes ?? 0);
}
