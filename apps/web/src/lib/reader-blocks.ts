/**
 * 展示层分段：把「一行一段」的原始 paragraphs 变成更适合阅读的显示块。
 *
 * 这里所有 start/end 都保持章节内绝对字符偏移（paragraphs.join("\n") 坐标），
 * 只改渲染，不改原文、进度、标注、朗读的锚点。
 */

export type BlockKind = "text" | "dialog" | "poem" | "letter" | "sms" | "system" | "divider" | "note" | "subhead";

export interface ParagraphOptions {
  mode: "off" | "smart";
  mergeWrapped: boolean;
  splitLong: boolean;
  splitLength: number;
  splitDialogue: boolean;
  dedupeTitle: boolean;
  /** 识别诗歌、书信、短信、系统提示和分节线，并给它们独立排版。 */
  special: boolean;
  /** 识别章首/章末的作者话、更新说明和日期行，弱化成注记。 */
  authorNote: boolean;
  /** 识别夹在长段之间的短行小标题。 */
  subhead: boolean;
  /** 对话段用悬挂缩进，而不是首行缩进。 */
  dialogIndent: boolean;
}

export interface DisplayPart {
  para: number;
  start: number;
  end: number;
  text: string;
}

export interface DisplayBlock {
  group: number;
  para: number;
  paraEnd: number;
  start: number;
  end: number;
  text: string;
  parts: DisplayPart[];
  cont: boolean;
  kind: BlockKind;
}

export const DEFAULT_PARAGRAPH_OPTIONS: ParagraphOptions = {
  mode: "smart",
  mergeWrapped: true,
  splitLong: true,
  splitLength: 220,
  splitDialogue: true,
  dedupeTitle: true,
  special: true,
  authorNote: true,
  subhead: true,
  dialogIndent: false,
};

export function normalizeParagraphOptions(value: unknown): ParagraphOptions {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ParagraphOptions>;
  const splitLength = Number(raw.splitLength);
  return {
    mode: raw.mode === "off" ? "off" : "smart",
    mergeWrapped: raw.mergeWrapped !== false,
    splitLong: raw.splitLong !== false,
    splitLength: Number.isFinite(splitLength) ? Math.max(120, Math.min(400, Math.round(splitLength))) : 220,
    splitDialogue: raw.splitDialogue !== false,
    dedupeTitle: raw.dedupeTitle !== false,
    special: raw.special !== false,
    authorNote: raw.authorNote !== false,
    subhead: raw.subhead !== false,
    dialogIndent: raw.dialogIndent === true,
  };
}

const SENTENCE_END = /[。！？!?…]/;
const OPEN_QUOTE = /[“‘「『]/;
const CLOSE_QUOTE = /[”’」』]/;
const LIST_START = /^(?:[-—•·*]|\d+[.、)]|[一二三四五六七八九十]+[、.])/;

function normalizeTitle(text: string): string {
  return String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/^第[0-9零一二三四五六七八九十百千万两]+[章节回卷][:：\-—\s]*/, "")
    .replace(/[，。！？!?、；：""''“”‘’「」『』（）()\[\]【】…—\-·]/g, "")
    .trim();
}

function endsSentence(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (SENTENCE_END.test(t[t.length - 1] ?? "")) return true;
  if (CLOSE_QUOTE.test(t[t.length - 1] ?? "") && SENTENCE_END.test(t[t.length - 2] ?? "")) return true;
  return false;
}

function startsLikeNewParagraph(text: string): boolean {
  const t = String(text ?? "").trim();
  return OPEN_QUOTE.test(t[0] ?? "") || /^第[0-9零一二三四五六七八九十百千万两]+[章节回卷]/.test(t) || LIST_START.test(t);
}

