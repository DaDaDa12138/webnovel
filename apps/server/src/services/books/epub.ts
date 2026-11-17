import { createHash } from "node:crypto";
import { htmlToTextWithImages, splitInlineImages } from "@legado/engine";
import { findEntry, readZipEntries, readZipFile, readZipText, type ZipEntry } from "./zip.js";

/**
 * 极简 EPUB 读取：只取「书名 / 作者 / 按 spine 顺序的正文文本」。
 *
 * 不渲染原书 CSS；图片按「第几段之后」的位置抽出来，交给阅读器自己的图片管线，
 * 原书的行内样式搬进来只会和用户设的字号、行距打架。
 */

export interface EpubChapter {
  title: string;
  text: string;
  /** 图片资源名（assets 的键），导入时再换成 /api/local-images/... 地址。 */
  images: Array<{ src: string; after: number }>;
}

export interface EpubBook {
  title: string;
  author: string;
  /** dc:description 压成纯文本后的简介；没有就是空串。 */
  intro: string;
  chapters: EpubChapter[];
  /** 内容寻址的图片资源：文件名 -> 字节。 */
  assets: Map<string, Buffer>;
  /** 封面资源名；没有封面时为空串。 */
  cover: string;
}

function attr(tag: string, name: string): string {
  const matched = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return matched ? matched[1] : "";
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function dirOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index + 1);
}

