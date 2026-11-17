import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { REPLACE_PRESETS } from "../services/replace-presets.js";

interface RuleRow {
  id: number;
  name: string;
  pattern: string;
  replacement: string;
  scope: string;
  is_regex: number;
  enabled: number;
  order_no: number;
}

export function applyReplaceRules(text: string, scope = "content"): string {
  const rows = getDb()
    .prepare("SELECT * FROM replace_rules WHERE enabled = 1 AND (scope = ? OR scope = 'all') ORDER BY order_no ASC, id ASC")
    .all(scope) as RuleRow[];
  let out = text;
  for (const row of rows) {
    try {
      if (row.is_regex) out = out.replace(new RegExp(row.pattern, "g"), row.replacement);
      else out = out.split(row.pattern).join(row.replacement);
    } catch {
      /* ignore broken rule */
    }
  }
  return out;
}

export async function replaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/replace-rules", async () => {
    const rows = getDb().prepare("SELECT * FROM replace_rules ORDER BY order_no ASC, id ASC").all() as RuleRow[];
    return { items: rows.map((r) => ({ ...r, enabled: Boolean(r.enabled), isRegex: Boolean(r.is_regex) })) };
  });

  app.get("/api/replace-rules/presets", async () => {
    const installed = new Set(
      (getDb().prepare("SELECT pattern FROM replace_rules").all() as Array<{ pattern: string }>).map((row) => row.pattern),
    );
    return { items: REPLACE_PRESETS.map((preset) => ({ ...preset, installed: installed.has(preset.pattern) })) };
  });

  app.post<{ Body: { keys?: string[] } }>("/api/replace-rules/presets", async (req) => {
    const body = req.body ?? {};
    const wanted = new Set((body.keys ?? []).map(String));
    const presets = wanted.size ? REPLACE_PRESETS.filter((preset) => wanted.has(preset.key)) : REPLACE_PRESETS;
    const db = getDb();
    const existing = new Set((db.prepare("SELECT pattern FROM replace_rules").all() as Array<{ pattern: string }>).map((row) => row.pattern));
    const insert = db.prepare(
      "INSERT INTO replace_rules (name, pattern, replacement, scope, is_regex, enabled, order_no) VALUES (?, ?, ?, ?, 1, 1, ?)",
    );
    let added = 0;
    let skipped = 0;
    const addedKeys: string[] = [];
    const run = db.transaction(() => {
      presets.forEach((preset, index) => {
        if (existing.has(preset.pattern)) {
          skipped += 1;
          return;
        }
        insert.run(preset.name, preset.pattern, preset.replacement, preset.scope, 100 + index);
        existing.add(preset.pattern);
        added += 1;
        addedKeys.push(preset.key);
      });
    });
    run();
    return { ok: true, added, skipped, keys: addedKeys };
  });

  app.post("/api/replace-rules", async (req, reply) => {
    const body = req.body as Partial<RuleRow> | undefined;
    if (!body?.pattern) return reply.code(400).send({ error: "missing_pattern" });
    const info = getDb()
      .prepare("INSERT INTO replace_rules (name, pattern, replacement, scope, is_regex, enabled, order_no) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(body.name ?? "", body.pattern, body.replacement ?? "", body.scope ?? "content", body.is_regex ? 1 : 0, body.enabled === 0 ? 0 : 1, body.order_no ?? 0);
    return { id: Number(info.lastInsertRowid) };
  });

  app.patch<{ Params: { id: string } }>("/api/replace-rules/:id", async (req) => {
    const body = (req.body ?? {}) as Partial<RuleRow>;
    const db = getDb();
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (key === "id") continue;
      const column = key === "isRegex" ? "is_regex" : key;
      fields.push(column + " = ?");
      params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }
    if (fields.length) db.prepare("UPDATE replace_rules SET " + fields.join(", ") + " WHERE id = ?").run(...params, Number(req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/replace-rules/:id", async (req) => {
    getDb().prepare("DELETE FROM replace_rules WHERE id = ?").run(Number(req.params.id));
    return { ok: true };
  });

  app.post("/api/replace-rules/test", async (req, reply) => {
    const body = req.body as { text?: string; scope?: string } | undefined;
    if (!body?.text) return reply.code(400).send({ error: "missing_text" });
    return { result: applyReplaceRules(body.text, body.scope ?? "content") };
  });
}
