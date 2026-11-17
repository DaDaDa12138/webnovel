/** 发现页「分类 / 榜单」的拆分规则与翻页合并。
 *
 * 书源的 exploreUrl 里既有分类也有榜单入口，但没有统一标记：只能按标题和 URL
 * 关键字判断。内置源的分组地址是自造的 ssx:top:1:1141，里面的 top 只是我们自己的
 * 分类接口名，不能当成榜单证据——否则 36 个分类会整份被划进榜单，两个 tab 长得一样。
 */
import type { SearchBook } from "@legado/shared";

const RANK_TITLE = /(榜|排行|热销|热搜|新书|完本|推荐|精选|月票|打赏|收藏|点击|人气|top|rank|best|hot)/i;

export interface ExploreGroupLike {
  title?: string;
  url?: string;
}

/** 只看标题，不看 URL。
 *
 * 反例：QQ 阅读的 350 个分类全挂在 /rank/list?groupid=… 上，书山聚合的分组地址是
 * 自造的 ssx:top:1:1141 —— 按 URL 判断会把整份分类表划成榜单，两个 tab 显示同一份内容。
 * 真正叫得上榜单的入口，标题里一定带「榜 / 排行 / 热销 / top」这类词。
 */
export function isRankGroup(group: ExploreGroupLike): boolean {
  return RANK_TITLE.test(String(group.title ?? ""));
}

export function splitRankGroups<T extends ExploreGroupLike>(groups: T[]): { ranks: T[]; others: T[] } {
  const ranks: T[] = [];
  const others: T[] = [];
  for (const group of groups) (isRankGroup(group) ? ranks : others).push(group);
  return { ranks, others };
}

/** 同一本书的稳定身份：优先详情页地址，没有地址时退回「书名|作者」。 */
export function bookKey(book: Pick<SearchBook, "bookUrl" | "name" | "author">): string {
  const url = String(book.bookUrl ?? "").trim();
  if (url) return url;
  const name = String(book.name ?? "").trim();
  return name ? name + "|" + String(book.author ?? "").trim() : "";
}

/** 追加去重：书源常把置顶书塞进每一页，翻页时会出现重复卡片。 */
export function mergeBooks(current: SearchBook[], incoming: SearchBook[]): SearchBook[] {
  const seen = new Set(current.map(bookKey));
  const out = current.slice();
  for (const book of incoming) {
    const key = bookKey(book);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(book);
  }
  return out;
}

/** 首屏一次拉三页：一页 20 本，铺满一屏半，用户不用一进来就找「下一页」。 */
export const EXPLORE_BURST_PAGES = 3;

/**
 * 手动标记的榜单入口：{ 书源 id: [分组 url] }。
 *
 * 自动识别只看标题关键词，「本周最热」「大家都在看」这类入口认不出来，所以允许手动
 * 标记。坏数据一律当成空表：宁可退回自动识别，也不能让发现页因为一条设置打不开。
 */
export function parseRankOverrides(raw: string | null | undefined): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const urls = value.filter((item): item is string => typeof item === "string" && Boolean(item));
      if (urls.length) out[key] = urls;
    }
    return out;
  } catch {
    return {};
  }
}
