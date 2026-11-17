import { countContentChars, matchChapter, titleSimilarity, type BookInfo } from "@legado/engine";
import { healthStateRank, type ContentQuality, type HealthState } from "@legado/shared";
import { authorsMatch, isUnknownAuthor, titleKey, titlesMatch } from "./match.js";
import { fetchBookInfo, fetchChapterContent, fetchToc, loadSourceById, searchSources } from "./engine.js";
import { PoolUnavailableError, probeInPool } from "./search-pool.js";
import { getDb } from "../db/index.js";
import { previewFromText } from "./switch-preview.js";
import { assessContentQuality } from "./content-quality.js";

/**
 * 换源候选流水线：搜索 → 按地址去重 → 并发探测（详情页 + 目录）→ 打分排序。
 *
 * 之所以放在服务端：手机端逐条点「测目录」既慢又只能看到一条失败；一次并发
 * 探测可以把「详情页打不开 / 目录为空 / 书名不符 / 作者不符」分类清楚，用户
 * 只点真正能用的源。
 */

export interface SwitchCandidate {
  sourceId: number;
  sourceName: string;
  /** 书源分组名：换源面板按分组筛选候选。 */
  sourceGroup?: string;
  sourceStatus: string;
  name: string;
  author: string;
  bookUrl: string;
  coverUrl: string;
  kind: string;
  lastChapter: string;
  wordCount: string;
  /** 同一地址被多少个源返回（QB/QQ 系动辄十几个源共用一个 api 地址）。 */
  duplicates: number;
  status: "pending" | "ok" | "warn" | "fail";
  chapters: number;
  ms: number;
  titleOk: boolean;
  authorOk: boolean | "unknown";
  /** 给用户看的一句话原因。 */
  reason: string;
  error: string;
  /** 当前章节在这个源的实测字数（未测或失败时没有这个字段）。 */
  chars?: number;
  /** 实测时命中的章节标题：目录结构和当前书不完全一致时，用户需要知道量的是哪一章。 */
  chapterTitle?: string;
  /** 实测耗时（详情/目录/正文三次请求的总时间，含缓存命中）。 */
  measureMs?: number;
  measureError?: string;
  /** 实测那一章是不是靠「章节名」对上的；false 表示只靠章号或位置凑的，字数不可比。 */
  matched?: boolean;
  /** 命中的依据：exact/core/cleaned/similar 是名字对上，ordinal 只是章号相同，index 是位置兜底。 */
  matchReason?: string;
  /** 0–1 的匹配可信度。 */
  matchScore?: number;
  /** 从缓存里读出来的候选：多少毫秒之前检测的（客户端显示「N 分钟前」）。 */
  ageMs?: number;
  /** 内置源（书山聚合）：换源时优先搜索，面板上标「内置」。 */
  builtin?: boolean;
  /** 探测时拿到的目录地址：测字直接用它，不必再抓一次详情页。 */
  tocUrl?: string;
  /** 实测章节的前 120 字，换源面板里给一眼预览。 */
  excerpt?: string;
  /** 实测章节的前 600 字（保留段落），面板展开「试读开头」用。 */
  preview?: string;
  /** 该源当前健康状态（换源排序和卡片提示用）。 */
  sourceHealthState?: HealthState;
  sourceHealthScore?: number;
  /** 测到的正文质量：ok / suspect（可疑）/ bad（占位、防盗、HTML 残留等）。 */
  contentQuality?: ContentQuality;
  contentQualityScore?: number;
  contentQualityReason?: string;
}

/** 单个候选的「当前章节字数」实测结果，随 SSE 的 measure 事件下发。 */
export interface ChapterMeasure {
  sourceId: number;
  bookUrl: string;
  ok: boolean;
  chars: number;
  chapterIndex: number;
  chapterTitle: string;
  ms: number;
  error: string;
  /** 章节名是否对上（名字类依据为 true，只靠章号/位置为 false；没走到定位这一步时缺省）。 */
  matched?: boolean;
  matchReason?: string;
  matchScore?: number;
  /** 实测章节正文的开头，供面板预览；失败时没有。 */
  excerpt?: string;
  /** 实测章节正文的前 600 字（保留段落），供面板展开试读；失败时没有。 */
  preview?: string;
  contentQuality?: ContentQuality;
  contentQualityScore?: number;
  contentQualityReason?: string;
}

export interface SwitchBookRef {
  id: number;
  name: string;
  author: string;
  sourceId: number;
  bookUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return String(url ?? "").trim().toLowerCase();
  }
}

interface SourceRow {
  id: number;
  name: string;
  status: string;
  weight: number;
  custom_order: number;
  url: string;
  health_state: string;
  health_score: number;
  /** 书源分组（订阅/自建/内置），换源面板用来按分组收窄候选。 */
  group_name: string | null;
}

