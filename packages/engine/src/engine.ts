import { CookieJar } from "tough-cookie";
import { fetchText, type FetchOptions } from "./http.js";
import { EngineError } from "./errors.js";
import { evalField, evalFieldList, evalRule, collectItems } from "./rule.js";
import { splitLinesDeep } from "./split.js";
import { isNavEntry, normalizeToc } from "./toc-order.js";
import { bookUrlProblem, isUsableBookUrl } from "./urls.js";
import { renderTemplate, type JsEvaluator, type TemplateContext } from "./template.js";
import { parseJson } from "./jsonpath.js";
import { decodeEntities, encodeKey, htmlToText, htmlToTextWithImages, normalizeText, splitInlineImages, toAbsoluteUrl, type InlineImage } from "./text.js";
import { makeElementShim } from "./html.js";
import { extractCover, extractDescription, extractTitle, isJunkImage, nameFromUrl } from "./meta.js";
import { runJsSync } from "./js.js";
import type { BookInfo, BookSource, Chapter, ExploreGroup, FetchResult, RuleContext, SearchBook } from "./types.js";

export interface UrlOptions {
  method?: string;
  headers?: Record<string, string> | string;
  body?: string | Record<string, unknown>;
  charset?: string;
  retry?: number;
  type?: string;
  webView?: boolean;
  js?: string;
  proxy?: string;
}

/** Hard ceiling: a rule that matches the whole site (e.g. an unbounded JSON API) must fail fast. */
const MAX_TOC_CHAPTERS = 20_000;

/** 目录页里的章节链接：标题必须带「第 N 章」，用来在规则失配时兜底扫一遍。 */
const TOC_ANCHOR_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;
const TOC_CHAPTER_TEXT = /第\s*[0-9０-９零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,10}\s*[章节回话集篇]/;

/** 条目本身是 <a> 或 <dd><a …> 时取第一个链接：书源把 chapterUrl 留空是常见写法。 */
function firstAnchorHref(html: string): string {
  const text = String(html ?? "");
  const hit =
    text.match(/^\s*<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i) ?? text.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  return hit ? decodeEntities(hit[1]) : "";
}

/**
 * 规则没匹配到任何章节时，直接扫页面上的「第 N 章」链接。
 *
 * 书源规则是按桌面版页面写的，站点一上移动版/改版，chapterList 的选择器就整体失效，
 * 详情页能解析、目录却是空的——这正是换源面板里最多的一类「不可用」。这里只在
 * 规则命中 0 条时兜底，命中率高且误伤小（标题必须带章号，导航链接不会满足）。
 */
function rescueTocLinks(html: string, baseUrl: string): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  TOC_ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOC_ANCHOR_RE.exec(html))) {
    const rawHref = String(match[1] ?? "").trim();
    if (!rawHref || rawHref.startsWith("#") || /^(javascript|mailto|tel):/i.test(rawHref)) continue;
    const title = decodeEntities(String(match[2] ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title || title.length > 60 || !TOC_CHAPTER_TEXT.test(title)) continue;
    const url = toAbsoluteUrl(rawHref, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url });
    if (out.length > MAX_TOC_CHAPTERS) break;
  }
  return out;
}

export interface EngineOptions {
  timeoutMs?: number;
  retry?: number;
  cookieJar?: CookieJar;
  maxTocPages?: number;
  /** 只取目录前 N 章。健康体检只抽一章正文，没必要为 1400 章的站点逐条求值 JS。 */
  tocLimit?: number;
  maxContentPages?: number;
  onDebug?: (event: { stage: string; url?: string; message?: string; data?: unknown }) => void;
}

/** 正文分页预览的一页：对应 contentWithImages 里的一次 nextContentUrl 抓取。 */
export interface ContentPageInfo {
  url: string;
  chars: number;
  rows: number;
  images: number;
  nextUrl?: string;
}

class CookieStore {
  private readonly map = new Map<string, Map<string, string>>();

  private host(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  getCookie(url: string): string {
    const jar = this.map.get(this.host(url));
    if (!jar) return "";
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  setCookie(url: string, cookie: string): void {
    const host = this.host(url);
    const jar = this.map.get(host) ?? new Map<string, string>();
    for (const pair of cookie.split(";")) {
      const idx = pair.indexOf("=");
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    this.map.set(host, jar);
  }

  removeCookie(url: string): void {
    this.map.delete(this.host(url));
  }
}

function safeHeaderValue(value: string): string {
  // Node fetch 只接受 ByteString（<= 0xFF）；部分书源会把中文 token/cookie 直接放进 header。
  // 保留 ASCII 与 Latin-1，其余字符按 UTF-8 百分号编码，避免整个请求在 Headers 构造阶段失败。
  return value.replace(/[^	 -~-ÿ]/g, (ch) => encodeURIComponent(ch));
}

function safeHeaderName(name: string): string {
  return name.replace(/[^!-~]/g, "");
}

export function parseHeader(header?: string): Record<string, string> {
  if (!header || !header.trim()) return {};
  const text = header.trim();
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj)) {
        const name = safeHeaderName(key);
        if (name && value !== null && value !== undefined) out[name] = safeHeaderValue(String(value));
      }
      return out;
    } catch {
      return {};
    }
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key.startsWith("@")) continue;
    const name = safeHeaderName(key);
    if (name) out[name] = safeHeaderValue(line.slice(idx + 1).trim());
  }
  return out;
}

