import { healthStateRank, isHealthUsable, type SwitchCandidate } from "@legado/shared";

/** 阅读中换源的核心诉求：别换到「少字」的源。
 *
 * 所以排序不是看目录有多少章，而是看**当前这一章**在该源实测出来的字数：
 * 字数多的排前面；还没测到的按可用性与探测速度排在后面；失败的沉底。
 */

/**
 * 「取不到正文」是确定的坏源（站点返回空壳、规则失效），「超时」只是慢。
 * 前者不该让用户白点一次，后者可以换过去试试——很多大站第一次请求慢，之后有缓存就正常了。
 */
export function measureBlocked(candidate: SwitchCandidate): boolean {
  return /empty content|正文是空的/i.test(candidate.measureError ?? "");
}

/**
 * 这一条候选有没有「对上章节名」。
 *
 * - name：测字时按章节名命中了同一章，字数可以横向比
 * - mismatch：只靠章号或位置凑出来的，量的是另一章，字数不可比（换过去也会错章）
 * - unknown：还没测到（超时/取不到正文），无法判断，不能因此判它死刑
 */
export type MatchClass = "name" | "unknown" | "mismatch";

export function matchClass(item: SwitchCandidate): MatchClass {
  if (item.matched === true) return "name";
  if (item.matched === false) return "mismatch";
  return "unknown";
}

/** 行内标签：明确告诉用户这一条是「名字对上」还是「凑出来的」。 */
export function matchLabel(item: SwitchCandidate): { text: string; tone: "ok" | "bad" } | null {
  const kind = matchClass(item);
  if (kind === "name") return { text: "章节名一致", tone: "ok" };
  if (kind === "mismatch") {
    return { text: item.matchReason === "ordinal" ? "章号相同 · 章名不同" : "没找到对应章节", tone: "bad" };
  }
  return null;
}

/** 镜像折叠的键：章数、本章字数、命中的章名、匹配档位都一样，就是同一份内容的不同域名。 */
function mirrorKey(item: SwitchCandidate): string {
  return [item.chapters, item.chars ?? 0, item.chapterTitle ?? "", matchClass(item)].join("|");
}

/** 同一个站群常有五六个域名，内容一模一样；折叠成一行，别让它们把列表刷满。 */
export function collapseMirrors(list: SwitchCandidate[]): SwitchCandidate[] {
  const groups = new Map<string, SwitchCandidate>();
  for (const item of list) {
    const key = mirrorKey(item);
    const hit = groups.get(key);
    if (hit) {
      hit.mirrors = (hit.mirrors ?? 1) + 1;
      continue;
    }
    groups.set(key, { ...item, mirrors: 1 });
  }
  return Array.from(groups.values());
}

/** 正文质量差的源排在后面：有占位/防盗内容的「更多字」没有意义。 */
function qualityRank(candidate: SwitchCandidate): number {
  return candidate.contentQuality === "ok" ? 0 : candidate.contentQuality === "suspect" ? 1 : candidate.contentQuality === "bad" ? 3 : 2;
}

function rank(candidate: SwitchCandidate, baseline = 0): number[] {
  const measured = typeof candidate.chars === "number" && candidate.chars > 0 ? 0 : 1;
  const status = candidate.status === "ok" ? 0 : candidate.status === "warn" ? 1 : candidate.status === "pending" ? 2 : 3;
  // 字数远大于当前章（默认 4 倍以上）多半是抓到了整本或目录页，不能拿它当「这个源字更多」。
  const over = isOverlongRatio(charRatio(candidate.chars, baseline)) ? 1 : 0;
  return [matchClass(candidate) === "mismatch" ? 1 : 0, over, measured, status, qualityRank(candidate), healthStateRank(candidate.sourceHealthState), -(candidate.chars ?? 0), measureBlocked(candidate) ? 1 : 0, candidate.measureMs ?? Number.MAX_SAFE_INTEGER, candidate.ms];
}

export function sortByChapterChars(list: SwitchCandidate[], baseline = 0): SwitchCandidate[] {
  return list.slice().sort((a, b) => {
    const left = rank(a, baseline);
    const right = rank(b, baseline);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  });
}

/** 找「更全的源」时的排序：先看目录章数，再看可用性与本章字数。
 *
 * 和 sortByChapterChars 的差别只在第一关键字：转载站常常是同一个 105 章版本，
 * 而正版/大站可能已经 322 章——用户要的正是这个差别，不能让「本章多 3 个字」
 * 把它盖过去。没取到目录（chapters 为 0）的沉底。
 */
