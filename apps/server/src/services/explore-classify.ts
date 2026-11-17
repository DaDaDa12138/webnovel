/**
 * Discovery groups are free-form: every source names its ranking pages differently
 * ("排行榜", "热榜", "TOP100", "热门推荐", "月票榜"...). A keyword whitelist tuned
 * for one source misses the next one, so classify with a small scoring model that
 * combines the title, the URL and category words, and keep the score for debugging.
 */
export type ExploreGroupKind = "ranking" | "category" | "other";

export interface GroupClassification {
  kind: ExploreGroupKind;
  score: number;
  reason: string;
}

const STRONG_RANKING = /(排行榜|排行|榜单|榜|总榜|周榜|月榜|年榜|日榜|热榜|热搜|排名|rank|top\s*\d*)/i;
const STRONG_TOKENS = ["排行榜", "排行", "榜单", "总榜", "周榜", "月榜", "年榜", "日榜", "热榜", "热搜", "排名", "榜", "top", "rank"];
const WEAK_RANKING = /(热门|人气|推荐|新书|完本|畅销|飙升|精选|强推|热读|点击|收藏|月票|评分|最新|更新|订阅|打赏|催更)/i;
const WEAK_TOKENS = ["热门", "人气", "推荐", "新书", "完本", "畅销", "飙升", "精选", "强推", "热读", "点击", "收藏", "月票", "评分", "最新", "更新", "订阅", "打赏", "催更"];
const CATEGORY = /(分类|全部|更多|首页|书架|搜索|登录|注册|设置|玄幻|奇幻|武侠|仙侠|都市|历史|军事|游戏|科幻|灵异|女生|男生|二次元|言情|校园|悬疑|恐怖|修真|穿越|重生|竞技|同人|耽美|百合|快穿|系统|无限|末世|美食|娱乐|职场|官场|乡村|现实|短篇|连载|免费|vip|出版|其他)/i;
const RANKING_URL = /(rank|top|hot|pop|best|month|week|vote|recommend|paihang|bang|ph\b)/i;

function tokenHits(text: string, tokens: string[]): string[] {
  return tokens.filter((token) => text.includes(token));
}

export function classifyExploreGroup(title: string, url = ""): GroupClassification {
  const name = String(title ?? "").replace(/\s+/g, " ").trim();
  const link = String(url ?? "").toLowerCase();
  const lower = name.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  const strong = tokenHits(lower, STRONG_TOKENS);
  if (strong.length) {
    score += 6 + Math.min(3, strong.length - 1);
    reasons.push("榜单词:" + strong.slice(0, 3).join("/"));
  }
  const weak = tokenHits(lower, WEAK_TOKENS);
  if (weak.length) {
    score += Math.min(4, weak.length * 2);
    reasons.push("热度词:" + weak.slice(0, 3).join("/"));
  }
  if (CATEGORY.test(lower)) {
    score -= 4;
    reasons.push("分类词");
  }
  if (RANKING_URL.test(link)) {
    // A ranking URL should still win on generic titles such as "全部小说"
    // served from /rank/all, where the category word alone would cancel it out.
    score += 5;
    reasons.push("榜单URL");
  }
  if (name.length > 0 && name.length <= 6 && !CATEGORY.test(lower)) {
    score += 1;
    reasons.push("短标题");
  }

  const kind: ExploreGroupKind = score >= 3 ? "ranking" : CATEGORY.test(lower) ? "category" : "other";
  return { kind, score, reason: reasons.join(" · ") || "无特征" };
}

/** True when the group is a ranking/hot list worth showing in the 榜单 tab. */
export function isRankingGroup(title: string, url = ""): boolean {
  return classifyExploreGroup(title, url).kind === "ranking";
}
