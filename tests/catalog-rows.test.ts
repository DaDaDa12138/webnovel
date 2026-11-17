import { describe, expect, it } from "vitest";
import { buildCatalogRows, filterCatalog, hasVolumes, volumeCounts, volumeOf, type CatalogSource } from "../apps/web/src/lib/catalog-rows";

const items: CatalogSource[] = [
  { index: 0, title: "第一章" },
  { index: 1, title: "第一章 上" },
  { index: 2, title: "第一卷 起风了", isVolume: true },
  { index: 3, title: "第二章" },
  { index: 4, title: "第三章" },
  { index: 5, title: "第二卷 落雨", isVolume: true },
  { index: 6, title: "第四章" },
];

describe("catalog rows", () => {
  it("detects volumes", () => {
    expect(hasVolumes(items)).toBe(true);
    expect(hasVolumes([{ index: 0, title: "第一章" }])).toBe(false);
  });

  it("counts chapters per volume", () => {
    const counts = volumeCounts(items);
    expect(counts.get(2)).toBe(2);
    expect(counts.get(5)).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("maps a chapter to its volume", () => {
    expect(volumeOf(items, 0)).toBe(null);
    expect(volumeOf(items, 2)).toBe(2);
    expect(volumeOf(items, 4)).toBe(2);
    expect(volumeOf(items, 6)).toBe(5);
  });

  it("hides chapters of a collapsed volume but keeps numbering", () => {
    const rows = buildCatalogRows(items, [2]);
    expect(rows.map((row) => row.kind + ":" + row.index)).toEqual([
      "chapter:0",
      "chapter:1",
      "volume:2",
      "volume:5",
      "chapter:6",
    ]);
    const volume = rows.find((row) => row.kind === "volume" && row.index === 2);
    expect(volume).toMatchObject({ count: 2, collapsed: true });
  });

  it("shows everything when nothing is collapsed", () => {
    expect(buildCatalogRows(items, [])).toHaveLength(items.length);
  });

  it("keeps chapters before the first volume visible", () => {
    const rows = buildCatalogRows(items, [5]);
    expect(rows.some((row) => row.kind === "chapter" && row.index === 0)).toBe(true);
    expect(rows.some((row) => row.kind === "chapter" && row.index === 4)).toBe(true);
  });
});

describe("filterCatalog", () => {
  const items = [
    { index: 0, title: "第1章" },
    { index: 1, title: "第2章" },
    { index: 2, title: "第1卷", isVolume: true },
    { index: 3, title: "第3章" },
    { index: 4, title: "第4章" },
  ];

  it("keeps everything for all", () => {
    expect(filterCatalog(items, new Set(), "all")).toHaveLength(5);
  });

  it("hides read chapters and drops a fully read volume", () => {
    const read = new Set([0, 1]);
    const out = filterCatalog(items, read, "unread");
    expect(out.map((item) => item.index)).toEqual([2, 3, 4]);
  });

  it("keeps only read chapters and the volumes that still have some", () => {
    const read = new Set([0, 3]);
    const out = filterCatalog(items, read, "read");
    expect(out.map((item) => item.index)).toEqual([0, 2, 3]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterCatalog(items, new Set([0, 1, 3, 4]), "unread")).toEqual([]);
  });
});
