/**
 * 服务端与前端共用的接口契约。
 *
 * 以前这些形状在 `apps/web/src/api.ts` 和 `apps/server/src/routes/*` 里各写一份，
 * 改一边忘一边就会变成「前端读不到字段」的静默 bug。现在只有这一份：
 * 服务端 return 的对象和前端 request<T> 的 T 都指向这里。
 */

/** 书籍元信息（详情接口 / 增删改接口返回的 book 字段）。 */
export interface BookSummary {
  id: number;
  name: string;
  author: string;
  coverUrl: string;
  intro: string;
  kind: string;
  lastChapter: string;
  wordCount: string;
  tocUrl: string;
  sourceId: number;
  originName: string;
  note: string;
  groupId: number;
  newChapters: number;
  lastCheckedAt: string | null;
  inShelf: boolean;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
}

/** 书架列表项：元信息 + 当前阅读进度。 */
export interface BookItem extends BookSummary {
  chapterIndex: number;
  chapterPercent: number;
  charOffset: number;
  percent: number;
  readAt: string | null;
}

export interface ReadingProgress {
  chapterIndex: number;
  offset: number;
  charOffset: number;
  chapterPercent: number;
  percent: number;
  updatedAt: string | null;
}

/**
 * 一条阅读位置历史。chapter_index + char_offset 就能直接跳回去；
 * percent 只用来排序与展示，不参与定位。
 */
export interface ProgressHistoryItem {
  id: number;
  chapterIndex: number;
  chapterTitle: string;
  charOffset: number;
  percent: number;
  createdAt: string;
  updatedAt: string;
}

export type SwitchHistoryKind = "manual" | "auto";

/** 最近一次换源前的源：详情页/阅读页据此判断「换回原源」是否可用，并把按钮写清楚。 */
export interface SwitchHistorySummary {
  id: number;
  /** 这次换源是读者点的，还是正文太短时服务端自动触发的。 */
  kind: SwitchHistoryKind;
  sourceId: number | null;
  sourceName: string;
  chapters: number;
  chapterIndex: number;
  chapterTitle: string;
  createdAt: string;
}

/** 换源记录列表项：换源面板用它解释「上次为什么换了、从哪换来的」。 */
export interface SwitchHistoryItem extends SwitchHistorySummary {
  bookUrl: string;
  bookName: string;
  charOffset: number;
}

export interface BookDetail {
  book: BookItem;
  progress: ReadingProgress | null;
  source: { name: string; url: string; status: string; healthState?: HealthState; healthScore?: number } | null;
  /** 有换源历史时才有；没有历史时前端不要显示可点的「换回原源」。 */
  lastSwitch?: SwitchHistorySummary | null;
  /** 换源前读者所在的那一句；服务端保留 24 小时，供另一台设备打开时接续。 */
  switchAnchor?: SwitchAnchorPayload | null;
}

/** 换源锚点：换源前读者读到的句子及前后文，用来在新源里重新贴回同一位置。 */
export interface SwitchAnchorPayload {
  chapterIndex: number;
  chapterTitle: string;
  charOffset: number;
  chapterPercent: number;
  quote: string;
  prefix: string;
  suffix: string;
  /** quote 在旧章正文里的起点，用来把 charOffset 换算成 quote 内偏移。 */
  quoteStart: number;
}

export interface ChapterItem {
  id: number;
  idx: number;
  title: string;
  url: string;
  isVip: boolean;
  isVolume: boolean;
  words: number;
}

export interface ChapterList {
  total: number;
  items: ChapterItem[];
}

