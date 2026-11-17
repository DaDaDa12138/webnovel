import { load, type CheerioAPI } from "cheerio";

type Element = any;
import { parseJsoupSelector } from "./jsoup.js";
import { normalizeText } from "./text.js";

function attrName(accessor: string): string {
  return accessor.replace(/^abs:/, "");
}

function applyAccessor($: CheerioAPI, el: Element, accessor: string): string[] {
  const acc = accessor.trim();
  if (!acc) return [];

  const colonIdx = /^(.*?[^:]):(-?\d+)$/.exec(acc);
  if (colonIdx && colonIdx[1]) {
    const all = applyAccessor($, el, colonIdx[1]);
    const idx = Number(colonIdx[2]);
    const picked = idx < 0 ? all[all.length + idx] : all[idx];
    return picked ? [picked] : [];
  }
  if (acc === "children") {
    return $(el)
      .children()
      .toArray()
      .map((child) => $.html(child));
  }
  if (acc === "text") return [normalizeText($(el).text())];
  if (acc === "ownText") {
    const clone = $(el).clone();
    clone.children().remove();
    return [normalizeText(clone.text())];
  }
  if (acc === "textNodes") {
    return $(el)
      .contents()
      .toArray()
      .filter((node) => node.type === "text")
      .map((node) => normalizeText($(node).text()))
      .filter(Boolean);
  }
  if (acc === "html" || acc === "innerHtml") return [$(el).html() ?? ""];
  if (acc === "all" || acc === "outerHtml") return [$.html(el)];
  if (acc === "content") return [$(el).attr("content") ?? ""];
  // 目录规则里常见 `option@value`（80 福书、396、825）：value 是元素属性，
  // 以前没有这个访问器，整条目录的 chapterUrl 都是空。
  if (acc === "value") return [$(el).attr("value") ?? ""];

  const value = $(el).attr(attrName(acc));
  if (value) return [value];
  // 通用步骤：目录规则大量写成 `ul@li!-1@a`、`.catalog-body@class.book-dir.1@tag.li!-1`，
  // 每一步都可能是 class./id./tag./text. 前缀 + 下标 + ! 排除，必须走同一套解析。
  const step = parseJsoupSelector(acc);
  if (!step.selector) return [];
  let nodes = $(el).find(step.selector).toArray();
  // `class.BCsectionTwo-top-chapter@li` 这类规则里 class 就写在 <li> 上，
  // jsoup 的 select 只找后代，会把 0 个章节当成目录为空。元素自身命中时
  // 且没有后代命中，就把自己当作这一级的结果。
  if (!nodes.length && !step.index && $(el).is(step.selector)) nodes = [el];
  if (step.index) {
    if (step.index.end !== undefined) {
      const start = step.index.start < 0 ? nodes.length + step.index.start : step.index.start;
      const end = step.index.end < 0 ? nodes.length + step.index.end : step.index.end;
      nodes = nodes.slice(start, end);
    } else {
      const pos = step.index.start < 0 ? nodes.length + step.index.start : step.index.start;
      nodes = nodes[pos] ? [nodes[pos]] : [];
    }
  }
  return nodes.map((node) => $.html(node));
}

export interface HtmlQueryOptions {
  baseUrl?: string;
}

/**
 * cheerio 解析一棵 1MB 的文档要几十毫秒，而一条书源规则链会对同一个 html 反复解析：
 * 详情页 8 个字段各一次、目录里每个 `{{@@...}}` 一次。缓存最近几棵树能把
 * 「解析」从每次几十毫秒降到只付一次，这是换源探测时最长的一段同步耗时。
 */
const docCache: Array<{ html: string; $: CheerioAPI }> = [];
const DOC_CACHE_SIZE = 4;

function docOf(html: string): CheerioAPI {
  for (const entry of docCache) {
    if (entry.html === html) return entry.$;
  }
  const $ = load(html);
  docCache.unshift({ html, $ });
  if (docCache.length > DOC_CACHE_SIZE) docCache.pop();
  return $;
}

/** Legado 的 `||` 是「备选规则」：前一段取不到才试下一段。
 *  409 言情小说吧的 coverUrl 就是 `img[...]@src||meta[...]@content||...`；
 *  整串交给 css-select 会报 "Column combinators are not yet supported"。
 *  只在顶层拆，跳过引号和 []/() 内的 ||（正则里的 | 不受影响）。 */
