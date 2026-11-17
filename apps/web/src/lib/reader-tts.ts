/**
 * 朗读的纯函数：断句、引擎选择、语速夹取。
 * 放在 lib/ 是为了能被 vitest 直接覆盖（测试不引 DOM）。
 */

export type TtsEngine = "auto" | "system" | "http";

export interface SentenceChunk {
  text: string;
  start: number;
}

const TERMINATORS = new Set(["。", "！", "？", "；", "…", "‼", "⁇", "⁈", "⁉", "!", "?", ";", "\n"]);
/** 句末标点后面可能还跟着引号/括号，它们属于同一句。 */
const CLOSERS = new Set(["”", "’", "」", "』", "）", ")", "】", "》", "]", "'", "\""]);
/** 超长句优先在这些位置断开，听起来比硬切自然。 */
const SOFT_BREAKS = new Set(["，", "、", ",", "：", ":", " "]);

/**
 * 中文优先的断句：句末标点（含紧随的引号）切一刀；超过 maxLength 时退到最近的逗号，
 * 没有逗号才硬切。英文句点不切——缩写、小数点、版本号都会误伤，宁可整段读完。
 */
export function splitSentences(text: string, maxLength = 120): SentenceChunk[] {
  const out: SentenceChunk[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    if (end <= start) return;
    const raw = text.slice(start, end);
    if (raw.trim()) out.push({ text: raw, start });
    start = end;
  };
  while (i < text.length) {
    const ch = text[i];
    if (TERMINATORS.has(ch)) {
      let end = i + 1;
      while (end < text.length && CLOSERS.has(text[end])) end += 1;
      push(end);
      i = end;
      continue;
    }
    if (i - start + 1 >= maxLength) {
      let cut = i + 1;
      for (let j = i; j > start + Math.floor(maxLength * 0.5); j -= 1) {
        if (SOFT_BREAKS.has(text[j])) {
          cut = j + 1;
          break;
        }
      }
      push(cut);
      i = cut;
      continue;
    }
    i += 1;
  }
  push(text.length);
  return out;
}

export interface SpeechChunk {
  text: string;
  chapterIndex: number;
  paraIndex: number;
  start: number;
  /** 章节内绝对偏移；展示块分段后用它跨块画高亮。 */
  offset?: number;
}

/** 一章正文 → 逐句朗读片段。段内偏移 start 用来给正在读的句子画高亮。 */
export function splitSpeechChunks(index: number, paragraphs: string[], maxLength = 120, starts?: number[]): SpeechChunk[] {
  const out: SpeechChunk[] = [];
  paragraphs.forEach((para, paraIndex) => {
    for (const sentence of splitSentences(para, maxLength)) {
      const chunk: SpeechChunk = { text: sentence.text, chapterIndex: index, paraIndex, start: sentence.start };
      if (starts) chunk.offset = (starts[paraIndex] ?? 0) + sentence.start;
      out.push(chunk);
    }
  });
  return out;
}

export interface TtsAvailability {
  /** 浏览器是否有可用的语音引擎（speechSynthesis 且至少一个音色）。 */
  system: boolean;
  /** 服务端是否配置了朗读服务。 */
  http: boolean;
}

/**
 * 选择实际使用的引擎。auto 优先服务端：音色稳定、跨设备一致；
 * 没配置服务端时才回落到浏览器语音。
 */
export function resolveTtsEngine(preference: TtsEngine, available: TtsAvailability): "system" | "http" | null {
  if (preference === "system") return available.system ? "system" : null;
  if (preference === "http") return available.http ? "http" : null;
  if (available.http) return "http";
  return available.system ? "system" : null;
}

export function clampTtsRate(rate: number): number {
  const value = Number(rate);
  if (!Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(0.5, Math.round(value * 10) / 10));
}

/** 高亮用的字符区间：先按偏移找段落文本节点，再把段内偏移换算成 Range。 */
export function rangeForOffsets(paragraph: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let from: { node: Node; offset: number } | null = null;
  let to: { node: Node; offset: number } | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent?.length ?? 0;
    if (!from && start <= seen + length) from = { node, offset: Math.max(0, start - seen) };
    if (!to && end <= seen + length) {
      to = { node, offset: Math.max(0, end - seen) };
      break;
    }
    seen += length;
  }
  if (!from) return null;
  const range = document.createRange();
  range.setStart(from.node, Math.min(from.offset, from.node.textContent?.length ?? 0));
  range.setEnd(to ? to.node : from.node, to ? Math.min(to.offset, to.node.textContent?.length ?? 0) : (from.node.textContent?.length ?? 0));
  return range;
}
