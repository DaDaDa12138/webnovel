import crypto from "node:crypto";
import type { BookInfo, BookSource, Chapter, ExploreGroup, SearchBook } from "@legado/engine";
import { htmlToText, normalizeText } from "@legado/engine";
import type { DahuilangExploreState, DahuilangGender, DahuilangMode } from "@legado/shared";
import { getDb } from "../db/index.js";
import { getSetting } from "./settings.js";

/**
 * 大灰狼融合 VIP 5.0 内置源。
 *
 * 和书山聚合一样，它不是规则书源：loginUrl / searchUrl / exploreUrl 都是打包混淆过的
 * JS，规则引擎跑不了，也不该跑。它真正做的是「带 qttoken 调 langge.uk 的聚合接口」，
 * 所以这里用 HTTP 复刻协议，book_sources 里只留一行 dhl://builtin 占位。
 *
 * 搜索、详情、目录可以匿名；正文每天只有 3 次免登录额度，之后必须登录。正文接口
 * 返回的 code 仍是 0 以外的 -1，HTTP 状态却是 200，必须按 msg 识别成「要登录」，
 * 不能当成普通抓取失败去自动换源。
 */

export const DAHUILANG_URL = "dhl://builtin";
export const DAHUILANG_NAME = "大灰狼聚合";
export const DEFAULT_DAHUILANG_SERVER = "https://v5.langge.uk";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const REQUEST_TIMEOUT_MS = 20_000;
const SEARCH_TTL_MS = 5 * 60_000;
const MAX_SEARCH_RESULTS = 120;
const PER_SOURCE_LIMIT = 8;

/** 书源 jsLib 里的线路表：主线路故障时按顺序换。 */
export const DAHUILANG_HOSTS = [
  "https://v5.langge.uk",
  "http://219.154.201.122:5006",
  "https://v4.langge.uk",
  "https://v2.langge.uk",
  "https://v7.langge.uk",
  "https://v8.langge.uk",
  "https://v9.langge.uk",
  "https://v10.langge.uk",
];

export class DahuilangLoginError extends Error {
  readonly code = "login_required";
  constructor(message: string) {
    super(message);
    this.name = "DahuilangLoginError";
  }
}

export class DahuilangVipError extends Error {
  readonly code = "vip_required";
  constructor(message: string) {
    super(message);
    this.name = "DahuilangVipError";
  }
}

export function isDahuilangLoginError(err: unknown): err is DahuilangLoginError {
  return err instanceof Error && (err as { code?: string }).code === "login_required";
}

export function isDahuilangVipError(err: unknown): err is DahuilangVipError {
  return err instanceof Error && (err as { code?: string }).code === "vip_required";
}

export function isDahuilangSource(source: { bookSourceUrl?: string } | null | undefined): boolean {
  return String(source?.bookSourceUrl ?? "").startsWith("dhl://");
}

// ---------------------------------------------------------------- settings

function putSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export interface DahuilangAuth {
  server: string;
  token: string;
  deviceId: string;
  email: string;
  nickname: string;
  member: boolean;
  vipLabel: string;
}

/** 用户可能只填 v5.langge.uk，也可能贴了带尾斜杠的地址。 */
export function normalizeDahuilangServer(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return DEFAULT_DAHUILANG_SERVER;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : "https://" + value;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_DAHUILANG_SERVER;
    const path = url.pathname.replace(/\/+$/, "");
    return url.origin + path;
  } catch {
    return DEFAULT_DAHUILANG_SERVER;
  }
}

export function dahuilangAuth(): DahuilangAuth {
  return {
    server: normalizeDahuilangServer(getSetting("dhlServer", "")),
    token: getSetting("dhlToken", ""),
    deviceId: getSetting("dhlDeviceId", ""),
    email: getSetting("dhlEmail", ""),
    nickname: getSetting("dhlNickname", ""),
    member: getSetting("dhlMember", "") === "1",
    vipLabel: getSetting("dhlVipLabel", ""),
  };
}

export function dahuilangConfigured(): boolean {
  const auth = dahuilangAuth();
  return Boolean(auth.token && auth.deviceId);
}

export function saveDahuilangAuth(patch: Partial<DahuilangAuth>): void {
  if (patch.server !== undefined) putSetting("dhlServer", normalizeDahuilangServer(patch.server));
  if (patch.token !== undefined) putSetting("dhlToken", patch.token);
  if (patch.deviceId !== undefined) putSetting("dhlDeviceId", patch.deviceId);
  if (patch.email !== undefined) putSetting("dhlEmail", patch.email);
  if (patch.nickname !== undefined) putSetting("dhlNickname", patch.nickname);
  if (patch.member !== undefined) putSetting("dhlMember", patch.member ? "1" : "0");
  if (patch.vipLabel !== undefined) putSetting("dhlVipLabel", patch.vipLabel);
}

