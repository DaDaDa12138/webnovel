import {
  BookSourceEngine,
  EngineError,
  type BookInfo,
  type BookSource,
  type Chapter,
  type FetchResult,
  type RuleContext,
  countContentChars,
  extractCover,
  extractDescription,
  extractTitle,
  htmlToText,
  isJunkImage,
  isUsableBookUrl,
  normalizeText,
  parseHeader,
  toAbsoluteUrl,
} from "@legado/engine";
import type {
  SourceParseTrace,
  SourceTraceErrorKind,
  SourceTraceField,
  SourceTraceItem,
  SourceTracePage,
  SourceTraceRequest,
  SourceTraceRuleKind,
  SourceTraceStage,
  SourceTraceStageResult,
  SourceTraceStatus,
} from "@legado/shared";

export interface TraceSourceMeta {
  id: number;
  name: string;
  url: string;
  group: string;
  status: string;
}

export interface TraceOptions {
  stage?: SourceParseTrace["mode"];
  key?: string;
  page?: number;
  bookUrl?: string;
  chapterUrl?: string;
  maxItems?: number;
  maxPages?: number;
}

interface TraceErrorContext {
  status?: number;
  body?: string;
  chars?: number;
  rule?: string;
}

interface ClassifiedTraceError {
  kind: SourceTraceErrorKind;
  message: string;
  hint: string;
}

interface StageOutcome {
  result: SourceTraceStageResult;
  bookUrl?: string;
  tocUrl?: string;
  chapterUrl?: string;
  book?: BookInfo;
  chapter?: Chapter;
}

const MAX_TEXT = 20_000;
const MAX_VALUE = 600;
const MAX_FIELD_VALUES = 8;
const MAX_ITEMS = 8;
const MAX_PAGES = 5;

const HINTS: Record<SourceTraceErrorKind, string> = {
  timeout: "站点在超时时间内没有响应。先确认源地址可访问，再检查是否需要代理或登录。",
  network: "DNS 或连接失败。检查域名是否失效、是否需要代理，以及源地址是否还指向原站点。",
  http: "站点返回 4xx/5xx。可能是防盗链、Cloudflare 拦截，或书源地址已经变更。",
  blocked: "页面像验证码 / Cloudflare / 访问频繁拦截页。换 UA、补 Header，或稍后重试。",
  login: "页面要求登录。到「请求设置」补 Cookie，或先用登录页探测登录态。",
  vip: "这是 VIP / 付费章节，规则源通常拿不到完整正文。",
  selector_empty: "规则没有命中任何节点。检查选择器、页面是否改版，或到「请求设置」看返回 HTML。",
  rule_error: "规则语法或字段结构有问题。先跑「规则体检」，再逐字段对照页面。",
  js_error: "JS 规则执行失败。检查 @js 里的 result / src 变量，以及站点返回是否为空。",
  webview: "书源需要 WebView 或外部浏览器执行页面 JS；当前服务端阅读引擎没有浏览器内核，建议换用无需 WebView 的书源或改用静态接口。",
  url: "书籍或章节地址无效。确认传入的是详情页 / 章节页，而不是搜索页或目录页。",
  too_large: "响应体超过限制，规则可能匹配到了整站 JSON。缩小列表规则或改用更具体的接口。",
  charset: "正文出现替换字符，可能是编码识别错误。检查源地址的 charset 参数。",
  empty_content: "正文规则命中了内容，但有效字数少于 120 字，可能只取到广告或提示。",
  unknown: "没有识别的失败类型。展开请求摘要和原始规则，先确认页面是否正常返回。",
};

