import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";

interface GroupRow {
  id: number;
  name: string;
  order_no: number;
  created_at: string;
}

export async function bookGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/book-groups", async () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT g.id, g.name, g.order_no, g.created_at,
                (SELECT COUNT(*) FROM books b WHERE b.group_id = g.id AND b.in_shelf = 1) AS count
         FROM book_groups g ORDER BY g.order_no ASC, g.id ASC`,
      )
      .all() as Array<GroupRow & { count: number }>;
    return { total: rows.length, items: rows.map((r) => ({ id: r.id, name: r.name, orderNo: r.order_no, count: r.count })) };
  });

  app.post<{ Body: { name?: string } }>("/api/book-groups", async (req, reply) => {
    const name = String(req.body?.name ?? "").trim().slice(0, 30);
    if (!name) return reply.code(400).send({ error: "missing_name", message: "分组名不能为空" });
    const db = getDb();
    const exists = db.prepare("SELECT id FROM book_groups WHERE name = ?").get(name) as { id: number } | undefined;
    if (exists) return reply.code(409).send({ error: "duplicate", message: "分组已存在", id: exists.id });
    const order = (db.prepare("SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM book_groups").get() as { n: number }).n;
    const info = db.prepare("INSERT INTO book_groups (name, order_no) VALUES (?, ?)").run(name, order);
    return reply.send({ ok: true, id: Number(info.lastInsertRowid), name, orderNo: order });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; orderNo?: number } }>("/api/book-groups/:id", async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM book_groups WHERE id = ?").get(id) as GroupRow | undefined;
    if (!row) return reply.code(404).send({ error: "not_found", message: "分组不存在" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 30) : row.name;
    if (!name) return reply.code(400).send({ error: "missing_name", message: "分组名不能为空" });
    const duplicate = db.prepare("SELECT id FROM book_groups WHERE name = ? AND id != ?").get(name, id);
    if (duplicate) return reply.code(409).send({ error: "duplicate", message: "分组已存在" });
    const orderNo = typeof req.body?.orderNo === "number" ? Math.floor(req.body.orderNo) : row.order_no;
    db.prepare("UPDATE book_groups SET name = ?, order_no = ? WHERE id = ?").run(name, orderNo, id);
    return reply.send({ ok: true, id, name, orderNo });
  });

  app.delete<{ Params: { id: string } }>("/api/book-groups/:id", async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    db.transaction(() => {
      // Books are not deleted with the group — they fall back to "未分组".
      db.prepare("UPDATE books SET group_id = 0 WHERE group_id = ?").run(id);
      db.prepare("DELETE FROM book_groups WHERE id = ?").run(id);
    })();
    return reply.send({ ok: true });
  });
}
