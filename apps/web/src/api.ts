import type {
  AnnotationInput,
  AnnotationItem,
  BookDetail,
  BookItem,
  BookmarkItem,
  BookSummary,
  BuiltinSourceCard,
  ChapterContent,
  ChapterImage,
  ChapterItem,
  DahuilangExploreState,
  DahuilangGender,
  DahuilangMode,
  DahuilangStatus,
  NoteItem,
  ProgressHistoryItem,
  ReadingProgress,
  ReanchorApplyResult,
  ReanchorLocateResult,
  SearchBook,
  ShushanExploreState,
  ShushanMode,
  ShushanSite,
  ShushanStatus,
  SourceAuditIssue,
  SourceAuditReport,
  SourceAuditState,
  SourceHealthDetail,
  SourceHealthSummary,
  SourceParseTrace,
  SourceProbeReport,
  Stats,
  SwitchAnchorPayload,
  SwitchHistoryItem,
  SwitchProbeResult,
  SwitchReanchor,
  SwitchResult,
  SyncOp,
  SyncResult,
  TtsCapabilities,
} from "@legado/shared";

// 接口契约只有一份，放在 packages/shared/src/api.ts，服务端 return 的对象也指向它。
export type {
  AnnotationInput,
  AnnotationItem,
  BookDetail,
  BookItem,
  BookmarkItem,
  BookSummary,
  BuiltinSourceCard,
  ChapterContent,
  ChapterImage,
  ChapterItem,
  DahuilangExploreState,
  DahuilangGender,
  DahuilangMode,
  DahuilangStatus,
  NoteItem,
  ProgressHistoryItem,
  ReadingProgress,
  ReanchorApplyResult,
  ReanchorLocateResult,
  SearchBook,
  ShushanExploreState,
  ShushanMode,
  ShushanSite,
  ShushanStatus,
  SourceAuditIssue,
  SourceAuditReport,
  SourceAuditState,
  SourceHealthDetail,
  SourceHealthSummary,
  SourceParseTrace,
  SourceProbeReport,
  Stats,
  SwitchAnchorPayload,
  SwitchHistoryItem,
  SwitchProbeResult,
  SwitchReanchor,
  SwitchResult,
  SyncOp,
  SyncResult,
  TtsCapabilities,
};

export type AuditState = SourceAuditState;

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

export interface SourceDetail {
  id: number;
  name: string;
  url: string;
  group: string;
  enabled: boolean;
  json: BookSourceJson;
  request: SourceRequestSettings;
  audit: SourceAuditReport;
}

export interface ContentPreviewPage {
  url: string;
  chars: number;
  rows: number;
  images: number;
  nextUrl?: string;
}

export interface SourceContentPreview {
  ok: boolean;
  stage?: string;
  error?: string;
  ms: number;
  book?: { name: string; author: string; bookUrl: string; tocUrl?: string } | null;
  chapter?: { title: string; url: string; isVip: boolean };
  chapterCount?: number;
  pages?: ContentPreviewPage[];
  pageCount?: number;
  chars?: number;
  images?: string[];
  imageCount?: number;
  text?: string;
  truncated?: boolean;
}

export interface SourceItem extends SourceHealthSummary {
  id: number;
  name: string;
  url: string;
  group: string;
  type: number;
  enabled: boolean;
  enabledExplore: boolean;
  status: string;
  flag: string;
  lastError: string;
  lastCheckAt: string | null;
  lastMs: number;
}

export interface SourcePage {
  total: number;
  page: number;
  pageSize: number;
  items: SourceItem[];
}

export interface OrganizeReport {
  stats: {
    total: number;
    ok: number;
    /** 健康状态为 broken（多阶段硬失败）的站点数 */
    invalid: number;
    /** 健康状态为 blocked（需要登录/会员/线路）的站点数 */
    blocked: number;
    /** 待补测（unknown 或 degraded）的站点数 */
    retest: number;
    healthy: number;
    degraded: number;
    unknown: number;
    disabled: number;
    duplicateGroups: number;
    duplicateExtra: number;
    groups: number;
  };
  duplicates: Array<{
    key: string;
    count: number;
    keep: { id: number; name: string; url: string; status: string; score: number };
    members: Array<{ id: number; name: string; url: string; status: string; score: number; keep: boolean }>;
  }>;
  invalid: Array<{
    id: number;
    name: string;
    url: string;
    status: string;
    healthState: string;
    healthScore: number;
    error: string;
    checkedAt: string;
    enabled: boolean;
  }>;
  blocked: Array<{
    id: number;
    name: string;
    url: string;
    status: string;
    healthState: string;
    healthScore: number;
    error: string;
    checkedAt: string;
    enabled: boolean;
  }>;
  groups: Array<{ name: string; count: number; ok: number; retest: number; blocked: number; broken: number }>;
}

