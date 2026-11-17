/** 导入字体文件的纯函数部分：格式、大小、稳定的 CSS family 名。 */

export const MAX_FONT_BYTES = 20 * 1024 * 1024;
export const FONT_FAMILY_PREFIX = "LegadoFont-";

export type FontFormat = "truetype" | "opentype" | "woff" | "woff2" | "";

export interface FontFileInfo {
  name: string;
  size: number;
}

export interface FontCheck {
  ok: boolean;
  message: string;
  format: FontFormat;
}

/** 扩展名决定 FontFace 的 format；浏览器其实能嗅探，但先拦下来能给出人话错误。 */
export function fontFormat(name: string): FontFormat {
  const ext = String(name).toLowerCase().split(".").pop() ?? "";
  if (ext === "ttf") return "truetype";
  if (ext === "otf") return "opentype";
  if (ext === "woff") return "woff";
  if (ext === "woff2") return "woff2";
  return "";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return Math.round(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function checkFontFile(file: FontFileInfo): FontCheck {
  const format = fontFormat(file.name);
  if (!format) {
    return { ok: false, format, message: "只支持 .ttf / .otf / .woff / .woff2 字体文件" };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, format, message: "这个文件是空的" };
  }
  if (file.size > MAX_FONT_BYTES) {
    return { ok: false, format, message: "字体文件太大（" + formatBytes(file.size) + "），最大 " + formatBytes(MAX_FONT_BYTES) };
  }
  return { ok: true, format, message: "" };
}

/** djb2：只用来生成稳定、CSS 安全的 family 名，不承担加密职责。 */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(-8);
}

/**
 * 同一个文件（文件名 + 字节数）永远得到同一个 family，重复导入只会覆盖旧记录，
 * 不会在设置里堆出一串「霞鹜文楷 1/2/3」。
 */
export function fontFamilyFor(name: string, size: number): string {
  return FONT_FAMILY_PREFIX + hash(name + ":" + size);
}
