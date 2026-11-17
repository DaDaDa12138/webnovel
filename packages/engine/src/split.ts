function isJsOpen(text: string, i: number): boolean {
  // Legado 的 `selector@js:` 没有闭合标签，JS 一直延伸到规则末尾；
  // 不把它当成 JS 段，多行 JS 会被按行拆成选择器，chapterUrl 直接为空。
  return text.startsWith("<js>", i) || text.startsWith("@js:", i);
}

function isJsClose(text: string, i: number): boolean {
  return text.startsWith("</js>", i);
}

/** Split a rule by an operator, ignoring operators inside {{...}} or <js>...</js>. */
export function splitTop(rule: string, sep: string): string[] {
  const parts: string[] = [];
  let braces = 0;
  let js = 0;
  let buf = "";
  for (let i = 0; i < rule.length; i += 1) {
    if (rule.startsWith("{{", i)) {
      braces += 1;
      buf += "{{";
      i += 1;
      continue;
    }
    if (rule.startsWith("}}", i) && braces > 0) {
      braces -= 1;
      buf += "}}";
      i += 1;
      continue;
    }
    if (braces === 0 && isJsOpen(rule, i)) {
      js += 1;
      buf += "<js>";
      i += 3;
      continue;
    }
    if (js > 0 && isJsClose(rule, i)) {
      js -= 1;
      buf += "</js>";
      i += 4;
      continue;
    }
    if (braces === 0 && js === 0 && rule.startsWith(sep, i)) {
      parts.push(buf);
      buf = "";
      i += sep.length - 1;
      continue;
    }
    buf += rule[i];
  }
  parts.push(buf);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Split on newlines only at brace/bracket depth 0, so pretty-printed JSON options stay intact. */
export function splitLinesDeep(rule: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = "";
  for (let i = 0; i < rule.length; i += 1) {
    const ch = rule[i];
    if (quote) {
      buf += ch;
      if (ch === quote && rule[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (rule.startsWith("{{", i)) {
      const end = rule.indexOf("}}", i);
      const chunk = end < 0 ? rule.slice(i) : rule.slice(i, end + 2);
      buf += chunk;
      i += chunk.length - 1;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    if (ch === "\n" && depth <= 0) {
      depth = 0;
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function splitLines(rule: string): string[] {
  const parts: string[] = [];
  let braces = 0;
  let js = 0;
  let buf = "";
  for (let i = 0; i < rule.length; i += 1) {
    if (rule.startsWith("{{", i)) {
      braces += 1;
      buf += "{{";
      i += 1;
      continue;
    }
    if (rule.startsWith("}}", i) && braces > 0) {
      braces -= 1;
      buf += "}}";
      i += 1;
      continue;
    }
    if (braces === 0 && isJsOpen(rule, i)) {
      js += 1;
      buf += "<js>";
      i += 3;
      continue;
    }
    if (js > 0 && isJsClose(rule, i)) {
      js -= 1;
      buf += "</js>";
      i += 4;
      continue;
    }
    if (braces === 0 && js === 0 && rule[i] === "\n") {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += rule[i];
  }
  parts.push(buf);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}
