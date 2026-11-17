import type { Chapter } from "./types.js";

/**
 * 目录（TOC）归一化。
 *
 * 站点目录页的顺序并不统一：起点/云起这类站点把最新章排在最前（倒序），
 * 大部分盗版站是正序。Legado 保存的是「页面顺序」，所以倒序站的目录在
 * 书架里会从最新章节开始，用户永远找不到第 1 章。这里在引擎出口做一次
 * 归一化：识别倒序并翻转，同时清掉标题里混入的垃圾（更新时间、APP免费…）。
 */

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 一百二十三 → 123；十二 → 12；两千 → 2000。无法解析返回 null。 */
export function cnToNumber(text: string): number | null {
  if (!text) return null;
  let total = 0;
  let section = 0;
  let digit = -1;
  let touched = false;
  for (const char of text) {
    if (char === "万" || char === "萬") {
      section += digit > 0 ? digit : 0;
      total += (section || 1) * 10000;
      section = 0;
      digit = -1;
      touched = true;
      continue;
    }
    const d = CN_DIGITS[char];
    if (d !== undefined) {
      digit = d;
      touched = true;
      continue;
    }
    const unit = CN_UNITS[char];
    if (unit !== undefined) {
      section += (digit < 0 ? 1 : digit) * unit;
      digit = -1;
      touched = true;
      continue;
    }
    return null;
  }
  if (!touched) return null;
  return total + section + (digit > 0 ? digit : 0);
}

const CN_NUMERAL = "零〇一二三四五六七八九十百千万两";

/** 从章节标题里抽出章号，用于判断顺序。抽不到返回 null。 */
export function chapterOrdinal(title: string): number | null {
  const text = title
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const arabic = /第\s*(\d{1,6})\s*[章节節回話话集卷篇]/.exec(text);
  if (arabic) return Number.parseInt(arabic[1], 10);

  const cn = new RegExp(`第\\s*([${CN_NUMERAL}]{1,12})\\s*[章节節回話话集卷篇]`).exec(text);
  if (cn) {
    const value = cnToNumber(cn[1]);
    if (value !== null && value > 0) return value;
  }

  // 「1. 疯狂年代」「12、xxx」「(3) xxx」「2045」这类没有「第…章」的编号
  const prefixed = /^\s*[（(【\[]?\s*(\d{1,6})\s*[)）】\]]?\s*[.、,，:：·\-_\s]/.exec(text);
  if (prefixed) return Number.parseInt(prefixed[1], 10);
  const bare = /^\s*[（(【\[]?\s*(\d{1,6})\s*[)）】\]]?\s*$/.exec(text);
  if (bare) return Number.parseInt(bare[1], 10);

  return null;
}

const NAV_TITLES = new Set([
  "目录", "章节目录", "返回目录", "上一页", "下一页", "上一章", "下一章", "首页", "尾页",
  "加入书架", "投推荐票", "投票", "推荐本书", "最新章节", "查看全部", "展开全部", "返回",
]);

const NOISE_PATTERNS: Array<[RegExp, string]> = [
  // 更新时间：2026-10-31 10:01:00 / 更新：10-31 10:01
  [/[（(\[【]?\s*更新(?:时间|日期)?\s*[:：]?\s*\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*[)）\]】]?/g, " "],
  [/[（(\[【]?\s*更新(?:时间|日期)?\s*[:：]?\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*[)）\]】]?/g, " "],
  // APP免费 / 免费阅读 / 手机阅读
  [/[（(\[【]?\s*APP\s*免费(?:阅读)?\s*[)）\]】]?/gi, " "],
  [/[（(\[【]?\s*(?:手机|电脑|wap)?\s*免费阅读\s*[)）\]】]?/gi, " "],
  // 章节尾巴上的口号
  [/[（(\[【]?\s*(?:本章完|未完待续|求月票|求推荐票|求订阅|求收藏|请收藏|请记住本站|首发|全文免费阅读)\s*[)）\]】]?/g, " "],
  [/^正文\s*[卷]?\s*/, ""],
];

