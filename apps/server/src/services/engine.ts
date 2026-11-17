import { BookSourceEngine, type BookSource, type BookInfo, type Chapter, type ExploreGroup, type SearchBook } from "@legado/engine";
import { getDb } from "../db/index.js";
import { authorsMatch, titleKey, titlesMatch } from "./match.js";
import { recordCheck } from "./health.js";
import { searchHealthWhere, type SearchHealthScope } from "./search-scope.js";
import { PoolUnavailableError, searchInPool } from "./search-pool.js";
import { isMediaSource, looksLikeMediaBook } from "./source-kind.js";
import {
  isShushanSource,
  shushanBookInfo,
  shushanContent,
  shushanExplore,
  shushanExploreGroups,
  shushanSearch,
  shushanToc,
} from "./shushan.js";
import {
  dahuilangBookInfo,
  dahuilangContent,
  dahuilangExploreGroups,
  dahuilangExploreItems,
  dahuilangSearch,
  dahuilangToc,
  isDahuilangSource,
} from "./dahuilang.js";

const engine = new BookSourceEngine({
  timeoutMs: 20000,
  maxTocPages: 50,
  maxContentPages: 20,
});

// 搜索要横扫 800 多个站，单站慢一次就会占住一个 worker。搜索页给更短的超时 +
// 单源硬上限，宁可少一个站的结果，也不让整页等着几个死站。
const searchEngine = new BookSourceEngine({
  timeoutMs: 12_000,
  maxTocPages: 50,
  maxContentPages: 20,
});

const SEARCH_SOURCE_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export function engineInstance(): BookSourceEngine {
  return engine;
}

export function loadSourceById(id: number): { source: BookSource; row: Record<string, unknown> } | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM book_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  try {
    const source = JSON.parse(String(row.json)) as BookSource;
    return { source, row };
  } catch {
    return null;
  }
}

export interface SourceEntry {
  id: number;
  name: string;
  group: string;
  source: BookSource;
  healthState: string;
  healthScore: number;
}

export interface ListEnabledSourcesOptions {
  /** 调试/单源测速要能测 blocked/broken 的源；默认只返回可参与自动搜索的源。 */
  includeUnusable?: boolean;
  /** 搜索源池范围；默认 usable。显式 sourceIds 的调用方用 includeUnusable 绕过。 */
  healthScope?: SearchHealthScope;
}

export function listEnabledSources(limit = 0, options: ListEnabledSourcesOptions = {}): SourceEntry[] {
  const db = getDb();
  // 0.57 起先按健康状态排序，再看用户自定义顺序：健康源先发出去，broken/blocked
  // 不再占用搜索并发。显式 sourceIds（调试、单源测速）可以 includeUnusable 绕过。
  // 0.60 起 health=healthy 可以进一步把源池缩到四阶段都正常的源。
  const usableFilter = options.includeUnusable ? "" : searchHealthWhere(options.healthScope ?? "usable");
  const sql = `SELECT id, name, group_name, json, health_state, health_score FROM book_sources
    WHERE enabled = 1${usableFilter}
    ORDER BY CASE health_state
      WHEN 'healthy' THEN 0 WHEN 'partial' THEN 1 WHEN 'unknown' THEN 2
      WHEN 'degraded' THEN 3 WHEN 'blocked' THEN 4 WHEN 'broken' THEN 5 ELSE 2 END,
      health_score DESC, custom_order DESC, id ASC${limit > 0 ? " LIMIT " + limit : ""}`;
  const rows = db.prepare(sql).all() as Array<{
    id: number;
    name: string;
    group_name: string | null;
    json: string;
    health_state: string | null;
    health_score: number | null;
  }>;
  const out: SourceEntry[] = [];
  for (const row of rows) {
    try {
      out.push({
        id: row.id,
        name: row.name,
        group: String(row.group_name ?? ""),
        source: JSON.parse(row.json) as BookSource,
        healthState: String(row.health_state ?? "unknown"),
        healthScore: Number(row.health_score ?? 0),
      });
    } catch {
      /* skip broken json */
    }
  }
  return out;
}

/** 参与书籍搜索的源：已剔除漫画/影视源（显式指定 sourceIds 的调用方自己决定）。 */
export function searchableSources(healthScope: SearchHealthScope = "usable"): SourceEntry[] {
  return listEnabledSources(0, { healthScope }).filter((entry) =>
    !isMediaSource({ name: entry.name, group: entry.group, url: (entry.source as { bookSourceUrl?: string }).bookSourceUrl }),
  );
}

