export interface CssQuery {
  selector: string;
  index: { start: number; end?: number } | null;
  accessors: string[];
}

function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "[" || ch === "(") depth += 1;
    if (ch === "]" || ch === ")") depth -= 1;
    if (depth === 0 && text.startsWith(sep, i)) {
      parts.push(buf);
      buf = "";
      i += sep.length - 1;
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

function transformToken(token: string): string {
  if (token === "children") return "> *";
  // Legado 的 class. 后面可以跟多个 class（`class.article-content font16`），
  // jsoup 的 getElementsByClass 也按空格拆成「同时具备」；直接拼成 `.a b` 会变成
  // 后代选择器，34 SF轻小说的正文因此整章为空。
  if (token.startsWith("class.")) {
    const classes = token.slice(6).trim().split(/\s+/).filter(Boolean);
    return classes.map((name) => `.${name}`).join("");
  }
  if (token.startsWith("id.")) return "#" + token.slice(3).trim();
  if (token.startsWith("tag.")) return token.slice(4).trim();
  if (token.startsWith("text.")) return `:contains("${token.slice(5).trim()}")`;
  return token;
}

export function parseJsoupSelector(rule: string): CssQuery {
  const raw = rule.trim();
  const segments = splitTopLevel(raw, "@");
  const selectorPart = segments[0].trim();
  const accessors = segments.slice(1).map((s) => s.trim()).filter(Boolean);

  // `class.article-content font16` 里的空格属于 class 值，不是后代组合符。
  // 必须先于按空格切分处理，否则会变成 `.article-content font16`。
  if (/^class\.[^@]+$/.test(selectorPart) && /\s/.test(selectorPart)) {
    const classes = selectorPart.slice(6).trim().split(/\s+/).filter(Boolean);
    return { selector: classes.map((name) => `.${name}`).join(""), index: null, accessors };
  }

  const parts = splitTopLevel(selectorPart, " ");
  let index: CssQuery["index"] = null;
  const tokens: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const prefixIdx = /^(class|id|tag|text)\.(.+)\.(-?\d+)(?::(-?\d+))?(?::(-?\d+))?$/.exec(trimmed);
    if (prefixIdx && !/\s/.test(prefixIdx[2])) {
      tokens.push(transformToken(`${prefixIdx[1]}.${prefixIdx[2]}`));
      index = { start: Number(prefixIdx[3]), end: prefixIdx[4] !== undefined ? Number(prefixIdx[4]) : undefined };
      continue;
    }
    const dotIdx = /^([A-Za-z][\w-]*)\.(-?\d+)(?::(-?\d+))?(?::(-?\d+))?$/.exec(trimmed);
    if (dotIdx) {
      tokens.push(transformToken(dotIdx[1]));
      index = { start: Number(dotIdx[2]), end: dotIdx[3] !== undefined ? Number(dotIdx[3]) : undefined };
      continue;
    }
    const idxMatch = /^(.*?)\[(-?\d+)(?::(-?\d+))?\]$/.exec(trimmed);
    if (idxMatch && idxMatch[1] !== undefined && !idxMatch[1].includes("=")) {
      const start = Number(idxMatch[2]);
      const end = idxMatch[3] !== undefined ? Number(idxMatch[3]) : undefined;
      index = { start, end };
      if (idxMatch[1]) tokens.push(transformToken(idxMatch[1]));
      continue;
    }
    const colonIdx = /^(.*?[^:]):(-?\d+)$/.exec(trimmed);
    if (colonIdx && colonIdx[1] && !colonIdx[1].endsWith(":")) {
      tokens.push(transformToken(colonIdx[1]));
      index = { start: Number(colonIdx[2]) };
      continue;
    }
    if (trimmed.includes("!")) {
      const [positive, ...negatives] = splitTopLevel(trimmed, "!");
      if (positive) tokens.push(transformToken(positive.trim()));
      const appendPseudo = (pseudo: string) => {
        if (tokens.length) tokens[tokens.length - 1] += pseudo;
        else tokens.push(`*${pseudo}`);
      };
      for (const neg of negatives) {
        const text = neg.trim();
        if (/^-?\d+$/.test(text)) {
          // Legado 的 !N 排除第 N 个（0 起），!-1 排除最后一个——目录规则里
          // `ul@li!-1@a` 极常见（最后一项往往是「展开全部」之类的导航）。
          const n = Number(text);
          appendPseudo(n < 0 ? `:not(:nth-last-child(${-n}))` : `:not(:nth-child(${n + 1}))`);
        } else {
          appendPseudo(`:not(${transformToken(text)})`);
        }
      }
      continue;
    }
    tokens.push(transformToken(trimmed));
  }

  return { selector: tokens.join(" ").trim(), index, accessors };
}
