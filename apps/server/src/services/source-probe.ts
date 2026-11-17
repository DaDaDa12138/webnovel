import { BookSourceEngine, countContentChars, type BookInfo, type Chapter, type SearchBook } from "@legado/engine";
import type { HealthStage, SourceHealth, SourceProbeReport, StageHealth } from "@legado/shared";
import { getDb } from "../db/index.js";
import { loadSourceById } from "./engine.js";
import { recordStageResults } from "./health.js";
import { healthInPool, PoolUnavailableError } from "./search-pool.js";
import { runSourceProbe } from "./source-probe-core.js";
import {
  dahuilangBookInfo,
  dahuilangConfigured,
  dahuilangContent,
  dahuilangSearch,
  dahuilangToc,
  isDahuilangSource,
} from "./dahuilang.js";
import {
  isShushanSource,
  shushanBookInfo,
  shushanConfigured,
  shushanContent,
  shushanSearch,
  shushanToc,
} from "./shushan.js";

export type ProbeMode = "quick" | "full";

/** 主线程兜底体检：目录只取前 80 章，避免 1400 章站点逐条求值 JS 把 API 卡住。 */
const healthEngine = new BookSourceEngine({ timeoutMs: 20_000, maxTocPages: 5, tocLimit: 80, maxContentPages: 3 });

export interface ProbeOptions {
  mode?: ProbeMode;
  key?: string;
  bookUrl?: string;
  chapterUrl?: string;
}

const ORDER: HealthStage[] = ["search", "detail", "toc", "content"];

function messageOf(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 300);
}

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" ? code.slice(0, 80) : "";
}

/** 未登录/无会员是 blocked，不是 broken；其余才是硬失败。 */
function classifyError(err: unknown, stage: HealthStage): { status: "blocked" | "fail"; code: string; message: string } {
  const message = messageOf(err);
  const code = codeOf(err);
  if (code === "login_required" || code === "vip_required") {
    return { status: "blocked", code, message };
  }
  if (/api[_ ]?key|未配置|还没有登录|登录后|去.{0,12}登录|请先.{0,8}登录|登录.{0,8}(失效|过期)|login_required/i.test(message)) {
    return { status: "blocked", code: "login_required", message };
  }
  if (/vip|会员|付费|购买|订阅/i.test(message)) {
    return { status: "blocked", code: "vip_required", message };
  }
  return { status: "fail", code: code || stage + "_failed", message };
}

function now(): string {
  return new Date().toISOString();
}

function skipRest(
  stages: Partial<Record<HealthStage, StageHealth>>,
  from: HealthStage,
  message: string,
): void {
  const start = ORDER.indexOf(from);
  for (let i = start; i < ORDER.length; i += 1) {
    const stage = ORDER[i];
    if (!stages[stage]) stages[stage] = { status: "skip", at: now(), ms: 0, message };
  }
}

interface BuiltinProbeResult {
  stages: Partial<Record<HealthStage, StageHealth>>;
  samples: SourceProbeReport["samples"];
}

/**
 * 内置源（书山聚合 / 大灰狼聚合）不是规则书源，走 provider 的四阶段体检。
 * 与规则源共用同一套阶段语义：search → detail → toc → content。
 */
