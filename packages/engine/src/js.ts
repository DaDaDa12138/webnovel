import vm from "node:vm";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { load } from "cheerio";
import { EngineError } from "./errors.js";
import { evalJsoupRule, queryHtml, translateJsoupPseudos } from "./html.js";
import { queryXpath, queryXpathElements } from "./xpath.js";
import { queryJsonRaw } from "./jsonpath.js";
import { cnToNumber } from "./toc-order.js";
import type { BookSource } from "./types.js";

export interface CookieApi {
  getCookie(url: string): string;
  setCookie(url: string, cookie: string): void;
  removeCookie(url: string): void;
}

export interface JsContext {
  result?: unknown;
  /** 解析后的 JSON 响应；`java.getString('$.foo')` 在 JSON 书源里要靠它。 */
  json?: unknown;
  baseUrl?: string;
  book?: unknown;
  chapter?: unknown;
  source?: BookSource;
  cookie?: string;
  vars?: Record<string, string>;
  globals?: Record<string, unknown>;
  /** 当前解析的 HTML（java.getString 未显式传 html 时用它）。 */
  html?: string;
  /** 当前规则的文本结果。 */
  text?: string;
  /** 当前页面 URL。 */
  url?: string;
  /** Legado 的 `src`：当前正在解析的整页内容（不是 URL）。书源里 src.match(...) 很常见。 */
  src?: string;
  /** Legado 的 `title`：当前章节标题。 */
  title?: string;
  cookieApi?: CookieApi;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * java.ajax 是同步桥（execFileSync + curl），会把整个事件循环按住。有的书源在
 * ruleSearch 的 coverUrl/intro/lastChapter 里对每条结果各发一次 ajax：20 条结果
 * × 3 个字段 = 60 次同步请求，实测把服务端卡死 42 秒，搜索/换源全部停摆。
 * 所以给它一个时间预算：每 60 秒最多累计 8 秒同步请求，超了就立刻返回空串，
 * 让这些「锦上添花」的字段退化成空值，而不是拖垮整个进程。
 */
const AJAX_WINDOW_MS = 60_000;
const AJAX_BUDGET_MS = 4_000;
const AJAX_MAX_CALLS = 16;
const ajaxState = { windowStart: 0, usedMs: 0, calls: 0 };

const HTTP_CACHE = new Map<string, { at: number; body: string }>();
const HTTP_CACHE_TTL = 5 * 60 * 1000;
const HTTP_CACHE_MAX = 64;

function httpSync(method: string, url: string, body?: string, headers?: Record<string, string>): string {
  const cacheKey = method + " " + url + " " + (body ?? "");
  const cached = HTTP_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < HTTP_CACHE_TTL) return cached.body;

  const now = Date.now();
  if (now - ajaxState.windowStart > AJAX_WINDOW_MS) {
    ajaxState.windowStart = now;
    ajaxState.usedMs = 0;
    ajaxState.calls = 0;
  }
  if (ajaxState.usedMs > AJAX_BUDGET_MS || ajaxState.calls > AJAX_MAX_CALLS) return "";
  ajaxState.calls += 1;

  const args = ["-sS", "-L", "--max-time", "8", "-A", DEFAULT_UA, "-X", method];
  for (const [key, value] of Object.entries(headers ?? {})) args.push("-H", `${key}: ${value}`);
  if (body) args.push("--data-binary", body);
  args.push(url);
  const started = Date.now();
  try {
    const text = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 9_000 });
    ajaxState.usedMs += Date.now() - started;
    if (HTTP_CACHE.size >= HTTP_CACHE_MAX) HTTP_CACHE.delete(HTTP_CACHE.keys().next().value as string);
    HTTP_CACHE.set(cacheKey, { at: Date.now(), body: text });
    return text;
  } catch (err) {
    ajaxState.usedMs += Date.now() - started;
    throw new EngineError("NET_ERROR", `java.ajax failed: ${url}: ${(err as Error).message}`);
  }
}

