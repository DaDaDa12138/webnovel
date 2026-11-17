import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

const HASH = /^[0-9a-f]{32}$/;
const FILE = /^[0-9a-f]{16}\.(png|jpe?g|gif|webp|svg)$/i;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * 本地导入 EPUB 的插图：文件名是内容哈希，内容永远不会变，可以放心长缓存。
 * 只接受固定形状的路径，避免把 data 目录里的其它文件读出去。
 */
export async function localImageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { hash: string; file: string } }>("/api/local-images/:hash/:file", async (request, reply) => {
    const { hash, file } = request.params;
    if (!HASH.test(hash) || !FILE.test(file)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
    const type = TYPES[ext];
    if (!type) return reply.code(404).send({ error: "not_found" });
    try {
      const body = await readFile(path.join(config.dataDir, "local-images", hash, file));
      return reply
        .type(type)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .send(body);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });
}
