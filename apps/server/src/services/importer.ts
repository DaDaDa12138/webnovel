import type { DB } from "../db/index.js";
import { sourceKey } from "./normalize.js";
import { auditSource } from "./source-audit.js";

export interface ImportOptions {
  status?: string;
  subscriptionId?: number | null;
}

export interface ImportAudit {
  index: number;
  name: string;
  errors: number;
  warnings: number;
  issues: Array<{ code: string; severity: string; field: string; message: string }>;
}

export interface ImportResult {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
  audits: ImportAudit[];
}

interface IncomingSource {
  bookSourceName?: unknown;
  bookSourceUrl?: unknown;
  bookSourceGroup?: unknown;
  bookSourceType?: unknown;
  enabled?: unknown;
  enabledExplore?: unknown;
  customOrder?: unknown;
  [key: string]: unknown;
}

export function normalizePayload(raw: unknown): IncomingSource[] {
  if (Array.isArray(raw)) return raw as IncomingSource[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.bookSources)) return obj.bookSources as IncomingSource[];
    if (Array.isArray(obj.data)) return obj.data as IncomingSource[];
    if (typeof obj.bookSourceUrl === "string") return [obj as IncomingSource];
  }
  return [];
}

export function importSources(db: DB, raw: unknown, opts: ImportOptions = {}): ImportResult {
  const list = normalizePayload(raw);
  const result: ImportResult = { total: list.length, inserted: 0, updated: 0, skipped: 0, errors: [], audits: [] };
  const status = opts.status ?? "unknown";

  const find = db.prepare<[string], { id: number }>("SELECT id FROM book_sources WHERE host_key = ?");
  const insert = db.prepare(`
    INSERT INTO book_sources
      (name, url, host_key, group_name, type, enabled, enabled_explore, custom_order, json, status, subscription_id)
    VALUES
      (@name, @url, @hostKey, @groupName, @type, @enabled, @enabledExplore, @customOrder, @json, @status, @subscriptionId)
  `);
  const update = db.prepare(`
    UPDATE book_sources SET
      name = @name, url = @url, group_name = @groupName, type = @type,
      enabled = @enabled, enabled_explore = @enabledExplore, custom_order = @customOrder,
      json = @json,
      subscription_id = COALESCE(@subscriptionId, subscription_id),
      updated_at = datetime('now')
    WHERE id = @id
  `);

  const run = db.transaction(() => {
    list.forEach((src, index) => {
      const name = typeof src.bookSourceName === "string" ? src.bookSourceName.trim() : "";
      const url = typeof src.bookSourceUrl === "string" ? src.bookSourceUrl.trim() : "";
      if (!name || !url) {
        result.skipped += 1;
        result.errors.push({ index, message: "missing bookSourceName or bookSourceUrl" });
        return;
      }
      const values = {
        name,
        url,
        hostKey: sourceKey(url, name),
        groupName: typeof src.bookSourceGroup === "string" ? src.bookSourceGroup : "",
        type: typeof src.bookSourceType === "number" ? src.bookSourceType : 0,
        enabled: src.enabled === false ? 0 : 1,
        // A source without exploreUrl cannot power the discovery page, even when the
        // imported JSON carries enabledExplore: true. This keeps the picker honest.
        enabledExplore: src.enabledExplore === false || !String(src.exploreUrl ?? "").trim() ? 0 : 1,
        customOrder: typeof src.customOrder === "number" ? src.customOrder : 0,
        json: JSON.stringify(src),
        status,
        subscriptionId: opts.subscriptionId ?? null,
      };
      const audit = auditSource(src as never);
      if (audit.errors || audit.warnings) {
        result.audits.push({
          index,
          name,
          errors: audit.errors,
          warnings: audit.warnings,
          issues: audit.issues.filter((issue) => issue.severity !== "info").slice(0, 8),
        });
      }
      const existing = find.get(values.hostKey);
      if (existing) {
        update.run({ ...values, id: existing.id });
        result.updated += 1;
      } else {
        insert.run(values);
        result.inserted += 1;
      }
    });
  });
  run();
  return result;
}
