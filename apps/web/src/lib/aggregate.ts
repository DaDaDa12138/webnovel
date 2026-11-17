import { healthStateRank, isHealthUsable } from "@legado/shared";
import type { SearchBook } from "../api";

export interface AggregatedBook {
  key: string;
  name: string;
  author: string;
  best: SearchBook;
  versions: SearchBook[];
}

/** Fold decorative brackets, punctuation and whitespace so "《三体》" and "三体" group together. */
export function normalizeTitle(name: string): string {
  return String(name || "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[\[\]【】《》()（）〔〕<>「」『』"'“”‘’·•,，.。!！?？:：;；—\-_/\\|]/g, "")
    .toLowerCase();
}

/** Sources often decorate the author field ("奇幻玄幻|作者: 爱潜水的乌贼"); keep just the name. */
export function cleanAuthor(author: string): string {
  let value = String(author || "").trim();
  const labelled = value.match(/作者\s*[:：]\s*([^|/\\]+)/);
  if (labelled) value = labelled[1];
  else if (value.includes("|")) value = value.split("|")[0];
  return value.replace(/[（(][^）)]*[）)]/g, "").replace(/[\s\u3000]+/g, "");
}

export function normalizeAuthor(author: string): string {
  return cleanAuthor(author).toLowerCase();
}

export function aggregateKey(book: SearchBook): string {
  return normalizeTitle(book.name) + "|" + normalizeAuthor(book.author);
}

const UNKNOWN_AUTHORS = new Set(["佚名", "未知", "不详", "匿名", "无名", "作者", "作者不详", "未知作者", "n/a", "na", "-", "暂无"]);
/** 书源把「连载中」「已完结」这类状态词写进作者位的情况也很常见。 */
const STATUS_AUTHORS = new Set(["连载中", "已完结", "完结", "连载", "全本", "全集", "txt", "精校版"]);

/**
 * 不少书源把作者写成「佚名」、状态词，或直接把书名塞进作者位（搜索「诡秘之主」
 * 会得到 author=「诡秘之主」的条目），这类值不能当作分组依据，否则同一本书会
 * 被拆成好几张卡。
 */
export function isUnknownAuthor(author: string, title = ""): boolean {
  const value = normalizeAuthor(author);
  if (!value || UNKNOWN_AUTHORS.has(value) || STATUS_AUTHORS.has(value)) return true;
  if (title && value === normalizeTitle(title)) return true;
  return false;
}

function score(book: SearchBook): number {
  let value = 0;
  if (book.coverUrl) value += 40;
  value += Math.min(20, Math.floor(String(book.intro || "").length / 20));
  if (book.lastChapter) value += 10;
  if (book.name && book.name === book.name.trim()) value += 1;
  return value;
}

/**
 * 选「最佳来源」时先看能不能读，再看封面/简介。
 *
 * 0.59 之前只用封面、简介、最新章节打分，一个 broken 源只要封面齐全就会
 * 盖过健康的源，读者点进去才发现打不开。这里按健康状态分档（healthy 1500、
 * partial 1400、unknown 1300、degraded 1200），档位差 100 大于元数据最多
 * 71 分，保证状态优先；健康分只做 0~20 的同档微调。blocked/broken 不拿
 * 基础分，因此永远不会因为封面好看而排到可用源前面。
 */
export function sourcePreferenceScore(book: SearchBook): number {
  const metadata = score(book);
  if (!isHealthUsable(book.healthState)) return metadata;
  const stateBase = 1000 + (5 - healthStateRank(book.healthState)) * 100;
  const healthBonus = Math.max(0, Math.min(100, Number(book.healthScore ?? 0))) * 0.2;
  return stateBase + healthBonus + metadata;
}

export function aggregateBooks(books: SearchBook[]): AggregatedBook[] {
  const groups = new Map<string, AggregatedBook>();
  const seen = new Set<string>();
  for (const book of books) {
    const dedupe = book.sourceId + "|" + book.bookUrl;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = aggregateKey(book);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { key, name: book.name, author: cleanAuthor(book.author), best: book, versions: [book] });
      continue;
    }
    current.versions.push(book);
    if (sourcePreferenceScore(book) > sourcePreferenceScore(current.best)) {
      current.best = book;
      current.name = book.name;
      current.author = cleanAuthor(book.author) || current.author;
    }
  }
  // 第二遍：作者未知的分组并到同书名的已知作者分组里，避免「是，火影！」出现两张卡。
  const byTitle = new Map<string, AggregatedBook[]>();
  for (const group of groups.values()) {
    const titleKey = normalizeTitle(group.name);
    const bucket = byTitle.get(titleKey);
    if (bucket) bucket.push(group);
    else byTitle.set(titleKey, [group]);
  }

  const list: AggregatedBook[] = [];
  for (const bucket of byTitle.values()) {
    if (bucket.length === 1) {
      list.push(bucket[0]);
      continue;
    }
    const known = bucket.filter((group) => !isUnknownAuthor(group.author, group.name));
    const pool = known.length ? known : bucket;
    const target = [...pool].sort((a, b) => b.versions.length - a.versions.length)[0];
    for (const group of bucket) {
      if (group === target) continue;
      const groupKnown = !isUnknownAuthor(group.author, group.name);
      const targetKnown = !isUnknownAuthor(target.author, target.name);
      // 两个不同的已知作者：不是同一本书，各自保留。
      if (groupKnown && targetKnown) {
        list.push(group);
        continue;
      }
      target.versions.push(...group.versions);
      if (sourcePreferenceScore(group.best) > sourcePreferenceScore(target.best)) target.best = group.best;
      if (!targetKnown && groupKnown) target.author = group.author;
    }
    list.push(target);
  }

  for (const group of list) {
    const seen = new Set<string>();
    group.versions = group.versions.filter((version) => {
      const dedupe = version.sourceId + "|" + version.bookUrl;
      if (seen.has(dedupe)) return false;
      seen.add(dedupe);
      return true;
    });
    group.versions.sort(
      (a, b) => sourcePreferenceScore(b) - sourcePreferenceScore(a) || a.originName.localeCompare(b.originName, "zh-CN"),
    );
    if (!group.versions.includes(group.best)) group.best = group.versions[0];
  }
  return list;
}