/** 退出只清账号，保留线路与设备号：设备号变了可能触发上游的设备上限。 */
export function clearDahuilangAuth(): void {
  saveDahuilangAuth({ token: "", email: "", nickname: "", member: false, vipLabel: "" });
}

export function ensureDahuilangDeviceId(): string {
  const current = dahuilangAuth().deviceId;
  if (current.length >= 8) return current;
  const deviceId = crypto.randomBytes(8).toString("hex");
  saveDahuilangAuth({ deviceId });
  return deviceId;
}

// ---------------------------------------------------------------- transport

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 登录过程中 token 还没写进设置，显式传进来。 */
  token?: string;
  deviceId?: string;
  server?: string;
  /** 正文接口按书源 jsLib 的线路表自动换线。 */
  allowFailover?: boolean;
}

function headers(token: string, deviceId: string): Record<string, string> {
  const out: Record<string, string> = {
    "User-Agent": UA,
    "Content-Type": "application/json",
  };
  const cookie = [token ? "qttoken=" + token : "", deviceId ? "deviceId=" + deviceId : ""].filter(Boolean).join("; ");
  if (cookie) out.Cookie = cookie;
  return out;
}

/** 正文可能是 hex(JSON)，也可能直接是 JSON；先按 hex 尝试一次，失败就原样返回。 */
export function decodeDahuilangPayload(raw: string): string {
  const text = String(raw ?? "").trim();
  if (text.length > 16 && text.length % 2 === 0 && /^[0-9a-f]+$/i.test(text)) {
    try {
      const decoded = Buffer.from(text, "hex").toString("utf8").trim();
      if (decoded) return decoded;
    } catch {
      /* 不是 hex 就按原文处理 */
    }
  }
  return text;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(decodeDahuilangPayload(text)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function uniqueServers(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const server = normalizeDahuilangServer(item);
    if (seen.has(server)) continue;
    seen.add(server);
    out.push(server);
  }
  return out;
}

async function requestJson(path: string, init: RequestOptions = {}): Promise<Record<string, unknown>> {
  const auth = dahuilangAuth();
  const token = init.token ?? auth.token;
  const deviceId = init.deviceId ?? auth.deviceId;
  const servers = uniqueServers(
    init.allowFailover ? [init.server ?? auth.server, ...DAHUILANG_HOSTS] : [init.server ?? auth.server],
  );
  let lastError: unknown = null;
  for (const server of servers) {
    try {
      const response = await fetch(server + path, {
        method: init.method ?? "GET",
        headers: headers(token, deviceId),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      const parsed = parseJson(text);
      if (!parsed) throw new Error("大灰狼聚合返回了非 JSON 内容，站点可能正在维护");
      if (!response.ok) {
        const message = String(parsed.msg ?? parsed.message ?? "HTTP " + response.status);
        throw new Error("大灰狼聚合：" + message);
      }
      // 自动换线成功后记住新线路，下次不用再从坏线路开始。
      if (server !== auth.server) putSetting("dhlServer", server);
      return parsed;
    } catch (err) {
      lastError = err;
      if (isDahuilangLoginError(err) || isDahuilangVipError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("大灰狼聚合：线路都连不上");
}

// ---------------------------------------------------------------- encoding

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

export interface DahuilangBookPayload {
  /** 上游 book_id，本身是 base64 的数字串。 */
  b: string;
  /** 源站名，例如「番茄」「七猫」。 */
  s: string;
  /** 小说 / 听书 / 漫画 / 短剧。 */
  t: string;
  n: string;
  a: string;
  c: string;
  d: string;
  w: string;
  l: string;
  k: string;
}

export function encodeDahuilangBookUrl(payload: DahuilangBookPayload): string {
  return "dhl:" + b64url(JSON.stringify(payload));
}

export function decodeDahuilangBookUrl(bookUrl: string): DahuilangBookPayload | null {
  if (!bookUrl.startsWith("dhl:")) return null;
  try {
    const parsed = JSON.parse(unb64url(bookUrl.slice(4))) as Partial<DahuilangBookPayload>;
    if (!parsed || typeof parsed.b !== "string" || !parsed.b || typeof parsed.s !== "string" || !parsed.s) return null;
    return {
      b: parsed.b,
      s: parsed.s,
      t: String(parsed.t ?? "小说"),
      n: String(parsed.n ?? ""),
      a: String(parsed.a ?? ""),
      c: String(parsed.c ?? ""),
      d: String(parsed.d ?? ""),
      w: String(parsed.w ?? ""),
      l: String(parsed.l ?? ""),
      k: String(parsed.k ?? ""),
    };
  } catch {
    return null;
  }
}

export interface DahuilangChapterPayload {
  b: string;
  i: string;
  s: string;
  t: string;
  n: string;
}

export function encodeDahuilangChapterUrl(payload: DahuilangChapterPayload): string {
  return "dhlc:" + b64url(JSON.stringify(payload));
}

export function decodeDahuilangChapterUrl(chapterUrl: string): DahuilangChapterPayload | null {
  if (!chapterUrl.startsWith("dhlc:")) return null;
  try {
    const parsed = JSON.parse(unb64url(chapterUrl.slice(5))) as Partial<DahuilangChapterPayload>;
    if (!parsed || typeof parsed.b !== "string" || !parsed.b || typeof parsed.i !== "string" || !parsed.i) return null;
    return {
      b: parsed.b,
      i: parsed.i,
      s: String(parsed.s ?? ""),
      t: String(parsed.t ?? "") || "小说",
      n: String(parsed.n ?? ""),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- helpers

function textOf(value: unknown): string {
  return String(value ?? "").trim();
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanKind(raw: unknown): string {
  const tags = textOf(raw)
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  return tags.join(" · ");
}

function errorMessage(payload: Record<string, unknown>): string {
  return textOf(payload.msg) || textOf(payload.message) || textOf(payload.error);
}

function contentOf(payload: Record<string, unknown>): string {
  if (typeof payload.content === "string") return payload.content;
  const data = payload.data;
  if (data && typeof data === "object" && typeof (data as Record<string, unknown>).content === "string") {
    return String((data as Record<string, unknown>).content);
  }
  if (typeof data === "string") return data;
  return "";
}

/** 上游把登录失败也放在 code:-1 + HTTP 200 里，必须按文案识别。 */
function throwContentError(payload: Record<string, unknown>): never {
  const message = errorMessage(payload);
  if (/免登录|请登录|登录后|登录.*刷新|次数/.test(message) || Number(payload.code) === -1) {
    throw new DahuilangLoginError(
      message || "大灰狼聚合：今日免登录次数已用完，请到「设置 → 大灰狼聚合」登录后继续阅读",
    );
  }
  if (/VIP|会员|购买|付费/.test(message)) {
    throw new DahuilangVipError("大灰狼聚合：" + (message || "这本书需要 VIP 会员"));
  }
  throw new Error("大灰狼聚合：" + (message || "这一章没有返回正文"));
}

function userOf(payload: Record<string, unknown>): Record<string, unknown> | null {
  const data = payload.data;
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    if (nested.user && typeof nested.user === "object") return nested.user as Record<string, unknown>;
    if (nested.id || nested.user_key) return nested;
  }
  if (payload.user && typeof payload.user === "object") return payload.user as Record<string, unknown>;
  if (payload.id || payload.user_key) return payload;
  return null;
}

function vipOf(user: Record<string, unknown>): { member: boolean; vipLabel: string } {
  const rawEnd = Number(user.vip_end_time ?? 0);
  const endMs = rawEnd > 1e12 ? rawEnd : rawEnd * 1000;
  const permanent = rawEnd > 1_912_946_812;
  const active = permanent || (endMs > 0 && endMs > Date.now());
  const level = Number(user.vip_level ?? 0);
  const member = active || level > 0 || truthy(user.is_vip) || truthy(user.is_member);
  if (!member) return { member: false, vipLabel: "" };
  return { member: true, vipLabel: level >= 2 ? "SVIP" : "VIP" };
}

function applyUser(user: Record<string, unknown>, fallbackEmail = ""): void {
  const email = textOf(user.email) || fallbackEmail;
  const nickname = textOf(user.nickname) || textOf(user.name) || email;
  saveDahuilangAuth({
    email,
    nickname,
    ...vipOf(user),
  });
}

// ---------------------------------------------------------------- login

async function fetchUser(server: string, token: string, deviceId: string): Promise<Record<string, unknown>> {
  const payload = await requestJson("/user_api", { method: "POST", server, token, deviceId });
  if (payload.code !== undefined && Number(payload.code) !== 0) {
    throw new Error("大灰狼聚合登录失败：" + (errorMessage(payload) || "密钥无效或已过期"));
  }
  const user = userOf(payload);
  if (!user) throw new Error("大灰狼聚合登录失败：返回内容里没有账号信息");
  return user;
}

/** 邮箱密码登录：POST /login_api 换 key，再带 qttoken 拉一次账号信息。 */
export async function dahuilangLogin(email: string, password: string): Promise<DahuilangAuth> {
  const address = email.trim();
  const secret = password.trim();
  if (!address || !secret) throw new Error("请填写大灰狼聚合的邮箱与密码");
  const server = dahuilangAuth().server;
  const deviceId = ensureDahuilangDeviceId();
  const payload = await requestJson("/login_api", {
    method: "POST",
    server,
    deviceId,
    body: { register_email: address, password: secret },
  });
  if (Number(payload.code) !== 0) {
    throw new Error("大灰狼聚合登录失败：" + (errorMessage(payload) || "邮箱或密码不正确"));
  }
  const key = textOf(payload.key) || textOf((payload.data as Record<string, unknown> | undefined)?.key);
  if (!key) throw new Error("大灰狼聚合登录失败：没有拿到密钥");
  const user = await fetchUser(server, key, deviceId);
  saveDahuilangAuth({ token: key, deviceId, server });
  applyUser(user, address);
  return dahuilangAuth();
}

/** 密钥登录：直接把 qttoken 填进 Cookie，再用 /user_api 校验。 */
export async function dahuilangLoginWithKey(key: string): Promise<DahuilangAuth> {
  const token = key.trim();
  if (!token) throw new Error("请填写大灰狼聚合密钥");
  const server = dahuilangAuth().server;
  const deviceId = ensureDahuilangDeviceId();
  const user = await fetchUser(server, token, deviceId);
  saveDahuilangAuth({ token, deviceId, server });
  applyUser(user);
  return dahuilangAuth();
}

// ---------------------------------------------------------------- search

interface DahuilangSearchItem {
  book_name?: string;
  book_id?: string;
  author?: string;
  word_number?: string;
  last_chapter_title?: string;
  category?: string;
  tags?: string;
  abstract?: string;
  thumb_url?: string;
  tab?: string;
  source?: string;
}

const searchCache = new Map<string, { at: number; value: SearchBook[] }>();

export async function dahuilangSearch(key: string): Promise<SearchBook[]> {
  const word = key.trim();
  if (!word) return [];
  const server = dahuilangAuth().server;
  const cacheKey = server + "|" + word;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.value;

  const query = new URLSearchParams({
    title: word,
    tab: "小说",
    source: "全部",
    page: "1",
    disabled_sources: "0",
  });
  const payload = await requestJson("/search?" + query.toString(), { server });
  const rows = Array.isArray(payload.data) ? (payload.data as unknown as DahuilangSearchItem[]) : [];
  const perSource = new Map<string, number>();
  const books: SearchBook[] = [];
  for (const row of rows) {
    const name = textOf(row.book_name);
    const bookId = textOf(row.book_id);
    const source = textOf(row.source);
    const tab = textOf(row.tab) || "小说";
    // 上游搜不到时会塞一条「没有找到…」占位；听书/漫画/短剧在文字阅读器里读不了。
    if (!name || !bookId || !source || name.startsWith("没有找到")) continue;
    if (tab !== "小说") continue;
    const used = perSource.get(source) ?? 0;
    if (used >= PER_SOURCE_LIMIT) continue;
    perSource.set(source, used + 1);
    const kind = cleanKind(row.tags) || cleanKind(row.category);
    books.push({
      name,
      author: textOf(row.author),
      bookUrl: encodeDahuilangBookUrl({
        b: bookId,
        s: source,
        t: tab,
        n: name,
        a: textOf(row.author),
        c: textOf(row.thumb_url),
        d: textOf(row.abstract),
        w: textOf(row.word_number),
        l: textOf(row.last_chapter_title),
        k: kind,
      }),
      coverUrl: textOf(row.thumb_url),
      intro: textOf(row.abstract),
      kind,
      lastChapter: textOf(row.last_chapter_title),
      wordCount: textOf(row.word_number),
      origin: source,
      originName: DAHUILANG_NAME + " · " + source,
    });
    if (books.length >= MAX_SEARCH_RESULTS) break;
  }
  searchCache.set(cacheKey, { at: Date.now(), value: books });
  return books;
}

// ---------------------------------------------------------------- book info / toc

export async function dahuilangBookInfo(bookUrl: string): Promise<BookInfo> {
  const payload = decodeDahuilangBookUrl(bookUrl);
  if (!payload) throw new Error("大灰狼聚合：无法识别的书籍地址");
  return {
    name: payload.n,
    author: payload.a,
    bookUrl,
    coverUrl: payload.c,
    intro: payload.d,
    kind: payload.k,
    lastChapter: payload.l,
    wordCount: payload.w,
    origin: payload.s,
    originName: DAHUILANG_NAME + " · " + payload.s,
    tocUrl: bookUrl,
  };
}

export async function dahuilangToc(book: BookInfo): Promise<Chapter[]> {
  const payload = decodeDahuilangBookUrl(book.bookUrl);
  if (!payload) throw new Error("大灰狼聚合：无法识别的书籍地址");
  const query = new URLSearchParams({
    book_id: payload.b,
    source: payload.s,
    tab: payload.t || "小说",
    variable: JSON.stringify({ custom: "" }),
  });
  const response = await requestJson("/catalog?" + query.toString(), {
    method: "POST",
    body: { html: "" },
    allowFailover: true,
  });
  if (response.code !== undefined && Number(response.code) !== 0 && !Array.isArray(response.data)) {
    const message = errorMessage(response);
    if (/免登录|请登录|登录后|次数/.test(message)) {
      throw new DahuilangLoginError(message || "大灰狼聚合：目录需要登录后查看");
    }
    throw new Error("大灰狼聚合：" + (message || "目录拉取失败"));
  }
  const rows = Array.isArray(response.data) ? (response.data as Array<Record<string, unknown>>) : [];
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (truthy(row.is_volume)) continue;
    const title = textOf(row.title);
    const itemId = textOf(row.item_id);
    if (!title || !itemId) continue;
    const source = textOf(row.source) || payload.s;
    const tab = textOf(row.tab) || payload.t || "小说";
    const url = encodeDahuilangChapterUrl({ b: payload.b, i: itemId, s: source, t: tab, n: title });
    if (seen.has(url)) continue;
    seen.add(url);
    chapters.push({ title, url, isVip: truthy(row.is_pay), isVolume: false });
  }
  if (!chapters.length) throw new Error("大灰狼聚合：目录是空的，源站可能限制了这本");
  return chapters;
}

// ---------------------------------------------------------------- content

/** 把 /content 的响应体转成正文；独立出来便于覆盖「错误提示伪装成正文」的回归。 */
export function parseDahuilangContent(payload: Record<string, unknown>): string {
  // 未登录时上游把提示放在 content 里、code=-1；不能把它当正文返回。
  if (Number(payload.code) < 0) throwContentError(payload);
  const raw = contentOf(payload).trim();
  if (!raw) throwContentError(payload);
  if (raw.includes("大灰狼融合4")) {
    throw new Error("大灰狼聚合返回了旧版正文格式，请更新书源或稍后重试");
  }
  const text = /<[a-z][\s\S]*>/i.test(raw) ? htmlToText(raw) : normalizeText(raw);
  if (!text.trim()) throw new Error("大灰狼聚合：这一章正文是空的");
  return text;
}

export async function dahuilangContent(chapterUrl: string, bookUrl: string): Promise<string> {
  const book = decodeDahuilangBookUrl(bookUrl);
  const chapter = decodeDahuilangChapterUrl(chapterUrl);
  if (!book || !chapter) throw new Error("大灰狼聚合：无法识别的章节地址");
  ensureDahuilangDeviceId();
  const body = {
    html: "",
    item_id: chapter.i,
    source: chapter.s || book.s,
    tab: chapter.t || book.t || "小说",
    tone_id: "4",
    variable: JSON.stringify({ custom: "" }),
    version: "4.11.5.1",
    app: "阅读神评表情",
    god: true,
  };
  const payload = await requestJson("/content", { method: "POST", body, allowFailover: true });
  return parseDahuilangContent(payload);
}

// ---------------------------------------------------------------- explore

const EXPLORE_MODES: DahuilangMode[] = ["小说", "听书", "短剧", "漫画"];
const EXPLORE_GENDERS: DahuilangGender[] = ["男频", "女频"];
const EXPLORE_PLATFORMS: Record<DahuilangMode, string[]> = {
  小说: [
    "番茄", "七猫", "书旗", "塔读", "江湖", "小米", "米读", "QQ阅读", "酷我小说", "幻梦轻小说", "猫眼", "西瓜小说",
    "69书吧", "顶点", "爱下电子书", "伪69", "超会专属小说", "听小说", "阅友小说", "百度", "得间", "QQ", "搜书神器",
    "得奇", "知乎", "追更人", "久久小说", "52书库", "腐小说", "完本小说", "盐选文库", "有度中文", "三零读书", "鹿鹿",
    "星空小说", "365小说", "冷冷文学", "万相书城", "独步小说", "福书网", "速读谷", "全本同人",
  ],
  听书: ["番茄", "七猫", "书旗", "喜马拉雅", "酷我"],
  短剧: ["番茄", "YY短剧", "东梨短剧", "星芽短剧", "极速影视"],
  漫画: ["全免漫画", "番茄", "漫画屋", "漫画网", "漫客栈", "鸟韩漫", "新新漫画", "武芊漫画", "拷贝漫画"],
};
const EXPLORE_WORDS = ["不限", "10万字以内", "30万字以内", "50万字以内", "30万字以上", "50万字以上", "100万字以上", "200万字以上", "300万字以上", "500万字以上"];
const EXPLORE_STATUSES = ["不限", "完结", "连载", "半年内完结", "3日内更新", "7日内更新", "1月内更新"];
const EXPLORE_SORTS = ["不限", "热门", "新书", "评分", "字数", "有声"];
const WORD_CODES: Record<string, string> = {
  不限: "word_num_default", "10万字以内": "word_num_lte10", "30万字以内": "word_num_lte30", "50万字以内": "word_num_lte50",
  "30万字以上": "word_num_gte30", "50万字以上": "word_num_gte50", "100万字以上": "word_num_gte100",
  "200万字以上": "word_num_gte200", "300万字以上": "word_num_gte300", "500万字以上": "word_num_gte500",
};
const STATUS_CODES: Record<string, string> = {
  不限: "creation_status_default", 完结: "creation_status_end", 连载: "creation_status_loading",
  半年内完结: "creation_status_half_year_end", "3日内更新": "creation_status_3day_update",
  "7日内更新": "creation_status_7day_update", "1月内更新": "creation_status_1month_update",
};
const SORT_CODES: Record<string, string> = {
  不限: "sort_default", 热门: "sort_hot", 新书: "sort_new_book", 评分: "sort_score", 字数: "sort_word_number", 有声: "sort_audio_book",
};

function asExploreMode(value: unknown): DahuilangMode | null {
  return EXPLORE_MODES.includes(value as DahuilangMode) ? (value as DahuilangMode) : null;
}

function asExploreGender(value: unknown): DahuilangGender | null {
  return EXPLORE_GENDERS.includes(value as DahuilangGender) ? (value as DahuilangGender) : null;
}

function explorePlatforms(mode: DahuilangMode): string[] {
  return EXPLORE_PLATFORMS[mode] ?? EXPLORE_PLATFORMS["小说"];
}

function pickFilter(value: unknown, options: string[], fallback = "不限"): string {
  const text = textOf(value);
  return options.includes(text) ? text : fallback;
}

/** 发现页控制条状态；平台清单按模式变化，筛选只对番茄小说普通分类生效。 */
export function dahuilangExploreState(): DahuilangExploreState {
  const mode = asExploreMode(getSetting("dhlExploreMode", "")) ?? "小说";
  const pool = explorePlatforms(mode);
  const wanted = getSetting("dhlExploreSource", "");
  const source = pool.includes(wanted) ? wanted : "番茄";
  return {
    mode,
    gender: asExploreGender(getSetting("dhlExploreGender", "")) ?? "男频",
    source,
    sources: pool,
    modes: EXPLORE_MODES.map((id) => ({ id, label: id, count: explorePlatforms(id).length })),
    filters: {
      word: pickFilter(getSetting("dhlExploreWord", ""), EXPLORE_WORDS),
      status: pickFilter(getSetting("dhlExploreStatus", ""), EXPLORE_STATUSES),
      sort: pickFilter(getSetting("dhlExploreSort", ""), EXPLORE_SORTS),
    },
    filterOptions: { word: EXPLORE_WORDS, status: EXPLORE_STATUSES, sort: EXPLORE_SORTS },
  };
}

export function saveDahuilangExploreState(patch: {
  mode?: unknown;
  gender?: unknown;
  source?: unknown;
  word?: unknown;
  status?: unknown;
  sort?: unknown;
}): DahuilangExploreState {
  if (patch.mode !== undefined) {
    const mode = asExploreMode(patch.mode);
    if (!mode) throw new Error("大灰狼聚合：未知的模式");
    putSetting("dhlExploreMode", mode);
    if (!explorePlatforms(mode).includes(getSetting("dhlExploreSource", ""))) putSetting("dhlExploreSource", "");
  }
  if (patch.gender !== undefined) {
    const gender = asExploreGender(patch.gender);
    if (!gender) throw new Error("大灰狼聚合：未知的频道");
    putSetting("dhlExploreGender", gender);
  }
  if (patch.source !== undefined) {
    const source = textOf(patch.source);
    const mode = dahuilangExploreState().mode;
    if (!explorePlatforms(mode).includes(source)) throw new Error("大灰狼聚合：这个平台不在当前模式下");
    putSetting("dhlExploreSource", source);
  }
  if (patch.word !== undefined) putSetting("dhlExploreWord", pickFilter(patch.word, EXPLORE_WORDS));
  if (patch.status !== undefined) putSetting("dhlExploreStatus", pickFilter(patch.status, EXPLORE_STATUSES));
  if (patch.sort !== undefined) putSetting("dhlExploreSort", pickFilter(patch.sort, EXPLORE_SORTS));
  return dahuilangExploreState();
}

/** 去掉上游分段标题的装饰符号：°・*.☆ 排行榜 ☆.*・° → 排行榜。 */
export function cleanExploreTitle(value: unknown): string {
  return textOf(value)
    .replace(/[°・*.☆★❤️\s]/g, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/^[：:]+|[：:]+$/g, "")
    .trim();
}

function isExploreSection(rawTitle: string): boolean {
  if (/[☆★]/.test(rawTitle)) return true;
  return ["排行榜", "热门标签", "小说", "分类", "榜单"].includes(cleanExploreTitle(rawTitle));
}

interface DahuilangExploreGroupPayload {
  u: string;
}

export function encodeDahuilangExploreGroup(target: string): string {
  return "dhlx:" + b64url(JSON.stringify({ u: target } satisfies DahuilangExploreGroupPayload));
}

export function decodeDahuilangExploreGroup(groupUrl: string): string | null {
  if (!groupUrl.startsWith("dhlx:")) return null;
  try {
    const parsed = JSON.parse(unb64url(groupUrl.slice(5))) as Partial<DahuilangExploreGroupPayload>;
    const target = textOf(parsed.u);
    return target || null;
  } catch {
    return null;
  }
}

function dahuilangTargetUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("大灰狼聚合：发现页地址不是 HTTP");
  const host = url.hostname;
  const allowedHost =
    host === "219.154.201.122" ||
    host === "langge.uk" ||
    host.endsWith(".langge.uk") ||
    host.endsWith(".langge.tk");
  if (!allowedHost) throw new Error("大灰狼聚合：发现页地址不在允许的线路内");
  if (url.pathname !== "/get_discover" && url.pathname !== "/discovedata") {
    throw new Error("大灰狼聚合：发现页地址路径不受支持");
  }
  return url;
}

function withPage(target: string, page: number): string {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  if (target.includes("{{page}}")) return target.replace(/\{\{page\}\}/g, String(safePage));
  const url = new URL(target);
  url.searchParams.set("page", String(safePage));
  return url.toString();
}

function explorePayloadRows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  if (payload.code !== undefined && Number(payload.code) !== 0 && !Array.isArray(payload.data)) {
    const message = errorMessage(payload);
    if (/免登录|请登录|登录后|次数/.test(message)) {
      throw new DahuilangLoginError(message || "大灰狼聚合：发现页需要登录后查看");
    }
    throw new Error("大灰狼聚合：" + (message || "发现页拉取失败"));
  }
  return Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];
}

/** 番茄小说的普通分类才接受 selected_items；榜单和其他平台不传，避免上游报错。 */
export function withFanqieFilters(target: string, state: DahuilangExploreState): string {
  if (state.source !== "番茄" || state.mode !== "小说") return target;
  const active = state.filters.word !== "不限" || state.filters.status !== "不限" || state.filters.sort !== "不限";
  if (!active) return target;
  try {
    const url = new URL(target);
    const params = url.searchParams;
    const isCategory =
      url.pathname === "/get_discover" &&
      params.get("source") === "番茄" &&
      params.has("type") &&
      !params.has("bdtype") &&
      params.get("is_ranking") !== "1";
    if (!isCategory || params.has("selected_items")) return target;
    const selected = [
      WORD_CODES[state.filters.word] || WORD_CODES["不限"],
      STATUS_CODES[state.filters.status] || STATUS_CODES["不限"],
      SORT_CODES[state.filters.sort] || SORT_CODES["不限"],
    ].join(",");
    return target + "&selected_items=" + selected;
  } catch {
    return target;
  }
}

function searchBookFromExploreRow(row: Record<string, unknown>): SearchBook | null {
  const name = textOf(row.book_name);
  const bookId = textOf(row.book_id);
  const source = textOf(row.source);
  const tab = textOf(row.tab) || "小说";
  if (!name || !bookId || !source || name.startsWith("没有找到")) return null;
  const kind = cleanKind(row.tags) || cleanKind(row.category);
  // 分类列表常不返回 last_chapter_title，只剩更新时间；用连载状态兜底，别让列表只显示一串日期。
  const lastChapter = [
    textOf(row.last_chapter_title) || textOf(row.status),
    textOf(row.last_chapter_update_time),
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    name,
    author: textOf(row.author),
    bookUrl: encodeDahuilangBookUrl({
      b: bookId,
      s: source,
      t: tab,
      n: name,
      a: textOf(row.author),
      c: textOf(row.thumb_url),
      d: textOf(row.abstract),
      w: textOf(row.word_number),
      l: textOf(row.last_chapter_title),
      k: kind,
    }),
    coverUrl: textOf(row.thumb_url),
    intro: textOf(row.abstract),
    kind,
    lastChapter,
    wordCount: textOf(row.word_number),
    origin: source,
    originName: DAHUILANG_NAME + " · " + source,
  };
}

/** 发现页分组：/discovestyle 的 300+ 个入口按上游分段标题折叠成 section。 */
export async function dahuilangExploreGroups(): Promise<ExploreGroup[]> {
  const state = dahuilangExploreState();
  const query = new URLSearchParams({ source: state.source, source_type: state.gender, tab: state.mode });
  const payload = await requestJson("/discovestyle?" + query.toString(), { allowFailover: true });
  const rows = explorePayloadRows(payload);
  let section = "";
  const groups: ExploreGroup[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const rawTitle = textOf(row.title);
    if (!rawTitle) continue;
    const rawUrl = textOf(row.url);
    if (!rawUrl) {
      if (isExploreSection(rawTitle)) {
        const nextSection = cleanExploreTitle(rawTitle);
        // 听书/短剧/漫画的 /discovestyle 用「小说」当分段名，对用户没有意义，统一显示「分类」。
        section = state.mode !== "小说" && nextSection === "小说" ? "分类" : nextSection;
      }
      continue;
    }
    const title = cleanExploreTitle(rawTitle) || rawTitle;
    if (!title || seen.has(title + "|" + rawUrl)) continue;
    seen.add(title + "|" + rawUrl);
    let groupSection = section;
    if (!groupSection) groupSection = /榜$/.test(title) ? "榜单" : "分类";
    const target = withFanqieFilters(rawUrl, state);
    groups.push({ title, url: encodeDahuilangExploreGroup(target), section: groupSection });
  }
  if (!groups.length) {
    throw new Error("大灰狼聚合：" + state.source + " 在「" + state.mode + " · " + state.gender + "」下没有发现入口");
  }
  return groups;
}

/** 发现页列表：目标地址由 /discovestyle 返回，分页用 {{page}} 模板。 */
export async function dahuilangExploreItems(groupUrl: string, page = 1): Promise<SearchBook[]> {
  const target = decodeDahuilangExploreGroup(groupUrl);
  if (!target) throw new Error("大灰狼聚合：无法识别的发现页分类");
  const next = withPage(target, page);
  const url = dahuilangTargetUrl(next);
  const payload = await requestJson(url.pathname + url.search, { server: url.origin, allowFailover: true });
  const rows = explorePayloadRows(payload);
  const books: SearchBook[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const book = searchBookFromExploreRow(row);
    if (!book) continue;
    const key = book.bookUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    books.push(book);
  }
  return books;
}

// ---------------------------------------------------------------- registration

const INSERT_SOURCE_SQL =
  "INSERT INTO book_sources (name, url, host_key, group_name, type, enabled, enabled_explore, weight, custom_order, json, status) " +
  "VALUES (?, ?, ?, ?, 0, 1, 1, 100, 99, ?, 'ok')";

export function dahuilangSourceId(): number | null {
  const row = getDb().prepare("SELECT id FROM book_sources WHERE url = ?").get(DAHUILANG_URL) as { id: number } | undefined;
  return row ? row.id : null;
}

/**
 * 登记内置源。已经存在只刷新 json/name/group，不改 enabled —— 用户手动关掉的源
 * 不该被升级偷偷打开。发现页现在已经接入 /discovestyle，所以打开 enabled_explore。
 */
export function ensureDahuilangSource(): number {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM book_sources WHERE url = ?").get(DAHUILANG_URL) as { id: number } | undefined;
  const json: BookSource = {
    bookSourceName: DAHUILANG_NAME,
    bookSourceUrl: DAHUILANG_URL,
    bookSourceGroup: "聚合书城",
    bookSourceType: 0,
    bookSourceComment:
      "内置聚合源：大灰狼融合 VIP 5.0，聚合番茄、七猫、书旗、QQ 阅读等站。搜索与目录免登录；正文每天 3 次免登录额度，之后需在「设置 → 大灰狼聚合」登录账号。",
    enabled: true,
    enabledExplore: true,
    exploreUrl: "dhl://explore",
    customOrder: 99,
    searchUrl: "dhl://search",
    ruleSearch: { bookList: "dhl://search" },
    ruleExplore: { bookList: "dhl://explore" },
    ruleBookInfo: { name: "dhl://info" },
    ruleToc: { chapterList: "dhl://toc" },
    ruleContent: { content: "dhl://content" },
  };
  const serialized = JSON.stringify(json);
  if (existing) {
    db.prepare("UPDATE book_sources SET json = ?, name = ?, group_name = ?, enabled_explore = 1 WHERE id = ?").run(
      serialized,
      DAHUILANG_NAME,
      "聚合书城",
      existing.id,
    );
    return existing.id;
  }
  const info = db.prepare(INSERT_SOURCE_SQL).run(DAHUILANG_NAME, DAHUILANG_URL, DAHUILANG_URL, "聚合书城", serialized);
  return Number(info.lastInsertRowid);
}
