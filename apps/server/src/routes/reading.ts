import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { getSetting } from "../services/settings.js";
import { totalReadWords } from "../services/books/reads.js";

function dayKey(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDay(day: string): string {
  const date = new Date(day + "T00:00:00");
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function readingRoutes(app: FastifyInstance): Promise<void> {
  /** Accumulate foreground reading time. The reader reports every 60s (and on hide). */
  app.post<{ Params: { id: string }; Body: { seconds?: number; chapters?: number } }>(
    "/api/books/:id/reading-time",
    async (req, reply) => {
      const db = getDb();
      const bookId = Number(req.params.id);
      const book = db.prepare("SELECT id FROM books WHERE id = ?").get(bookId);
      if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
      const seconds = Math.max(0, Math.min(3600, Math.round(Number(req.body?.seconds ?? 0))));
      const chapters = Math.max(0, Math.min(50, Math.round(Number(req.body?.chapters ?? 0))));
      if (!seconds && !chapters) return reply.send({ ok: true, skipped: true });
      db.prepare(
        `INSERT INTO reading_sessions (book_id, day, seconds, chapters, updated_at)
         VALUES (?, date('now','localtime'), ?, ?, datetime('now'))
         ON CONFLICT(book_id, day) DO UPDATE SET seconds = seconds + excluded.seconds,
           chapters = chapters + excluded.chapters, updated_at = datetime('now')`,
      ).run(bookId, seconds, chapters);
      return reply.send({ ok: true });
    },
  );

  app.get("/api/reading/stats", async () => {
    const db = getDb();
    const today = (db.prepare("SELECT COALESCE(SUM(seconds),0) AS s FROM reading_sessions WHERE day = date('now','localtime')").get() as { s: number }).s;
    const week = (
      db.prepare("SELECT COALESCE(SUM(seconds),0) AS s FROM reading_sessions WHERE day >= date('now','localtime','-6 days')").get() as { s: number }
    ).s;
    const total = (db.prepare("SELECT COALESCE(SUM(seconds),0) AS s FROM reading_sessions").get() as { s: number }).s;
    const chapters = (db.prepare("SELECT COALESCE(SUM(chapters),0) AS n FROM reading_sessions").get() as { n: number }).n;
    const books = (db.prepare("SELECT COUNT(DISTINCT book_id) AS n FROM reading_sessions").get() as { n: number }).n;
    const readWords = totalReadWords();
    const days = (db.prepare("SELECT DISTINCT day FROM reading_sessions ORDER BY day DESC").all() as Array<{ day: string }>).map((r) => r.day);
    let streak = 0;
    let cursor = dayKey(0);
    if (!days.includes(cursor) && days.includes(dayKey(-1))) cursor = dayKey(-1);
    const set = new Set(days);
    while (set.has(cursor)) {
      streak += 1;
      const date = new Date(cursor + "T00:00:00");
      date.setDate(date.getDate() - 1);
      cursor = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    const goal = Math.max(5, Math.min(300, Math.round(Number(getSetting("readingGoalMinutes", "30")) || 30)));
    return { today, week, total, streak, books, chapters, readWords, goal };
  });

  /** 热力图：只要「每天多少秒」，一年的数据也就 365 行。 */
  app.get<{ Querystring: { weeks?: string } }>("/api/reading/heatmap", async (req) => {
    const db = getDb();
    const weeks = Math.max(4, Math.min(53, Number(req.query.weeks ?? 53) || 53));
    const since = -(weeks * 7 - 1);
    const rows = db
      .prepare(
        `SELECT day, SUM(seconds) AS seconds, SUM(chapters) AS chapters
         FROM reading_sessions
         WHERE day >= date('now','localtime', ?)
         GROUP BY day
         ORDER BY day`,
      )
      .all(`${since} days`) as Array<{ day: string; seconds: number; chapters: number }>;
    const all = db.prepare("SELECT DISTINCT day FROM reading_sessions ORDER BY day").all() as Array<{ day: string }>;
    // 最长连续：把「有记录的日子」排序后扫一遍，跨月/跨年都只是字符串比较。
    let longest = 0;
    let run = 0;
    let previous = "";
    for (const row of all) {
      const day = row.day;
      const expected = previous ? nextDay(previous) : "";
      run = previous && day === expected ? run + 1 : 1;
      if (run > longest) longest = run;
      previous = day;
    }
    const goal = Math.max(5, Math.min(300, Math.round(Number(getSetting("readingGoalMinutes", "30")) || 30)));
    return { weeks, goal, days: rows, longest };
  });

  app.get<{ Querystring: { days?: string } }>("/api/reading/history", async (req) => {
    const db = getDb();
    const days = Math.max(1, Math.min(365, Number(req.query.days ?? 30) || 30));
    const rows = db
      .prepare(
        `SELECT s.day, s.book_id, s.seconds, s.chapters, b.name,
                p.chapter_index,
                (SELECT c.title FROM chapters c WHERE c.book_id = b.id AND c.idx = p.chapter_index) AS chapter_title
         FROM reading_sessions s JOIN books b ON b.id = s.book_id
         LEFT JOIN reading_progress p ON p.book_id = s.book_id
         WHERE s.day >= date('now','localtime', ?)
         ORDER BY s.day DESC, s.seconds DESC`,
      )
      .all(`-${days - 1} days`) as Array<Record<string, unknown>>;
    const grouped = new Map<string, { day: string; seconds: number; chapters: number; items: Array<Record<string, unknown>> }>();
    for (const row of rows) {
      const day = String(row.day);
      if (!grouped.has(day)) grouped.set(day, { day, seconds: 0, chapters: 0, items: [] });
      const bucket = grouped.get(day)!;
      bucket.seconds += Number(row.seconds ?? 0);
      bucket.chapters += Number(row.chapters ?? 0);
      bucket.items.push({
        bookId: row.book_id,
        name: row.name,
        chapterIndex: Number(row.chapter_index ?? 0),
        chapterTitle: row.chapter_title ?? "",
        seconds: Number(row.seconds ?? 0),
        chapters: Number(row.chapters ?? 0),
      });
    }
    return { days, total: grouped.size, items: [...grouped.values()] };
  });
}
