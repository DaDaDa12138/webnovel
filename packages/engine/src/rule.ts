import { splitLines, splitTop } from "./split.js";
import { elementAccessor, evalJsoupRule, ownTextOf, queryHtml, queryHtmlElements, textOf } from "./html.js";
import { parseJsoupSelector } from "./jsoup.js";
import { queryJson, queryJsonRaw, parseJson } from "./jsonpath.js";
import { queryXpath, queryXpathElements } from "./xpath.js";
import { renderTemplate, type JsEvaluator, type TemplateContext } from "./template.js";
import { elementInDocument, elementListFromHtml, elementWrapper, runJsSync, stripJsWrapper } from "./js.js";
import type { RuleContext } from "./types.js";

export interface EvalOptions {
  js?: JsEvaluator;
}

/** 未闭合的 { / [ 数量，用来把多行 @put JSON 重新拼成一条规则。 */
function braceDelta(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") depth -= 1;
  }
  return depth;
}

function toTemplateContext(ctx: RuleContext): TemplateContext {
  return {
    html: ctx.html,
    docHtml: ctx.docHtml ?? ctx.html,
    json: ctx.json,
    text: ctx.text,
    url: ctx.url,
    baseUrl: ctx.baseUrl,
    vars: ctx.vars,
    book: ctx.book,
    chapter: ctx.chapter,
    source: ctx.source,
  };
}

/** 找出 `{{...}}` 之外第一次出现 needle 的位置；模板里的 `##` 属于表达式，不是正则分隔符。 */
function indexOutsideBraces(text: string, needle: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith("{{", i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (text.startsWith("}}", i)) {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth === 0 && text.startsWith(needle, i)) return i;
  }
  return -1;
}

