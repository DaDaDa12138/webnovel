import type { FastifyInstance } from "fastify";
import { importEpubBook } from "../services/books/import-epub.js";
import { importTxtBook } from "../services/books/import-txt.js";

export async function importRoutes(app: FastifyInstance) {
  app.post("/api/import/txt", async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; author?: string; content?: string };
    const result = importTxtBook(body);
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.code(201).send(result.payload);
  });

  // EPUB 是二进制，走 application/octet-stream；文件名放查询串里。
  app.post("/api/import/epub", async (request, reply) => {
    const query = (request.query ?? {}) as { name?: string };
    const buffer = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const result = importEpubBook({ name: query.name, buffer });
    if (!result.ok) return reply.code(result.status).send(result.body);
    return reply.code(201).send(result.payload);
  });
}