export function splitUrlOptions(rule: string): { url: string; options: UrlOptions } {
  const text = rule.trim();
  // 382/383 绿柠的选项是 URL 编码后的 ,%7B...%7D，不是字面量 ,{。
  let idx = text.indexOf(",{");
  if (idx < 0) idx = text.search(/,\s*%7b/i);
  if (idx < 0) return { url: text, options: {} };
  const url = text.slice(0, idx).trim();
  const jsonText = text.slice(idx + 1);
  try {
    return { url, options: JSON.parse(jsonText) as UrlOptions };
  } catch {
    try {
      // 377 红薯/382 绿柠把选项写进 URL 后又被百分号编码：
      // ,{%27method%27:%20%27POST%27,%27body%27:%20%27bid=1%27}
      // 不先解码，JSON.parse 和单引号宽松解析都会失败，详情请求带着整段选项去访问，
      // 书名退化成接口名、目录 bid 为空。
      const decoded = decodeURIComponent(jsonText);
      if (decoded !== jsonText) {
        try {
          return { url, options: JSON.parse(decoded) as UrlOptions };
        } catch {
          const relaxed = decoded.replace(/'([^']*)'/g, (_m, inner: string) => JSON.stringify(inner));
          return { url, options: JSON.parse(relaxed) as UrlOptions };
        }
      }
      const relaxed = jsonText.replace(/'([^']*)'/g, (_m, inner: string) => JSON.stringify(inner));
      return { url, options: JSON.parse(relaxed) as UrlOptions };
    } catch {
      return { url: text, options: {} };
    }
  }
}

/**
 * 解析「地址 + 请求选项」形式的规则值：`https://a.com/api,{"method":"POST","body":"id=1"}`。
 *
 * 直接丢给 `new URL()` 会把 `{"method"...}` 百分号编码进路径，选项彻底丢失——
 * 番茄/QQ阅读这类接口式正文（`be-api/content/ads-read`）就是这么变成「正文是空的」的。
 */
export function resolveRuleUrl(href: string, base: string): string {
  const { url, options } = splitUrlOptions(href);
  const resolved = toAbsoluteUrl(url, base);
  if (!Object.keys(options).length) return resolved;
  return resolved + "," + JSON.stringify(options);
}

/** Legado resolves relative rules by appending to the source url, not by RFC 3986. */
export function resolveUrl(base: string, rel: string): string {
  const trimmed = rel.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  const origin = new URL(base).origin;
  if (trimmed.startsWith("/")) return origin + trimmed;
  return base.replace(/\/+$/, "") + "/" + trimmed.replace(/^\/+/, "");
}

/**
 * 字段值可能是 HTML（书源把整段节点交给 @js 返回，例如 592 的 intro =
 * "@js:result.nextElementSibling()"）。展示层只要纯文本。
 */
function plain(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return /<\/?[a-z][^>]*>/i.test(raw) ? htmlToText(raw) : normalizeText(raw);
}

function isHtml(text: string): boolean {
  return /<[a-zA-Z!/][^>]*>/.test(text);
}

/** 书源级变量：Legado 的 java.put/java.get 与 book.putVariable 共享同一张表，
 *  409 言情小说吧在 tocUrl 里 java.put("ba", …)，目录 JS 再 java.get("ba")。
 *  以前每个 makeContext 都新建 {}，变量出了当前规则就丢，目录直接读 null。 */
const SOURCE_VARS = new WeakMap<object, Record<string, string>>();

function varsFor(source: BookSource): Record<string, string> {
  if (!source || typeof source !== "object") return {};
  let vars = SOURCE_VARS.get(source);
  if (!vars) {
    vars = {};
    SOURCE_VARS.set(source, vars);
  }
  return vars;
}

function makeContext(html: string, url: string, source: BookSource): RuleContext {
  const trimmed = html.trim();
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const json = looksJson ? parseJson(trimmed) : null;
  return {
    kind: json ? "json" : "html",
    html,
    json,
    text: "",
    url,
    baseUrl: url,
    vars: varsFor(source),
    source,
  };
}