function makeWrapOne($: ReturnType<typeof load>) {
  const wrapOne = (node: unknown): unknown => {
    if (!node) return null;
    const $node = $(node as never);
    const self: Record<string, unknown> = {
      text: () => $node.text().trim(),
      ownText: () => $node.clone().children().remove().end().text().trim(),
      html: () => $node.html() ?? "",
      outerHtml: () => $.html(node as never),
      data: (name?: string) => {
        if (name) return $node.data(name) ?? "";
        const tag = String($node.prop("tagName") ?? "").toLowerCase();
        // jsoup 的 Element.data() 对 <script>/<style> 返回标签内的原始文本；
        // 207 少年小说网用 style 里的隐藏章节选择器做反爬，必须拿到这段 CSS。
        return tag === "script" || tag === "style" ? $node.html() ?? "" : $node.data() ?? "";
      },
      attr: (name: string) => $node.attr(name) ?? "",
      hasAttr: (name: string) => $node.attr(name) !== undefined,
      attributes: () =>
        Object.entries(($node.attr() ?? {}) as Record<string, string>).map(([name, value]) => ({
          name,
          key: name,
          value,
          getKey: () => name,
          getValue: () => value,
          toString: () => `${name}="${value}"`,
        })),
      hasClass: (cls: string) => $node.hasClass(cls),
      select: (childRule: string) => elementWrapper($.html(node as never), childRule),
      getElements: (childRule: string) => elementWrapper($.html(node as never), childRule),
      getElementsByTag: (tag: string) => elementWrapper($.html(node as never), tag),
      getElementsByClass: (cls: string) => elementWrapper($.html(node as never), "." + cls),
      getElementById: (id: string) => elementWrapper($.html(node as never), "#" + id)[0] ?? null,
      children: () => $node.children().toArray().map(wrapOne),
      parent: () => wrapOne($node.parent()[0]),
      nextElementSibling: () => wrapOne($node.next()[0]),
      previousElementSibling: () => wrapOne($node.prev()[0]),
      toString: () => $.html(node as never),
    };
    // 标记成元素 shim：规则引擎要把 JS 结果转回字符串时，取外 HTML 而不是 JSON。
    Object.defineProperty(self, "__legadoElement", {
      value: $.html(node as never),
      enumerable: false,
      configurable: true,
    });
    return self;
  };
  return wrapOne;
}

export function elementWrapper(html: string, rule: string) {
  const $ = load(html);
  let nodes: unknown[] = [];
  if (rule) {
    try {
      nodes = $(translateJsoupPseudos(rule)).toArray();
    } catch {
      // jsoup 的正则属性选择器（[href~=[^a-z]page[^a-z]]）css-select 解析不了。
      // 书源多用它清理导航，选不到比让整条详情规则失败更安全。
      nodes = [];
    }
  } else {
    nodes = $.root().children().toArray();
  }
  const wrapOne = makeWrapOne($);
  return decorateList(nodes.map(wrapOne), html);
}

/**
 * 在整页文档里找回「当前条目」的那个元素：书源的 `@js:result.nextElementSibling()`
 * 依赖条目在页面里的真实位置，而条目上下文只带了自己那一段 HTML。
 */
export function elementInDocument(fragment: string, docHtml: string): unknown | undefined {
  const tag = /^\s*<([a-zA-Z][\w-]*)/.exec(fragment)?.[1];
  if (!tag) return undefined;
  const target = fragment.trim();
  const $ = load(docHtml);
  const wrapOne = makeWrapOne($);
  let found: unknown;
  $(tag).each((_, el) => {
    if (found) return;
    if ($.html(el) === target) found = el;
  });
  return found ? wrapOne(found) : undefined;
}

/** 给元素数组补上 jsoup Elements 的方法（书源的目录 JS 常写 result.select("a") / result.size()）。 */
/** 580 禁忌书屋的目录 JS 用 `doc.createElement('a')` 拼章节条目。
 *  cheerio 文档是只读的，这里给一个最小可变的 a 元素：attr/text 支持
 *  读写，__legadoElement 在读取时生成 HTML，后续 chapterName/chapterUrl
 *  仍按 text/href 访问器取值。 */
