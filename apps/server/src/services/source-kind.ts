/**
 * 书源类型判定。
 *
 * Legado 生态里的订阅是混装的：一份书源列表里既有小说站，也有漫画站、影视站。
 * 漫画/影视源在「书籍搜索」里只会制造噪音——书名一样、作者写着「主演：内详」、
 * 最新章节是「更新至第13集」，而且它们的正文规则拿的是图片页/播放页，加进书架
 * 也读不了。这里按分组、站名、域名做一次粗分类，书籍搜索默认跳过它们。
 */

const MEDIA_WORDS = /动漫|動漫|漫画|漫畫|动画|動畫|番剧|影视|影院|视频|电影|电视剧|综艺|短剧|剧集|追剧|韩漫/;
const MEDIA_HOST = /(?:comic|manhua|manga|dongman|acg|cartoon)/i;

export interface SourceIdentity {
  name?: string;
  group?: string;
  url?: string;
}

export function isMediaSource(input: SourceIdentity): boolean {
  const name = String(input.name ?? "");
  const group = String(input.group ?? "");
  if (MEDIA_WORDS.test(name) || MEDIA_WORDS.test(group)) return true;
  const url = String(input.url ?? "").trim();
  if (!url) return false;
  try {
    return MEDIA_HOST.test(new URL(url).hostname);
  } catch {
    return MEDIA_HOST.test(url);
  }
}

const MEDIA_KIND = /^(动漫|動漫|漫画|漫畫|动画|動畫|番剧|剧集|电视剧|电影|影视|综艺|短剧)$/;
const MEDIA_CHAPTER = /更新至\s*第?\s*\d+\s*集|全\s*\d+\s*集\s*(?:完结|全集)?$|HD中字|BD高清/;

/** 单条搜索结果是否明显是漫画/影视条目（书源分组没标注时的兜底）。 */
export function looksLikeMediaBook(book: { kind?: string; lastChapter?: string }): boolean {
  const kind = String(book.kind ?? "").trim();
  if (MEDIA_KIND.test(kind)) return true;
  return MEDIA_CHAPTER.test(String(book.lastChapter ?? ""));
}