/** 正文太短/取不到时服务端自动换源的结果摘要。 */
export interface AutoSwitchSummary {
  attempted: boolean;
  switched: boolean;
  reason: string;
  fromSourceId?: number;
  fromSourceName?: string;
  toSourceId?: number;
  toSourceName?: string;
  chapters?: number;
  /** 换源前旧目录的章数：回执里显示「884 → 837 章」。 */
  chaptersBefore?: number;
  scanned?: number;
  candidates?: number;
  /** 自动换源也写 switch_history；有 historyId 才能撤销。 */
  historyId?: number;
  canUndo?: boolean;
  /** 自动换源时标注/书签的重贴统计。 */
  reanchor?: SwitchReanchor;
}

/** 正文里的一张插图：src 已经过服务端代理，after 表示它前面有多少段正文。 */
export interface ChapterImage {
  src: string;
  after: number;
}

export interface ChapterContent {
  chapter: { id: number; idx: number; title: string; url: string };
  content: string;
  /** 正文插图，可能为空数组（纯文字章节或旧缓存）。 */
  images?: ChapterImage[];
  total: number;
  index: number;
  autoSwitch: AutoSwitchSummary | null;
  /** 正文质量；正常正文也可能带 ok，旧缓存没有这个字段。 */
  quality?: ContentQualityReport | null;
}

export interface BookmarkItem {
  id: number;
  chapterIndex: number;
  title: string;
  excerpt: string;
  charOffset: number;
  createdAt?: string;
}

