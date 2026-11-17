import { matchChapter, type BookInfo } from "@legado/engine";
import type { SwitchAnchorPayload, SwitchHistoryKind, SwitchReanchor, SwitchResult } from "@legado/shared";
import { getDb } from "../../db/index.js";
import { fetchBookInfo, fetchToc } from "../engine.js";
import { authorsMatch, titlesMatch } from "../match.js";
import { cleanCover, cleanWordCount, firstNonEmpty, isDirtyAuthor } from "../text.js";
import { MAX_CHAPTERS, bookPayload, countChapters, getBook, readProgress, replaceChapters, restoreProgress, type BookRow } from "./store.js";
import { captureReanchorSnapshot, reanchorAfterSwitch } from "./reanchor.js";
import { clearSwitchAnchor, saveSwitchAnchor } from "./switch-anchors.js";

export interface SwitchInput {
  sourceId?: number;
  bookUrl?: string;
  expectName?: string;
  expectAuthor?: string;
  force?: boolean;
  /** 用户已经确认「目标源目录明显更少」后传 true。默认拦下来，避免把 884 章换成 100 章。 */
  allowShorter?: boolean;
  /** 换源时读者正在看的章节下标：进度按它对齐，而不是按库里可能落后一拍的进度。 */
  chapterIndex?: number;
  /** 换源时读者正在看的那一章的标题（客户端实际渲染的），用于跨源定位。 */
  chapterTitle?: string;
  /** 撤销换源时不必反过来再记一条历史，否则「换回」之后按钮又永远可点，来回弹。 */
  recordHistory?: boolean;
  /** 换源前读者所在的那一句；落库后另一台设备打开同一本书也能接续。 */
  anchor?: SwitchAnchorPayload;
  /** 撤销换源时由快照精确还原，不需要再跑一次文本重贴。 */
  skipReanchor?: boolean;
  /** 这条历史是手动换源还是自动换源；默认 manual。 */
  historyKind?: SwitchHistoryKind;
}

export type SwitchBookResult = { ok: true; payload: SwitchResult } | { ok: false; status: number; body: Record<string, unknown> };

/** 名字类命中（exact/core/cleaned/similar）才算「目录里真有这一章」。 */
const NAME_EVIDENCE = new Set(["exact", "core", "cleaned", "similar"]);
/** 目录缩水保护：旧目录至少这么多章，且新目录不到一半时才拦。 */
const SHRINK_MIN_CHAPTERS = 50;
const SHRINK_RATIO = 0.5;

export interface SwitchHistoryRow {
  id: number;
  source_id: number | null;
  book_url: string;
  book_name: string;
  chapters: number;
  chapter_index: number;
  chapter_title: string;
  char_offset: number;
  /** 换源前标注/书签的快照 JSON（0.62）：撤销时精确还原，也可用于重试重贴。 */
  reanchor_snapshot: string | null;
  kind: SwitchHistoryKind;
  created_at: string;
}

/**
 * 换源历史：只记「换之前是什么样」。有了它，换源就不再是单程票——
 * 读者换到一个目录残缺/正文有错的源，可以直接换回来，而不必自己再搜一遍。
 */
