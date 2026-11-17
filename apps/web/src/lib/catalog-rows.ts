/** 目录行模型：把「卷 → 章」的扁平章节列表折成可收起的行。
 *
 * 书源目录里卷名就是一行普通章节（`isVolume: true`），长书动辄十几卷上千章，
 * 全部铺开找起来很累。这里只做「按卷折叠」，不改变章节号——行里带的 index 始终是
 * 真实章节下标，跳转、进度、页码都不受影响。
 */

export interface CatalogSource {
  index: number;
  title: string;
  isVolume?: boolean;
}

export type CatalogRow =
  | { kind: "volume"; index: number; title: string; count: number; collapsed: boolean }
  | { kind: "chapter"; index: number; title: string };

export function hasVolumes(items: CatalogSource[]): boolean {
  return items.some((item) => item.isVolume === true);
}

/** 卷 index → 该卷下的章节数（到下一个卷为止；末尾的卷算到结尾）。 */
export function volumeCounts(items: CatalogSource[]): Map<number, number> {
  const counts = new Map<number, number>();
  let current: number | null = null;
  for (const item of items) {
    if (item.isVolume) {
      current = item.index;
      counts.set(current, 0);
    } else if (current !== null) {
      counts.set(current, (counts.get(current) ?? 0) + 1);
    }
  }
  return counts;
}

/** 某章属于哪个卷；第一个卷之前的章节返回 null。 */
export function volumeOf(items: CatalogSource[], index: number): number | null {
  let current: number | null = null;
  for (const item of items) {
    if (item.isVolume) current = item.index;
    if (item.index === index) return current;
    if (item.index > index) break;
  }
  return null;
}

/** 折叠状态只影响「显示」，章节下标不变。 */
export function buildCatalogRows(items: CatalogSource[], collapsed: Iterable<number> = []): CatalogRow[] {
  const hidden = new Set(collapsed);
  const counts = volumeCounts(items);
  const rows: CatalogRow[] = [];
  let open = true;
  for (const item of items) {
    if (item.isVolume) {
      const closed = hidden.has(item.index);
      rows.push({ kind: "volume", index: item.index, title: item.title, count: counts.get(item.index) ?? 0, collapsed: closed });
      open = !closed;
      continue;
    }
    if (open) rows.push({ kind: "chapter", index: item.index, title: item.title });
  }
  return rows;
}

/** 目录筛选：全部 / 未读 / 已读。卷行只在它还有可见章节时保留。 */
export type CatalogFilter = "all" | "unread" | "read";

export function filterCatalog(items: CatalogSource[], read: ReadonlySet<number>, filter: CatalogFilter): CatalogSource[] {
  if (filter === "all") return items;
  const kept = items.filter((item) => item.isVolume || (filter === "read" ? read.has(item.index) : !read.has(item.index)));
  const counts = volumeCounts(kept);
  return kept.filter((item) => !item.isVolume || (counts.get(item.index) ?? 0) > 0);
}
