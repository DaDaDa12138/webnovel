import type { ChapterContent, ChapterImage } from "@legado/shared";
import { decodeEntitiesDeep, extractInlineImages } from "@legado/engine";
import { getDb } from "../../db/index.js";
import { fetchChapterContentWithImages } from "../engine.js";
import { applyReplaceRules } from "../text.js";
import { assessContentQuality } from "../content-quality.js";
import { autoSwitchBook, type AutoSwitchOutcome } from "../autoswitch.js";
import { isShushanVipError } from "../shushan.js";
import { isDahuilangLoginError, isDahuilangVipError } from "../dahuilang.js";
import { countChapters, getBook, type BookRow } from "./store.js";

export type ReadChapterResult =
  | { ok: true; payload: ChapterContent }
  | { ok: false; status: number; body: Record<string, unknown> };

/** 缓存里的 images 列是 JSON；旧行是空串，解析失败按「没有插图」处理。 */
function parseImages(raw: unknown): ChapterImage[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ChapterImage[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const { src, after } = item as { src?: unknown; after?: unknown };
      if (typeof src !== "string" || !src) continue;
      out.push({ src, after: Math.max(0, Math.floor(Number(after) || 0)) });
    }
    return out;
  } catch {
    return [];
  }
}

/** 书源/缓存里可能留着字面量 <img>；有图才走拆分，避免无图章节被重排、字符偏移漂移。 */
function extractImages(text: string, images: ChapterImage[], baseUrl: string): { text: string; images: ChapterImage[] } {
  if (!/<img\b|<\/img\s*>/i.test(text)) return { text, images };
  const extracted = extractInlineImages(text, baseUrl);
  const merged = [...images, ...extracted.images].sort((a, b) => a.after - b.after);
  return { text: extracted.text, images: merged };
}

/** 相对图片地址需要页面地址才能补全；聚合源用的是自定义编码地址，补不了就按绝对地址处理。 */
function contentBaseUrl(book: BookRow, chapter: Record<string, unknown>): string {
  for (const value of [String(chapter.url ?? ""), String(book.book_url ?? "")]) {
    if (/^https?:/i.test(value)) return value;
  }
  return "";
}

/** 正文图片一律走本站代理：书源站点普遍防盗链，直连会被 403 或把 Referer 暴露给第三方。 */
function proxyImages(images: ChapterImage[], sourceId: number, text: string): ChapterImage[] {
  const paragraphs = text.split(/\n+/).filter((line) => line.trim()).length;
  const out: ChapterImage[] = [];
  for (const image of images) {
    const src = /^https?:/i.test(image.src) ? `/api/img?u=${encodeURIComponent(image.src)}&s=${sourceId}` : image.src;
    if (!src) continue;
    out.push({ src, after: Math.min(image.after, paragraphs) });
  }
  return out;
}

/** 正文太短（广告页、反爬占位）或取不到时，服务端自己换一个源再取一次。 */
export async function loadChapterBody(
  db: ReturnType<typeof getDb>,
  book: BookRow,
  chapter: Record<string, unknown>,
): Promise<{ content: string; images: ChapterImage[]; failed?: string; vip?: boolean; login?: boolean }> {
  const cached = db.prepare("SELECT content, images FROM chapter_contents WHERE chapter_id = ?").get(chapter.id) as
    | { content: string; images?: string }
    | undefined;
  if (cached?.content) {
    // 旧缓存可能把源站的双层转义原样存了下来（页面上会出现字面量 &quot;）。
    // 读到时顺手修一次并写回，不必让用户清缓存或等全书重新抓取。
    const content = decodeEntitiesDeep(cached.content);
    const extracted = extractImages(content, parseImages(cached.images), contentBaseUrl(book, chapter));
    const images = proxyImages(extracted.images, Number(book.source_id), extracted.text);
    const imagesRaw = images.length ? JSON.stringify(images) : "";
    if (extracted.text !== cached.content || imagesRaw !== (cached.images ?? "")) {
      try {
        db.prepare("UPDATE chapter_contents SET content = ?, images = ? WHERE chapter_id = ?").run(
          extracted.text,
          imagesRaw,
          chapter.id,
        );
      } catch {
        // 写回失败（只读库、锁冲突）不影响本次阅读；下次打开会再尝试迁移。
      }
    }
    return { content: extracted.text, images };
  }
  // 本地导入的书没有书源：正文只可能来自 chapter_contents，回源一定会炸。
  if (!book.source_id) return { content: "", images: [], failed: "本地书缺少正文缓存" };
  try {
    const fetched = await fetchChapterContentWithImages(Number(book.source_id), String(chapter.url), String(book.book_url));
    const extracted = extractImages(applyReplaceRules(fetched.text), fetched.images, contentBaseUrl(book, chapter));
    const images = proxyImages(extracted.images, Number(book.source_id), extracted.text);
    if (extracted.text.trim()) {
      db.prepare("INSERT OR REPLACE INTO chapter_contents (chapter_id, content, images) VALUES (?, ?, ?)").run(
        chapter.id,
        extracted.text,
        images.length ? JSON.stringify(images) : "",
      );
    }
    return { content: extracted.text, images };
  } catch (err) {
    // VIP 专享不是抓取失败：换源只会换到另一本盗版站，必须原样告诉读者。
    if (isShushanVipError(err) || isDahuilangVipError(err)) {
      return { content: "", images: [], failed: err.message, vip: true };
    }
    // 聚合源要登录：也不能自动换源，否则会把读者带到另一个盗版站。
    if (isDahuilangLoginError(err)) {
      return { content: "", images: [], failed: err.message, login: true };
    }
    return { content: "", images: [], failed: String((err as Error).message ?? err) };
  }
}

