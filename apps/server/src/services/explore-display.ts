import type { ExploreBookDisplay, SearchBook } from "@legado/shared";

/**
 * 发现页的展示清洗层。
 *
 * 书源规则不是为「发现页卡片」设计的：同一个 kind 字段可能是四行「评分/分类/状态/日期」，
 * wordCount 可能是 27030426，也可能是「15.82 万字」；更常见的是作者、状态、字数、最新章节
 * 整组错位。这里只做**展示用**的保守清洗，不改动书籍身份字段以外的搜索/换源数据。
 *
 * 原则：能从标签或格式确定含义的才重排；不能确定的宁可留空，不猜。
 */

const STATUS_RE = /^(已完结|完结|完本|已完成|连载中|连载|更新中|暂停更新|暂停|断更)$/;
const RATING_RE = /(\d+(?:\.\d+)?)\s*分$/;
const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const CHAPTER_RE = /^(第[0-9零一二三四五六七八九十百千万两]+[章节回卷]|最新章节|正文)/;
const LABEL_AUTHOR_RE = /^作者\s*[:：]\s*/;
const LABEL_WORD_RE = /^字数\s*[:：]\s*/;
const LABEL_STATUS_RE = /^状态\s*[:：]\s*/;
const LABEL_LAST_RE = /^(?:最新(?:章节|章)?|最新章节|正文|章节)\s*[:：]\s*/;
const CATEGORY_SPLIT_RE = /[·•/、|｜]+/;

function text(value: unknown): string {
  return String(value ?? "").replace(/ /g, " ").trim();
}

function squeeze(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseDate(raw: string): string {
  const m = raw.trim().match(DATE_RE);
  if (!m) return "";
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return m[1] + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function normalizeStatus(raw: string): string {
  const value = raw.replace(LABEL_STATUS_RE, "").trim();
  if (!STATUS_RE.test(value)) return "";
  if (value === "已完结" || value === "完结" || value === "完本" || value === "已完成") return "已完结";
  if (value === "连载中" || value === "连载" || value === "更新中") return "连载中";
  if (value === "暂停" || value === "暂停更新" || value === "断更") return "暂停";
  return "";
}

function parseWordCount(raw: string): number | null {
  if (!raw) return null;
  const value = raw.replace(LABEL_WORD_RE, "").replace(/[,，\s]/g, "");
  if (!value) return null;
  // 纯数字：书源直接给字数（27030426），但如果是日期就绝对不能当字数。
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    if (DATE_RE.test(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 100 ? Math.round(n) : null;
  }
  const m = value.match(/^(\d+(?:\.\d+)?)(亿|万)字?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * (m[2] === "亿" ? 100000000 : 10000));
}

function formatWordCount(value: number | null): string {
  if (!value) return "";
  if (value >= 100000000) {
    const n = value / 100000000;
    return (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "")) + "亿字";
  }
  if (value >= 10000) {
    const n = value / 10000;
    return (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "")) + "万字";
  }
  return value + "字";
}

function addCategory(list: string[], raw: string): void {
  const value = raw
    .replace(/^(?:类别|分类|类型|题材|标签|频道)\s*[:：]\s*/, "")
    .replace(/[\s]+$/, "")
    .trim();
  if (!value || value.length > 24) return;
  if (RATING_RE.test(value) || DATE_RE.test(value) || STATUS_RE.test(value)) return;
  if (/^(小说|图书|书籍|作品|其他|全部)$/.test(value)) return;
  if (!list.includes(value)) list.push(value);
}

type KindParts = { categories: string[]; status: string; rating: number | null; updatedAt: string };

function parseKind(raw: string): KindParts {
  const out: KindParts = { categories: [], status: "", rating: null, updatedAt: "" };
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const rating = line.match(RATING_RE);
    if (rating) {
      const value = Number(rating[1]);
      if (Number.isFinite(value) && value > 0 && value <= 10) out.rating = value;
      continue;
    }
    const date = parseDate(line);
    if (date) {
      out.updatedAt = out.updatedAt || date;
      continue;
    }
    const status = normalizeStatus(line);
    if (status) {
      out.status = out.status || status;
      continue;
    }
    const pieces = line.split(CATEGORY_SPLIT_RE);
    for (const piece of pieces) addCategory(out.categories, piece);
  }
  return out;
}

function cleanAuthor(raw: string, name: string, chapterCandidate: string): string {
  let value = raw.replace(LABEL_AUTHOR_RE, "").trim();
  if (!value) return "";
  if (value === name || value === chapterCandidate) return "";
  if (CHAPTER_RE.test(value)) return "";
  if (/^(佚名|未知|不详|无|暂无)$/.test(value)) return "";
  if (value.length > 30) return "";
  value = squeeze(value);
  return value;
}

function cleanLastChapter(raw: string, name: string): string {
  let value = raw.replace(LABEL_LAST_RE, "").trim();
  if (!value) return "";
  if (value === name) return "";
  if (/^(作者|字数|状态)\s*[:：]/.test(value)) return "";
  if (parseDate(value)) return "";
  if (LABEL_WORD_RE.test(raw) || LABEL_AUTHOR_RE.test(raw) || LABEL_STATUS_RE.test(raw)) return "";
  if (value.length > 80) value = value.slice(0, 80);
  return squeeze(value);
}