export interface SearchSourceResult {
  sourceId: number;
  sourceName: string;
  books: SearchBook[];
  error?: string;
  ms: number;
  healthState?: string;
  healthScore?: number;
}

/**
 * 一个源的一次搜索。
 *
 * 书源规则里的 JS / 正则 / cheerio 解析都是同步 CPU 活，跑在主线程会把整个服务
 * 按住（实测单源 4.5s 停摆），所以优先丢进 worker 线程池；线程池不可用（例如
 * tsx 直接跑 .ts 源码）时回退到进程内搜索，功能不受影响。
 */
export async function searchOneSource(source: BookSource, key: string): Promise<SearchBook[]> {
  // 书山聚合不是规则书源：它的规则是打包混淆的 JS，真正的接口在远端。直接走 provider。
  if (isShushanSource(source)) return shushanSearch(key);
  if (isDahuilangSource(source)) return dahuilangSearch(key);
  try {
    return await searchInPool(source, key, SEARCH_SOURCE_MS);
  } catch (err) {
    if (!(err instanceof PoolUnavailableError)) throw err;
    const pending = searchEngine.search(source, key, 1);
    // 书源可以有多条 searchUrl，第一条超时还会试第二条——不设硬上限就是 2×12s。
    pending.catch(() => undefined);
    return Promise.race([
      pending,
      sleep(SEARCH_SOURCE_MS).then(() => {
        throw new Error(`timeout after ${SEARCH_SOURCE_MS}ms: search aborted`);
      }),
    ]);
  }
}

export async function searchSources(
  key: string,
  options: {
    sourceIds?: number[];
    concurrency?: number;
    author?: string;
    /** When true, `key` is an author name: match on author only and skip title filtering. */
    authorOnly?: boolean;
    /** Stop starting new sources after this timestamp (already running ones finish). */
    deadline?: number;
    /** Stop starting new sources once this returns true (e.g. enough usable candidates). */
    shouldStop?: () => boolean;
    /** 这些源排在其它源前面搜（内置书山聚合：换源时要先看到它）。 */
    priorityIds?: number[];
    /** 没有显式 sourceIds 时的源池健康范围；默认 usable。 */
    healthScope?: SearchHealthScope;
    onProgress?: (r: SearchSourceResult) => void;
  } = {},
): Promise<SearchSourceResult[]> {
  // 漫画/影视源不参与书籍搜索：它们只会产出「主演：内详 / 更新至第13集」这类噪音。
  // 显式指定 sourceIds（调试页、单源测速）时不过滤，否则没法单独验证这类源。
  const all = options.sourceIds?.length
    ? listEnabledSources(0, { includeUnusable: true })
    : searchableSources(options.healthScope ?? "usable");
  const wanted = (options.sourceIds?.length ? all.filter((s) => options.sourceIds!.includes(s.id)) : all).slice();
  // 优先源提到队首：worker 是共享游标取任务，排第一就是第一个发出去。
  const priority = new Set(options.priorityIds ?? []);
  if (priority.size) wanted.sort((a, b) => Number(priority.has(b.id)) - Number(priority.has(a.id)));
  // 上限定 64：一次搜索对的是几十上百个不同站点，每个任务几乎全在等网络，
  // 单站慢不会拖住别的站。真正的 CPU 活在 worker 线程里解析 HTML，条数由调用方按场景给。
  const concurrency = Math.max(1, Math.min(64, options.concurrency ?? 8));
  const results: SearchSourceResult[] = [];
  let cursor = 0;
  const db = getDb();

  async function worker(): Promise<void> {
    while (cursor < wanted.length) {
      if (options.deadline && Date.now() > options.deadline && cursor > 0) break;
      if (options.shouldStop?.() && cursor > 0) break;
      const entry = wanted[cursor++];
      const started = Date.now();
      try {
        const found = await searchOneSource(entry.source, key);
        // Title is required unless this is an author-only search; then a book must
        // carry a matching author, otherwise generic search results flood the page.
        const books = found.filter((book) => {
          if (looksLikeMediaBook(book)) return false;
          if (options.authorOnly) {
            if (!book.author) return false;
            return authorsMatch(book.author, options.author || key);
          }
          if (!titlesMatch(book.name, key)) return false;
          if (!options.author) return true;
          if (book.author) return authorsMatch(book.author, options.author);
          return titleKey(book.name) === titleKey(key);
        });
        const result: SearchSourceResult = {
          sourceId: entry.id,
          sourceName: entry.name,
          books,
          ms: Date.now() - started,
          healthState: entry.healthState,
          healthScore: entry.healthScore,
        };
        results.push(result);
        recordCheck(db, entry.id, { count: books.length, ms: Date.now() - started }, { countFailure: false, keepStatusWhenEmpty: true });
        options.onProgress?.(result);
      } catch (err) {
        const message = String((err as Error).message ?? err).slice(0, 300);
        const result: SearchSourceResult = {
          sourceId: entry.id,
          sourceName: entry.name,
          books: [],
          error: message,
          ms: Date.now() - started,
          healthState: entry.healthState,
          healthScore: entry.healthScore,
        };
        results.push(result);
        recordCheck(db, entry.id, { error: message, ms: Date.now() - started }, { countFailure: false });
        options.onProgress?.(result);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length || 1) }, () => worker()));
  return results;
}

