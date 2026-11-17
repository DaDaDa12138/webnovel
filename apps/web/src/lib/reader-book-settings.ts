import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  type ReaderSettings,
} from "./reader-settings";

/**
 * 按书覆盖只允许排版项：主题、翻页、朗读、热区这些是阅读习惯，
 * 如果也跟着书走，换一本书突然变成翻页模式，比不生效更让人意外。
 */
export const BOOK_TYPOGRAPHY_KEYS = [
  "fontFamily",
  "customFont",
  "fontSize",
  "lineHeight",
  "paraSpacing",
  "letterSpacing",
  "pageWidth",
  "pageMargin",
  "indent",
  "justify",
  "paragraph",
] as const;

export type BookTypographyKey = (typeof BOOK_TYPOGRAPHY_KEYS)[number];
export type BookTypographyOverride = Partial<Pick<ReaderSettings, BookTypographyKey>>;

export const BOOK_TYPOGRAPHY_STORAGE_KEY = "legado-reader-book-settings";
const STORE_VERSION = 1;

interface BookTypographyStore {
  version: number;
  books: Record<string, BookTypographyOverride>;
}

function bookKey(bookId: number): string {
  return String(Math.trunc(bookId));
}

function isKey(key: string): key is BookTypographyKey {
  return (BOOK_TYPOGRAPHY_KEYS as readonly string[]).includes(key);
}

/** 只挑出属于「本书排版」的字段；patch 里混入主题等字段时它们会走全局。 */
export function pickBookTypography(patch: Partial<ReaderSettings>): BookTypographyOverride {
  const out: BookTypographyOverride = {};
  for (const key of BOOK_TYPOGRAPHY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];
    if (value === undefined) continue;
    if (key === "paragraph") {
      out.paragraph = { ...(value as ReaderSettings["paragraph"]) };
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** 空 patch 不算按书排版；只要有一个非排版字段，就应该整包按全局处理。 */
export function isBookTypographyPatch(patch: Partial<ReaderSettings>): boolean {
  const keys = Object.keys(patch).filter((key) => patch[key as keyof ReaderSettings] !== undefined);
  return keys.length > 0 && keys.every(isKey);
}

/**
 * 存进来的旧数据可能来自手改 localStorage。用完整的 normalize 过一遍，
 * 但只保留原本存在的键——否则一条 fontSize 覆盖会把其余排版项钉死在默认值。
 */
export function normalizeBookTypography(input: unknown): BookTypographyOverride {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const normalized = normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...(src as Partial<ReaderSettings>) });
  const out: BookTypographyOverride = {};
  for (const key of BOOK_TYPOGRAPHY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    if (key === "paragraph") out.paragraph = { ...normalized.paragraph };
    else (out as Record<string, unknown>)[key] = normalized[key];
  }
  return out;
}

function emptyStore(): BookTypographyStore {
  return { version: STORE_VERSION, books: {} };
}

function readStore(): BookTypographyStore {
  try {
    if (typeof localStorage === "undefined") return emptyStore();
    const raw = localStorage.getItem(BOOK_TYPOGRAPHY_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<BookTypographyStore> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.books || typeof parsed.books !== "object") return emptyStore();
    return { version: STORE_VERSION, books: parsed.books as Record<string, BookTypographyOverride> };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: BookTypographyStore): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(BOOK_TYPOGRAPHY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 隐私模式或配额满：按书设置降级为本次会话内生效 */
  }
}

export function loadBookTypography(bookId: number): BookTypographyOverride {
  if (!Number.isFinite(bookId) || bookId <= 0) return {};
  return normalizeBookTypography(readStore().books[bookKey(bookId)]);
}

export function saveBookTypography(bookId: number, override: BookTypographyOverride): void {
  if (!Number.isFinite(bookId) || bookId <= 0) return;
  const store = readStore();
  const clean = normalizeBookTypography(override);
  if (Object.keys(clean).length) store.books[bookKey(bookId)] = clean;
  else delete store.books[bookKey(bookId)];
  writeStore(store);
}

export function clearBookTypography(bookId: number): void {
  if (!Number.isFinite(bookId) || bookId <= 0) return;
  const store = readStore();
  if (!(bookKey(bookId) in store.books)) return;
  delete store.books[bookKey(bookId)];
  writeStore(store);
}

/** 全局设置 + 本书覆盖 = 当前实际排版。段落对象要逐字段合并，不能整块替换。 */
export function applyBookTypography(base: ReaderSettings, override: BookTypographyOverride): ReaderSettings {
  const paragraph = override.paragraph ? { ...base.paragraph, ...override.paragraph } : base.paragraph;
  return normalizeReaderSettings({ ...base, ...override, paragraph });
}
