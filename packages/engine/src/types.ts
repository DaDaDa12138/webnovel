export interface RuleSet {
  [field: string]: string | undefined;
}

export interface BookSource {
  bookSourceName: string;
  bookSourceUrl: string;
  bookSourceGroup?: string;
  bookSourceType?: number;
  bookSourceComment?: string;
  enabled?: boolean;
  enabledExplore?: boolean;
  enabledCookieJar?: boolean;
  customOrder?: number;
  header?: string;
  loginUrl?: string;
  bookUrlPattern?: string;
  searchUrl?: string;
  exploreUrl?: string;
  ruleSearch?: RuleSet;
  ruleExplore?: RuleSet;
  ruleBookInfo?: RuleSet;
  ruleToc?: RuleSet;
  ruleContent?: RuleSet;
  [key: string]: unknown;
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
  sourceId?: number;
}

export interface BookInfo extends SearchBook {
  tocUrl: string;
}

export interface Chapter {
  title: string;
  url: string;
  isVip: boolean;
  isVolume: boolean;
}

export interface ExploreGroup {
  title: string;
  url: string;
  /** 分组所属的段落（书山聚合的 /type_api 会按「排行榜」「分类」分段）。 */
  section?: string;
}

export interface ExploreResult {
  group: string;
  items: SearchBook[];
}

export type RuleContextKind = "html" | "json" | "text";

export interface RuleContext {
  kind: RuleContextKind;
  html: string;
  json: unknown;
  text: string;
  url: string;
  baseUrl: string;
  vars: Record<string, string>;
  book?: Partial<BookInfo>;
  chapter?: Partial<Chapter>;
  source?: BookSource;
  docHtml?: string;
  index?: number;
  /** 上一条规则产出的元素（jsoup Elements 语义），供紧跟的 `<js>` / `@js:` 段当 result 用。 */
  jsResult?: unknown;
}

export interface FetchResult {
  url: string;
  status: number;
  body: string;
  headers: Record<string, string>;
  /** 实际用来解码正文的字符集（便于排查乱码；响应头声明的编码不一定可信）。 */
  charset?: string;
}
