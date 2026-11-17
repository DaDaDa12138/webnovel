const DECORATION = /[♤#]/;

export interface UrlParts {
  clean: string;
  suffix: string;
}

export function stripDecoration(url: string): UrlParts {
  const raw = String(url ?? "").trim();
  const idx = raw.search(DECORATION);
  if (idx < 0) return { clean: raw, suffix: "" };
  return { clean: raw.slice(0, idx).trim(), suffix: raw.slice(idx) };
}

/**
 * Stable identity for a book source: protocol-agnostic host + path, decoration removed.
 * Non-http pseudo urls keep a "pseudo:" prefix so they stay unique.
 */
export function hostKey(url: string): string {
  const { clean } = stripDecoration(url);
  const m = /^(https?:\/\/[A-Za-z0-9.\-]+(?::\d+)?)(\/[^\s?#]*)?/i.exec(clean);
  if (!m) return `pseudo:${clean.toLowerCase()}`;
  const host = m[1]
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  let path = (m[2] ?? "").replace(/\/+$/, "");
  if (/^\/search$/i.test(path)) path = "";
  return host + path;
}

/** Identity used for de-duplication. Pseudo urls have no host, so the name disambiguates them. */
export function sourceKey(url: string, name = ""): string {
  const key = hostKey(url);
  if (!key.startsWith("pseudo:")) return key;
  return `${key}|${name.trim().toLowerCase()}`;
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(stripDecoration(url).clean);
}
