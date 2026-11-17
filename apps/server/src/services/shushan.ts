import type { BookInfo, BookSource, Chapter, ExploreGroup, SearchBook } from "@legado/engine";
import { getDb } from "../db/index.js";
import { getSetting } from "./settings.js";

/**
 * 书山聚合内置源。
 *
 * 它不是普通的书源：规则是打包混淆过的 JS，阅读器的 JS 沙箱跑不了，也不该跑——
 * 它真正做的是「用你的账号去调 https://v2.vossc.com 的聚合接口」。所以这里直接用
 * HTTP 实现同一套协议，把结果翻译成引擎的 SearchBook / Chapter，书源表里只留一行
 * 占位（url = shushan://builtin），用来进书架、搜索、发现页的源列表。
 *
 * 免费账号能搜到全部源站、能看全部目录；正文只有番茄小说与七猫免费，其余源站返回
 * 「VIP 会员专享」的提示文案（HTTP 201，不是错误码），必须按内容识别，绝不能缓存。
 */

export const SHUSHAN_URL = "shushan://builtin";
export const SHUSHAN_NAME = "书山聚合";

// 允许自建/联调时指向别的聚合服务（单元测试也会用它起一个假上游）。
const HOST = process.env.SHUSHAN_HOST || "https://v2.vossc.com";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
/**
 * 源站下发的静态令牌，随书源一起更新；缺失时服务端会返回 401。
 * 公开仓库不内置令牌：优先读环境变量，也可在设置里保存（更新书源时会自动写入）。
 */
const NOVEL_TOKEN = process.env.SHUSHAN_NOVEL_TOKEN ?? "";
const REQUEST_TIMEOUT_MS = 20_000;
/** 书源发布接口：列出所有可下载的版本，用来判断有没有新版。 */
const RELEASE_API = process.env.SHUSHAN_RELEASE_API || "https://sy.shushan.vip/api/get_sources.php";
const RELEASE_BASE = process.env.SHUSHAN_RELEASE_BASE || "https://sy.shushan.vip/api/";
const RULE_CHECK_TTL_MS = 10 * 60_000;

const VIP_HINT = "VIP会员专享";

/** 正文需要 VIP：调用方要把它当成「这本书读不了」而不是「抓取失败」，否则会自动换源。 */
export class ShushanVipError extends Error {
  readonly code = "vip_required";
  constructor(message: string) {
    super(message);
    this.name = "ShushanVipError";
  }
}

export function isShushanVipError(err: unknown): err is ShushanVipError {
  return err instanceof Error && (err as { code?: string }).code === "vip_required";
}

export function isShushanSource(source: { bookSourceUrl?: string } | null | undefined): boolean {
  return String(source?.bookSourceUrl ?? "").startsWith("shushan://");
}

// ---------------------------------------------------------------- settings

function putSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

/** 上游静态令牌会随书源版本变化：设置里存了新值就用新的。 */
function novelToken(): string {
  return getSetting("shushanNovelToken", "") || NOVEL_TOKEN;
}

export interface ShushanAuth {
  apiKey: string;
  deviceId: string;
  email: string;
  nickname: string;
  member: boolean;
}

export function shushanAuth(): ShushanAuth {
  return {
    apiKey: getSetting("shushanApiKey", ""),
    deviceId: getSetting("shushanDeviceId", ""),
    email: getSetting("shushanEmail", ""),
    nickname: getSetting("shushanNickname", ""),
    member: getSetting("shushanMember", "") === "1",
  };
}

export function shushanConfigured(): boolean {
  const auth = shushanAuth();
  return Boolean(auth.apiKey && auth.deviceId);
}

export function saveShushanAuth(patch: Partial<ShushanAuth>): void {
  if (patch.apiKey !== undefined) putSetting("shushanApiKey", patch.apiKey);
  if (patch.deviceId !== undefined) putSetting("shushanDeviceId", patch.deviceId);
  if (patch.email !== undefined) putSetting("shushanEmail", patch.email);
  if (patch.nickname !== undefined) putSetting("shushanNickname", patch.nickname);
  if (patch.member !== undefined) putSetting("shushanMember", patch.member ? "1" : "0");
}

export function clearShushanAuth(): void {
  saveShushanAuth({ apiKey: "", deviceId: "", email: "", nickname: "", member: false });
}

// ---------------------------------------------------------------- transport

function headers(deviceId = ""): Record<string, string> {
  const auth = shushanAuth();
  const out: Record<string, string> = {
    "User-Agent": UA,
    "Content-Type": "application/json",
    "X-Novel-Token": novelToken(),
    "X-Device-Type": "android",
  };
  if (auth.apiKey) out["X-Api-Key"] = Buffer.from(auth.apiKey, "utf8").toString("base64");
  const device = deviceId || auth.deviceId;
  if (device) out["X-Device-Id"] = device;
  return out;
}

interface UpstreamBody {
  code?: number;
  status?: number;
  error?: string;
  message?: string;
  data?: { content?: string; [key: string]: unknown };
  [key: string]: unknown;
}