const DIVIDER_LINE = /^[\s*＊·•—\-=_~#.．…￥¥※☆★◇◆□■×]{3,}$/;
const SYSTEM_LINE = /^(?:【[^】\n]{0,20}】|\[(?:系统|提示|警告|任务|公告|通知|短信|微信|消息|邮件)[^\]]{0,20}\]|(?:系统提示|系统公告|系统消息|系统警告)[：:])/;
const SMS_LINE = /^(?:(?:短信|微信|消息|邮件|来电|电话|语音)[：:]|【(?:短信|微信|消息|邮件)】|\[[\u4e00-\u9fa5]{2,6}\]\s*[：:]?\s*\S)/;
const LETTER_OPEN = /^(?:亲爱的|敬爱的|尊敬的|致[:：]?\s*|给我的|吾友|兄长|贤弟|宝贝|孩子[：:])/;
const LETTER_CLOSE = /^(?:此致|敬礼|谨上|敬上|你的[，,：:]?|爱你的|永远爱你的|P\.?S\.?)/i;
/** 作者话/更新说明：只在前两段或后三段生效，避免正文里一句「感谢」被整段弱化。 */
const NOTE_PREFIX = /^(?:作者(?:的话|有话说|说|感言)|PS[：:\s]|P\.S\.|更新说明|更新公告|公告[：:\s]|通知[：:\s]|请假|求(?:月票|推荐|收藏|订阅)|感谢[^。！？\n]{0,24}(?:打赏|月票|推荐)|新书(?:发布|上传|预告)|上架感言|本章完|未完待续)/i;
const NOTE_DATE = /^(?:\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?|\d{1,2}[月./-]\d{1,2}日)(?:[：:\s]|$)/;
const POEM_TERMINAL = /[。！？!?；;…”’」』]$/;
const POEM_BAD_START = /^[“「『"'（(]/;
/** 口语里的人称、语气词和问叹号：诗歌里少见，出现就按普通短句处理。 */
const POEM_PROSE = /[你我他她它吗呢吧啊呀哦嘛哈？?！!]/;

function isDivider(text: string): boolean {
  const t = String(text ?? "").trim();
  return t.length >= 3 && DIVIDER_LINE.test(t.replace(/\s+/g, ""));
}

function isPoemLine(value: string): boolean {
  const t = String(value ?? "").trim();
  if (t.length < 6 || t.length > 28) return false;
  if (isDivider(t) || SYSTEM_LINE.test(t) || SMS_LINE.test(t) || LETTER_OPEN.test(t)) return false;
  if (POEM_TERMINAL.test(t) || POEM_BAD_START.test(t) || POEM_PROSE.test(t)) return false;
  if (/^第[0-9零一二三四五六七八九十百千万两]+[章节回卷]/.test(t) || LIST_START.test(t)) return false;
  if (/[：:]/.test(t)) return false;
  if (/[。！？!?；;]/.test(t)) return false;
  return true;
}

/** 作者话只在章首两段/章末三段；正文中段的「感谢」不动。 */
function isAuthorNote(value: string, index: number, total: number): boolean {
  if (index >= 2 && index < total - 3) return false;
  const t = String(value ?? "").trim();
  if (!t || t.length > 160) return false;
  return NOTE_PREFIX.test(t) || NOTE_DATE.test(t);
}

/**
 * 小标题：夹在长段之间的 4–24 字短行，没有句末标点和口语收尾。
 * 这个判断宁可漏，也不能把「他点了点头」这种叙述短句做成标题。
 */
function isSubheadLine(value: string, prev: string, next: string): boolean {
  const t = String(value ?? "").trim();
  if (t.length < 4 || t.length > 24) return false;
  if (isDivider(t) || SYSTEM_LINE.test(t) || SMS_LINE.test(t) || LETTER_OPEN.test(t)) return false;
  if (POEM_TERMINAL.test(t) || POEM_BAD_START.test(t) || CLOSE_QUOTE.test(t[t.length - 1] ?? "")) return false;
  if (/^第[0-9零一二三四五六七八九十百千万两]+[章节回卷]/.test(t) || LIST_START.test(t)) return false;
  if (/[，,。；;]/.test(t) || /[了着过]$/.test(t) || /^(?:他|她|它|我|你)/.test(t)) return false;
  return String(prev ?? "").trim().length > 30 || String(next ?? "").trim().length > 30;
}

/** 按原文识别特殊段落；只决定展示样式，不改变任何 start/end 坐标。 */
function classifyParagraphs(paragraphs: string[], opts: ParagraphOptions): BlockKind[] {
  const total = paragraphs.length;
  const kinds: BlockKind[] = paragraphs.map(() => "text");
  for (let i = 0; i < total; i += 1) {
    const text = String(paragraphs[i] ?? "").trim();
    if (!text) continue;
    if (opts.special && isDivider(text)) {
      kinds[i] = "divider";
      continue;
    }
    if (opts.special && SYSTEM_LINE.test(text)) {
      kinds[i] = "system";
      continue;
    }
    if (opts.special && SMS_LINE.test(text)) {
      kinds[i] = "sms";
      continue;
    }
    // 作者话和小标题属于结构整理，不随「特殊段落样式」一起关掉。
    if (opts.authorNote && isAuthorNote(text, i, total)) {
      kinds[i] = "note";
      continue;
    }
    if (opts.special && LETTER_OPEN.test(text)) {
      let end = i;
      for (let j = i + 1; j < Math.min(total, i + 12); j += 1) {
        if (LETTER_CLOSE.test(String(paragraphs[j] ?? "").trim())) {
          end = j;
          // 连续落款（如「此致」「敬礼」）都属于同一封书信。
          while (end + 1 < total && LETTER_CLOSE.test(String(paragraphs[end + 1] ?? "").trim())) end += 1;
          break;
        }
      }
      for (let k = i; k <= end; k += 1) kinds[k] = "letter";
      if (end > i) i = end;
    }
  }
  // 诗歌至少连续四行，避免把三句普通短对白误判成诗。
  for (let i = 0; opts.special && i < total; i += 1) {
    if (kinds[i] !== "text" || !isPoemLine(paragraphs[i] ?? "")) continue;
    let end = i;
    while (end < total && kinds[end] === "text" && isPoemLine(paragraphs[end] ?? "")) end += 1;
    if (end - i >= 4) {
      let chars = 0;
      for (let k = i; k < end; k += 1) chars += String(paragraphs[k] ?? "").trim().length;
      if (chars / (end - i) <= 24) {
        for (let k = i; k < end; k += 1) kinds[k] = "poem";
      }
    }
    i = end - 1;
  }
  // 小标题最后判：前面已经认成诗歌/书信/短信的段落不再改。
  if (opts.subhead) {
    for (let i = 1; i < total - 1; i += 1) {
      if (kinds[i] !== "text") continue;
      const prev = String(paragraphs[i - 1] ?? "");
      const next = String(paragraphs[i + 1] ?? "");
      if (isSubheadLine(paragraphs[i] ?? "", prev, next)) kinds[i] = "subhead";
    }
  }
  return kinds;
}


interface SourcePara {
  para: number;
  start: number;
  end: number;
  text: string;
}

interface Group {
  id: number;
  paras: SourcePara[];
  kind: BlockKind;
}

interface FlatPart {
  para: number;
  start: number;
  end: number;
  text: string;
}

/** 把 group 的原始段落拼成一条不带换行的 flat 文本；段落间的换行不属于任何 part。 */
function flatParts(group: Group): { text: string; parts: FlatPart[] } {
  const parts: FlatPart[] = [];
  let text = "";
  for (const p of group.paras) {
    if (!p.text) continue;
    parts.push({ para: p.para, start: p.start, end: p.end, text: p.text });
    text += p.text;
  }
  return { text, parts };
}

/** flat 区间 → 绝对偏移 parts；不插入空格，保留每个 part 的原始起点。 */
export function sliceParts(parts: FlatPart[], from: number, to: number): DisplayPart[] {
  const out: DisplayPart[] = [];
  let cursor = 0;
  for (const part of parts) {
    const partFrom = cursor;
    const partTo = cursor + part.text.length;
    cursor = partTo;
    const a = Math.max(from, partFrom);
    const b = Math.min(to, partTo);
    if (b <= a) continue;
    out.push({
      para: part.para,
      start: part.start + (a - partFrom),
      end: part.start + (b - partFrom),
      text: part.text.slice(a - partFrom, b - partFrom),
    });
  }
  return out;
}

function splitLongSentence(text: string, from: number, to: number, limit: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let start = from;
  while (to - start > limit) {
    const hard = start + limit;
    let cut = hard;
    const min = start + Math.floor(limit * 0.55);
    for (let i = hard; i >= min; i -= 1) {
      if (/[，、；：]/.test(text[i - 1] ?? "")) {
        cut = i;
        break;
      }
    }
    // 不把代理对切成两半。
    if (cut > start && cut < to) {
      const code = text.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    if (cut <= start) cut = Math.min(to, hard);
    out.push({ from: start, to: cut });
    start = cut;
  }
  if (to > start) out.push({ from: start, to });
  return out;
}

function sentenceSpans(text: string): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let start = 0;
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (OPEN_QUOTE.test(ch)) depth += 1;
    else if (CLOSE_QUOTE.test(ch)) {
      depth = Math.max(0, depth - 1);
      // 对话引号闭合后如果还有叙述，先把对话独立出来。
      if (depth === 0 && i + 1 < text.length && !/[。！？!?…，、；：]/.test(text[i + 1] ?? "")) {
        out.push({ from: start, to: i + 1 });
        start = i + 1;
        i += 1;
        continue;
      }
    }
    if (SENTENCE_END.test(ch) && depth === 0) {
      let end = i + 1;
      while (end < text.length && (SENTENCE_END.test(text[end] ?? "") || CLOSE_QUOTE.test(text[end] ?? ""))) end += 1;
      if (end > start) out.push({ from: start, to: end });
      start = end;
      i = end;
      continue;
    }
    i += 1;
  }
  if (start < text.length) out.push({ from: start, to: text.length });
  return out;
}