function parsePutPayload(payload: string): Record<string, unknown> | null {
  const text = payload.trim();
  try {
    const obj = JSON.parse(text) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
  } catch {
    /* 书源常用 `{xid:x_id}` 简写，不是 JSON */
  }
  const inner = text.replace(/^\{/, "").replace(/\}\s*$/, "").trim();
  if (!inner) return {};
  const out: Record<string, string> = {};
  for (const part of inner.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    const value = part.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function applyRegex(text: string, pattern: string, replacement: string, global: boolean): string {
  try {
    // Legado 的替换串用 `$0` 表示整个匹配（JS 原生是 `$&`）；726 黑岩的
    // chapterUrl 就靠 `##\d+$##.../$0##` 拼接口地址。
    const jsReplacement = replacement.replace(/\$0/g, () => "$&");
    return text.replace(new RegExp(pattern, global ? "g" : ""), jsReplacement);
  } catch {
    return text;
  }
}

/** Legado 的 @regex 选择器：匹配、全局匹配、替换、分割、测试。 */
type RegexSelectorSpec = {
  type: "match" | "replace" | "split" | "test";
  pattern: string;
  flags: string;
  replacement: string;
};

const REGEX_SELECTOR_MAX_PATTERN = 1000;
const REGEX_SELECTOR_MAX_INPUT = 1024 * 1024;

function parseRegexSelector(raw: string): RegexSelectorSpec | null {
  const source = raw.trim();
  if (!source || source.length > REGEX_SELECTOR_MAX_PATTERN) return null;
  // 书源里也有把分隔符写成 :replace: / :split / :test 的旧写法。
  const replaceAt = source.indexOf(":replace:");
  if (replaceAt >= 0) {
    const left = source.slice(0, replaceAt);
    const replacement = source.slice(replaceAt + ":replace:".length);
    const global = left.startsWith("g:");
    return { type: "replace", pattern: global ? left.slice(2) : left, flags: global ? "g" : "", replacement };
  }
  const splitAt = source.indexOf(":split");
  if (splitAt >= 0) return { type: "split", pattern: source.slice(0, splitAt), flags: "", replacement: "" };
  const testAt = source.indexOf(":test");
  if (testAt >= 0) return { type: "test", pattern: source.slice(0, testAt), flags: "", replacement: "" };
  const global = source.startsWith("g:");
  return { type: "match", pattern: global ? source.slice(2) : source, flags: global ? "g" : "", replacement: "" };
}

function regexPatternAndFlags(spec: RegexSelectorSpec): { pattern: string; flags: string } {
  // /pattern/flags 是 Legado 的显式写法；g: 前缀和 flags 里的 g 都要合并。
  const wrapped = spec.pattern.match(/^\/(.+)\/([gimsy]*)$/);
  let pattern = spec.pattern;
  let flags = spec.flags;
  if (wrapped) {
    pattern = wrapped[1] ?? "";
    flags = wrapped[2] ?? "";
    if (spec.flags.includes("g") && !flags.includes("g")) flags += "g";
  }
  if (spec.type === "match" && spec.flags.includes("g") && !flags.includes("g")) flags += "g";
  // Java 的 \p{Script=Han} 在 JS 里必须带 u 标志，否则会抛 "Invalid property name"。
  if (/\\(?:p|P)\{/.test(pattern) && !flags.includes("u")) flags += "u";
  return { pattern, flags: Array.from(new Set(flags)).join("") };
}

function extractRegexMatch(match: RegExpExecArray): string {
  // Legado 有捕获组时取第 1 组；没有捕获组时取整个匹配。
  return match.length > 1 && match[1] !== undefined ? match[1] : (match[0] ?? "");
}

function runRegexSelector(text: string, spec: RegexSelectorSpec): string[] {
  if (text.length > REGEX_SELECTOR_MAX_INPUT) return [];
  try {
    const { pattern, flags } = regexPatternAndFlags(spec);
    if (!pattern) return [];
    const regex = new RegExp(pattern, flags);
    if (spec.type === "test") return [String(regex.test(text))];
    if (spec.type === "split") {
      return text.split(regex).map((part) => part.trim()).filter(Boolean);
    }
    if (spec.type === "replace") return [text.replace(regex, spec.replacement)];
    if (flags.includes("g")) {
      const out: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        out.push(extractRegexMatch(match));
        // 零宽匹配必须手动前进，否则 exec 会永远停在同一个位置。
        if (match[0] === "") regex.lastIndex += 1;
      }
      return out;
    }
    const match = regex.exec(text);
    return match ? [extractRegexMatch(match)] : [];
  } catch {
    // 坏正则不能中断整章解析；书源体检会单独把它标出来。
    return [];
  }
}

/** 书源静态体检用：校验 @regex 的语法，返回错误文案或 null。 */
export function validateRegexSelector(raw: string): string | null {
  const spec = parseRegexSelector(raw);
  if (!spec) return "空正则或模式过长";
  try {
    const { pattern, flags } = regexPatternAndFlags(spec);
    if (!pattern) return "正则模式为空";
    new RegExp(pattern, flags);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function applyRegexSelector(inputs: string[], spec: RegexSelectorSpec): string[] {
  return inputs.flatMap((text) => runRegexSelector(text, spec));
}

async function evalRegex(line: string, ctx: RuleContext, opts: EvalOptions, prev?: string): Promise<string[]> {
  const idx = line.indexOf("##");
  const base = line.slice(0, idx).trim();
  const rest = line.slice(idx + 2);
  const parts = rest.split("##");
  const pattern = parts[0] ?? "";
  const replacement = parts[1] ?? "";
  const tail = parts[2] ?? "";
  const global = tail.includes("#") || rest.endsWith("###");
  const texts = base ? await evalSingle(base, ctx, opts, prev) : [prev ?? ctx.text];
  return texts.map((text) => applyRegex(text, pattern, replacement, global));
}

/**
 * `prev` 是多行规则里上一行的输出。Legado 的语义是「上一行的结果就是本行
 * `result`」，QB 系列书源的 `<js>1100000000+parseInt(result)</js>` 全靠它；
 * 以前这里传的是整页 HTML，于是 parseInt 得到 NaN，bookid=NaN 的候选必然换源失败。
 */
/** JS 规则可能返回对象/数组（详情页 init 常返回 data 对象），
 *  以前统一 String(value) 会得到 "[object Object]"，后续 {{result.xxx}} 全部取空。 */
function toRuleString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * 把 JS 返回值转成规则结果。元素 shim 取外 HTML（Legado 里 Elements/Element 的
 * toString 就是 HTML），数组逐项展开——目录 JS 常返回一批 `<a>` 元素。
 */
function toRuleStrings(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => toRuleStrings(item));
  if (typeof value === "object") {
    const html = (value as { __legadoElement?: string }).__legadoElement;
    if (typeof html === "string") return html ? [html] : [];
    return toRuleString(value) ? [toRuleString(value)] : [];
  }
  const text = String(value);
  return text ? [text] : [];
}

/**
 * 上一段是纯选择器时，Legado 会把匹配到的元素（jsoup Elements）交给下一段 JS 当
 * `result`：`result.length`、`result[i].attr("href")`、`result.select("a")` 全靠它。
 * 只传字符串的话这些源会抛 "result.select is not a function" 或把字符串当数组。
 */
async function selectorJsResult(rule: string | undefined, ctx: RuleContext, opts: EvalOptions = {}): Promise<unknown | undefined> {
  const trimmed = (rule ?? "").trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("{{") || trimmed.includes("##") || trimmed.includes("<js>")) return undefined;
  // `html@js:result.match(...)` 的 `html` 是取值访问器，不是 CSS 选择器；
  // 以前会选到 <html> 元素，JS 拿到 Element 后调用 .match 直接报
  // "result.match is not a function"（589/712 若初文学）。
  if (/^(text|ownText|html|content|href|src|title|alt|textNodes|value)$/.test(trimmed)) return undefined;
  if (!ctx.html) return undefined;
  try {
    if (trimmed.includes("@")) {
      // 末尾是取值访问器（`class.s2@tag.a@href`）时结果是字符串，JS 里要能直接 .match；
      // 只有产出元素的访问器链（`li.chapter@a`）才包成 Elements。
      const accessors = parseJsoupSelector(trimmed).accessors;
      const last = accessors[accessors.length - 1] ?? "";
      if (/^(text|ownText|html|content|href|src|title|alt|textNodes)$/.test(last)) return undefined;
      const items = await collectItems(trimmed, ctx, opts);
      const htmlList = items.filter((item) => item.kind === "html").map((item) => item.html);
      if (!htmlList.length) return undefined;
      return htmlList.length === 1 ? elementListFromHtml(htmlList)[0] : elementListFromHtml(htmlList);
    }
    let list = elementWrapper(ctx.html, trimmed);
    if (!list.length && ctx.docHtml && ctx.docHtml !== ctx.html) list = elementWrapper(ctx.docHtml, trimmed);
    if (!list.length) return undefined;
    if (list.length === 1) return list[0];
    // Legado 的 Elements.select 只在选中的条目内部查，不会回到整页。
    // 之前直接把整页 html 交给 decorateList，192/193 的 result.select("a")
    // 会连导航栏的 <a> 一起选中，第一条没有 data-*，JS 取 match(...)[1] 直接空指针。
    const fragments = list
      .map((item) => String((item as { __legadoElement?: string }).__legadoElement ?? ""))
      .filter(Boolean);
    return fragments.length ? elementListFromHtml(fragments) : list;
  } catch {
    return undefined;
  }
}

/**
 * 按条目求值时，条目自己的 html 里可能找不到字段（封面、最新章节常挂在列表行外层），
 * Legado 会回退到整页再查一次。JS 段前面的选择器同样要享受这个回退，否则
 * `class.s2@tag.a@href<js>result.match(…)</js>` 拿到空串直接抛 null.match。
 */
async function evalBaseValues(rule: string, ctx: RuleContext, opts: EvalOptions, prev?: string): Promise<string[]> {
  const values = await evalSingle(rule, ctx, opts, prev);
  if (values.length) return values;
  if (ctx.docHtml && ctx.docHtml !== ctx.html) return evalSingle(rule, { ...ctx, html: ctx.docHtml }, opts, prev);
  return values;
}

/**
 * 书源里裸写的 `@js:` 段（373/592 的 intro = "@js:result.nextElementSibling()"、19 的
 * bookUrl = "@js:result.attr('data-rid')…"）期望 result 是「当前元素」而不是整页 HTML：
 * 既是字符串（要能 .match/.replace），又带 attr()/select()/nextElementSibling()。
 * 用一个 String 包装对象同时满足两种用法。
 */
function elementBackedResult(ctx: RuleContext, text: string): unknown {
  if (!/^\s*</.test(ctx.html)) return text;
  // 条目上下文只有自己那段 HTML，nextElementSibling() 在孤立的片段里永远是空；
  // 有整页 HTML 时先回页面里定位同一个元素，兄弟节点才是对的。
  const located = ctx.docHtml && ctx.docHtml !== ctx.html ? elementInDocument(ctx.html, ctx.docHtml) : undefined;
  const el = (located ?? elementWrapper(ctx.html, "")[0]) as Record<string, unknown> | undefined;
  if (!el) return text;
  const boxed = new String(text) as unknown as Record<string, unknown>;
  for (const key of [
    "attr",
    "hasAttr",
    "attributes",
    "select",
    "getElements",
    "getElementsByTag",
    "getElementsByClass",
    "getElementById",
    "text",
    "ownText",
    "html",
    "children",
    "parent",
    "nextElementSibling",
    "previousElementSibling",
  ]) {
    if (typeof el[key] === "function") boxed[key] = el[key];
  }
  return boxed;
}

/**
 * Legado 允许在 JS 规则末尾追加 ##pattern##replacement，对 JS 返回值做后处理
 * （41 VIP中文的 chapterName 就是 `text\n@js:...replace(...)\n##(章)...##$1 $2$3`）。
 * 这段不是 JS 代码，不能直接交给 new Function；这里从末尾拆出正则和替换串。
 */
function splitJsReplacement(code: string): { code: string; pattern: string; replacement: string } | null {
  const second = code.lastIndexOf("##");
  if (second <= 0) return null;
  const first = code.lastIndexOf("##", second - 1);
  if (first <= 0) return null;
  const body = code.slice(0, first);
  const pattern = code.slice(first + 2, second);
  const replacement = code.slice(second + 2);
  if (!body.trim() || !pattern) return null;
  try {
    // 如果 ## 落在 JS 字符串/正则里，pattern 通常不是合法正则，按原代码处理。
    new RegExp(pattern);
  } catch {
    return null;
  }
  return { code: body, pattern, replacement };
}

async function runJsWithReplacement(code: string, ctx: RuleContext, opts: EvalOptions, result: unknown): Promise<string[]> {
  const spec = splitJsReplacement(code);
  const values = await runJsRule(spec?.code ?? code, ctx, opts, result);
  if (!spec) return values;
  return values.map((value) => applyRegex(value, spec.pattern, spec.replacement, true));
}

async function runJsRule(code: string, ctx: RuleContext, opts: EvalOptions, result: unknown): Promise<string[]> {
  // 602 QQ阅读的 chapterUrl 在 JS 字符串里写 `&cid={{$.seq}}`。Legado 会先
  // 渲染模板再执行 JS；以前 JS 分支在模板分支之前，字符串里原样留下 {{...}}，
  // 所有章节 URL 都变成 `cid=`。只渲染真正的 {{...}} 表达式，避免动到对象字面量。
  if (/\{\{[^{}]+\}\}/.test(code)) {
    code = await renderTemplate(code, toTemplateContext(ctx), opts.js, result);
  }
  const payload = {
    result,
    json: ctx.json,
    baseUrl: ctx.baseUrl,
    book: ctx.book,
    chapter: ctx.chapter,
    source: ctx.source,
    vars: ctx.vars,
  };
  const value = opts.js ? await opts.js.eval(code, { ...toTemplateContext(ctx), result }) : runJsSync(code, payload);
  return toRuleStrings(value);
}

async function evalSingle(line: string, ctx: RuleContext, opts: EvalOptions, prev?: string): Promise<string[]> {
  let rule = line.trim();
  if (!rule) return [];

  // 367/368 米读把 JSONPath 写成单花括号：`.../master/{$.bookId}_{$.chapterId}.txt`。
  // 这不是 CSS/JSONPath 规则，而是 URL 模板；先规范成 {{...}} 再走模板渲染。
  if (/^https?:\/\//i.test(rule) && /(?<!\{)\{\$[^{}]+\}(?!\})/.test(rule)) {
    rule = rule.replace(/(?<!\{)\{\$([^{}]+)\}(?!\})/g, "{{$$$1}}");
  }

  // Legado 允许把 @get:{xid} 直接写进 URL（195 宜搜、243 新浪、561/619 17K）。
  // 以前只有 {{...}} 会走 renderTemplate，纯 URL 里的 @get 原样保留，随后被
  // 当成 XPath/CSS 解析，抛 "Expected name, found ://api..."，整个详情页失败。
  if (/^https?:\/\//i.test(rule) && rule.includes("@get:")) {
    // 缺变量时不要拼出 `?gid=` 这样的半截 URL，交给 bookInfo 回退到 bookUrl。
    const missing = Array.from(rule.matchAll(/@get:(?:\{([^{}]+)\}|([A-Za-z_][\w]*))/g))
      .map((m) => String(m[1] ?? m[2] ?? "").trim())
      .some((key) => key === "" || ctx.vars[key] === undefined || ctx.vars[key] === null || String(ctx.vars[key]) === "");
    if (missing) return [];
    const rendered = await renderTemplate(rule, toTemplateContext(ctx), opts.js, prev ?? (ctx.json ?? ctx.text));
    const next = rendered.trim();
    if (!next || next.includes("@get:")) return [];
    return [next];
  }

  if (rule.startsWith("<js>") || rule.startsWith("@js:")) {
    const code = stripJsWrapper(rule.startsWith("@js:") ? rule.slice(4) : rule);
    const base = ctx.jsResult ?? prev ?? elementBackedResult(ctx, ctx.text || ctx.html);
    return runJsWithReplacement(code, ctx, opts, base);
  }

  // Legado 的 `@put:{xid:x_id}` 可以挂在取值规则末尾（472 猪猪小说的
  // ruleBookInfo.name = `$.bookName@put:{xid:x_id}`），不只在行首。
  // 以前整串当 JSONPath/CSS，xid 永远不写入，目录 URL 的 @get:{xid} 就是空。
  if (rule.includes("@put:") && !rule.startsWith("@put:")) {
    const putAt = rule.lastIndexOf("@put:");
    const baseRule = rule.slice(0, putAt).trim();
    const payload = rule.slice(putAt + 5).trim();
    const baseValues = baseRule ? await evalBaseValues(baseRule, ctx, opts, prev) : [];
    try {
      const obj = parsePutPayload(payload);
      if (!obj) return baseValues;
      for (const [key, raw] of Object.entries(obj)) {
        const spec = String(raw ?? "");
        if (!spec.trim()) {
          ctx.vars[key] = "";
          continue;
        }
        let stored = spec;
        try {
          const values = await evalRule(spec, ctx, opts);
          if (values.length) stored = values.join("\n");
        } catch {
          /* 不是合法规则就按字面量存 */
        }
        ctx.vars[key] = stored;
      }
    } catch {
      /* ignore malformed put */
    }
    return baseValues;
  }

  // `class.s2@tag.a@href<js>…</js>`：选择器 + 内联 JS 块。Legado 在 <js> 处切段，
  // 前半段的结果就是 JS 的 result。按行切开后 JS 会被当 CSS 选择器，整条规则报废。
  const inlineJs = rule.indexOf("<js>");
  if (inlineJs > 0) {
    const close = rule.lastIndexOf("</js>");
    // splitLines 把 `selector@js:code` 规范成 `selector<js>code`（没有闭合标签）。
    // 以前没有 close 时把 "<js>" 前缀原样交给 JS，报 "Invalid or unexpected token"。
    const code = stripJsWrapper(close > inlineJs ? rule.slice(inlineJs, close + 5) : rule.slice(inlineJs + 4));
    const base = rule.slice(0, inlineJs).trim();
    const baseValues = base ? await evalBaseValues(base, ctx, opts, prev) : [];
    return runJsWithReplacement(code, ctx, opts, (await selectorJsResult(base, ctx, opts)) ?? baseValues.join("\n"));
  }

  const jsTail = rule.lastIndexOf("@js:");
  if (jsTail > 0) {
    const base = rule.slice(0, jsTail).trim();
    const code = stripJsWrapper(rule.slice(jsTail + 4));
    const baseValues = base ? await evalBaseValues(base, ctx, opts, prev) : [prev ?? (ctx.html || ctx.text)];
    return runJsWithReplacement(code, ctx, opts, (await selectorJsResult(base, ctx, opts)) ?? baseValues.join("\n"));
  }

  // Legado 的 @regex 选择器可以独立使用（@regex:\\d+），也可以接在取值规则后面
  // （class.name@text@regex:…）。接在后面时先求值前半段，再把每条结果喂给正则。
  const regexSelectorAt = rule.indexOf("@regex:");
  if (regexSelectorAt >= 0) {
    const base = rule.slice(0, regexSelectorAt).trim();
    const spec = parseRegexSelector(rule.slice(regexSelectorAt + 7));
    if (!spec) return [];
    const inputs = base ? await evalBaseValues(base, ctx, opts, prev) : [ctx.text || ctx.html];
    return applyRegexSelector(inputs, spec);
  }

  // 只有「整条规则就是一个 @get」时才直接取变量。290 爱下电子书的
  // chapterUrl 是 `@get:{url}p{{$.ordernum}}.html`，以前把整串当 key，
  // 变量取不到就返回空，目录 153 章的 chapterUrl 全是空。混合模板交给
  // 后面的 renderTemplate 分支。
  if (/^@get:(?:\{[^{}]+\}|[A-Za-z_][\w]*)$/.test(rule)) {
    const payload = rule.slice(5).trim();
    let key = payload;
    if (payload.startsWith("{")) {
      const obj = parsePutPayload(payload);
      key = String(obj?.key ?? obj?.name ?? payload.replace(/^\{/, "").replace(/\}\s*$/, "")).trim();
    }
    const value = ctx.vars[key];
    return value === undefined || value === "" ? [] : [String(value)];
  }

  // 602 QQ阅读的 chapterName 写裸键 `title`，不是 `$.title`；Legado 在 JSON
  // 条目上允许直接取属性。这一步必须放在 accessor-only（title 也是 HTML 属性
  // 访问器）之前，否则 JSON 条目的 title 会被当成元素属性取空。
  if (ctx.kind === "json" && ctx.json !== null && ctx.json !== undefined && typeof ctx.json === "object" && /^[A-Za-z_][\w]*$/.test(rule)) {
    const direct = (ctx.json as Record<string, unknown>)[rule];
    if (direct !== undefined && direct !== null) return [String(direct)];
  }

  // `html` / `text` 是对当前上下文整体的取值，不是「第一个根节点的 innerHTML」。
  // 589/712 若初文学的 `html@js:result.match(...)` 需要整页 HTML；以前
  // elementAccessor 取到第一个 <a> 的 innerHTML，只剩「导航」两个字。
  if (rule === "html") return [ctx.html];
  if (rule === "text") return [textOf(ctx.html)];
  if (/^(ownText|content|href|src|title|alt|textNodes|value)$/.test(rule)) return elementAccessor(ctx.html, rule);

  // 规则以单个访问器开头（437/828 阅友小说：bookUrl = "@onclick@js:result.match(…)")
  // 表示「取当前元素的这个属性」。以前整串丢给 cheerio，抛错后返回空，JS 拿到空串就崩。
  if (/^@[A-Za-z_][\w:.-]*$/.test(rule) && !/^@(js:|css:|json:|xpath:|XPath:|get:|put:)/.test(rule)) {
    return elementAccessor(ctx.html, rule.slice(1));
  }

  // `##正则##` 必须在 JSONPath/CSS 之前处理：`$.groupID##.*_##` 以 `$` 开头，
  // 以前会先被 JSONPath 分支吞成 []，导致所有「取值 + 正则替换」规则静默失效。
  // 但 `{{...}}` 模板内部也可能出现 ##，那种情况交给模板分支。
  const regexIndex = rule.indexOf("##");
  const templateIndex = rule.indexOf("{{");
  if (regexIndex > 0 && (templateIndex < 0 || templateIndex > regexIndex)) return evalRegex(rule, ctx, opts, prev);

  if (rule.startsWith("@css:")) return queryHtml(ctx.html, rule.slice(5));
  if (rule.startsWith("//")) return queryXpath(rule, ctx.html);
  if (rule.startsWith("@XPath:") || rule.startsWith("@xpath:")) return queryXpath(rule.slice(7), ctx.html);
  if (rule.startsWith("@json:")) return queryJson(rule.slice(6), ctx.json ?? parseJson(ctx.html));
  if (rule.startsWith("$")) return queryJson(rule, ctx.json ?? parseJson(ctx.html));
  if (ctx.kind === "json" && ctx.json !== null && ctx.json !== undefined && !rule.includes("@") && !rule.startsWith("<")) {
    const values = queryJson(rule, ctx.json);
    if (values.length) return values;
  }

  if (rule.startsWith(":")) {
    try {
      const match = new RegExp("^" + rule.slice(1)).exec(ctx.text);
      return match ? [match[0]] : [];
    } catch {
      return [];
    }
  }

  if (indexOutsideBraces(rule, "##") >= 0) return evalRegex(rule, ctx, opts);

  if (rule.includes("{{")) {
    const rendered = await renderTemplate(rule, toTemplateContext(ctx), opts.js, prev ?? (ctx.json ?? ctx.text));
    if (rule.startsWith("{{")) return rendered ? [rendered] : [];
    if (rendered === rule) return [];
    if (/^https?:\/\//.test(rendered) || rendered.startsWith("/")) return [rendered];
    // 混着字面文本的模板（简介里常见「📖 书名：{{@@...}}」）渲染完就是最终文本，
    // 再丢给 cheerio 当选择器会抛 "Unmatched selector"。
    if (!/^[.#\[:>+~]/.test(rendered)) return [rendered];
    return queryHtml(ctx.html, rendered);
  }

  // Legado 的 jsoup 取属性语法：`.chapter-list dd@a@href`、`.bookname@text`。
  // 只有 collectItems 支持它时，详情页/目录里这类单值规则会静默取空。
  const accessorRule = parseJsoupSelector(rule);
  if (accessorRule.selector && accessorRule.accessors.length) return evalJsoupRule(rule, ctx.html);

  try {
    return queryHtml(ctx.html, rule);
  } catch {
    // 纯文本行（`&nbsp;`、装饰线、说明文字）不是合法选择器，别让它炸掉整条规则。
    return [];
  }
}

export async function evalLine(line: string, ctx: RuleContext, opts: EvalOptions = {}, prev?: string): Promise<string[]> {
  // JS 规则里的 || / && 是逻辑运算符，%% 也可能出现在字符串里；先拆会切碎代码。
  // 409 言情小说吧的 chapterUrl 是 href@js:...'...@href||a[href...，
  // 以前在第一个 || 处断开，只剩半条 JS，报 "Invalid or unexpected token"。
  const hasJs = line.includes("@js:") || line.includes("<js>");
  if (!hasJs) {
    const orParts = splitTop(line, "||");
    if (orParts.length > 1) {
      for (const part of orParts) {
        const result = await evalLine(part, ctx, opts, prev);
        if (result.length) return result;
      }
      return [];
    }

    const altParts = splitTop(line, "%%");
    if (altParts.length > 1) {
      for (const part of altParts) {
        const result = await evalLine(part, ctx, opts, prev);
        if (result.length) return result;
      }
      return [];
    }

    const andParts = splitTop(line, "&&");
    if (andParts.length > 1) {
      const out: string[] = [];
      for (const part of andParts) out.push(...(await evalLine(part, ctx, opts, prev)));
      return out;
    }
  }

  return evalSingle(line, ctx, opts, prev);
}

function stripLeadingComments(rule: string): string {
  let text = rule;
  // 书源作者会在规则前写「//删掉这行字，vip章节会显示🔓」之类的注释。
  // 不能把所有 // 都当注释：真正的 XPath 也以 // 开头（//div、//meta）。
  // 只剥离 // 后面直接跟中文的整行，保留 //div / //meta / //script 等 XPath。
  while (/^\s*\/\/[\u4e00-\u9fa5][^\n]*(?:\n|$)/.test(text)) {
    text = text.replace(/^\s*\/\/[\u4e00-\u9fa5][^\n]*(?:\n|$)/, "");
  }
  return text;
}

export async function evalRule(rule: string | undefined, ctx: RuleContext, opts: EvalOptions = {}): Promise<string[]> {
  if (!rule || !rule.trim()) return [];
  rule = stripLeadingComments(rule);
  if (!rule.trim()) return [];
  const whole = rule.trim();
  if (whole.startsWith("@js:") || (whole.startsWith("<js>") && whole.endsWith("</js>"))) {
    // 整条规则就是 JS：上一段（选择器）的结果通过 ctx.jsResult 传进来；返回值可能是
    // 元素数组（选择器 + <js> 的目录规则），必须逐项展开而不是 String() 成一坨。
    const code = stripJsWrapper(whole.startsWith("@js:") ? whole.slice(4) : whole);
    return runJsWithReplacement(code, ctx, opts, ctx.jsResult ?? elementBackedResult(ctx, ctx.text || ctx.html));
  }
  // 多行纯文本模板（书源简介常写成「&nbsp;\n📖 书名：{{@@…}}…」）不能逐行拆：
  // 第一行 `&nbsp;` 会被当选择器解析，整条规则直接返回空。
  if (
    rule.includes("\n") &&
    rule.includes("{{") &&
    !rule.includes("||") &&
    !rule.includes("&&") &&
    !rule.includes("@js:") &&
    !rule.includes("<js>")
  ) {
    const rendered = await evalSingle(rule, ctx, opts);
    if (rendered.length) return rendered;
  }
  const rawLines = splitLines(rule);
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    let current = rawLines[i];
    while (/(&&|\|\||%%)$/.test(current.trim()) && i + 1 < rawLines.length) {
      current = current.trimEnd() + rawLines[(i += 1)];
    }
    lines.push(current);
  }
  // `@js:` 起头的一行意味着「从这里到规则末尾都是 JS」。书源普遍这么写：
  //   {{@@.c_value.4@text}}•{{@@.c_value.5@text}}
  //   @js:result
  //   .replace("••","")
  //   .replace(/^(\d+).第/,'第')
  // 以前只认整行等于 `@js:`，这类多行 JS 会被逐行当 CSS 选择器，报
  // "js rule failed: Invalid or unexpected token"。
  let bareJs = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("@js:")) {
      bareJs = i;
      break;
    }
  }
  if (bareJs >= 0) {
    const inline = lines[bareJs].trim().slice(4).trim();
    const codeLines = inline ? [inline] : [];
    let end = bareJs;
    // 单行 JS 后面的行只有在明显是方法链延续（.replace(…) / ) / } / ;）时才算同一段，
    // 否则视为下一条规则，避免把 `@js:result.trim()` 后面的选择器吞进 JS。
    while (end + 1 < lines.length && (!inline || /^[.)\]};]/.test(lines[end + 1].trim()))) {
      end += 1;
      codeLines.push(lines[end]);
    }
    const code = codeLines.join("\n");
    const headRule = bareJs > 0 ? lines.slice(0, bareJs).join("\n") : "";
    let result: unknown = ctx.jsResult ?? elementBackedResult(ctx, ctx.text || ctx.html);
    if (headRule) {
      const head = await evalRule(headRule, ctx, opts);
      if (!head.length) return [];
      result = (await selectorJsResult(lines[bareJs - 1], ctx, opts)) ?? head.join("\n");
    }
    return runJsWithReplacement(code, ctx, opts, result);
  }
  let result: string[] = [];
  let previous: string | undefined;
  let working = ctx;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("@put:")) {
      let payload = line.slice(5).trim();
      // 书源常把 @put 的 JSON 排版成多行（一个 key 一行）。splitLines 按行切开了，
      // 这里必须把剩余行补回来，否则第一行 JSON.parse 失败，后面的 key 会被当成选择器。
      while (braceDelta(payload) > 0 && i + 1 < lines.length) payload += "\n" + lines[(i += 1)];
      try {
        const obj = parsePutPayload(payload);
        if (!obj) continue;
        for (const [key, raw] of Object.entries(obj)) {
          const text = String(raw ?? "");
          if (!text.trim()) {
            working.vars[key] = "";
            continue;
          }
          let stored = text;
          try {
            // Legado 的 @put 存的是「规则的结果」而不是规则本身：
            // @put:{a:"[property$=author]@content"} 必须真的去解析详情页。
            const values = await evalRule(text, working, opts);
            if (values.length) stored = values.join("\n");
          } catch {
            /* 不是合法规则就按字面量存 */
          }
          working.vars[key] = stored;
        }
      } catch {
        /* ignore malformed put */
      }
      continue;
    }
    // 紧跟 <js> / @js: 的行：上一行若是纯选择器，把匹配到的元素交给 JS 当 result。
    const needsElements = /^(<js>|@js:)/.test(line.trim());
    // 注意用 ctx.html 而不是 working.html：上一段的结果可能是拼接后的元素片段
    // （311 个 <a>），拿它去查 li.chapter 一定是空，JS 就会退化成拿到一整坨字符串。
    const lineCtx =
      needsElements && i > 0
        ? { ...working, jsResult: await selectorJsResult(lines[i - 1], { ...working, html: ctx.html }, opts) }
        : working;
    result = await evalLine(line, lineCtx, opts, previous);
    if (!result.length) return [];
    const joined = result.join("\n");
    previous = joined;
    working = {
      ...working,
      text: joined,
      html: /^\s*</.test(joined) ? joined : working.html,
    };
  }
  return result;
}

