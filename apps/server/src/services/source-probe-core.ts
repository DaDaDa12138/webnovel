import {
  BookSourceEngine,
  countContentChars,
  type BookSource,
  type BookInfo,
  type Chapter,
  type SearchBook,
} from "@legado/engine";
import type { HealthStage, StageHealth } from "@legado/shared";

export interface ProbeRunResult {
  stages: Partial<Record<HealthStage, StageHealth>>;
  samples: { bookUrl?: string; tocUrl?: string; chapterUrl?: string };
}

export interface RunProbeOptions {
  key?: string;
  /** 跳过搜索，直接从这本书的详情页开始。 */
  bookUrl?: string;
  /** 跳过目录定位，直接测这一章正文。 */
  chapterUrl?: string;
  /** 只跑指定阶段；quick 模式只传 search。 */
  stages?: HealthStage[];
  /** 搜索返回多条结果时，最多尝试几条详情/目录，避免第一条是作者页或分类页时误判。默认 3。 */
  maxCandidates?: number;
  now?: () => string;
}

const ORDER: HealthStage[] = ["search", "detail", "toc", "content"];

function errorText(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 300);
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" ? code.slice(0, 80) : "";
}

interface CandidateAttempt {
  book: BookInfo | null;
  chapter: Chapter | null;
  detail: StageHealth;
  toc?: StageHealth;
}

function attemptScore(attempt: CandidateAttempt): number {
  if (attempt.chapter && attempt.toc?.status === "ok") return 3;
  if (attempt.detail.status === "ok" && attempt.toc?.status === "empty") return 2;
  if (attempt.detail.status === "ok") return 1;
  return 0;
}

/**
 * 规则源的阶段体检。只依赖 @legado/engine，方便 worker 与主线程共用。
 *
 * 顺序 search → detail → toc → content；前置阶段失败或目录为空时，后续阶段记 skip，
 * 不把「没机会测」误算成「测了失败」。content 只取第一非卷章，避免体检变成抓整本。
 *
 * 搜索第一条结果可能是作者页、分类页或聚合页，目录为空并不代表书源失效；
 * 因此默认再试下一条搜索结果，选目录真正可用的那条作为体检样本。
 */
