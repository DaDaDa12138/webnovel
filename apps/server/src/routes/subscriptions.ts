import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { fetchText } from "@legado/engine";
import { getDb } from "../db/index.js";
import { importSources, normalizePayload } from "../services/importer.js";

interface SubRow {
  id: number;
  name: string;
  url: string;
  type: string;
  enabled: number;
  etag: string;
  last_modified: string;
  last_fetch_at: string | null;
  last_hash: string;
  auto_refresh: number;
}

function getSetting(key: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? "";
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

async function refreshOne(row: SubRow): Promise<{ added: number; updated: number; total: number; skipped: boolean }> {
  const db = getDb();
  const headers: Record<string, string> = {};
  if (row.etag) headers["if-none-match"] = row.etag;
  if (row.last_modified) headers["if-modified-since"] = row.last_modified;
  let body = "";
  let etag = row.etag;
  let lastModified = row.last_modified;
  try {
    const res = await fetchText(row.url, { headers, timeoutMs: 30_000, retry: 1 });
    if (res.status === 304) return { added: 0, updated: 0, total: 0, skipped: true };
    body = res.body;
    etag = res.headers["etag"] ?? etag;
    lastModified = res.headers["last-modified"] ?? lastModified;
  } catch (err) {
    db.prepare("UPDATE subscriptions SET last_fetch_at = datetime('now') WHERE id = ?").run(row.id);
    throw new Error("订阅拉取失败：" + String((err as Error).message));
  }
  const hash = createHash("sha1").update(body).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("订阅内容不是合法 JSON");
  }
  const list = normalizePayload(parsed);
  const result = importSources(db, list, { subscriptionId: row.id });
  db.prepare("UPDATE subscriptions SET etag = ?, last_modified = ?, last_hash = ?, last_fetch_at = datetime('now') WHERE id = ?").run(
    etag,
    lastModified,
    hash,
    row.id,
  );
  return { added: result.inserted, updated: result.updated, total: result.total, skipped: false };
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/subscriptions", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM subscriptions ORDER BY id DESC").all() as SubRow[];
    const items = rows.map((row) => {
      const count = (db.prepare("SELECT COUNT(*) AS n FROM book_sources WHERE subscription_id = ?").get(row.id) as { n: number }).n;
      return { ...row, enabled: Boolean(row.enabled), autoRefresh: Boolean(row.auto_refresh), count };
    });
    const token = getSetting("publish_token");
    return {
      items,
      publish: token
        ? { token, url: "/api/sub/" + token + ".json" }
        : null,
    };
  });

  app.post("/api/subscriptions", async (req, reply) => {
    const body = req.body as { name?: string; url?: string; type?: string } | undefined;
    const url = (body?.url ?? "").trim();
    if (!url) return reply.code(400).send({ error: "missing_url" });
    const db = getDb();
    const name = (body?.name ?? "").trim() || url.replace(/^https?:\/\//, "").slice(0, 40);
    const existing = db.prepare("SELECT * FROM subscriptions WHERE url = ?").get(url) as SubRow | undefined;
    if (existing) {
      const result = await refreshOne(existing).catch((err) => ({ error: String((err as Error).message) }));
      return { id: existing.id, created: false, refresh: result };
    }
    const info = db
      .prepare("INSERT INTO subscriptions (name, url, type) VALUES (?, ?, ?)")
      .run(name, url, body?.type ?? "bookSource");
    const id = Number(info.lastInsertRowid);
    const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as SubRow;
    const refresh = await refreshOne(row).catch((err) => ({ error: String((err as Error).message) }));
    return { id, created: true, refresh };
  });

  app.post<{ Params: { id: string } }>("/api/subscriptions/:id/refresh", async (req, reply) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(Number(req.params.id)) as SubRow | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    try {
      return await refreshOne(row);
    } catch (err) {
      return reply.code(502).send({ error: String((err as Error).message) });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/subscriptions/:id", async (req) => {
    const body = (req.body ?? {}) as { name?: string; enabled?: boolean; autoRefresh?: boolean };
    const db = getDb();
    if (body.name !== undefined) db.prepare("UPDATE subscriptions SET name = ? WHERE id = ?").run(body.name, Number(req.params.id));
    if (body.enabled !== undefined) db.prepare("UPDATE subscriptions SET enabled = ? WHERE id = ?").run(body.enabled ? 1 : 0, Number(req.params.id));
    if (body.autoRefresh !== undefined)
      db.prepare("UPDATE subscriptions SET auto_refresh = ? WHERE id = ?").run(body.autoRefresh ? 1 : 0, Number(req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/subscriptions/:id", async (req) => {
    getDb().prepare("DELETE FROM subscriptions WHERE id = ?").run(Number(req.params.id));
    return { ok: true };
  });

  app.post("/api/subscriptions/publish", async () => {
    let token = getSetting("publish_token");
    if (!token) {
      token = randomBytes(12).toString("hex");
      setSetting("publish_token", token);
    }
    return { token, url: "/api/sub/" + token + ".json" };
  });

  app.delete("/api/subscriptions/publish", async () => {
    getDb().prepare("DELETE FROM settings WHERE key = 'publish_token'").run();
    return { ok: true };
  });

  app.get<{ Params: { file: string } }>("/api/sub/:file", async (req, reply) => {
    const file = req.params.file;
    const match = /^([0-9a-f]{8,64})\.json$/.exec(file);
    if (!match || match[1] !== getSetting("publish_token")) return reply.code(404).send({ error: "not_found" });
    const rows = getDb().prepare("SELECT json FROM book_sources WHERE enabled = 1 ORDER BY id").all() as Array<{ json: string }>;
    const body = "[" + rows.map((r) => r.json).join(",") + "]";
    const etag = '"' + createHash("sha1").update(body).digest("hex") + '"';
    if (req.headers["if-none-match"] === etag) {
      reply.code(304);
      return "";
    }
    reply.header("etag", etag);
    reply.header("cache-control", "no-cache");
    reply.header("content-type", "application/json; charset=utf-8");
    return body;
  });
}
