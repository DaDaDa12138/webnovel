import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { BookSearchHit } from "@legado/shared";
import type { AnnotationRange } from "../lib/annotations";
import { findMatches, hitRanges, normalizeQuery, singleRange, type SearchMatch } from "../lib/reader-search";
import { readSseStream } from "../lib/sse";
import type { LoadedChapter } from "../lib/reader-types";

export type SearchScope = "chapter" | "book";

export interface ReaderSearchOptions {
  bookId: number;
  chapterIndex: Ref<number>;
  chapter: ComputedRef<LoadedChapter | null>;
  /** 跳到某章某处（字符偏移），由阅读页接到 go()。 */
  onLocate: (chapterIndex: number, offset: number) => void;
}

/**
 * 阅读页搜索：本章即时、全书流式。
 *
 * 本章是纯前端（整章正文已经在内存里，边打字边出结果）；全书要联网抓一千章，
 * 所以走 SSE 边扫边推，扫不完可以「继续」。高亮复用划线的字符区间，
 * 命中不需要单独一套定位。
 */
export function useReaderSearch(options: ReaderSearchOptions) {
  const open = ref(false);
  const query = ref("");
  const scope = ref<SearchScope>("chapter");
  const activeMatch = ref(0);
  const bookHits = ref<BookSearchHit[]>([]);
  const pinnedIndex = ref(-1);
  const scanning = ref(false);
  const progress = ref({ done: 0, total: 0 });
  const error = ref("");
  const nextIndex = ref(0);
  const scannedOnce = ref(false);
  const pinned = ref<{ chapterIndex: number; offset: number; length: number } | null>(null);
  let controller: AbortController | null = null;

  const chapterText = computed(() => (options.chapter.value?.paragraphs ?? []).join("\n"));
  const chapterStarts = computed(() => options.chapter.value?.starts ?? []);
  const chapterMatches = computed<SearchMatch[]>(() =>
    scope.value === "chapter" ? findMatches(chapterText.value, chapterStarts.value, query.value) : [],
  );
  const needleLength = computed(() => normalizeQuery(query.value).length);
  const hasQuery = computed(() => needleLength.value > 0);

  /** 全书模式下「继续扫描」的起点；0 表示还没扫过。 */
  const canContinue = computed(() => scannedOnce.value && !scanning.value && nextIndex.value < progress.value.total);

  const hitCount = computed(() => (scope.value === "chapter" ? chapterMatches.value.length : bookHits.value.length));
  const hitPosition = computed(() => {
    if (!hitCount.value) return 0;
    if (scope.value === "chapter") return Math.min(activeMatch.value + 1, hitCount.value);
    return pinnedIndex.value >= 0 ? pinnedIndex.value + 1 : 0;
  });

  function rangesFor(chapterIndex: number): AnnotationRange[] {
    if (scope.value === "chapter" && chapterIndex === options.chapterIndex.value && chapterMatches.value.length) {
      return hitRanges(chapterMatches.value, Math.min(activeMatch.value, chapterMatches.value.length - 1));
    }
    const pin = pinned.value;
    if (pin && pin.chapterIndex === chapterIndex) return singleRange(pin.offset, pin.length);
    return [];
  }

  function openSearch(): void {
    open.value = true;
  }

  function closeSearch(): void {
    open.value = false;
  }

  function clear(): void {
    stop();
    query.value = "";
    scope.value = "chapter";
    activeMatch.value = 0;
    bookHits.value = [];
    pinnedIndex.value = -1;
    pinned.value = null;
    progress.value = { done: 0, total: 0 };
    nextIndex.value = 0;
    scannedOnce.value = false;
    error.value = "";
  }

  function selectChapterMatch(i: number): void {
    const list = chapterMatches.value;
    if (!list.length) return;
    const at = Math.max(0, Math.min(list.length - 1, i));
    activeMatch.value = at;
    options.onLocate(options.chapterIndex.value, list[at].start);
  }

  function selectBookHit(i: number): void {
    const list = bookHits.value;
    if (!list.length) return;
    const at = Math.max(0, Math.min(list.length - 1, i));
    const hit = list[at];
    pinnedIndex.value = at;
    pinned.value = { chapterIndex: hit.chapterIndex, offset: hit.offset, length: Math.max(1, needleLength.value) };
    options.onLocate(hit.chapterIndex, hit.offset);
  }

  /** 上一处 / 下一处：本章循环，全书按章节顺序走。 */
  function step(delta: number): void {
    if (scope.value === "chapter") {
      const count = chapterMatches.value.length;
      if (!count) return;
      selectChapterMatch((activeMatch.value + delta + count) % count);
      return;
    }
    const count = bookHits.value.length;
    if (!count) return;
    const base = pinnedIndex.value < 0 ? (delta > 0 ? -1 : 0) : pinnedIndex.value;
    selectBookHit((base + delta + count) % count);
  }

  function stop(): void {
    controller?.abort();
    controller = null;
    scanning.value = false;
  }

  async function searchBook(from = 0): Promise<void> {
    const q = normalizeQuery(query.value);
    if (!q) return;
    stop();
    const local = new AbortController();
    controller = local;
    if (from === 0) {
      bookHits.value = [];
      pinnedIndex.value = -1;
      pinned.value = null;
    }
    scanning.value = true;
    scannedOnce.value = true;
    error.value = "";
    try {
      const params = new URLSearchParams({ q, from: String(Math.max(0, from)) });
      const res = await fetch(`/api/books/${options.bookId}/search?${params.toString()}`, { signal: local.signal });
      if (!res.ok || !res.body) throw new Error("搜索服务不可用");
      await readSseStream(res.body, (event, data) => {
        if (event === "start") {
          progress.value = { done: 0, total: Number(data?.total) || 0 };
        } else if (event === "hit") {
          const hit = data as BookSearchHit;
          const next = bookHits.value.filter((item) => item.chapterIndex !== hit.chapterIndex);
          next.push(hit);
          next.sort((a, b) => a.chapterIndex - b.chapterIndex);
          bookHits.value = next;
        } else if (event === "progress") {
          progress.value = { done: Number(data?.done) || 0, total: Number(data?.total) || 0 };
        } else if (event === "done") {
          nextIndex.value = Number(data?.nextIndex) || 0;
          progress.value = { done: Number(data?.scanned) || progress.value.done, total: Number(data?.total) || progress.value.total };
        } else if (event === "error") {
          error.value = String(data?.message ?? "搜索失败");
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") error.value = String((err as Error).message ?? err);
    } finally {
      if (controller === local) {
        controller = null;
        scanning.value = false;
      }
    }
  }

  // 换搜索词就重来：旧结果留着只会让人点到上一轮的命中上。
  watch(query, () => {
    activeMatch.value = 0;
    bookHits.value = [];
    pinnedIndex.value = -1;
    pinned.value = null;
    nextIndex.value = 0;
    scannedOnce.value = false;
    progress.value = { done: 0, total: 0 };
    if (scanning.value) stop();
  });

  // 换章：本章命中重算，全书命中保留（它们指向别的章，仍然有效）。
  watch(
    () => options.chapterIndex.value,
    () => {
      activeMatch.value = 0;
      if (pinned.value && pinned.value.chapterIndex !== options.chapterIndex.value) pinned.value = null;
    },
  );

  return {
    open,
    query,
    scope,
    chapterMatches,
    bookHits,
    activeMatch,
    pinnedIndex,
    scanning,
    progress,
    error,
    nextIndex,
    scannedOnce,
    canContinue,
    hitCount,
    hitPosition,
    hasQuery,
    rangesFor,
    openSearch,
    closeSearch,
    clear,
    stop,
    searchBook,
    selectChapterMatch,
    selectBookHit,
    step,
  };
}