export async function collectItems(rule: string, ctx: RuleContext, opts: EvalOptions = {}): Promise<RuleContext[]> {
  const trimmed = rule.trim();
  if (!trimmed) return [];
  // 书源列表规则常写 `.hot_sale||.column-2`（两套模板任选其一）。以前整串丢给
  // css-select，直接抛 "Column combinators are not yet supported"，整站目录/榜单全空。
  // 但 JS 规则里的 `||` 是逻辑或（409 言情小说吧的目录 JS 满屏 `a||b`），
  // 在这里拆会把一条完整 JS 切成语法不完整的碎片，报 "Unexpected end of input"。
  const hasJsRule = trimmed.includes("@js:") || trimmed.includes("<js>");
  const orParts = hasJsRule ? [trimmed] : splitTop(trimmed, "||");
  if (orParts.length > 1) {
    for (const part of orParts) {
      const items = await collectItems(part, ctx, opts);
      if (items.length) return items;
    }
    return [];
  }
  // @regex 列表规则（章节名/卷名正则）产出的是一组文本，后面的字段规则在文本上求值。
  if (trimmed.includes("@regex:")) {
    const values = await evalRule(trimmed, ctx, opts);
    if (values.length) {
      return values.map((text, i) => ({ ...ctx, kind: "text" as const, text, docHtml: ctx.html, index: i }));
    }
  }
  // chapterList 写成「选择器 + <js>」或整条 `@js:` 时，Legado 返回的是元素列表，
  // 引擎要把每项还原成 html 上下文，后面的 chapterName/chapterUrl 才能在元素上求值。
  if (/^(<js>|@js:)/.test(trimmed) || trimmed.includes("<js>") || /(^|\n)\s*@js:/.test(trimmed)) {
    // 192/193 完本小说：JS 返回 JSON.stringify(章节对象数组)，后面还跟一行 $[*]。
    // 这行 JSONPath 不是再查一次页面，而是告诉 Legado「把 JS 结果当 JSON 列表遍历」。
    // 以前 evalRule 会把 JSON 串当 HTML，$[*] 自然查不到；这里先剥掉尾部的 JSONPath，
    // 只跑 JS，再把 JSON 数组还原成 json 上下文，chapterName 的 $.title 才能命中。
    const close = trimmed.lastIndexOf("</js>");
    const tail = close >= 0 ? trimmed.slice(close + 5).trim() : "";
    if (close >= 0 && tail.startsWith("$")) {
      const values = await evalRule(trimmed.slice(0, close + 5), ctx, opts);
      if (values.length === 1) {
        const parsed = parseJson(values[0] as string);
        if (Array.isArray(parsed)) {
          const objects = parsed.filter((value) => value !== null && typeof value === "object");
          if (objects.length) {
            return objects.map((value, i) => ({
              ...ctx,
              kind: "json" as const,
              json: value,
              text: JSON.stringify(value),
              index: i,
            }));
          }
        }
      }
    }
    // `</js>` 后面若还有选择器（27 个 BCsection 源写 `tag.a`），它是在 JS
    // 产出的 <li> 列表上再取一层，不是对整页再查一次。先只跑 JS，再用尾选择器
    // 取元素，才能把 <a> 的 data-* 属性带进 chapterName/chapterUrl。
    const jsOnly = close >= 0 ? trimmed.slice(0, close + 5) : trimmed;
    const values = await evalRule(jsOnly, ctx, opts);
    if (values.length && tail && !tail.startsWith("$") && !tail.includes("##")) {
      try {
        const elements = queryHtmlElements(values.join("\n"), tail);
        if (elements.length) {
          return elements.map((html, i) => ({ ...ctx, kind: "html" as const, html, docHtml: ctx.html, index: i }));
        }
      } catch {
        /* tail 不是选择器就继续按普通结果处理 */
      }
    }
    if (values.length) {
      // 195 宜搜的 chapterList 直接返回对象数组（没有 $[*] 尾巴）；toRuleStrings
      // 会把每个对象序列化成 JSON 字符串，若按 HTML 处理，chapterName 的 name
      // 永远取不到。这里识别「每个值都是 JSON 对象」并还原成 json 条目。
      const objects = values.map((value) => parseJson(value));
      if (objects.length && objects.every((value) => value !== null && typeof value === "object" && !Array.isArray(value))) {
        return objects.map((value, i) => ({
          ...ctx,
          kind: "json" as const,
          json: value,
          text: JSON.stringify(value),
          index: i,
        }));
      }
      return values.map((html, i) => ({ ...ctx, kind: "html" as const, html, docHtml: ctx.html, index: i }));
    }
    // JS 已经执行过且没结果，不要再把整段规则（含 <js>）当 CSS 选择器，
    // 否则会抛出误导性的 "Empty sub-selector"/"Unmatched selector"。
    return [];
  }
  if (ctx.kind === "json" && ctx.json !== null && ctx.json !== undefined && !trimmed.includes("@")) {
    const paths = trimmed.split("&&").map((part) => part.trim()).filter(Boolean);
    const values = paths
      .flatMap((path) => queryJsonRaw(path, ctx.json))
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => value !== null && value !== undefined && value !== "");
    if (values.length) return values.map((value) => ({ ...ctx, json: value, text: JSON.stringify(value) }));
  }
  // 列表规则同样可能带 `##`（`class.list@li##…`）：整串交给 evalRule 求值，
  // 再把结果还原成条目，后面的 chapterName/chapterUrl 才能在每一条上求值。
  if (trimmed.includes("##")) {
    const values = await evalRule(trimmed, ctx, opts);
    if (values.length) return values.map((html, i) => ({ ...ctx, kind: "html" as const, html, docHtml: ctx.html, index: i }));
  }
  const andParts = splitTop(trimmed, "&&");
  if (andParts.length > 1) {
    const out: RuleContext[] = [];
    for (const part of andParts) out.push(...(await collectItems(part, ctx, opts)));
    if (out.length) return out;
  }
  if (trimmed.startsWith("$") || trimmed.startsWith("@json:")) {
    const values = queryJsonRaw(trimmed.startsWith("@json:") ? trimmed.slice(6) : trimmed, ctx.json ?? parseJson(ctx.html));
    return values.map((value) => ({ ...ctx, kind: "json" as const, json: value, text: "" }));
  }
  if (trimmed.startsWith("@XPath:") || trimmed.startsWith("@xpath:")) {
    const texts = queryXpath(trimmed.slice(7), ctx.html);
    return texts.map((text) => ({ ...ctx, kind: "text" as const, text }));
  }
  // 裸 XPath 列表规则（20 H动漫 的 `//ul[@class="..."]/li`）。以前直接丢给
  // css-select，抛 "Empty sub-selector"；Legado 允许列表规则以 // 开头。
  if (trimmed.startsWith("//")) {
    return queryXpathElements(trimmed, ctx.html).map((html, i) => ({
      ...ctx,
      kind: "html" as const,
      html,
      docHtml: ctx.html,
      index: i,
    }));
  }
  const parsed = parseJsoupSelector(trimmed);
  if (parsed.accessors.length) {
    let current = queryHtmlElements(ctx.html, parsed.selector || trimmed);
    for (const acc of parsed.accessors) {
      if (acc === "text" || acc === "ownText") {
        return current.map((html, i) => ({
          ...ctx,
          kind: "text" as const,
          text: acc === "text" ? textOf(html) : ownTextOf(html),
          docHtml: ctx.html,
          index: i,
        }));
      }
      current = current.flatMap((html) => elementAccessor(html, acc));
    }
    return current.map((html, i) => ({ ...ctx, kind: "html" as const, html, docHtml: ctx.html, index: i }));
  }
  const elements = queryHtmlElements(ctx.html, trimmed);
  return elements.map((html, i) => ({ ...ctx, kind: "html" as const, html, docHtml: ctx.html, index: i }));
}

