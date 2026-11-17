import { isJunkImage } from "@legado/engine";
import { canRefreshFromHealth } from "@legado/shared";
import { getDb } from "../db/index.js";
import { fetchBookInfo, fetchToc } from "./engine.js";

export interface RefreshResult {
  bookId: number;
  name: string;
  ok: boolean;
  newChapters: number;
  total: number;
  lastChapter: string;
  error?: string;
}

/**
 * Refresh only the shelf-facing metadata of one book (latest chapter, cover, new-chapter
 * count). The chapters table is deliberately left alone: rewriting it mid-read would move
 * the reader's position and invalidate cached bodies. The one exception is a book that has
 * no chapters yet (it was added while its source rule was broken) — then the freshly parsed
 * table is stored so the book becomes readable.
 */
export async function refreshBookMeta(bookId: number): Promise<RefreshResult> {
  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as Record<string, unknown> | undefined;
  if (!book) throw new Error("书籍不存在");
  const sourceId = Number(book.source_id);
  const source = db.prepare("SELECT status, enabled, name, health_state, health_score FROM book_sources WHERE id = ?").get(sourceId) as
    | { status: string; enabled: number; name: string; health_state: string; health_score: number }
    | undefined;
  if (!source || !source.enabled) throw new Error("书源已停用");
  // 0.57：不再只看旧的 status。健康分 45 以上的 degraded 仍可刷新元数据；
  // blocked（要登录）和 broken（连续硬失败）才拒绝。
  if (!canRefreshFromHealth(source.health_state, source.health_score, source.status)) throw new Error("书源健康状态不可用");

  const info = await fetchBookInfo(sourceId, String(book.book_url));
  const chapters = await fetchToc(sourceId, info);
  const total = chapters.length;
  const oldTotal = (db.prepare("SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?").get(bookId) as { n: number }).n;
  const newChapters = total > oldTotal ? total - oldTotal : 0;
  const cover = info.coverUrl && !isJunkImage(info.coverUrl) ? info.coverUrl : String(book.cover_url ?? "");

  db.prepare(
    `UPDATE books SET name = ?, author = ?, cover_url = ?, last_chapter = ?, word_count = ?, toc_url = ?,
       last_checked_at = datetime('now'), new_chapters = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    (info.name || String(book.name ?? "")).slice(0, 120),
    (info.author || String(book.author ?? "")).slice(0, 60),
    cover,
    (info.lastChapter || String(book.last_chapter ?? "")).slice(0, 120),
    (info.wordCount || String(book.word_count ?? "")).slice(0, 40),
    info.tocUrl || String(book.toc_url ?? ""),
    newChapters,
    bookId,
  );

  if (oldTotal === 0 && total > 0 && total <= 20000) {
    const insert = db.prepare(
      `INSERT INTO chapters (book_id, idx, title, url, base_url, is_vip, is_volume) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_id, url) DO UPDATE SET idx=excluded.idx, title=excluded.title, is_vip=excluded.is_vip`,
    );
    db.transaction(() => {
      chapters.forEach((chapter, index) => {
        insert.run(bookId, index, chapter.title, chapter.url, String(book.book_url), chapter.isVip ? 1 : 0, chapter.isVolume ? 1 : 0);
      });
    })();
  }

  return {
    bookId,
    name: String(book.name ?? ""),
    ok: true,
    newChapters,
    total,
    lastChapter: info.lastChapter || String(book.last_chapter ?? ""),
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Refresh the whole shelf, newest-checked-last first, two at a time. */
export async function refreshShelf(limit = 30): Promise<RefreshResult[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id FROM books WHERE in_shelf = 1
       ORDER BY CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END, last_checked_at ASC, id DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(200, limit))) as Array<{ id: number }>;
  return mapPool(rows, 2, async (row) => {
    try {
      return await refreshBookMeta(row.id);
    } catch (err) {
      const book = db.prepare("SELECT name FROM books WHERE id = ?").get(row.id) as { name: string } | undefined;
      db.prepare("UPDATE books SET last_checked_at = datetime('now') WHERE id = ?").run(row.id);
      return { bookId: row.id, name: book?.name ?? "", ok: false, newChapters: 0, total: 0, lastChapter: "", error: String((err as Error).message ?? err) };
    }
  });
}

let timer: NodeJS.Timeout | null = null;

/** Background shelf refresh. SHELF_REFRESH_HOURS=0 disables it. */
export function startShelfUpdater(): void {
  if (timer) return;
  const hours = Number(process.env.SHELF_REFRESH_HOURS ?? 6);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log("[updater] shelf refresh disabled");
    return;
  }
  const run = () => {
    refreshShelf(30)
      .then((items) => {
        const changed = items.filter((item) => item.ok && item.newChapters > 0).length;
        console.log(`[updater] refreshed ${items.length} books, ${changed} with new chapters`);
      })
      .catch((err) => console.warn("[updater] refresh failed:", (err as Error).message));
  };
  timer = setInterval(run, hours * 3600 * 1000);
  timer.unref();
  const kickoff = setTimeout(run, 60_000);
  kickoff.unref();
  console.log(`[updater] shelf refresh every ${hours}h`);
}
