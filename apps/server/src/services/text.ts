import { isJunkImage } from "@legado/engine";
import { getDb } from "../db/index.js";
import { isUnknownAuthor, titleKey } from "./match.js";

/** 用户自定义的替换规则（去广告、去水印），正文每次入库前过一遍。 */
export function applyReplaceRules(text: string): string {
  const db = getDb();
  const rules = db.prepare("SELECT pattern, replacement, is_regex FROM replace_rules WHERE enabled = 1 ORDER BY id ASC").all() as Array<{
    pattern: string;
    replacement: string;
    is_regex: number;
  }>;
  let out = text;
  for (const rule of rules) {
    if (!rule.pattern) continue;
    if (rule.is_regex) {
      try {
        out = out.replace(new RegExp(rule.pattern, "g"), rule.replacement);
      } catch {
        /* ignore invalid regex */
      }
    } else {
      out = out.split(rule.pattern).join(rule.replacement);
    }
  }
  return out;
}

export function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const text = (value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/** 有的源「字数」字段只返回「字」「字数」或「0字」，没有数字就当没有，别写进书。 */
export function cleanWordCount(value: string | undefined): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return /\d/.test(text) ? text.slice(0, 40) : "";
}

export function cleanCover(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const value = (candidate ?? "").trim();
    if (value && !isJunkImage(value)) return value;
  }
  return "";
}

const CATEGORY_WORDS = /^(玄幻|仙侠|都市|历史|科幻|网游|言情|奇幻|武侠|轻小说|其他|连载中|已完结)$/;

/** 聚合站的 author 规则经常抓到分类词（玄幻/仙侠…）、书名本身或「佚名」，
 *  换源后不能让它把用户原来的作者覆盖掉。 */
export function isDirtyAuthor(author: string, bookName: string): boolean {
  const value = String(author ?? "").trim();
  return !value || isUnknownAuthor(value) || titleKey(value) === titleKey(bookName) || CATEGORY_WORDS.test(value);
}