function clip(value: string, max = MAX_VALUE): string {
  const text = String(value ?? "");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function plain(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return /<\/?[a-z][^>]*>/i.test(raw) ? htmlToText(raw) : normalizeText(raw);
}

function errorMessage(err: unknown): string {
  return String((err as Error)?.message ?? err ?? "未知错误");
}

export function redactHeader(name: string, value: string): string {
  if (!value) return "";
  if (/cookie|authorization|token|secret|password|api[-_]?key/i.test(name)) return "••••（已隐藏）";
  if (/^set-cookie$/i.test(name)) return "••••（已隐藏）";
  return clip(redactUrlsInText(value), 160);
}

const SECRET_QUERY = /(?:^|[_-])(token|key|secret|password|passwd|auth|authorization|sign|signature|session|sid|cookie|expires|api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|session[_-]?id|access[_-]?token|refresh[_-]?token)$/i;

/** 调试台展示 URL 前去掉 userinfo 和敏感查询参数，避免 token 被复制进诊断 JSON。 */
export function redactUrl(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//");
  try {
    const url = new URL(text, "http://redact.invalid");
    let changed = false;
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      changed = true;
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (!SECRET_QUERY.test(key)) continue;
      url.searchParams.set(key, "redacted");
      changed = true;
    }
    if (!changed) return text;
    if (absolute) return url.toString();
    return url.pathname + url.search + url.hash;
  } catch {
    return text;
  }
}

