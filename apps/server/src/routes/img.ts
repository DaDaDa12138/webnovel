import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { parseHeader, type BookSource } from "@legado/engine";
import { config } from "../config.js";
import { getDb } from "../db/index.js";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const MAX_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED = /^image\/(jpeg|jpg|png|webp|gif|bmp|avif|svg\+xml)/i;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "[::1]" || host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function cachePath(key: string): string {
  const dir = path.join(config.dataDir, "img-cache");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, key.slice(0, 2), key);
}

function readCache(key: string): { body: Buffer; type: string } | null {
  const file = cachePath(key);
  try {
    const meta = JSON.parse(fs.readFileSync(file + ".json", "utf8")) as { type: string; at: number };
    if (Date.now() - meta.at > CACHE_TTL_MS) return null;
    return { body: fs.readFileSync(file), type: meta.type };
  } catch {
    return null;
  }
}

function writeCache(key: string, body: Buffer, type: string): void {
  const file = cachePath(key);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    fs.writeFileSync(file + ".json", JSON.stringify({ type, at: Date.now() }));
  } catch {
    /* cache is best effort */
  }
}

function sourceReferer(sourceId: number, target: string): { referer: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  let referer = "";
  if (sourceId > 0) {
    const row = getDb().prepare("SELECT json FROM book_sources WHERE id = ?").get(sourceId) as { json: string } | undefined;
    if (row) {
      try {
        const source = JSON.parse(row.json) as BookSource;
        const custom = parseHeader(source.header);
        Object.assign(headers, custom);
        referer = source.bookSourceUrl || "";
      } catch {
        /* ignore broken source json */
      }
    }
  }
  if (!referer) {
    try {
      referer = new URL(target).origin + "/";
    } catch {
      referer = "";
    }
  }
  return { referer, headers };
}

export async function imgRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { u?: string; s?: string } }>("/api/img", async (req, reply) => {
    const raw = (req.query.u ?? "").trim();
    const sourceId = Number(req.query.s ?? 0) || 0;
    if (!raw) return reply.code(400).send({ error: "missing_url" });
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return reply.code(400).send({ error: "bad_url" });
    }
    if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) {
      return reply.code(400).send({ error: "blocked_url" });
    }
    const key = crypto.createHash("sha1").update(target.toString()).digest("hex");
    const cached = readCache(key);
    if (cached) {
      reply.header("cache-control", "public, max-age=604800, immutable");
      reply.header("content-type", cached.type);
      return reply.send(cached.body);
    }
    const { referer, headers } = sourceReferer(sourceId, target.toString());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(target, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "user-agent": MOBILE_UA,
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          ...(referer ? { referer } : {}),
          ...headers,
        },
      });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!res.ok || !ALLOWED.test(type)) {
        reply.header("cache-control", "public, max-age=3600");
        return reply.code(404).send({ error: "not_an_image", status: res.status, type });
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES) return reply.code(413).send({ error: "too_large" });
      writeCache(key, buffer, type);
      reply.header("cache-control", "public, max-age=604800, immutable");
      reply.header("content-type", type);
      return reply.send(buffer);
    } catch (err) {
      reply.header("cache-control", "public, max-age=600");
      return reply.code(502).send({ error: "fetch_failed", message: String((err as Error).message) });
    } finally {
      clearTimeout(timer);
    }
  });
}