/**
 * Like {@link evalField}, but keeps every match. Chapter bodies are usually many
 * paragraphs selected by one rule (`#nr p@html`), and taking only the first one
 * silently truncates the text to a couple of sentences.
 */
export async function evalFieldList(rule: string | undefined, ctx: RuleContext, opts: EvalOptions = {}): Promise<string[]> {
  const text = (rule ?? "").trim();
  if (!text) return [];
  // `##` 是 Legado 的「取值 + 正则替换」分隔符（正文规则里极常见：
  // `id.content@html##最新网址：…`，842 个源里 126 个这么写）。它不属于 CSS，
  // 以前这里把它当简单选择器直接丢给 cheerio，抛
  // `Expected name, found ##…`，整章正文取不到——换源面板里就显示「测字失败」。
  // @regex 可能返回多条（g: 或 :split），不能走只取第一条的 evalField。
  if (text.includes("@regex:")) {
    const values = await evalRule(text, ctx, opts);
    return values.filter((value) => value && value.trim());
  }
  const simple =
    !text.includes("||") && !text.includes("%%") && !text.includes("&&") && !text.includes("@js:") && !text.includes("<js>") && !text.includes("##");
  if (simple) {
    if (ctx.kind === "json" && ctx.json !== null && ctx.json !== undefined) {
      const values = queryJsonRaw(text, ctx.json).map((v) => (typeof v === "string" ? v : JSON.stringify(v))).filter((v) => v && v.trim());
      if (values.length) return values;
    } else if (ctx.kind !== "text") {
      // 选择器写歪（少括号、混进正则）时不要让异常冒到整章正文：退回规则求值。
      try {
        const values = queryHtml(ctx.html, text).filter((v) => v && v.trim());
        if (values.length) return values;
      } catch {
        /* fall through to evalField */
      }
    }
  }
  // 正文规则里的 JS 往往一次返回整章（段落之间是换行），不能走只取第一条的
  // evalField，否则 458/459 的 `htmlContent<js>result.replace(...)</js>` 只剩第一段。
  const values = await evalRule(rule, ctx, opts);
  return values.map((value) => value.trim()).filter(Boolean);
}

