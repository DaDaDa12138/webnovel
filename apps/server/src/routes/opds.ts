import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { exportBook } from "../services/books/export.js";
import { listShelf } from "../services/books/shelf.js";
import { getBook } from "../services/books/store.js";
import {
  buildOpdsRoot,
  buildOpdsSearchDescription,
  buildOpdsShelf,
  filterOpdsBooks,
  normalizeOpdsSearch,
  type OpdsBook,
} from "../services/opds.js";

const FEED_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8";
const NAV_TYPE = "application/atom+xml;profile=opds-catalog;kind=navigation; charset=utf-8";

function originOf(req: FastifyRequest): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const proto = (raw ?? "").split(",")[0].trim() || req.protocol || "http";
  const host = req.headers.host || "127.0.0.1:" + config.port;
  return proto + "://" + host;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 一次查完当前页的缓存章数，避免每本书一条 COUNT。 */
function cachedCounts(ids: number[]): Map<number, number> {
  if (!ids.length) return new Map();
  const marks = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT c.book_id AS id, COUNT(*) AS n FROM chapters c
       JOIN chapter_contents cc ON cc.chapter_id = c.id
       WHERE c.book_id IN (${marks}) AND c.is_volume = 0
         AND (LENGTH(TRIM(cc.content)) > 0 OR LENGTH(TRIM(COALESCE(cc.images, ''))) > 2)
       GROUP BY c.book_id`,
    )
    .all(...ids) as Array<{ id: number; n: number }>;
  return new Map(rows.map((row) => [Number(row.id), Number(row.n)]));
}

function toOpdsBook(item: ReturnType<typeof listShelf>[number], cached: Map<number, number>): OpdsBook {
  return {
    id: item.id,
    name: item.name,
    author: item.author,
    intro: item.intro,
    coverUrl: item.coverUrl,
    sourceId: item.sourceId,
    updatedAt: item.updatedAt,
    chapterCount: item.chapterCount,
    cachedChapters: cached.get(item.id) ?? 0,
  };
}

export async function opdsRoutes(app: FastifyInstance): Promise<void> {
  const root = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const books = listShelf({ inShelf: "1" });
    reply.header("cache-control", "no-cache");
    return reply.type(NAV_TYPE).send(buildOpdsRoot(originOf(req), books.length));
  };

  app.get("/opds", root);
  app.get("/opds/", root);

  const shelf = async (
    req: FastifyRequest<{ Querystring: { page?: string; size?: string; search?: string } }>,
    reply: import("fastify").FastifyReply,
  ) => {
    const search = normalizeOpdsSearch(req.query.search);
    const all = listShelf({ inShelf: "1", sort: "updated" });
    const matched = filterOpdsBooks(all, search);
    const page = positiveInt(req.query.page, 1);
    const size = Math.min(200, positiveInt(req.query.size, 50));
    const start = (page - 1) * size;
    const pageItems = matched.slice(start, start + size);
    const cached = cachedCounts(pageItems.map((item) => item.id));
    const feed = buildOpdsShelf(
      { books: pageItems.map((item) => toOpdsBook(item, cached)), total: matched.length, page, size, search },
      originOf(req),
    );
    reply.header("cache-control", "no-cache");
    return reply.type(FEED_TYPE).send(feed);
  };

  app.get<{ Querystring: { page?: string; size?: string; search?: string } }>("/opds/shelf", shelf);
  app.get<{ Querystring: { page?: string; size?: string; search?: string } }>("/opds/shelf/", shelf);

  app.get("/opds/search.xml", async (req, reply) => {
    reply.header("cache-control", "no-cache");
    return reply
      .type("application/opensearchdescription+xml; charset=utf-8")
      .send(buildOpdsSearchDescription(originOf(req)));
  });

  app.get<{ Params: { id: string } }>("/opds/books/:id/epub", async (req, reply) => {
    const book = getBook(Number(req.params.id));
    if (!book) return reply.code(404).send({ error: "not_found", message: "书籍不存在" });
    const result = exportBook(book, "epub");
    if (!result.chapters) {
      return reply
        .code(409)
        .send({ error: "no_cached_chapters", message: "还没有缓存任何章节：先在 legado-web 打开几章，或用「整本离线」下载后再导出" });
    }
    // RFC 5987 的 attr-char 不含括号与星号；encodeURIComponent 会原样留下它们。
    const encoded = encodeURIComponent(result.filename).replace(/['()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
    reply.header("content-type", "application/epub+zip");
    reply.header("content-disposition", `attachment; filename="book-${book.id}.epub"; filename*=UTF-8''${encoded}`);
    reply.header("x-export-chapters", `${result.chapters}/${result.total}`);
    reply.header("cache-control", "no-cache");
    return reply.send(result.body);
  });
}
