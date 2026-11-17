/** 换源试读开头的截取规则：只做展示，不改变正文本身。 */

export const SWITCH_PREVIEW_LIMIT = 600;

/**
 * 从实测章节正文里截一段「试读开头」。
 *
 * 保留段落换行（换源面板里按 pre-wrap 展示，读者能看出排版和对话），
 * 去掉控制字符与多余空白；截断按字符数，不做省略号——面板会自己标「前 N 字」。
 */
export function previewFromText(text: string, limit = SWITCH_PREVIEW_LIMIT): string {
  const max = Math.max(1, Math.round(limit));
  const cleaned = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    // 保留换行和制表符，其余 C0 控制字符清掉（正文里偶尔混进 \u0000）。
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.slice(0, max);
}