export function splitSelectorAlternatives(rule: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < rule.length; i += 1) {
    const ch = rule[i];
    if (quote) {
      buf += ch;
      if (ch === quote && rule[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "[" || ch === "(") {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === "]" || ch === ")") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (depth === 0 && ch === "|" && rule[i + 1] === "|") {
      parts.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** 418 轻菠萝包正文规则写 `div[style=text-indent: 2em;]`，css-select 不接受
 *  未加引号且含空格/分号的属性值，会抛 "Attribute selector didn't terminate"。
 *  jsoup 能容忍这种写法，这里补一层规范化，只处理最简单的 `[attr=value]`。 */
function normalizeCssSelector(selector: string): string {
  return selector.replace(/\[([A-Za-z_][\w-]*)=([^\]"']+)\]/g, (_m, attr: string, value: string) => {
    const clean = value.trim().replace(/"/g, '\"');
    return `[${attr}="${clean}"]`;
  });
}

export function queryHtml(html: string, rule: string): string[] {
  const alternatives = splitSelectorAlternatives(rule);
  if (alternatives.length > 1) {
    for (const alternative of alternatives) {
      const values = queryHtml(html, alternative);
      if (values.length) return values;
    }
    return [];
  }
  const { selector, index, accessors } = parseJsoupSelector(rule);
  const $ = docOf(html);
  // Legado 的 `text.下一章@href` 是「按元素文本找节点」，不是 CSS 的
  // `:contains`。`:contains` 会同时命中 html/head 等祖先，取 @href 时
  // 往往拿到页面第一个样式表地址（578 新御书屋曾因此把正文请求发到
  // sweet-alert.css）。这里只保留最深一层命中节点。
  const selectorPart = rule.split("@")[0].trim();
  const textOnly = /^text\.(.+)$/.exec(selectorPart);
  let elements: Element[];
  if (textOnly) {
    const rawTerm = textOnly[1].replace(/\.-?\d+(?::\d+)?$/, "").trim();
    const all = $("*").toArray().filter((el) => normalizeText($(el).text()).includes(rawTerm));
    const deepest = all.filter(
      (el) => !$(el).find("*").toArray().some((child) => normalizeText($(child).text()).includes(rawTerm)),
    );
    elements = deepest.length ? deepest : all;
  } else {
    elements = selector ? $(selector).toArray() : [];
  }
  if (!elements.length && selector) {
    // Some sources use bare text fragments that cheerio cannot parse as a selector.
    return [];
  }
  if (index) {
    if (index.end !== undefined) {
      const start = index.start < 0 ? elements.length + index.start : index.start;
      const end = index.end < 0 ? elements.length + index.end : index.end;
      elements = elements.slice(start, end);
    } else {
      const pos = index.start < 0 ? elements.length + index.start : index.start;
      elements = elements[pos] ? [elements[pos]] : [];
    }
  }
  const results: string[] = [];
  for (const el of elements) {
    let values: string[] = [$.html(el)];
    if (accessors.length) {
      for (const acc of accessors) {
        const next: string[] = [];
        for (const value of values) {
          const fragment = load(value, null, false);
          const root = fragment.root().children().first();
          if (!root.length) {
            next.push(normalizeText(value));
          } else {
            next.push(...applyAccessor(fragment, root.get(0) as Element, acc));
          }
        }
        values = next;
        if (!values.length) break;
      }
    } else {
      values = [normalizeText($(el).text())];
    }
    results.push(...values.filter(Boolean));
  }
  return results;
}

/**
 * jsoup 的 `:matches(regex)` / `:matchesOwn(regex)` 在 css-select 里不存在，
 * 409 言情小说吧、20 H动漫 这类源会直接抛 "Unknown pseudo-class :matchesown"。
 * 这里把常见的简单正则降级成 CSS：`^分类$` → `:contains("分类")`、
 * `^$` → `:empty`、`\S` → `:not(:empty)`；无法降级的替换成永假类，
 * 保证选择器仍可执行（宁可不选，也不让整条规则失败）。
 */
export function translateJsoupPseudos(selector: string): string {
  let out = "";
  for (let i = 0; i < selector.length; ) {
    const rest = selector.slice(i);
    const match = /^:matches(own)?\(/i.exec(rest);
    if (!match) {
      out += selector[i];
      i += 1;
      continue;
    }
    let depth = 0;
    let end = i + match[0].length;
    for (; end < selector.length; end += 1) {
      const ch = selector[end];
      if (ch === "\\") {
        end += 1;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        if (depth === 0) {
          end += 1;
          break;
        }
        depth -= 1;
      }
    }
    const body = selector.slice(i + match[0].length, end - 1).trim();
    out += translateMatchesBody(body);
    i = end;
  }
  return out;
}

function translateMatchesBody(body: string): string {
  if (body === "^$") return ":empty";
  if (/^\\+S$/.test(body)) return ":not(:empty)";
  const unescaped = body
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\([^a-zA-Z0-9])/g, "$1");
  if (!unescaped || /[\\^$.|?*+()\[\]{}]/.test(unescaped)) return ".__legado_never__";
  return `:contains("${unescaped.replace(/"/g, '\\"')}")`;
}

export function queryHtmlElements(html: string, rule: string): string[] {
  const alternatives = splitSelectorAlternatives(rule);
  if (alternatives.length > 1) {
    for (const alternative of alternatives) {
      const values = queryHtmlElements(html, alternative);
      if (values.length) return values;
    }
    return [];
  }
  const { selector, index } = parseJsoupSelector(rule);
  if (!selector) return [];
  const $ = docOf(html);
  let elements = $(normalizeCssSelector(translateJsoupPseudos(selector))).toArray();
  if (index) {
    if (index.end !== undefined) {
      const start = index.start < 0 ? elements.length + index.start : index.start;
      const end = index.end < 0 ? elements.length + index.end : index.end;
      elements = elements.slice(start, end);
    } else {
      const pos = index.start < 0 ? elements.length + index.start : index.start;
      elements = elements[pos] ? [elements[pos]] : [];
    }
  }
  return elements.map((el) => $.html(el));
}

/**
 * Legado 的 jsoup 取值语法（`.partlist-info@tag.dl@dt.0@text`）。
 * 详情页/目录里的 `{{@@...}}` 以前直接丢给 cheerio 当 CSS，必然取空或抛错。
 */
/** Legado `text.下一章` 只应命中真正承载文本的最深节点，不能把 html/head 算进去。 */
function textElements(html: string, term: string): string[] {
  const $ = docOf(html);
  const all = $("*").toArray().filter((el) => normalizeText($(el).text()).includes(term));
  const deepest = all.filter(
    (el) => !$(el).find("*").toArray().some((child) => normalizeText($(child).text()).includes(term)),
  );
  return (deepest.length ? deepest : all).map((el) => $.html(el));
}

export function evalJsoupRule(rule: string, html: string): string[] {
  const alternatives = splitSelectorAlternatives(rule);
  if (alternatives.length > 1) {
    for (const alternative of alternatives) {
      const values = evalJsoupRule(alternative, html);
      if (values.length) return values;
    }
    return [];
  }
  const accessorRule = parseJsoupSelector(rule);
  if (!accessorRule.selector || !accessorRule.accessors.length) return [];
  const selectorPart = rule.split("@")[0].trim();
  const textOnly = /^text\.(.+)$/.exec(selectorPart);
  // 这里必须把整条规则交给 queryHtmlElements：span.-2@a@text / a.1@href
  // 的下标写在选择器末尾，只传 accessorRule.selector 会把 -2/.1 丢掉，
  // 结果永远是第一个元素（33 个 BCsection 书源的搜索书名/地址因此取到分类链接）。
  let current = textOnly
    ? textElements(html, textOnly[1].replace(/\.-?\d+(?::\d+)?$/, "").trim())
    : queryHtmlElements(html, rule);
  for (const acc of accessorRule.accessors) {
    if (acc === "text" || acc === "ownText") {
      return current.map((item) => (acc === "text" ? textOf(item) : ownTextOf(item)));
    }
    current = current.flatMap((item) => elementAccessor(item, acc));
  }
  return current;
}

export function makeElementShim(html: string): any {
  const $ = load(html, null, false);
  const root = $.root().children().first();
  const node: any = root.length ? root : $.root();
  const firstOf = (selector: string) => {
    try {
      const picked = node.find(translateJsoupPseudos(selector)).first();
      return picked.length ? makeElementShim($.html(picked)) : makeElementShim("");
    } catch {
      // jsoup 支持正则属性选择器（[href~=[^a-z]page[^a-z]]），css-select 不支持。
      // 这类选择器多用于「清理导航/广告」，选不到比整条详情规则抛错更安全。
      return makeElementShim("");
    }
  };
  // 字符串方法要覆盖整段片段：正文规则的结果常是多段 <p>，只取第一个元素会丢正文。
  const rawHtml = () => html;
  return {
    // 正文规则常写 `$.chapter.htmlContent<js>result.replace(...)</js>`：
    // 这段 HTML 被包成元素后仍要能当字符串用，否则 458/459 会报
    // `result.replace is not a function`。只补文本方法，不覆盖 length，
    // 避免影响用 `result.length` 判断元素是否存在的源。
    replace: (pattern: unknown, replacement: unknown) => rawHtml().replace(pattern as never, replacement as never),
    replaceAll: (pattern: unknown, replacement: unknown) => rawHtml().replaceAll(pattern as never, replacement as never),
    match: (pattern: unknown) => rawHtml().match(pattern as never),
    matchAll: (pattern: unknown) => rawHtml().matchAll(pattern as never),
    split: (separator?: unknown, limit?: number) => rawHtml().split(separator as never, limit),
    trim: () => rawHtml().trim(),
    trimStart: () => rawHtml().trimStart(),
    trimEnd: () => rawHtml().trimEnd(),
    toLowerCase: () => rawHtml().toLowerCase(),
    toUpperCase: () => rawHtml().toUpperCase(),
    includes: (search: string, position?: number) => rawHtml().includes(search, position),
    indexOf: (search: string, position?: number) => rawHtml().indexOf(search, position),
    startsWith: (search: string, position?: number) => rawHtml().startsWith(search, position),
    endsWith: (search: string, endPosition?: number) => rawHtml().endsWith(search, endPosition),
    slice: (start?: number, end?: number) => rawHtml().slice(start, end),
    substring: (start?: number, end?: number) => (end === undefined ? rawHtml().substring(start ?? 0) : rawHtml().substring(start ?? 0, end)),
    charAt: (index: number) => rawHtml().charAt(index),
    attr: (name: string) => node.attr(name) ?? "",
    hasAttr: (name: string) => node.attr(name) !== undefined,
    // 部分站点把真实章节名/地址放在 data-* 属性里（BCsection 模板），
    // 书源用 result.attributes() 遍历。返回 {name,value}，同时兼容 jsoup 的 getKey/getValue。
    attributes: () =>
      Object.entries((node.attr() ?? {}) as Record<string, string>).map(([name, value]) => ({
        name,
        key: name,
        value,
        getKey: () => name,
        getValue: () => value,
        toString: () => `${name}="${value}"`,
      })),
    hasClass: (cls: string) => node.hasClass(cls),
    text: () => node.text(),
    ownText: () => node.clone().children().remove().end().text(),
    html: () => node.html() ?? "",
    outerHtml: () => $.html(node),
    data: (name?: string) => {
      if (name) return node.data(name) ?? "";
      const tag = String(node.prop("tagName") ?? "").toLowerCase();
      return tag === "script" || tag === "style" ? node.html() ?? "" : node.data() ?? "";
    },
    toString: () => $.html(node),
    // 单元素 shim 也补齐 jsoup 常用的 toArray()/remove()/each()，避免
    // 192/193 这类 result.select(...)[0].outerHtml() 或 [0].remove() 直接报错。
    toArray: () => [node],
    remove: () => node,
    each: () => node,
    select: (selector: string) => firstOf(selector),
    getElementsByTag: (tag: string) => firstOf(tag),
    getElementsByClass: (cls: string) => firstOf("." + cls),
    getElementById: (id: string) => firstOf("#" + id),
    parent: () => makeElementShim($.html(node.parent())),
    nextElementSibling: () => makeElementShim($.html(node.next())),
    previousElementSibling: () => makeElementShim($.html(node.prev())),
    children: () => node.children().toArray().map((child: unknown) => makeElementShim($.html(child as never))),
  };
}

export function elementAccessor(html: string, acc: string): string[] {
  const $ = load(html, null, false);
  const root = $.root().children().first();
  const node = (root.length ? root : $.root()) as never as Element;
  return applyAccessor($, node, acc);
}

export function ownTextOf(html: string): string {
  const $ = load(html, null, false);
  const root = $.root().children().first();
  if (!root.length) return "";
  const clone = root.clone();
  clone.children().remove();
  return normalizeText(clone.text());
}

export function textOf(html: string): string {
  return normalizeText(docOf(html).root().text());
}