/**
 * 有的书源把取值写成 `{{$.xxx}}`，JSON 里没有该字段时模板会把表达式原样吐出来，
 * 于是作者/分类里出现「小满小意777 · {{$.categoryInfoV4」。展示前把没解开的表达式抹掉。
 */
export function stripUnresolved(value: string): string {
  if (!value || !value.includes("{{")) return value;
  return value
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\{\{[^{}]*$/, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * 详情页/目录里的字段规则常常写成「整页列表 + 下标」（`.bookname` 配 `index`），
 * 所以在列表项自己的片段里取不到时，会回退到整页文档再取第 index 个。
 *
 * 回退本身是对的，但按「每个条目 × 每个字段」各跑一次整页查询，成本是
 * O(条目数 × 字段数 × 文档大小)：一个 800KB 的搜索页 38 条结果就是 6 秒的同步
 * 卡顿（换源探测时整条流水线都会停住）。这里按「规则 + 文档」缓存整页结果，
 * 同一份文档只查一次。
 */
const docFieldCache = new Map<string, { html: string; values: string[] }>();
const DOC_FIELD_CACHE_SIZE = 96;

async function docFieldValues(rule: string, ctx: RuleContext, opts: EvalOptions): Promise<string[]> {
  const docHtml = ctx.docHtml ?? "";
  const cached = docFieldCache.get(rule);
  if (cached && cached.html === docHtml) return cached.values;
  const values = await evalRule(rule, { ...ctx, html: docHtml, text: docHtml }, opts);
  docFieldCache.set(rule, { html: docHtml, values });
  if (docFieldCache.size > DOC_FIELD_CACHE_SIZE) {
    const oldest = docFieldCache.keys().next().value;
    if (oldest !== undefined) docFieldCache.delete(oldest);
  }
  return values;
}

export async function evalField(rule: string | undefined, ctx: RuleContext, opts: EvalOptions = {}): Promise<string> {
  const values = await evalRule(rule, ctx, opts);
  const hit = values.find((v) => v && v.trim().length > 0)?.trim();
  if (hit) return stripUnresolved(hit);
  if (ctx.docHtml && ctx.docHtml !== ctx.html) {
    const docValues = await docFieldValues(rule ?? "", ctx, opts);
    const idx = ctx.index ?? 0;
    const picked = docValues.length > idx ? docValues[idx] : docValues.length === 1 ? docValues[0] : "";
    if (picked && picked.trim()) return stripUnresolved(picked.trim());
  }
  return "";
}