/** 内置聚合源（书山聚合 / 大灰狼聚合）：换源时先搜它们，目录通常最全。 */
function isBuiltinSource(row: { url?: string }): boolean {
  const url = String(row.url ?? "");
  return url.startsWith("shushan://") || url.startsWith("dhl://");
}

/** 参与换源搜索的源数量：面板要说「跳过 N 个刚查过的源」，N 不能超过这个数。 */
export function switchSourcePoolSize(): number {
  return sourcePool().length;
}

function sourcePool(): SourceRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, name, status, weight, custom_order, url, health_state, health_score, group_name FROM book_sources
        WHERE enabled = 1 AND status != 'error' AND health_state NOT IN ('blocked', 'broken')
        ORDER BY CASE WHEN url LIKE 'shushan://%' OR url LIKE 'dhl://%' THEN 0 ELSE 1 END,
                 CASE health_state WHEN 'healthy' THEN 0 WHEN 'partial' THEN 1 WHEN 'unknown' THEN 2
                   WHEN 'degraded' THEN 3 ELSE 4 END,
                 health_score DESC, custom_order DESC, id ASC`,
    )
    .all() as SourceRow[];
}

/** 搜索结果里的书名常带站点后缀：「《是，火影！》TXT全集下载,TXT电子书免费下载」。 */
function cleanBookName(raw: string): string {
  let name = String(raw ?? "").replace(/\s+/g, " ").trim();
  name = name.replace(/[（(]?[Tt][Xx][Tt]\s*全集下载.*$/, "").trim();
  name = name.replace(/[,，]\s*[Tt][Xx][Tt].*$/, "").trim();
  name = name.replace(/[（(]?(最新章节|全文阅读|无弹窗|免费阅读|笔趣阁).*$/, "").trim();
  name = name.replace(/^[《「【]|[》」】]$/g, "").trim();
  return name || String(raw ?? "").trim();
}

function shortError(error: unknown): string {
  const text = String((error as Error)?.message ?? error ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "未知错误";
  return text.length > 80 ? text.slice(0, 80) + "…" : text;
}

/**
 * 取候选的详情页 + 目录。
 *
 * 目录页动辄几百 KB，规则求值又是同步 CPU 活，放在主线程会让整站接口卡住；
 * 优先丢进 worker 线程池，线程池不可用时回退进程内（带 10 分钟缓存）。
 */
async function loadCandidate(
  sourceId: number,
  bookUrl: string,
): Promise<{ info: Awaited<ReturnType<typeof fetchBookInfo>>; chapters: number; tocError: string }> {
  const loaded = loadSourceById(sourceId);
  if (loaded) {
    try {
      const probed = await probeInPool(loaded.source, bookUrl, 18_000);
      return { info: probed.info, chapters: probed.chapters, tocError: probed.tocError };
    } catch (err) {
      if (!(err instanceof PoolUnavailableError)) throw err;
    }
  }
  const info = await fetchBookInfo(sourceId, bookUrl);
  let chapters = 0;
  let tocError = "";
  try {
    chapters = (await fetchToc(sourceId, info)).length;
  } catch (err) {
    tocError = shortError(err);
  }
  return { info, chapters, tocError };
}

async function probeCandidate(candidate: SwitchCandidate, book: SwitchBookRef): Promise<SwitchCandidate> {
  const started = Date.now();
  let info: Awaited<ReturnType<typeof fetchBookInfo>>;
  let chapters = 0;
  let tocError = "";
  try {
    const loaded = await loadCandidate(candidate.sourceId, candidate.bookUrl);
    info = loaded.info;
    chapters = loaded.chapters;
    tocError = loaded.tocError;
  } catch (err) {
    return { ...candidate, status: "fail", ms: Date.now() - started, reason: `详情页打不开：${shortError(err)}`, error: shortError(err) };
  }

  const name = cleanBookName(String(info.name ?? "").trim() || candidate.name);
  // 详情页没解析出作者时不能拿「搜索结果里的作者」去比对：那个字段本身也常常是书名
  // （很多聚合站的搜索规则把标题写进了 author），比对必然失败并把可用源标成 warn。
  const infoAuthor = String(info.author ?? "").trim();
  const rawAuthor = infoAuthor || String(candidate.author ?? "").trim();
  // 搜索结果里的 author 常常就是书名（或分类词），展示成「佚名」比展示假作者诚实。
  const author =
    !rawAuthor || titleKey(rawAuthor) === titleKey(name) || /^(玄幻|仙侠|都市|历史|科幻|网游|言情|奇幻|武侠|轻小说|其他|连载中|已完结)$/.test(rawAuthor)
      ? "佚名"
      : rawAuthor;
  const titleOk = titlesMatch(name, book.name);
  const authorLooksLikeTitle = Boolean(infoAuthor) && titleKey(infoAuthor) === titleKey(name);
  const authorOk: boolean | "unknown" =
    !infoAuthor || authorLooksLikeTitle || isUnknownAuthor(book.author) || isUnknownAuthor(infoAuthor)
      ? "unknown"
      : authorsMatch(infoAuthor, book.author);

  const base: SwitchCandidate = {
    ...candidate,
    name,
    author,
    coverUrl: info.coverUrl || candidate.coverUrl,
    kind: info.kind || candidate.kind,
    lastChapter: info.lastChapter || candidate.lastChapter,
    wordCount: info.wordCount || candidate.wordCount,
    chapters,
    ms: Date.now() - started,
    titleOk,
    authorOk,
    tocUrl: String(info.tocUrl ?? ""),
  };

  // 解码失败时书名会带替换字符（`ҹ�޽�…`）。这种候选就算有目录也不能用：
  // 读者换过去看到的整本书都是乱码。
  if (name.includes("\uFFFD") || author.includes("\uFFFD")) {
    return { ...base, status: "fail", reason: "编码异常：抓到的书名是乱码", error: "mojibake" };
  }
  if (!chapters) {
    return { ...base, status: "fail", reason: tocError ? `目录取不到：${tocError}` : "目录是空的", error: tocError };
  }
  if (!titleOk) return { ...base, status: "warn", reason: `书名不一致：「${name}」`, error: "" };
  if (authorOk === false) return { ...base, status: "warn", reason: `作者不一致：「${author}」`, error: "" };
  return { ...base, status: "ok", reason: "", error: "" };
}

/** 单个候选的实测上限：慢站不能把整块「测字」拖到用户以为卡死。 */
// 慢站 + 面板满载（搜索 12–40 并发）时，正文请求实测要 10–20 秒才回；12 秒会把
// 一批本来能测出来的源判成「测字超时」。18 秒 + 4 路并发，整体等待仍是 25 秒。
const MEASURE_TIMEOUT_MS = 18_000;

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([task, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 目录/详情这类「定位」请求的上限：慢站在面板满载时能拖到 8 秒以上。 */
const MEASURE_LOCATE_TIMEOUT_MS = 8_000;

/** 实测一个候选源的「当前章节正文」：目录地址探测时已经拿到，真正多出来的只有一次正文请求。 */
async function measureCandidate(candidate: SwitchCandidate, chapterIndex: number, wantedTitle: string): Promise<ChapterMeasure> {
  const started = Date.now();
  const base = { sourceId: candidate.sourceId, bookUrl: candidate.bookUrl };
  /** 只有真的走到「定位章节」这一步才知道名字对不对；超时/取不到目录时必须留空，
   * 否则一条慢站会被当成「章节名对不上」而被过滤掉——那是两件事。 */
  let hit: { matched: boolean; matchReason: string; matchScore: number } | null = null;
  let at = -1;
  try {
    // 探测阶段已经把目录地址带回来了（candidate.tocUrl）。以前这里无条件重抓详情页，
    // 面板满载时慢站的详情页要 5–8 秒——一次测字光「找目录」就吃掉半个 25 秒窗口，
    // 剩下的正文请求必然超时，于是整列显示「测字失败」。
    let list: Awaited<ReturnType<typeof fetchToc>>;
    if (candidate.tocUrl) {
      list = await withTimeout(
        fetchToc(candidate.sourceId, { bookUrl: candidate.bookUrl, tocUrl: candidate.tocUrl, name: candidate.name } as BookInfo),
        MEASURE_LOCATE_TIMEOUT_MS,
        "目录请求超时",
      );
    } else {
      const info = await withTimeout(
        fetchBookInfo(candidate.sourceId, candidate.bookUrl),
        MEASURE_LOCATE_TIMEOUT_MS,
        "详情页请求超时",
      );
      list = await withTimeout(fetchToc(candidate.sourceId, info), MEASURE_LOCATE_TIMEOUT_MS, "目录请求超时");
    }
    if (!list.length) throw new Error("目录是空的");
    // 测字也按章节名定位：测错一章的话，「这个源 3580 字」这种结论就是假的。
    const match = matchChapter(list, wantedTitle, chapterIndex);
    at = match.index;
    // 名字类依据才算「对上了」；ordinal（只有章号相同）与 index（位置兜底）都可能落在别的章上。
    const matched = match.reason === "exact" || match.reason === "core" || match.reason === "cleaned" || match.reason === "similar";
    hit = { matched, matchReason: match.reason, matchScore: Math.round(match.score * 100) / 100 };
    const chapter = list[at];
    if (!chapter) throw new Error("目录里找不到对应章节");
    const text = await withTimeout(
      fetchChapterContent(candidate.sourceId, chapter.url, candidate.bookUrl),
      MEASURE_TIMEOUT_MS,
      "正文请求超时",
    );
    const chars = countContentChars(text);
    // 空正文也算失败：很多站对未登录/反爬返回 200 + 空壳页面，这正是「换过去没字」的元凶。
    if (!chars) {
      return {
        ...base,
        ok: false,
        chars: 0,
        chapterIndex: at,
        chapterTitle: String(chapter.title ?? ""),
        ms: Date.now() - started,
        error: "正文是空的",
        contentQuality: "bad",
        contentQualityScore: 0,
        contentQualityReason: "正文是空的",
        ...hit,
      };
    }
    const quality = assessContentQuality(String(text ?? ""), chars);
    const excerpt = String(text ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const preview = previewFromText(text);
    return {
      ...base,
      ok: true,
      chars,
      chapterIndex: at,
      chapterTitle: String(chapter.title ?? ""),
      ms: Date.now() - started,
      error: "",
      excerpt,
      preview,
      contentQuality: quality.quality,
      contentQualityScore: quality.score,
      contentQualityReason: quality.reason,
      ...hit,
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      chars: 0,
      chapterIndex: at,
      chapterTitle: "",
      ms: Date.now() - started,
      error: shortError(err),
      contentQuality: "bad",
      contentQualityScore: 0,
      contentQualityReason: shortError(err),
      ...hit,
    };
  }
}

export interface MeasureOptions {
  /** 同时测几个源，默认 4。测字要真的抓一章正文，开太大容易被源站限速。 */
  concurrency?: number;
  /** 每测完一个就回调（路由用它推 SSE 的 measure 事件）。 */
  onMeasure?: (measure: ChapterMeasure) => void;
  /** 客户端断开后停止；已经在途的请求会自然结束。 */
  shouldAbort?: () => boolean;
}

/**
 * 给一批「目录已知」的候选补测某一章。
 *
 * 这是 0.21.0 两层缓存的关键：换章节后目录层还能用，但字数/章名匹配必须重新测，
 * 否则面板会拿上一章的结果冒充这一章。测完直接写回传入的候选对象，调用方不用自己拼。
 */
export async function measureCandidates(
  list: SwitchCandidate[],
  chapter: { index: number; title: string },
  options: MeasureOptions = {},
): Promise<ChapterMeasure[]> {
  const targets = list.filter((item) => item.status !== "fail" && Boolean(item.bookUrl));
  if (!targets.length) return [];
  const concurrency = Math.max(1, Math.min(6, Math.round(options.concurrency ?? 4)));
  const queue = targets.slice();
  const results: ChapterMeasure[] = [];

  const apply = (item: SwitchCandidate, measure: ChapterMeasure): void => {
    item.measureMs = measure.ms;
    if (measure.chars > 0) item.chars = measure.chars;
    if (measure.chapterTitle) item.chapterTitle = measure.chapterTitle;
    // 只有真的走到定位章节这一步，measure.matched 才是布尔值；超时/取不到目录时留空，
    // 否则慢站会被当成「章节名对不上」而被面板隐藏。
    if (typeof measure.matched === "boolean") item.matched = measure.matched;
    if (measure.matchReason) item.matchReason = measure.matchReason;
    if (typeof measure.matchScore === "number") item.matchScore = measure.matchScore;
    if (measure.excerpt) item.excerpt = measure.excerpt;
    if (measure.preview) item.preview = measure.preview;
    if (!measure.ok && measure.error) item.measureError = measure.error;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.shouldAbort?.()) return;
      const item = queue.shift();
      if (!item) return;
      const measure = await measureCandidate(item, chapter.index, chapter.title);
      apply(item, measure);
      results.push(measure);
      options.onMeasure?.(measure);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return results;
}

function rank(candidate: SwitchCandidate): number[] {
  const statusRank = candidate.status === "ok" ? 0 : candidate.status === "warn" ? 1 : candidate.status === "pending" ? 2 : 3;
  const qualityRank = candidate.contentQuality === "ok" ? 0 : candidate.contentQuality === "suspect" ? 1 : candidate.contentQuality === "bad" ? 3 : 2;
  const healthRank = healthStateRank(candidate.sourceHealthState);
  const authorRank = candidate.authorOk === true ? 0 : candidate.authorOk === "unknown" ? 1 : 2;
  return [statusRank, qualityRank, healthRank, authorRank, -candidate.chapters, candidate.ms];
}

export function sortCandidates(list: SwitchCandidate[]): SwitchCandidate[] {
  return list.slice().sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  });
}

export interface StreamOptions {
  /** 并发探测数，默认 6。 */
  concurrency?: number;
  /** 第二阶段的搜索预算（毫秒），默认 25s。 */
  budgetMs?: number;
  /** 最多保留多少个去重后的候选，默认 40。 */
  limit?: number;
  /**
   * 深度模式：搜完全部书源、不早停、候选上限更高。
   *
   * 默认模式为了让面板「打开就有结果」，攒够 6 个可用候选就收手——实测 788 个源
   * 只搜了三十来个。同一个书名的转载站往往有几十个，先到的全是同一个 105 章的
   * 版本，目录更全的源永远轮不到。深度模式专门解决这个：慢一点，但要能回答
   * 「谁的目录更全」。
   */
  deep?: boolean;
  /** 客户端断开后由路由置 true：深度搜索据此停止开新的源。 */
  shouldAbort?: () => boolean;
  /**
   * 当前书在当前源的目录章数：深度模式一旦探到 2 个「章数更多」的源就停止开新源。
   * 用户要的从来不是「搜完 788 个站」，而是「有没有更全的版本」——找到就够了。
   */
  minChapters?: number;
  onCandidate?: (candidate: SwitchCandidate) => void;
  onSearch?: (progress: { sources: number; total: number; candidates: number }) => void;
  /** 当前章节：传了就为可用候选实测该章字数（换源面板按字数排序，避免换到缺字的源）。 */
  chapter?: { index: number; title: string };
  onMeasure?: (measure: ChapterMeasure) => void;
  /** 实测并发数，默认 3；正文请求比目录重，别开太大。 */
  measureConcurrency?: number;
  /**
   * 搜索阶段的并发源数：每个源一次搜索请求，几乎全在等网络（788 个源的中位耗时
   * 1.2 秒、p90 6.3 秒），串得太窄就变成「一个站慢、整页等」。深度搜索默认 40。
   */
  searchConcurrency?: number;
  /** 这些源最近刚查过，本次直接跳过（结果由调用方用缓存补齐）。 */
  skipSourceIds?: Set<number>;
  /** 每搜完一个源回调一次：调用方据此记下「这个源查过了，没有这本书」。 */
  onSearched?: (sourceId: number) => void;
}

export async function streamSwitchCandidates(book: SwitchBookRef, options: StreamOptions = {}): Promise<SwitchCandidate[]> {
  const deep = options.deep === true;
  // 探测和搜索共用同一个线程池（WORKERS×PER_WORKER = 24 条通道）。探测任务排在搜索
  // 任务后面会直接撞上 7 秒超时被丢掉——实测深度搜索开 16 条搜索 + 10 条探测时，
  // 3 分钟只探出 9 个候选。两边加起来必须留出余量。
  const concurrency = Math.max(1, Math.min(deep ? 8 : 12, options.concurrency ?? (deep ? 4 : 6)));
  const limit = Math.max(1, Math.min(deep ? 300 : 120, options.limit ?? (deep ? 200 : 40)));
  /** 最多实测多少条：候选再多也没必要把每一个都拉一遍正文。 */
  const measureLimit = Math.min(limit, deep ? 80 : 40);
  const measureConcurrency = Math.max(1, Math.min(6, options.measureConcurrency ?? (deep ? 4 : 3)));
  // 搜索并发：深度模式要横扫几百个源，窄了就是「几百个 1 秒的请求排成两分钟」。
  const searchConcurrency = Math.max(2, Math.min(64, options.searchConcurrency ?? (deep ? 40 : 12)));
  const measureQueue: SwitchCandidate[] = [];
  let measureActive = 0;
  let measureQueued = 0;
  /** 还在跑的探测 worker：只要它们可能再塞进新的实测任务，就不能提前宣布「测完了」。 */
  let probeWorkers = concurrency;
  /** 深度模式下探测超时的候选：搜完之后再给它们一次机会（慢站 + 长目录很容易撞上 7 秒上限）。 */
  const retryQueue: SwitchCandidate[] = [];
  const retried = new Set<SwitchCandidate>();
  let retrying = false;
  let measureResolve: (() => void) | null = null;
  const measureDone = new Promise<void>((resolve) => {
    measureResolve = resolve;
  });
  const settleMeasures = (): void => {
    if (!options.chapter) {
      measureResolve?.();
      return;
    }
    if (!searching && !retrying && !probeWorkers && !measureQueue.length && !measureActive) measureResolve?.();
  };
  const pumpMeasures = (): void => {
    while (options.chapter && measureActive < measureConcurrency && measureQueue.length) {
      const target = measureQueue.shift() as SwitchCandidate;
      measureActive += 1;
      void measureCandidate(target, options.chapter.index, options.chapter.title)
        .then((result) => {
          target.chars = result.chars;
          target.chapterTitle = result.chapterTitle;
          target.measureMs = result.ms;
          target.measureError = result.ok ? "" : result.error;
          target.matched = result.matched;
          target.matchReason = result.matchReason;
          target.matchScore = result.matchScore;
          target.contentQuality = result.contentQuality;
          target.contentQualityScore = result.contentQualityScore;
          target.contentQualityReason = result.contentQualityReason;
          options.onMeasure?.(result);
        })
        .finally(() => {
          measureActive -= 1;
          pumpMeasures();
          settleMeasures();
        });
    }
  };
  /**
   * 同一个源一次可能吐出上百条同名搜索结果（实测源 436 对「是，火影！」返回 200 条
   * 火影同人），全收进来会把探测队列灌满、把真正有 322 章的源挤到后面。按源限量。
   */
  const perSourceCap = deep ? 12 : 6;
  const perSource = new Map<number, number>();
  /**
   * 书名相似度：0 与当前书完全同名，1 前缀包含，2 只是搜索结果里混进来的同人。
   * 探测是串行排队的，先探同名的那批，才不会让 322 章的源排在 200 条垃圾后面。
   */
  const titleScoreOf = (name: string): number => {
    const left = titleKey(name);
    const right = titleKey(book.name);
    if (!left || !right) return 2;
    if (left === right) return 0;
    return left.startsWith(right) || right.startsWith(left) ? 1 : 2;
  };
  // 刚查过的源不再搜：换源面板反复打开时，省掉的正是那一两分钟。
  const fullPool = sourcePool();
  const pool = options.skipSourceIds?.size ? fullPool.filter((row) => !options.skipSourceIds!.has(row.id)) : fullPool;
  // 内置书山聚合：搜索阶段要让它第一个发出去，而且不能因为「攒够 8 个候选」在它出结果前
  // 就收手——它走的是聚合接口，单次搜索 8–12 秒，恰好卡在默认预算线上。
  const builtinIds = pool.filter(isBuiltinSource).map((row) => row.id);
  const builtinSet = new Set(builtinIds);
  const doneIds = new Set<number>();
  const builtinSearched = (): boolean => builtinIds.every((id) => doneIds.has(id));
  const seen = new Map<string, SwitchCandidate>();
  const queue: SwitchCandidate[] = [];
  const results: SwitchCandidate[] = [];
  let searching = true;
  let closed = false;
  let searched = 0;
  let lastCandidateAt = Date.now();

  const accept = (
    items: Array<{
      sourceId: number;
      sourceName: string;
      sourceStatus: string;
      sourceHealthState?: string;
      sourceHealthScore?: number;
      sourceGroup?: string;
    } & Record<string, unknown>>,
  ): void => {
    if (closed) return;
    let added = false;
    for (const item of items) {
      // 内置聚合源比普通站点慢 5–8 秒：默认 limit=8 时，等它回来名额早就被快源占满，
      // 大灰狼聚合的候选会整批被丢掉（0.57 实测：pool 含 843，SSE 里却没有任何 843）。
      // 给内置源预留「每源上限」的名额，普通源仍按原 limit 截断。
      const builtinItem = item.sourceBuiltin === true;
      const cap = builtinItem ? limit + builtinIds.length * perSourceCap : limit;
      if (seen.size >= cap) break;
      const used = perSource.get(item.sourceId) ?? 0;
      if (used >= perSourceCap) continue;
      const url = String(item.bookUrl ?? "");
      const key = urlKey(url);
      if (!key) continue;
      // 当前源本身不该出现在候选里：以前只在「URL 和源都相同」时才排除，
      // 当前源换个地址（移动版/主站两套地址）就会把自己列成可换目标。
      if (item.sourceId === book.sourceId) continue;
      const existing = seen.get(key);
      if (existing) {
        existing.duplicates += 1;
        continue;
      }
      const candidate: SwitchCandidate = {
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        sourceGroup: String(item.sourceGroup ?? ""),
        sourceStatus: item.sourceStatus,
        name: String(item.name ?? ""),
        author: String(item.author ?? ""),
        bookUrl: url,
        coverUrl: String(item.coverUrl ?? ""),
        kind: String(item.kind ?? ""),
        lastChapter: String(item.lastChapter ?? ""),
        wordCount: String(item.wordCount ?? ""),
        duplicates: 1,
        status: "pending",
        builtin: item.sourceBuiltin === true,
        sourceHealthState: (item.sourceHealthState as HealthState | undefined) ?? "unknown",
        sourceHealthScore: Number(item.sourceHealthScore ?? 0),
        chapters: 0,
        ms: 0,
        titleOk: false,
        authorOk: "unknown",
        reason: "",
        error: "",
      };
      seen.set(key, candidate);
      perSource.set(item.sourceId, used + 1);
      queue.push(candidate);
      added = true;
    }
    // 稳定排序：同分同名保持搜索返回的顺序，只是把「书名完全一致」的提到队首。
    if (added && queue.length > 1) queue.sort((a, b) => titleScoreOf(a.name) - titleScoreOf(b.name));
  };

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const next = queue.shift();
      if (!next) {
        if (!searching) {
          probeWorkers -= 1;
          settleMeasures();
          return;
        }
        await sleep(120);
        continue;
      }
      // 单条探测也要有上限：详情页 + 目录两次请求都卡住时，不能把整个换源拖到 40s。
      // 深度模式放宽到 12 秒：322 章的目录本身就要拉几秒，7 秒会把「更全的源」当成超时丢掉。
      const probed = await Promise.race([probeCandidate(next, book), sleep(deep ? 12_000 : 7_000).then(() => null)]);
      if (!probed) {
        if (deep && !retried.has(next) && retryQueue.length < 30) {
          retried.add(next);
          retryQueue.push(next);
        }
        continue;
      }
      results.push(probed);
      lastCandidateAt = Date.now();
      options.onCandidate?.(probed);
      options.onSearch?.({ sources: searched, total: pool.length, candidates: seen.size });
      // fail 的源连目录都没有，没得量；warn 的源虽然信息对不上，但用户可能就是要强制换过去，
      // 所以也给它量一次（界面上会同时标「信息不一致」和字数）。
      if (options.chapter && probed.status !== "fail" && measureQueued < measureLimit) {
        measureQueued += 1;
        measureQueue.push(probed);
        // 深度模式候选多：先量目录最长的，别让「更全的源」排在测字队尾。
        if (deep) measureQueue.sort((a, b) => b.chapters - a.chapters);
        pumpMeasures();
      }
    }
  });

  const statusById = new Map(pool.map((row) => [row.id, row.status]));
  const healthById = new Map(pool.map((row) => [row.id, { state: row.health_state, score: row.health_score }]));
  const groupById = new Map(pool.map((row) => [row.id, String(row.group_name ?? "")]));
  const handleSource = (r: {
    sourceId: number;
    sourceName: string;
    books: unknown[];
    healthState?: string;
    healthScore?: number;
  }): void => {
    searched += 1;
    doneIds.add(r.sourceId);
    options.onSearched?.(r.sourceId);
    accept(
      (r.books as Array<Record<string, unknown>>).map((b) => ({
        ...b,
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        sourceGroup: groupById.get(r.sourceId) ?? "",
        sourceStatus: statusById.get(r.sourceId) ?? "",
        sourceBuiltin: builtinSet.has(r.sourceId),
        sourceHealthState: r.healthState ?? healthById.get(r.sourceId)?.state ?? "unknown",
        sourceHealthScore: r.healthScore ?? healthById.get(r.sourceId)?.score ?? 0,
      })),
    );
    // 进度按「已经搜完的源」算：只在收到候选时上报会让进度条长时间停在原地。
    if (!closed) options.onSearch?.({ sources: searched, total: pool.length, candidates: seen.size });
  };

  /**
   * 作者名兜底：同一本书在不同站的写法常常不一样（全角逗号、书名后缀、「（完本）」），
   * 按书名搜不到，但按作者能搜到。深度模式在书名搜索之后再跑一遍作者搜索，只收
   * 书名相似度够高的结果——作者的其他书不能混进换源列表。
   */
  const authorPass = async (ids: number[]): Promise<void> => {
    const wanted = String(book.author ?? "").trim();
    if (!wanted) return;
    await searchSources(wanted, {
      sourceIds: ids,
      concurrency: searchConcurrency,
      authorOnly: true,
      deadline: Date.now() + 25_000,
      shouldStop: () => closed || Boolean(options.shouldAbort?.()),
      priorityIds: builtinIds,
      onProgress: (r) => {
        if (closed) return;
        const similar = (r.books as unknown as Array<Record<string, unknown>>).filter(
          (b) => titleSimilarity(String(b.name ?? ""), book.name) >= 0.6,
        );
        if (!similar.length) return;
        accept(
          similar.map((b) => ({
            ...b,
            sourceId: r.sourceId,
            sourceName: r.sourceName,
            sourceGroup: groupById.get(r.sourceId) ?? "",
            sourceStatus: statusById.get(r.sourceId) ?? "",
            sourceBuiltin: builtinSet.has(r.sourceId),
            sourceHealthState: healthById.get(r.sourceId)?.state ?? "unknown",
            sourceHealthScore: healthById.get(r.sourceId)?.score ?? 0,
          })),
        );
      },
    });
  };

  try {
    // 只发一次搜索，源顺序已经是「已验证可用优先」（sourcePool 的 ORDER BY）。
    // 以前是两波：先搜全部 ok 源、再搜其余源——巡检把 500 个源标成 ok 之后，
    // 第一波就要跑一分多钟，候选迟迟不出来。现在统一给预算 + 早停。
    const ids = pool.map((row) => row.id);
    if (ids.length) {
      // 默认模式：攒够 8 个可用候选（或候选池满）就收手，面板打开就有结果。
      // 深度模式：一个都不放过，直到搜完所有源、预算到点或客户端离开。
      const enough = (): boolean => {
        if (deep) {
          if (options.shouldAbort?.()) return true;
          // 已经探到两个比当前源更全的目录，再搜下去也不会改变选择。
          const floor = options.minChapters ?? 0;
          if (floor > 0) {
            const longer = results.filter((item) => item.status !== "fail" && item.chapters > floor).length;
            if (longer >= 2) return true;
          }
          return false;
        }
        if (!builtinSearched()) return false;
        return results.filter((item) => item.status === "ok").length >= 8 || queue.length + results.length >= limit;
      };
      const budget = options.budgetMs ?? (deep ? 120_000 : 12_000);
      // 内置源慢但最全：给它额外的宽限，否则默认 12–15 秒的预算刚好在它返回前到点。
      const builtinGrace = builtinIds.length ? 8_000 : 0;
      const search = searchSources(book.name, {
        sourceIds: ids,
        concurrency: searchConcurrency,
        deadline: Date.now() + budget + builtinGrace,
        shouldStop: enough,
        priorityIds: builtinIds,
        onProgress: handleSource,
      });
      // 三个收尾条件先到先算：
      // 1. settle：已经攒够可用候选（默认 6 个）并且 2 秒没有新的候选进来——实测 7 个可用
      //    候选在 2.5s 内就到齐了，再等满预算只是让用户盯着「搜索中」发呆。
      // 2. 预算到点：in-flight 的慢站（每个最多 20s 超时）不该把「搜索完成」拖到半分钟。
      // 3. 搜索自然结束。
      // 深度模式只看 2、3：它要的就是那些「迟迟不出候选」的长尾源。
      // 剩下的源在后台继续跑完，只是不再影响这次换源的结果。
      const minOk = Math.min(6, limit);
      const settle = new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          // 内置源还没回来就先别收手。
          if (!builtinSearched()) return;
          const okCount = results.filter((item) => item.status === "ok").length;
          if (okCount >= minOk && Date.now() - lastCandidateAt >= 2_000) {
            clearInterval(timer);
            resolve();
          }
        }, 250);
        timer.unref?.();
      });
      const racers: Array<Promise<unknown>> = [search.then(() => undefined), sleep(budget + builtinGrace + 2_500)];
      if (!deep) racers.push(settle);
      await Promise.race(racers);
      // 深度模式再补一轮作者搜索：书名写法不同导致搜不到的镜像，只能靠作者找回来。
      // 只在书名搜索几乎没结果时补（否则等于白花 25 秒——实测《是，火影！》按书名
      // 已经找到全部可用镜像，作者搜索只多出几条目录为 0 的死源）。
      const viable = results.filter((item) => item.status !== "fail" && item.chapters > 0).length;
      if (deep && viable < 3 && book.author && !options.shouldAbort?.()) {
        await Promise.race([authorPass(ids), sleep(25_000)]);
      }
      closed = true;
      searching = false;
      // 默认模式：预算到点后还没探测的候选没有意义，直接丢掉。
      // 深度模式反过来——排队的候选正是长尾，等它们探测完再收尾（最多再等 60s）。
      if (!deep) queue.length = 0;
      else if (!options.shouldAbort?.()) await Promise.race([Promise.all(workers), sleep(60_000)]);
      // 超时的那批候选在搜索结束后单独重探一次：这时线程池空着，慢站的详情页 + 目录
      // 才跑得完。322 章的源正是这么被 7 秒上限误杀掉的。
      if (deep && retryQueue.length && !options.shouldAbort?.()) {
        retrying = true;
        try {
          for (let i = 0; i < retryQueue.length; i += 4) {
            if (options.shouldAbort?.()) break;
            const chunk = retryQueue.slice(i, i + 4);
            await Promise.all(
              chunk.map(async (item) => {
                const late = await Promise.race([probeCandidate(item, book), sleep(20_000).then(() => null)]);
                if (!late) return;
                results.push(late);
                options.onCandidate?.(late);
                if (options.chapter && late.status !== "fail" && measureQueued < measureLimit) {
                  measureQueued += 1;
                  measureQueue.push(late);
                  measureQueue.sort((a, b) => b.chapters - a.chapters);
                  pumpMeasures();
                }
              }),
            );
          }
        } finally {
          retrying = false;
          settleMeasures();
        }
      }
    }
  } finally {
    // 不 await workers：预算到点后还在跑的慢源/慢探测不该拦住「搜索完成」，
    // 它们的结果对已经关闭的 SSE 也没有意义（onCandidate 侧会检查连接状态）。
    searching = false;
    settleMeasures();
  }
  // 实测是流式的：先到的行先给用户看（onMeasure），但最多等 25s，别让一个慢源卡住整页。
  await Promise.race([measureDone, sleep(25_000)]);
  return sortCandidates(results);
}