export function recordSwitchHistory(
  db: ReturnType<typeof getDb>,
  bookId: number,
  entry: Omit<SwitchHistoryRow, "id" | "created_at">,
): number {
  const result = db.prepare(
    `INSERT INTO switch_history (book_id, source_id, book_url, book_name, chapters, chapter_index, chapter_title, char_offset, reanchor_snapshot, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    bookId,
    entry.source_id,
    entry.book_url,
    entry.book_name,
    entry.chapters,
    entry.chapter_index,
    entry.chapter_title,
    entry.char_offset,
    entry.reanchor_snapshot,
    entry.kind,
  );
  // 只留最近 5 条：换源来回折腾时不需要无限历史。
  db.prepare(
    "DELETE FROM switch_history WHERE book_id = ? AND id NOT IN (SELECT id FROM switch_history WHERE book_id = ? ORDER BY id DESC LIMIT 5)",
  ).run(bookId, bookId);
  return Number(result.lastInsertRowid);
}

export function latestSwitchHistory(bookId: number, db = getDb()): SwitchHistoryRow | undefined {
  return db
    .prepare(
      `SELECT id, source_id, book_url, book_name, chapters, chapter_index, chapter_title, char_offset, reanchor_snapshot, kind, created_at
         FROM switch_history WHERE book_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(bookId) as SwitchHistoryRow | undefined;
}

/** 换源面板的「换源记录」：最近 5 条，带源名，按时间倒序。 */
export function listSwitchHistory(bookId: number, limit = 5, db = getDb()): Array<SwitchHistoryRow & { source_name: string }> {
  return db
    .prepare(
      `SELECT h.id, h.source_id, h.book_url, h.book_name, h.chapters, h.chapter_index, h.chapter_title,
              h.char_offset, h.reanchor_snapshot, h.kind, h.created_at,
              COALESCE(s.name, '原来源') AS source_name
         FROM switch_history h LEFT JOIN book_sources s ON s.id = h.source_id
        WHERE h.book_id = ? ORDER BY h.id DESC LIMIT ?`,
    )
    .all(bookId, Math.max(1, Math.min(20, Math.floor(limit)))) as Array<SwitchHistoryRow & { source_name: string }>;
}

export function dropSwitchHistory(id: number, db = getDb()): void {
  db.prepare("DELETE FROM switch_history WHERE id = ?").run(id);
}

/**
 * 换源（Legado 的「换源」）：抓目标源的详情 + 目录，校验书名，落库，接续阅读进度。
 *
 * 失败分四种，前端要能区分：
 *  - info_error：目标源详情页打不开（换源没发生，书架原样保留）
 *  - book_mismatch：抓到的书名和当前书不一致，且目录里也找不到当前这一章
 *  - empty_toc：详情页能开但目录是空的（不能拿空目录覆盖可用目录）
 *  - toc_shorter：目录明显缩水（需要 allowShorter 二次确认）
 *
 * 书名不一致但目录里能用**章节名**定位到当前章时不再拦：镜像站喜欢给书名加后缀
 * （「夜无疆最新章节」），以前一律 409，用户看到的就是「换源失败」。
 */
export async function switchBookToSource(bookId: number, input: SwitchInput): Promise<SwitchBookResult> {
  const db = getDb();
  const book = getBook(bookId);
  if (!book) return { ok: false, status: 404, body: { error: "not_found", message: "书籍不存在" } };
  const sourceId = Number(input.sourceId ?? 0);
  const bookUrl = String(input.bookUrl ?? "").trim();
  if (!sourceId || !bookUrl) return { ok: false, status: 400, body: { error: "missing_source_or_url", message: "缺少书源或书籍地址" } };
  const sourceRow = db.prepare("SELECT id, name, url, status FROM book_sources WHERE id = ?").get(sourceId) as
    | { id: number; name: string; url: string; status: string }
    | undefined;
  if (!sourceRow) return { ok: false, status: 404, body: { error: "source_not_found", message: "书源不存在" } };

  const startedAt = Date.now();
  let info: BookInfo | null = null;
  let infoError: string | null = null;
  try {
    info = await fetchBookInfo(sourceId, bookUrl);
  } catch (err) {
    infoError = String((err as Error).message ?? err);
  }
  if (!info) {
    return {
      ok: false,
      status: 502,
      body: { error: "info_error", message: "目标书源详情页打不开，无法确认书名与作者，已取消换源", infoError },
    };
  }

  const wantedName = String(input.expectName || book.name || "").trim();
  const wantedAuthor = String(input.expectAuthor || book.author || "").trim();
  const gotName = String(info.name || "").trim();
  const gotAuthor = String(info.author || "").trim();
  const titleOk = Boolean(gotName) && Boolean(wantedName) && titlesMatch(gotName, wantedName);
  const authorOk: boolean | "unknown" = !wantedAuthor || !gotAuthor ? "unknown" : authorsMatch(gotAuthor, wantedAuthor);

  let tocError: string | null = null;
  let list: Awaited<ReturnType<typeof fetchToc>> = [];
  try {
    list = await fetchToc(sourceId, info ?? ({ bookUrl, tocUrl: bookUrl } as BookInfo));
    if (list.length > MAX_CHAPTERS) {
      tocError = `目录异常：解析出 ${list.length} 章（上限 ${MAX_CHAPTERS}），已跳过保存`;
      list = [];
    }
  } catch (err) {
    tocError = String((err as Error).message ?? err);
  }

  if (!list.length) {
    // Never destroy a working table of contents for an empty one — Legado keeps the old source too.
    return { ok: false, status: 409, body: { error: "empty_toc", message: "目标书源没取到目录，已取消换源", infoError, tocError } };
  }

  const oldTotal = countChapters(book.id);
  const previousProgress = readProgress(db, book.id);
  // 阅读页里换源时，读者看的是 route 里的这一章；库里存的进度可能还停在上一次落点
  // （甚至差一章），所以优先用调用方给的 chapterIndex 对齐进度。
  // 标题优先用客户端传来的「正在显示的那一章」：镜像站的章节号和正版经常错位，
  // 库里 idx 对应的标题是镜像站的，拿它去匹配正版目录只能退回同下标，读者会漂 1–3 章。
  const wantedIndex = Number(input.chapterIndex);
  const wantedTitle = String(input.chapterTitle ?? "").trim();
  if (previousProgress && Number.isInteger(wantedIndex) && wantedIndex >= 0) {
    const here = db.prepare("SELECT title FROM chapters WHERE book_id = ? AND idx = ?").get(book.id, wantedIndex) as
      | { title: string }
      | undefined;
    const title = wantedTitle || String(here?.title ?? "").trim();
    if (title) {
      previousProgress.chapter_title = title;
      previousProgress.chapter_index = wantedIndex;
    }
  }

  // 换源前先算一次「这一章在目标目录里落到哪」：它同时是书名不符时的证据，
  // 也决定换过去以后读者落在哪一章。
  const alignment = matchChapter(list, String(previousProgress?.chapter_title ?? wantedTitle), Number(previousProgress?.chapter_index ?? 0), oldTotal);
  const nameEvidence = NAME_EVIDENCE.has(alignment.reason);
  const force = Boolean(input.force);
  // 只有「书名不一致且目录里也找不到这一章」才值得拦下来；作者字段在聚合站经常是脏数据
  // （把「玄幻」「佚名」甚至书名写进 author），因为它 409 掉整次换源正是用户看到的「换源失败」。
  if (!titleOk && !force && !nameEvidence) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "book_mismatch",
        message: "目标书源的书名与当前书不一致，目录里也没有当前这一章，已取消换源",
        wanted: { name: wantedName, author: wantedAuthor },
        got: { name: gotName, author: gotAuthor },
        match: { title: titleOk, author: authorOk },
      },
    };
  }

  if (!input.allowShorter && oldTotal >= SHRINK_MIN_CHAPTERS && list.length < oldTotal * SHRINK_RATIO) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "toc_shorter",
        message: `目标源只有 ${list.length} 章（当前 ${oldTotal} 章），目录可能不全，已取消换源`,
        previous: oldTotal,
        next: list.length,
      },
    };
  }

  const warnings: string[] = [];
  if (!titleOk) warnings.push(`书名不一致：目标源叫「${gotName}」`);
  if (authorOk === false) warnings.push(`作者不一致：「${gotAuthor}」`);
  if (list.length < oldTotal) warnings.push(`目录比原来少 ${oldTotal - list.length} 章`);

  const match = { title: titleOk, author: authorOk, forced: !titleOk || authorOk === false };
  const tocLast = String(list[list.length - 1]?.title ?? "").trim();
  const gotAuthorClean = String(info?.author ?? "").trim();
  const gotNameClean = String(firstNonEmpty(info?.name, book.name as string));
  const nextAuthor = isDirtyAuthor(gotAuthorClean, gotNameClean) ? String(book.author ?? "") : gotAuthorClean;
  // 换源前把标注/书签的位置拍个快照：换过去以后章号全变了，只有这份快照知道它们原来在哪。
  // 撤销时也靠它精确还原，不再根据新正文猜一次。
  const reanchorSnapshot =
    input.recordHistory !== false && input.skipReanchor !== true ? captureReanchorSnapshot(book.id) : null;
  const historyKind: SwitchHistoryKind = input.historyKind ?? "manual";
  const previousHistory: Omit<SwitchHistoryRow, "id" | "created_at"> = {
    source_id: book.source_id == null ? null : Number(book.source_id),
    book_url: String(book.book_url ?? ""),
    book_name: String(book.name ?? ""),
    chapters: oldTotal,
    chapter_index: Number(previousProgress?.chapter_index ?? 0),
    chapter_title: String(previousProgress?.chapter_title ?? ""),
    char_offset: Number(previousProgress?.char_offset ?? 0),
    reanchor_snapshot: reanchorSnapshot ? JSON.stringify(reanchorSnapshot) : null,
    kind: historyKind,
  };

  // 一次事务落库：写历史 → 删同源重复书 → 更新书 → 换目录 → 接进度。
  // 以前这几步分开跑，中途抛错就留下「书指向新源、目录还是旧的」的半截状态，
  // 读者再打开就是「章节错乱」，只能删书重加。
  let historyId: number | undefined;
  const progress = db.transaction(() => {
    if (input.recordHistory !== false) historyId = recordSwitchHistory(db, book.id, previousHistory);
    // Another shelf entry may already point at this url+source; drop it so the switch can land.
    db.prepare("DELETE FROM books WHERE book_url = ? AND source_id = ? AND id != ?").run(bookUrl, sourceId, book.id);
    db.prepare(
      `UPDATE books SET source_id = ?, book_url = ?, name = ?, author = ?, cover_url = ?, intro = ?, kind = ?, last_chapter = ?,
         word_count = ?, toc_url = ?, origin = ?, origin_name = ?,
         auto_switched = 0, auto_switch_attempts = 0, auto_switch_last_at = NULL, auto_switch_note = '',
         updated_at = datetime('now') WHERE id = ?`,
    ).run(
      sourceId,
      bookUrl,
      gotNameClean.slice(0, 120),
      nextAuthor.slice(0, 60),
      cleanCover(info?.coverUrl),
      firstNonEmpty(info?.intro, book.intro as string).slice(0, 4000),
      firstNonEmpty(info?.kind, book.kind as string).slice(0, 40),
      firstNonEmpty(tocLast, info?.lastChapter, book.last_chapter as string).slice(0, 120),
      firstNonEmpty(cleanWordCount(info?.wordCount), cleanWordCount(book.word_count as string)),
      info?.tocUrl || bookUrl,
      info?.origin ?? "",
      info?.originName ?? sourceRow.name,
      book.id,
    );
    replaceChapters(book.id, bookUrl, list);
    const restored = restoreProgress(db, book.id, previousProgress, oldTotal);
    // 锚点跟着换源一起落库：旧锚点的章号是旧目录的编号，必须用换源后实际落到的章覆盖。
    if (restored) saveSwitchAnchor(db, book.id, input.anchor, { index: restored.index, title: restored.title });
    else clearSwitchAnchor(db, book.id);
    return restored;
  })();

  const chapters = countChapters(book.id);
  const row = getBook(book.id) as BookRow;
  // 重贴放在事务之后：正文抓取是网络 IO，绝不能把数据库事务卡在别人的服务器上。
  // 失败也只是「位置没跟过来」，不影响换源本身已经成功这件事。
  let reanchor: SwitchReanchor | undefined;
  if (reanchorSnapshot) {
    try {
      reanchor = await reanchorAfterSwitch(book.id, reanchorSnapshot);
    } catch {
      reanchor = {
        annotations: { total: reanchorSnapshot.annotations.length, moved: 0, kept: 0, failed: reanchorSnapshot.annotations.length },
        bookmarks: { total: reanchorSnapshot.bookmarks.length, moved: 0, kept: 0, failed: reanchorSnapshot.bookmarks.length },
        chaptersFetched: 0,
        partial: true,
        ms: 0,
      };
    }
  }
  return {
    ok: true,
    payload: {
      book: bookPayload(row, chapters),
      chapters,
      chaptersBefore: oldTotal,
      warnings,
      canUndo: input.recordHistory !== false,
      historyId,
      historyKind,
      infoError,
      tocError,
      source: { id: sourceRow.id, name: sourceRow.name },
      match,
      alignment: { reason: alignment.reason, score: Number(alignment.score ?? 0), anchorSaved: Boolean(progress) },
      progress,
      reanchor,
      ms: Date.now() - startedAt,
      wordCount: String(row.word_count ?? ""),
    },
  };
}