async function upstream(path: string, init: { method?: string; body?: unknown } = {}): Promise<UpstreamBody> {
  const response = await fetch(HOST + path, {
    method: init.method ?? "GET",
    headers: headers(),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: UpstreamBody | null = null;
  try {
    parsed = JSON.parse(text) as UpstreamBody;
  } catch {
    parsed = null;
  }
  if (!parsed) throw new Error("书山聚合返回了非 JSON 内容，站点可能正在维护");
  const failed = parsed.error || parsed.message;
  if (failed && !parsed.data && parsed.code !== 0) throw new Error("书山聚合：" + String(failed));
  return parsed;
}

/** 登录：账号密码换 api_key，并沿用账号上已绑定的设备号（设备位只有 1 个）。 */
export async function shushanLogin(email: string, password: string): Promise<ShushanAuth> {
  const body = new URLSearchParams({ email: email.trim(), password: password.trim() });
  const response = await fetch(HOST + "/login", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Device-Type": "android",
      "X-Device-Id": shushanAuth().deviceId || "legadoweb0000001",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as
    | { code?: number; message?: string; data?: { user?: Record<string, unknown>; device?: { list?: Array<Record<string, unknown>> } } }
    | null;
  if (!payload) throw new Error("书山聚合登录失败：返回内容无法解析");
  if (Number(payload.code) !== 200) throw new Error("书山聚合登录失败：" + String(payload.message ?? payload.code));
  const user = payload.data?.user ?? {};
  const apiKey = String(user.api_key ?? "");
  if (!apiKey) throw new Error("书山聚合登录失败：没有拿到 api_key");
  const devices = payload.data?.device?.list ?? [];
  const bound = devices.map((item) => String(item.device_id ?? "")).find((id) => id.length >= 8);
  const patch: Partial<ShushanAuth> = {
    apiKey,
    email: String(user.email ?? email),
    nickname: String(user.nickname ?? ""),
    member: user.is_member === true || Number(user.is_member) === 1,
  };
  // 设备号必须沿用账号上已绑定的那台，否则正文接口会回「设备数量已达上限」。
  if (bound && !shushanAuth().deviceId) patch.deviceId = bound;
  saveShushanAuth(patch);
  return shushanAuth();
}

// ---------------------------------------------------------------- encoding

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

export interface BookPayload {
  /** 源站名，例如「番茄小说」「七猫小说」。 */
  s: string;
  /** 源站自己的 book_url（base64 过的详情地址，原样透传）。 */
  u: string;
  n: string;
  a: string;
  c: string;
  d: string;
  t: string;
}

export function encodeBookUrl(payload: BookPayload): string {
  return "ss:" + b64url(JSON.stringify(payload));
}

export function decodeBookUrl(bookUrl: string): BookPayload | null {
  if (!bookUrl.startsWith("ss:")) return null;
  try {
    const parsed = JSON.parse(unb64url(bookUrl.slice(3))) as BookPayload;
    if (!parsed || typeof parsed.u !== "string") return null;
    return {
      s: String(parsed.s ?? ""),
      u: parsed.u,
      n: String(parsed.n ?? ""),
      a: String(parsed.a ?? ""),
      c: String(parsed.c ?? ""),
      d: String(parsed.d ?? ""),
      t: String(parsed.t ?? "novel"),
    };
  } catch {
    return null;
  }
}

export interface ChapterPayload {
  /** 源站章节地址：番茄是 book_id=…&item_id=…，其他站是完整 URL。 */
  u: string;
  cid: number;
  t: string;
}

export function encodeChapterUrl(payload: ChapterPayload): string {
  return "ssc:" + b64url(JSON.stringify(payload));
}

export function decodeChapterUrl(chapterUrl: string): ChapterPayload | null {
  if (!chapterUrl.startsWith("ssc:")) return null;
  try {
    const parsed = JSON.parse(unb64url(chapterUrl.slice(4))) as ChapterPayload;
    if (!parsed || typeof parsed.u !== "string") return null;
    return { u: parsed.u, cid: Number(parsed.cid) || 0, t: String(parsed.t ?? "") };
  } catch {
    return null;
  }
}

export function queryValue(text: string, key: string): string {
  const match = new RegExp("[?&]" + key + "=([^&]+)").exec("?" + text.replace(/^\?/, ""));
  return match ? decodeURIComponent(match[1] ?? "") : "";
}

/** 目录与正文都要 api_key；没登录时先拦下来，别让用户看到「只有 1 章」的假目录。 */
function requireLogin(): void {
  if (!shushanConfigured()) {
    throw new Error("书山聚合还没有登录：去「设置 → 书山聚合」填邮箱和密码，登录后即可看目录与正文");
  }
}

// ---------------------------------------------------------------- search

interface SearchItem {
  title?: string;
  author?: string;
  tags?: string;
  cover?: string;
  desc?: string;
  wordCount?: string;
  latestChapterTitle?: string;
  book_url?: string;
  source?: string;
  tab?: string;
}

const SEARCH_TTL_MS = 5 * 60 * 1000;
const searchCache = new Map<string, { at: number; value: SearchBook[] }>();

function sourceRank(name: string): number {
  if (name === "番茄小说") return 0;
  if (name === "七猫小说") return 1;
  return 2;
}

export async function shushanSearch(key: string): Promise<SearchBook[]> {
  requireLogin();
  const word = key.trim();
  if (!word) return [];
  const cached = searchCache.get(word);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.value;
  const payload = await upstream("/search?login=search&key=" + encodeURIComponent(word) + "&page=1");
  const rows = Array.isArray(payload.data) ? (payload.data as unknown as SearchItem[]) : [];
  const perSource = new Map<string, number>();
  const books: SearchBook[] = [];
  for (const row of rows) {
    const source = String(row.source ?? "");
    const bookUrl = String(row.book_url ?? "");
    const name = String(row.title ?? "").trim();
    const tab = String(row.tab ?? "novel");
    // 上游搜不到书时会返回一条「没有找到包含：X的小说」的占位行（source 是某个镜像站），
    // 不滤掉它就会被当成一本真书出现在搜索结果和换源候选里。
    if (name.startsWith("没有找到")) continue;
    if (!source || !bookUrl || !name) continue;
    // 听书 / 漫画 / 短剧 在文字阅读器里读不了，直接丢掉。
    if (tab && tab !== "novel") continue;
    const used = perSource.get(source) ?? 0;
    if (used >= 8) continue;
    perSource.set(source, used + 1);
    books.push({
      name,
      author: String(row.author ?? ""),
      bookUrl: encodeBookUrl({
        s: source,
        u: bookUrl,
        n: name,
        a: String(row.author ?? ""),
        c: String(row.cover ?? ""),
        d: String(row.desc ?? ""),
        t: tab,
      }),
      coverUrl: String(row.cover ?? ""),
      intro: String(row.desc ?? ""),
      kind: cleanTags(row.tags),
      lastChapter: [source, String(row.latestChapterTitle ?? "")].filter(Boolean).join(" · "),
      wordCount: String(row.wordCount ?? ""),
      origin: source,
      originName: SHUSHAN_NAME + " · " + source,
    });
    if (books.length >= 120) break;
  }
  books.sort((left, right) => sourceRank(left.origin) - sourceRank(right.origin));
  searchCache.set(word, { at: Date.now(), value: books });
  return books;
}

// ---------------------------------------------------------------- book info / toc

export async function shushanBookInfo(bookUrl: string): Promise<BookInfo> {
  const payload = decodeBookUrl(bookUrl);
  if (!payload) throw new Error("书山聚合：无法识别的书籍地址");
  return {
    name: payload.n,
    author: payload.a,
    bookUrl,
    coverUrl: payload.c,
    intro: payload.d,
    kind: "",
    lastChapter: "",
    wordCount: "",
    origin: payload.s,
    originName: SHUSHAN_NAME + " · " + payload.s,
    tocUrl: bookUrl,
  };
}

export async function shushanToc(book: BookInfo): Promise<Chapter[]> {
  // 没登录时源站只回一条「书本身」的假目录，看起来像只有 1 章。直接说清楚。
  requireLogin();
  const payload = decodeBookUrl(book.bookUrl);
  if (!payload) throw new Error("书山聚合：无法识别的书籍地址");
  const response = await upstream("/catalog", {
    method: "POST",
    body: { source: payload.s, url: payload.u, name: payload.n, bookid: "", tab: payload.t || "novel" },
  });
  const rows = Array.isArray(response.data) ? (response.data as Array<Record<string, unknown>>) : [];
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.isVolume === true) continue;
    const url = String(row.url ?? "").trim();
    const title = String(row.title ?? "").trim();
    if (!url || !title) continue;
    const encoded = encodeChapterUrl({ u: url, cid: Number(row.cid) || 0, t: title });
    if (seen.has(encoded)) continue;
    seen.add(encoded);
    chapters.push({ title, url: encoded, isVip: row.isVip === true || row.isPay === true, isVolume: false });
  }
  if (!chapters.length) throw new Error("书山聚合：目录是空的，源站可能限制了这本");
  return chapters;
}

// ---------------------------------------------------------------- content

export async function shushanContent(chapterUrl: string, bookUrl: string): Promise<string> {
  requireLogin();
  const book = decodeBookUrl(bookUrl);
  const chapter = decodeChapterUrl(chapterUrl);
  if (!book || !chapter) throw new Error("书山聚合：无法识别的章节地址");
  // 番茄的正文接口只认 book_id / item_id；其他源站（书旗、七猫、晋江…）用 cid + 详情地址。
  const body =
    book.s === "番茄小说"
      ? {
          source: book.s,
          book_id: queryValue(chapter.u, "book_id"),
          item_id: queryValue(chapter.u, "item_id"),
          version: "12",
        }
      : { source: book.s, url: book.u, cid: chapter.cid, version: "12" };
  const response = await upstream("/content", { method: "POST", body });
  const text = String(response.data?.content ?? "").trim();
  if (!text) throw new Error("书山聚合：这一章没有返回正文");
  if (text.includes(VIP_HINT)) {
    throw new ShushanVipError("这本书属于 " + book.s + " 的 VIP 内容，当前书山聚合账号还不是会员");
  }
  if (text.includes("设备数量已达上限") || text.includes("设备标识")) {
    throw new Error("书山聚合：" + text.split("\n")[0] + "（在设置里重新登录书山聚合即可）");
  }
  if (text.includes("服务暂时不可用")) throw new Error("书山聚合：" + text);
  // 书旗/晋江/QQ 阅读这些源只有会员能出正文：能读到就说明账号已经是会员了，
  // 顺手把状态改过来，设置页不用重新登录也能显示正确。
  if (book.s !== "番茄小说" && book.s !== "七猫小说" && !shushanAuth().member) saveShushanAuth({ member: true });
  return text;
}

// ---------------------------------------------------------------- explore

interface Category {
  id: number;
  name: string;
  gender: 1 | 2;
}

/** 与书源里的分类表一致：番茄的榜单接口按 category_id + gender 取数。 */
const BUILTIN_CATEGORIES: Category[] = [
  { id: 1141, name: "西方奇幻", gender: 1 },
  { id: 1140, name: "东方仙侠", gender: 1 },
  { id: 8, name: "科幻末世", gender: 1 },
  { id: 261, name: "都市日常", gender: 1 },
  { id: 124, name: "都市修真", gender: 1 },
  { id: 1014, name: "都市高武", gender: 1 },
  { id: 273, name: "历史古代", gender: 1 },
  { id: 27, name: "战神赘婿", gender: 1 },
  { id: 263, name: "都市种田", gender: 1 },
  { id: 258, name: "传统玄幻", gender: 1 },
  { id: 272, name: "历史脑洞", gender: 1 },
  { id: 262, name: "都市脑洞", gender: 1 },
  { id: 257, name: "玄幻脑洞", gender: 1 },
  { id: 751, name: "悬疑灵异", gender: 1 },
  { id: 504, name: "抗战谍战", gender: 1 },
  { id: 746, name: "游戏体育", gender: 1 },
  { id: 718, name: "动漫衍生", gender: 1 },
  { id: 1016, name: "男频衍生", gender: 1 },
  { id: 1139, name: "古风世情", gender: 2 },
  { id: 8, name: "科幻末世", gender: 2 },
  { id: 746, name: "游戏体育", gender: 2 },
  { id: 1015, name: "女频衍生", gender: 2 },
  { id: 248, name: "玄幻言情", gender: 2 },
  { id: 23, name: "种田", gender: 2 },
  { id: 79, name: "年代", gender: 2 },
  { id: 267, name: "现言脑洞", gender: 2 },
  { id: 246, name: "宫斗宅斗", gender: 2 },
  { id: 539, name: "悬疑脑洞", gender: 2 },
  { id: 253, name: "古言脑洞", gender: 2 },
  { id: 24, name: "快穿", gender: 2 },
  { id: 749, name: "青春甜宠", gender: 2 },
  { id: 745, name: "星光璀璨", gender: 2 },
  { id: 747, name: "女频悬疑", gender: 2 },
  { id: 750, name: "职场婚恋", gender: 2 },
  { id: 748, name: "豪门总裁", gender: 2 },
  { id: 1017, name: "民国言情", gender: 2 },
];

/** 分类表随书源版本更新，存成设置；没有就用内置快照。 */
function categories(): Category[] {
  const raw = getSetting("shushanCategories", "");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const list: Category[] = [];
        for (const item of parsed) {
          const row = item as { id?: unknown; name?: unknown; gender?: unknown };
          const id = Number(row.id);
          const name = String(row.name ?? "");
          const gender = Number(row.gender);
          if (id > 0 && name && (gender === 1 || gender === 2)) list.push({ id, name, gender: gender === 2 ? 2 : 1 });
        }
        if (list.length) return list;
      }
    } catch {
      /* 坏数据回落到内置快照 */
    }
  }
  return BUILTIN_CATEGORIES;
}

