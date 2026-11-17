import Database from "better-sqlite3";
const dbPath = process.env.DB_PATH ?? new URL("../../data/legado.db", import.meta.url).pathname;
const db = new Database(dbPath, { readonly: process.argv[2] !== "--write" });
const sql = process.argv.slice(2).filter((a) => a !== "--write").join(" ");
if (!sql) {
  console.log("usage: node tools/db.mjs [--write] '<sql>'");
  process.exit(0);
}
const stmt = db.prepare(sql);
console.log(stmt.reader ? JSON.stringify(stmt.all(), null, 1) : JSON.stringify(stmt.run()));
