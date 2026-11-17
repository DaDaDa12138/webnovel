import type { BlockKind } from "./reader-blocks";

/** 手动纠正只开放三种最常用的结构：正文、作者话、小标题。 */
export type ParagraphFixKind = Extract<BlockKind, "text" | "note" | "subhead">;

export interface ParagraphFix {
  /** 纠正时的章号；换源后章号可能变化，所以同时存章名做兜底。 */
  chapterIndex: number;
  chapterTitle: string;
  /** 原文段落文本，用来在重建展示块时重新认回这一段。 */
  text: string;
  kind: ParagraphFixKind;
  /** 纠正时的段落下标；同一章里重复出现的短句靠它区分。 */
  para?: number;
}

const STORAGE_KEY = "legado-reader-paragraph-fixes";
const STORE_VERSION = 1;
const MAX_FIXES_PER_BOOK = 500;
const KINDS: ParagraphFixKind[] = ["text", "note", "subhead"];

interface ParagraphFixStore {
  version: number;
  books: Record<string, ParagraphFix[]>;
}

function bookKey(bookId: number): string {
  return String(Math.trunc(bookId));
}

function normalizeTitle(value: string): string {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function cleanFix(input: unknown): ParagraphFix | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const src = input as Partial<ParagraphFix>;
  const text = typeof src.text === "string" ? src.text : "";
  const kind = KINDS.includes(src.kind as ParagraphFixKind) ? (src.kind as ParagraphFixKind) : null;
  if (!text.trim() || !kind) return null;
  const para = Number(src.para);
  return {
    chapterIndex: Number.isFinite(Number(src.chapterIndex)) ? Math.max(0, Math.trunc(Number(src.chapterIndex))) : 0,
    chapterTitle: typeof src.chapterTitle === "string" ? src.chapterTitle : "",
    text,
    kind,
    ...(Number.isFinite(para) && para >= 0 ? { para: Math.trunc(para) } : {}),
  };
}

function emptyStore(): ParagraphFixStore {
  return { version: STORE_VERSION, books: {} };
}

function readStore(): ParagraphFixStore {
  try {
    if (typeof localStorage === "undefined") return emptyStore();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ParagraphFixStore> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.books || typeof parsed.books !== "object") return emptyStore();
    return { version: STORE_VERSION, books: parsed.books as Record<string, ParagraphFix[]> };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: ParagraphFixStore): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 隐私模式或配额满：纠正降级为本次会话内生效 */
  }
}

function normalizeList(value: unknown): ParagraphFix[] {
  if (!Array.isArray(value)) return [];
  const out: ParagraphFix[] = [];
  for (const item of value) {
    const fix = cleanFix(item);
    if (fix) out.push(fix);
  }
  return out.slice(-MAX_FIXES_PER_BOOK);
}

export function loadParagraphFixes(bookId: number): ParagraphFix[] {
  if (!Number.isFinite(bookId) || bookId <= 0) return [];
  return normalizeList(readStore().books[bookKey(bookId)]);
}

/** 同一章同一段只保留一条纠正；再次选择等于覆盖。 */
export function saveParagraphFix(bookId: number, fix: ParagraphFix): ParagraphFix[] {
  if (!Number.isFinite(bookId) || bookId <= 0) return [];
  const clean = cleanFix(fix);
  if (!clean) return loadParagraphFixes(bookId);
  const store = readStore();
  const key = bookKey(bookId);
  const list = normalizeList(store.books[key]).filter(
    (item) =>
      !(
        item.chapterIndex === clean.chapterIndex &&
        (item.text === clean.text || (clean.para !== undefined && item.para === clean.para))
      ),
  );
  list.push(clean);
  store.books[key] = list.slice(-MAX_FIXES_PER_BOOK);
  writeStore(store);
  return store.books[key];
}

export function removeParagraphFix(bookId: number, chapterIndex: number, text: string, para?: number): ParagraphFix[] {
  if (!Number.isFinite(bookId) || bookId <= 0) return [];
  const store = readStore();
  const key = bookKey(bookId);
  const list = normalizeList(store.books[key]).filter(
    (item) =>
      !(
        item.chapterIndex === chapterIndex &&
        (item.text === text || (para !== undefined && item.para === para))
      ),
  );
  if (list.length) store.books[key] = list;
  else delete store.books[key];
  writeStore(store);
  return list;
}

export function clearParagraphFixes(bookId: number): void {
  if (!Number.isFinite(bookId) || bookId <= 0) return;
  const store = readStore();
  delete store.books[bookKey(bookId)];
  writeStore(store);
}

/**
 * 把纠正落到本次加载的段落下标上。章号变了但章名和原文都没变时仍然生效，
 * 这样换源后（章节顺序可能整体平移）手工纠正不会白做。
 */
export function resolveParagraphFixes(
  fixes: ParagraphFix[],
  chapterIndex: number,
  chapterTitle: string,
  paragraphs: string[],
): Record<number, ParagraphFixKind> {
  if (!fixes.length || !paragraphs.length) return {};
  const title = normalizeTitle(chapterTitle);
  const sameChapterOrTitle = (fix: ParagraphFix) =>
    fix.chapterIndex === chapterIndex || (!!title && normalizeTitle(fix.chapterTitle) === title);
  const out: Record<number, ParagraphFixKind> = {};
  // 先按原段落下标精确认回：同一章里重复出现的短句不会一起被改。
  for (const fix of fixes) {
    if (fix.para === undefined || !sameChapterOrTitle(fix)) continue;
    if (String(paragraphs[fix.para] ?? "").trim() !== fix.text) continue;
    out[fix.para] = fix.kind;
  }
  // 换源后段落下标会漂移，再按原文兜底；同章已有下标的纠正不再参与文本兜底。
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (out[i] !== undefined) continue;
    const text = String(paragraphs[i] ?? "").trim();
    if (!text) continue;
    const hit = fixes.find((fix) => {
      if (fix.text !== text || !sameChapterOrTitle(fix)) return false;
      if (fix.chapterIndex === chapterIndex && fix.para !== undefined) return false;
      return true;
    });
    if (hit) out[i] = hit.kind;
  }
  return out;
}

export function countParagraphFixes(fixes: ParagraphFix[], chapterIndex?: number): number {
  if (chapterIndex === undefined) return fixes.length;
  return fixes.filter((fix) => fix.chapterIndex === chapterIndex).length;
}
