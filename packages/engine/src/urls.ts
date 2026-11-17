/**
 * 搜索规则经常产出「看起来是地址、其实打不开」的 bookUrl：模板没渲染完
 * （{{…}} 残留）、JS 求值失败（bookid=NaN）、参数为空（resourceId=）、
 * 甚至干脆是分类列表页。这类候选点进去必然「换源失败」，应在搜索出口就丢掉。
 */

const EMPTY_QUERY_VALUE = /[?&][^=&#]+=(?:&|#|$)/;
const BAD_VALUE = /(?:^|[?&=])(?:NaN|undefined|null)(?:&|#|$)/;
/** 登录/注册/帮助页也不是书籍详情页。 */
const BAD_PAGE_VALUE = /(?:^|[?&=])(?:login|logout|register|signup|signin)(?:&|#|$|=)/i;
const LIST_PAGE = /\/(?:category|search|soushu|rank|toplist|sort|booklist|list)(?:\.php|\.html|\/|$)/i;

function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** 这个地址能不能当作书籍详情页去抓。 */
export function isUsableBookUrl(url: string): boolean {
  const text = String(url ?? "").trim();
  if (!text) return false;
  if (!/^https?:\/\//i.test(text)) return false;
  const decoded = safeDecode(text);
  if (decoded.includes("{{") || decoded.includes("}}")) return false;
  if (EMPTY_QUERY_VALUE.test(text)) return false;
  if (BAD_VALUE.test(decoded)) return false;
  if (BAD_PAGE_VALUE.test(decoded)) return false;
  let pathname = "";
  try {
    pathname = new URL(text).pathname;
  } catch {
    return false;
  }
  // 分类/搜索/榜单页没有数字 id，基本可以断定规则取错了元素。
  if (LIST_PAGE.test(pathname) && !/\d/.test(pathname)) return false;
  return true;
}

/** 用于给用户看的失败原因（不暴露内部细节）。 */
export function bookUrlProblem(url: string): string {
  const text = String(url ?? "").trim();
  if (!text) return "地址为空";
  if (!/^https?:\/\//i.test(text)) return "地址不是 http(s)";
  const decoded = safeDecode(text);
  if (decoded.includes("{{") || decoded.includes("}}")) return "地址里的规则没渲染完";
  if (EMPTY_QUERY_VALUE.test(text)) return "地址缺少关键参数";
  if (BAD_VALUE.test(decoded)) return "地址参数是 NaN";
  if (BAD_PAGE_VALUE.test(decoded)) return "地址是登录/注册页";
  return "地址指向列表页而不是书籍页";
}
