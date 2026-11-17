import type { FastifyInstance } from "fastify";
import { listNotes } from "../services/books/annotations.js";

/**
 * 笔记中心：跨书列出全部划线与批注。
 *
 * 单条标注的增删改仍在 /api/books/:id/annotations 下——那里有书归属校验，
 * 这里只做「看全部」的读接口，避免把写路径摊平到没有 bookId 的地址上。
 */
export async function notesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; type?: string; limit?: string; offset?: string } }>(
    "/api/notes",
    async (req, reply) => {
      const result = listNotes({
        q: req.query.q,
        type: req.query.type,
        limit: Number(req.query.limit),
        offset: Number(req.query.offset),
      });
      return reply.send(result);
    },
  );
}
