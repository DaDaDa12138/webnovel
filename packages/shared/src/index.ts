export interface BookSourceJson {
  bookSourceName: string;
  bookSourceUrl: string;
  bookSourceGroup?: string;
  bookSourceType?: number;
  bookSourceComment?: string;
  enabled?: boolean;
  enabledExplore?: boolean;
  customOrder?: number;
  searchUrl?: string;
  exploreUrl?: string;
  header?: string;
  loginUrl?: string;
  bookUrlPattern?: string;
  ruleSearch?: Record<string, string>;
  ruleExplore?: Record<string, string>;
  ruleBookInfo?: Record<string, string>;
  ruleToc?: Record<string, string>;
  ruleContent?: Record<string, string>;
  [key: string]: unknown;
}

export interface SourceListItem {
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
}

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export * from "./api.js";
export * from "./health-rank.js";
