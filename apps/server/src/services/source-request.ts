import { fetchText, parseHeader } from "@legado/engine";
import type { DB } from "../db/index.js";

export interface SourceRequestSettings {
  header: string;
  loginUrl: string;
  enabledCookieJar: boolean;
}

export interface SourceRequestProbe {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number;
  ms: number;
  bytes: number;
  charset: string;
  title: string;
  excerpt: string;
  loginState: "ok" | "login" | "blocked" | "unknown";
  loginReason: string;
  setCookie: boolean;
  error?: string;
}

const HOP_BY_HOP = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade"]);

/**
 * header 既支持 Legado 的 `Key: Value` 多行，也支持 JSON。
 * parseHeader 对坏格式只会返回空对象，所以这里额外检查“写了内容但一个键都没解析出来”。
 */
export function validateSourceHeader(header: string): string | null {
  const text = header.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as unknown;
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "header 是 JSON 时必须是一个对象";
      if (!Object.keys(obj as Record<string, unknown>).length) return "header JSON 不能为空对象";
      return null;
    } catch {
      return "header 不是合法 JSON";
    }
  }
  const parsed = parseHeader(text);
  const keys = Object.keys(parsed).filter((key) => !HOP_BY_HOP.has(key.toLowerCase()));
  if (!keys.length) return "没有解析出任何请求头，请用 Key: Value 每行一个";
  return null;
}

export function readSourceRequestSettings(source: Record<string, unknown>): SourceRequestSettings {
  return {
    header: typeof source.header === "string" ? source.header : "",
    loginUrl: typeof source.loginUrl === "string" ? source.loginUrl : "",
    enabledCookieJar: source.enabledCookieJar !== false,
  };
}

export function updateSourceRequestSettings(db: DB, id: number, patch: Partial<SourceRequestSettings>): SourceRequestSettings {
  const row = db.prepare("SELECT json FROM book_sources WHERE id = ?").get(id) as { json: string } | undefined;
  if (!row) throw new Error("not_found");
  const json = JSON.parse(row.json) as Record<string, unknown>;
  if (patch.header !== undefined) {
    if (patch.header.trim()) json.header = patch.header.trim();
    else delete json.header;
  }
  if (patch.loginUrl !== undefined) {
    if (patch.loginUrl.trim()) json.loginUrl = patch.loginUrl.trim();
    else delete json.loginUrl;
  }
  if (patch.enabledCookieJar !== undefined) json.enabledCookieJar = patch.enabledCookieJar;
  db.prepare("UPDATE book_sources SET json = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(json), id);
  return readSourceRequestSettings(json);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function pageTitle(body: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  return match ? decodeEntities(match[1].replace(/\s+/g, " ").trim()).slice(0, 120) : "";
}

function pageExcerpt(body: string): string {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeEntities(text).slice(0, 180);
}

const LOGIN_MARKERS = ["请先登录", "请登录后", "登录后查看", "登录后阅读", "会员专享", "购买本章", "sign in to continue"];

/**
 * 登录态只能“探测”，不能真正验证：站点没有统一约定。
 * 这里只报告可复核的信号，避免把“页面上有登录按钮”误判成未登录。
 */
function classifyLogin(status: number, finalUrl: string, originalUrl: string, body: string, title: string, loginUrl: string) {
  if (status === 401 || status === 403) {
    return { loginState: "blocked" as const, loginReason: `HTTP ${status}，站点拒绝了当前请求` };
  }
  const lowered = (title + " " + body.slice(0, 6000)).toLowerCase();
  const hit = LOGIN_MARKERS.find((marker) => lowered.includes(marker.toLowerCase()));
  if (hit) return { loginState: "login" as const, loginReason: `页面出现「${hit}」` };
  const finalPath = finalUrl.toLowerCase();
  const loginPath = loginUrl ? loginUrl.toLowerCase() : "";
  const looksLikeLogin = /\/(login|signin|sign-in|passport|auth)(\/|\?|$)/.test(finalPath);
  if (looksLikeLogin && finalUrl !== originalUrl) {
    return { loginState: "login" as const, loginReason: loginPath && finalPath.startsWith(loginPath) ? "被重定向到配置的登录页" : "被重定向到登录页" };
  }
  if (status >= 200 && status < 400) {
    return { loginState: "ok" as const, loginReason: "页面可访问，未发现登录拦截" };
  }
  return { loginState: "unknown" as const, loginReason: `HTTP ${status}，无法判断登录态` };
}

export async function probeSourceAccess(source: Record<string, unknown>, inputUrl?: string): Promise<SourceRequestProbe> {
  const settings = readSourceRequestSettings(source);
  const target = (inputUrl ?? "").trim() || settings.loginUrl || String(source.bookSourceUrl ?? "") || String(source.searchUrl ?? "");
  if (!target) {
    return {
      ok: false, url: "", finalUrl: "", status: 0, ms: 0, bytes: 0, charset: "", title: "", excerpt: "",
      loginState: "unknown", loginReason: "这个源没有可探测的地址", setCookie: false, error: "missing_url",
    };
  }
  const started = Date.now();
  try {
    const res = await fetchText(target, { headers: parseHeader(settings.header), timeoutMs: 12_000, retry: 0 });
    const title = pageTitle(res.body);
    const excerpt = pageExcerpt(res.body);
    const login = classifyLogin(res.status, res.url, target, res.body, title, settings.loginUrl);
    return {
      ok: res.status >= 200 && res.status < 400,
      url: target,
      finalUrl: res.url,
      status: res.status,
      ms: Date.now() - started,
      bytes: Buffer.byteLength(res.body, "utf8"),
      charset: res.charset ?? "",
      title,
      excerpt,
      setCookie: Boolean(res.headers["set-cookie"]),
      ...login,
    };
  } catch (err) {
    return {
      ok: false, url: target, finalUrl: "", status: 0, ms: Date.now() - started, bytes: 0, charset: "",
      title: "", excerpt: "", loginState: "unknown", loginReason: "请求失败", setCookie: false,
      error: String((err as Error)?.message ?? err),
    };
  }
}
