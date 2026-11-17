/** Shared title/author matching used by search, source switching and auto-switch. */

/** Keep bracketed subtitles but drop the decorations: "[诡秘之主] 收藏家" → "诡秘之主收藏家". */
export function titleKey(name: string): string {
  return String(name ?? "")
    .replace(/[\[\]【】()（）《》「」『』]/g, "")
    .replace(/[\s:：·・,，。.!！?？\-—_/\\]+/g, "")
    .toLowerCase();
}

/**
 * Same book, not merely a title that mentions it: "三体" matches "三体全集" but never
 * "从三体逃到超神" (a different novel that used to win every candidate list).
 */
export function titlesMatch(a: string, b: string): boolean {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.startsWith(short);
}

const CATEGORY_TAIL = /^(其他类型|玄幻|奇幻|武侠|仙侠|都市|历史|军事|游戏|科幻|灵异|女生|男生|完本|连载|免费|VIP|出版|二次元)$/i;

function cleanOne(value: string): string {
  let s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const prefixed = s.match(/(?:作\s*者|著\s*者)\s*[:：]\s*([^|\\]+)/);
  if (prefixed) s = prefixed[1] ?? s;
  s = s.replace(/[（(][^)）]*[)）]/g, " ");
  // Sources often append a category to the author field: "阿勒苏霍得之笔 · 其他类型".
  s = s.replace(/\s*[·・]\s*([^·・]+)$/, (full, tail: string) => (CATEGORY_TAIL.test(tail.trim()) ? "" : full));
  s = s.replace(/(?:著|编著|编译|译者|原作|原名)\s*$/u, "");
  return s.replace(/^作\s*者\s*[:：]?/u, "").replace(/\s+/g, " ").trim();
}

/** Display form: the first author, without "作者：" / categories / brackets. */
export function cleanAuthor(value: string): string {
  return authorTokens(value)[0] ?? "";
}

function authorTokens(value: string): string[] {
  return String(value ?? "")
    .split(/[\/、,，;；&]+/)
    .map(cleanOne)
    .filter(Boolean);
}

/** Comparable author key; keeps CJK letters and digits, drops punctuation and spaces. */
export function authorKey(value: string): string {
  return cleanOne(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Author match is stricter than title match: an exact pen name, a shared multi-author
 * token, or a prefix ("刘慈欣" vs "刘慈欣著"). "乌贼" must NOT match "爱潜水的乌贼".
 */
export function authorsMatch(a: string, b: string): boolean {
  const left = authorTokens(a).map(authorKey).filter(Boolean);
  const right = authorTokens(b).map(authorKey).filter(Boolean);
  if (!left.length || !right.length) return false;
  for (const x of left) {
    for (const y of right) {
      if (x === y) return true;
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (short.length >= 2 && long.startsWith(short)) return true;
    }
  }
  return false;
}

const UNKNOWN_AUTHORS = new Set([
  "佚名",
  "匿名",
  "未知",
  "不详",
  "无名",
  "未知作者",
  "佚名作者",
  "作者",
  "admin",
  "unknown",
  "none",
  // 规则写歪时作者字段会抓到分类名（「玄幻」「都市」…），同样不能当作证据。
  "其他类型",
  "玄幻",
  "奇幻",
  "武侠",
  "仙侠",
  "都市",
  "历史",
  "军事",
  "游戏",
  "科幻",
  "灵异",
  "女生",
  "男生",
  "完本",
  "连载",
  "免费",
  "出版",
  "二次元",
]);

/** 聚合站常把作者写成「佚名」，这种值不能当作「作者不一致」的证据。 */
export function isUnknownAuthor(value: string): boolean {
  const key = authorKey(value);
  if (!key) return true;
  return UNKNOWN_AUTHORS.has(key);
}

/** Search filter: title must match; a supplied author only rejects a known mismatch. */
export function matchesBookQuery(name: string, author: string, title: string, authorQuery = ""): boolean {
  if (!titlesMatch(name, title)) return false;
  if (authorQuery && author && !authorsMatch(author, authorQuery)) return false;
  return true;
}