export interface SearchResponse {
  key: string;
  total: number;
  sources: number;
  okSources: number;
  failedSources: number;
  items: SearchBook[];
  detail: Array<{ sourceId: number; sourceName: string; count: number; error: string | null; ms: number }>;
}

export interface BookGroup {
  id: number;
  name: string;
  orderNo: number;
  count: number;
}

export interface ReadingStats {
  today: number;
  week: number;
  total: number;
  streak: number;
  books: number;
  chapters: number;
  /** 已读章节的正文缓存字符数；清理缓存后会回落，不做估算。 */
  readWords: number;
  goal: number;
}

export interface BookReadStats {
  chapters: number;
  words: number;
}

export interface BookListBook {
  id: number;
  name: string;
  author: string;
  coverUrl: string;
  sourceId: number;
  chapterCount: number;
}

export interface BookList {
  id: number;
  name: string;
  description: string;
  count: number;
  createdAt: string;
  updatedAt: string;
  books: BookListBook[];
}

export interface ReadingHistoryDay {
  day: string;
  seconds: number;
  chapters: number;
  items: Array<{ bookId: number; name: string; chapterIndex: number; chapterTitle: string; seconds: number; chapters: number }>;
}

export interface SearchTerm {
  keyword: string;
  author: string;
}

export interface SearchSuggestion {
  hot: Array<SearchTerm & { count: number }>;
  recent: SearchTerm[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    let code = "";
    let data: unknown;
    try {
      const body = (await res.json()) as { error?: string; message?: string } & Record<string, unknown>;
      message = body.message ?? body.error ?? message;
      code = body.error ?? "";
      data = body;
    } catch {
      /* ignore */
    }
    // 调用方要按错误码分流（toc_shorter 要二次确认、source_audit_failed 要展示审计明细），
    // 只给一句中文文案判断不了。
    const error = new Error(message) as Error & { code?: string; status?: number; data?: unknown };
    error.code = code;
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return (await res.json()) as T;
}

/**
 * 下载书籍导出文件。导出可能 409（一章都没缓存），所以不能直接开新窗口，
 * 否则用户只会看到一页 JSON。
 */
export async function downloadBook(id: number, format: "txt" | "epub"): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/books/${id}/export?format=${format}`);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  let filename = `book-${id}.${format}`;
  if (match) {
    try {
      filename = decodeURIComponent(match[1]);
    } catch {
      /* keep the fallback */
    }
  }
  return { blob: await res.blob(), filename };
}

export const api = {
  stats: () => request<Stats>("/api/stats"),
  exportInfo: (id: number) => request<{ cached: number; total: number }>(`/api/books/${id}/export/info`),
  sources: (params: {
    q?: string;
    status?: string;
    health?: string;
    stage?: string;
    stageStatus?: string;
    group?: string;
    sort?: string;
    minScore?: number;
    maxScore?: number;
    enabled?: "0" | "1";
    page?: number;
    pageSize?: number;
  }) => {
    const search = new URLSearchParams();
    for (const key of ["q", "status", "health", "stage", "stageStatus", "group", "sort", "enabled"] as const) {
      const value = params[key];
      if (value) search.set(key, value);
    }
    if (params.minScore !== undefined) search.set("minScore", String(params.minScore));
    if (params.maxScore !== undefined) search.set("maxScore", String(params.maxScore));
    search.set("page", String(params.page ?? 1));
    search.set("pageSize", String(params.pageSize ?? 50));
    return request<SourcePage>(`/api/sources?${search.toString()}`);
  },
  sourceHealth: (id: number) => request<SourceHealthDetail>(`/api/sources/${id}/health`),
  builtinSources: () => request<{ items: BuiltinSourceCard[] }>("/api/sources/builtins"),
  probeSource: (id: number, body: { mode?: "quick" | "full"; key?: string; bookUrl?: string; chapterUrl?: string }) =>
    request<SourceProbeReport>(`/api/sources/${id}/probe`, { method: "POST", body: JSON.stringify(body) }),
  resetSourceHealth: (id: number) =>
    request<{ ok: boolean }>(`/api/sources/${id}/health/reset`, { method: "POST" }),
  importJson: (json: string) =>
    request<{ total: number; inserted: number; updated: number; skipped: number }>("/api/sources/import", {
      method: "POST",
      body: JSON.stringify({ json }),
    }),
  search: (key: string, sourceIds?: number[], author = "") => {
    const search = new URLSearchParams({ key });
    if (author) search.set("author", author);
    if (sourceIds?.length) search.set("sources", sourceIds.join(","));
    return request<SearchResponse>(`/api/search?${search.toString()}`);
  },
  createBook: (payload: {
    sourceId: number;
    bookUrl: string;
    name?: string;
    author?: string;
    coverUrl?: string;
    intro?: string;
    wordCount?: string;
    lastChapter?: string;
    /** 只建预览记录：不入书架、不抓详情/目录（发现页点书 → 详情页）。 */
    preview?: boolean;
  }) =>
    request<{ book: BookSummary; existed: boolean; infoError: string | null; tocError: string | null }>("/api/books", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  books: (params: { q?: string; sort?: string; group?: string | number } = {}) => {
    const search = new URLSearchParams({ inShelf: "1" });
    if (params.q) search.set("q", params.q);
    if (params.sort) search.set("sort", params.sort);
    if (params.group !== undefined && params.group !== "all") search.set("group", String(params.group));
    return request<{ items: BookItem[] }>(`/api/books?${search.toString()}`);
  },
  book: (id: number) => request<BookDetail>(`/api/books/${id}`),
  refreshBook: (id: number) =>
    request<{ book: BookSummary; chapters: number; infoError: string | null; tocError: string | null }>(`/api/books/${id}/refresh`, {
      method: "POST",
    }),
  switchBook: (
    id: number,
    payload: {
      sourceId: number;
      bookUrl: string;
      expectName?: string;
      expectAuthor?: string;
      force?: boolean;
      /** 用户已确认「目标源目录明显更少」，仍要换。 */
      allowShorter?: boolean;
      chapterIndex?: number;
      chapterTitle?: string;
      /** 换源前读者所在的那一句，服务端存下来给另一台设备接续。 */
      anchor?: SwitchAnchorPayload | null;
    },
  ) =>
    request<SwitchResult>(`/api/books/${id}/switch`, { method: "POST", body: JSON.stringify(payload) }),
  /** 撤销上一次换源：换回 switch_history 记着的源与章节位置。 */
  undoSwitch: (id: number, payload?: { chapterIndex?: number; chapterTitle?: string }) =>
    request<SwitchResult>(`/api/books/${id}/switch/undo`, {
      method: "POST",
      body: payload ? JSON.stringify(payload) : undefined,
    }),
  /** 换源记录：最近 5 次手动/自动换源，面板里解释「从哪换来的」。 */
  switchHistory: (id: number) =>
    request<{ total: number; items: SwitchHistoryItem[] }>(`/api/books/${id}/switch/history`),
  /** 重试重贴：换源时没跟过来的标注/书签，用最近一次快照再定位一遍（幂等）。 */
  retryReanchor: (id: number) => request<{ ok: boolean; reanchor: SwitchReanchor }>(`/api/books/${id}/reanchor`, { method: "POST" }),
  /** 手动定位：列出引文在新源目标章里的命中位置。 */
  locateReanchor: (id: number, payload: { kind: "annotation" | "bookmark"; id: string | number; chapterIndex?: number }) =>
    request<ReanchorLocateResult>(`/api/books/${id}/reanchor/locate`, { method: "POST", body: JSON.stringify(payload) }),
  /** 手动定位：写回用户选中的位置。 */
  applyReanchor: (id: number, payload: { kind: "annotation" | "bookmark"; id: string | number; chapterIndex: number; start: number; end: number }) =>
    request<ReanchorApplyResult>(`/api/books/${id}/reanchor/apply`, { method: "POST", body: JSON.stringify(payload) }),
  probeSwitch: (id: number, payload: { sourceId: number; bookUrl: string }) =>
    request<SwitchProbeResult>(`/api/books/${id}/switch/probe`, { method: "POST", body: JSON.stringify(payload) }),
  patchBook: (id: number, patch: { inShelf?: boolean; note?: string; groupId?: number; name?: string; author?: string; intro?: string; coverUrl?: string }) =>
    request<{ ok: boolean }>(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  batchBooks: (ids: number[], action: "remove" | "group" | "refresh", groupId?: number) =>
    request<{ ok: boolean; affected: number; items?: Array<{ id: number; ok: boolean; newChapters: number; error?: string }> }>(
      "/api/books/batch",
      { method: "POST", body: JSON.stringify({ ids, action, groupId }) },
    ),
  bookGroups: () => request<{ total: number; items: BookGroup[] }>("/api/book-groups"),
  addBookGroup: (name: string) => request<{ ok: boolean; id: number }>("/api/book-groups", { method: "POST", body: JSON.stringify({ name }) }),
  patchBookGroup: (id: number, patch: { name?: string; orderNo?: number }) =>
    request<{ ok: boolean }>(`/api/book-groups/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeBookGroup: (id: number) => request<{ ok: boolean }>(`/api/book-groups/${id}`, { method: "DELETE" }),
  bookLists: () => request<{ total: number; items: BookList[] }>("/api/book-lists"),
  bookList: (id: number) => request<BookList>(`/api/book-lists/${id}`),
  addBookList: (payload: { name: string; description?: string }) =>
    request<{ ok: boolean; id: number }>("/api/book-lists", { method: "POST", body: JSON.stringify(payload) }),
  patchBookList: (id: number, payload: { name?: string; description?: string }) =>
    request<{ ok: boolean }>(`/api/book-lists/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  removeBookList: (id: number) => request<{ ok: boolean }>(`/api/book-lists/${id}`, { method: "DELETE" }),
  addBookToList: (id: number, bookId: number) =>
    request<{ ok: boolean; added: boolean }>(`/api/book-lists/${id}/books`, { method: "POST", body: JSON.stringify({ bookId }) }),
  removeBookFromList: (id: number, bookId: number) =>
    request<{ ok: boolean }>(`/api/book-lists/${id}/books/${bookId}`, { method: "DELETE" }),
  bookListsOf: (bookId: number) =>
    request<{ total: number; items: Array<{ id: number; name: string; count: number; has: boolean }> }>(`/api/books/${bookId}/lists`),
  importTxt: (payload: { name?: string; author?: string; content: string }) =>
    request<{ bookId: number; chapters: number; title: string; existed: boolean }>("/api/import/txt", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importEpub: (name: string, data: ArrayBuffer) =>
    request<{ bookId: number; chapters: number; title: string; existed: boolean }>(
      `/api/import/epub?name=${encodeURIComponent(name)}`,
      { method: "POST", body: data, headers: { "content-type": "application/octet-stream" } },
    ),
  readingStats: () => request<ReadingStats>("/api/reading/stats"),
  readingHistory: (days = 30) => request<{ days: number; total: number; items: ReadingHistoryDay[] }>(`/api/reading/history?days=${days}`),
  readingTime: (id: number, payload: { seconds: number; chapters?: number }) =>
    request<{ ok: boolean }>(`/api/books/${id}/reading-time`, { method: "POST", body: JSON.stringify(payload) }),
  searchSuggest: () => request<SearchSuggestion>("/api/search/suggest"),
  clearSearchHistory: () => request<{ ok: boolean }>("/api/search/history", { method: "DELETE" }),
  rankings: (refresh = false) =>
    request<{
      total: number;
      scanned: number;
      cached?: boolean;
      auditedAt?: string;
      items: Array<{
        sourceId: number;
        sourceName: string;
        groups: Array<{
          title: string;
          url: string;
          count?: number;
          score?: number;
          ms?: number;
          sample?: Array<{ name: string; coverUrl: string }>;
        }>;
      }>;
    }>(`/api/explore/rankings${refresh ? "?refresh=1" : ""}`),
  chapters: (id: number) => request<{ total: number; items: ChapterItem[] }>(`/api/books/${id}/chapters`),
  content: (id: number, index: number) =>
    request<ChapterContent>(`/api/books/${id}/chapters/${index}/content`),
  saveProgress: (
    id: number,
    payload: { chapterIndex: number; offset?: number; percent?: number; charOffset?: number; chapterPercent?: number },
  ) => request<{ ok: boolean }>(`/api/books/${id}/progress`, { method: "PUT", body: JSON.stringify(payload) }),
  removeBook: (id: number) => request<{ ok: boolean }>(`/api/books/${id}`, { method: "DELETE" }),
  bookmarks: (id: number) =>
    request<{ total: number; items: BookmarkItem[] }>(`/api/books/${id}/bookmarks`),
  addBookmark: (id: number, payload: { chapterIndex: number; title?: string; excerpt?: string; charOffset?: number }) =>
    request<{ ok: boolean; id: number }>(`/api/books/${id}/bookmarks`, { method: "POST", body: JSON.stringify(payload) }),
  removeBookmark: (id: number, bookmarkId: number) =>
    request<{ ok: boolean }>(`/api/books/${id}/bookmarks/${bookmarkId}`, { method: "DELETE" }),
  annotations: (id: number, chapter?: number) =>
    request<{ total: number; items: AnnotationItem[] }>(
      `/api/books/${id}/annotations${chapter === undefined ? "" : `?chapter=${chapter}`}`,
    ),
  saveAnnotation: (id: number, payload: AnnotationInput) =>
    request<{ ok: boolean; item: AnnotationItem }>(`/api/books/${id}/annotations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  patchAnnotation: (id: number, annotationId: string, payload: { comment?: string; color?: string; type?: string }) =>
    request<{ ok: boolean; item: AnnotationItem }>(`/api/books/${id}/annotations/${annotationId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  removeAnnotation: (id: number, annotationId: string) =>
    request<{ ok: boolean; removed: boolean }>(`/api/books/${id}/annotations/${annotationId}`, {
      method: "DELETE",
    }),
  notes: (params: { q?: string; type?: string; limit?: number; offset?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.type) search.set("type", params.type);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined) search.set("offset", String(params.offset));
    const query = search.toString();
    return request<{ total: number; items: NoteItem[] }>(`/api/notes${query ? `?${query}` : ""}`);
  },
  sync: (ops: SyncOp[]) => request<SyncResult>("/api/sync", { method: "POST", body: JSON.stringify({ ops }) }),
  organize: () => request<OrganizeReport>("/api/sources/organize"),
  mergeDuplicates: (payload: { keys?: string[]; all?: boolean }) =>
    request<{ ok: boolean; mergedGroups: number; removed: number }>("/api/sources/organize/merge", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  batchSources: (
    ids: number[],
    action: "enable" | "disable" | "delete" | "group",
    opts: { group?: string; targetGroup?: string } = {},
  ) =>
    request<{ ok: boolean; affected: number }>("/api/sources/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action, group: opts.group, targetGroup: opts.targetGroup }),
    }),
  patchSource: (id: number, patch: { enabled?: boolean; enabledExplore?: boolean; name?: string; group?: string; force?: boolean }) =>
    request<{ ok: boolean; audit?: SourceAuditReport }>(`/api/sources/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  auditSource: (id: number) => request<SourceAuditReport>(`/api/sources/${id}/audit`, { method: "POST" }),
  sourceDetail: (id: number) => request<SourceDetail>(`/api/sources/${id}`),
  saveSourceRequest: (id: number, patch: { header?: string; loginUrl?: string; enabledCookieJar?: boolean }) =>
    request<{ ok: boolean; request: SourceRequestSettings }>(`/api/sources/${id}/request`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  probeSourceRequest: (id: number, url?: string) =>
    request<SourceRequestProbe>(`/api/sources/${id}/request/probe`, {
      method: "POST",
      body: JSON.stringify({ url: url?.trim() || undefined }),
    }),
  deleteSource: (id: number) => request<{ ok: boolean }>(`/api/sources/${id}`, { method: "DELETE" }),
  importSources: (payload: { url?: string; json?: string; sources?: unknown }) =>
    request<{
      total: number;
      inserted: number;
      updated: number;
      skipped: number;
      errors: Array<{ index: number; message: string }>;
      audits: Array<{ index: number; name: string; errors: number; warnings: number; issues: SourceAuditIssue[] }>;
    }>("/api/sources/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  checkSources: (ids: number[], key = "诡秘之主") =>
    request<{ total: number; ok: number; items: Array<{ id: number; name: string; ok: boolean; count: number; error: string | null; ms: number }> }>(
      "/api/sources/check",
      { method: "POST", body: JSON.stringify({ ids, key }) },
    ),
  auditSources: (body: {
    all?: boolean;
    status?: string;
    health?: string;
    stage?: string;
    stageStatus?: string;
    group?: string;
    q?: string;
    key?: string;
    ids?: number[];
    mode?: "quick" | "full";
    concurrency?: number;
  }) =>
    request<AuditState>("/api/sources/audit/start", { method: "POST", body: JSON.stringify(body) }),
  auditStatus: () => request<AuditState>("/api/sources/audit/status"),
  stopAudit: () => request<AuditState>("/api/sources/audit/stop", { method: "POST" }),
  resumeAudit: () => request<AuditState>("/api/sources/audit/resume", { method: "POST" }),
  debugSource: (id: number, key = "诡秘之主") =>
    request<{
      source: { id: number; name: string; url: string; group: string; status: string };
      rules: Record<string, unknown>;
      keyword: string;
      ms: number;
      error: string | null;
      total: number;
      books: SearchBook[];
      events: Array<{ stage: string; [k: string]: unknown }>;
    }>(`/api/sources/${id}/debug?key=${encodeURIComponent(key)}`),
  previewSourceContent: (id: number, body: { key?: string; bookUrl?: string; chapterUrl?: string; maxPages?: number }) =>
    request<SourceContentPreview>(`/api/sources/${id}/content-preview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  traceSource: (id: number, body: { stage?: "pipeline" | "search" | "detail" | "toc" | "content"; key?: string; page?: number; bookUrl?: string; chapterUrl?: string; maxItems?: number; maxPages?: number }) =>
    request<SourceParseTrace>(`/api/sources/${id}/trace`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  exploreSources: () =>
    request<{
      total: number;
      items: Array<{
        id: number;
        name: string;
        group: string;
        status: string;
        hasExploreRule: boolean;
        exploreKind: string;
        /** 内置聚合源（书山聚合 / 大灰狼聚合），发现页永远排在最前。 */
        builtin?: boolean;
        builtinKind?: "shushan" | "dahuilang";
      }>;
    }>("/api/explore/sources"),
  exploreGroups: (sourceId: number) =>
    request<{ groups: Array<{ title: string; url: string; section?: string }> }>(`/api/explore/${sourceId}/groups`),
  exploreItems: (sourceId: number, url: string, page = 1, title = "") =>
    request<{ total: number; items: SearchBook[] }>(
      `/api/explore/${sourceId}/items?url=${encodeURIComponent(url)}&page=${page}&title=${encodeURIComponent(title)}`,
    ),
  subscriptions: () =>
    request<{
      items: Array<{
        id: number;
        name: string;
        url: string;
        type: string;
        enabled: boolean;
        autoRefresh: boolean;
        lastFetchAt: string | null;
        count: number;
      }>;
      publish: { token: string; url: string } | null;
    }>("/api/subscriptions"),
  addSubscription: (url: string, name?: string) =>
    request<{ id: number; created: boolean; refresh: { added: number; updated: number; total: number; skipped: boolean } | { error: string } }>(
      "/api/subscriptions",
      { method: "POST", body: JSON.stringify({ url, name }) },
    ),
  refreshSubscription: (id: number) =>
    request<{ added: number; updated: number; total: number; skipped: boolean }>(`/api/subscriptions/${id}/refresh`, { method: "POST" }),
  deleteSubscription: (id: number) => request<{ ok: boolean }>(`/api/subscriptions/${id}`, { method: "DELETE" }),
  publishFeed: () => request<{ token: string; url: string }>("/api/subscriptions/publish", { method: "POST" }),
  unpublishFeed: () => request<{ ok: boolean }>("/api/subscriptions/publish", { method: "DELETE" }),
  replaceRules: () =>
    request<{
      items: Array<{ id: number; name: string; pattern: string; replacement: string; scope: string; isRegex: boolean; enabled: boolean }>;
    }>("/api/replace-rules"),
  addReplaceRule: (payload: { name?: string; pattern: string; replacement?: string; scope?: string; is_regex?: boolean }) =>
    request<{ id: number }>("/api/replace-rules", { method: "POST", body: JSON.stringify(payload) }),
  replacePresets: () =>
    request<{
      items: Array<{
        key: string;
        name: string;
        description: string;
        pattern: string;
        replacement: string;
        scope: string;
        installed: boolean;
      }>;
    }>("/api/replace-rules/presets"),
  addReplacePresets: (keys?: string[]) =>
    request<{ ok: boolean; added: number; skipped: number; keys: string[] }>("/api/replace-rules/presets", {
      method: "POST",
      body: JSON.stringify({ keys }),
    }),
  patchReplaceRule: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/replace-rules/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteReplaceRule: (id: number) => request<{ ok: boolean }>(`/api/replace-rules/${id}`, { method: "DELETE" }),
  testReplace: (text: string) => request<{ result: string }>("/api/replace-rules/test", { method: "POST", body: JSON.stringify({ text }) }),
  settings: () => request<Record<string, string>>("/api/settings"),
  saveSettings: (payload: Record<string, string | number | boolean>) =>
    request<{ ok: boolean }>("/api/settings", { method: "PUT", body: JSON.stringify(payload) }),
  tts: () => request<TtsCapabilities>("/api/tts"),
  shushanStatus: () => request<ShushanStatus>("/api/shushan/status"),
  dahuilangStatus: () => request<DahuilangStatus>("/api/dahuilang/status"),
  dahuilangLogin: (payload: { email?: string; password?: string; key?: string }) =>
    request<DahuilangStatus & { ok: boolean }>("/api/dahuilang/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  dahuilangLogout: () => request<DahuilangStatus & { ok: boolean }>("/api/dahuilang/logout", { method: "POST" }),
  shushanLogin: (email: string, password: string) =>
    request<ShushanStatus & { ok: boolean }>("/api/shushan/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  shushanLogout: () => request<ShushanStatus & { ok: boolean }>("/api/shushan/logout", { method: "POST" }),
  shushanCheck: () => request<ShushanStatus & { ok: boolean }>("/api/shushan/check", { method: "POST" }),
  shushanUpdate: () => request<ShushanStatus & { ok: boolean }>("/api/shushan/update", { method: "POST" }),
  /** 发现页控制条：模式 / 性别 / 源站 / 标签。 */
  shushanExplore: () => request<ShushanExploreState>("/api/shushan/explore"),
  shushanExploreSave: (patch: { mode?: ShushanMode; gender?: "boy" | "girl"; site?: string; tag?: string }) =>
    request<ShushanExploreState & { ok: boolean }>("/api/shushan/explore", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  /** 发现页控制条：大灰狼聚合的模式 / 频道 / 平台 / 番茄筛选。 */
  dahuilangExplore: () => request<DahuilangExploreState>("/api/dahuilang/explore"),
  dahuilangExploreSave: (patch: {
    mode?: DahuilangMode;
    gender?: DahuilangGender;
    source?: string;
    word?: string;
    status?: string;
    sort?: string;
  }) =>
    request<DahuilangExploreState & { ok: boolean }>("/api/dahuilang/explore", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  readingHeatmap: (weeks = 53) =>
    request<{ weeks: number; goal: number; days: Array<{ day: string; seconds: number; chapters: number }>; longest: number }>(
      `/api/reading/heatmap?weeks=${weeks}`,
    ),
  progressHistory: (id: number, limit = 50) =>
    request<{ total: number; items: ProgressHistoryItem[] }>(`/api/books/${id}/progress-history?limit=${limit}`),
  clearProgressHistory: (id: number) =>
    request<{ ok: boolean; removed: number }>(`/api/books/${id}/progress-history`, { method: "DELETE" }),
  bookReadStats: (id: number) => request<BookReadStats>(`/api/books/${id}/read-stats`),
  readChapters: (id: number) => request<{ total: number; items: number[] }>(`/api/books/${id}/read-chapters`),
  markRead: (id: number, index: number) =>
    request<{ ok: boolean; total: number }>(`/api/books/${id}/read-chapters`, {
      method: "POST",
      body: JSON.stringify({ index }),
    }),
};