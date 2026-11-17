import { JSONPath } from "jsonpath-plus";

export function queryJson(path: string, json: unknown): string[] {
  const expr = path.trim().startsWith("$") ? path.trim() : `$.${path.trim()}`;
  let values: unknown[];
  try {
    values = JSONPath({ path: expr, json: json as object, wrap: true }) as unknown[];
  } catch {
    return [];
  }
  // jsonpath-plus 在 json 为 null/undefined 时会返回 undefined（而不是抛错），
  // 以前这里直接 .map 会抛 "Cannot read properties of undefined (reading 'map')"，
  // 让整条详情/目录规则失败。
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    })
    .filter((v) => v.length > 0);
}

export function queryJsonRaw(path: string, json: unknown): unknown[] {
  const expr = path.trim().startsWith("$") ? path.trim() : `$.${path.trim()}`;
  try {
    const out = JSONPath({ path: expr, json: json as object, wrap: true }) as unknown;
    if (Array.isArray(out)) return out;
    return out === undefined || out === null ? [] : [out];
  } catch {
    return [];
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