function createElementShim(tag: string) {
  const attrs: Record<string, string> = {};
  let content = "";
  const el: Record<string, unknown> = {
    attr: (name: string, value?: unknown) => {
      if (value === undefined) return attrs[name] ?? "";
      attrs[name] = String(value);
      return el;
    },
    text: (value?: unknown) => {
      if (value === undefined) return content;
      content = String(value);
      return el;
    },
    html: (value?: unknown) => {
      if (value === undefined) return content;
      content = String(value);
      return el;
    },
    toString: () => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join("")}>${content}</${tag}>`,
  };
  Object.defineProperty(el, "__legadoElement", {
    get: () => String(el.toString()),
    enumerable: false,
  });
  return el;
}

function decorateList(items: unknown[], doc: string): unknown[] {
  const list = items as unknown[] & Record<string, unknown>;
  list.select = (childRule: string) => elementWrapper(doc, childRule);
  list.size = () => list.length;
  list.text = () => list.map((item) => String((item as { text: () => string }).text())).join(" ");
  list.html = () => list.map((item) => String((item as { html: () => string }).html())).join("");
  list.attr = (name: string) => (list[0] ? String((list[0] as { attr: (n: string) => string }).attr(name)) : "");
  list.hasClass = (cls: string) => list.some((item) => typeof (item as { hasClass?: (c: string) => boolean }).hasClass === "function" && (item as { hasClass: (c: string) => boolean }).hasClass(cls));
  list.first = () => (list[0] as { __legadoElement?: string } | undefined)?.__legadoElement ? elementListFromHtml([String((list[0] as { __legadoElement?: string }).__legadoElement)])[0] : (list[0] ?? null);
  list.last = () => (list.length ? list[list.length - 1] : null);
  list.get = (index: number) => list[index] ?? null;
  // jsoup Elements.toArray()：书源 193/192 用 result.select("a").toArray().map(...)。
  // 返回普通数组，避免把 select 等扩展方法带进 Array.prototype 风格的调用。
  list.toArray = () => Array.from(list);
  list.eq = (index: number) => (list[index] === undefined ? decorateList([], doc) : decorateList([list[index]], doc));
  list.is = (childRule: string) => list.some((item) => String((item as { toString: () => string }).toString()).includes(childRule));
  list.each = () => list;
  list.remove = () => list;
  list.empty = () => list.length === 0;
  list.isEmpty = () => list.length === 0;
  list.toString = () => list.map((item) => String((item as { toString: () => string }).toString())).join("");
  list.createElement = (tag: string) => createElementShim(tag);
  Object.defineProperty(list, "__legadoList", { value: true, enumerable: false });
  return list;
}

/** 把一批元素 HTML 包成 Elements 语义的数组（目录规则「选择器@访问器 + JS」用）。 */
export function elementListFromHtml(htmlList: string[]): unknown[] {
  // cheerio 会把片段包进 <html><body>，直接取 root 的 children 得到的是整篇文档。
  // 套一层容器再取直接子元素，才是书源期望的那个 <a>/<li>。
  const items = htmlList
    .map((html) => elementWrapper(`<div id="__legado_root">${html}</div>`, "#__legado_root > *")[0])
    .filter(Boolean);
  return decorateList(items, htmlList.join(""));
}

/**
 * Legado 的 book 是 Book 对象，书源会用 `book.getVariable("custom")` 读写书籍级变量
 * （335 的目录 JS 用它在「已读/未读」两种目录结构里切换）。我们的 book 只是普通对象，
 * 缺这两个方法就整条目录规则失败。
 */
function wrapBook(book: unknown, vars: Record<string, string>): unknown {
  const base = (book && typeof book === "object" ? book : {}) as Record<string, unknown>;
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "getVariable") return (key: string) => vars[key] ?? "";
      if (prop === "putVariable")
        return (key: string, value: unknown) => {
          vars[key] = String(value ?? "");
        };
      if (prop === "getVariables") return () => ({ ...vars });
      // 409 言情小说吧的详情 init 会按「逆序」开关调用 setReverseToc。
      if (prop === "setReverseToc") return (value: unknown) => { target.reverseToc = Boolean(value); };
      if (prop === "isReverseToc" || prop === "getReverseToc") return () => Boolean(target.reverseToc);
      return typeof prop === "string" ? target[prop] : undefined;
    },
  });
}

function wrapChapter(chapter: unknown, vars: Record<string, string>): unknown {
  const base = (chapter && typeof chapter === "object" ? chapter : {}) as Record<string, unknown>;
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "putVariable" || prop === "setVariable")
        return (key: string, value: unknown) => {
          vars[key] = String(value ?? "");
        };
      if (prop === "getVariable") return (key: string) => vars[key] ?? "";
      if (prop === "getVariables") return () => ({ ...vars });
      return typeof prop === "string" ? target[prop] : undefined;
    },
  });
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Legado 的 `java.getString('selector##正则##替换')`：选择器只取 ## 前一段，
 *  后面的正则是「对结果做替换」。以前整串交给 CSS/XPath，41 VIP中文的
 *  `[property$=description]@content##简介[：:]` 直接抛 "Expected name"。
 *  末尾再带一个 # 表示全局替换（Legado 的 ### 写法）。 */
function splitInlineReplacement(rule: string): { base: string; apply: (text: string) => string } {
  const idx = rule.indexOf("##");
  if (idx < 0) return { base: rule, apply: (text) => text };
  const base = rule.slice(0, idx).trim();
  const rest = rule.slice(idx + 2);
  const parts = rest.split("##");
  const pattern = parts[0] ?? "";
  const replacement = parts[1] ?? "";
  const global = (parts[2] ?? "").includes("#") || rest.endsWith("###");
  return {
    base,
    apply: (text) => {
      if (!pattern) return text;
      try {
        return text.replace(new RegExp(pattern, global ? "g" : ""), replacement);
      } catch {
        return text;
      }
    },
  };
}

/** Legado 的 java.getStringList 返回 Java List，书源里会调 .size()/.get(i)。
 *  普通数组没有这些方法，409 言情小说吧的 coverUrl 因此报 "s.size is not a function"。 */
function asJavaList(values: string[]): string[] {
  const list = values as string[] & { size(): number; get(index: number): string; isEmpty(): boolean; toArray(): string[] };
  Object.defineProperties(list, {
    size: { value: () => list.length, enumerable: false },
    get: { value: (index: number) => list[index] ?? "", enumerable: false },
    isEmpty: { value: () => list.length === 0, enumerable: false },
    toArray: { value: () => list.slice(), enumerable: false },
  });
  return list;
}

function createJava(ctx: JsContext) {
  const vars = ctx.vars ?? {};
  const isXpathRule = (rule: string) => /^@?xpath:/i.test(rule.trim());
  // java.getString 同时接受 CSS 和 Legado 的 jsoup 取值语法（`.item@data-rid`、
  // `.item a@href`）。queryHtml 只认纯 CSS，遇到 @ 会返回空，41/409 因此取不到值。
  const queryByRule = (target: string, rule: string) =>
    rule.includes("@") ? evalJsoupRule(rule, target) : queryHtml(target, rule);
  const xpathExpr = (rule: string) => rule.trim().replace(/^@?xpath:/i, "");
  /** XPath 命中元素后包成 jsoup 元素：书源会继续 .select("a") / .attr("href")。 */
  const getElementList = (rule: string, target: string) =>
    isXpathRule(rule)
      ? queryXpathElements(xpathExpr(rule), target).flatMap((fragment) => elementWrapper(fragment, ""))
      : elementWrapper(target, rule);
  // 显式给了 html 参数时仍然按 CSS 解析（书源里 `java.getString('.name', html)` 很常见）。
  const jsonValues = (rule: string, html?: string): unknown[] | null => {
    if (html !== undefined) return null;
    if (ctx.json === undefined || ctx.json === null) return null;
    const trimmed = rule.trim();
    if (!trimmed.startsWith("$")) return null;
    return queryJsonRaw(trimmed, ctx.json);
  };
  const base: Record<string, unknown> = {
    ajax: (url: string, headers?: Record<string, string> | string) => {
      const h = typeof headers === "string" ? parseHeaderString(headers) : headers;
      return httpSync("GET", url, undefined, h);
    },
    get: (key: string, headers?: Record<string, string> | string) => {
      if (headers !== undefined) {
        const h = typeof headers === "string" ? parseHeaderString(headers) : headers;
        return httpSync("GET", key, undefined, h);
      }
      if (/^https?:\/\//i.test(key)) return httpSync("GET", key);
      return vars[key] ?? "";
    },
    post: (url: string, body?: string, headers?: Record<string, string>) => httpSync("POST", url, body ?? "", headers),
    head: (url: string) => httpSync("HEAD", url),
    connect: (url: string) => {
      let method = "GET";
      let body: string | undefined;
      const headers: Record<string, string> = {};
      const api = {
        method: (m: string) => {
          method = m;
          return api;
        },
        header: (key: string, value: string) => {
          headers[key] = value;
          return api;
        },
        headers: (obj: Record<string, string>) => {
          Object.assign(headers, obj);
          return api;
        },
        body: (value: string) => {
          body = value;
          return api;
        },
        timeout: () => api,
        proxy: () => api,
        followRedirects: () => api,
        get: () => api,
        post: () => {
          method = "POST";
          return api;
        },
        execute: () => httpSync(method, url, body, headers),
        raw: () => {
          // 只在真正取 body 时才发请求：书源大量用
          // `{{java.connect(source.getKey()).raw().request().url()}}modules/...` 拼搜索地址，
          // 以前这里会先发一次无用的 HTTP 请求（站点挂了整条规则直接失败）。
          const request = () => ({
            // OkHttp 的 HttpUrl 字符串形式带结尾斜杠，书源靠这个拼 "…xyz" + "modules/…"。
            url: () => (new URL(url).pathname === "/" ? new URL(url).origin + "/" : url),
            method: () => method,
            headers: () => headers,
          });
          return {
            body: () => httpSync(method, url, body, headers),
            string: () => httpSync(method, url, body, headers),
            bytes: () => Buffer.from(httpSync(method, url, body, headers), "utf8"),
            code: () => 200,
            header: () => "",
            headers: () => ({}),
            request,
            close: () => undefined,
          };
        },
        string: () => httpSync(method, url, body, headers),
        bytes: () => Buffer.from(httpSync(method, url, body, headers), "utf8"),
        code: () => 200,
        contentType: () => "",
      };
      return api;
    },
    // Legado 的 `java.getString` 同时接受 CSS 与 JSONPath。JSON 书源（QB / QQ 阅读系）
    // 的 ruleExplore 大量写成 `{{java.getString('$.userscore')}}`，过去一律当 CSS 解析，
    // css-select 抛 `Empty sub-selector`，整条发现规则被判失败。
    getString: (rule: string, html?: string) => {
      const { base, apply } = splitInlineReplacement(rule);
      const jsonHit = jsonValues(base, html);
      if (jsonHit) return jsonHit.map(stringifyValue).filter(Boolean).map(apply).join("\n");
      const target = html ?? String(ctx.result || ctx.html || "");
      if (isXpathRule(base)) return queryXpath(xpathExpr(base), target).map(apply).join("\n");
      return queryByRule(target, base).map(apply).join("\n");
    },
    getStringList: (rule: string, html?: string) => {
      const { base, apply } = splitInlineReplacement(rule);
      const jsonHit = jsonValues(base, html);
      if (jsonHit) return asJavaList(jsonHit.map(stringifyValue).filter(Boolean).map(apply));
      const target = html ?? String(ctx.result || ctx.html || "");
      if (isXpathRule(base)) return asJavaList(queryXpath(xpathExpr(base), target).map(apply));
      return asJavaList(queryByRule(target, base).map(apply));
    },
    getElement: (rule: string, html?: string) => getElementList(rule, html ?? String(ctx.result ?? ""))[0] ?? null,
    getElements: (rule: string, html?: string) => getElementList(rule, html ?? String(ctx.result ?? "")),
    setContent: (html: string) => {
      ctx.result = html;
      return html;
    },
    log: (message: unknown) => {
      void message;
      return "";
    },
    toast: (message: unknown) => {
      void message;
    },
    longToast: (message: unknown) => {
      void message;
    },
    put: (key: string, value: unknown) => {
      vars[key] = String(value);
    },
    encodeURI: (value: string) => encodeURIComponent(value),
    base64Encode: (value: string) => Buffer.from(value, "utf8").toString("base64"),
    base64Decode: (value: string) => Buffer.from(value, "base64").toString("utf8"),
    md5Encode: (value: string) => crypto.createHash("md5").update(value).digest("hex"),
    md5Encode16: (value: string) => crypto.createHash("md5").update(value).digest("hex").slice(8, 24),
    hexEncodeToString: (value: string) => Buffer.from(value, "utf8").toString("hex"),
    // 179/191/255 等源在搜索 header 里调用 java.getWebViewUA() 伪装 WebView。
    // 服务端没有真实 WebView，但返回一个常见的移动端 UA 足够让静态接口放行。
    getWebViewUA: () =>
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    randomUUID: () => crypto.randomUUID(),
    timeFormat: (timestamp: number, fmt = "yyyy-MM-dd HH:mm:ss") => formatTime(timestamp, fmt),
    htmlFormat: (html: string) => html,
    // 书源用它清洗「第一百二十三章」这类中文数字章节名：`replace(/第([零一二…]+)章/g, java.toNumChapter(result))`。
    toNumChapter: (text: unknown) =>
      String(text ?? "").replace(/第([零〇一二两三四五六七八九十百千]+)章/g, (whole: string, cn: string) => {
        const num = cnToNumber(cn);
        return num === null ? whole : `第${num}章`;
      }),
    t2s: (value: string) => value,
    s2t: (value: string) => value,
    getVerificationCode: () => {
      throw new EngineError("UNSUPPORTED_API", "java.getVerificationCode is not supported");
    },
    // 服务端阅读引擎没有浏览器内核，也没有桌面环境可以拉起外部浏览器。
    // 以前这两个方法落到 Proxy 的通用 UNSUPPORTED_API，用户只看到
    // 「java.webView is not supported」，不知道是书源能力问题还是规则写错。
    webView: () => {
      throw new EngineError(
        "UNSUPPORTED_WEBVIEW",
        "java.webView 需要浏览器内核执行页面 JavaScript，当前服务端阅读引擎不支持；请换用无需 WebView 的书源，或改用静态接口。",
      );
    },
    startBrowser: () => {
      throw new EngineError(
        "UNSUPPORTED_WEBVIEW",
        "java.startBrowser 需要调用外部浏览器/播放器，当前服务端阅读引擎不支持；请换用其他书源。",
      );
    },
    strToBytes: (value: unknown) => Buffer.from(String(value ?? ""), "utf8"),
    base64DecodeToByteArray: (value: unknown) => Buffer.from(String(value ?? ""), "base64"),
    // 192/193 完本小说的正文用 AES/CBC/PKCS7 解密：
    // fullKey=md5(keySeed)，前 16 字节做 IV、后 16 字节做 key。
    // Legado 的 java.createSymmetricCrypto 还支持 DES 等，这里先覆盖书源实际用到的 AES-CBC/ECB。
    // 129/273/455/574 的正文用 `java.aesBase64DecodeToString(a, e, "AES/CBC/PKCS5Padding", d)`：
    // 与 createSymmetricCrypto(...).decryptStr(a) 等价，但书源直接调这个 Java 静态方法。
    aesBase64DecodeToString: (input: unknown, key: unknown, transformation = "AES/CBC/PKCS5Padding", iv?: unknown) => {
      const name = String(transformation ?? "").toUpperCase();
      const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key ?? ""), "utf8");
      const ivBytes = Buffer.isBuffer(iv) ? iv : Buffer.from(String(iv ?? ""), "utf8");
      if (!/AES/.test(name) || !/CBC|ECB/.test(name)) {
        throw new EngineError("UNSUPPORTED_API", `java.aesBase64DecodeToString(${transformation}) is not supported`);
      }
      const algorithm = keyBytes.length === 32 ? "aes-256-cbc" : keyBytes.length === 24 ? "aes-192-cbc" : "aes-128-cbc";
      const data = Buffer.from(String(input ?? ""), "base64");
      const decipher = /ECB/.test(name)
        ? crypto.createDecipheriv(algorithm.replace("-cbc", "-ecb"), keyBytes, null)
        : crypto.createDecipheriv(algorithm, keyBytes, ivBytes);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
    createSymmetricCrypto: (transformation: string, key: unknown, iv?: unknown) => {
      const name = String(transformation ?? "").toUpperCase();
      const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key ?? ""), "utf8");
      const ivBytes = Buffer.isBuffer(iv) ? iv : Buffer.from(String(iv ?? ""), "utf8");
      const aes = /AES/.test(name);
      const ecb = /ECB/.test(name);
      if (!aes || (!/CBC|ECB/.test(name))) {
        throw new EngineError("UNSUPPORTED_API", `java.createSymmetricCrypto(${transformation}) is not supported`);
      }
      const algorithm = keyBytes.length === 32 ? "aes-256-cbc" : keyBytes.length === 24 ? "aes-192-cbc" : "aes-128-cbc";
      const decrypt = (input: unknown): string => {
        const data = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "base64");
        const decipher = ecb
          ? crypto.createDecipheriv(algorithm.replace("-cbc", "-ecb"), keyBytes, null)
          : crypto.createDecipheriv(algorithm, keyBytes, ivBytes);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
      };
      return {
        decryptStr: decrypt,
        decrypt,
        encryptStr: (input: unknown) => {
          const cipher = ecb
            ? crypto.createCipheriv(algorithm.replace("-cbc", "-ecb"), keyBytes, null)
            : crypto.createCipheriv(algorithm, keyBytes, ivBytes);
          return Buffer.concat([cipher.update(Buffer.from(String(input ?? ""), "utf8")), cipher.final()]).toString("base64");
        },
      };
    },
    reGetBook: () => {
      throw new EngineError("UNSUPPORTED_API", "java.reGetBook is not supported");
    },
    refreshTocUrl: () => {
      throw new EngineError("UNSUPPORTED_API", "java.refreshTocUrl is not supported");
    },
  };

  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "toString") return () => "[object Java]";
      return () => {
        throw new EngineError("UNSUPPORTED_API", `java.${prop} is not supported`);
      };
    },
  });
}

