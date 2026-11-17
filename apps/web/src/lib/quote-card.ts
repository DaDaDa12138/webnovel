/**
 * 书摘卡片：把选中的正文渲染成一张 3:4 的分享图。
 *
 * 这里只放能在 Node 里单测的部分——换行与文件名的规则。
 * 真正画图要 canvas，留在组件里。
 */

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1440;
/** 卡片四周留白；正文宽度 = CARD_WIDTH - 2 * CARD_PADDING。 */
export const CARD_PADDING = 96;

/** 不能出现在行首的标点（避头）。 */
const NO_LINE_START = "，。、；：？！）》」』”’…·%,.;:?!)]}";
/** 不能留在行尾的标点（避尾）。 */
const NO_LINE_END = "（《「『“‘([{";

export interface WrapOptions {
  /** 单行最大宽度（像素）。 */
  maxWidth: number;
  /** 量一段文字的宽度，通常直接传 canvas measureText。 */
  measure: (text: string) => number;
  /** 最多几行，超出用省略号截断。 */
  maxLines: number;
}

/**
 * 按宽度折行：中文逐字断，英文/数字按词断，标点做简单的避头尾。
 * 量宽交给调用方，所以这套逻辑不依赖 canvas，可以在测试里用假尺子跑。
 */
export function wrapText(text: string, options: WrapOptions): string[] {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return [];
  const maxWidth = Math.max(1, options.maxWidth);
  const maxLines = Math.max(1, Math.floor(options.maxLines));

  const tokens = source.match(/[A-Za-z0-9'’._-]+|\s|[^\s]/gu) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (token === " ") {
      // 行首空格直接丢掉；行内空格留到下一个词一起判断。
      if (!line) continue;
      if (options.measure(line + " ") <= maxWidth) line += " ";
      continue;
    }
    const candidate = line + token;
    if (!line || options.measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line.trimEnd());
    line = token;
  }
  if (line.trim()) lines.push(line.trimEnd());

  // 避头：行首标点并回上一行；避尾：行尾开引号推到下一行。
  for (let i = 1; i < lines.length; i++) {
    while (lines[i] && NO_LINE_START.includes(lines[i][0]) && lines[i - 1].length > 1) {
      lines[i - 1] += lines[i][0];
      lines[i] = lines[i].slice(1);
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    while (lines[i].length > 1 && NO_LINE_END.includes(lines[i].slice(-1))) {
      lines[i + 1] = lines[i].slice(-1) + lines[i + 1];
      lines[i] = lines[i].slice(0, -1);
    }
  }

  // 避头尾会把字搬来搬去，搬完可能空出位置：把下一行开头的字补上来。
  // 只搬中文/标点——英文按词断行，搬一个字母会把单词拆开。
  for (let i = 1; i < lines.length; i++) {
    while (lines[i].length > 0) {
      const next = lines[i][0];
      if (/[A-Za-z0-9]/.test(next)) break;
      if (NO_LINE_END.includes(lines[i - 1].slice(-1))) break;
      if (options.measure(lines[i - 1] + next) > maxWidth) break;
      lines[i - 1] += next;
      lines[i] = lines[i].slice(1);
    }
  }

  const kept = lines.filter((item) => item.length > 0);
  if (kept.length <= maxLines) return kept;

  const cut = kept.slice(0, maxLines);
  let last = cut[maxLines - 1];
  while (last.length > 1 && options.measure(last + "…") > maxWidth) last = last.slice(0, -1);
  cut[maxLines - 1] = last.replace(/[\s]+$/, "") + "…";
  return cut;
}

/** 文件名里不能出现的字符换成空格；太长截断，避免下载时被系统拒掉。 */
export function cardFileName(bookName: string, chapterTitle: string): string {
  const clean = (value: string) =>
    value
      .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const name = [clean(bookName), clean(chapterTitle), "书摘"].filter(Boolean).join("-").slice(0, 80);
  return (name || "书摘") + ".png";
}

/** 卡片右下角的日期，用本地时区。 */
export function cardDate(now: Date): string {
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
}
