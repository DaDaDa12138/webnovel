import { evalJsoupRule, queryHtml } from "./html.js";
import { queryJson, parseJson } from "./jsonpath.js";
import { queryXpath } from "./xpath.js";
import { runJsSync } from "./js.js";
import type { BookSource, BookInfo, Chapter } from "./types.js";

export interface TemplateContext {
  html: string;
  /** 整页 HTML：条目上下文里的 html 只是自己那段，Legado 的 `src` 变量要的是整页。 */
  docHtml?: string;
  json: unknown;
  text: string;
  url: string;
  baseUrl: string;
  vars: Record<string, string>;
  book?: Partial<BookInfo>;
  chapter?: Partial<Chapter>;
  source?: BookSource;
}

export interface JsEvaluator {
  eval(code: string, ctx: TemplateContext & { result: unknown }): Promise<unknown>;
}

const INNER = /\{\{([^{}]*)\}\}/;

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function evaluate(expr: string, ctx: TemplateContext, js: JsEvaluator | undefined, result: unknown): Promise<string> {
  const code = expr.trim();
  if (!code) return "";
  if (code.includes("##") && /^[$@]/.test(code)) {
    const idx = code.indexOf("##");
    const head = code.slice(0, idx);
    const rest = code.slice(idx + 2).split("##");
    const base = await evaluate(head, ctx, js, result);
    const pattern = rest[0] ?? "";
    const replacement = rest[1] ?? "";
    const global = (rest[2] ?? "").includes("#");
    try {
      return base.replace(new RegExp(pattern, global ? "g" : ""), replacement);
    } catch {
      return base;
    }
  }
  if (code.startsWith("@@")) {
    // `@@` inside {{...}} means "parse as a rule, not as JS" ({{@@class.book@text}}).
    // `##正则` 后缀要作用在取到的文本上，不能连进选择器（否则 cheerio 抛 Unmatched selector）。
    const raw = code.slice(2).trim();
    const hashAt = raw.indexOf("##");
    const inner = hashAt >= 0 ? raw.slice(0, hashAt).trim() : raw;
    const evaluate = (sel: string): string => {
      if (sel.startsWith("@css:")) return queryHtml(ctx.html, sel.slice(5)).join("\n");
      if (sel.startsWith("@xpath:") || sel.startsWith("@XPath:")) return queryXpath(sel.slice(7), ctx.html).join("\n");
      if (sel.startsWith("@json:")) return queryJson(sel.slice(6), ctx.json ?? parseJson(ctx.html)).join("\n");
      if (sel.startsWith("$")) return queryJson(sel, ctx.json ?? parseJson(ctx.html)).join("\n");
      if (ctx.json !== null && ctx.json !== undefined) {
        const values = queryJson(sel, ctx.json);
        if (values.length) return values.join("\n");
      }
      const jsoup = evalJsoupRule(sel, ctx.html);
      if (jsoup.length) return jsoup.join("\n");
      try {
        return queryHtml(ctx.html, sel).join("\n");
      } catch {
        return "";
      }
    };
    const value = evaluate(inner);
    if (hashAt < 0) return value;
    const [pattern, replacement = ""] = raw.slice(hashAt + 2).split("##");
    try {
      return value.replace(new RegExp(pattern, "g"), replacement);
    } catch {
      return value;
    }
  }
  if (code.startsWith("@css:")) return queryHtml(ctx.html, code.slice(5)).join("\n");
  if (code.startsWith("@xpath:") || code.startsWith("@XPath:")) return queryXpath(code.slice(7), ctx.html).join("\n");
  if (code.startsWith("@json:")) {
    const json = ctx.json ?? parseJson(ctx.html);
    return queryJson(code.slice(6), json).join("\n");
  }
  if (code.startsWith("$")) {
    const json = ctx.json ?? parseJson(ctx.html);
    return queryJson(code, json).join("\n");
  }
  if (/^[A-Za-z_][\w]*$/.test(code) && Object.prototype.hasOwnProperty.call(ctx.vars, code)) {
    return ctx.vars[code] ?? "";
  }
  if (!js) {
    // No async evaluator supplied (e.g. a plain evalField call): fall back to the
    // synchronous sandbox so template expressions never silently render as "".
    return stringify(
      runJsSync(code, {
        result,
        json: ctx.json,
        html: ctx.html,
        src: ctx.docHtml ?? ctx.html,
        text: ctx.text,
        url: ctx.url,
        baseUrl: ctx.baseUrl,
        book: ctx.book,
        chapter: ctx.chapter,
        source: ctx.source,
        vars: ctx.vars,
      }),
    );
  }
  return stringify(await js.eval(code, { ...ctx, result }));
}

/** Render {{...}} placeholders, innermost first, at most 5 passes.
 *  result 默认取 JSON 响应（JSON 书源里 {{result.xxx}} 引用的是响应对象），
 *  否则退回上一行规则的文本结果 —— 详情页 init 返回的对象就靠这条链路向下传递。 */
export async function renderTemplate(input: string, ctx: TemplateContext, js?: JsEvaluator, result?: unknown): Promise<string> {
  // Legado 允许在 URL 里直接写 `@get:{xid}`（472 猪猪小说），它不是 {{...}}
  // 模板，而是取上一次 @put 存下的变量。
  let text = input.replace(/@get:(?:\{([^{}]+)\}|([A-Za-z_][\w]*))/g, (_m, braced, bare) => {
    const key = String(braced ?? bare ?? "").trim();
    return ctx.vars[key] ?? "";
  });
  const base = result ?? (ctx.json !== null && ctx.json !== undefined ? ctx.json : ctx.text);
  for (let i = 0; i < 5; i += 1) {
    const match = INNER.exec(text);
    if (!match || match.index === undefined) break;
    const value = await evaluate(match[1], ctx, js, base);
    text = text.slice(0, match.index) + value + text.slice(match.index + match[0].length);
  }
  return text;
}