function parseHeaderString(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of header.split(/[\n,]/)) {
    const idx = line.indexOf(":");
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function formatTime(timestamp: number, fmt: string): string {
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return fmt
    .replace(/yyyy/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/dd/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

function wrapSource(source: BookSource | undefined, vars: Record<string, string>): unknown {
  if (!source) return {};
  return new Proxy(source as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop !== "string") return (target as Record<symbol, unknown>)[prop];
      if (prop in target) return target[prop];
      switch (prop) {
        case "getKey":
          return () => target.bookSourceUrl;
        case "getName":
          return () => target.bookSourceName;
        case "getGroup":
          return () => target.bookSourceGroup ?? "";
        case "getType":
          return () => target.bookSourceType ?? 0;
        case "getTag":
          return () => target.bookSourceGroup ?? "";
        case "key":
          return target.bookSourceUrl;
        // Legado 的 source.getVariable() 无参返回书源级变量的 JSON 串，
        // 61 听小说APP 用它保存设备 ID；缺了会让整条目录规则失败。
        case "getVariable":
          return (key?: string) => (key === undefined ? JSON.stringify(vars) : vars[key] ?? "");
        case "putVariable":
          return (key: string, value: unknown) => {
            vars[key] = String(value ?? "");
          };
        // Legado 还有 source.setVariable(json) 的单参形式：整包写回书源变量。
        // 61 听小说APP 用它缓存设备 ID 和 shuId/dirHcCode，缺了目录规则仍会失败。
        case "setVariable":
          return (key: string, value?: unknown) => {
            if (value === undefined) {
              try {
                const parsed = JSON.parse(key) as Record<string, unknown>;
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  for (const [k, v] of Object.entries(parsed)) vars[k] = String(v ?? "");
                }
              } catch {
                // Legado 对非法 JSON 也是静默忽略，不阻断规则。
              }
              return;
            }
            vars[key] = String(value ?? "");
          };
        case "getVariables":
          return () => ({ ...vars });
        case "toString":
          return () => "[object BookSource]";
        default:
          return undefined;
      }
    },
  });
}

