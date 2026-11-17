import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { migrations } from "./migrations.js";
import { sourceKey } from "../services/normalize.js";
import { backfillSourceHealth } from "../services/health.js";

export type DB = Database.Database;

let conn: DB | null = null;

export function getDb(): DB {
  if (conn) return conn;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(path.join(config.dataDir, "legado.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  rekeySources(db);
  const backfilled = backfillSourceHealth(db);
  if (backfilled) console.log(`[db] backfilled health for ${backfilled} sources`);
  conn = db;
  return db;
}

/**
 * Recompute host_key for every source (protocol-agnostic) and merge duplicates.
 * Runs on startup so that a rule change does not create duplicates on the next import.
 */
function rekeySources(db: DB): void {
  const rows = db.prepare("SELECT id, url, name, host_key FROM book_sources").all() as Array<{
    id: number;
    url: string;
    name: string;
    host_key: string;
  }>;
  if (!rows.length) return;
  const seen = new Map<string, number>();
  const updates: Array<{ id: number; key: string }> = [];
  const removals: number[] = [];
  for (const row of rows) {
    const key = sourceKey(row.url, row.name);
    if (seen.has(key)) {
      removals.push(row.id);
      continue;
    }
    seen.set(key, row.id);
    if (key !== row.host_key) updates.push({ id: row.id, key });
  }
  if (!updates.length && !removals.length) return;
  const temp = db.prepare("UPDATE book_sources SET host_key = ? WHERE id = ?");
  const final = db.prepare("UPDATE book_sources SET host_key = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM book_sources WHERE id = ?");
  db.transaction(() => {
    for (const item of updates) temp.run("__rekey_" + item.id, item.id);
    for (const item of updates) final.run(item.key, item.id);
    for (const id of removals) remove.run(id);
  })();
  if (removals.length || updates.length) {
    console.log(`[db] rekeyed ${updates.length} sources, merged ${removals.length} duplicates`);
  }
}

function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  const pending = migrations.filter((m) => m.version > current);
  if (!pending.length) return;
  // Destructive-looking migrations (new columns are additive, but a bad run still deserves a
  // way back) get one file-level snapshot before the first pending step.
  if (current > 0) backupDatabase(db, current);
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  console.log(`[db] migrated to v${db.pragma("user_version", { simple: true })}`);
}

function backupDatabase(db: DB, fromVersion: number): void {
  const source = path.join(config.dataDir, "legado.db");
  if (!fs.existsSync(source)) return;
  try {
    // Fold the WAL into the main file first, otherwise the copy can miss recent rows.
    db.pragma("wal_checkpoint(TRUNCATE)");
    const dir = path.join(config.dataDir, "backup");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const target = path.join(dir, `legado-v${fromVersion}-${stamp}.db`);
    fs.copyFileSync(source, target);
    console.log(`[db] backup written to ${target}`);
  } catch (err) {
    console.warn("[db] backup failed:", (err as Error).message);
  }
}
