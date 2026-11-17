import { load } from "cheerio";
import iconv from "iconv-lite";

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&hellip;": "…",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

const ENTITY_PATTERN = /&(?:[a-z][a-z0-9]+|#\d+|#x[0-9a-f]+);/i;

/**
 * 有些源把正文转义了两层（例如 `&amp;quot;`），只解一次会在页面上留下
 * 字面量 `&quot;`。这里最多解两层，并且只在确实还有实体时才继续。
 */
export function decodeEntitiesDeep(text: string, passes = 2): string {
  let out = text;
  for (let i = 0; i < passes && ENTITY_PATTERN.test(out); i++) {
    const next = decodeEntities(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

export function encodeKey(key: string, charset: string): string {
  const label = /gb/i.test(charset) ? "gb18030" : charset;
  let bytes: Buffer;
  try {
    bytes = iconv.encodingExists(label) ? iconv.encode(key, label) : Buffer.from(key, "utf8");
  } catch {
    bytes = Buffer.from(key, "utf8");
  }
  return Array.from(bytes)
    .map((byte) => "%" + byte.toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

export function normalizeText(text: string): string {
  return decodeEntitiesDeep(text).replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/**
 * 正文图片在文本管线里的占位标记。\u0001 不会出现在正常散文里，
 * 所以清洗、替换规则、断行都不会把它吃掉；图片位置最后再按段落数还原。
 */
export const IMAGE_MARKER = "\u0001IMG";

/** htmlToTextWithImages 的返回值：text 里还留着 \u0001IMG<n>\u0001 标记。 */
export interface HtmlTextWithImages {
  text: string;
  /** 绝对图片地址，下标与标记里的数字一一对应。 */
  images: string[];
}

/** 一张正文插图：src 是绝对地址，after 表示它前面有多少段正文（0 = 章首）。 */
export interface InlineImage {
  src: string;
  after: number;
}

const BLOCK_SELECTOR = "p, div, h1, h2, h3, h4, h5, h6, li, tr, section, article, blockquote, figure, figcaption";

function textOf($: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>): string {
  root.find("br").replaceWith("\n");
  root.find(BLOCK_SELECTOR).each((_, el) => {
    const $el = $(el);
    $el.append("\n");
  });
  return normalizeText(root.text())
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Convert an html fragment into plain text paragraphs. */
export function htmlToText(html: string): string {
  const $ = load(`<div id="__root__">${html}</div>`, null, false);
  const root = $("#__root__");
  root.find("script, style").remove();
  return textOf($, root);
}

/** 懒加载站点的真实地址常在 data-* 上，src 只是占位图。 */
const IMAGE_SRC_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-echo", "data-url", "src"];

function contentImageUrl($el: { attr: (name: string) => string | undefined }, baseUrl: string): string {
  let raw = "";
  for (const attr of IMAGE_SRC_ATTRS) {
    const value = ($el.attr(attr) ?? "").trim();
    if (value && !/^(data|blob|about|javascript):/i.test(value)) {
      raw = value;
      break;
    }
  }
  if (!raw) return "";
  const width = Number($el.attr("width") ?? 0);
  const height = Number($el.attr("height") ?? 0);
  // 1×1 计数图与站点占位图：抓回来只会让读者看到一条空白。
  if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) return "";
  if (/(spacer|blank|pixel|transparent|loading|placeholder|1x1)\.(gif|png|jpe?g)/i.test(raw)) return "";
  const absolute = toAbsoluteUrl(raw, baseUrl);
  return /^https?:/i.test(absolute) ? absolute : "";
}

/**
 * 和 htmlToText 走同一条管线，但把 <img> 换成标记留在文本里。
 * 服务端拿不到渲染后的 DOM，所以「图片在第几段之后」只能靠标记在压平后的文本里数段落。
 */
export function htmlToTextWithImages(html: string, baseUrl = ""): HtmlTextWithImages {
  const $ = load(`<div id="__root__">${html}</div>`, null, false);
  const root = $("#__root__");
  root.find("script, style").remove();
  const images: string[] = [];
  root.find("img").each((_, el) => {
    const $el = $(el);
    const url = contentImageUrl($el, baseUrl);
    if (!url) {
      $el.remove();
      return;
    }
    const index = images.push(url) - 1;
    $el.replaceWith(`${IMAGE_MARKER}${index}\u0001`);
  });
  return { text: textOf($, root), images };
}

/**
 * 把标记换成「第几段之后」，同时把标记从正文里抹掉。
 *
 * after 用「前面已有多少段正文」而不是字符偏移：段落是阅读器的排版单位，
 * 字号、行距、页宽怎么变，段落序号都不变。
 */
export function splitInlineImages(text: string, images: string[]): { text: string; images: InlineImage[] } {
  const paragraphs: string[] = [];
  const placed: InlineImage[] = [];
  for (const raw of text.replace(/\r/g, "").split(/\n+/)) {
    // 行首的图属于「这一行之前」，行中的图属于「这一行之后」——否则章首插图会被排到第一段下面。
    const found: Array<{ src: string; atStart: boolean }> = [];
    const stripped = raw.replace(/\u0001IMG(\d+)\u0001/g, (match, digits: string, offset: number) => {
      const src = images[Number(digits)];
      const before = raw.slice(0, offset).replace(/\u0001IMG\d+\u0001/g, "");
      if (src) found.push({ src, atStart: before.trim().length === 0 });
      return "";
    });
    const line = stripped.replace(/\u00a0/g, " ").trim();
    if (line) paragraphs.push(line);
    for (const item of found) placed.push({ src: item.src, after: paragraphs.length - (item.atStart && line ? 1 : 0) });
  }
  return { text: paragraphs.join("\n"), images: placed };
}

/**
 * 把正文里**字面量**的 <img> 标签抽成插图。
 *
 * 书山聚合这类源直接把上游正文当字符串返回，图片没有被解析成 DOM；有的源还会把
 * HTML 转义一层，解码后页面上就只剩一行 <img src="..."></img>。这里按标签本身
 * 取地址，并复用 splitInlineImages 的「第几段之后」定位，保证和引擎解析出的插图
 * 走同一套渲染逻辑。
 */
export function extractInlineImages(text: string, baseUrl = ""): { text: string; images: InlineImage[] } {
  const images: string[] = [];
  const marked = text
    .replace(/<img\b[^>]*>(?:\s*<\/img>)?/gi, (tag) => {
      const $ = load(`<div id="__root__">${tag}</div>`, null, false);
      const $img = $("#__root__ img").first();
      const url = contentImageUrl($img, baseUrl);
      if (!url) return "";
      const index = images.push(url) - 1;
      return `${IMAGE_MARKER}${index}\u0001`;
    })
    .replace(/<\/img\s*>/gi, "");
  return splitInlineImages(marked, images);
}

export function toAbsoluteUrl(url: string, base: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed, base || undefined).toString();
  } catch {
    return trimmed;
  }
}