/** 字段值和正文里可能夹着完整 URL，按 URL 边界逐个脱敏。 */
export function redactUrlsInText(text: string): string {
  return String(text ?? "").replace(/https?:\/\/[^\s"'<>]+/g, (url) => redactUrl(url));
}

export function traceRuleKind(rule?: string): SourceTraceRuleKind {
  const value = String(rule ?? "").trim();
  if (!value) return "empty";
  if (/@js:|<js[\s>]/i.test(value)) return "js";
  if (/@regex:/i.test(value)) return "regex";
  if (/^\$[.[]/.test(value) || /@json:/i.test(value)) return "json";
  if (/@css:|@xpath:|@jsoup:/i.test(value)) return "selector";
  if (/^[a-zA-Z][\w-]*(?:\[|\.|#|\s|>|:|$)/.test(value)) return "selector";
  return "text";
}

/** 把引擎/HTTP/页面特征归成可操作的错误类型；调试台据此给下一步建议。 */
export function classifyTraceError(stage: SourceTraceStage, err: unknown, context: TraceErrorContext = {}): ClassifiedTraceError {
  const raw = errorMessage(err);
  const lower = raw.toLowerCase();
  const body = String(context.body ?? "").slice(0, 6_000);
  const combined = lower + "\n" + body.toLowerCase();
  const code = err instanceof EngineError ? err.code : "";
  const status = Number(context.status ?? 0);
  const charsKnown = context.chars !== undefined;
  const chars = Number(context.chars ?? 0);
  let kind: SourceTraceErrorKind = "unknown";

  if (code === "TIMEOUT" || /timeout|timed out|etimedout|aborted|abort/i.test(lower)) kind = "timeout";
  else if (code === "NET_ERROR" || /enotfound|econnrefused|econnreset|socket|network|dns|fetch failed/i.test(lower)) kind = "network";
  else if (code === "TOO_LARGE" || /too large|max.*bytes|body.*limit/i.test(lower)) kind = "too_large";
  else if (code === "BAD_URL" || /invalid url|bad url|unsupported protocol/i.test(lower)) kind = "url";
  else if (code === "UNSUPPORTED_WEBVIEW" || /java\.(?:webview|startbrowser)|unsupported_webview|需要.*(?:浏览器|webview)/i.test(lower)) kind = "webview";
  else if (code === "JS_ERROR" || /referenceerror|typeerror|syntaxerror.*js|javascript.*error|js error/i.test(lower)) kind = "js_error";
  else if (code === "RULE_ERROR" || /rule.*(?:error|empty|invalid)|selector.*(?:error|invalid)|syntax error/i.test(lower)) kind = "rule_error";
  else if (code === "VIP_CHAPTER" || /vip|付费|订阅章节|购买本章/i.test(combined)) kind = "vip";
  else if (code === "BLOCKED" || /cf-chl|cf-challenge|attention required|ray id|captcha|验证码|人机验证|访问频繁|访问过于频繁|forbidden by robots/i.test(combined)) kind = "blocked";
  else if (/请先登录|请登录|登录后(?:查看|阅读)|login required|sign in to/i.test(combined)) kind = "login";
  else if (status >= 400) kind = "http";
  else if (charsKnown && chars === 0 && stage === "content") kind = "selector_empty";
  else if (stage === "content" && charsKnown && chars > 0 && chars < 120) kind = "empty_content";
  else if (/charset|乱码|decode|encoding/i.test(lower)) kind = "charset";
  else if (charsKnown && chars === 0) kind = "selector_empty";

  return { kind, message: clip(raw || HINTS[kind], 400), hint: HINTS[kind] };
}

function requestInfo(source: BookSource, result: FetchResult, ms: number): SourceTraceRequest {
  const headers: Array<{ name: string; value: string }> = [];
  try {
    for (const [name, value] of Object.entries(parseHeader(source.header ?? ""))) {
      headers.push({ name, value: redactHeader(name, String(value ?? "")) });
    }
  } catch {
    /* header 解析失败留给规则体检，不阻断 trace */
  }
  const body = String(result.body ?? "");
  return {
    url: redactUrl(result.url),
    finalUrl: redactUrl(result.url),
    status: Number(result.status ?? 0),
    ms,
    bytes: Buffer.byteLength(body, "utf8"),
    charset: result.charset ?? "auto",
    kind: body.trimStart().startsWith("{") || body.trimStart().startsWith("[") ? "json" : "html",
    headers,
    cookieJar: Boolean(source.enabledCookieJar),
  };
}

function fieldOf(field: string, rule: string | undefined, values: string[], error?: string): SourceTraceField {
  const cleaned = values.map((value) => plain(value)).filter(Boolean);
  return {
    field,
    rule: redactUrlsInText(String(rule ?? "")),
    kind: traceRuleKind(rule),
    count: cleaned.length,
    values: cleaned.slice(0, MAX_FIELD_VALUES).map((value) => clip(redactUrlsInText(redactUrl(value)))),
    truncated: cleaned.length > MAX_FIELD_VALUES,
    error,
  };
}

async function fieldFrom(
  engine: BookSourceEngine,
  field: string,
  rule: string | undefined,
  contexts: RuleContext[],
): Promise<SourceTraceField> {
  if (!String(rule ?? "").trim()) return fieldOf(field, rule, []);
  const values: string[] = [];
  let error = "";
  for (const ctx of contexts) {
    try {
      const value = await engine.evaluateField(rule, ctx);
      if (value) values.push(value);
    } catch (err) {
      error = clip(errorMessage(err), 240);
    }
  }
  return fieldOf(field, rule, values, error || undefined);
}

function stageLabel(stage: SourceTraceStage): string {
  return { search: "搜索", detail: "详情", toc: "目录", content: "正文" }[stage];
}

function failStage(
  stage: SourceTraceStage,
  started: number,
  err: unknown,
  request?: SourceTraceRequest,
  context: TraceErrorContext = {},
): SourceTraceStageResult {
  const classified = classifyTraceError(stage, err, context);
  return {
    stage,
    label: stageLabel(stage),
    status: "fail",
    ms: Date.now() - started,
    summary: classified.hint,
    request,
    fields: [],
    error: classified.message,
    errorKind: classified.kind,
    hint: classified.hint,
  };
}

function skipStage(stage: SourceTraceStage, reason: string): SourceTraceStageResult {
  return {
    stage,
    label: stageLabel(stage),
    status: "skip",
    ms: 0,
    summary: reason,
    fields: [],
  };
}

function firstAnchorHref(html: string): string {
  const text = String(html ?? "");
  const hit =
    text.match(/^\s*<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i) ??
    text.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  return hit ? hit[1] : "";
}

function absolute(value: string, base: string): string {
  const raw = String(value ?? "").trim();
  if (!raw || /^javascript:/i.test(raw)) return "";
  // 已经是绝对地址就原样保留。部分书源的章节地址是「URL,{JSON 选项}」形式，
  // 用 new URL() 规范化会把 JSON 里的引号编码成 %22，并在部分字符前插入 /，
  // 服务端再按这个地址请求就会 404；引擎内部拿到的原始地址是能正常请求的。
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return toAbsoluteUrl(raw, base);
  } catch {
    return "";
  }
}

async function traceSearch(engine: BookSourceEngine, source: BookSource, options: Required<Pick<TraceOptions, "key" | "page" | "maxItems">>): Promise<StageOutcome> {
  const started = Date.now();
  const searchUrl = String(source.searchUrl ?? "").trim();
  if (!searchUrl) {
    return { result: failStage("search", started, "书源没有配置 searchUrl", undefined, { chars: 0 }) };
  }
  try {
    const baseCtx = engine.createContext("", source.bookSourceUrl, source);
    baseCtx.vars = { key: encodeURIComponent(options.key), page: String(options.page), __keyRaw: options.key };
    const rendered = await engine.renderRule(searchUrl, baseCtx);
    const response = await engine.request(rendered, source, { key: options.key, page: String(options.page) });
    const request = requestInfo(source, response, Date.now() - started);
    if (response.status >= 400) {
      return { result: failStage("search", started, `HTTP ${response.status}`, request, { status: response.status, body: response.body }) };
    }
    const ctx = engine.createContext(response.body, response.url, source);
    ctx.vars = baseCtx.vars;
    const listRule = String(source.ruleSearch?.bookList ?? "").trim();
    if (!listRule) {
      return { result: failStage("search", started, "ruleSearch.bookList 为空", request, { chars: 0, rule: listRule }) };
    }
    const itemContexts = await engine.collectRuleItems(listRule, ctx);
    const sample = itemContexts.slice(0, options.maxItems);
    const fields: SourceTraceField[] = [{
      field: "ruleSearch.bookList",
      rule: redactUrlsInText(listRule),
      kind: traceRuleKind(listRule),
      count: itemContexts.length,
      values: [`${itemContexts.length} 个条目`],
    }];
    // 搜索字段必须按 Legado 的顺序逐条求值，并把前一个字段回填到 book：
    // QQ浏览器系的 bookUrl 是 resourceId={{book.kind}}，kind 在 bookUrl 之前。
    // 以前这里对每个字段独立跑一遍 sample，book 永远是空的，追踪里所有地址都是
    // resourceId=，pipeline 也因此误判成「没有书籍地址」。
    const fieldOrder = ["name", "author", "kind", "lastChapter", "wordCount", "bookUrl"] as const;
    const fieldValues = new Map<string, string[]>();
    const fieldErrors = new Map<string, string>();
    for (const name of fieldOrder) fieldValues.set(name, []);
    const items: SourceTraceItem[] = [];
    let firstBookUrl = "";
    for (let i = 0; i < sample.length; i += 1) {
      const item = sample[i];
      const book: Partial<BookInfo> = {};
      const scoped = (): RuleContext => ({ ...item, book });
      const evalOne = async (name: (typeof fieldOrder)[number]): Promise<string> => {
        try {
          const value = plain(await engine.evaluateField(source.ruleSearch?.[name], scoped()));
          if (value) fieldValues.get(name)?.push(value);
          return value;
        } catch (err) {
          fieldErrors.set(name, clip(errorMessage(err), 240));
          return "";
        }
      };
      const title = await evalOne("name");
      if (!title) continue;
      book.name = title;
      book.author = await evalOne("author");
      book.kind = await evalOne("kind");
      book.lastChapter = await evalOne("lastChapter");
      book.wordCount = await evalOne("wordCount");
      const rawHref = await evalOne("bookUrl");
      const href = absolute(rawHref, item.baseUrl);
      if (!firstBookUrl && href && isUsableBookUrl(href)) firstBookUrl = href;
      items.push({ index: i + 1, title, subtitle: book.author || undefined, url: href ? redactUrl(href) : undefined });
    }
    for (const name of fieldOrder) {
      fields.push(fieldOf(`ruleSearch.${name}`, source.ruleSearch?.[name], fieldValues.get(name) ?? [], fieldErrors.get(name)));
    }
    const nameField = fields.find((field) => field.field === "ruleSearch.name");
    const urlField = fields.find((field) => field.field === "ruleSearch.bookUrl");
    const status: SourceTraceStatus = itemContexts.length ? "ok" : "empty";
    const summary = itemContexts.length
      ? `列表 ${itemContexts.length} 条 · 书名 ${nameField?.count ?? 0} · 地址 ${urlField?.count ?? 0}`
      : "列表规则没有命中任何条目";
    return {
      result: { stage: "search", label: "搜索", status, ms: Date.now() - started, summary, request, fields, items },
      bookUrl: firstBookUrl,
    };
  } catch (err) {
    return { result: failStage("search", started, err) };
  }
}

async function traceDetail(engine: BookSourceEngine, source: BookSource, bookUrl: string): Promise<StageOutcome> {
  const started = Date.now();
  if (!bookUrl.trim()) return { result: skipStage("detail", "没有可用的书籍地址") };
  if (!isUsableBookUrl(bookUrl)) {
    return { result: failStage("detail", started, "书籍地址不可用", undefined, { chars: 0 }) };
  }
  try {
    const response = await engine.request(bookUrl, source, {});
    const request = requestInfo(source, response, Date.now() - started);
    if (response.status >= 400) {
      return { result: failStage("detail", started, `HTTP ${response.status}`, request, { status: response.status, body: response.body }) };
    }
    let ctx = engine.createContext(response.body, response.url, source);
    ctx.book = { name: "", author: "", bookUrl: response.url, tocUrl: response.url };
    const initRule = String(source.ruleBookInfo?.init ?? "").trim();
    if (initRule) {
      const init = await engine.evaluateRule(initRule, ctx);
      if (init.length) {
        const next = engine.createContext(init.join("\n"), response.url, source);
        next.book = ctx.book;
        ctx = next;
      }
    }
    const fields: SourceTraceField[] = [];
    for (const name of ["name", "author", "intro", "kind", "lastChapter", "wordCount", "coverUrl"] as const) {
      fields.push(await fieldFrom(engine, `ruleBookInfo.${name}`, source.ruleBookInfo?.[name], [ctx]));
    }
    const value = (name: string): string => fields.find((field) => field.field === `ruleBookInfo.${name}`)?.values[0] ?? "";
    // 和引擎一样，先回填详情字段，再求 tocUrl；否则 bookId={{book.kind}} 会是空串。
    ctx.book = {
      name: value("name"),
      author: value("author"),
      intro: value("intro"),
      kind: value("kind"),
      lastChapter: value("lastChapter"),
      wordCount: value("wordCount"),
      coverUrl: value("coverUrl"),
      bookUrl: response.url,
      tocUrl: response.url,
    };
    fields.push(await fieldFrom(engine, "ruleBookInfo.tocUrl", source.ruleBookInfo?.tocUrl, [ctx]));
    const name = value("name") || extractTitle(response.body);
    const author = value("author");
    const intro = value("intro") || extractDescription(response.body);
    const kind = value("kind");
    const lastChapter = value("lastChapter");
    const wordCount = value("wordCount");
    let coverUrl = value("coverUrl");
    if (!coverUrl || isJunkImage(coverUrl)) coverUrl = extractCover(response.body, response.url);
    coverUrl = absolute(coverUrl, response.url);
    const tocRaw = value("tocUrl");
    const tocUrl = absolute(tocRaw || response.url, response.url);
    const book: BookInfo = {
      name,
      author,
      bookUrl: response.url,
      tocUrl,
      coverUrl,
      intro,
      kind,
      lastChapter,
      wordCount,
      origin: "",
      originName: String(source.bookSourceName ?? ""),
    };
    const status: SourceTraceStatus = name && tocUrl ? "ok" : "empty";
    const summary = name
      ? `${name} · 目录${tocUrl ? "已解析" : "未解析"}${author ? " · " + author : ""}`
      : "详情规则没有命中书名";
    return {
      result: { stage: "detail", label: "详情", status, ms: Date.now() - started, summary, request, fields },
      book,
      bookUrl: book.bookUrl,
      tocUrl,
    };
  } catch (err) {
    return { result: failStage("detail", started, err) };
  }
}

async function traceToc(engine: BookSourceEngine, source: BookSource, book: BookInfo | undefined, fallbackUrl: string): Promise<StageOutcome> {
  const started = Date.now();
  const tocUrl = String(book?.tocUrl || fallbackUrl || "").trim();
  if (!tocUrl) return { result: skipStage("toc", "没有可用的目录地址") };
  try {
    const response = await engine.request(tocUrl, source, {});
    const request = requestInfo(source, response, Date.now() - started);
    if (response.status >= 400) {
      return { result: failStage("toc", started, `HTTP ${response.status}`, request, { status: response.status, body: response.body }) };
    }
    const ctx = engine.createContext(response.body, response.url, source);
    // 目录的 chapterUrl 经常用 book.kind 拼 POST body（QQ/松鹤等 JSON 目录）。
    // 不注入 book 时，追踪器能生成地址但缺少 BookID，正文接口只返回 31 字节错误。
    if (book) ctx.book = book;
    const listRule = String(source.ruleToc?.chapterList ?? "").trim();
    if (!listRule) {
      return { result: failStage("toc", started, "ruleToc.chapterList 为空", request, { chars: 0, rule: listRule }) };
    }
    const itemContexts = await engine.collectRuleItems(listRule, ctx);
    const sample = itemContexts.slice(0, MAX_ITEMS);
    const fields: SourceTraceField[] = [{
      field: "ruleToc.chapterList",
      rule: redactUrlsInText(listRule),
      kind: traceRuleKind(listRule),
      count: itemContexts.length,
      values: [`${itemContexts.length} 个章节节点`],
    }];
    fields.push(await fieldFrom(engine, "ruleToc.chapterName", source.ruleToc?.chapterName, sample));
    fields.push(await fieldFrom(engine, "ruleToc.chapterUrl", source.ruleToc?.chapterUrl, sample));
    fields.push(await fieldFrom(engine, "ruleToc.nextTocUrl", source.ruleToc?.nextTocUrl, [ctx]));
    const items: SourceTraceItem[] = [];
    let firstChapter: Chapter | undefined;
    for (let i = 0; i < sample.length; i += 1) {
      const item = sample[i];
      const title = plain(await engine.evaluateField(source.ruleToc?.chapterName, item));
      const hrefRaw = (await engine.evaluateField(source.ruleToc?.chapterUrl, item)) || firstAnchorHref(item.html);
      const href = absolute(hrefRaw, item.baseUrl);
      if (!title && !href) continue;
      items.push({ index: i + 1, title: title || "（未命中章节名）", subtitle: href ? redactUrl(href) : undefined, url: href ? redactUrl(href) : undefined });
      if (!firstChapter && href) firstChapter = { title: title || "第 1 章", url: href, isVip: false, isVolume: false };
    }
    const next = (await engine.evaluateRule(source.ruleToc?.nextTocUrl, ctx))
      .map((value) => absolute(value, response.url))
      .filter(Boolean);
    const status: SourceTraceStatus = itemContexts.length ? "ok" : "empty";
    const summary = itemContexts.length
      ? `本页 ${itemContexts.length} 章${next.length ? " · 有下一页" : ""}`
      : "目录规则没有命中章节";
    return {
      result: { stage: "toc", label: "目录", status, ms: Date.now() - started, summary, request, fields, items },
      chapterUrl: firstChapter?.url,
      chapter: firstChapter,
    };
  } catch (err) {
    return { result: failStage("toc", started, err) };
  }
}

async function traceContent(engine: BookSourceEngine, source: BookSource, chapterUrl: string, maxPages: number): Promise<StageOutcome> {
  const started = Date.now();
  if (!chapterUrl.trim()) return { result: skipStage("content", "没有可用的章节地址") };
  const contentRule = String(source.ruleContent?.content ?? "").trim();
  if (!contentRule) {
    return { result: failStage("content", started, "ruleContent.content 为空", undefined, { chars: 0, rule: contentRule }) };
  }
  try {
    const pages: SourceTracePage[] = [];
    const texts: string[] = [];
    const values: string[] = [];
    const nextValues: string[] = [];
    const visited = new Set<string>();
    let url = chapterUrl.trim();
    let rawCount = 0;
    let lastRequest: SourceTraceRequest | undefined;
    for (let page = 0; page < Math.min(maxPages, MAX_PAGES); page += 1) {
      if (!url || visited.has(url)) break;
      visited.add(url);
      const pageStarted = Date.now();
      const response = await engine.request(url, source, {});
      lastRequest = requestInfo(source, response, Date.now() - pageStarted);
      if (response.status >= 400) {
        return { result: failStage("content", started, `HTTP ${response.status}`, lastRequest, { status: response.status, body: response.body }) };
      }
      const ctx = engine.createContext(response.body, response.url, source);
      ctx.chapter = { title: "手动指定章节", url: response.url, isVip: false, isVolume: false };
      const raws = await engine.evaluateFieldList(contentRule, ctx);
      rawCount += raws.length;
      const pageText = raws
        .map((raw) => (/<\/?[a-z][^>]*>/i.test(raw) ? htmlToText(raw) : normalizeText(raw)))
        .filter(Boolean)
        .join("\n")
        .trim();
      const pageParagraphs = pageText.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
      if (pageText) {
        texts.push(pageText);
        if (values.length < MAX_FIELD_VALUES) values.push(clip(pageText));
      }
      const nextRaw = await engine.evaluateRule(source.ruleContent?.nextContentUrl, ctx);
      const nextUrl = nextRaw.map((value) => absolute(value, response.url)).find((value) => value && !visited.has(value));
      if (nextUrl && nextValues.length < MAX_FIELD_VALUES) nextValues.push(nextUrl);
      pages.push({
        url: redactUrl(response.url),
        status: response.status,
        chars: countContentChars(pageText),
        paragraphs: pageParagraphs,
        ms: Date.now() - pageStarted,
        nextUrl: nextUrl ? redactUrl(nextUrl) : undefined,
      });
      if (!nextUrl) break;
      url = nextUrl;
    }
    const text = texts.join("\n\n").trim();
    const chars = countContentChars(text);
    const paragraphs = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const fields: SourceTraceField[] = [
      { field: "ruleContent.content", rule: redactUrlsInText(contentRule), kind: traceRuleKind(contentRule), count: rawCount, values, truncated: rawCount > values.length },
      { field: "ruleContent.nextContentUrl", rule: redactUrlsInText(String(source.ruleContent?.nextContentUrl ?? "")), kind: traceRuleKind(source.ruleContent?.nextContentUrl), count: nextValues.length, values: nextValues },
    ];
    const items: SourceTraceItem[] = paragraphs.slice(0, 12).map((line, i) => ({ index: i + 1, title: clip(redactUrlsInText(line), 180), chars: countContentChars(line) }));
    const status: SourceTraceStatus = chars >= 120 ? "ok" : "empty";
    const summary = chars
      ? `${pages.length} 页 · ${chars} 字 · ${paragraphs.length} 段`
      : "正文规则没有命中内容";
    const classified = chars > 0 && chars < 120 ? classifyTraceError("content", "正文少于 120 字", { chars }) : null;
    return {
      result: {
        stage: "content",
        label: "正文",
        status,
        ms: Date.now() - started,
        summary,
        request: lastRequest,
        fields,
        items,
        text: clip(redactUrlsInText(text), MAX_TEXT),
        textTruncated: text.length > MAX_TEXT,
        pages,
        error: classified?.message,
        errorKind: classified?.kind,
        hint: classified?.hint,
      },
      chapterUrl: pages[0]?.url ?? chapterUrl,
    };
  } catch (err) {
    return { result: failStage("content", started, err) };
  }
}

function finish(
  meta: TraceSourceMeta,
  mode: SourceParseTrace["mode"],
  options: Required<Pick<TraceOptions, "key" | "page">>,
  stages: SourceTraceStageResult[],
  started: number,
  book?: BookInfo,
  chapter?: Chapter,
): SourceParseTrace {
  const failed = stages.find((stage) => stage.status === "fail");
  return {
    source: { ...meta, url: redactUrl(meta.url) },
    mode,
    key: options.key,
    page: options.page,
    ms: Date.now() - started,
    stages,
    book: book ? { name: book.name, author: book.author, bookUrl: redactUrl(book.bookUrl), tocUrl: redactUrl(book.tocUrl) } : undefined,
    chapter: chapter ? { title: chapter.title, url: redactUrl(chapter.url), isVip: chapter.isVip } : undefined,
    error: failed?.error,
    errorKind: failed?.errorKind,
    hint: failed?.hint,
  };
}

/**
 * 逐阶段执行书源规则，并把每个字段的规则、命中数和值带回。
 * 只读：不写书架、不写健康档案；失败也不会改变书源状态。
 */
export async function traceSource(source: BookSource, meta: TraceSourceMeta, options: TraceOptions = {}): Promise<SourceParseTrace> {
  const started = Date.now();
  const mode: SourceParseTrace["mode"] = options.stage ?? "pipeline";
  const key = String(options.key ?? "诡秘之主").trim() || "诡秘之主";
  const page = Math.max(1, Number(options.page ?? 1) || 1);
  const maxItems = Math.max(1, Math.min(10, Number(options.maxItems ?? 5) || 5));
  const maxPages = Math.max(1, Math.min(MAX_PAGES, Number(options.maxPages ?? 3) || 3));
  const engine = new BookSourceEngine({ timeoutMs: 30_000, maxTocPages: 1, maxContentPages: maxPages });
  const stages: SourceTraceStageResult[] = [];
  let book: BookInfo | undefined;
  let chapter: Chapter | undefined;
  let bookUrl = String(options.bookUrl ?? "").trim();
  let chapterUrl = String(options.chapterUrl ?? "").trim();

  if (mode === "search" || mode === "pipeline") {
    const search = await traceSearch(engine, source, { key, page, maxItems });
    stages.push(search.result);
    bookUrl = bookUrl || search.bookUrl || "";
    if (mode === "search" || search.result.status === "fail") {
      return finish(meta, mode, { key, page }, stages, started, book, chapter);
    }
  }

  if (mode === "detail" || mode === "pipeline" || mode === "toc") {
    if (!bookUrl) {
      stages.push(skipStage("detail", "没有书籍地址，先完成搜索或手动填写书籍 URL"));
    } else {
      const detail = await traceDetail(engine, source, bookUrl);
      stages.push(detail.result);
      book = detail.book;
      bookUrl = detail.bookUrl || bookUrl;
      if (detail.result.status === "fail") return finish(meta, mode, { key, page }, stages, started, book, chapter);
    }
    if (mode === "detail") return finish(meta, mode, { key, page }, stages, started, book, chapter);
  }

  if (mode === "toc" || mode === "pipeline") {
    if (!book) {
      stages.push(skipStage("toc", "没有详情结果，无法解析目录"));
    } else {
      const toc = await traceToc(engine, source, book, bookUrl);
      stages.push(toc.result);
      chapterUrl = chapterUrl || toc.chapterUrl || "";
      chapter = toc.chapter;
      if (toc.result.status === "fail") return finish(meta, mode, { key, page }, stages, started, book, chapter);
    }
    if (mode === "toc") return finish(meta, mode, { key, page }, stages, started, book, chapter);
  }

  if (mode === "content" || mode === "pipeline") {
    if (!chapterUrl) {
      stages.push(skipStage("content", "没有章节地址，先完成目录或手动填写章节 URL"));
    } else {
      const content = await traceContent(engine, source, chapterUrl, maxPages);
      stages.push(content.result);
      chapter = chapter ?? content.chapter;
    }
  }

  return finish(meta, mode, { key, page }, stages, started, book, chapter);
}
