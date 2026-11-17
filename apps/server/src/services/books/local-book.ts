import { createHash } from "node:crypto";
import { getDb } from "../../db/index.js";
import { MAX_CHAPTERS } from "./store.js";

export interface LocalSection {
  title: string;
  text: string;
  /** 正文插图：after 表示插在第几段之后，src 是已经可访问的地址。 */
  images?: Array<{ src: string; after: number }>;
}

export interface LocalBookInput {
  /** txt / epub，用来区分 book_url 前缀与书籍类型。 */
  kind: string;
  name: string;
  author?: string;
  sections: LocalSection[];
  /** 内容指纹：同一个文件重复导入落到同一本书。 */
  hash: string;
  /** 封面地址（本地导入时由 import-epub 生成）。 */
  cover?: string;
  /** 简介（EPUB 的 dc:description）。 */
  intro?: string;
}

export type LocalBookResult =
  | { ok: true; payload: { bookId: number; chapters: number; title: string; existed: boolean } }
  | { ok: false; status: number; body: Record<string, unknown> };

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export function formatWordCount(chars: number): string {
  if (chars >= 10_000) return `${(chars / 10_000).toFixed(2)}万字`;
  return `${chars}字`;
}

/**
 * 本地书落库：books + chapters + chapter_contents 三张表一次写完。
 *
 * 正文直接进 chapter_contents，阅读接口命中缓存就不会回源，
 * 所以进度、书签、划线、朗读、整本离线这些功能都不用改。
 */
export function createLocalBook(input: LocalBookInput): LocalBookResult {
  const sections = input.sections.filter(
    (section) => section.text.trim().length > 0 || (section.images?.length ?? 0) > 0,
  );
  if (!sections.length) return { ok: false, status: 400, body: { error: "empty", message: "没有解析出任何正文" } };
  if (sections.length > MAX_CHAPTERS) {
    return {
      ok: false,
      status: 413,
      body: { error: "too_many_chapters", message: `解析出 ${sections.length} 章（上限 ${MAX_CHAPTERS}）` },
    };
  }

  const db = getDb();
  const bookUrl = `local:${input.kind}:${input.hash}`;
  const existing = db.prepare("SELECT id, name FROM books WHERE book_url = ?").get(bookUrl) as { id: number; name: string } | undefined;
  if (existing) {
    const total = db.prepare("SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?").get(existing.id) as { n: number };
    return { ok: true, payload: { bookId: existing.id, chapters: total.n, title: existing.name, existed: true } };
  }

  const chars = sections.reduce((sum, section) => sum + section.text.length, 0);
  const name = input.name.trim().slice(0, 120) || "未命名书籍";
  const author = (input.author ?? "").trim().slice(0, 60);
  const lastChapter = sections[sections.length - 1].title.slice(0, 120);

  const info = db
    .prepare(
      `INSERT INTO books (book_url, source_id, name, author, cover_url, intro, kind, last_chapter, word_count, toc_url, origin, origin_name, in_shelf)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'local', '本地导入', 1)`,
    )
    .run(
      bookUrl,
      name,
      author,
      input.cover ?? "",
      (input.intro ?? "").slice(0, 2000),
      input.kind,
      lastChapter,
      formatWordCount(chars),
      bookUrl,
    );
  const bookId = Number(info.lastInsertRowid);

  const insertChapter = db.prepare(
    "INSERT INTO chapters (book_id, idx, title, url, base_url, is_vip, is_volume) VALUES (?, ?, ?, ?, '', 0, 0)",
  );
  const insertContent = db.prepare(
    "INSERT OR REPLACE INTO chapter_contents (chapter_id, content, images) VALUES (?, ?, ?)",
  );
  const write = db.transaction(() => {
    sections.forEach((section, index) => {
      const row = insertChapter.run(bookId, index, section.title.slice(0, 200), `local:${bookId}:${index}`);
      insertContent.run(
        row.lastInsertRowid,
        section.text,
        section.images?.length ? JSON.stringify(section.images) : "",
      );
    });
  });
  write();

  return { ok: true, payload: { bookId, chapters: sections.length, title: name, existed: false } };
}
