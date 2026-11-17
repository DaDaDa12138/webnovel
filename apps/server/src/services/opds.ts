/**
 * OPDS 1.2 目录：把书架暴露给 KOReader / Moon+ Reader / Thorium 这类外部阅读器。
 *
 * 只做纯字符串拼装，路由层负责查库与导出 EPUB；这样 XML 结构可以在 vitest 里
 * 直接断言，不必启动 Fastify。所有文本都过 escapeXml，避免书名里的 & < > 把 feed 弄坏。
 */

export interface OpdsBook {
  id: number;
  name: string;
  author: string;
  intro: string;
  coverUrl: string;
  sourceId: number;
  updatedAt: string;
  chapterCount: number;
  /** 已缓存正文的章节数；0 时不给 acquisition 链接，客户端就不会点进去拿 409。 */
  cachedChapters: number;
}

export interface OpdsShelfPage {
  books: OpdsBook[];
  total: number;
  page: number;
  size: number;
  /** 书架搜索词；空串表示不过滤。 */
  search?: string;
}

const ATOM_NS = 'xmlns="http://www.w3.org/2005/Atom"';
const OPDS_NS = 'xmlns:opds="http://opds-spec.org/2010/catalog"';
const DC_NS = 'xmlns:dc="http://purl.org/dc/terms/"';
const OS_NS = 'xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"';
const FEED_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition";
const NAV_TYPE = "application/atom+xml;profile=opds-catalog;kind=navigation";

/** XML 1.0 不允许大部分控制字符；书源正文偶尔会带控制字符。 */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function normalizeOrigin(origin: string): string {
  return String(origin ?? "").trim().replace(/\/+$/, "");
}

/** SQLite 的 datetime('now') 是 UTC 但没有 Z；补上后再交给 Date。 */
export function isoDate(value: string, fallback: Date): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback.toISOString();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

/** 封面既可能是本地 EPUB 的 /api/local-images/…，也可能是远端书源图；后者走图片代理补 Referer。 */
export function coverHref(book: Pick<OpdsBook, "coverUrl" | "sourceId">, origin: string): string {
  const raw = String(book.coverUrl ?? "").trim();
  if (!raw) return "";
  const base = normalizeOrigin(origin);
  if (raw.startsWith("/api/")) return base + raw;
  if (/^https?:\/\//i.test(raw)) {
    return base + "/api/img?u=" + encodeURIComponent(raw) + "&s=" + encodeURIComponent(String(book.sourceId || 0));
  }
  return "";
}

