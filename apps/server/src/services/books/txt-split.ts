/**
 * TXT 分章：把整本纯文本切成「章节标题 + 正文」。
 *
 * 网文的 TXT 五花八门：有的每章一行「第12章 标题」，有的把标题和正文挤在一行，
 * 有的干脆没有章节标题。这里只做两件事：认得标题行就切，认不出就按固定长度切块，
 * 保证「导入后一定能读」而不是「格式不标准就报错」。
 */

export interface TxtSection {
  title: string;
  text: string;
}

const NUMBER = "[0-9零一二三四五六七八九十百千万两]{1,12}";
const MARK = new RegExp(`^第${NUMBER}[章回节卷集篇部]`);
const SPECIAL = ["序章", "序言", "自序", "楔子", "引子", "前言", "终章", "结局", "尾声", "后记", "番外"];

/** 一行像不像章节标题。宁严勿松：把正文段落误判成标题会把一章切碎。 */
export function isHeading(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 44) return false;
  if (MARK.test(text)) {
    const rest = text.replace(MARK, "");
    if (!rest) return true;
    // 「第3章 初见」这种带分隔符的标题，后面允许 40 字以内的标题文字
    if (/^[\s\u3000:：、·\-—]/.test(rest)) return rest.trim().length <= 40;
    // 「第3章初见」没有分隔符：只有很短且不含句读才当标题，避免把「第三回合结束后，他走了。」切开
    return rest.length <= 12 && !/[。！？，；：]/.test(rest);
  }
  return SPECIAL.some((word) => text === word || text.startsWith(word + " ") || text.startsWith(word + "\u3000"));
}

function cleanBody(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "")
    .trim();
}

function chunkText(text: string, size: number): TxtSection[] {
  const paragraphs = text.split(/\n+/).filter((line) => line.trim());
  const out: TxtSection[] = [];
  let buffer: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    buffer.push(paragraph);
    length += paragraph.length;
    if (length >= size) {
      out.push({ title: `第 ${out.length + 1} 节`, text: buffer.join("\n") });
      buffer = [];
      length = 0;
    }
  }
  if (buffer.length) out.push({ title: `第 ${out.length + 1} 节`, text: buffer.join("\n") });
  return out;
}

/**
 * 切章。fallbackSize 只在「整本没有章节标题」时生效：
 * 6000 字一节大约是手机上的 6–10 屏，既不会一屏读不到头，也不会切出上百个碎节。
 */
export function splitTxtChapters(raw: string, fallbackSize = 6000): TxtSection[] {
  const text = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  const groups: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } = { title: "", lines: [] };
  for (const line of lines) {
    if (isHeading(line)) {
      if (current.title || current.lines.some((item) => item.trim())) groups.push(current);
      current = { title: line.trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.title || current.lines.some((item) => item.trim())) groups.push(current);

  const sections = groups
    .map((group) => ({ title: group.title || "开始", text: cleanBody(group.lines) }))
    .filter((section) => section.text.length > 0);

  if (sections.length > 1) return sections;
  const whole = cleanBody(lines);
  if (!whole) return [];
  return chunkText(whole, Math.max(1000, fallbackSize));
}
