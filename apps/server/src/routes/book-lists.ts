import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";

interface ListRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface BookBrief {
  id: number;
  name: string;
  author: string;
  coverUrl: string;
  sourceId: number;
  chapterCount: number;
}

function listBooks(db: ReturnType<typeof getDb>, listId: number, limit?: number): BookBrief[] {
  const sql = `SELECT b.id, b.name, b.author, b.cover_url AS coverUrl, b.source_id AS sourceId,
                      (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapterCount
               FROM book_list_items i
               JOIN books b ON b.id = i.book_id
               WHERE i.list_id = ?
               ORDER BY i.order_no ASC, i.created_at ASC, b.id ASC`;
  const rows = (limit ? db.prepare(sql + " LIMIT ?").all(listId, limit) : db.prepare(sql).all(listId)) as BookBrief[];
  return rows;
}

function touch(db: ReturnType<typeof getDb>, listId: number): void {
  db.prepare("UPDATE book_lists SET updated_at = datetime('now') WHERE id = ?").run(listId);
}

function brief(row: ListRow, db: ReturnType<typeof getDb>, full = false) {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM book_list_items WHERE list_id = ?").get(row.id) as { n: number }).n;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    books: listBooks(db, row.id, full ? undefined : 4),
  };
}

export async function bookListRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/book-lists", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM book_lists ORDER BY updated_at DESC, id DESC").all() as ListRow[];
    return { total: rows.length, items: rows.map((row) => brief(row, db)) };
  });

  app.get<{ Params: { id: string } }>("/api/book-lists/:id", async (req, reply) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM book_lists WHERE id = ?").get(Number(req.params.id)) as ListRow | undefined;
    if (!row) return reply.code(404).send({ error: "not_found", message: "书单不存在" });
    return brief(row, db, true);
  });

  app.post<{ Body: { name?: string; description?: string } }>("/api/book-lists", async (req, reply) => {
    const name = String(req.body?.name ?? "").trim().slice(0, 40);
    if (!name) return reply.code(400).send({ error: "missing_name", message: "书单名不能为空" });
    const description = String(req.body?.description ?? "").trim().slice(0, 300);
    const db = getDb();
    const info = db.prepare("INSERT INTO book_lists (name, description) VALUES (?, ?)").run(name, description);
    return reply.send({ ok: true, id: Number(info.lastInsertRowid), name, description });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    "/api/book-lists/:id",
    async (req, reply) => {
      const db = getDb();
      const id = Number(req.params.id);
      const row = db.prepare("SELECT * FROM book_lists WHERE id = ?").get(id) as ListRow | undefined;
      if (!row) return reply.code(404).send({ error: "not_found", message: "书单不存在" });
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 40) : row.name;
      if (!name) return reply.code(400).send({ error: "missing_name", message: "书单名不能为空" });
      const description =
        typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 300) : row.description;
      db.prepare("UPDATE book_lists SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(
        name,
        description,
        id,
      );
      return reply.send({ ok: true, id, name, description });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/book-lists/:id", async (req, reply) => {
    getDb().prepare("DELETE FROM book_lists WHERE id = ?").run(Number(req.params.id));
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string }; Body: { bookId?: number } }>("/api/book-lists/:id/books", async (req, reply) => {
    const db = getDb();
    const listId = Number(req.params.id);
    const bookId = Number(req.body?.bookId);
    if (!Number.isFinite(bookId) || bookId <= 0) return reply.code(400).send({ error: "missing_book", message: "缺少书籍" });
    const list = db.prepare("SELECT id FROM book_lists WHERE id = ?").get(listId);
    if (!list) return reply.code(404).send({ error: "not_found", message: "书单不存在" });
    const book = db.prepare("SELECT id FROM books WHERE id = ?").get(bookId);
    if (!book) return reply.code(404).send({ error: "book_not_found", message: "书籍不存在" });
    const exists = db.prepare("SELECT 1 FROM book_list_items WHERE list_id = ? AND book_id = ?").get(listId, bookId);
    if (!exists) {
      const order = (db
        .prepare("SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM book_list_items WHERE list_id = ?")
        .get(listId) as { n: number }).n;
      db.prepare("INSERT INTO book_list_items (list_id, book_id, order_no) VALUES (?, ?, ?)").run(listId, bookId, order);
      touch(db, listId);
    }
    return reply.send({ ok: true, added: !exists });
  });

  app.delete<{ Params: { id: string; bookId: string } }>("/api/book-lists/:id/books/:bookId", async (req, reply) => {
    const db = getDb();
    const listId = Number(req.params.id);
    db.prepare("DELETE FROM book_list_items WHERE list_id = ? AND book_id = ?").run(listId, Number(req.params.bookId));
    touch(db, listId);
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>("/api/books/:id/lists", async (req, reply) => {
    const db = getDb();
    const bookId = Number(req.params.id);
    if (!Number.isFinite(bookId)) return reply.code(400).send({ error: "bad_id" });
    const rows = db
      .prepare(
        `SELECT l.id, l.name,
                (SELECT COUNT(*) FROM book_list_items i WHERE i.list_id = l.id) AS count,
                EXISTS(SELECT 1 FROM book_list_items i WHERE i.list_id = l.id AND i.book_id = ?) AS has
         FROM book_lists l ORDER BY l.updated_at DESC, l.id DESC`,
      )
      .all(bookId) as Array<{ id: number; name: string; count: number; has: number }>;
    return { total: rows.length, items: rows.map((r) => ({ ...r, has: Boolean(r.has) })) };
  });
}
