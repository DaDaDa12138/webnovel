/**
 * Curated replacement rules for the messiest part of Chinese web novels: site
 * promos, mirrored URLs, HTML leftovers and whitespace. Users can add one or all
 * of them from the replace page; patterns are deduplicated by exact text so
 * repeated clicks are harmless.
 */
export interface ReplacePreset {
  key: string;
  name: string;
  description: string;
  pattern: string;
  replacement: string;
  scope: "content" | "all";
}

export const REPLACE_PRESETS: ReplacePreset[] = [
  {
    key: "strip-url",
    name: "去除网址广告",
    description: "删除正文里的 http(s) 链接和 www 域名，正文中的普通网址也会被删掉。",
    pattern: String.raw`(?:https?:\/\/|www\.)[\w\-./?%&=:#@]+`,
    replacement: "",
    scope: "content",
  },
  {
    key: "strip-site-promo",
    name: "去除站点推广语",
    description: "清理“请记住本站”“最新章节”“笔趣阁”等常见推广短语及其后 20 个字。",
    pattern: String.raw`(?:请记住本站|记住本站|本站域名|最新网址|首发网址|永久网址|无弹窗|全文阅读|更新最快|笔趣阁|顶点小说|手机用户请|加入书签|投推荐票|求收藏|求月票)[^\n。！？]{0,20}`,
    replacement: "",
    scope: "content",
  },
  {
    key: "strip-bracket-ad",
    name: "去除括号广告",
    description: "删除包含网址、域名或“最新章节”的整段括号内容。",
    pattern: String.raw`[（(【\[][^）)】\]]{0,40}(?:www\.|https?:|笔趣阁|最新章节|广告|域名|网址)[^）)】\]]{0,40}[）)】\]]`,
    replacement: "",
    scope: "content",
  },
  {
    key: "strip-html",
    name: "去除 HTML 残留",
    description: "删除正文中漏出的 <div>、<br>、<span> 等标签。",
    pattern: String.raw`<\/?[a-zA-Z][^>]{0,80}>`,
    replacement: "",
    scope: "content",
  },
  {
    key: "collapse-blank",
    name: "合并多余空行",
    description: "把连续 3 个以上换行压缩成一个空行，阅读更紧凑。",
    pattern: String.raw`\n{3,}`,
    replacement: "\n\n",
    scope: "content",
  },
  {
    key: "trim-line-tail",
    name: "去除行尾空白",
    description: "删除每行末尾的空格、制表符和全角空格。",
    pattern: String.raw`[ \t\u3000]+\n`,
    replacement: "\n",
    scope: "content",
  },
  {
    key: "dedupe-punctuation",
    name: "合并重复标点",
    description: "把“！！！”、“。。。”这类连续标点压缩成一个。",
    pattern: String.raw`([。！？!?])\1{1,}`,
    replacement: "$1",
    scope: "content",
  },
  {
    key: "strip-zero-width",
    name: "去除零宽字符",
    description: "清理从网页复制时混入的零宽空格、BOM 等不可见字符。",
    pattern: String.raw`[\u200b-\u200f\ufeff]`,
    replacement: "",
    scope: "content",
  },
];
