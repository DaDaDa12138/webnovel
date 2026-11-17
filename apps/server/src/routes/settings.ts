import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { allSettings } from "../services/settings.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => allSettings());

  app.put("/api/settings", async (req) => {
    const body = (req.body ?? {}) as Record<string, string | number | boolean>;
    const stmt = getDb().prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    const tx = getDb().transaction((entries: Array<[string, string]>) => {
      for (const [key, value] of entries) stmt.run(key, value);
    });
    tx(Object.entries(body).map(([key, value]) => [key, String(value)] as [string, string]));
    return { ok: true };
  });

  app.get("/api/export", async (_req, reply) => {
    const rows = getDb().prepare("SELECT json FROM book_sources WHERE enabled = 1 ORDER BY id").all() as Array<{ json: string }>;
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="legado-sources.json"');
    return "[" + rows.map((r) => r.json).join(",") + "]";
  });
}