export const ANNOTATION_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export const ANNOTATION_TYPES = ["highlight", "note", "bookmark"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

/**
 * 划线 / 笔记 / 书内书签。位置是**章节内字符偏移**（与服务端进度 charOffset 同一坐标系），
 * quote + prefix/suffix 是重定位兜底：正文被书源改过之后，偏移失效还能靠上下文找回原句。
 */
export interface AnnotationItem {
  id: string;
  bookId: number;
  type: AnnotationType;
  chapterIndex: number;
  chapterTitle: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  color: AnnotationColor;
  createdAt: string;
  updatedAt: string;
}

/** 跨书笔记列表里的一条：标注本身 + 它所属的书（笔记中心要能显示书名并跳回阅读页）。 */
export interface NoteItem extends AnnotationItem {
  bookName: string;
  bookAuthor: string;
  bookCover: string;
}

/** 新建/更新一条标注时提交的字段（id 缺省时由服务端生成）。 */
export interface AnnotationInput {
  id?: string;
  type?: AnnotationType;
  chapterIndex?: number;
  chapterTitle?: string;
  start?: number;
  end?: number;
  quote?: string;
  prefix?: string;
  suffix?: string;
  comment?: string;
  color?: AnnotationColor;
}

/** 书山聚合的四种内容模式：模式决定「源站」下拉里能选哪些站。 */
export type ShushanMode = "novel" | "audio" | "comic" | "video";

export interface ShushanSite {
  name: string;
  type: ShushanMode;
  /** 源站自己标了免费（番茄 / 七猫等），其余多为 VIP 源。 */
  free: boolean;
}

/** 发现页控制条的当前状态。site 为空表示「聚合」：小说按番茄分类，其他模式会落到该类型第一个源站。 */
export interface ShushanExploreState {
  mode: ShushanMode;
  gender: "boy" | "girl";
  site: string;
  tag: string;
  sites: ShushanSite[];
  modes: Array<{ id: ShushanMode; label: string; count: number }>;
}

/** 大灰狼聚合的四种内容模式，对应上游 /discovestyle 的 tab 参数。 */
export type DahuilangMode = "小说" | "听书" | "短剧" | "漫画";
export type DahuilangGender = "男频" | "女频";

/** 大灰狼聚合发现页控制条：模式 / 频道 / 平台 / 番茄分类筛选。 */
export interface DahuilangExploreState {
  mode: DahuilangMode;
  gender: DahuilangGender;
  /** 当前平台，例如「番茄」「七猫」「书旗」。 */
  source: string;
  /** 当前模式下可选的平台清单。 */
  sources: string[];
  modes: Array<{ id: DahuilangMode; label: string; count: number }>;
  /** 只对「番茄 + 小说」的普通分类生效；其他模式忽略。 */
  filters: { word: string; status: string; sort: string };
  filterOptions: { word: string[]; status: string[]; sort: string[] };
}

/** 内置「大灰狼聚合」源的账号状态（qttoken 只在服务端）。 */
export interface DahuilangStatus {
  configured: boolean;
  sourceId: number | null;
  /** 当前线路，默认 https://v5.langge.uk。 */
  server: string;
  email: string;
  nickname: string;
  member: boolean;
  /** 会员标签：VIP / SVIP；未开通时为空。 */
  vipLabel: string;
  /** 设备号末 6 位，用来提示「正在用哪台设备的额度」。 */
  deviceTail: string;
}

/** 内置「书山聚合」源的账号状态（api_key 只在服务端）。 */
export interface ShushanStatus {
  configured: boolean;
  sourceId: number | null;
  email: string;
  nickname: string;
  member: boolean;
  /** 设备号末 6 位，用来提示「正在用哪台设备的额度」。 */
  deviceTail: string;
  /** 内置分类表对应的上游书源版本，例如 5.67。 */
  version: string;
  date: string;
  /** 上游最新版本；还没查过时为空。 */
  latest: string;
  latestDate: string;
  updateAvailable: boolean;
  checkedAt: string;
  file: string;
  /** 当前分类条数。 */
  categories: number;
}

/**
 * 朗读服务的自述能力。enabled=false 表示服务端没配 TTS_URL，客户端必须退回浏览器语音；
 * maxChars 是单次合成上限（超长客户端自己切句），voices 为空表示不限定音色。
 */
export interface TtsCapabilities {
  enabled: boolean;
  format: string;
  maxChars: number;
  voices: string[];
}

/**
 * 离线写入队列里的一条操作。客户端断网时把「保存进度 / 新建划线 / 加书签」攒在本地，
 * 恢复网络后一次性 POST /api/sync 补传。`at` 是客户端产生这条操作的时间（毫秒），
 * 只用来排序与生成 id，不参与服务端的先后判定——服务端永远以自己的时钟为准。
 */
export type SyncOp =
  | {
      id: string;
      kind: "progress";
      bookId: number;
      at: number;
      chapterIndex: number;
      charOffset: number;
      chapterPercent: number;
      percent: number;
      offset?: number;
    }
  | { id: string; kind: "annotation"; bookId: number; at: number; annotation: AnnotationInput }
  | { id: string; kind: "annotation-delete"; bookId: number; at: number; annotationId: string }
  | {
      id: string;
      kind: "bookmark-add";
      bookId: number;
      at: number;
      chapterIndex: number;
      title: string;
      excerpt: string;
      charOffset: number;
    }
  | { id: string; kind: "bookmark-delete"; bookId: number; at: number; chapterIndex: number; charOffset: number }
  | { id: string; kind: "read"; bookId: number; at: number; chapterIndex: number };

/** 批量补传的结果：逐条应用，坏一条只记错误，不拖累其余。 */
export interface SyncResult {
  ok: boolean;
  applied: number;
  failed: Array<{ id: string; error: string }>;
  /** 服务端处理完的时间（YYYY-MM-DD HH:MM:SS，UTC），客户端拿来做「上次同步」显示。 */
  at: string;
}

/** 发现页卡片的展示清洗结果：书源原始字段五花八门，这里只保留能被可靠识别的内容。 */
export interface ExploreBookDisplay {
  author: string;
  categories: string[];
  status: string;
  rating: number | null;
  wordCount: number | null;
  wordCountText: string;
  updatedAt: string;
  lastChapter: string;
  intro: string;
  /** rich=作者/分类/状态/字数基本齐全；partial=有部分信息；minimal=只有书名封面。 */
  completeness: "rich" | "partial" | "minimal";
}

/** 搜索结果里的一条书。 */
/** 全书搜索的一条命中：只带章节坐标与摘录，正文由客户端按需再取。 */
export interface BookSearchHit {
  chapterIndex: number;
  chapterTitle: string;
  /** 本章命中次数（服务端每章最多数 5 处）。 */
  count: number;
  /** 第一处命中的章节内字符偏移。 */
  offset: number;
  excerpt: string;
}

export interface SearchBook {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl: string;
  intro: string;
  kind: string;
  lastChapter: string;
  wordCount: string;
  origin: string;
  originName: string;
  sourceId: number;
  /** 搜索时该条结果所属书源的健康状态；旧调用方可以不带。 */
  healthState?: HealthState;
  healthScore?: number;
  /** 发现接口额外附带的展示清洗结果；搜索结果没有这个字段。 */
  display?: ExploreBookDisplay;
}

export type ContentQuality = "ok" | "suspect" | "bad";

/** 正文里的乱码/替换字符特征，用来把「源站自己就坏了」和「正文太短」区分开。 */
export interface ContentQualityFlags {
  replacement: number;
  privateUse: number;
  questionMarks: number;
  controlChars: number;
}

/** 阅读页正文质量报告；flags 只在 suspect/bad 时带。 */
export interface ContentQualityReport {
  quality: ContentQuality;
  score: number;
  reason: string;
  flags?: ContentQualityFlags;
  replacementRatio?: number;
}

/** 换源候选（服务端并发探测后的结论）。 */
export interface SwitchCandidate {
  sourceId: number;
  sourceName: string;
  /** 书源分组名（书源管理里的 group_name）：换源面板按分组筛选。 */
  sourceGroup?: string;
  sourceStatus: string;
  name: string;
  author: string;
  bookUrl: string;
  coverUrl: string;
  kind: string;
  lastChapter: string;
  wordCount: string;
  /** 同一地址被多少个源返回（QB/QQ 系动辄十几个源共用一个 api 地址）。 */
  duplicates: number;
  status: "pending" | "ok" | "warn" | "fail";
  chapters: number;
  ms: number;
  titleOk: boolean;
  authorOk: boolean | "unknown";
  /** 给用户看的一句话原因。 */
  reason: string;
  error: string;
  /** 阅读中换源时的实测字数（当前章节，该源）；未测或失败时没有这个字段。 */
  chars?: number;
  /** 实测命中的章节标题（目录顺序和当前书不完全一致时提示用户量的是哪一章）。 */
  chapterTitle?: string;
  measureMs?: number;
  measureError?: string;
  /** 实测那一章是否靠章节名对上；false 表示只按章号或位置凑的，字数不可比。 */
  matched?: boolean;
  /** 命中依据：exact/core/cleaned/similar 是名字对上，ordinal 只有章号相同，index 是位置兜底。 */
  matchReason?: string;
  matchScore?: number;
  /** 客户端折叠镜像时算出：这一行代表几个内容相同的域名。 */
  mirrors?: number;
  /** 内置源（书山聚合）：换源时优先搜索，面板上标「内置」。 */
  builtin?: boolean;
  /** 从缓存读出的候选：多少毫秒之前检测的（0 或缺失表示这次刚测）。 */
  ageMs?: number;
  /** 这一章是否已经实测过（false 表示目录来自缓存、字数正在补测）。 */
  measured?: boolean;
  /** 实测章节的前 120 字，换源面板里给一眼预览。 */
  excerpt?: string;
  /** 实测章节的前 600 字（保留段落），换源面板展开「试读开头」用。 */
  preview?: string;
  /** 该源当前健康状态（换源排序和卡片提示用）。 */
  sourceHealthState?: HealthState;
  sourceHealthScore?: number;
  /** 测到的正文质量：ok / suspect（可疑）/ bad（占位、防盗、HTML 残留等）。 */
  contentQuality?: ContentQuality;
  contentQualityScore?: number;
  contentQualityReason?: string;
}

/** 单个候选的「当前章节字数」实测结果（SSE measure 事件）。 */
export interface ChapterMeasure {
  sourceId: number;
  bookUrl: string;
  ok: boolean;
  chars: number;
  chapterIndex: number;
  chapterTitle: string;
  ms: number;
  error: string;
  /** 章节名是否对上（名字类依据为 true；没走到定位这一步时缺省，表示「不知道」）。 */
  matched?: boolean;
  matchReason?: string;
  matchScore?: number;
  /** 实测章节正文的开头；失败时没有。 */
  excerpt?: string;
  /** 实测章节正文的前 600 字（保留段落），失败时没有。 */
  preview?: string;
  contentQuality?: ContentQuality;
  contentQualityScore?: number;
  contentQualityReason?: string;
}

export interface SwitchMatch {
  title: boolean;
  author: boolean | "unknown";
  forced?: boolean;
}

export interface SwitchProgress {
  matched: boolean;
  index: number;
  title: string;
}

export interface SwitchProbeResult {
  ok: boolean;
  ms: number;
  chapters?: number;
  wordCount?: string;
  lastChapter?: string;
  name?: string;
  author?: string;
  tocError?: string | null;
  error?: string;
}

/** 换源落点依据：reason 与 matchChapter 的返回值一致，score 是章名相似度。 */
export interface SwitchAlignment {
  reason: string;
  score: number;
  /** 是否把读者换源前所在的那一句存成了跨设备锚点。 */
  anchorSaved: boolean;
}

/** 一组可重贴对象的统计（标注或书签）。 */
export interface SwitchReanchorCount {
  total: number;
  moved: number;
  kept: number;
  failed: number;
}

export type ReanchorFailureReason =
  | "chapter_unmatched"
  | "chapter_limit"
  | "budget"
  | "chapter_fetch"
  | "quote_missing"
  | "quote_ambiguous";

/** 重贴失败的一条明细：阅读页可以逐条展示并手动定位。 */
export interface ReanchorFailure {
  kind: "annotation" | "bookmark";
  id: string | number;
  chapterIndex: number;
  chapterTitle: string;
  quote: string;
  reason: ReanchorFailureReason;
  /** 章节名能可靠对上时，给出新源里的目标章，手动定位可直接去这一章。 */
  targetChapterIndex?: number;
  targetChapterTitle?: string;
}

/** 手动定位时引文在正文里的一处命中。 */
export interface ReanchorCandidate {
  start: number;
  end: number;
  score: number;
  context: string;
}

export interface ReanchorLocateResult {
  ok: boolean;
  kind: "annotation" | "bookmark";
  id: string | number;
  chapterIndex: number;
  chapterTitle: string;
  quote: string;
  targetChapterIndex: number | null;
  targetChapterTitle: string | null;
  candidates: ReanchorCandidate[];
  chapters: Array<{ index: number; title: string }>;
  textLength: number;
}

export interface ReanchorApplyResult {
  ok: boolean;
  kind: "annotation" | "bookmark";
  id: string | number;
  chapterIndex: number;
  chapterTitle: string;
  start: number;
  end: number;
}

/** 换源后的标注/书签重贴结果。failed > 0 时阅读页回执会给「重试」入口。 */
export interface SwitchReanchor {
  annotations: SwitchReanchorCount;
  bookmarks: SwitchReanchorCount;
  /** 为了重贴抓了多少章正文（最多 12 章，避免换源被拖成几分钟）。 */
  chaptersFetched: number;
  /** 超出预算没有处理完，重试可以继续。 */
  partial: boolean;
  ms: number;
  /** 失败明细（最多保留一部分）：用于阅读页「逐条手动定位」。 */
  failures?: ReanchorFailure[];
}

export interface SwitchResult {
  book: BookSummary;
  chapters: number;
  /** 换源前的章数：UI 用它显示「884 → 837 章」。 */
  chaptersBefore?: number;
  /** 换源成功但值得提醒的事（书名不一致、目录少了几章…）。 */
  warnings?: string[];
  /** 换源后可撤销（服务端记录了 switch_history）。 */
  canUndo?: boolean;
  /** 这次换源写入的历史 id；撤销/重贴都以它为准。 */
  historyId?: number;
  historyKind?: SwitchHistoryKind;
  infoError: string | null;
  tocError: string | null;
  source: { id: number; name: string };
  match: SwitchMatch;
  /** 本章在目标目录里的落点依据：名字命中比章号兜底可靠，UI 可以提示「按章号对齐」。 */
  alignment?: SwitchAlignment;
  progress: SwitchProgress | null;
  /** 换源后标注/书签的重贴统计；没有标注书签时各项为 0。 */
  reanchor?: SwitchReanchor;
  ms: number;
  wordCount: string;
}

/** 书源健康度 2.0：四个可观测阶段与各自结果。 */
export type HealthStage = "search" | "detail" | "toc" | "content";
export type HealthStageStatus = "ok" | "empty" | "blocked" | "fail" | "skip";
export type HealthState = "unknown" | "partial" | "healthy" | "degraded" | "blocked" | "broken";

/** 单阶段结果。count 在 search 表示结果数、toc 表示章节数、content 表示正文字符数。 */
export interface StageHealth {
  status: HealthStageStatus;
  at: string;
  ms: number;
  count?: number;
  code?: string;
  message?: string;
  chars?: number;
}

/** 一个书源的完整健康快照，对应 book_sources.health_json。 */
export interface SourceHealth {
  version: 1;
  score: number;
  state: HealthState;
  checks: number;
  ok: number;
  avgMs: number;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastStage: HealthStage | "";
  lastStageError: string;
  lastStageAt: string | null;
  stages: Partial<Record<HealthStage, StageHealth>>;
  failStreak: number;
}

/** 列表接口里的健康摘要：够排序和画四阶段圆点，不返回整个 health_json。 */
export interface SourceHealthSummary {
  healthScore: number;
  healthState: HealthState;
  healthChecks: number;
  healthOk: number;
  avgMs: number;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastStage: HealthStage | "";
  lastStageError: string;
  lastStageAt: string | null;
  stageSummary: Partial<Record<HealthStage, HealthStageStatus>>;
}

/** 内置聚合源的健康卡片：账号状态与书源健康摘要合在一起，设置页/书源页共用。 */
export type BuiltinSourceKind = "shushan" | "dahuilang";

export interface BuiltinSourceCard extends SourceHealthSummary {
  kind: BuiltinSourceKind;
  name: string;
  sourceId: number;
  configured: boolean;
  account: string;
  plan: string;
  server: string;
  enabled: boolean;
}

/** 单源健康详情：最近 20 次体检记录 + 脱敏后的阶段摘要。 */
export interface SourceHealthDetail {
  source: {
    id: number;
    name: string;
    url: string;
    group: string;
    status: string;
    enabled: boolean;
  };
  health: SourceHealth;
  checks: Array<{
    id: number;
    kind: string;
    ok: boolean;
    code: string;
    message: string;
    elapsedMs: number;
    createdAt: string;
  }>;
}

/** 一次体检的完整回执。debug 仅用于当前请求，不写入数据库。 */
export interface SourceProbeReport {
  sourceId: number;
  sourceName: string;
  mode: "quick" | "full";
  elapsedMs: number;
  stages: Partial<Record<HealthStage, StageHealth>>;
  samples: { bookUrl?: string; tocUrl?: string; chapterUrl?: string };
  debug: Array<{ stage: string; url?: string; message?: string; data?: unknown }>;
  health: SourceHealth;
  error?: string;
}

/** 书源静态体检：不联网，导入/启用前就能发现的规则问题。 */
export type SourceAuditSeverity = "error" | "warning" | "info";
export interface SourceAuditIssue {
  code: string;
  severity: SourceAuditSeverity;
  stage: "search" | "explore" | "bookInfo" | "toc" | "content" | "source";
  field: string;
  message: string;
  sample?: string;
}
export interface SourceAuditReport {
  ok: boolean;
  errors: number;
  warnings: number;
  infos: number;
  issues: SourceAuditIssue[];
}

/** 书源解析追踪：把搜索/详情/目录/正文每一阶段的选择器命中和失败原因摊开。 */
export type SourceTraceStage = "search" | "detail" | "toc" | "content";
export type SourceTraceMode = "pipeline" | SourceTraceStage;
export type SourceTraceStatus = "ok" | "empty" | "fail" | "skip";
export type SourceTraceErrorKind =
  | "timeout"
  | "network"
  | "http"
  | "blocked"
  | "login"
  | "vip"
  | "selector_empty"
  | "rule_error"
  | "js_error"
  | "webview"
  | "url"
  | "too_large"
  | "charset"
  | "empty_content"
  | "unknown";
export type SourceTraceRuleKind = "selector" | "json" | "regex" | "js" | "text" | "empty";

export interface SourceTraceField {
  field: string;
  rule: string;
  kind: SourceTraceRuleKind;
  count: number;
  values: string[];
  truncated?: boolean;
  error?: string;
}

export interface SourceTraceRequest {
  url: string;
  finalUrl: string;
  status: number;
  ms: number;
  bytes: number;
  charset: string;
  kind: "html" | "json" | "text";
  headers: Array<{ name: string; value: string }>;
  cookieJar: boolean;
}

export interface SourceTraceItem {
  index: number;
  title: string;
  subtitle?: string;
  url?: string;
  chars?: number;
  badge?: string;
}

export interface SourceTracePage {
  url: string;
  status: number;
  chars: number;
  paragraphs: number;
  ms: number;
  nextUrl?: string;
}

export interface SourceTraceStageResult {
  stage: SourceTraceStage;
  label: string;
  status: SourceTraceStatus;
  ms: number;
  summary: string;
  request?: SourceTraceRequest;
  fields: SourceTraceField[];
  items?: SourceTraceItem[];
  text?: string;
  textTruncated?: boolean;
  pages?: SourceTracePage[];
  error?: string;
  errorKind?: SourceTraceErrorKind;
  hint?: string;
}

export interface SourceParseTrace {
  source: { id: number; name: string; url: string; group: string; status: string };
  mode: SourceTraceMode;
  key: string;
  page: number;
  ms: number;
  stages: SourceTraceStageResult[];
  book?: { name: string; author: string; bookUrl: string; tocUrl: string };
  chapter?: { title: string; url: string; isVip: boolean };
  error?: string;
  errorKind?: SourceTraceErrorKind;
  hint?: string;
}

/** 后台巡检状态（0.58 起支持快照续跑；0.56 先返回扩展字段）。 */
export interface SourceAuditState {
  running: boolean;
  key: string;
  mode: "quick" | "full";
  total: number;
  done: number;
  ok: number;
  failed: number;
  current: string;
  startedAt: number;
  finishedAt: number;
  stopped: boolean;
  cursor: number;
  stages: Record<HealthStage, Record<HealthStageStatus, number>>;
  health: Record<HealthState, number>;
  errors: Array<{ sourceId: number; name: string; error: string }>;
  canResume: boolean;
  interrupted: boolean;
}

export interface Stats {
  total: number;
  /** 当前启用的书源数；旧服务端可能不返回。 */
  enabled?: number;
  /** 已停用的书源数；旧服务端可能不返回。 */
  disabled?: number;
  status: Record<string, number>;
  types: Record<string, number>;
  groups: Array<{ name: string; n: number }>;
  health?: Record<string, number>;
  /** 只统计启用中书源的健康分布，避免停用源的 broken 混进「失效」卡片。 */
  healthEnabled?: Record<string, number>;
  stages?: Record<string, Record<string, number>>;
}