export async function runSourceProbe(
  engine: BookSourceEngine,
  source: BookSource,
  options: RunProbeOptions = {},
): Promise<ProbeRunResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const requested = new Set<HealthStage>(options.stages?.length ? options.stages : ORDER);
  const maxCandidates = Math.max(1, options.maxCandidates ?? 3);
  const stages: ProbeRunResult["stages"] = {};
  const samples: ProbeRunResult["samples"] = {};
  let failed = false;
  let candidates: SearchBook[] = [];
  let book: BookInfo | null = null;
  let chapter: Chapter | null = null;

  const skipRest = (from: HealthStage, message: string): void => {
    const start = ORDER.indexOf(from);
    for (let i = start; i < ORDER.length; i += 1) {
      const stage = ORDER[i];
      if (!requested.has(stage) || stages[stage]) continue;
      stages[stage] = { status: "skip", at: now(), ms: 0, message };
    }
  };

  if (requested.has("search") && !options.bookUrl) {
    const started = Date.now();
    try {
      const books = await engine.search(source, options.key ?? "", 1);
      if (books.length > 0) {
        candidates = books;
        samples.bookUrl = books[0].bookUrl;
        stages.search = { status: "ok", at: now(), ms: Date.now() - started, count: books.length };
      } else {
        stages.search = { status: "empty", at: now(), ms: Date.now() - started, count: 0, code: "no_results", message: "搜索没有返回结果" };
        skipRest("detail", "搜索没有结果，无法继续测详情");
        return { stages, samples };
      }
    } catch (err) {
      failed = true;
      stages.search = {
        status: "fail",
        at: now(),
        ms: Date.now() - started,
        code: errorCode(err) || "search_failed",
        message: errorText(err),
      };
      skipRest("detail", "搜索失败，后续阶段跳过");
      return { stages, samples };
    }
  }

  if (requested.has("detail") || requested.has("toc")) {
    if (failed) {
      skipRest("detail", "前置阶段失败");
    } else {
      const list: SearchBook[] = options.bookUrl
        ? [{ bookUrl: options.bookUrl } as SearchBook]
        : candidates;
      if (list.length === 0) {
        skipRest("detail", "没有可测的书籍地址");
      } else {
        const probeCandidate = async (candidate: SearchBook): Promise<CandidateAttempt> => {
          const detailStarted = Date.now();
          let info: BookInfo | null = null;
          let detail: StageHealth;
          try {
            info = await engine.bookInfo(source, candidate.bookUrl);
            if (!info?.bookUrl) throw new Error("详情页没有解析到 bookUrl");
            detail = { status: "ok", at: now(), ms: Date.now() - detailStarted, code: "detail_ok", message: "详情页已解析" };
          } catch (err) {
            return {
              book: null,
              chapter: null,
              detail: {
                status: "fail",
                at: now(),
                ms: Date.now() - detailStarted,
                code: errorCode(err) || "detail_failed",
                message: errorText(err),
              },
            };
          }

          if (!requested.has("toc")) return { book: info, chapter: null, detail };

          const tocStarted = Date.now();
          try {
            const chapters = await engine.toc(source, info);
            const usable = chapters.filter((item) => !item.isVolume && Boolean(item.url));
            return {
              book: info,
              chapter: usable[0] ?? null,
              detail,
              toc: {
                status: usable.length > 0 ? "ok" : "empty",
                at: now(),
                ms: Date.now() - tocStarted,
                count: usable.length,
                ...(usable.length ? {} : { code: "empty_toc", message: "目录为空或只有卷名" }),
              },
            };
          } catch (err) {
            return {
              book: info,
              chapter: null,
              detail,
              toc: {
                status: "fail",
                at: now(),
                ms: Date.now() - tocStarted,
                code: errorCode(err) || "toc_failed",
                message: errorText(err),
              },
            };
          }
        };

        let best: CandidateAttempt | null = null;
        let chosen: CandidateAttempt | null = null;
        for (const candidate of list.slice(0, maxCandidates)) {
          const attempt = await probeCandidate(candidate);
          if (!best || attemptScore(attempt) > attemptScore(best)) best = attempt;
          if (attempt.chapter && attempt.toc?.status === "ok") {
            chosen = attempt;
            break;
          }
        }

        const final = chosen ?? best;
        if (final) {
          book = final.book;
          chapter = final.chapter;
          if (requested.has("detail")) stages.detail = final.detail;
          if (requested.has("toc") && final.toc) stages.toc = final.toc;
          if (book?.bookUrl) samples.bookUrl = book.bookUrl;
          if (book?.tocUrl) samples.tocUrl = book.tocUrl;
          if (chapter?.url) samples.chapterUrl = chapter.url;

          if (final.detail.status === "fail") {
            skipRest("toc", "详情页失败，目录与正文跳过");
          } else if (final.toc && final.toc.status !== "ok") {
            skipRest("content", final.toc.status === "empty" ? "目录为空，无法测正文" : "目录失败，正文跳过");
          }
        }
      }
    }
  }

  if (requested.has("content")) {
    if (failed) {
      skipRest("content", "前置阶段失败");
    } else {
      const target = options.chapterUrl
        ? ({ title: "体检章节", url: options.chapterUrl, isVip: false, isVolume: false } satisfies Chapter)
        : chapter;
      if (!target) {
        stages.content = { status: "skip", at: now(), ms: 0, message: "没有可测章节" };
      } else {
        const started = Date.now();
        try {
          const result = await engine.contentWithImages(source, target);
          const chars = countContentChars(result.text);
          stages.content = {
            status: chars >= 120 ? "ok" : "empty",
            at: now(),
            ms: Date.now() - started,
            chars,
            ...(chars >= 120 ? {} : { code: "content_too_short", message: "正文为空或少于 120 字" }),
          };
          samples.chapterUrl = target.url;
        } catch (err) {
          stages.content = {
            status: "fail",
            at: now(),
            ms: Date.now() - started,
            code: errorCode(err) || "content_failed",
            message: errorText(err),
          };
        }
      }
    }
  }

  return { stages, samples };
}