/** 相对路径拼接，处理 ../ 与 ./，EPUB 里的 href 都是相对 OPF 的。 */
export function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0]);
  const parts = (base + clean).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function textOfTag(xml: string, tag: string): string {
  const matched = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return matched ? decodeXml(matched[1].replace(/<[^>]+>/g, "")).trim() : "";
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

function extensionOf(path: string): string {
  const matched = IMAGE_EXT.exec(path);
  return matched ? matched[0].toLowerCase().replace(".jpeg", ".jpg") : "";
}

export function readEpub(buffer: Buffer): EpubBook {
  const entries = readZipEntries(buffer);
  const assets = new Map<string, Buffer>();
  const addAsset = (zipPath: string): string => {
    const ext = extensionOf(zipPath);
    if (!ext) return "";
    const entry = findEntry(entries, zipPath);
    if (!entry) return "";
    try {
      const data = readZipFile(buffer, entry);
      if (!data.length || data.length > MAX_IMAGE_BYTES) return "";
      const name = createHash("sha1").update(data).digest("hex").slice(0, 16) + ext;
      assets.set(name, data);
      return name;
    } catch {
      return "";
    }
  };
  const read = (name: string): string => {
    const entry = findEntry(entries, name);
    if (!entry) throw new Error(`EPUB 缺少文件：${name}`);
    return readZipText(buffer, entry);
  };
  /**
   * 封面兜底：EPUB2 常见 <guide><reference type="cover" href="cover.xhtml">，
   * 而 cover.xhtml 往往只是一张 <img>。先按图片取，取不到再进 HTML 里找第一张图。
   */
  const coverFromHtml = (zipPath: string): string => {
    if (!/\.x?html?$/i.test(zipPath)) return "";
    const entry = findEntry(entries, zipPath);
    if (!entry) return "";
    const html = readZipText(buffer, entry);
    const img =
      /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html) ??
      /<image\b[^>]*\b(?:xlink:)?href\s*=\s*["']([^"']+)["']/i.exec(html);
    return img ? addAsset(resolvePath(dirOf(zipPath), img[1])) : "";
  };
  const coverFromHref = (href: string): string => {
    const path = resolvePath(opfDir, href);
    return addAsset(path) || coverFromHtml(path);
  };

  const container = read("META-INF/container.xml");
  const rootfile = /<rootfile\b[^>]*>/i.exec(container)?.[0] ?? "";
  const opfPath = attr(rootfile, "full-path");
  if (!opfPath) throw new Error("EPUB 没有 rootfile");
  const opf = read(opfPath);
  const opfDir = dirOf(opfPath);

  const manifest = new Map<string, { href: string; type: string }>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) manifest.set(id, { href, type: attr(tag, "media-type") });
  }
  const spine: string[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
    const idref = attr(tag, "idref");
    if (idref) spine.push(idref);
  }

  const title = textOfTag(opf, "dc:title") || "未命名 EPUB";
  const author = textOfTag(opf, "dc:creator");
  // dc:description 有时是 HTML 片段（甚至被转义成 &lt;p&gt;），压成一行再入库。
  const intro = textOfTag(opf, "dc:description")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);

  // 封面：EPUB 3 用 properties="cover-image"，EPUB 2 用 <meta name="cover">。
  let cover = "";
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    if (!/\bproperties\s*=\s*["'][^"']*\bcover-image\b/i.test(tag)) continue;
    const href = attr(tag, "href");
    if (href) cover = addAsset(resolvePath(opfDir, href));
    if (cover) break;
  }
  if (!cover) {
    const meta = /<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(opf);
    const item = meta ? manifest.get(meta[1]) : undefined;
    if (item) cover = coverFromHref(item.href);
  }
  // 老书常见 <guide type="cover" href="cover.xhtml">，属性顺序两种写法都有。
  if (!cover) {
    const guide =
      /<reference\b[^>]*\btype\s*=\s*["']cover["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(opf) ??
      /<reference\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\btype\s*=\s*["']cover["']/i.exec(opf);
    if (guide) cover = coverFromHref(guide[1]);
  }
  // 最后一招：manifest 里 id 或文件名带 cover 的条目（有些书两者都没写）。
  if (!cover) {
    for (const [id, item] of manifest) {
      if (!/cover/i.test(id) && !/cover/i.test(item.href)) continue;
      cover = coverFromHref(item.href);
      if (cover) break;
    }
  }

  const chapters: EpubChapter[] = [];
  spine.forEach((idref, index) => {
    const item = manifest.get(idref);
    if (!item) return;
    const path = resolvePath(opfDir, item.href);
    const entry: ZipEntry | undefined = findEntry(entries, path);
    if (!entry) return;
    const html = readZipText(buffer, entry);
    // <head> 里的 <title> 会被 cheerio 的 text() 当成正文，导进来就成了重复的书名。
    const bodyHtml = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, "");
    // 用虚拟 https 域名让 htmlToTextWithImages 能把相对路径绝对化，再按 pathname 找回 ZIP 条目。
    const parsed = htmlToTextWithImages(bodyHtml, `https://epub.local/${path}`);
    const split = splitInlineImages(parsed.text, parsed.images);
    const images: Array<{ src: string; after: number }> = [];
    for (const image of split.images) {
      let zipPath = "";
      try {
        zipPath = decodeURIComponent(new URL(image.src).pathname.replace(/^\/+/, ""));
      } catch {
        zipPath = "";
      }
      const name = zipPath ? addAsset(zipPath) : "";
      if (name) images.push({ src: name, after: image.after });
    }
    const heading = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(bodyHtml);
    const headingText = heading ? htmlToTextWithImages(heading[1]).text.trim() : "";
    const docTitle = textOfTag(html, "title");
    const name = headingText || (docTitle && docTitle !== title ? docTitle : "") || `第 ${index + 1} 节`;
    // 阅读器自己会渲染章标题，正文第一段如果就是同一个标题，导进来会重复一行。
    const lines = split.text.split("\n");
    const dropHeading = Boolean(headingText) && lines[0]?.trim() === headingText;
    const text = dropHeading ? lines.slice(1).join("\n") : split.text;
    if (dropHeading) {
      for (const image of images) image.after = Math.max(0, image.after - 1);
    }
    if (!text.trim() && !images.length) return;
    chapters.push({ title: name, text, images });
  });

  return { title, author, intro, chapters, assets, cover };
}
