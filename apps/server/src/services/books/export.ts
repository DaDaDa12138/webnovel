import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { getDb } from "../../db/index.js";
import { writeZip } from "../../lib/zip-write.js";
import { countChapters, type BookRow } from "./store.js";

/** 正文插图：after 表示插在第几段之后，和 chapter_contents.images 同构。 */
export interface ExportImage {
  src: string;
  after: number;
}

/** 一章已缓存的正文；导出只认 chapter_contents，不去回源抓没读过的章节。 */
export interface ExportChapter {
  idx: number;
  title: string;
  content: string;
  images?: ExportImage[];
}

export interface ExportBook {
  id: number;
  name: string;
  author: string;
  intro?: string;
  /** 本地封面地址；远程封面不打包进 EPUB。 */
  cover?: string;
}

/** 已经读进内存的图片；src 用来和章节里的图片地址对上。 */
export interface ExportAsset {
  src: string;
  name: string;
  data: Buffer;
}

export interface ExportOptions {
  assets?: ExportAsset[];
  cover?: { name: string; data: Buffer } | null;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

/** 去掉文件系统与响应头都不喜欢的字符；书名全空时退回 book-<id>。 */
export function exportFilename(name: string, ext: string, id: number): string {
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return (clean || "book-" + id) + "." + ext;
}

function chapterTitle(chapter: ExportChapter): string {
  return chapter.title.trim() || "第 " + (chapter.idx + 1) + " 章";
}

function paragraphs(content: string): string[] {
  return content
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 纯文本导出：TXT 阅读器与剪贴板都能直接用，缺口在开头说清楚而不是静默少章。 */
export function buildTxt(book: ExportBook, chapters: ExportChapter[], total: number): string {
  const head = ["《" + book.name + "》", book.author ? "作者：" + book.author : "", ""];
  if (chapters.length < total) {
    head.push("（全书 " + total + " 章，已导出 " + chapters.length + " 章；未缓存的章节已跳过）", "");
  }
  const body: string[] = [];
  for (const chapter of chapters) {
    body.push(chapterTitle(chapter), "", ...paragraphs(chapter.content), "");
  }
  return head.join("\n") + body.join("\n").replace(/\n+$/, "\n");
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function imageMediaType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_TYPES[ext] ?? "application/octet-stream";
}

function chapterXhtml(
  title: string,
  content: string,
  images: ExportImage[] = [],
  imageName: (src: string) => string = () => "",
): string {
  const lines = paragraphs(content);
  const body: string[] = [];
  const emit = (after: number): void => {
    for (const image of images) {
      if (image.after !== after) continue;
      const name = imageName(image.src);
      if (!name) continue;
      body.push('    <figure><img src="images/' + escapeXml(name) + '" alt="" /></figure>');
    }
  };
  emit(0);
  lines.forEach((line, index) => {
    body.push("    <p>" + escapeXml(line) + "</p>");
    emit(index + 1);
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">',
    "  <head>",
    '    <meta charset="utf-8" />',
    "    <title>" + escapeXml(title) + "</title>",
    '    <link rel="stylesheet" type="text/css" href="style.css" />',
    "  </head>",
    "  <body>",
    "    <h1>" + escapeXml(title) + "</h1>",
    ...body,
    "  </body>",
    "</html>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * EPUB 3 导出：一章一个 XHTML，目录与 spine 都按 idx 排序。
 *
 * 正文插图只打包本地图片（/api/local-images），远程封面/图片仍留在原处，
 * 导出结果不依赖外网。
 */
export function buildEpub(
  book: ExportBook,
  chapters: ExportChapter[],
  total: number,
  now = new Date(),
  options: ExportOptions = {},
): Buffer {
  const items = chapters.map((chapter, index) => ({
    id: "c" + index,
    href: "chapter-" + chapter.idx + ".xhtml",
    title: chapterTitle(chapter),
    content: chapter.content,
    images: chapter.images ?? [],
  }));

  const assets = new Map<string, ExportAsset>();
  for (const asset of options.assets ?? []) {
    if (!assets.has(asset.name)) assets.set(asset.name, asset);
  }
  const bySrc = new Map<string, string>();
  for (const asset of assets.values()) bySrc.set(asset.src, asset.name);
  const imageName = (src: string): string => bySrc.get(src) ?? "";
  const cover = options.cover ?? null;
  const coverName = cover ? path.basename(cover.name) : "";

  const imageItems = Array.from(assets.values())
    .map((asset, index) => '    <item id="img' + index + '" href="images/' + escapeXml(asset.name) + '" media-type="' + imageMediaType(asset.name) + '" />')
    .join("\n");
  const coverItem = cover
    ? '    <item id="cover-image" href="' + escapeXml(coverName) + '" media-type="' + imageMediaType(coverName) + '" properties="cover-image" />'
    : "";
  const coverMeta = cover ? '    <meta name="cover" content="cover-image" />' : "";

  const manifest = [
    items
      .map((item) => '    <item id="' + item.id + '" href="' + item.href + '" media-type="application/xhtml+xml" />')
      .join("\n"),
    imageItems,
    coverItem,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const spine = items.map((item) => '    <itemref idref="' + item.id + '" />').join("\n");
  const navItems = items
    .map((item) => '        <li><a href="' + item.href + '">' + escapeXml(item.title) + "</a></li>")
    .join("\n");
  const modified = now.toISOString().replace(/\.\d{3}Z$/, "Z");

  const opf = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '    <dc:identifier id="bookid">legado-book-' + book.id + "</dc:identifier>",
    "    <dc:title>" + escapeXml(book.name) + "</dc:title>",
    "    <dc:creator>" + escapeXml(book.author || "佚名") + "</dc:creator>",
    book.intro ? "    <dc:description>" + escapeXml(book.intro) + "</dc:description>" : "",
    "    <dc:language>zh-CN</dc:language>",
    '    <meta property="dcterms:modified">' + modified + "</meta>",
    coverMeta,
    "  </metadata>",
    "  <manifest>",
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
    '    <item id="css" href="style.css" media-type="text/css" />',
    manifest,
    "  </manifest>",
    "  <spine>",
    spine,
    "  </spine>",
    "</package>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const nav = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">',
    "  <head>",
    '    <meta charset="utf-8" />',
    "    <title>目录</title>",
    '    <link rel="stylesheet" type="text/css" href="style.css" />',
    "  </head>",
    "  <body>",
    '    <nav epub:type="toc" id="toc">',
    "      <h1>目录</h1>",
    "      <ol>",
    navItems,
    "      </ol>",
    "    </nav>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");

  const container = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    "  <rootfiles>",
    '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />',
    "  </rootfiles>",
    "</container>",
    "",
  ].join("\n");

  const style = [
    "body { margin: 0 1.2em; line-height: 1.8; }",
    "h1 { font-size: 1.3em; margin: 1.4em 0 1em; }",
    "p { margin: 0 0 0.7em; text-indent: 2em; text-align: justify; }",
    "figure { margin: 1em 0; text-align: center; }",
    "img { max-width: 100%; }",
    "",
  ].join("\n");

  const entries = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/style.css", data: style },
    ...items.map((item) => ({
      name: "OEBPS/" + item.href,
      data: chapterXhtml(item.title, item.content, item.images, imageName),
    })),
    ...Array.from(assets.values()).map((asset) => ({ name: "OEBPS/images/" + asset.name, data: asset.data })),
    ...(cover ? [{ name: "OEBPS/" + coverName, data: cover.data }] : []),
  ];
  return writeZip(entries, now);
}

const MAX_EXPORT_ASSET_BYTES = 200 * 1024 * 1024;
const LOCAL_IMAGE_SRC = /^\/api\/local-images\/([0-9a-f]{32})\/([0-9a-f]{16}\.(?:png|jpe?g|gif|webp|svg))$/i;

function readLocalImage(src: string): Buffer | null {
  const match = LOCAL_IMAGE_SRC.exec(src);
  if (!match) return null;
  try {
    return readFileSync(path.join(config.dataDir, "local-images", match[1], match[2]));
  } catch {
    return null;
  }
}

/** 只收集本地图片；远程图片继续指向原地址，导出文件不依赖外网。 */
export function collectExportAssets(chapters: ExportChapter[], coverUrl = ""): ExportOptions {
  const assets: ExportAsset[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const chapter of chapters) {
    for (const image of chapter.images ?? []) {
      if (seen.has(image.src)) continue;
      const data = readLocalImage(image.src);
      if (!data || bytes + data.length > MAX_EXPORT_ASSET_BYTES) continue;
      seen.add(image.src);
      assets.push({ src: image.src, name: path.basename(image.src).toLowerCase(), data });
      bytes += data.length;
    }
  }
  let cover: ExportOptions["cover"] = null;
  const coverData = readLocalImage(coverUrl);
  if (coverData && bytes + coverData.length <= MAX_EXPORT_ASSET_BYTES) {
    cover = { name: "cover-" + path.basename(coverUrl).toLowerCase(), data: coverData };
  }
  return { assets, cover };
}

function parseExportImages(raw: string | null | undefined): ExportImage[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const images: ExportImage[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const src = (item as { src?: unknown }).src;
      const after = (item as { after?: unknown }).after;
      if (typeof src !== "string" || src.length === 0) continue;
      if (typeof after !== "number" || !Number.isFinite(after) || after < 0) continue;
      images.push({ src, after: Math.floor(after) });
    }
    return images;
  } catch {
    return [];
  }
}

/** 只数一下有多少章可导出，不把正文读进内存。 */
export function countCachedChapters(bookId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM chapters c
       JOIN chapter_contents cc ON cc.chapter_id = c.id
       WHERE c.book_id = ? AND c.is_volume = 0
         AND (LENGTH(TRIM(cc.content)) > 0 OR LENGTH(TRIM(COALESCE(cc.images, ''))) > 2)`,
    )
    .get(bookId) as { n: number };
  return Number(row?.n ?? 0);
}

/** 只取有正文或插图的章节；章节表里的卷名行（is_volume）不参与导出。 */
export function listCachedChapters(bookId: number): ExportChapter[] {
  const rows = getDb()
    .prepare(
      `SELECT c.idx, c.title, cc.content, cc.images FROM chapters c
       JOIN chapter_contents cc ON cc.chapter_id = c.id
       WHERE c.book_id = ? AND c.is_volume = 0
         AND (LENGTH(TRIM(cc.content)) > 0 OR LENGTH(TRIM(COALESCE(cc.images, ''))) > 2)
       ORDER BY c.idx ASC`,
    )
    .all(bookId) as Array<{ idx: number; title: string; content: string; images: string | null }>;
  return rows.map((row) => ({
    idx: row.idx,
    title: row.title,
    content: row.content,
    images: parseExportImages(row.images),
  }));
}

export function exportBook(book: BookRow, format: "txt" | "epub"): { filename: string; body: string | Buffer; chapters: number; total: number } {
  const chapters = listCachedChapters(book.id);
  const total = countChapters(book.id);
  const meta: ExportBook = {
    id: book.id,
    name: String(book.name ?? ""),
    author: String(book.author ?? ""),
    intro: String(book.intro ?? ""),
    cover: String(book.cover_url ?? ""),
  };
  if (format === "epub") {
    return {
      filename: exportFilename(meta.name, "epub", book.id),
      body: buildEpub(meta, chapters, total, new Date(), collectExportAssets(chapters, meta.cover)),
      chapters: chapters.length,
      total,
    };
  }
  return {
    filename: exportFilename(meta.name, "txt", book.id),
    body: buildTxt(meta, chapters, total),
    chapters: chapters.length,
    total,
  };
}
