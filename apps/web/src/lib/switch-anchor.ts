/**
 * 换源时的章内位置锚点。
 *
 * 换源会整页重载，服务端只保证「章」对得上，charOffset 会归零。这里在跳转前
 * 把当前字符位置连同前后文存进 sessionStorage，新页面恢复时先用引文做唯一匹配，
 * 命中就回到原句；对不上再按章节百分比退回，至少不会从章首开始。
 */
import type { SwitchAnchorPayload } from "@legado/shared";
import { matchAnnotation, quoteAround } from "./annotations";

export interface SwitchAnchor extends SwitchAnchorPayload {
  bookId: string;
  at: number;
}

export interface SwitchAnchorInput {
  bookId: string;
  chapterIndex: number;
  chapterTitle?: string;
  text: string;
  charOffset: number;
  chapterPercent: number;
}

const KEY_PREFIX = "legado-switch-anchor:";
const TTL_MS = 2 * 60 * 1000;
const CONTEXT = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function keyOf(bookId: string): string {
  return KEY_PREFIX + bookId;
}

export function makeSwitchAnchor(input: SwitchAnchorInput): SwitchAnchor | null {
  const text = input.text ?? "";
  if (!text || !input.bookId) return null;
  const offset = clamp(Math.round(input.charOffset || 0), 0, text.length);
  const start = Math.max(0, offset - CONTEXT);
  const end = Math.min(text.length, offset + CONTEXT);
  const { quote, prefix, suffix } = quoteAround(text, start, end, 20);
  if (!quote) return null;
  return {
    bookId: input.bookId,
    chapterIndex: Math.max(0, Math.round(input.chapterIndex)),
    chapterTitle: input.chapterTitle ?? "",
    charOffset: offset,
    chapterPercent: clamp(input.chapterPercent || 0, 0, 1),
    quote,
    prefix,
    suffix,
    quoteStart: start,
    at: Date.now(),
  };
}

/** 只取服务端需要的字段，bookId/at 是本地会话的簿记，不进库。 */
export function toSwitchAnchorPayload(anchor: SwitchAnchor): SwitchAnchorPayload {
  return {
    chapterIndex: anchor.chapterIndex,
    chapterTitle: anchor.chapterTitle,
    charOffset: anchor.charOffset,
    chapterPercent: anchor.chapterPercent,
    quote: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    quoteStart: anchor.quoteStart,
  };
}

/** 把服务端返回的锚点接回本地形状；at 用当前时间，避免 24 小时前的锚点被本地 TTL 误杀。 */
export function fromServerSwitchAnchor(bookId: string, payload: SwitchAnchorPayload): SwitchAnchor {
  return { ...payload, bookId, at: Date.now() };
}

export function saveSwitchAnchor(anchor: SwitchAnchor): void {
  try {
    sessionStorage.setItem(keyOf(anchor.bookId), JSON.stringify(anchor));
  } catch {
    /* 隐私模式下存不了就算了，换源仍然能用，只是回到章首。 */
  }
}

export function loadSwitchAnchor(bookId: string): SwitchAnchor | null {
  try {
    const raw = sessionStorage.getItem(keyOf(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SwitchAnchor;
    if (!parsed || parsed.bookId !== bookId || !parsed.quote) return null;
    if (!Number.isFinite(parsed.at) || Date.now() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(keyOf(bookId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSwitchAnchor(bookId: string): void {
  try {
    sessionStorage.removeItem(keyOf(bookId));
  } catch {
    /* 同上 */
  }
}

export interface ResolvedSwitchAnchor {
  offset: number;
  matched: boolean;
}

/**
 * 在新章正文里重贴锚点。matchAnnotation 传 start:-1/end:-1，跳过「偏移恰好相同」
 * 的捷径，否则新源同位置碰巧是同一句时会误判。
 */
export function resolveSwitchAnchor(text: string, anchor: SwitchAnchor): ResolvedSwitchAnchor {
  const body = text ?? "";
  if (!body) return { offset: 0, matched: false };
  const hit = matchAnnotation(body, {
    start: -1,
    end: -1,
    quote: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
  });
  if (hit) {
    const inside = clamp(anchor.charOffset - anchor.quoteStart, 0, anchor.quote.length);
    return { offset: clamp(hit.start + inside, 0, body.length), matched: true };
  }
  return { offset: clamp(Math.round(anchor.chapterPercent * body.length), 0, body.length), matched: false };
}