async function probeBuiltin(
  source: { bookSourceUrl?: string },
  options: ProbeOptions,
): Promise<BuiltinProbeResult> {
  const dhl = isDahuilangSource(source as never);
  const shushan = isShushanSource(source);
  const stages: Partial<Record<HealthStage, StageHealth>> = {};
  const samples: SourceProbeReport["samples"] = {};
  const full = options.mode !== "quick";
  let book: SearchBook | null = null;
  let info: BookInfo | null = null;
  let chapter: Chapter | null = null;
  let failed = false;

  const key = (options.key ?? "").trim() || "诡秘之主";
  const search = async (): Promise<SearchBook[]> => (dhl ? dahuilangSearch(key) : shushanSearch(key));

  if (dhl ? !dahuilangConfigured() : !shushanConfigured()) {
    stages.search = {
      status: "blocked",
      at: now(),
      ms: 0,
      code: "login_required",
      message: dhl
        ? "大灰狼聚合还没有登录：去「设置 → 大灰狼聚合」登录后再体检"
        : "书山聚合还没有登录：去「设置 → 书山聚合」登录后再体检",
    };
    skipRest(stages, "detail", "账号未配置，后续阶段跳过");
    return { stages, samples };
  }

  if (!options.bookUrl) {
    const started = Date.now();
    try {
      const books = await search();
      if (!books.length) {
        stages.search = { status: "empty", at: now(), ms: Date.now() - started, count: 0, code: "no_results", message: "搜索没有返回结果" };
        skipRest(stages, "detail", "搜索没有结果，无法继续测详情");
        return { stages, samples };
      }
      book = books[0];
      samples.bookUrl = book.bookUrl;
      stages.search = { status: "ok", at: now(), ms: Date.now() - started, count: books.length };
    } catch (err) {
      const classified = classifyError(err, "search");
      stages.search = { ...classified, at: now(), ms: Date.now() - started };
      skipRest(stages, "detail", "搜索失败，后续阶段跳过");
      return { stages, samples };
    }
  }

  if (!full) return { stages, samples };

  if (failed) {
    skipRest(stages, "detail", "前置阶段失败");
    return { stages, samples };
  }

  const detailStarted = Date.now();
  try {
    const targetUrl = options.bookUrl ?? book?.bookUrl ?? "";
    if (!targetUrl) throw new Error("没有可用的 bookUrl");
    info = dhl ? await dahuilangBookInfo(targetUrl) : await shushanBookInfo(targetUrl);
    book = info;
    samples.bookUrl = info.bookUrl;
    if (info.tocUrl) samples.tocUrl = info.tocUrl;
    stages.detail = { status: "ok", at: now(), ms: Date.now() - detailStarted, code: "detail_ok", message: "详情页已解析" };
  } catch (err) {
    failed = true;
    const classified = classifyError(err, "detail");
    stages.detail = { ...classified, at: now(), ms: Date.now() - detailStarted };
    skipRest(stages, "toc", "详情页失败，目录与正文跳过");
  }

  if (failed || !book || !info) {
    skipRest(stages, "toc", failed ? "前置阶段失败" : "没有详情页结果");
    return { stages, samples };
  }

  const tocStarted = Date.now();
  try {
    const chapters = dhl ? await dahuilangToc(info) : await shushanToc(info);
    const usable = chapters.filter((item) => !item.isVolume && Boolean(item.url));
    chapter = usable[0] ?? null;
    if (chapter) samples.chapterUrl = chapter.url;
    stages.toc = {
      status: usable.length ? "ok" : "empty",
      at: now(),
      ms: Date.now() - tocStarted,
      count: usable.length,
      ...(usable.length ? {} : { code: "empty_toc", message: "目录为空或只有卷名" }),
    };
  } catch (err) {
    failed = true;
    const classified = classifyError(err, "toc");
    stages.toc = { ...classified, at: now(), ms: Date.now() - tocStarted };
    skipRest(stages, "content", "目录失败，正文跳过");
  }

  if (failed || !chapter) {
    if (!stages.content) stages.content = { status: "skip", at: now(), ms: 0, message: "没有可测章节" };
    return { stages, samples };
  }

  const contentStarted = Date.now();
  try {
    const targetUrl = options.chapterUrl ?? chapter.url;
    const text = dhl ? await dahuilangContent(targetUrl, info.bookUrl) : await shushanContent(targetUrl, info.bookUrl);
    const chars = countContentChars(text);
    stages.content = {
      status: chars >= 120 ? "ok" : "empty",
      at: now(),
      ms: Date.now() - contentStarted,
      chars,
      ...(chars >= 120 ? {} : { code: "content_too_short", message: "正文为空或少于 120 字" }),
    };
    samples.chapterUrl = targetUrl;
  } catch (err) {
    const classified = classifyError(err, "content");
    stages.content = { ...classified, at: now(), ms: Date.now() - contentStarted };
  }

  return { stages, samples };
}

/** 规则源：优先 worker；线程池不可用/任务通道故障时回退主线程，不把通道故障算成源失败。 */
async function probeRule(
  source: Parameters<typeof runSourceProbe>[1],
  options: ProbeOptions,
  stages: HealthStage[],
): Promise<{ stages: Partial<Record<HealthStage, StageHealth>>; samples: SourceProbeReport["samples"]; debug: SourceProbeReport["debug"] }> {
  try {
    const result = await healthInPool(source, options.key ?? "", stages, 60_000);
    return { stages: result.stages, samples: result.samples, debug: result.debug };
  } catch (err) {
    if (!(err instanceof PoolUnavailableError)) {
      // 超时/worker 崩溃也可能是源本身卡死：先回退主线程再测一次，仍失败才记 fail。
    }
  }
  const debug: SourceProbeReport["debug"] = [];
  const fallback = await runSourceProbe(healthEngine, source, {
    key: options.key,
    bookUrl: options.bookUrl,
    chapterUrl: options.chapterUrl,
    stages,
  });
  return { stages: fallback.stages, samples: fallback.samples, debug };
}

/**
 * 单源体检入口：加载源 → 规则源/内置源分流 → 写健康快照与 source_checks。
 * 任何阶段失败都返回报告，只有源不存在/数据库写入失败才抛错。
 */
export async function probeSourceById(id: number, options: ProbeOptions = {}): Promise<SourceProbeReport> {
  const db = getDb();
  const loaded = loadSourceById(id);
  if (!loaded) throw new Error("书源不存在或规则 JSON 损坏");
  const mode: ProbeMode = options.mode === "quick" ? "quick" : "full";
  const stagesRequested: HealthStage[] = mode === "quick" ? ["search"] : ORDER;
  const started = Date.now();
  const builtin = isShushanSource(loaded.source) || isDahuilangSource(loaded.source);
  let result: BuiltinProbeResult & { debug?: SourceProbeReport["debug"] };
  if (builtin) {
    result = await probeBuiltin(loaded.source, { ...options, mode });
  } else {
    result = await probeRule(loaded.source, options, stagesRequested);
  }
  const elapsedMs = Date.now() - started;
  if (!Object.keys(result.stages).length) {
    result.stages.search = { status: "fail", at: now(), ms: elapsedMs, code: "probe_empty", message: "体检没有返回阶段结果" };
  }
  const health: SourceHealth = recordStageResults(db, id, result.stages, {
    active: true,
    elapsedMs,
    recordCheck: true,
  });
  const lastFail = stagesRequested.map((stage) => result.stages[stage]).find((entry) => entry?.status === "fail");
  return {
    sourceId: id,
    sourceName: String(loaded.row.name ?? ""),
    mode,
    elapsedMs,
    stages: result.stages,
    samples: result.samples,
    debug: result.debug ?? [],
    health,
    ...(lastFail ? { error: lastFail.message || lastFail.code || "体检失败" } : {}),
  };
}