function cleanIntro(raw: string, name: string): string {
  let value = raw.replace(/\s+/g, " ").trim();
  if (!value) return "";
  value = value.replace(/^(?:内容)?简介\s*[:：]\s*/, "");
  value = value.replace(/^(?:[“"『「'])(.*)(?:[”"』」'])$/, "$1").trim();
  value = value.replace(/\s*(?:展开全部|收起)$/, "").trim();
  if (!value || value === name) return "";
  return value.length > 260 ? value.slice(0, 260) + "…" : value;
}

export function normalizeExploreDisplay(book: SearchBook): ExploreBookDisplay {
  const name = text(book.name);
  const rawAuthor = text(book.author);
  const rawLast = text(book.lastChapter);
  const rawWord = text(book.wordCount);
  const rawKind = text(book.kind);
  const kind = parseKind(rawKind);

  // ---- 显式标签优先：作者 / 状态 / 字数 / 最新 被书源规则排到别的列时，
  // 按「作者：」「状态：」「字数：」这些前缀把它们送回正确字段。
  let author = rawAuthor;
  let last = rawLast;
  let word = rawWord;
  let status = kind.status;
  // 先记住原始作者列是不是章节名：下面可能用 wordCount 里的「作者：」覆盖 author。
  let lastFromAuthor = CHAPTER_RE.test(rawAuthor) && !LABEL_AUTHOR_RE.test(rawAuthor) ? rawAuthor : "";

  if (LABEL_AUTHOR_RE.test(word)) {
    author = word.replace(LABEL_AUTHOR_RE, "");
    word = "";
  } else if (LABEL_AUTHOR_RE.test(last)) {
    author = last.replace(LABEL_AUTHOR_RE, "");
    last = "";
  }
  if (LABEL_WORD_RE.test(last)) {
    word = last.replace(LABEL_WORD_RE, "");
    last = "";
  } else if (LABEL_WORD_RE.test(rawKind)) {
    // 少数规则把「字数：」整行塞进 kind；parseKind 会把标签行当分类，这里兜底回字数。
    word = rawKind.replace(LABEL_WORD_RE, "");
  }
  if (LABEL_STATUS_RE.test(rawKind)) status = normalizeStatus(rawKind);
  if (LABEL_STATUS_RE.test(last)) {
    status = status || normalizeStatus(last);
    last = "";
  }
  if (LABEL_STATUS_RE.test(word)) {
    status = status || normalizeStatus(word);
    word = "";
  }
  if (LABEL_LAST_RE.test(author)) {
    lastFromAuthor = author.replace(LABEL_LAST_RE, "");
    author = "";
  } else if (CHAPTER_RE.test(author) && author === rawAuthor && !LABEL_AUTHOR_RE.test(rawAuthor)) {
    // 没有「作者：」标签但作者列是章节名：这是源 6 那一类错位，只有同时存在
    // 「字数：」「作者：」标签时才敢认，下面统一由 labelledShift 判断。
    lastFromAuthor = author;
    author = "";
  }

  const labelledShift = LABEL_WORD_RE.test(rawLast) || LABEL_AUTHOR_RE.test(rawWord) || LABEL_STATUS_RE.test(rawKind);
  if (!labelledShift && lastFromAuthor) {
    // 标签不完整时，光是「作者列像章节名」不足以证明它是最新章节；宁可丢掉。
    lastFromAuthor = "";
    author = rawAuthor;
  }
  let updatedAt = kind.updatedAt;
  for (const candidate of [rawAuthor, rawLast, rawWord]) {
    const date = parseDate(candidate.trim());
    if (date) updatedAt = updatedAt || date;
  }

  const cleanName = squeeze(name);
  let cleanAuthorValue = cleanAuthor(author, cleanName, lastFromAuthor);
  if (!cleanAuthorValue && labelledShift && LABEL_AUTHOR_RE.test(rawWord)) cleanAuthorValue = squeeze(rawWord.replace(LABEL_AUTHOR_RE, ""));
  const cleanLast = cleanLastChapter(lastFromAuthor || last, cleanName);
  const wordCount = parseWordCount(word);
  const categories = kind.categories.slice(0, 4);
  const intro = cleanIntro(text(book.intro), cleanName);

  const signals = [cleanAuthorValue, categories.length > 0, Boolean(status), Boolean(wordCount), Boolean(updatedAt), Boolean(cleanLast)].filter(Boolean).length;
  const completeness: ExploreBookDisplay["completeness"] = signals >= 5 ? "rich" : signals >= 2 ? "partial" : "minimal";

  return {
    author: cleanAuthorValue,
    categories,
    status,
    rating: kind.rating,
    wordCount,
    wordCountText: formatWordCount(wordCount),
    updatedAt,
    lastChapter: cleanLast,
    intro,
    completeness,
  };
}

/** 给接口返回的每一本发现书补上展示清洗结果；原字段保持原样。 */
export function withExploreDisplay(book: SearchBook): SearchBook & { display: ExploreBookDisplay } {
  return { ...book, display: normalizeExploreDisplay(book) };
}