const infoCache = new Map<string, { at: number; value: BookInfo }>();
const tocCache = new Map<string, { at: number; value: Chapter[] }>();

export async function fetchBookInfo(sourceId: number, bookUrl: string): Promise<BookInfo> {
  const loaded = loadSourceById(sourceId);
  if (!loaded) throw new Error("source not found");
  const cacheKey = sourceId + "|" + bookUrl;
  const cached = infoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;
  const info = isShushanSource(loaded.source)
    ? await shushanBookInfo(bookUrl)
    : isDahuilangSource(loaded.source)
      ? await dahuilangBookInfo(bookUrl)
      : await engine.bookInfo(loaded.source, bookUrl);
  info.sourceId = sourceId;
  infoCache.set(cacheKey, { at: Date.now(), value: info });
  return info;
}

export async function fetchToc(sourceId: number, book: BookInfo): Promise<Chapter[]> {
  const loaded = loadSourceById(sourceId);
  if (!loaded) throw new Error("source not found");
  const cacheKey = sourceId + "|" + book.bookUrl;
  const cached = tocCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;
  const chapters = isShushanSource(loaded.source)
    ? await shushanToc(book)
    : isDahuilangSource(loaded.source)
      ? await dahuilangToc(book)
      : await engine.toc(loaded.source, book);
  tocCache.set(cacheKey, { at: Date.now(), value: chapters });
  return chapters;
}

/** 正文 + 插图。图片的 after 是「前面有多少段正文」，与阅读器的段落序号同一坐标系。 */
export interface FetchedContent {
  text: string;
  images: Array<{ src: string; after: number }>;
}

export async function fetchChapterContentWithImages(sourceId: number, chapterUrl: string, bookUrl: string): Promise<FetchedContent> {
  const loaded = loadSourceById(sourceId);
  if (!loaded) throw new Error("source not found");
  if (isShushanSource(loaded.source)) return { text: await shushanContent(chapterUrl, bookUrl), images: [] };
  if (isDahuilangSource(loaded.source)) return { text: await dahuilangContent(chapterUrl, bookUrl), images: [] };
  return engine.contentWithImages(loaded.source, { title: "", url: chapterUrl, isVip: false, isVolume: false });
}

export async function fetchChapterContent(sourceId: number, chapterUrl: string, bookUrl: string): Promise<string> {
  const fetched = await fetchChapterContentWithImages(sourceId, chapterUrl, bookUrl);
  return fetched.text;
}

export async function exploreGroups(sourceId: number): Promise<ExploreGroup[]> {
  const loaded = loadSourceById(sourceId);
  if (!loaded) return [];
  if (isShushanSource(loaded.source)) return shushanExploreGroups();
  // 大灰狼的发现页是 12KB 的混淆 JS，这里复刻 /discovestyle 与 /get_discover 协议。
  if (isDahuilangSource(loaded.source)) return dahuilangExploreGroups();
  return engine.exploreGroups(loaded.source);
}

export async function exploreSource(sourceId: number, groupUrl: string, page = 1, groupTitle = ""): Promise<SearchBook[]> {
  const loaded = loadSourceById(sourceId);
  if (!loaded) throw new Error("source not found");
  if (isShushanSource(loaded.source)) return shushanExplore(groupUrl, page);
  if (isDahuilangSource(loaded.source)) return dahuilangExploreItems(groupUrl, page);
  return engine.explore(loaded.source, groupUrl, page, groupTitle);
}
