import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import { readEpub } from "./epub.js";
import { createLocalBook, type LocalBookResult } from "./local-book.js";

export interface ImportEpubInput {
  name?: string;
  buffer?: Buffer;
}

export type ImportEpubResult = LocalBookResult;

/** 导入本地 EPUB：解出书名/作者/正文，按文件哈希去重落库。 */
export function importEpubBook(input: ImportEpubInput): ImportEpubResult {
  const buffer = input.buffer;
  if (!buffer || buffer.length < 100) {
    return { ok: false, status: 400, body: { error: "empty_file", message: "文件是空的" } };
  }
  let book;
  try {
    book = readEpub(buffer);
  } catch (err) {
    return { ok: false, status: 400, body: { error: "bad_epub", message: String((err as Error).message ?? err).slice(0, 200) } };
  }
  if (!book.chapters.length) {
    return { ok: false, status: 400, body: { error: "no_text", message: "这本书没有可读的正文（可能是纯图片 EPUB）" } };
  }
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  // 图片按书的内容指纹分目录存放，重复导入同一个文件不会产生第二份。
  // 写盘失败不阻断导入：正文仍可读，图片加载不到时阅读器会隐藏空图框。
  if (book.assets.size) {
    try {
      const dir = path.join(config.dataDir, "local-images", hash);
      mkdirSync(dir, { recursive: true });
      for (const [name, data] of book.assets) writeFileSync(path.join(dir, name), data);
    } catch {
      /* 图片是增强内容，写不进去也让书能读 */
    }
  }
  const base = `/api/local-images/${hash}/`;
  const sections = book.chapters.map((chapter) => ({
    ...chapter,
    images: chapter.images.map((image) => ({ ...image, src: base + image.src })),
  }));
  return createLocalBook({
    kind: "epub",
    name: (input.name ?? "").trim() || book.title,
    author: book.author,
    intro: book.intro,
    sections,
    hash,
    cover: book.cover ? base + book.cover : "",
  });
}