const GROUP_PREFIX = "ssx:top:";
/** 上游一页能给 30 本（默认只给 10）；首屏三页就是 90 本，不用一直点下一页。 */
const EXPLORE_PAGE_SIZE = 30;

export type ShushanMode = "novel" | "audio" | "comic" | "video";

export interface ShushanSite {
  name: string;
  type: ShushanMode;
  /** 源站自己标了免费（番茄 / 七猫等），其余多为 VIP 源。 */
  free: boolean;
}

export interface ShushanExploreState {
  mode: ShushanMode;
  gender: "boy" | "girl";
  /** 空字符串表示「聚合」：小说模式按番茄分类聚合；听书 / 漫画 / 视频会落到该类型第一个源站。 */
  site: string;
  tag: string;
  sites: ShushanSite[];
  modes: Array<{ id: ShushanMode; label: string; count: number }>;
}

const MODE_LABELS: Record<ShushanMode, string> = { novel: "小说", audio: "听书", comic: "漫画", video: "视频" };
const MODE_ORDER: ShushanMode[] = ["novel", "audio", "comic", "video"];
const SITE_TTL_MS = 30 * 60_000;
const FOUND_TTL_MS = 10 * 60_000;

let siteCache: { at: number; list: ShushanSite[] } | null = null;
const foundCache = new Map<string, { at: number; value: FoundItem[] }>();

