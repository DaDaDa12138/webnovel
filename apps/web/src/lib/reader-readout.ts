/** The four page-header/footer slots, after hectorqin/reader's readout model.
 *
 * Each slot shows one field. Everything is derived from state the reader already has, so the
 * header never needs its own data fetch — and only the readout subtree re-renders when the
 * clock ticks.
 */

import { formatCountdown } from "./reader-sleep";

export type ReadoutField = "none" | "book" | "chapter" | "progress" | "time" | "remaining" | "read" | "sleep" | "source";

export type ReadoutSlot = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export const READOUT_SLOTS: ReadoutSlot[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

export const READOUT_FIELDS: Array<{ id: ReadoutField; label: string }> = [
  { id: "none", label: "不显示" },
  { id: "book", label: "书名" },
  { id: "chapter", label: "章节名" },
  { id: "progress", label: "进度" },
  { id: "time", label: "时间" },
  { id: "remaining", label: "剩余" },
  { id: "read", label: "已读字数" },
  { id: "sleep", label: "睡眠" },
  { id: "source", label: "书源" },
];

export type ReadoutConfig = Record<ReadoutSlot, ReadoutField>;

export const DEFAULT_READOUT: ReadoutConfig = {
  topLeft: "chapter",
  topRight: "time",
  bottomLeft: "none",
  bottomRight: "progress",
};

const FIELD_IDS = new Set<string>(READOUT_FIELDS.map((field) => field.id));

export function normalizeReadout(value: unknown): ReadoutConfig {
  const src = (value && typeof value === "object" ? value : {}) as Partial<Record<ReadoutSlot, unknown>>;
  const out = { ...DEFAULT_READOUT };
  for (const slot of READOUT_SLOTS) {
    const field = src[slot];
    if (typeof field === "string" && FIELD_IDS.has(field)) out[slot] = field as ReadoutField;
  }
  return out;
}

export interface ReadoutContext {
  book: string;
  chapter: string;
  /** Whole-book progress, 0..100. */
  percent: number;
  /** 1-based page inside the current chapter. */
  page: number;
  /** Pages in the current chapter. */
  pages: number;
  /** Remaining characters in the current chapter. */
  remainingChars?: number;
  /** Characters already read in the current chapter. */
  readChars?: number;
  /** 睡眠定时剩余毫秒；未启用为 0（空格子不显示）。 */
  sleepLeft?: number;
  /** 当前这本书来自哪个书源（换源后跟着变）。 */
  source?: string;
  now?: Date;
}

function pad(value: number): string {
  return value < 10 ? "0" + value : String(value);
}

export function clockText(now: Date): string {
  return pad(now.getHours()) + ":" + pad(now.getMinutes());
}

export function formatReadout(field: ReadoutField, ctx: ReadoutContext): string {
  switch (field) {
    case "book":
      return ctx.book || "";
    case "chapter":
      return ctx.chapter || "";
    case "progress": {
      const percent = Number.isFinite(ctx.percent) ? Math.min(100, Math.max(0, ctx.percent)) : 0;
      const pages = Math.max(1, Math.round(ctx.pages) || 1);
      const page = Math.min(pages, Math.max(1, Math.round(ctx.page) || 1));
      return page + "/" + pages + " · " + percent.toFixed(1) + "%";
    }
    case "time":
      return clockText(ctx.now ?? new Date());
    case "remaining": {
      const chars = Math.max(0, Math.round(ctx.remainingChars ?? 0));
      if (!chars) return "";
      return "余 " + Math.max(1, Math.ceil(chars / 400)) + " 分钟";
    }
    case "read": {
      const chars = Math.max(0, Math.round(ctx.readChars ?? 0));
      return chars ? "已读 " + chars.toLocaleString("zh-CN") + " 字" : "";
    }
    case "sleep":
      return formatCountdown(ctx.sleepLeft ?? 0);
    case "source":
      return ctx.source || "";
    default:
      return "";
  }
}
