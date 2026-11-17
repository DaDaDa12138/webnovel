import iconv from "iconv-lite";
import { CookieJar } from "tough-cookie";
import { EngineError } from "./errors.js";
import type { FetchResult } from "./types.js";

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** 字符串按原样发送；对象/数组按 JSON 序列化，并自动补 application/json。 */
  body?: string | Record<string, unknown>;
  charset?: string;
  timeoutMs?: number;
  retry?: number;
  cookieJar?: CookieJar;
  redirect?: "follow" | "manual";
}

/** A single page bigger than this is a broken rule (e.g. an unbounded JSON API dump), not content. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CHARSET_ALIASES: Record<string, string> = {
  gb2312: "gb18030",
  gbk: "gb18030",
  gb18030: "gb18030",
  "x-gbk": "gb18030",
  cp936: "gb18030",
  utf8: "utf8",
  "utf-8": "utf8",
  uft8: "utf8",
  big5: "big5",
  "big5-hkscs": "big5",
  cp950: "big5",
  utf16be: "utf16-be",
  utf16le: "utf16le",
};

/** 把站点声明的字符集名归一成 iconv 认的名字；认不出来返回 null，而不是拿它硬解。 */
export function normalizeCharset(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!key) return null;
  const mapped = CHARSET_ALIASES[key] ?? key;
  return iconv.encodingExists(mapped) ? mapped : null;
}

export function decodeBuffer(buffer: Buffer, charset: string): string {
  const mapped = normalizeCharset(charset) ?? "utf8";
  if (mapped === "utf8") return buffer.toString("utf8");
  try {
    return iconv.decode(buffer, mapped);
  } catch {
    return buffer.toString("utf8");
  }
}

function charsetFrom(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = /charset=([\w-]+)/i.exec(contentType);
  return match ? match[1].toLowerCase() : null;
}

/**
 * 从 HTML 头 4KB 里找 <meta charset> / <meta http-equiv content="…charset=xxx">。
 *
 * 站点自己的 meta 往往比响应头可信：IIS 一类服务器会无条件发 `charset=UTF-8`，正文却是 GBK，
 * 只看响应头就会把整页解成乱码——换源时表现为「书名对不上」被拒绝、目录解析成空。
 */
export function sniffMetaCharset(buffer: Buffer): string | null {
  const head = buffer.subarray(0, 4096).toString("latin1");
  const match = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  return match ? match[1] : null;
}

function bomCharset(buffer: Buffer): { charset: string; skip: number } | null {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return { charset: "utf8", skip: 3 };
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return { charset: "utf16le", skip: 2 };
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return { charset: "utf16-be", skip: 2 };
  return null;
}

function hasHighBytes(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] > 0x7f) return true;
  }
  return false;
}

function isStrictUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

export interface DecodedBody {
  text: string;
  charset: string;
}

/**
 * 决定用哪种编码解一段 HTML/JSON。
 *
 * 优先级：源规则显式写的 charset（Legado 的 `url,{"charset":"gbk"}`）> `<meta charset>`
 * > 响应头 > 猜。两层兜底：
 * - 声明是 UTF-8 但字节不是合法 UTF-8 → 声明是假的，继续往下找；
 * - 字节是合法 UTF-8 且含非 ASCII → 直接按 UTF-8 解（GBK 正文几乎不可能整页都是合法 UTF-8
 *   序列），这样即使 meta/响应头写错也不会解成乱码。
 */
