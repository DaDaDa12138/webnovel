import { BookSourceEngine, countContentChars, type BookInfo, type Chapter, type SearchBook } from "@legado/engine";
import type { SwitchReanchor } from "@legado/shared";
import { getDb } from "../db/index.js";
import { authorsMatch, titleKey, titlesMatch } from "./match.js";
import { assessContentQuality } from "./content-quality.js";
import { captureReanchorSnapshot, reanchorAfterSwitch } from "./books/reanchor.js";
import { recordSwitchHistory } from "./books/switch-book.js";
import { getBook, readProgress } from "./books/store.js";

export { titleKey, titlesMatch } from "./match.js";

/** A book whose current source returns only a fragment of a chapter. */
interface BookRow {
  id: number;
  book_url: string;
  source_id: number | null;
  name: string;
  author: string;
  cover_url: string;
  intro: string;
  kind: string;
  last_chapter: string;
  toc_url: string;
  origin: string;
  origin_name: string;
  auto_switched: number;
  auto_switch_note: string;
  auto_switch_attempts: number;
  auto_switch_last_at: string | null;
}

export interface AutoSwitchOutcome {
  attempted: boolean;
  switched: boolean;
  reason: string;
  fromSourceId?: number;
  fromSourceName?: string;
  toSourceId?: number;
  toSourceName?: string;
  chapters?: number;
  chaptersBefore?: number;
  scanned?: number;
  candidates?: number;
  attempts?: number;
  /** 自动换源也写 switch_history；有 historyId 才能撤销。 */
  historyId?: number;
  canUndo?: boolean;
  /** 自动换源时标注/书签的重贴统计。 */
  reanchor?: SwitchReanchor;
}

/** 自动换源最多试 3 次；成功后 auto_switched=1 才真正锁死。 */
export const AUTO_SWITCH_MAX_ATTEMPTS = 3;
/** 失败后至少隔 6 小时再试，避免每次打开短章都扫一遍几百个源。 */
export const AUTO_SWITCH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function parseDbTime(value: string | null | undefined): number {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const iso = text.includes("T") ? text : text.replace(" ", "T") + "Z";
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}

export type AutoSwitchGate = "ok" | "already_switched" | "attempt_limit" | "cooldown";

/**
 * 自动换源门禁。旧版把 auto_switched 当「试过了」的闩，失败也置 1；
 * 0.58 起它只表示「已经换成功了」，失败由 attempts + last_at 控制重试节奏。
 */
export function autoSwitchGate(
  book: Pick<BookRow, "auto_switched" | "auto_switch_attempts" | "auto_switch_last_at">,
  now = Date.now(),
): AutoSwitchGate {
  if (Number(book.auto_switched) === 1) return "already_switched";
  if (Number(book.auto_switch_attempts ?? 0) >= AUTO_SWITCH_MAX_ATTEMPTS) return "attempt_limit";
  const lastAt = parseDbTime(book.auto_switch_last_at);
  if (lastAt > 0 && now - lastAt < AUTO_SWITCH_COOLDOWN_MS) return "cooldown";
  return "ok";
}

const probe = new BookSourceEngine({ timeoutMs: 9000, maxTocPages: 50, maxContentPages: 20 });

/**
 * 同一本书的自动换源只跑一次。
 *
 * 阅读页会并发预取相邻章：第 1 章触发自动换源、还没提交时，第 3 章的请求也看到
 * auto_switched=0，于是又搜一遍并再换一次，历史里出现两条「从同一源换走」。
 * 后到的调用直接复用同一个 Promise，拿到相同结果。
 */
const inFlightAutoSwitches = new Map<number, Promise<AutoSwitchOutcome>>();