/**
 * 读一章正文。
 *
 * 三条路：命中缓存直接返回；否则回源抓取并过替换规则；正文短于 260 字或抓取失败时
 * 先删缓存重取（旧版单段提取器写过的短缓存），仍不行才交给 autoSwitchBook 换源。
 */
export async function readChapter(bookId: number, requested: number): Promise<ReadChapterResult> {
  const db = getDb();
  let book = getBook(bookId);
  if (!book) return { ok: false, status: 404, body: { error: "not_found", message: "书籍不存在" } };
  let total = countChapters(bookId);
  let index = requested;
  if (!Number.isFinite(index) || index < 0) index = 0;
  if (total > 0 && index >= total) index = total - 1;
  let chapter = db.prepare("SELECT * FROM chapters WHERE book_id = ? AND idx = ?").get(bookId, index) as Record<string, unknown> | undefined;
  if (!chapter) return { ok: false, status: 404, body: { error: "chapter_not_found", message: "章节不存在", total, index } };

  const local = !book.source_id;
  let result = await loadChapterBody(db, book, chapter);
  if (!local && !result.failed && result.content.trim().length < 260 && result.images.length === 0) {
    // A short body may be a cache entry written by an older, single-paragraph extractor.
    // Drop it and retry the current source before giving up on it.
    db.prepare("DELETE FROM chapter_contents WHERE chapter_id = ?").run(chapter.id);
    result = await loadChapterBody(db, book, chapter);
  }
  if (result.login) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "login_required",
        message: result.failed,
        chapter: { id: chapter.id, idx: chapter.idx, title: chapter.title },
        total,
        index,
      },
    };
  }
  if (result.vip) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "vip_required",
        message: result.failed,
        chapter: { id: chapter.id, idx: chapter.idx, title: chapter.title },
        total,
        index,
      },
    };
  }
  let autoSwitch: AutoSwitchOutcome | null = null;
  // 有插图的短章不按广告页处理：图片本身就是正文的一部分，删缓存重取只会白费一次请求。
  const tooShort = result.content.trim().length < 260 && result.images.length === 0;
  if (!local && !chapter.is_vip && Number(book.auto_switched) === 0 && (tooShort || result.failed)) {
    autoSwitch = await autoSwitchBook(
      book as unknown as Parameters<typeof autoSwitchBook>[0],
      index,
      String(chapter.title ?? ""),
      result.content.trim().length,
      total,
    );
    if (autoSwitch.switched || autoSwitch.reason === "already_switched") {
      // 换源可能已被同一本书的另一个预取请求完成；按库里的新书源重取这一章，避免预取报 502。
      const fresh = getBook(bookId) as BookRow;
      const sourceChanged =
        fresh &&
        (Number(fresh.source_id ?? 0) !== Number(book.source_id ?? 0) ||
          String(fresh.book_url ?? "") !== String(book.book_url ?? ""));
      if (sourceChanged) {
        book = fresh;
        total = countChapters(bookId);
        if (total > 0 && index >= total) index = total - 1;
        const swapped = db.prepare("SELECT * FROM chapters WHERE book_id = ? AND idx = ?").get(bookId, index) as Record<string, unknown> | undefined;
        if (swapped) {
          chapter = swapped;
          result = await loadChapterBody(db, book, chapter);
        }
      }
    }
  }
  if (!result.content && result.failed) {
    return {
      ok: false,
      status: 502,
      body: {
        error: "content_failed",
        message: result.failed,
        chapter: { id: chapter.id, idx: chapter.idx, title: chapter.title },
        total,
        index,
        autoSwitch,
      },
    };
  }
  return {
    ok: true,
    payload: {
      chapter: { id: Number(chapter.id), idx: Number(chapter.idx), title: String(chapter.title ?? ""), url: String(chapter.url ?? "") },
      content: result.content,
      images: result.images,
      total,
      index,
      autoSwitch,
      quality: assessContentQuality(result.content),
    },
  };
}