export function sortByChapters(list: SwitchCandidate[], baseline = 0): SwitchCandidate[] {
  const status = (item: SwitchCandidate): number =>
    item.status === "ok" ? 0 : item.status === "warn" ? 1 : item.status === "pending" ? 2 : 3;
  const over = (item: SwitchCandidate): number => (isOverlongRatio(charRatio(item.chars, baseline)) ? 1 : 0);
  return list.slice().sort((a, b) => {
    // 同样 322 章、同样测不到字时，把「确定取不到正文」的排到「只是超时」的后面。
    // 章节名对不上的源（另一本书/错章）沉到最底：它的章数再多也不是这本书的章数。
    const left = [matchClass(a) === "mismatch" ? 1 : 0, a.chapters > 0 ? 0 : 1, -(a.chapters || 0), status(a), over(a), -(a.chars ?? 0), measureBlocked(a) ? 1 : 0, a.measureMs ?? Number.MAX_SAFE_INTEGER, a.ms];
    const right = [matchClass(b) === "mismatch" ? 1 : 0, b.chapters > 0 ? 0 : 1, -(b.chapters || 0), status(b), over(b), -(b.chars ?? 0), measureBlocked(b) ? 1 : 0, b.measureMs ?? Number.MAX_SAFE_INTEGER, b.ms];
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  });
}

/** 按「源本身靠不靠谱」排：先看巡检健康度，再看正文质量，最后才比章数字数。
 *  适合「不想逐条看摘录，只想要一个稳定能用的源」的读者。 */
export function sortByHealth(list: SwitchCandidate[], baseline = 0): SwitchCandidate[] {
  const status = (item: SwitchCandidate): number =>
    item.status === "ok" ? 0 : item.status === "warn" ? 1 : item.status === "pending" ? 2 : 3;
  return list.slice().sort((a, b) => {
    const left = [
      matchClass(a) === "mismatch" ? 1 : 0,
      healthStateRank(a.sourceHealthState),
      -Number(a.sourceHealthScore ?? 0),
      qualityRank(a),
      status(a),
      a.chapters > 0 ? 0 : 1,
      -(a.chapters || 0),
      -(a.chars ?? 0),
      a.ms,
    ];
    const right = [
      matchClass(b) === "mismatch" ? 1 : 0,
      healthStateRank(b.sourceHealthState),
      -Number(b.sourceHealthScore ?? 0),
      qualityRank(b),
      status(b),
      b.chapters > 0 ? 0 : 1,
      -(b.chapters || 0),
      -(b.chars ?? 0),
      b.ms,
    ];
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  });
}

/** 按综合质量排：正文质量优先于健康度——一个「健康」的源照样可能返回防盗占位。 */
export function sortByQuality(list: SwitchCandidate[], baseline = 0): SwitchCandidate[] {
  const status = (item: SwitchCandidate): number =>
    item.status === "ok" ? 0 : item.status === "warn" ? 1 : item.status === "pending" ? 2 : 3;
  return list.slice().sort((a, b) => {
    const left = [
      matchClass(a) === "mismatch" ? 1 : 0,
      qualityRank(a),
      healthStateRank(a.sourceHealthState),
      status(a),
      a.chapters > 0 ? 0 : 1,
      -(a.chapters || 0),
      -(a.chars ?? 0),
      a.ms,
    ];
    const right = [
      matchClass(b) === "mismatch" ? 1 : 0,
      qualityRank(b),
      healthStateRank(b.sourceHealthState),
      status(b),
      b.chapters > 0 ? 0 : 1,
      -(b.chapters || 0),
      -(b.chars ?? 0),
      b.ms,
    ];
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  });
}

/** 这个源的目录比当前源多几章（负数表示更少；未知按 0）。 */
export function chapterDelta(item: SwitchCandidate, current: number | undefined): number {
  const base = current ?? 0;
  if (!base || !item.chapters) return 0;
  return item.chapters - base;
}

/** 只留下目录比当前源更长的候选；当前章数未知时原样返回。 */
export function filterMoreComplete(list: SwitchCandidate[], current: number | undefined): SwitchCandidate[] {
  const base = current ?? 0;
  if (!base) return list;
  return list.filter((item) => item.chapters > base);
}

/** 与当前源同一章的比值：0.9 以下就提示「字数偏少」。 */
export function charRatio(chars: number | undefined, baseline: number | undefined): number | null {
  if (!chars || !baseline || baseline <= 0) return null;
  return chars / baseline;
}

export type CharVerdict = "good" | "close" | "short" | "over" | "unknown";

/** 超过当前章 4 倍：多半抓到了整本、目录页或被塞了广告，字数不能用来比较。 */
export const OVERLONG_RATIO = 4;

export function isOverlongRatio(ratio: number | null): boolean {
  return ratio !== null && ratio > OVERLONG_RATIO;
}

export function charVerdict(ratio: number | null): CharVerdict {
  if (ratio == null) return "unknown";
  if (isOverlongRatio(ratio)) return "over";
  if (ratio >= 0.98) return "good";
  if (ratio >= 0.9) return "close";
  return "short";
}