interface FoundItem {
  title?: string;
  url?: string;
}

function asMode(value: unknown): ShushanMode | null {
  return MODE_ORDER.includes(value as ShushanMode) ? (value as ShushanMode) : null;
}

/** 源站清单：/api/get_config 一次给全 74 个（小说 59 / 听书 9 / 漫画 4 / 视频 1）。 */
export async function shushanSites(): Promise<ShushanSite[]> {
  if (siteCache && Date.now() - siteCache.at < SITE_TTL_MS) return siteCache.list;
  try {
    const response = await fetch(HOST + "/api/get_config", { headers: headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const parsed = (await response.json().catch(() => null)) as unknown;
    const rows = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
    const list: ShushanSite[] = [];
    for (const row of rows) {
      const name = String(row.name ?? "").trim();
      const type = asMode(row.type);
      if (!name || !type) continue;
      // 上游用 free:"svip" 表示「这个站要会员」；没有这个字段的才是真免费（番茄 / 七猫 / 知乎…）。
      list.push({ name, type, free: !row.free });
    }
    if (list.length) siteCache = { at: Date.now(), list };
    return list.length ? list : (siteCache?.list ?? []);
  } catch {
    return siteCache?.list ?? [];
  }
}

export async function shushanExploreState(): Promise<ShushanExploreState> {
  const all = await shushanSites();
  const mode = asMode(getSetting("shushanExploreMode", "")) ?? "novel";
  const pool = all.filter((site) => site.type === mode);
  const wanted = getSetting("shushanExploreSite", "");
  let site = pool.some((item) => item.name === wanted) ? wanted : "";
  // 听书 / 漫画 / 视频没有「聚合分类」，默认落到该类型第一个源站，否则发现页会是空的。
  if (!site && mode !== "novel" && pool.length) site = pool[0].name;
  return {
    mode,
    gender: getSetting("shushanExploreGender", "") === "girl" ? "girl" : "boy",
    site,
    tag: getSetting("shushanExploreTag", ""),
    sites: pool,
    modes: MODE_ORDER.map((id) => ({ id, label: MODE_LABELS[id], count: all.filter((site) => site.type === id).length })),
  };
}

export async function saveShushanExploreState(patch: {
  mode?: unknown;
  gender?: unknown;
  site?: unknown;
  tag?: unknown;
}): Promise<ShushanExploreState> {
  if (patch.mode !== undefined) {
    const mode = asMode(patch.mode);
    if (!mode) throw new Error("书山聚合：未知的模式");
    putSetting("shushanExploreMode", mode);
    // 切模式时旧源站多半不属于新类型，先清掉，让 state 自己挑默认值。
    putSetting("shushanExploreSite", "");
  }
  if (patch.gender !== undefined) {
    if (patch.gender !== "boy" && patch.gender !== "girl") throw new Error("书山聚合：未知的性别");
    putSetting("shushanExploreGender", patch.gender);
  }
  if (patch.site !== undefined) {
    const wanted = String(patch.site ?? "").trim();
    if (wanted) {
      const all = await shushanSites();
      const mode = asMode(getSetting("shushanExploreMode", "")) ?? "novel";
      if (!all.some((site) => site.type === mode && site.name === wanted)) {
        throw new Error("书山聚合：这个源站不在当前模式下");
      }
    }
    putSetting("shushanExploreSite", wanted);
  }
  if (patch.tag !== undefined) putSetting("shushanExploreTag", String(patch.tag ?? "").trim().slice(0, 20));
  return shushanExploreState();
}

export interface ShushanApiGroup {
  mode: ShushanMode;
  site: string;
  gender: "boy" | "girl";
  tag: string;
  /** 源站自己的目标地址（可能带 {{page}} 模板）。 */
  target: string;
}

export function shushanApiGroup(group: ShushanApiGroup): string {
  return (
    "ssx:api:" +
    group.mode +
    ":" +
    b64url(group.site) +
    ":" +
    group.gender +
    ":" +
    b64url(group.tag) +
    ":" +
    b64url(group.target)
  );
}

export function parseShushanApiGroup(url: string): ShushanApiGroup | null {
  const match = /^ssx:api:(novel|audio|comic|video):([^:]+):(boy|girl):([^:]*):(.+)$/.exec(url);
  if (!match) return null;
  try {
    return {
      mode: match[1] as ShushanMode,
      site: unb64url(match[2]),
      gender: match[3] as "boy" | "girl",
      tag: match[4] ? unb64url(match[4]) : "",
      target: unb64url(match[5]),
    };
  } catch {
    return null;
  }
}

/** 上游的分段标题带装饰符号（ʚ排行榜ɞ、❤️热门标签❤️），去掉后当分组名。 */
export function cleanSectionTitle(title: string): string {
  return String(title ?? "")
    .replace(/[\u029a\u025e\u2764\ufe0f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function typeApiFound(site: string, gender: "boy" | "girl", tag: string): Promise<FoundItem[]> {
  const key = site + "|" + gender + "|" + tag;
  const cached = foundCache.get(key);
  if (cached && Date.now() - cached.at < FOUND_TTL_MS) return cached.value;
  let path = "/type_api?source=" + encodeURIComponent(site) + "&gender=" + gender;
  if (tag) path += "&tag=" + encodeURIComponent(tag);
  const payload = await upstream(path);
  const data = payload.data as { found?: unknown } | undefined;
  const found = Array.isArray(data?.found) ? (data!.found as FoundItem[]) : [];
  if (found.length) foundCache.set(key, { at: Date.now(), value: found });
  return found;
}

export async function shushanExploreGroups(): Promise<ExploreGroup[]> {
  const state = await shushanExploreState();
  if (!state.site) {
    return categories().map((item) => ({
      title: (item.gender === 1 ? "男频 · " : "女频 · ") + item.name,
      url: GROUP_PREFIX + item.gender + ":" + item.id,
    }));
  }
  const found = await typeApiFound(state.site, state.gender, state.tag);
  const groups: ExploreGroup[] = [];
  let section = "";
  for (const item of found) {
    const title = String(item.title ?? "").trim();
    if (!title) continue;
    const raw = String(item.url ?? "");
    if (!raw) {
      section = cleanSectionTitle(title);
      continue;
    }
    let target = "";
    try {
      target = Buffer.from(raw, "base64").toString("utf8");
    } catch {
      target = "";
    }
    if (!target) continue;
    groups.push({
      title,
      url: shushanApiGroup({ mode: state.mode, site: state.site, gender: state.gender, tag: state.tag, target }),
      section,
    });
  }
  return groups;
}

export function fanqieBookUrl(bookId: string): string {
  return (
    "https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/multi-detail/v/?aid=1967&iid=5&version_code=999&book_id=" +
    bookId
  );
}

/** 上游 tags 是「连载,付费,都市,2026-11-01,836,现代都市」这种大杂烩：去掉日期与纯数字，只留前三个标签。 */
export function cleanTags(value: unknown): string {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag && !/^\d{4}-\d{2}-\d{2}$/.test(tag) && !/^\d+$/.test(tag))
    .slice(0, 3)
    .join(" · ");
}

export function formatWords(value: unknown): string {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return "";
  if (count >= 10000) return (count / 10000).toFixed(1) + " 万字";
  return count + " 字";
}

export async function shushanExplore(groupUrl: string, page = 1): Promise<SearchBook[]> {
  if (groupUrl.startsWith("ssx:api:")) return exploreTypeApi(groupUrl, page);
  const match = /^ssx:top:(\d+):(\d+)$/.exec(groupUrl);
  if (!match) throw new Error("书山聚合：无法识别的发现页分类");
  const gender = Number(match[1]);
  const category = Number(match[2]);
  const offset = Math.max(0, page - 1) * EXPLORE_PAGE_SIZE;
  const payload = await upstream(
    "/style_top?rank_list_type=3&offset=" + offset + "&limit=" + EXPLORE_PAGE_SIZE + "&category_id=" + category + "&gender=" + gender + "&rankMold=2",
  );
  const data = payload.data as { book_list?: Array<Record<string, unknown>> } | undefined;
  const rows = Array.isArray(data?.book_list) ? data!.book_list! : [];
  const books: SearchBook[] = [];
  for (const row of rows) {
    const bookId = String(row.bookId ?? "");
    const name = String(row.bookName ?? "").trim();
    if (!bookId || !name) continue;
    const author = String(row.author ?? "");
    books.push({
      name,
      author,
      bookUrl: encodeBookUrl({
        s: "番茄小说",
        u: Buffer.from(fanqieBookUrl(bookId), "utf8").toString("base64"),
        n: name,
        a: author,
        c: String(row.thumbUri ?? ""),
        d: String(row.abstract ?? ""),
        t: "novel",
      }),
      coverUrl: String(row.thumbUri ?? ""),
      intro: String(row.abstract ?? ""),
      kind: "",
      lastChapter: String(row.lastChapterTitle ?? ""),
      wordCount: formatWords(row.wordNumber),
      origin: "番茄小说",
      originName: SHUSHAN_NAME + " · 番茄小说",
    });
  }
  return books;
}

/**
 * 源站分支：分组地址里带着源站自己的目标地址（可能含 {{page}} 模板），
 * 上游 /type_api 用标准 base64 回传，所以这里要把 b64url 解出来的原文再编回标准 base64。
 */
async function exploreTypeApi(groupUrl: string, page: number): Promise<SearchBook[]> {
  const group = parseShushanApiGroup(groupUrl);
  if (!group) throw new Error("书山聚合：无法识别的发现页入口");
  const target = Buffer.from(group.target, "utf8").toString("base64");
  let path =
    "/type_api?source=" +
    encodeURIComponent(group.site) +
    "&page=" +
    Math.max(1, Math.floor(page)) +
    "&url=" +
    encodeURIComponent(target) +
    "&gender=" +
    group.gender;
  if (group.tag) path += "&tag=" + encodeURIComponent(group.tag);
  const payload = await upstream(path);
  const rows = Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];
  const books: SearchBook[] = [];
  for (const row of rows) {
    const name = String(row.title ?? "").trim();
    const bookUrl = String(row.book_url ?? "").trim();
    if (!name || !bookUrl) continue;
    const site = String(row.source ?? group.site) || group.site;
    const author = String(row.author ?? "");
    books.push({
      name,
      author,
      bookUrl: encodeBookUrl({
        s: site,
        u: bookUrl,
        n: name,
        a: author,
        c: String(row.cover ?? ""),
        d: String(row.desc ?? ""),
        t: group.mode,
      }),
      coverUrl: String(row.cover ?? ""),
      intro: String(row.desc ?? ""),
      kind: cleanTags(row.tags),
      lastChapter: "",
      wordCount: formatWords(row.wordCount),
      origin: site,
      originName: SHUSHAN_NAME + " · " + site,
    });
  }
  return books;
}

// ---------------------------------------------------------------- 规则更新

/**
 * 书源会定期发新版（分类表、上游令牌、接口版本都可能变）。这里只同步我们真正依赖的两样：
 * 分类表（发现页的 36 个分类）与上游静态令牌，不去执行它的 JS 规则。
 */
const BUILTIN_RULE_VERSION = "5.67";
const BUILTIN_RULE_DATE = "20261102";

export interface ShushanRuleInfo {
  /** 当前分类表对应的上游版本。 */
  version: string;
  date: string;
  /** 上游最新版本；没查过时为空。 */
  latest: string;
  latestDate: string;
  updateAvailable: boolean;
  checkedAt: string;
  file: string;
  /** 当前分类条数。 */
  categories: number;
}

interface ReleaseInfo {
  version: string;
  date: string;
  file: string;
  url: string;
}

interface ReleaseEntry {
  file?: unknown;
  url?: unknown;
  added_at?: unknown;
}

let releaseCache: { at: number; list: ReleaseEntry[] } | null = null;

function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function compareVersion(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part) || 0);
  const b = right.split(".").map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** 文件名形如 书山聚合v5.67_20261102_1a9207e32626.json。 */
function parseRelease(entry: ReleaseEntry): ReleaseInfo | null {
  const file = String(entry.file ?? "");
  const match = /^书山聚合v(\d+(?:\.\d+)*)_(\d{8})_/.exec(file);
  if (!match) return null;
  // entry.url 指向 sy.vossc.cn，实测解析不了；下载统一走发布站。
  const url = RELEASE_BASE + "download_file.php?f=" + encodeURIComponent(file);
  return { version: match[1], date: match[2], file, url };
}

async function releaseList(force: boolean): Promise<ReleaseInfo[]> {
  let entries: ReleaseEntry[];
  if (!force && releaseCache && Date.now() - releaseCache.at < RULE_CHECK_TTL_MS) {
    entries = releaseCache.list;
  } else {
    const response = await fetch(RELEASE_API, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error("书山聚合：发布页返回 HTTP " + response.status);
    const parsed = (await response.json().catch(() => null)) as unknown;
    entries = Array.isArray(parsed) ? (parsed as ReleaseEntry[]) : [];
    releaseCache = { at: Date.now(), list: entries };
  }
  const out: ReleaseInfo[] = [];
  for (const entry of entries) {
    const info = parseRelease(entry);
    if (info) out.push(info);
  }
  return out;
}

async function newestRelease(force: boolean): Promise<ReleaseInfo> {
  const list = await releaseList(force);
  if (!list.length) throw new Error("书山聚合：发布页没有找到可用的书源文件");
  list.sort((a, b) => compareVersion(b.version, a.version) || (a.date < b.date ? 1 : -1));
  return list[0];
}

function installedRule(): { version: string; date: string } {
  return {
    version: getSetting("shushanRuleVersion", "") || BUILTIN_RULE_VERSION,
    date: getSetting("shushanRuleDate", "") || BUILTIN_RULE_DATE,
  };
}

export function shushanRuleInfo(): ShushanRuleInfo {
  const installed = installedRule();
  const latest = getSetting("shushanRuleLatest", "");
  return {
    version: installed.version,
    date: installed.date,
    latest,
    latestDate: getSetting("shushanRuleLatestDate", ""),
    updateAvailable: Boolean(latest) && compareVersion(latest, installed.version) > 0,
    checkedAt: getSetting("shushanRuleCheckedAt", ""),
    file: getSetting("shushanRuleFile", ""),
    categories: categories().length,
  };
}

/** 只查版本，不下载、不改本地分类表。 */
export async function shushanCheckUpdate(force = false): Promise<ShushanRuleInfo> {
  const newest = await newestRelease(force);
  putSetting("shushanRuleLatest", newest.version);
  putSetting("shushanRuleLatestDate", newest.date);
  putSetting("shushanRuleFile", newest.file);
  putSetting("shushanRuleCheckedAt", nowStamp());
  return shushanRuleInfo();
}

/** 从书源 exploreUrl 的 JS 里抠出分类表（男频数组 + 女频数组）。 */
export function extractCategories(source: string): Category[] {
  const marker = "isMale ? [";
  const at = source.indexOf(marker);
  if (at < 0) return [];
  const rest = source.slice(at + marker.length);
  const split = rest.indexOf("] : [");
  if (split < 0) return [];
  const malePart = rest.slice(0, split);
  const femaleRest = rest.slice(split + 5);
  const femaleEnd = femaleRest.indexOf("]");
  const femalePart = femaleEnd < 0 ? femaleRest : femaleRest.slice(0, femaleEnd);
  const out: Category[] = [];
  const parse = (text: string, gender: 1 | 2): void => {
    const re = /\{id:\s*(\d+),\s*name:\s*"([^"]+)"/g;
    let match = re.exec(text);
    while (match) {
      out.push({ id: Number(match[1]), name: match[2], gender });
      match = re.exec(text);
    }
  };
  parse(malePart, 1);
  parse(femalePart, 2);
  return out;
}

/** 书源 header 里的 X-Novel-Token，会随版本换。 */
export function extractNovelToken(header: string): string {
  const match = /X-Novel-Token\\?\"?\s*:\s*"([^"]{8,64})"/.exec(header);
  return match ? match[1] : "";
}

/** 下载最新书源，刷新分类表与上游令牌；解析失败时保留旧分类表，不把发现页弄坏。 */
export async function shushanApplyUpdate(force = false): Promise<ShushanRuleInfo> {
  const newest = await newestRelease(true);
  const installed = installedRule();
  const stamp = (): void => {
    putSetting("shushanRuleLatest", newest.version);
    putSetting("shushanRuleLatestDate", newest.date);
    putSetting("shushanRuleFile", newest.file);
    putSetting("shushanRuleCheckedAt", nowStamp());
  };
  if (!force && compareVersion(newest.version, installed.version) <= 0) {
    stamp();
    return shushanRuleInfo();
  }
  const response = await fetch(newest.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error("书山聚合：下载书源失败（HTTP " + response.status + "）");
  const parsed = (await response.json().catch(() => null)) as unknown;
  const source = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown> | null;
  if (!source) throw new Error("书山聚合：书源文件不是合法 JSON");
  const nextCategories = extractCategories(String(source.exploreUrl ?? ""));
  const token = extractNovelToken(String(source.header ?? ""));
  stamp();
  if (nextCategories.length) {
    putSetting("shushanCategories", JSON.stringify(nextCategories));
    putSetting("shushanRuleVersion", newest.version);
    putSetting("shushanRuleDate", newest.date);
  }
  if (token) putSetting("shushanNovelToken", token);
  return shushanRuleInfo();
}

// ---------------------------------------------------------------- registration

const INSERT_SOURCE_SQL =
  "INSERT INTO book_sources (name, url, host_key, group_name, type, enabled, enabled_explore, weight, custom_order, json, status) " +
  "VALUES (?, ?, ?, ?, 0, 1, 1, 100, 100, ?, 'ok')";

/**
 * 把内置源登记进 book_sources。已经存在就只刷新 json（书源说明/规则占位），
 * 不改 enabled —— 用户手动关掉的源不该被升级偷偷打开。
 */
export function shushanSourceId(): number | null {
  const row = getDb().prepare("SELECT id FROM book_sources WHERE url = ?").get(SHUSHAN_URL) as { id: number } | undefined;
  return row ? row.id : null;
}

export function ensureShushanSource(): number {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM book_sources WHERE url = ?").get(SHUSHAN_URL) as { id: number } | undefined;
  const json: BookSource = {
    bookSourceName: SHUSHAN_NAME,
    bookSourceUrl: SHUSHAN_URL,
    bookSourceGroup: "聚合书城",
    bookSourceType: 0,
    bookSourceComment:
      "内置聚合源：番茄小说、七猫、书旗、晋江等 32 个站。需要在「设置 → 书山聚合」里登录账号；免费账号可读番茄与七猫的正文。",
    enabled: true,
    enabledExplore: true,
    customOrder: 100,
    searchUrl: "shushan://search",
    exploreUrl: "shushan://explore",
    ruleSearch: { bookList: "shushan://search" },
    ruleExplore: { bookList: "shushan://explore" },
    ruleBookInfo: { name: "shushan://info" },
    ruleToc: { chapterList: "shushan://toc" },
    ruleContent: { content: "shushan://content" },
  };
  const serialized = JSON.stringify(json);
  if (existing) {
    db.prepare("UPDATE book_sources SET json = ?, name = ?, group_name = ? WHERE id = ?").run(
      serialized,
      SHUSHAN_NAME,
      "聚合书城",
      existing.id,
    );
    return existing.id;
  }
  const info = db.prepare(INSERT_SOURCE_SQL).run(SHUSHAN_NAME, SHUSHAN_URL, SHUSHAN_URL, "聚合书城", serialized);
  return Number(info.lastInsertRowid);
}