function mergeHeaders(...sources: Array<Record<string, string> | string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of sources) {
    if (!item) continue;
    if (typeof item === "string" && item.trim().startsWith("@js")) continue;
    const obj = typeof item === "string" ? parseHeader(item) : item;
    Object.assign(out, obj);
  }
  return out;
}

export class BookSourceEngine {
  private readonly cookies = new CookieStore();

  private readonly jsEvaluator: JsEvaluator = {
    eval: async (code, ctx) => {
      const out = runJsSync(code, {
        result: typeof ctx.result === "string" && ctx.result.trimStart().startsWith("<") ? makeElementShim(ctx.result) : ctx.result,
        json: ctx.json,
        baseUrl: ctx.baseUrl,
        book: ctx.book,
        chapter: ctx.chapter,
        source: ctx.source,
        vars: ctx.vars,
        // Legado 的 JS 环境里 src 是整页内容、title 是当前章节名；缺了它们，
        // 用 src.match(...) 抽 bookid 的书源整条规则直接 ReferenceError。
        src: ctx.docHtml ?? ctx.html ?? "",
        title: String((ctx.chapter as { title?: string } | undefined)?.title ?? ""),
        cookieApi: this.cookies,
        globals: { ...ctx.vars, key: ctx.vars.__keyRaw ?? ctx.vars.key ?? "", page: Number(ctx.vars.page ?? 1) },
      });
      this.debug("js", {
        code: code.length > 240 ? `${code.slice(0, 240)}…` : code,
        baseUrl: ctx.baseUrl ?? "",
        out: typeof out === "string" ? (out.length > 240 ? `${out.slice(0, 240)}…` : out) : out,
      });
      return out;
    },
  };

  constructor(private readonly options: EngineOptions = {}) {}

  private debug(stage: string, payload: Record<string, unknown>): void {
    this.options.onDebug?.({ stage, ...payload });
  }

  /** 解析 source.header；Legado 允许 header 写 @js，返回 JSON 字符串。 */
  private async resolvedHeaders(source: BookSource, vars: Record<string, string>): Promise<Record<string, string> | string | undefined> {
    const raw = source.header;
    if (typeof raw === "string" && raw.trim().startsWith("@js")) {
      const rendered = await evalField(
        raw,
        {
          kind: "html",
          html: "",
          json: null,
          text: "",
          url: "",
          baseUrl: source.bookSourceUrl,
          vars,
          source,
        },
        { js: this.jsEvaluator },
      );
      return parseHeader(rendered);
    }
    return raw;
  }

  async request(rule: string, source: BookSource, vars: Record<string, string>, extraHeaders?: Record<string, string>): Promise<FetchResult> {
    const { url, options } = splitUrlOptions(rule);
    if (options.webView) this.debug("webview-fallback", { url });
    let target = url;
    if (!/^https?:\/\//i.test(target)) {
      try {
        target = resolveUrl(source.bookSourceUrl, target);
      } catch {
        throw new EngineError("RULE_ERROR", `invalid url: ${url}`);
      }
    }
    const cookieHeader = this.cookies.getCookie(target);
    const fetchOptions: FetchOptions = {
      method: options.method ?? "GET",
      headers: mergeHeaders(await this.resolvedHeaders(source, vars), options.headers, extraHeaders, cookieHeader ? { cookie: cookieHeader } : undefined),
      body: options.body,
      charset: options.charset,
      retry: options.retry ?? this.options.retry ?? 0,
      timeoutMs: this.options.timeoutMs ?? 15_000,
      cookieJar: this.options.cookieJar,
    };
    this.debug("request", { url: target, method: fetchOptions.method });
    return fetchText(target, fetchOptions);
  }

  private async render(rule: string, ctx: TemplateContext): Promise<string> {
    return renderTemplate(rule, ctx, this.jsEvaluator);
  }

  /** 调试台用：按与真实抓取相同的上下文/JS 环境求值，避免 trace 另写一套规则解释器。 */
  createContext(html: string, url: string, source: BookSource): RuleContext {
    return makeContext(html, url, source);
  }

  async renderRule(rule: string, ctx: RuleContext): Promise<string> {
    return this.render(rule, ctx as TemplateContext);
  }

  async evaluateField(rule: string | undefined, ctx: RuleContext): Promise<string> {
    return evalField(rule, ctx, { js: this.jsEvaluator });
  }

  async evaluateRule(rule: string | undefined, ctx: RuleContext): Promise<string[]> {
    return evalRule(rule, ctx, { js: this.jsEvaluator });
  }

  async evaluateFieldList(rule: string | undefined, ctx: RuleContext): Promise<string[]> {
    return evalFieldList(rule, ctx, { js: this.jsEvaluator });
  }

