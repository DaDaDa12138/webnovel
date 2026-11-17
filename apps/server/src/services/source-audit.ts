import type { BookSource } from "@legado/engine";
import { parseHeader, validateRegexSelector } from "@legado/engine";
import type { SourceAuditIssue, SourceAuditReport, SourceAuditSeverity } from "@legado/shared";

type Stage = SourceAuditIssue["stage"];

const REQUIRED_FIELDS: Array<{ stage: Stage; group: string; field: string; label: string; severity: SourceAuditSeverity }> = [
  { stage: "search", group: "ruleSearch", field: "bookList", label: "搜索结果列表", severity: "error" },
  { stage: "search", group: "ruleSearch", field: "name", label: "书名", severity: "error" },
  { stage: "search", group: "ruleSearch", field: "bookUrl", label: "书籍地址", severity: "error" },
  { stage: "search", group: "ruleSearch", field: "author", label: "作者", severity: "warning" },
  { stage: "explore", group: "ruleExplore", field: "bookList", label: "发现页列表", severity: "error" },
  { stage: "explore", group: "ruleExplore", field: "name", label: "书名", severity: "error" },
  { stage: "explore", group: "ruleExplore", field: "bookUrl", label: "书籍地址", severity: "error" },
  { stage: "toc", group: "ruleToc", field: "chapterList", label: "目录列表", severity: "error" },
  // 引擎在 chapterUrl 为空时回退到目录条目第一个 <a> 的 href，chapterName 为空时
  // 回退到条目文本；缺这两项只影响可维护性，不应该把整条源判成不可用。
  { stage: "toc", group: "ruleToc", field: "chapterName", label: "章节名", severity: "warning" },
  { stage: "toc", group: "ruleToc", field: "chapterUrl", label: "章节地址", severity: "warning" },
  { stage: "content", group: "ruleContent", field: "content", label: "正文规则", severity: "error" },
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ruleGroup(source: BookSource, group: string): Record<string, unknown> {
  const value = source[group];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function push(
  issues: SourceAuditIssue[],
  severity: SourceAuditSeverity,
  stage: Stage,
  field: string,
  code: string,
  message: string,
  sample?: string,
): void {
  issues.push({ code, severity, stage, field, message, ...(sample ? { sample: sample.slice(0, 240) } : {}) });
}

function collectRuleStrings(value: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof value === "string") {
    if (value.trim()) out.push({ path, value });
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectRuleStrings(child, path ? `${path}.${key}` : key, out);
  }
}

/** 截掉 Legado 的 ##正则##替换 尾巴，同时避开字符串和 /##/ 这类正则字面量。 */
function stripReplacement(code: string): string {
  let quote = "";
  let regex = false;
  let inClass = false;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (regex) {
      if (ch === "\\") i += 1;
      else if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) regex = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      const nl = code.indexOf("\n", i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (ch === "/") {
      const prev = code.slice(0, i).trimEnd().slice(-1);
      if (!prev || /[([{=,:;!&|?+\-*%^~<>]/.test(prev)) {
        regex = true;
        inClass = false;
      }
      continue;
    }
    if (ch === "#" && next === "#") return code.slice(0, i);
  }
  return code;
}

function jsSnippets(rule: string): string[] {
  const out: string[] = [];
  const block = /<js>([\s\S]*?)<\/js>/gi;
  let match: RegExpExecArray | null;
  while ((match = block.exec(rule)) !== null) {
    const code = match[1] ?? "";
    // 少数书源把 <js> 当作「替换规则」的容器（<js>##正则##替换</js>），
    // 里面不是 JS，不能送进语法检查。
    if (code.trimStart().startsWith("##")) continue;
    out.push(stripReplacement(code));
  }
  // @js: 后面的代码经常跨多行（目录规则尤其常见），不能只截到行尾，
  // 否则会把多行 if/for 截断成语法错误，制造大量误报。
  const markers: number[] = [];
  let at = rule.indexOf("@js:");
  while (at >= 0) {
    markers.push(at);
    at = rule.indexOf("@js:", at + 4);
  }
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i] + 4;
    const end = markers[i + 1] ?? rule.length;
    // @js: 代码后面可以再接 Legado 的 ##正则##替换 语法；它不属于 JS。
    const tail = rule.slice(start, end);
    if (tail.trimStart().startsWith("##")) continue;
    out.push(stripReplacement(tail));
  }
  return [...new Set(out.filter((code) => code.trim()))];
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && /syntax|unexpected token|invalid/i.test(error.message));
}

function auditJs(issues: SourceAuditIssue[], field: string, rule: string): void {
  for (const raw of jsSnippets(rule)) {
    // Legado 模板 {{...}} 在运行期才会被替换成具体值；静态检查时替换成 0，
    // 否则 if ({{$.x}}) 这种合法规则会被当成语法错误。
    const code = raw.replace(/\{\{[\s\S]*?\}\}/g, "0");
    try {
      // 只检查语法，不执行：书源里的 java.* / result 在运行期才存在。
      // 用 AsyncFunction 编译，允许书源里合法的 await；普通 Function 会把
      // return 之外的多行代码误判。
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => unknown;
      new AsyncFunction(code);
    } catch (error) {
      if (isSyntaxError(error)) {
        push(issues, "error", "source", field, "js_syntax", `JS 语法错误：${error instanceof Error ? error.message : String(error)}`, code);
      }
    }
  }
}

function auditRegex(issues: SourceAuditIssue[], field: string, rule: string): void {
  let from = 0;
  while (from < rule.length) {
    const at = rule.indexOf("@regex:", from);
    if (at < 0) break;
    const lineEnd = rule.indexOf("\n", at);
    const pattern = rule.slice(at + 7, lineEnd < 0 ? rule.length : lineEnd);
    const error = validateRegexSelector(pattern);
    if (error) push(issues, "error", "source", field, "regex_syntax", `@regex 语法错误：${error}`, pattern);
    from = at + 7;
  }
}

function auditHeader(issues: SourceAuditIssue[], header: string): void {
  if (!header.trim()) return;
  try {
    parseHeader(header);
  } catch (error) {
    push(issues, "warning", "source", "header", "header_format", `请求头格式无法解析：${error instanceof Error ? error.message : String(error)}`, header);
  }
}

/** 纯静态书源体检：不发起网络请求，供导入回执、书源详情和启用前拦截共用。 */
export function auditSource(source: BookSource): SourceAuditReport {
  const issues: SourceAuditIssue[] = [];
  const name = text(source.bookSourceName);
  const url = text(source.bookSourceUrl);
  // 842 书山 / 843 大灰狼是内置聚合源，地址是 shushan:// / dhl:// 伪协议，
  // 规则由服务端聚合器提供，不参与静态规则体检。
  if (/^(?:shushan|dhl):\/\//i.test(url)) {
    return {
      ok: true,
      errors: 0,
      warnings: 0,
      infos: 1,
      issues: [
        {
          code: "builtin_source",
          severity: "info",
          stage: "source",
          field: "bookSourceUrl",
          message: "内置聚合源，不走静态书源规则检查",
        },
      ],
    };
  }
  if (!name) push(issues, "error", "source", "bookSourceName", "missing_source_name", "书源缺少名称");
  if (!url) push(issues, "error", "source", "bookSourceUrl", "missing_source_url", "书源缺少地址");

  const searchUrl = text(source.searchUrl);
  const exploreUrl = text(source.exploreUrl);
  if (!searchUrl && !exploreUrl) {
    push(issues, "error", "source", "searchUrl", "missing_search_and_explore", "搜索地址和发现地址都为空，导入后无法使用");
  }
  if (searchUrl) {
    for (const field of REQUIRED_FIELDS.filter((item) => item.stage === "search")) {
      if (!text(ruleGroup(source, field.group)[field.field])) {
        push(issues, field.severity, field.stage, `${field.group}.${field.field}`, "empty_rule", `搜索规则缺少${field.label}（${field.group}.${field.field}）`);
      }
    }
  } else if (Object.values(ruleGroup(source, "ruleSearch")).some((v) => text(v))) {
    push(issues, "warning", "search", "searchUrl", "missing_search_url", "写了搜索规则但 searchUrl 为空，搜索页不会出现");
  }
  if (exploreUrl) {
    // Legado 的发现页会先用 ruleSearch，再用非空的 ruleExplore 覆盖。很多书源只写
    // ruleSearch，发现页直接复用同一套条目规则；不能把空的 ruleExplore 当成硬错误。
    const explore = ruleGroup(source, "ruleExplore");
    const effective = { ...ruleGroup(source, "ruleSearch") };
    for (const [key, value] of Object.entries(explore)) {
      if (text(value)) effective[key] = value;
    }
    for (const field of REQUIRED_FIELDS.filter((item) => item.stage === "explore")) {
      if (!text(effective[field.field])) {
        push(
          issues,
          field.severity,
          field.stage,
          `${field.group}.${field.field}`,
          "empty_rule",
          `发现页规则和搜索规则都缺少${field.label}（${field.group}.${field.field}）`,
        );
      }
    }
  }
  // 音频（type 1）和文件（type 3）不走文本正文规则；文件源通常也没有目录。
  // 这不是书源错误，标 info 让静态体检聚焦在真正可阅读的文本源上。
  const sourceType = Number(source.bookSourceType ?? 0);
  const skipContent = sourceType === 1 || sourceType === 3;
  const skipToc = sourceType === 3;
  if (skipContent || skipToc) {
    push(issues, "info", "source", "bookSourceType", "non_text_source", `type ${sourceType} 非文本阅读源，跳过正文/目录规则检查`);
  }
  // 服务端阅读引擎没有浏览器内核，也没有桌面环境可以拉起外部浏览器。
  // 这类源不是「规则写错」，而是能力不匹配；静态体检先明确标出来，避免反复重试。
  const webviewRule = JSON.stringify(source).match(/java\.(webView|startBrowser)/);
  if (webviewRule) {
    push(
      issues,
      "warning",
      "source",
      "ruleContent",
      "webview_required",
      `规则调用 java.${webviewRule[1]}，需要 WebView/外部浏览器；服务端阅读引擎不支持，相关目录或正文会降级`,
    );
  }
  for (const field of REQUIRED_FIELDS.filter((item) => item.stage === "toc" || item.stage === "content")) {
    if (field.stage === "content" && skipContent) continue;
    if (field.stage === "toc" && skipToc) continue;
    if (!text(ruleGroup(source, field.group)[field.field])) {
      push(issues, field.severity, field.stage, `${field.group}.${field.field}`, "empty_rule", `缺少${field.label}（${field.group}.${field.field}）`);
    }
  }
  if (!text(ruleGroup(source, "ruleBookInfo").name) && Object.values(ruleGroup(source, "ruleBookInfo")).some((v) => text(v))) {
    push(issues, "warning", "bookInfo", "ruleBookInfo.name", "missing_book_name", "详情页写了规则但缺少书名，可能靠搜索页回填");
  }
  if (!text(ruleGroup(source, "ruleContent").nextContentUrl)) {
    // nextContentUrl 为空是常态，不提示。
  } else {
    const next = text(ruleGroup(source, "ruleContent").nextContentUrl);
    if (next.includes("{{") && /(contentUrl|chapterUrl|baseUrl)/.test(next) && !/page/i.test(next)) {
      push(issues, "warning", "content", "ruleContent.nextContentUrl", "next_content_loop_risk", "下一页规则引用了当前页地址但没有页码变量，可能反复抓同一页", next);
    }
  }

  const pattern = text(source.bookUrlPattern);
  if (pattern) {
    try {
      new RegExp(pattern);
    } catch (error) {
      push(issues, "error", "source", "bookUrlPattern", "book_url_pattern", `书籍地址匹配正则无效：${error instanceof Error ? error.message : String(error)}`, pattern);
    }
  }
  auditHeader(issues, text(source.header));

  const rules: Array<{ path: string; value: string }> = [];
  for (const group of ["ruleSearch", "ruleExplore", "ruleBookInfo", "ruleToc", "ruleContent"]) {
    collectRuleStrings(source[group], group, rules);
  }
  for (const rule of rules) {
    auditJs(issues, rule.path, rule.value);
    auditRegex(issues, rule.path, rule.value);
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return { ok: counts.error === 0, errors: counts.error, warnings: counts.warning, infos: counts.info, issues };
}
