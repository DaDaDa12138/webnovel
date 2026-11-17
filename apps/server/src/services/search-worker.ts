import { parentPort } from "node:worker_threads";
import { BookSourceEngine, type BookSource, type BookInfo, type SearchBook } from "@legado/engine";
import type { HealthStage } from "@legado/shared";
import { runSourceProbe } from "./source-probe-core.js";

/**
 * 搜索工作线程。
 *
 * 书源规则里的 JS、正则、cheerio 解析都是同步 CPU 活，放在主线程会把 HTTP 服务、
 * SSE 推送、甚至 sqlite 写入一起按住（实测单个书源能卡 4~5 秒）。这里把「一个源
 * 的一次搜索」和「一个源的详情页 + 目录」整体丢进 worker，主线程只负责调度与落库。
 */
const engine = new BookSourceEngine({
  timeoutMs: 12_000,
  maxTocPages: 50,
  maxContentPages: 20,
});

interface Task {
  id: number;
  /** 缺省是搜索；probe 表示「详情页 + 目录」，供换源候选探测用。 */
  kind?: "search" | "probe" | "health";
  source: BookSource;
  key?: string;
  bookUrl?: string;
  stages?: HealthStage[];
}

parentPort?.on("message", async (task: Task) => {
  try {
    if (task.kind === "health") {
      const debug: Array<{ stage: string; url?: string; message?: string; data?: unknown }> = [];
      const healthEngine = new BookSourceEngine({
        timeoutMs: 12_000,
        maxTocPages: 5,
        tocLimit: 80,
        maxContentPages: 3,
        onDebug: (event) => {
          if (debug.length < 80) debug.push(event);
        },
      });
      const result = await runSourceProbe(healthEngine, task.source, {
        key: task.key,
        bookUrl: task.bookUrl,
        stages: task.stages,
      });
      parentPort?.postMessage({ id: task.id, stages: result.stages, samples: result.samples, debug });
      return;
    }
    if (task.kind === "probe") {
      const info: BookInfo = await engine.bookInfo(task.source, String(task.bookUrl ?? ""));
      let chapters = 0;
      let tocError = "";
      try {
        chapters = (await engine.toc(task.source, info)).length;
      } catch (err) {
        tocError = String((err as Error)?.message ?? err).slice(0, 200);
      }
      parentPort?.postMessage({ id: task.id, info, chapters, tocError });
      return;
    }
    const books: SearchBook[] = await engine.search(task.source, task.key ?? "", 1);
    parentPort?.postMessage({ id: task.id, books });
  } catch (err) {
    parentPort?.postMessage({ id: task.id, error: String((err as Error)?.message ?? err).slice(0, 300) });
  }
});
