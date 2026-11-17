import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { sourcesRoutes } from "./routes/sources.js";
import { searchRoutes } from "./routes/search.js";
import { booksRoutes } from "./routes/books.js";
import { exploreRoutes } from "./routes/explore.js";
import { debugRoutes } from "./routes/debug.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { replaceRoutes } from "./routes/replace.js";
import { settingsRoutes } from "./routes/settings.js";
import { imgRoutes } from "./routes/img.js";
import { localImageRoutes } from "./routes/local-images.js";
import { organizeRoutes } from "./routes/organize.js";
import { bookGroupRoutes } from "./routes/book-groups.js";
import { readingRoutes } from "./routes/reading.js";
import { bookListRoutes } from "./routes/book-lists.js";
import { ttsRoutes } from "./routes/tts.js";
import { importRoutes } from "./routes/import.js";
import { syncRoutes } from "./routes/sync.js";
import { shushanRoutes } from "./routes/shushan.js";
import { dahuilangRoutes } from "./routes/dahuilang.js";
import { notesRoutes } from "./routes/notes.js";

import { opdsRoutes } from "./routes/opds.js";
import { ensureShushanSource } from "./services/shushan.js";
import { ensureDahuilangSource } from "./services/dahuilang.js";
import { startShelfUpdater } from "./services/updater.js";
import { restoreAudit } from "./services/audit.js";
import { pruneSourceChecks } from "./services/health.js";
import { pruneSwitchCache } from "./services/switch-cache.js";

const appVersion = (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 32 * 1024 * 1024,
  });

  const db = getDb();
  // 上次进程退出时还在跑的巡检已经中断：恢复快照并标记，等用户点「继续上次」。
  restoreAudit(db);
  // 启动时做一次保留清理；失败不影响启动，页面仍可正常用。
  try {
    const checks = pruneSourceChecks(db);
    const switched = pruneSwitchCache();
    if (checks || switched) app.log.info({ checks, switched }, "pruned old health checks / switch cache");
  } catch (err) {
    app.log.warn({ err }, "retention cleanup failed");
  }

  // EPUB 导入是二进制上传：正文只有一份，直接用 buffer 解析，不落临时文件。
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/healthz", async () => {
    const db = getDb();
    const n = (db.prepare("SELECT COUNT(*) AS n FROM book_sources").get() as { n: number }).n;
    return { ok: true, sources: n, version: appVersion };
  });

  await app.register(sourcesRoutes);
  await app.register(searchRoutes);
  await app.register(booksRoutes);
  await app.register(exploreRoutes);
  await app.register(debugRoutes);
  await app.register(subscriptionRoutes);
  await app.register(replaceRoutes);
  await app.register(settingsRoutes);
  await app.register(imgRoutes);
  await app.register(localImageRoutes);
  await app.register(organizeRoutes);
  await app.register(bookGroupRoutes);
  await app.register(readingRoutes);
  await app.register(bookListRoutes);
  await app.register(ttsRoutes);
  await app.register(importRoutes);
  await app.register(syncRoutes);
  await app.register(shushanRoutes);
  await app.register(dahuilangRoutes);
  await app.register(notesRoutes);
  await app.register(opdsRoutes);
  // 内置聚合源每次启动都自检一次：老库没有这一行时补上，有则只刷新说明。
  ensureShushanSource();
  ensureDahuilangSource();
  startShelfUpdater();

  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}