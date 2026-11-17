import type { SearchBook } from "../api";

/** 发现页卡片的展示规则：只在有可靠信息时显示，缺字段不补假数据。 */

export type ExploreDisplay = NonNullable<SearchBook["display"]>;

export function displayOf(book: SearchBook): ExploreDisplay {
  return (
    book.display ?? {
      author: book.author || "",
      categories: book.kind ? book.kind.split(/[·•/、|｜]+/).filter(Boolean).slice(0, 4) : [],
      status: "",
      rating: null,
      wordCount: null,
      wordCountText: "",
      updatedAt: "",
      lastChapter: book.lastChapter || "",
      intro: book.intro || "",
      completeness: "minimal",
    }
  );
}

export function authorLabel(display: ExploreDisplay): string {
  return display.author ? display.author : "作者未知";
}

/** 状态色：连载中=主色，已完结=中性，暂停=警示。 */
export function statusTone(status: string): "ongoing" | "done" | "paused" | "" {
  if (status === "连载中") return "ongoing";
  if (status === "已完结") return "done";
  if (status === "暂停") return "paused";
  return "";
}

/** 把 2026-11-04 变成「今天更新 / 昨天更新 / N 天前 / 11-04」。 */
export function updateLabel(updatedAt: string, now = new Date()): string {
  if (!updatedAt) return "";
  const m = updatedAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return updatedAt;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(then.getTime())) return updatedAt;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86400000);
  if (days === 0) return "今天更新";
  if (days === 1) return "昨天更新";
  if (days > 1 && days <= 7) return days + " 天前";
  const sameYear = then.getFullYear() === now.getFullYear();
  return (sameYear ? "" : then.getFullYear() + "-") + String(then.getMonth() + 1).padStart(2, "0") + "-" + String(then.getDate()).padStart(2, "0");
}

export function categoryLine(display: ExploreDisplay): string[] {
  return display.categories.slice(0, 2);
}

/** 列表卡片最后一行：优先最新章节，其次简介。 */
export function detailLine(display: ExploreDisplay): string {
  if (display.lastChapter) return "最新 " + display.lastChapter;
  if (display.intro) return display.intro;
  return "";
}

/** 网格卡片第二行能显示作者/分类，缺失时退回「作者未知」。 */
export function gridMeta(display: ExploreDisplay): string {
  return display.author || display.categories[0] || "作者未知";
}