/** 去掉标题里的站内噪音，保留章号与正文标题。 */
export function cleanChapterTitle(title: string): string {
  let text = String(title ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return text;
  for (const [pattern, replacement] of NOISE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s{2,}/g, " ").trim();
  text = text.replace(/^[\s|\-_·]+|[\s|\-_·]+$/g, "").trim();
  return text || String(title ?? "").trim();
}

/** 中文阅读习惯的「字数」：去掉空白后按码点计数（`length` 会把 emoji/生僻字算两个）。 */
export function countContentChars(text: string): number {
  return Array.from(String(text ?? "").replace(/\s+/g, "")).length;
}

/** 「第2章」「第十二回」「1.」这类章号前缀，比较书名时先剥掉。 */
const ORDINAL_PREFIX = /^第\s*(?:\d{1,6}|[零〇一二三四五六七八九十百千万两]{1,12})\s*[章节節回話话集卷篇]\s*[:：.、,，\-—·]?\s*/;
const NUMBER_PREFIX = /^\s*[（(【\[]?\s*\d{1,6}\s*[)）】\]]?\s*[.、,，:：·\-_\s]\s*/;
/** 结尾括注：「（求月票）」「(本章完)」「【加更】」。 */
const TRAILING_PAREN = /[（(【\[][^）)】\]]{0,24}[）)】\]]\s*$/;

/**
 * 章节名的比较键：先清站内噪音，再剥掉「第 N 章」前缀与结尾括注，最后去掉标点空白。
 * 剥前缀是因为同一章在不同源里可能写成「第2章 木叶宏伟新政」或「木叶宏伟新政」，
 * 甚至章号完全错位（盗版站少章/多章/分卷重复编号）。
 */
function coreKey(title: string, stripTrailingParen = false): string {
  let text = cleanChapterTitle(String(title ?? ""));
  text = text.replace(ORDINAL_PREFIX, "").replace(NUMBER_PREFIX, "").trim();
  if (stripTrailingParen) text = text.replace(TRAILING_PAREN, "").trim();
  return normalizeKey(text) || normalizeKey(cleanChapterTitle(String(title ?? "")));
}

/** 两个「比较键」的字符二元组 Dice 相似度。 */
function diceOnKeys(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (text: string): string[] => {
    if (text.length < 2) return [text];
    const out: string[] = [];
    for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.length || !gb.length) return 0;
  const counts = new Map<string, number>();
  for (const gram of ga) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of gb) {
    const left = counts.get(gram) ?? 0;
    if (left > 0) {
      overlap += 1;
      counts.set(gram, left - 1);
    }
  }
  return (2 * overlap) / (ga.length + gb.length);
}

/** 两个章节标题的相似度（0–1）：剥掉章号与结尾括注后比较，中文短标题用二元组比编辑距离稳。 */
export function titleSimilarity(left: string, right: string): number {
  return diceOnKeys(coreKey(left), coreKey(right));
}

export interface ChapterMatch {
  /** 命中项在传入数组里的下标。 */
  index: number;
  /** 0–1 的匹配可信度；0 表示没有任何章节名证据，只是按位置猜的。 */
  score: number;
  reason: "exact" | "core" | "cleaned" | "similar" | "ordinal" | "index";
}

/**
 * 在候选目录里找「当前这一章」。**章节名是主证据，章号只是兜底**：
 * 盗版站的目录经常错乱（少章、多章、分卷重复编号、把最新章节置顶），
 * 按章号去匹配会稳定地落到相邻的一章上，而章节名基本不会变。
 *
 * 打分从高到低：原文相同 1.0 → 剥掉章号后相同 0.96 → 再去掉结尾括注后相同 0.88
 * → 二元组相似度 ≥0.72 时 0.85×相似度 → 只有章号相同 0.3。
 * 只有名字完全不像、但章号相同（0.3）时也算命中——那种书通常是整章改名，
 * 同章号仍比同位置更接近。连章号都没有才退回同一位置（reason=index），
 * 让调用方能如实告诉用户「这次没匹配上，是按位置接续的」。
 *
 * previousTotal 是**旧目录的章数**。给了它，位置兜底就按比例缩放
 * （旧第 100 章 / 旧 884 章 → 新 837 章的 95 章），而不是硬取第 100 章：
 * 换源时两边目录常差几十章（少了广告章/分卷章），硬取同下标会稳定漂移，
 * 读者换完源发现自己在几章之前——这是「换源体验差」里最常见的一条。
 */
