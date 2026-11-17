import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/index.js";
import { importSources } from "../services/importer.js";
import { sourceKey } from "../services/normalize.js";

const corpusFiles = {
  all: "书源_规范化_全部_841站.json",
  ok: "书源_规范化_可用_605条.json",
  retest: "书源_规范化_待复测_48条.json",
  untested: "书源_规范化_未测_188条.json",
};

const cwd = process.cwd();
const candidates = [
  process.argv[2],
  process.env.CORPUS_DIR,
  path.resolve(cwd, "../../fixtures/corpus"),
  path.resolve(cwd, "fixtures/corpus"),
  path.resolve(cwd, "../../dist3"),
  path.resolve(cwd, "../dist3"),
  path.resolve(cwd, "../../../dist3"),
  path.resolve(cwd, "dist3"),
].filter((p): p is string => Boolean(p));

const dir = candidates.find((p) => fs.existsSync(path.join(p, corpusFiles.all)));
if (!dir) {
  console.error("corpus dir not found. tried:", candidates);
  process.exit(1);
}

const corpusDir: string = dir;

function read(name: string): unknown[] {
  return JSON.parse(fs.readFileSync(path.join(corpusDir, name), "utf8")) as unknown[];
}

const db = getDb();
const all = read(corpusFiles.all);
console.log(`importing ${all.length} canonical sources from ${dir}`);
const result = importSources(db, all, { status: "unknown" });
console.log("import:", result);

const statusMap = new Map<string, string>();
for (const [status, name] of [
  ["ok", corpusFiles.ok],
  ["retest", corpusFiles.retest],
  ["untested", corpusFiles.untested],
] as const) {
  for (const src of read(name)) {
    const { bookSourceUrl: url, bookSourceName: title } = src as { bookSourceUrl?: string; bookSourceName?: string };
    if (url) statusMap.set(sourceKey(url, title ?? ""), status);
  }
}

const update = db.prepare("UPDATE book_sources SET status = ? WHERE host_key = ?");
let touched = 0;
db.transaction(() => {
  for (const [key, status] of statusMap) touched += update.run(status, key).changes;
})();

console.log(`status updated: ${touched}`, db.prepare("SELECT status, COUNT(*) AS n FROM book_sources GROUP BY status").all());
console.log("total:", (db.prepare("SELECT COUNT(*) AS n FROM book_sources").get() as { n: number }).n);
