/** Mirrors the server's title comparison so the 换源 list hides unrelated books. */
export function titleKey(name: string): string {
  return String(name ?? "")
    .replace(/[\[\]【】()（）《》「」『』]/g, "")
    .replace(/[\s:：·・,，。.!！?？\-—_/\\]+/g, "")
    .toLowerCase();
}

export function titlesMatch(a: string, b: string): boolean {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.startsWith(short);
}