export function matchChapter(
  list: Array<{ title: string }>,
  wantedTitle: string,
  fallback: number,
  previousTotal = 0,
): ChapterMatch {
  const items = Array.isArray(list) ? list : [];
  const guess = Number.isFinite(fallback) ? Math.trunc(fallback) : 0;
  const clamped = Math.max(0, Math.min(Math.max(0, items.length - 1), guess));
  if (!items.length) return { index: 0, score: 0, reason: "index" };
  const total = Math.trunc(Number(previousTotal));
  // 比例锚点：只有旧章数 > 0 且和新目录不同才值得换算，否则等价于硬取同下标。
  const anchor =
    Number.isFinite(total) && total > 0 && total !== items.length
      ? Math.max(0, Math.min(items.length - 1, Math.round((guess * items.length) / total)))
      : clamped;
  const wanted = String(wantedTitle ?? "").trim();
  if (!wanted) return { index: anchor, score: 0, reason: "index" };

  const wantedRaw = normalizeKey(cleanChapterTitle(wanted));
  const wantedCore = coreKey(wanted);
  const wantedFlat = coreKey(wanted, true);
  const wantedOrdinal = chapterOrdinal(wanted);

  let bestIndex = -1;
  let bestScore = 0;
  let bestReason: ChapterMatch["reason"] = "index";
  items.forEach((row, index) => {
    const title = String(row?.title ?? "");
    const raw = normalizeKey(cleanChapterTitle(title));
    const core = coreKey(title);
    const flat = coreKey(title, true);
    const ordinalHit = wantedOrdinal != null && chapterOrdinal(title) === wantedOrdinal;

    let score = 0;
    let reason: ChapterMatch["reason"] = "index";
    if (raw && raw === wantedRaw) {
      score = 1;
      reason = "exact";
    } else if (core && core === wantedCore) {
      score = 0.96;
      reason = "core";
    } else if (flat && flat === wantedFlat) {
      score = 0.88;
      reason = "cleaned";
    } else {
      const similarity = Math.max(diceOnKeys(wantedCore, core), diceOnKeys(wantedFlat, flat));
      if (similarity >= 0.72) {
        score = 0.85 * similarity;
        reason = "similar";
      } else if (ordinalHit) {
        score = 0.3;
        reason = "ordinal";
      }
    }
    // 章号一致只作为加分项：名字像、章号也对，比只有名字像更可信。
    if (ordinalHit && score > 0 && score < 1) score = Math.min(1, score + 0.03);

    // 同分时取离「按位置猜的那一章」最近的一个：同名章节（分卷重复、上下册）不往远处跳。
    const better =
      score > bestScore + 1e-6 ||
      (Math.abs(score - bestScore) <= 1e-6 && Math.abs(index - anchor) < Math.abs(bestIndex - anchor));
    if (better && score > 0) {
      bestIndex = index;
      bestScore = score;
      bestReason = reason;
    }
  });

  if (bestIndex < 0 || bestScore < 0.3 - 1e-6) return { index: anchor, score: 0, reason: "index" };
  return { index: bestIndex, score: bestScore, reason: bestReason };
}

/** 只要下标的老接口（保留给不关心匹配理由的调用方）。 */
export function locateChapterIndex(list: Array<{ title: string }>, wantedTitle: string, fallback: number): number {
  return matchChapter(list, wantedTitle, fallback).index;
}

function normalizeKey(text: string): string {
  return String(text ?? "")
    .replace(/[\s《》「」【】\[\]（）()·,.，。:：!！?？~～\-_—]/g, "")
    .toLowerCase();
}

/** 目录里混进来的导航项（书名本身、目录、上一页…）不是章节。 */
export function isNavEntry(chapter: Pick<Chapter, "title" | "url">, bookName: string | undefined): boolean {
  const title = chapter.title.trim();
  if (!title) return true;
  if (NAV_TITLES.has(title)) return true;
  // 91 飞卢、82 笔趣阁的目录规则会把站点头部导航一起收进来：
  // 「同人小说网 / 男生小说 / 在线书库 / ↓↓↓ 直达页面底部」。
  // 这些条目排在第一章之前，体检只取第一条时正文就抓到首页。
  const url = String(chapter.url ?? "");
  if (/#(?:footer|top|bottom)$/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === "/") return true;
  } catch {
    /* 相对 URL 或 javascript:，交给后面的标题判断 */
  }
  if (title.length <= 12 && /(首页|目录|书架|书库|登录|注册|排行|推荐|投票|下载|APP|手机版|电脑版|顶部|底部|返回|展开|查看全部|直达页面|最新章节|男生小说|女生小说|同人小说网)/i.test(title)) {
    return true;
  }
  // 91 飞卢把作者公告放在目录第一条（「爆燃新篇…跪求订阅」），没有章号；
  // 体检取第一条时正文只有 93 字，被误判成空正文。
  if (chapterOrdinal(title) === null && /(求订阅|求月票|求推荐|跪求|上架感言|完本感言|新书感言|请假|公告|通知|必看|作品相关|加更|爆燃新篇|新篇开启)/.test(title)) {
    return true;
  }
  if (bookName) {
    const key = normalizeKey(title);
    if (key && key === normalizeKey(bookName)) return true;
  }
  return false;
}