export function decodeResponse(
  buffer: Buffer,
  opts: { ruleCharset?: string | null; headerCharset?: string | null } = {},
): DecodedBody {
  const bom = bomCharset(buffer);
  if (bom) return { text: decodeBuffer(buffer.subarray(bom.skip), bom.charset), charset: bom.charset };

  const rule = normalizeCharset(opts.ruleCharset);
  const meta = normalizeCharset(sniffMetaCharset(buffer));
  const header = normalizeCharset(opts.headerCharset);
  const high = hasHighBytes(buffer);
  const utf8 = high ? isStrictUtf8(buffer) : true;

  let charset: string | null = null;
  if (rule && !(rule === "utf8" && !utf8)) charset = rule;
  if (!charset && meta && !(meta === "utf8" && !utf8)) charset = meta;
  if (!charset && header && !(header === "utf8" && !utf8)) charset = header;
  if (!charset) charset = utf8 ? "utf8" : "gb18030";
  if (!rule && high && utf8) charset = "utf8";

  let text = decodeBuffer(buffer, charset);
  // 最后一层保险：解出替换字符说明这个编码就是错的，换一个能干净解出来的。
  if (text.includes("\uFFFD")) {
    for (const alt of ["gb18030", "big5", "utf8"]) {
      if (alt === charset) continue;
      const candidate = decodeBuffer(buffer, alt);
      if (!candidate.includes("\uFFFD")) {
        text = candidate;
        charset = alt;
        break;
      }
    }
  }
  return { text, charset };
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const retries = Math.max(0, opts.retry ?? 0);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const headers: Record<string, string> = {
        "user-agent": DEFAULT_UA,
        accept: "text/html,application/json,application/xhtml+xml,*/*;q=0.8",
        ...opts.headers,
      };
      // QQ 阅读/番茄的正文接口把 body 写成 JSON 对象（URL 选项里的 body 就是对象）。
      // 以前直接把这个对象交给 fetch，Node 会当成 [object Object]，接口返回
      // “invalid Request Param”；这里统一序列化并补 application/json。
      const jsonBody = opts.body !== undefined && typeof opts.body !== "string";
      const requestBody = typeof opts.body === "string" ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined;
      if (requestBody && (opts.method ?? "GET").toUpperCase() === "POST" && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["content-type"] = jsonBody ? "application/json" : "application/x-www-form-urlencoded";
      }
      if (opts.cookieJar) {
        const cookie = await opts.cookieJar.getCookieString(url);
        if (cookie) headers.cookie = cookie;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: opts.method ?? "GET",
          headers,
          body: requestBody,
          redirect: opts.redirect ?? "follow",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (opts.cookieJar) {
        const setCookies = response.headers.getSetCookie?.() ?? [];
        for (const cookie of setCookies) {
          try {
            await opts.cookieJar.setCookie(cookie, url);
          } catch {
            /* ignore invalid cookie */
          }
        }
      }

      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BODY_BYTES) {
        throw new EngineError("TOO_LARGE", `response too large (${declared} bytes): ${url}`);
      }
      // fetch 只等到响应头就 resolve；大 JSON/慢速流式响应会把 arrayBuffer() 拖很久。
      // 计时器必须覆盖读 body，否则 timeoutMs 形同虚设（多看阅读详情 32 秒才读完）。
      let buffer: Buffer;
      const bodyTimer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        buffer = Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(bodyTimer);
      }
      if (buffer.byteLength > MAX_BODY_BYTES) {
        throw new EngineError("TOO_LARGE", `response too large (${buffer.byteLength} bytes): ${url}`);
      }
      const decoded = decodeResponse(buffer, {
        ruleCharset: opts.charset,
        headerCharset: charsetFrom(response.headers.get("content-type")),
      });
      const body = decoded.text;
      const headerObj: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headerObj[key] = value;
      });
      return { url: response.url || url, status: response.status, body, headers: headerObj, charset: decoded.charset };
    } catch (err) {
      // Size limits are a rule/design problem, not a flaky network: do not retry them.
      if (err instanceof EngineError && err.code === "TOO_LARGE") throw err;
      lastError = err;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  if (message.includes("aborted") || message.includes("timeout")) {
    throw new EngineError("TIMEOUT", `timeout after ${timeoutMs}ms: ${url}`);
  }
  throw new EngineError("NET_ERROR", `request failed: ${url}: ${message}`);
}