// Legado 的 `cache` 是带 putMemory/getFromMemory 的对象，不是 Map：
// 书源里的 `<js>cache.putMemory(key, v)</js>` 在 Map 上会抛 "not a function"，
// 整条详情/目录规则连带失败。
const CACHE_STORE = new Map<string, unknown>();

function cacheShim(): Record<string, unknown> {
  const read = (key: unknown) => CACHE_STORE.get(String(key)) ?? "";
  return {
    put: (key: unknown, value: unknown) => {
      CACHE_STORE.set(String(key), value);
    },
    get: (key: unknown) => read(key),
    putMemory: (key: unknown, value: unknown) => {
      CACHE_STORE.set(String(key), value);
    },
    getFromMemory: (key: unknown) => read(key),
    // Legado 的 cache.getFile 在未命中时返回 null（不是空串），430/431 酷我小说
    // 靠 sort 是否为 null 判断是否首次构建发现页分类。
    getFile: (key: unknown) => (CACHE_STORE.has(String(key)) ? CACHE_STORE.get(String(key)) : null),
    putFile: (key: unknown, value: unknown) => {
      CACHE_STORE.set(String(key), value);
    },
    getFromFile: (key: unknown) => (CACHE_STORE.has(String(key)) ? CACHE_STORE.get(String(key)) : null),
    delete: (key: unknown) => {
      CACHE_STORE.delete(String(key));
    },
  };
}

