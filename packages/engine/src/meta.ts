/** Heuristics that recover book metadata when a source rule is incomplete or broken. */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** <meta property="og:image" content="..."> / <meta name="description" ...> */
export function extractMeta(html: string, keys: string[]): string {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    if (!tag) continue;
    const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
    if (content && content.trim()) return decodeEntities(content.trim());
  }
  return "";
}

const TITLE_NOISE = [
  /[_|\-–—]\s*(最新章节|全文阅读|无弹窗|免费阅读|在线阅读).*$/i,
  /[_|\-–—]\s*[^_|\-–—]{1,12}(小说网|文学网|阅读网|书城|书屋|书院|网|com|net|org|cc|la|tv|info)\s*$/i,
  /\s*[-–—]\s*[^-–—]{1,16}$/,
  /最新章节.*$/,
];

export function extractTitle(html: string): string {
  const og = extractMeta(html, ["og:title", "twitter:title"]);
  const raw = og || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  let title = stripTags(raw);
  if (!title) return "";
  for (const re of TITLE_NOISE) title = title.replace(re, "").trim();
  return title.slice(0, 80);
}

export function extractDescription(html: string): string {
  const text = extractMeta(html, ["og:description", "description", "twitter:description"]);
  return text.slice(0, 800);
}

/** Reject generic site chrome (logos, sprites, "back" arrows) masquerading as a cover. */
export function isJunkImage(url: string): boolean {
  if (!url) return true;
  if (/^data:/i.test(url)) return true;
  const path = url.split("?")[0].toLowerCase();
  const file = path.slice(path.lastIndexOf("/") + 1);
  if (!/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file)) return true;
  if (/(logo|icon|favicon|sprite|header|footer|banner|back|home|arrow|loading|blank|default|placeholder|noimg|nocover|avatar|qrcode)/i.test(file)) {
    return true;
  }
  // 规则里拼接失败时常见产物：pic.site.com/NaN/undefined/undefineds.jpg
  if (/(^|\/)(nan|undefined|null|false|\[object object\])(\/|$|\.)/i.test(path)) return true;
  if (/(nan|undefined)/i.test(file)) return true;
  return false;
}

/** Pull a plausible cover out of a detail page: og:image first, then <img> near cover-ish markup. */
export function extractCover(html: string, baseUrl: string): string {
  const candidates: string[] = [];
  const og = extractMeta(html, ["og:image", "twitter:image", "image"]);
  if (og) candidates.push(og);
  for (const match of html.matchAll(/<img[^>]+>/gi)) {
    const tag = match[0];
    const src = tag.match(/(?:data-src|data-original|src)=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const near = tag.match(/(?:class|id|alt)=["']([^"']*)["']/i)?.[1] ?? "";
    if (/cover|book|pic|thumb|封面/i.test(near)) candidates.push(src);
  }
  for (const match of html.matchAll(/<img[^>]+>/gi)) {
    const src = match[0].match(/(?:data-src|data-original|src)=["']([^"']+)["']/i)?.[1];
    if (src) candidates.push(src);
  }
  for (const raw of candidates) {
    const url = absolutize(raw, baseUrl);
    if (!url) continue;
    if (isJunkImage(url)) continue;
    return url;
  }
  return "";
}

function absolutize(raw: string, baseUrl: string): string {
  const value = raw.trim();
  if (!value || value.startsWith("data:") || value.startsWith("javascript:")) return "";
  try {
    return new URL(value, baseUrl || "https://example.invalid").toString();
  } catch {
    return "";
  }
}

/** Best-effort display name when the rule and the page both fail (e.g. /99_99810/). */
export function nameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    const decoded = decodeURIComponent(last).replace(/\.(html?|php|aspx?)$/i, "");
    if (!decoded || /^\d+$/.test(decoded)) return "";
    return decoded.replace(/[-_]+/g, " ").slice(0, 60);
  } catch {
    return "";
  }
}
