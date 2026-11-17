/** Route remote covers through the server proxy (adds Referer, caches, dodges hotlink blocks). */
export function imgUrl(url?: string | null, sourceId?: number): string {
  const value = (url ?? "").trim();
  if (!value) return "";
  // 本地导入 EPUB 的封面是 /api/local-images/...，已经由本站提供，不能再套一层代理。
  if (value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("/api/")) return value;
  const params = new URLSearchParams({ u: value });
  if (sourceId) params.set("s", String(sourceId));
  return `/api/img?${params.toString()}`;
}

const JUNK_COVER = /(?:^|\/)(?:baidu|logo|default|placeholder|noimage|nopic|none|blank|spacer|header-back|header_back|cover_default|cover-default)[^/]*\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)/i;

/** Path fragments that usually mean "this really is a cover". */
const COVER_HINT = /(cover|book|img|image|pic|photo|file|upload|thumb|poster)/i;

/**
 * Many sources return a site logo, a 1px placeholder or a site banner instead of a cover.
 * 站点根目录下、文件名既没有数字也没有 cover 字样（例如肉肉屋的 /rourouwu.png 横幅）基本是广告图。
 */
export function isJunkCover(url?: string | null): boolean {
  const value = (url ?? "").trim();
  if (!value) return true;
  const lower = value.toLowerCase();
  if (JUNK_COVER.test(lower)) return true;
  // 规则拼接失败的产物：pic.site.com/NaN/undefined/undefineds.jpg
  if (/(?:^|\/)(?:nan|undefined|null)(?:\/|\.|$)/i.test(lower)) return true;
  try {
    const parsed = new URL(value.startsWith("//") ? "https:" + value : value);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const name = parts[parts.length - 1] ?? "";
    const dirs = parts.slice(0, -1);
    if (!/\d/.test(name) && dirs.length <= 1 && !COVER_HINT.test(name) && !COVER_HINT.test(dirs.join("/"))) {
      return true;
    }
  } catch {
    /* 解析失败就当作可用，交给 <img> 的 @error 兜底 */
  }
  return false;
}

/** First meaningful character of a title, skipping decoration such as 「[《（. */
export function coverInitial(name?: string | null): string {
  const cleaned = (name ?? "").replace(/^[\s\[\]【】（）()「」『』《》<>"'·.,，。:：\-—_]+/u, "").trim();
  const chars = Array.from(cleaned);
  return chars.length ? chars[0].toUpperCase() : "书";
}