function makeBlock(group: Group, parts: FlatPart[], from: number, to: number, kind: BlockKind): DisplayBlock | null {
  const sliced = sliceParts(parts, from, to);
  if (!sliced.length) return null;
  return {
    group: group.id,
    para: group.paras[0]?.para ?? 0,
    paraEnd: group.paras[group.paras.length - 1]?.para ?? group.id,
    start: sliced[0].start,
    end: sliced[sliced.length - 1].end,
    text: sliced.map((p) => p.text).join(""),
    parts: sliced,
    cont: from > 0,
    kind,
  };
}

/**
 * 主入口。imageAfter 用「前面有几段」的图片锚点集合：禁止跨图片合段，避免图片跑到合并段后面。
 */
export function buildDisplayBlocks(
  paragraphs: string[],
  starts: number[],
  title = "",
  options: ParagraphOptions = DEFAULT_PARAGRAPH_OPTIONS,
  imageAfter?: Set<number>,
  /** 本书手工纠正：段落下标 → 结构类型；覆盖自动识别结果。 */
  kindOverrides?: Record<number, BlockKind>,
): DisplayBlock[] {
  if (!paragraphs.length) return [];
  const opts = normalizeParagraphOptions(options);
  const source: SourcePara[] = paragraphs.map((text, para) => ({
    para,
    start: starts[para] ?? 0,
    end: (starts[para] ?? 0) + text.length,
    text,
  }));

  let first = 0;
  if (opts.mode === "smart" && opts.dedupeTitle && source.length) {
    const a = normalizeTitle(source[0].text);
    const b = normalizeTitle(title);
    if (a && b && Math.abs(a.length - b.length) <= 8 && (a === b || a.includes(b) || b.includes(a))) first = 1;
  }
  if (first >= source.length) return [];

  const specialKinds = classifyParagraphs(paragraphs, opts);
  if (kindOverrides) {
    for (const [key, kind] of Object.entries(kindOverrides)) {
      const i = Number(key);
      if (Number.isInteger(i) && i >= 0 && i < specialKinds.length) specialKinds[i] = kind;
    }
  }
  const groups: Group[] = [];
  let current: Group | null = null;
  for (let i = first; i < source.length; i += 1) {
    const para = source[i];
    if (!para.text) continue;
    const paraKind = specialKinds?.[i] ?? "text";
    let canMerge = false;
    if (current && current.kind === "text" && paraKind === "text" && opts.mode === "smart" && opts.mergeWrapped) {
      const prev = current.paras[current.paras.length - 1];
      const len = prev.text.length;
      canMerge =
        len >= 20 &&
        len <= 100 &&
        !endsSentence(prev.text) &&
        !startsLikeNewParagraph(para.text) &&
        !(imageAfter?.has(prev.para + 1) ?? false);
    }
    if (canMerge && current) current.paras.push(para);
    else {
      current = { id: para.para, paras: [para], kind: paraKind };
      groups.push(current);
    }
  }

  const blocks: DisplayBlock[] = [];
  for (const group of groups) {
    if (opts.mode === "off" || (!opts.splitLong && !opts.splitDialogue) || group.kind !== "text") {
      const { parts } = flatParts(group);
      const block = makeBlock(group, parts, 0, parts.reduce((n, p) => n + p.text.length, 0), group.kind);
      if (block) blocks.push(block);
      continue;
    }
    const { text, parts } = flatParts(group);
    if (!text) continue;
    const sentences = sentenceSpans(text);
    const pieces: Array<{ from: number; to: number; kind: "text" | "dialog"; text: string }> = [];
    for (const span of sentences) {
      const sentenceText = text.slice(span.from, span.to);
      const kind = opts.splitDialogue && OPEN_QUOTE.test(sentenceText[0] ?? "") ? "dialog" : "text";
      const chunks = opts.splitLong ? splitLongSentence(text, span.from, span.to, opts.splitLength) : [span];
      for (const chunk of chunks) pieces.push({ ...chunk, kind, text: text.slice(chunk.from, chunk.to) });
    }
    const queue: Array<{ from: number; to: number; kind: "text" | "dialog"; text: string }> = [];
    const flush = () => {
      if (!queue.length) return;
      const from = queue[0].from;
      const last = queue[queue.length - 1];
      const block = makeBlock(group, parts, from, last.to, queue.some((x) => x.kind === "dialog") ? "dialog" : "text");
      if (block) blocks.push(block);
      queue.length = 0;
    };
    for (const piece of pieces) {
      const currentLen = queue.reduce((n, x) => n + x.text.length, 0);
      if (opts.splitDialogue && piece.kind === "dialog" && currentLen > 0 && queue[queue.length - 1]?.kind !== "dialog") flush();
      if (opts.splitLong && currentLen > 0 && currentLen + piece.text.length > opts.splitLength) flush();
      queue.push(piece);
      if (opts.splitDialogue && piece.kind === "dialog" && CLOSE_QUOTE.test(piece.text[piece.text.length - 1] ?? "")) flush();
    }
    flush();
    // 尾块太短并回上一块，避免章末孤零零一行。
    if (blocks.length >= 2) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (last.group === prev.group && last.kind === "text" && prev.kind === "text" && last.text.length < 24 && prev.text.length + last.text.length <= opts.splitLength * 1.25) {
        blocks.splice(blocks.length - 2, 2, {
          group: prev.group,
          para: prev.para,
          paraEnd: last.paraEnd,
          start: prev.start,
          end: last.end,
          text: prev.text + last.text,
          parts: [...prev.parts, ...last.parts],
          cont: prev.cont,
          kind: "text",
        });
      }
    }
  }
  return blocks;
}

/** 绝对字符偏移 → 显示块下标；换行缝隙归下一块，避免顶部进度落在上一段末尾。 */
export function blockIndexAt(blocks: DisplayBlock[], offset: number): number {
  if (!blocks.length) return 0;
  let lo = 0;
  let hi = blocks.length - 1;
  let answer = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].start <= offset) {
      answer = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const block = blocks[answer];
  if (offset > block.end && answer + 1 < blocks.length && offset < blocks[answer + 1].start) return answer + 1;
  return answer;
}

export function blockIndexForPara(blocks: DisplayBlock[], para: number, starts: number[]): number {
  return blockIndexAt(blocks, starts[para] ?? 0);
}

export function partsForRange(blocks: DisplayBlock[], start: number, end: number): DisplayPart[] {
  const out: DisplayPart[] = [];
  for (const block of blocks) {
    if (block.end <= start) continue;
    if (block.start >= end) break;
    for (const part of block.parts) {
      if (part.end <= start || part.start >= end) continue;
      const a = Math.max(start, part.start);
      const b = Math.min(end, part.end);
      out.push({ para: part.para, start: a, end: b, text: part.text.slice(a - part.start, b - part.start) });
    }
  }
  return out;
}