function urlId(url: string): number | null {
  const matches = String(url ?? "").match(/\d{2,7}/g);
  if (!matches || !matches.length) return null;
  const value = Number.parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(value) ? value : null;
}

interface Trend {
  up: number;
  down: number;
  samples: number;
}

function trendOf(values: Array<number | null>): Trend {
  const trend: Trend = { up: 0, down: 0, samples: 0 };
  let previous: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (previous !== null) {
      if (value > previous) trend.up += 1;
      else if (value < previous) trend.down += 1;
      trend.samples += 1;
    }
    previous = value;
  }
  return trend;
}

/**
 * 判断目录是否为「最新章节在前」。章号是主信号，章号抽不出来时退回 URL 里的数字。
 * 只在信号足够强（绝大多数相邻对都在下降）时才翻转，避免把正序目录搞反。
 */
export function isDescendingToc(chapters: Chapter[]): boolean {
  if (chapters.length < 3) return false;
  const ordinals = trendOf(chapters.map((chapter) => chapterOrdinal(chapter.title)));
  const decisive = (trend: Trend): boolean => trend.samples >= 3 && trend.down / trend.samples >= 0.75 && trend.up / trend.samples <= 0.15;
  if (ordinals.samples >= 3) return decisive(ordinals);
  return decisive(trendOf(chapters.map((chapter) => urlId(chapter.url))));
}

export interface NormalizeTocResult {
  chapters: Chapter[];
  /** 整表翻转（源站纯倒序）。 */
  reversed: boolean;
  /** 按章号重排（倒序、头部「最新章节」预览块、乱序都能一次摆正）。 */
  sorted: boolean;
  removed: number;
  renamed: number;
}

/**
 * 给每一章算一个可排序的键。没有章号的条目（序章、番外）跟着前一个已知章号走，
 * 避免被甩到目录末尾。
 */
function sortKeys(chapters: Chapter[]): number[] {
  let last = 0;
  return chapters.map((chapter) => {
    const ordinal = chapterOrdinal(chapter.title);
    if (ordinal === null) return last + 0.5;
    last = ordinal;
    return ordinal;
  });
}

/**
 * 章号基本唯一时（>=98% 不重复、>=90% 能解析），直接稳定排序最稳：
 * 有的站点把「最新章节」三章置顶（1372,1371,1370 然后 1,2,3…），只翻转是治不好的。
 * 多卷书会出现「第1章」重复，此时退回保守的翻转判断。
 */
function canSortByOrdinal(chapters: Chapter[]): boolean {
  if (chapters.length < 5) return false;
  // 分卷书的「第一卷」与「第1章」章号相同，按章号排序会把正文卷序打乱。
  if (chapters.some((chapter) => chapter.isVolume)) return false;
  const ordinals = chapters.map((chapter) => chapterOrdinal(chapter.title));
  const known = ordinals.filter((value): value is number => value !== null);
  if (known.length / chapters.length < 0.9) return false;
  return new Set(known).size / known.length >= 0.98;
}

/** 清洗标题 → 去掉导航项 → 重排成「第 1 章在前」的正序。 */
export function normalizeToc(chapters: Chapter[], bookName?: string): NormalizeTocResult {
  let renamed = 0;
  const cleaned: Chapter[] = [];
  for (const chapter of chapters) {
    const title = cleanChapterTitle(chapter.title);
    if (title !== chapter.title) renamed += 1;
    cleaned.push({ ...chapter, title });
  }
  const kept = cleaned.filter((chapter) => !isNavEntry(chapter, bookName));

  if (canSortByOrdinal(kept)) {
    const keys = sortKeys(kept);
    const order = kept.map((_, index) => index);
    order.sort((a, b) => keys[a] - keys[b] || a - b);
    const sorted = order.map((index) => kept[index]);
    const changed = sorted.some((chapter, index) => chapter !== kept[index]);
    return { chapters: changed ? sorted : kept, reversed: false, sorted: changed, removed: chapters.length - kept.length, renamed };
  }

  const reversed = isDescendingToc(kept);
  return {
    chapters: reversed ? kept.slice().reverse() : kept,
    reversed,
    sorted: false,
    removed: chapters.length - kept.length,
    renamed,
  };
}