export function autoSwitchBook(
  book: BookRow,
  chapterIndex: number,
  chapterTitle: string,
  currentLength: number,
  currentTotal: number,
): Promise<AutoSwitchOutcome> {
  const running = inFlightAutoSwitches.get(book.id);
  if (running) return running;
  const task = runAutoSwitch(book, chapterIndex, chapterTitle, currentLength, currentTotal).finally(() => {
    if (inFlightAutoSwitches.get(book.id) === task) inFlightAutoSwitches.delete(book.id);
  });
  inFlightAutoSwitches.set(book.id, task);
  return task;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        out.push(await fn(item));
      } catch {
        /* individual source failures are expected */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function saveChapters(bookId: number, bookUrl: string, chapters: Chapter[]): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO chapters (book_id, idx, title, url, base_url, is_vip, is_volume) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id, url) DO UPDATE SET idx=excluded.idx, title=excluded.title, is_vip=excluded.is_vip`,
  );
  chapters.forEach((chapter, index) => {
    insert.run(bookId, index, chapter.title, chapter.url, bookUrl, chapter.isVip ? 1 : 0, chapter.isVolume ? 1 : 0);
  });
}

/**
 * Look for the same book on other working sources and switch to the first one that
 * returns a full chapter where the current source only returns a fragment.
 * 0.58 起失败可重试：成功才把 auto_switched 置 1；失败按 attempts + last_at
 * 控制 6 小时冷却与最多 3 次，避免「试一次就永久放弃」。
 */
async function runAutoSwitch(
  book: BookRow,
  chapterIndex: number,
  chapterTitle: string,
  currentLength: number,
  currentTotal: number,
): Promise<AutoSwitchOutcome> {
  const db = getDb();
  // 并发预取的请求可能拿着换源前的旧 book 快照；先按库里的最新状态过门禁。
  const fresh = getBook(book.id);
  const freshState = fresh
    ? {
        auto_switched: Number(fresh.auto_switched ?? 0),
        auto_switch_attempts: Number(fresh.auto_switch_attempts ?? 0),
        auto_switch_last_at: (fresh.auto_switch_last_at as string | null) ?? null,
      }
    : null;
  const gate = autoSwitchGate(freshState ?? book);
  if (gate !== "ok") return { attempted: false, switched: false, reason: gate };
  const attempts = Number(book.auto_switch_attempts ?? 0) + 1;
  db.prepare(
    "UPDATE books SET auto_switch_attempts = ?, auto_switch_last_at = datetime('now'), auto_switch_note = ? WHERE id = ?",
  ).run(attempts, "searching", book.id);

  const rows = db
    .prepare(
      `SELECT id, name, status, json, health_state, health_score FROM book_sources
        WHERE enabled = 1 AND id != ? AND health_state NOT IN ('blocked', 'broken')
        ORDER BY CASE health_state WHEN 'healthy' THEN 0 WHEN 'partial' THEN 1 WHEN 'unknown' THEN 2
                   WHEN 'degraded' THEN 3 ELSE 4 END,
                 health_score DESC,
                 CASE status WHEN 'ok' THEN 0 WHEN 'retest' THEN 1 ELSE 2 END,
                 weight DESC, id ASC LIMIT 80`,
    )
    .all(Number(book.source_id ?? 0)) as Array<{
      id: number;
      name: string;
      status: string;
      json: string;
      health_state: string;
      health_score: number;
    }>;

  const sources = rows.flatMap((row) => {
    try {
      return [{ id: row.id, name: row.name, source: JSON.parse(row.json), healthState: row.health_state, healthScore: row.health_score }];
    } catch {
      return [];
    }
  });

  const found: Array<{ sourceId: number; sourceName: string; book: SearchBook; healthState: string; healthScore: number }> = [];
  const deadline = Date.now() + 25_000;
  await mapPool(sources, 24, async (entry) => {
    if (Date.now() > deadline) return;
    const books = await probe.search(entry.source, book.name, 1);
    for (const item of books) {
      if (!item || !item.bookUrl || !titlesMatch(item.name, book.name)) continue;
      // A different author means a different book even when the title is identical.
      if (book.author && item.author && !authorsMatch(item.author, book.author)) continue;
      found.push({ sourceId: entry.id, sourceName: entry.name, book: item, healthState: entry.healthState, healthScore: entry.healthScore });
    }
  });

  const unique = found
    .filter((c, i) => found.findIndex((o) => o.sourceId === c.sourceId && o.book.bookUrl === c.book.bookUrl) === i)
    // Re-check with the author now that every candidate is known.
    .filter((c) => !book.author || !c.book.author || authorsMatch(c.book.author, book.author));
  // Same author + exact title first: a source that carries the right edition is far more likely to work.
  const ranked = unique
    .map((c) => {
      let score = titleKey(c.book.name) === titleKey(book.name) ? 2 : 1;
      if (book.author) score += c.book.author && authorsMatch(c.book.author, book.author) ? 3 : 0;
      score += c.healthState === "healthy" ? 2 : c.healthState === "partial" ? 1 : c.healthState === "degraded" ? -1 : 0;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);
  const perSource = new Map<number, number>();
  const candidates = ranked.filter((c) => {
    const seen = perSource.get(c.sourceId) ?? 0;
    if (seen >= 2) return false;
    perSource.set(c.sourceId, seen + 1);
    return true;
  });
  const threshold = Math.max(600, Math.floor(currentLength * 2));

  for (const candidate of candidates.slice(0, 10)) {
    const entry = sources.find((s) => s.id === candidate.sourceId);
    if (!entry) continue;
    try {
      const info: BookInfo = await probe.bookInfo(entry.source, candidate.book.bookUrl);
      // The search hit may be a same-title different book; the detail page is the final word.
      const infoName = info.name || candidate.book.name;
      if (!titlesMatch(infoName, book.name)) continue;
      const infoAuthor = info.author || candidate.book.author;
      if (book.author && infoAuthor && !authorsMatch(infoAuthor, book.author)) continue;
      const list = await probe.toc(entry.source, info);
      // Refuse to replace a working table of contents with a much shorter one.
      if (list.length < Math.max(5, Math.ceil(currentTotal * 0.5))) continue;
      const targetIndex = Math.min(chapterIndex, list.length - 1);
      const target = list[targetIndex];
      if (!target || target.isVip) continue;
      const text = await probe.content(entry.source, target);
      if (!text || text.trim().length < threshold) continue;
      // 自动换源过去结果正文是占位/防盗提示，比不换更糟：至少当前源还能读出片段。
      if (assessContentQuality(text, countContentChars(text)).quality === "bad") continue;

      // 搜索/探测可能花了十几秒；提交前再确认这本书没有被别的请求换走。
      const current = getBook(book.id);
      if (
        !current ||
        Number(current.auto_switched) !== 0 ||
        Number(current.source_id ?? 0) !== Number(book.source_id ?? 0) ||
        String(current.book_url ?? "") !== String(book.book_url ?? "")
      ) {
        return { attempted: false, switched: false, reason: "already_switched" };
      }

      // Looks healthy: switch the whole book to this source, keeping the reading position by index.
      // 自动换源同样要保住划线与书签：先快照旧位置，换完再按引文重贴；预算压到 2.5s，避免拖慢正文请求。
      const reanchorSnapshot = captureReanchorSnapshot(book.id);
      const previousProgress = readProgress(db, book.id);
      const progressIndex = Number(previousProgress?.chapter_index ?? -1);
      const nearbyProgress = Boolean(previousProgress) && Math.abs(progressIndex - chapterIndex) <= 5;
      const previousHistory = {
        source_id: book.source_id == null ? null : Number(book.source_id),
        book_url: String(book.book_url ?? ""),
        book_name: String(book.name ?? ""),
        chapters: currentTotal,
        // 预取会并发读相邻章，触发换源的可能是第 3 章而不是读者正在看的第 1 章；
        // 进度和请求章相邻时以进度为准，差得远说明进度是旧位置（如从目录直接打开第 1 章），用请求章。
        chapter_index: nearbyProgress ? Number(previousProgress?.chapter_index) : chapterIndex,
        chapter_title: String(
          (nearbyProgress ? previousProgress?.chapter_title : "") || chapterTitle || previousProgress?.chapter_title || "",
        ),
        char_offset: Number(previousProgress?.char_offset ?? 0),
        reanchor_snapshot: reanchorSnapshot ? JSON.stringify(reanchorSnapshot) : null,
        kind: "auto" as const,
      };
      // 历史、书、目录、进度必须在同一事务里落库：否则「已自动切换到 X」却没有撤销记录，
      // 或者书指向新源而目录还是旧的，读者只能删书重加。
      let historyId: number | undefined;
      db.transaction(() => {
        historyId = recordSwitchHistory(db, book.id, previousHistory);
        db.prepare("DELETE FROM books WHERE book_url = ? AND source_id = ? AND id != ?").run(candidate.book.bookUrl, entry.id, book.id);
        db.prepare(
          `UPDATE books SET source_id = ?, book_url = ?, name = ?, author = ?, cover_url = ?, intro = ?, kind = ?, last_chapter = ?,
             toc_url = ?, origin = ?, origin_name = ?, auto_switched = 1, auto_switch_note = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(
          entry.id,
          candidate.book.bookUrl,
          (info.name || candidate.book.name || book.name).slice(0, 120),
          (info.author || candidate.book.author || book.author || "").slice(0, 60),
          info.coverUrl || candidate.book.coverUrl || book.cover_url,
          (info.intro || candidate.book.intro || book.intro || "").slice(0, 4000),
          (info.kind || candidate.book.kind || book.kind || "").slice(0, 40),
          (info.lastChapter || candidate.book.lastChapter || book.last_chapter || "").slice(0, 120),
          info.tocUrl || candidate.book.bookUrl,
          info.origin ?? "",
          info.originName || candidate.sourceName,
          `auto: ${entry.name} (${list.length} 章)`,
          book.id,
        );
        db.prepare("DELETE FROM chapters WHERE book_id = ?").run(book.id);
        saveChapters(book.id, candidate.book.bookUrl, list);
        db.prepare("UPDATE reading_progress SET chapter_id = NULL WHERE book_id = ?").run(book.id);
      })();
      let reanchor: SwitchReanchor | undefined;
      if (reanchorSnapshot) {
        try {
          reanchor = await reanchorAfterSwitch(book.id, reanchorSnapshot, 2_500);
        } catch {
          /* 重贴失败只影响标注位置，不影响自动换源本身 */
        }
      }
      return {
        attempted: true,
        switched: true,
        reason: "switched",
        fromSourceId: Number(book.source_id ?? 0),
        fromSourceName: book.origin_name || "原来源",
        toSourceId: entry.id,
        toSourceName: entry.name,
        chapters: list.length,
        chaptersBefore: currentTotal,
        scanned: sources.length,
        candidates: candidates.length,
        historyId,
        canUndo: true,
        reanchor,
      };
    } catch {
      /* try the next candidate */
    }
  }

  const note = `no_candidate: attempts=${attempts} scanned=${sources.length} candidates=${candidates.length}`;
  db.prepare("UPDATE books SET auto_switch_note = ? WHERE id = ?").run(note, book.id);
  return {
    attempted: true,
    switched: false,
    reason: "no_candidate",
    scanned: sources.length,
    candidates: candidates.length,
    attempts,
  };
}