  async collectRuleItems(rule: string, ctx: RuleContext): Promise<RuleContext[]> {
    return collectItems(rule, ctx, { js: this.jsEvaluator });
  }

  async search(source: BookSource, key: string, page = 1): Promise<SearchBook[]> {
    const searchUrl = source.searchUrl?.trim();
    if (!searchUrl) throw new EngineError("EMPTY_SEARCH", `source has no searchUrl: ${source.bookSourceName}`);
    const ruleSearch = source.ruleSearch ?? {};
    const errors: string[] = [];

    for (const candidate of splitLinesDeep(searchUrl)) {
      try {
        let keyEncoded = encodeURIComponent(key);
        try {
          const { options: probeOptions } = splitUrlOptions(candidate);
          if (probeOptions.charset && /gb|big5/i.test(probeOptions.charset)) keyEncoded = encodeKey(key, probeOptions.charset);
        } catch {
          /* ignore */
        }
        const rendered = await this.render(candidate, {
          html: "",
          json: null,
          text: "",
          url: "",
          baseUrl: source.bookSourceUrl,
          vars: { key: keyEncoded, page: String(page), __keyRaw: key },
          source,
        });
        const result = await this.request(rendered, source, { key, page: String(page) });
        const ctx = makeContext(result.body, result.url, source);
        const listRule = ruleSearch.bookList;
        if (!listRule) throw new EngineError("RULE_ERROR", "ruleSearch.bookList is empty");
        this.debug("response", { url: result.url, status: result.status, len: result.body.length, head: result.body.slice(0, 120).replace(/\s+/g, " ") });
        const items = await collectItems(listRule, ctx, { js: this.jsEvaluator });
        this.debug("search", { url: result.url, items: items.length });
        const books: SearchBook[] = [];
        for (const item of items) {
          // 每条搜索结果的 @put 变量必须隔离：195 宜搜的 name 规则写 @put:{nid}、
          // author 规则写 @put:{gid}，如果所有结果共用一个 vars，最后一条会把
          // 前一条的 nid/gid 覆盖掉，bookUrl/tocUrl 全部指向最后一本书。
          const itemCtx: RuleContext = { ...item, vars: { ...item.vars } };
          // Legado 按「书名 → 作者 → 分类 → 最新章节 → 简介 → 封面 → 地址」逐字段求值，
          // 后面的规则可以用 {{book.kind}} 之类引用前面已经取到的值（QQ浏览器系书源
          // 的 bookUrl 就是 resourceId={{book.kind}}）。所以这里必须保序并回填 book。
          const book: Partial<BookInfo> = {};
          const scoped = (): typeof itemCtx => ({ ...itemCtx, book });
          const name = plain(await evalField(ruleSearch.name, scoped()));
          if (!name) continue;
          book.name = name;
          book.author = plain(await evalField(ruleSearch.author, scoped()));
          book.kind = plain(await evalField(ruleSearch.kind, scoped()));
          book.lastChapter = plain(await evalField(ruleSearch.lastChapter, scoped()));
          book.intro = plain(await evalField(ruleSearch.intro, scoped()));
          book.coverUrl = cleanCover(toAbsoluteUrl(await evalField(ruleSearch.coverUrl, scoped()), item.baseUrl));
          const rawBookUrl = await evalField(ruleSearch.bookUrl, scoped());
          const bookUrl = toAbsoluteUrl(rawBookUrl, item.baseUrl);
          // 打不开的地址（NaN / 未渲染模板 / 列表页）不要放进候选，否则用户点一次失败一次。
          if (!isUsableBookUrl(bookUrl)) {
            this.debug("search.skip", { name, bookUrl, reason: bookUrlProblem(bookUrl) });
            continue;
          }
          book.bookUrl = bookUrl;
          book.wordCount = plain(await evalField(ruleSearch.wordCount, scoped()));
          books.push({
            name,
            author: book.author ?? "",
            bookUrl,
            coverUrl: book.coverUrl ?? "",
            intro: book.intro ?? "",
            kind: book.kind ?? "",
            lastChapter: book.lastChapter ?? "",
            wordCount: book.wordCount ?? "",
            origin: source.bookSourceUrl,
            originName: source.bookSourceName,
          });
        }
        if (books.length) return dedupeBooks(books);
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    if (errors.length) throw new EngineError("EMPTY_SEARCH", errors.join("; "));
    return [];
  }

  async bookInfo(source: BookSource, bookUrl: string): Promise<BookInfo> {
    const rule = source.ruleBookInfo ?? {};
    const { url } = splitUrlOptions(bookUrl);
    if (!isUsableBookUrl(url)) {
      throw new EngineError("BAD_URL", `book url is not a detail page (${bookUrlProblem(url)}): ${bookUrl}`);
    }
    // bookUrl 也可能带请求选项（377 红薯/382 绿柠的 clientGetBookInfo 是 POST 接口）。
    // 以前这里先 splitUrlOptions 再只把裸 URL 交给 request，POST 选项被丢掉，
    // 详情退化成 GET 接口名，tocUrl 里的 bid 变量为空。
    const result = await this.request(bookUrl, source, {});
    let ctx = makeContext(result.body, result.url, source);
    // 409 言情小说吧的详情 init 用 book.bookUrl 拼接口地址；以前详情上下文没有 book，
    // String(undefined) 让 java.ajax 请求 "undefined"，整个详情直接失败。
    ctx.book = { name: "", author: "", bookUrl: url, tocUrl: url };
    // 195 宜搜的 tocUrl 写 @get:{gid}/@get:{nid}，但详情上下文是新建的，
    // 搜索阶段 @put 的变量不会带过来。bookUrl 的查询串已经带了 gid/nid，
    // 用它们补齐缺失变量，避免 tocUrl 渲染成半截 URL。
    try {
      const parsed = new URL(url);
      for (const [key, value] of parsed.searchParams) {
        if (ctx.vars[key] === undefined || ctx.vars[key] === null || ctx.vars[key] === "") ctx.vars[key] = value;
      }
    } catch {
      /* relative or malformed URL */
    }

    if (rule.init) {
      const initOut = await evalRule(rule.init, ctx, { js: this.jsEvaluator });
      const replaced = initOut.map((value) => value.trim()).find(Boolean);
      if (replaced) {
        // Legado 语义：init 返回值非空时替换整个详情响应，后续字段规则都基于它求值。
        const next = makeContext(replaced, result.url, source);
        next.vars = ctx.vars;
        next.book = ctx.book;
        ctx = next;
        this.debug("bookInfo.init", { url, length: replaced.length, kind: next.kind });
      }
    }

    const ruleCover = toAbsoluteUrl(await evalField(rule.coverUrl, ctx), ctx.baseUrl);
    const name = plain(await evalField(rule.name, ctx)) || extractTitle(result.body) || nameFromUrl(url);
    const author = plain(await evalField(rule.author, ctx));
    const kind = plain(await evalField(rule.kind, ctx));
    const lastChapter = plain(await evalField(rule.lastChapter, ctx));
    const intro = plain(await evalField(rule.intro, ctx)) || extractDescription(result.body);
    const cover = !ruleCover || isJunkImage(ruleCover) ? extractCover(result.body, ctx.baseUrl) || "" : ruleCover;
    // QQ浏览器/松鹤/腾讯浏览器系的 tocUrl 写成 bookId={{book.kind}}，而 kind
    // 本身要到详情响应里取。以前 tocUrl 在 kind 之前求值，模板永远渲染成空串，
    // 目录请求变成 all-chapter?bookId=。先把已解析字段回填到 book，再求 tocUrl。
    ctx.book = {
      ...(ctx.book ?? {}),
      name,
      author,
      kind,
      lastChapter,
      intro,
      coverUrl: cover,
      bookUrl: url,
      tocUrl: ctx.book?.tocUrl || url,
    };
    const tocUrlRaw = await evalField(rule.tocUrl, ctx);
    const tocUrl = tocUrlRaw ? resolveRuleUrl(tocUrlRaw, ctx.baseUrl) : url;
    const info: BookInfo = {
      name,
      author,
      bookUrl: url,
      tocUrl,
      coverUrl: cover,
      intro,
      kind,
      lastChapter,
      wordCount: plain(await evalField(rule.wordCount, ctx)),
      origin: source.bookSourceUrl,
      originName: source.bookSourceName,
    };
    // 290 爱下电子书的 tocUrl 用 `{{java.put("url",baseUrl); ...}}` 把目录前缀
    // 存进 vars，toc 的 chapterUrl 再 `@get:{url}` 取。toc 会新建上下文，
    // 这里把详情阶段变量随 BookInfo 带过去，否则目录 URL 全是空。
    (info as BookInfo & { vars?: Record<string, string> }).vars = { ...ctx.vars };
    this.debug("bookInfo", { url, name: info.name, tocUrl });
    return info;
  }

  async toc(source: BookSource, book: BookInfo): Promise<Chapter[]> {
    const rule = source.ruleToc ?? {};
    const maxPages = this.options.maxTocPages ?? 30;
    const limit = this.options.tocLimit && this.options.tocLimit > 0 ? this.options.tocLimit : 0;
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    let nextUrl = book.tocUrl || book.bookUrl;
    let page = 0;
    let truncated = false;

    while (nextUrl && page < maxPages) {
      page += 1;
      const result = await this.request(nextUrl, source, {});
      const ctx = makeContext(result.body, result.url, source);
      // nextTocUrl 的 JS 常写 book.tocUrl（192/193 完本小说用它拼 2.html、3.html）。
      // 以前 toc 上下文没有 book，String(undefined) 拼出 undefined2.html，第二页直接 404。
      ctx.book = book;
      // 详情阶段的 @put/put 变量（目录前缀、bid 等）要带进目录上下文。
      const bookVars = (book as BookInfo & { vars?: Record<string, string> }).vars;
      if (bookVars) ctx.vars = { ...bookVars };
      const listRule = rule.chapterList;
      if (!listRule) throw new EngineError("RULE_ERROR", "ruleToc.chapterList is empty");
      const items = await collectItems(listRule, ctx, { js: this.jsEvaluator });
      if (items.length > MAX_TOC_CHAPTERS) {
        throw new EngineError("RULE_ERROR", `toc rule matched ${items.length} entries (limit ${MAX_TOC_CHAPTERS}): ${result.url}`);
      }
      let pageRows: Array<{ title: string; url: string; isVip: boolean; isVolume: boolean }> = [];
      for (const item of items) {
        // chapterUrl 留空（或求值不到）时取条目里第一个 <a> 的 href：33 个已启用书源
        // 就是这么写的，靠规则本身永远拿不到链接，整站目录为 0。
        let href = await evalField(rule.chapterUrl ?? rule.url, item);
        if (!href && item.kind === "html") href = firstAnchorHref(item.html);
        const title =
          (await evalField(rule.chapterName ?? rule.name, item)) ||
          (item.kind === "html" ? decodeEntities(item.html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "");
        if (!title || !href) continue;
        pageRows.push({
          title,
          url: resolveRuleUrl(href, item.baseUrl),
          isVip: (await evalField(rule.isVip, item)).toLowerCase() === "true",
          isVolume: (await evalField(rule.isVolume, item)).toLowerCase() === "true",
        });
        if (limit && chapters.length + pageRows.length >= limit) {
          truncated = true;
          break;
        }
      }
      // 规则命中 0 条（站点改版/移动版结构不同）时兜底扫「第 N 章」链接。
      if (!pageRows.length) {
        const rescued = rescueTocLinks(result.body, result.url);
        if (rescued.length) {
          this.debug("toc.rescue", { url: result.url, rows: rescued.length });
          pageRows = rescued.map((row) => ({ ...row, isVip: false, isVolume: false }));
        }
      }
      // 体检会按 tocLimit 截断，截断后 normalizeToc 不再执行；导航条目必须在
      // 截断前就剔掉，否则第一条永远是「首页 / 直达页面底部」，正文必空。
      pageRows = pageRows.filter((row) => !isNavEntry(row, book.name));
      for (const row of pageRows) {
        if (seen.has(row.url)) continue;
        seen.add(row.url);
        chapters.push(row);
      }
      if (chapters.length > MAX_TOC_CHAPTERS) {
        throw new EngineError("RULE_ERROR", `toc has more than ${MAX_TOC_CHAPTERS} chapters, refusing to continue`);
      }
      if (limit && chapters.length >= limit) {
        chapters.length = limit;
        break;
      }
      this.debug("toc", { url: result.url, page, chapters: pageRows.length });
      const nexts = await evalRule(rule.nextTocUrl, ctx, { js: this.jsEvaluator });
      const candidate = nexts.map((n) => toAbsoluteUrl(n, ctx.baseUrl)).find((n) => n && !seen.has(`__next__${n}`));
      if (!candidate || candidate === nextUrl) break;
      seen.add(`__next__${candidate}`);
      nextUrl = candidate;
    }
    // 体检只取前 N 章，列表本身是站点顺序；此时不能再做正倒序归一化，
    // 否则会把截断后的样本整体翻转，正文抽到错误的一章。
    if (truncated) return chapters;
    // 站点目录有正序也有倒序（云起/起点是倒序），存储顺序必须统一成正序，
    // 否则书架里会从最新章节开始，用户找不到第 1 章。
    const normalized = normalizeToc(chapters, book.name);
    if (normalized.reversed) this.debug("toc.reversed", { url: book.tocUrl, chapters: chapters.length });
    return normalized.chapters;
  }

  async content(source: BookSource, chapter: Chapter): Promise<string> {
    const result = await this.contentWithImages(source, chapter);
    return result.text;
  }

  /**
   * 正文 + 插图。
   *
   * 图片在文本管线里是 \u0001IMG<n>\u0001 标记，走完 htmlToText、章节拼接与 replaceRegex
   * 之后才还原成「第几段之后」——先还原的话，替换规则删掉一行广告就会让图片整体错位。
   */
  async contentWithImages(
    source: BookSource,
    chapter: Chapter,
  ): Promise<{ text: string; images: InlineImage[]; pages: ContentPageInfo[] }> {
    const rule = source.ruleContent ?? {};
    const maxPages = this.options.maxContentPages ?? 10;
    const parts: string[] = [];
    const images: string[] = [];
    const pages: ContentPageInfo[] = [];
    let nextUrl: string | undefined = chapter.url;
    let page = 0;
    const visited = new Set<string>();

    while (nextUrl && page < maxPages && !visited.has(nextUrl)) {
      visited.add(nextUrl);
      page += 1;
      const result = await this.request(nextUrl, source, {});
      const ctx = makeContext(result.body, result.url, source);
      ctx.chapter = chapter;
      // Keep every matched paragraph: content rules are list rules, not single-value rules.
      const raws = await evalFieldList(rule.content, ctx, { js: this.jsEvaluator });
      const beforeParts = parts.length;
      const beforeImages = images.length;
      for (const raw of raws) {
        if (isHtml(raw)) {
          const parsed = htmlToTextWithImages(raw, ctx.baseUrl);
          parts.push(parsed.text);
          images.push(...parsed.images);
        } else {
          parts.push(normalizeText(raw));
        }
      }
      const nexts = rule.nextContentUrl ? await evalRule(rule.nextContentUrl, ctx, { js: this.jsEvaluator }) : [];
      const candidate = nexts.map((n) => resolveRuleUrl(n, ctx.baseUrl)).find((n) => n && !visited.has(n));
      // 预览要能看出 nextContentUrl 是「没有下一页」还是「又指回自己」，
      // 所以保留原始候选，而不是只留可用链接。
      const firstCandidate = nexts.map((n) => resolveRuleUrl(n, ctx.baseUrl)).find(Boolean);
      pages.push({
        url: result.url,
        chars: parts.slice(beforeParts).join("").length,
        rows: raws.length,
        images: images.length - beforeImages,
        nextUrl: firstCandidate,
      });
      nextUrl = candidate;
    }

    if (!parts.length) {
      if (chapter.isVip) throw new EngineError("VIP_CHAPTER", "vip chapter without content");
      throw new EngineError("RULE_ERROR", `empty content: ${chapter.url}`);
    }

    let text = parts.join("\n");
    if (rule.replaceRegex) text = applyReplaceRegex(text, rule.replaceRegex);
    const split = splitInlineImages(text, images);
    this.debug("content", { url: chapter.url, pages: page, length: split.text.length, images: split.images.length });
    return { ...split, pages };
  }

  async exploreGroups(source: BookSource): Promise<ExploreGroup[]> {
    const raw = source.exploreUrl?.trim();
    if (!raw) return [];
    if (raw.startsWith("@js:") || raw.startsWith("<js>")) {
      const code = raw.replace(/^@js:/, "").replace(/^<js>/, "").replace(/<\/js>$/, "");
      try {
        const out = await this.jsEvaluator.eval(code, {
          html: "",
          json: null,
          text: "",
          result: "",
          url: "",
          baseUrl: source.bookSourceUrl,
          vars: {},
          source,
        });
        if (Array.isArray(out)) {
          const parsedArray = parseExploreJson(JSON.stringify(out));
          if (parsedArray) return parsedArray;
        }
        const text = String(out ?? "").trim();
        const parsed = parseExploreJson(text);
        if (parsed) return parsed;
      } catch (err) {
        this.debug("explore-groups-error", { error: (err as Error).message });
        return [];
      }
      return [];
    }
    return parseExploreUrl(raw);
  }

  async explore(source: BookSource, groupUrl: string, page = 1, groupTitle = ""): Promise<SearchBook[]> {
    // Plenty of sources only define ruleSearch: their category pages use exactly the
    // same item markup. Legado falls back to the search rule when ruleExplore is empty,
    // which is why those sources used to fail with "ruleExplore.bookList is empty".
    const exploreRule = (source.ruleExplore ?? {}) as Record<string, string | undefined>;
    const searchRule = (source.ruleSearch ?? {}) as Record<string, string | undefined>;
    const rule: Record<string, string | undefined> = { ...searchRule };
    for (const [key, value] of Object.entries(exploreRule)) {
      if (String(value ?? "").trim()) rule[key] = value;
    }
    const target = groupUrl.trim() || source.bookSourceUrl;
    const rendered = await this.render(target, {
      html: "",
      json: null,
      text: "",
      url: "",
      baseUrl: source.bookSourceUrl,
      vars: { page: String(page) },
      source,
    });
    const result = await this.request(rendered, source, { page: String(page) });
    const ctx = makeContext(result.body, result.url, source);
    const listRule = rule.bookList;
    if (!listRule) throw new EngineError("RULE_ERROR", "ruleExplore.bookList is empty");
    const items = await collectItems(listRule, ctx, { js: this.jsEvaluator });
    const books: SearchBook[] = [];
    for (const item of items) {
      const name = plain(await evalField(rule.name, item));
      const bookUrl = toAbsoluteUrl(await evalField(rule.bookUrl, item), item.baseUrl);
      if (!name || !bookUrl) continue;
      // Broad bookList selectors (".layui-row") also match the category navigation, whose
      // "name" is the category heading and whose "url" is the site root. Those entries are
      // not books and used to fill the discovery grid with tiles titled 玄幻 / 都市.
      if (name.includes("\n") || name.length > 60) continue;
      if (groupTitle && name === groupTitle.trim()) continue;
      books.push({
        name,
        author: plain(await evalField(rule.author, item)),
        bookUrl,
        coverUrl: cleanCover(toAbsoluteUrl(await evalField(rule.coverUrl, item), item.baseUrl)),
        intro: plain(await evalField(rule.intro, item)),
        kind: plain(await evalField(rule.kind, item)),
        lastChapter: plain(await evalField(rule.lastChapter, item)),
        wordCount: plain(await evalField(rule.wordCount, item)),
        origin: source.bookSourceUrl,
        originName: source.bookSourceName,
      });
    }
    this.debug("explore", { url: result.url, items: books.length });
    return dedupeBooks(books);
  }
}

/** Some sources embed raw newlines/tabs inside JSON strings; escape them before parsing. */
export function repairJsonControlChars(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      out += ch.charCodeAt(0) < 0x20 ? " " : ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/** Repair common hand-written JSON slips such as an unquoted title value. */
export function repairLooseJson(text: string): string {
  const escaped = repairJsonControlChars(text);
  return escaped.replace(/("title"\s*:\s*)([^"\s][^",\n]*)(\s*")/g, '$1"$2$3');
}

export function parseExploreJson(text: string): ExploreGroup[] | null {
  for (const candidate of [text, repairJsonControlChars(text), repairLooseJson(text)]) {
    try {
      const arr = JSON.parse(candidate) as Array<{ title?: string; url?: string }>;
      if (!Array.isArray(arr)) continue;
      return arr
        .filter((item) => item && typeof item.url === "string" && item.url.trim())
        .map((item) => ({ title: item.title?.trim() || item.url!.trim(), url: item.url!.trim() }));
    } catch {
      /* try the repaired variant next */
    }
  }
  return null;
}

function unescapeLoose(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * Some sources ship an almost-JSON exploreUrl: the array is pretty printed but
 * one nested string is over-escaped, so JSON.parse rejects the whole thing.
 * Extract the title/url pairs per object instead of turning every line into a
 * bogus group (a 78 KB Qidian array used to produce 387 junk chips).
 */
function parseLooseExploreGroups(text: string): ExploreGroup[] {
  const groups: ExploreGroup[] = [];
  const pair = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(text))) {
    const title = unescapeLoose(match[1]).trim();
    const url = unescapeLoose(match[2]).trim();
    if (!url) continue;
    groups.push({ title: title || url, url });
  }
  return groups;
}

export function parseExploreUrl(raw: string): ExploreGroup[] {
  const text = raw.trim();
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = parseExploreJson(text);
    if (parsed) return parsed;
    return parseLooseExploreGroups(text);
  }
  const groups: ExploreGroup[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("::");
    if (idx > 0) groups.push({ title: trimmed.slice(0, idx).trim(), url: trimmed.slice(idx + 2).trim() });
    else groups.push({ title: trimmed, url: trimmed });
  }
  return groups;
}

export function applyReplaceRegex(text: string, rule: string): string {
  const trimmed = rule.trim();
  if (!trimmed) return text;
  const parts = trimmed.split("##");
  const pattern = parts[0] === "" ? parts[1] : parts[0];
  const replacement = parts[0] === "" ? parts[2] ?? "" : parts[1] ?? "";
  const flags = parts[0] === "" ? parts[3] ?? "" : parts[2] ?? "";
  if (!pattern) return text;
  const global = flags.includes("#") || trimmed.endsWith("###");
  try {
    return text.replace(new RegExp(pattern, global ? "g" : ""), replacement);
  } catch {
    return text;
  }
}

function cleanCover(url: string): string {
  return url && !isJunkImage(url) ? url : "";
}

function dedupeBooks(books: SearchBook[]): SearchBook[] {
  const seen = new Set<string>();
  const out: SearchBook[] = [];
  for (const book of books) {
    // 同一本书在同一个源里重复出现时，地址才是唯一标识；没有地址才退回书名+作者。
    const key = book.bookUrl ? book.bookUrl : `${book.name}::${book.author}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(book);
  }
  return out;
}