export function imageMime(url: string): string {
  let target = String(url ?? "");
  try {
    const parsed = new URL(target, "http://local");
    target = parsed.searchParams.get("u") || parsed.pathname;
  } catch {
    /* 不是合法 URL 时按原串猜扩展名 */
  }
  const clean = target.split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

/** 搜索词只做空白折叠与长度限制；OPDS 客户端传来的 query 不保证已经 trim。 */
export function normalizeOpdsSearch(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** 书架搜索只匹配书名与作者，和阅读器里的搜索保持同一口径。 */
export function filterOpdsBooks<T extends Pick<OpdsBook, "name" | "author">>(books: T[], search: string): T[] {
  const needle = normalizeOpdsSearch(search).toLowerCase();
  if (!needle) return books;
  return books.filter((book) =>
    (String(book.name ?? "") + " " + String(book.author ?? "")).toLowerCase().includes(needle),
  );
}

function feedOpen(title: string, id: string, updated: Date, self: string, type: string, base: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<feed " + [ATOM_NS, OPDS_NS, DC_NS, OS_NS].join(" ") + ">",
    "  <id>" + escapeXml(id) + "</id>",
    "  <title>" + escapeXml(title) + "</title>",
    "  <updated>" + updated.toISOString() + "</updated>",
    "  <author><name>legado-web</name></author>",
    '  <link rel="self" href="' + escapeXml(self) + '" type="' + type + '"/>',
    '  <link rel="start" href="' + escapeXml(base + "/opds") + '" type="' + NAV_TYPE + '"/>',
    '  <link rel="search" href="' + escapeXml(base + "/opds/search.xml") + '" type="application/opensearchdescription+xml"/>',
  ].join("\n");
}

function entry(book: OpdsBook, base: string, now: Date): string {
  const cover = coverHref(book, base);
  const mime = imageMime(book.coverUrl);
  const summary = book.cachedChapters > 0
    ? book.intro
    : [book.intro, "尚未缓存正文：先在 legado-web 里打开几章，或用「整本离线」下载后再来。"].filter(Boolean).join("\n\n");
  const lines = [
    "  <entry>",
    "    <title>" + escapeXml(book.name || "未命名") + "</title>",
    "    <id>urn:legado-web:book:" + book.id + "</id>",
    "    <updated>" + isoDate(book.updatedAt, now) + "</updated>",
    "    <author><name>" + escapeXml(book.author || "佚名") + "</name></author>",
    "    <dc:language>zh</dc:language>",
    "    <summary type=\"text\">" + escapeXml(summary) + "</summary>",
  ];
  if (cover) {
    lines.push('    <link rel="http://opds-spec.org/image" href="' + escapeXml(cover) + '" type="' + mime + '"/>');
    lines.push('    <link rel="http://opds-spec.org/image/thumbnail" href="' + escapeXml(cover) + '" type="' + mime + '"/>');
  }
  if (book.cachedChapters > 0) {
    lines.push(
      '    <link rel="http://opds-spec.org/acquisition/open-access" href="' +
        escapeXml(base + "/opds/books/" + book.id + "/epub") +
        '" type="application/epub+zip"/>',
    );
  }
  lines.push("  </entry>");
  return lines.join("\n");
}

/** 导航 feed：根目录只放一个「书架」入口，未来可以加「最近阅读」「书单」。 */
export function buildOpdsRoot(origin: string, totalBooks: number, updated = new Date()): string {
  const base = normalizeOrigin(origin);
  const self = base + "/opds";
  return [
    feedOpen("legado-web", "urn:legado-web:opds:root", updated, self, NAV_TYPE, base),
    "  <entry>",
    "    <title>书架</title>",
    "    <id>urn:legado-web:opds:shelf</id>",
    "    <updated>" + updated.toISOString() + "</updated>",
    '    <content type="text">共 ' + totalBooks + " 本书</content>",
    '    <link rel="subsection" href="' + escapeXml(base + "/opds/shelf") + '" type="' + FEED_TYPE + '"/>',
    "  </entry>",
    "</feed>",
    "",
  ].join("\n");
}

/** 书架 acquisition feed：分页链接用 page/size，搜索词跟着分页链接一起走。 */
export function buildOpdsShelf(input: OpdsShelfPage, origin: string, updated = new Date()): string {
  const base = normalizeOrigin(origin);
  const page = Math.max(1, Math.floor(input.page || 1));
  const size = Math.max(1, Math.floor(input.size || 50));
  const total = Math.max(0, Math.floor(input.total || 0));
  const search = normalizeOpdsSearch(input.search);
  const suffix = search ? "&search=" + encodeURIComponent(search) : "";
  const pageHref = (number: number): string => base + "/opds/shelf?page=" + number + "&size=" + size + suffix;
  const self = pageHref(page);
  const link = (rel: string, href: string): string =>
    '  <link rel="' + rel + '" href="' + escapeXml(href) + '" type="' + FEED_TYPE + '"/>';
  const links = [link("first", pageHref(1))];
  if (page > 1) links.push(link("previous", pageHref(page - 1)));
  if (page * size < total) links.push(link("next", pageHref(page + 1)));
  const title = search ? "搜索：" + search : "legado-web 书架";
  const id = search ? "urn:legado-web:opds:search" : "urn:legado-web:opds:shelf";
  const query = search
    ? ['  <opensearch:Query role="request" searchTerms="' + escapeXml(search) + '" startPage="' + page + '"/>']
    : [];
  return [
    feedOpen(title, id, updated, self, FEED_TYPE, base),
    "  <opensearch:totalResults>" + total + "</opensearch:totalResults>",
    ...query,
    ...links,
    ...input.books.map((book) => entry(book, base, updated)),
    "</feed>",
    "",
  ].join("\n");
}

/** OpenSearch 描述：客户端据此知道书架支持搜索，以及搜索词的拼法。 */
export function buildOpdsSearchDescription(origin: string): string {
  const base = normalizeOrigin(origin);
  const template = base + "/opds/shelf?search={searchTerms}&page={startPage?}&size={count?}";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    "  <ShortName>legado-web</ShortName>",
    "  <Description>搜索 legado-web 书架</Description>",
    "  <InputEncoding>UTF-8</InputEncoding>",
    "  <OutputEncoding>UTF-8</OutputEncoding>",
    '  <Url type="' + FEED_TYPE + '" template="' + escapeXml(template) + '"/>',
    "</OpenSearchDescription>",
    "",
  ].join("\n");
}