const EMPTY_COOKIE_API: CookieApi = {
  getCookie: () => "",
  setCookie: () => undefined,
  removeCookie: () => undefined,
};

function jsLibSource(lib: string | undefined): string {
  if (!lib || !lib.trim()) return "";
  const text = lib.trim();
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      // Legado 的 jsLib 有两种写法：直接写函数体，或 {"crypto":"https://cdn..."} 这种外链清单。
      // 后者不是可执行 JS，直接拼进 new Function 会被解析成带标签的块，报 Unexpected token ':'。
      return Object.values(obj)
        .filter((value): value is string => typeof value === "string" && !/^https?:\/\//i.test(value))
        .join("\n");
    } catch {
      /* 不是 JSON 就按普通 JS 处理 */
    }
  }
  return text;
}

export function runJsSync(code: string, ctx: JsContext = {}): unknown {
  // `result` is both an input and the usual output of a Legado JS rule, but a bare
  // expression (`{{String(baseUrl).match(/\d+/)[0]}}`) never assigns it: Rhino returns
  // the value of the last expression. Track assignment so both styles work.
  let resultValue: unknown = ctx.result ?? "";
  let resultAssigned = false;
  const sandbox: Record<string, unknown> = {
    ...(ctx.globals ?? {}),
    java: createJava(ctx),
    baseUrl: ctx.baseUrl ?? "",
    src: ctx.src ?? "",
    title: ctx.title ?? "",
    book: wrapBook(ctx.book, ctx.vars ?? {}),
    chapter: wrapChapter(ctx.chapter, ctx.vars ?? {}),
    source: wrapSource(ctx.source, ctx.vars ?? {}),
    cookie: ctx.cookieApi ?? EMPTY_COOKIE_API,
    cache: cacheShim(),
    // 少数书源（471/730 得奇小说）在 JS 里调用 cover()/words() 这类自定义助手，
    // Legado 里它们是书源自带的全局函数；缺了就 ReferenceError，整条规则报废。
    cover: (value: unknown) => String(value ?? ""),
    getCover: (value: unknown) => String(value ?? ""),
    words: (value: unknown) => String(value ?? ""),
    // 523 漫蛙吧详情用 toTime(updateTime) 拼 kind；Legado 的脚本环境里它是全局函数。
    toTime: (value: unknown) => {
      const time = Date.parse(String(value ?? ""));
      return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
    },
    // 67 个书源用 org.jsoup.Jsoup.parse(...) 做二次解析。这里给一个基于 cheerio
    // 的最小 jsoup 门面，覆盖 parse/select/text/html/attr/first/size/get 等常用方法；
    // 复杂的 :matchesOwn / remove 语义仍不完整，但不会再直接 ReferenceError。
    org: {
      jsoup: {
        Jsoup: {
          parse: (html: unknown) => elementWrapper(String(html ?? ""), ""),
        },
      },
    },
    console: { log: () => undefined, error: () => undefined, warn: () => undefined },
  };
  Object.defineProperty(sandbox, "result", {
    get: () => resultValue,
    set: (value: unknown) => {
      resultValue = value;
      resultAssigned = true;
    },
    enumerable: true,
    configurable: true,
  });
  const context = vm.createContext(sandbox);
  // Legado 的 jsLib 是书源级全局脚本（常量、nativeSign 等），每个 JS 规则执行前
  // 都要先在同一沙箱里加载；61 听小说APP 的目录规则就依赖 APP_NAME/SIGN_MAP。
  // 这里按每次调用拼接，避免跨书源共享全局状态。
  const jsLib = jsLibSource((ctx.source as (BookSource & { jsLib?: string }) | undefined)?.jsLib);
  // 373 紫云宫的正文解密脚本对非全局正则调用 replaceAll；现代 V8 会抛
  // "replaceAll called with a non-global RegExp"，而 Legado 的 Rhino 不限制。
  // 在沙箱内把非全局正则补成全局，保持源脚本原意。
  const compat = `if (!String.prototype.replaceAll.__legadoPatched) {
    var __origReplaceAll = String.prototype.replaceAll;
    var __patchedReplaceAll = function (search, replace) {
      if (search instanceof RegExp && !search.global) {
        search = new RegExp(search.source, search.flags + "g");
      }
      return __origReplaceAll.call(this, search, replace);
    };
    __patchedReplaceAll.__legadoPatched = true;
    String.prototype.replaceAll = __patchedReplaceAll;
  }`;
  const sourceCode = [compat, jsLib, code].filter(Boolean).join("\n;");
  let completion: unknown;
  try {
    completion = vm.runInContext(sourceCode, context, { timeout: 5000, displayErrors: true });
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new EngineError("JS_ERROR", `js rule failed: ${(err as Error).message}`);
  }
  // Rhino/Legado 返回最后一条表达式的值；result 只是「也可以把结果赋给它」的兼容写法。
  // 409 的目录 JS 中途多次给 result 赋值（探测链接），最后返回的是 src 列表；
  // 以前只要 result 被赋值就优先返回它，导致整条目录永远是 0 章。
  if (completion !== undefined) return completion;
  return resultAssigned ? resultValue : "";
}

export function stripJsWrapper(code: string): string {
  const match = /^\s*<js>([\s\S]*?)<\/js>\s*$/.exec(code);
  if (match) return match[1];
  // splitLines 把行首的 `@js:` 规范成 `<js>` 后，只有代码末尾没有 `</js>`；
  // 以前这里原样返回 `<js>\nvar ...`，JS 解析器报 "Unexpected token '<'"。
  // 252/253/805/806 的 nextContentUrl 都是这种多行 `@js:` 规则。
  const trimmed = code.trim();
  if (trimmed.startsWith("<js>")) {
    const end = trimmed.lastIndexOf("</js>");
    return (end > 4 ? trimmed.slice(4, end) : trimmed.slice(4)).trim();
  }
  return code;
}