/**
 * 缓存年龄：换源面板打开就要给出「这份结果有多旧」，否则用户不知道要不要重新搜。
 * 用 floor 而不是 round——59 秒说成「1 分钟前」会让人以为查过了。
 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "刚刚";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}


/** 换源面板顶部的「综合推荐」：只推真正能换、且不会让本章变少的源。
 *
 * 规则故意保守：章节名没对上、正文取不到、字数只有当前章零头、或目录没有变长的一律不推。
 * 偏好（置顶/屏蔽）只影响推荐顺序和候选过滤，不改变任何源的可用性判断。
 */
/** 目录地址归一化：同一个 toc 的多个书源条目其实是同一本书，换过去等于没换。 */
function comparableToc(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

/** 候选列表里排掉当前正在使用的源：面板会给当前源单独一张卡，列表里再出现只会让人误点「换到自己」。
 *
 * 只比 sourceId 不够：同一本书常被多个书源条目指向同一个目录（例如「就爱读」和「⚡📂就爱读」），
 * 目录地址相同就按同一本书处理，避免推荐「换到同一本站」。
 */
export function excludeSource(
  list: SwitchCandidate[],
  sourceId?: number | null,
  currentTocUrl?: string | null,
): SwitchCandidate[] {
  const id = Number(sourceId);
  const hasId = Number.isFinite(id) && id > 0;
  const toc = comparableToc(currentTocUrl);
  if (!hasId && !toc) return list;
  return list.filter((item) => {
    if (hasId && item.sourceId === id) return false;
    return !(toc && comparableToc(item.tocUrl) === toc);
  });
}

export interface SwitchRankPrefs {
  pinned?: number[];
  blocked?: number[];
}

export interface SwitchRecommendation {
  candidate: SwitchCandidate;
  reason: string;
}

function sourcePrefs(prefs: SwitchRankPrefs | undefined): { pinned: Set<number>; blocked: Set<number> } {
  return {
    pinned: new Set((prefs?.pinned ?? []).filter((id) => Number.isFinite(id))),
    blocked: new Set((prefs?.blocked ?? []).filter((id) => Number.isFinite(id))),
  };
}

/** 候选是否值得「综合推荐」。currentChapters 传当前书的总章数；未知传 0。 */
export function recommendCandidate(
  list: SwitchCandidate[],
  baseline = 0,
  prefs?: SwitchRankPrefs,
  currentChapters = 0,
): SwitchRecommendation | null {
  const { pinned, blocked } = sourcePrefs(prefs);
  const usable = list.filter((item) => {
    if (blocked.has(item.sourceId)) return false;
    if (item.status !== "ok") return false;
    // 健康度已失效/需登录的源不再推荐；正文质量明确为 bad 的也不推荐。
    if (!isHealthUsable(item.sourceHealthState)) return false;
    if (item.contentQuality === "bad") return false;
    if (matchClass(item) !== "name") return false;
    if (measureBlocked(item)) return false;
    if (typeof item.chars !== "number" || item.chars <= 0) return false;
    const ratio = charRatio(item.chars, baseline);
    if (isOverlongRatio(ratio)) return false;
    const moreChapters = currentChapters > 0 && item.chapters > currentChapters;
    if (baseline > 0 && ratio !== null && ratio < 0.98 && !moreChapters) return false;
    return true;
  });
  if (!usable.length) return null;
  const ranked = usable.slice().sort((a, b) => {
    const pa = pinned.has(a.sourceId) ? 0 : 1;
    const pb = pinned.has(b.sourceId) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ra = charRatio(a.chars, baseline) ?? 0;
    const rb = charRatio(b.chars, baseline) ?? 0;
    if (ra !== rb) return rb - ra;
    const da = chapterDelta(a, currentChapters);
    const db = chapterDelta(b, currentChapters);
    if (da !== db) return db - da;
    const ha = healthStateRank(a.sourceHealthState);
    const hb = healthStateRank(b.sourceHealthState);
    if (ha !== hb) return ha - hb;
    if ((a.chars ?? 0) !== (b.chars ?? 0)) return (b.chars ?? 0) - (a.chars ?? 0);
    return (a.measureMs ?? Number.MAX_SAFE_INTEGER) - (b.measureMs ?? Number.MAX_SAFE_INTEGER);
  });
  const candidate = ranked[0];
  const parts: string[] = [];
  if (pinned.has(candidate.sourceId)) parts.push("已置顶");
  const ratio = charRatio(candidate.chars, baseline);
  if (ratio !== null) {
    if (ratio >= 1.05) parts.push("本章多 " + Math.round((ratio - 1) * 100) + "% 字");
    else if (ratio >= 0.98) parts.push("本章字数相当");
    else parts.push("本章略少 " + Math.round((1 - ratio) * 100) + "% 字");
  }
  const delta = chapterDelta(candidate, currentChapters);
  if (delta > 0) parts.push("目录多 " + delta + " 章");
  if (!parts.length) parts.push("章节名一致且正文可用");
  return { candidate, reason: parts.join(" · ") };
}

export function formatCharCount(count: number | undefined): string {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return "";
  if (count >= 10000) {
    const value = count / 10000;
    return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + " 万字";
  }
  return count.toLocaleString("zh-CN") + " 字";
}
