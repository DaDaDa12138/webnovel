import { SETTINGS_TABS, type SettingsTabId } from "./reader-settings-tabs";

/**
 * 设置搜索不复制一套控件，只维护「关键词 → 面板里的锚点」。
 * 这样滑杆、开关、条件项永远只有一份实现，搜索结果也不会和真实状态脱节。
 */
export interface SettingSearchEntry {
  key: string;
  /** 面板里 data-setting 的值；条件项指向它的开关，避免搜到不存在的节点。 */
  target: string;
  tab: SettingsTabId;
  label: string;
  hint: string;
  keywords: string[];
}

const TAB_LABEL = new Map(SETTINGS_TABS.map((item) => [item.id, item.label]));

export const SETTING_SEARCH_ENTRIES: SettingSearchEntry[] = [
  { key: "theme", target: "theme", tab: "display", label: "主题", hint: "纸白、米黄、护眼、夜间等", keywords: ["theme", "配色", "颜色", "夜间模式", "深色", "护眼", "纸白", "米黄", "淡粉"] },
  { key: "background", target: "background", tab: "display", label: "背景颜色", hint: "自定义正文底色", keywords: ["background", "底色", "背景色", "自定义颜色"] },
  { key: "brightness", target: "brightness", tab: "display", label: "亮度", hint: "0–100", keywords: ["brightness", "屏幕亮度", "变暗", "调亮"] },
  { key: "warmth", target: "warmth", tab: "display", label: "色温", hint: "0–100", keywords: ["warmth", "暖色", "护眼色温", "偏黄"] },
  { key: "follow-system", target: "follow-system", tab: "display", label: "跟随系统深色", hint: "随系统切换夜间主题", keywords: ["dark mode", "系统", "深色模式", "自动夜间"] },
  { key: "readout", target: "readout", tab: "display", label: "页角读数", hint: "四角显示章节、进度或时间", keywords: ["readout", "页脚", "角落", "进度", "剩余", "时间"] },
  { key: "readout-always", target: "readout-always", tab: "display", label: "常显读数", hint: "工具栏打开时也显示", keywords: ["readout always", "页角", "常驻"] },
  { key: "reset-all", target: "reset-all", tab: "display", label: "恢复全部设置", hint: "重置主题、翻页、朗读和热区", keywords: ["reset", "重置", "恢复默认", "还原"] },
  { key: "sheet-size", target: "sheet-size", tab: "display", label: "半屏设置", hint: "缩小面板，边看正文边调", keywords: ["sheet", "面板", "高度", "面板高度", "半屏", "拖动", "看正文", "展开"] },

  { key: "presets", target: "presets", tab: "type", label: "排版模板", hint: "舒适、紧凑、大字一键切换", keywords: ["preset", "模板", "预设", "舒适", "紧凑", "大字", "一键排版"] },
  { key: "font", target: "font", tab: "type", label: "字体", hint: "系统、宋体、楷体或导入字体", keywords: ["font", "字体文件", "导入字体", "宋体", "楷体", "霞鹜文楷"] },
  { key: "font-size", target: "font-size", tab: "type", label: "字号", hint: "12–36 px", keywords: ["font size", "字体大小", "字大", "字小", "放大", "缩小"] },
  { key: "font-weight", target: "font-weight", tab: "type", label: "字重", hint: "常规、中等或加粗", keywords: ["font weight", "粗细", "加粗", "字重", "笔画"] },
  { key: "line-height", target: "line-height", tab: "type", label: "行距", hint: "1.4–2.6 倍", keywords: ["line height", "行高", "行间距", "松紧"] },
  { key: "para-spacing", target: "para-spacing", tab: "type", label: "段距", hint: "0–1.6 em", keywords: ["paragraph spacing", "段落间距", "段间距", "段间"] },
  { key: "letter-spacing", target: "letter-spacing", tab: "type", label: "字间距", hint: "0–0.2 em", keywords: ["letter spacing", "字距", "字间", "稀疏"] },
  { key: "page-width", target: "page-width", tab: "type", label: "页宽", hint: "640 / 720 / 820 / 1000", keywords: ["page width", "宽度", "版心", "行长"] },
  { key: "page-margin", target: "page-margin", tab: "type", label: "左右边距", hint: "8–48 px", keywords: ["margin", "页边距", "留白", "边距"] },
  { key: "page-padding-y", target: "page-padding-y", tab: "type", label: "上下留白", hint: "0–48 px", keywords: ["padding", "上下留白", "顶部留白", "底部留白", "呼吸感"] },
  { key: "indent", target: "indent", tab: "type", label: "首行缩进", hint: "段首空两字", keywords: ["indent", "缩进", "空两格"] },
  { key: "justify", target: "justify", tab: "type", label: "两端对齐", hint: "左右边缘对齐", keywords: ["justify", "对齐", "排版"] },
  { key: "paragraph", target: "paragraph", tab: "type", label: "智能分段", hint: "合硬换行、长段细分、对话独立", keywords: ["paragraph", "分段", "断句", "硬换行", "长段", "对话", "章标题", "细分"] },
  { key: "special", target: "special", tab: "type", label: "特殊段落样式", hint: "诗歌、书信、短信、系统提示、分节线", keywords: ["special", "特殊段落", "诗歌", "诗词", "书信", "信件", "短信", "微信", "系统提示", "分节线", "分隔线"] },
  { key: "author-note", target: "author-note", tab: "type", label: "作者话", hint: "章首章末的更新说明、请假条", keywords: ["author note", "作者的话", "作者有话说", "更新说明", "请假", "公告"] },
  { key: "subhead", target: "subhead", tab: "type", label: "小标题", hint: "长段之间的短行标题", keywords: ["subhead", "小标题", "短标题", "分节标题"] },
  { key: "dialog-indent", target: "dialog-indent", tab: "type", label: "对话悬挂缩进", hint: "引号对话不缩首行", keywords: ["dialog", "对话", "引号", "悬挂缩进", "对白"] },

  { key: "mode", target: "mode", tab: "turn", label: "翻页模式", hint: "滚动或左右翻页", keywords: ["mode", "滚动", "翻页", "阅读模式"] },
  { key: "page-animation", target: "mode", tab: "turn", label: "翻页动画", hint: "滑动、淡入或无", keywords: ["animation", "动画", "淡入", "滑动"] },
  { key: "spread", target: "mode", tab: "turn", label: "双页排版", hint: "宽屏并排两页", keywords: ["spread", "双栏", "双页", "宽屏"] },
  { key: "desktop-catalog", target: "desktop-catalog", tab: "turn", label: "常驻目录", hint: "宽屏左侧固定章节目录", keywords: ["catalog", "目录", "侧栏", "章节目录"] },
  { key: "edge-adjust", target: "edge-adjust", tab: "turn", label: "左右边缘上下滑", hint: "亮度 / 字号手势", keywords: ["edge", "手势", "边缘", "亮度", "字号"] },
  { key: "swipe-turn", target: "swipe-turn", tab: "turn", label: "左右滑动翻页", hint: "横向滑动切页", keywords: ["swipe", "滑动", "手势翻页"] },
  { key: "tap-grid", target: "tap-grid", tab: "turn", label: "点击热区", hint: "九宫格自定义单击动作", keywords: ["tap", "点击", "热区", "九宫格", "手势"] },
  { key: "auto-hide", target: "auto-hide", tab: "turn", label: "点击中间隐藏工具栏", hint: "沉浸阅读", keywords: ["auto hide", "工具栏", "隐藏", "沉浸"] },
  { key: "auto-scroll", target: "auto-scroll", tab: "turn", label: "自动阅读", hint: "滚动模式自动推进", keywords: ["auto scroll", "自动滚动", "自动翻页", "托管"] },
  { key: "keep-awake", target: "keep-awake", tab: "turn", label: "阅读时屏幕常亮", hint: "自动翻页与朗读时始终开启", keywords: ["wake lock", "常亮", "息屏", "锁屏"] },
  { key: "auto-speed", target: "auto-scroll", tab: "turn", label: "自动阅读速度", hint: "20–160 px/s", keywords: ["speed", "速度", "快慢", "自动翻页间隔"] },
  { key: "sleep", target: "sleep", tab: "turn", label: "睡眠定时", hint: "到点停止朗读与自动阅读", keywords: ["sleep", "定时", "倒计时", "助眠"] },

  { key: "tts-engine", target: "tts-engine", tab: "speech", label: "朗读引擎", hint: "自动、浏览器或服务端", keywords: ["tts", "朗读", "语音", "引擎", "浏览器语音"] },
  { key: "tts-voice", target: "tts-engine", tab: "speech", label: "音色", hint: "选择朗读声音", keywords: ["voice", "声音", "音色", "男声", "女声"] },
  { key: "tts-rate", target: "tts-rate", tab: "speech", label: "朗读语速", hint: "0.6–1.8 倍", keywords: ["rate", "语速", "快慢", "朗读速度"] },
];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * 多关键词用空格分隔，必须全部命中；中文没有词边界，所以用子串匹配。
 * 精确标题 > 标题开头 > 关键词精确 > 任意字段命中。
 */
export function searchSettings(query: string, limit = 8): SettingSearchEntry[] {
  const text = normalize(query);
  if (!text) return [];
  const tokens = text.split(/\s+/).filter(Boolean);
  const compact = tokens.join("");
  const scored: Array<{ entry: SettingSearchEntry; score: number; order: number }> = [];

  SETTING_SEARCH_ENTRIES.forEach((entry, order) => {
    const label = normalize(entry.label);
    const tabLabel = normalize(TAB_LABEL.get(entry.tab) ?? "");
    const haystack = [label, normalize(entry.hint), ...entry.keywords.map(normalize), tabLabel].join(" ");
    if (!tokens.every((token) => haystack.includes(token))) return;

    let score = 40;
    if (label === compact) score = 100;
    else if (label.startsWith(compact)) score = 85;
    else if (label.includes(compact)) score = 75;
    else if (entry.keywords.some((keyword) => normalize(keyword) === compact)) score = 70;
    else if (haystack.includes(compact)) score = 60;
    scored.push({ entry, score, order });
  });

  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(1, limit))
    .map((item) => item.entry);
}

export function settingTabLabel(tab: SettingsTabId): string {
  return TAB_LABEL.get(tab) ?? tab;
}
