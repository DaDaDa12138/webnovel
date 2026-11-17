import { describe, expect, it } from "vitest";
import type { SyncOp } from "@legado/shared";
import {
  EMPTY_QUEUE,
  MAX_OPS,
  ack,
  batchOf,
  canFlush,
  enqueue,
  isNetworkError,
  markFailure,
  newOpId,
  opKey,
  parseQueue,
  pendingCount,
  retryDelay,
} from "../apps/web/src/lib/sync-queue";

function progress(bookId: number, chapterIndex: number, at = 1): SyncOp {
  return {
    id: newOpId("progress", at),
    kind: "progress",
    bookId,
    at,
    chapterIndex,
    charOffset: 100,
    chapterPercent: 0.2,
    percent: 3.1,
  };
}

function bookmarkAdd(bookId: number, chapterIndex: number, charOffset: number, at = 1): SyncOp {
  return { id: newOpId("bookmark", at), kind: "bookmark-add", bookId, at, chapterIndex, charOffset, title: "书签", excerpt: "" };
}

describe("sync queue", () => {
  it("keeps only the latest position per book", () => {
    let state = enqueue(EMPTY_QUEUE, progress(17, 3));
    state = enqueue(state, progress(17, 9));
    state = enqueue(state, progress(18, 1));
    expect(pendingCount(state)).toBe(2);
    const book17 = state.ops.find((op) => op.kind === "progress" && op.bookId === 17) as Extract<SyncOp, { kind: "progress" }>;
    expect(book17.chapterIndex).toBe(9);
  });

  it("lets a delete replace the pending annotation edit", () => {
    const at = 10;
    const edit: SyncOp = {
      id: newOpId("annotation", at),
      kind: "annotation",
      bookId: 17,
      at,
      annotation: { id: "a1", chapterIndex: 2, start: 5, end: 9, quote: "文字" },
    };
    const remove: SyncOp = { id: newOpId("annotation", at + 1), kind: "annotation-delete", bookId: 17, at: at + 1, annotationId: "a1" };
    const state = enqueue(enqueue(EMPTY_QUEUE, edit), remove);
    expect(pendingCount(state)).toBe(1);
    expect(state.ops[0].kind).toBe("annotation-delete");
    expect(opKey(edit)).toBe(opKey(remove));
  });

  it("keeps one read op per chapter and allows many chapters", () => {
    let state = enqueue(EMPTY_QUEUE, { id: newOpId("read", 1), kind: "read", bookId: 17, at: 1, chapterIndex: 3 });
    state = enqueue(state, { id: newOpId("read", 2), kind: "read", bookId: 17, at: 2, chapterIndex: 3 });
    state = enqueue(state, { id: newOpId("read", 3), kind: "read", bookId: 17, at: 3, chapterIndex: 4 });
    expect(pendingCount(state)).toBe(2);
    expect(state.ops.map((op) => (op.kind === "read" ? op.chapterIndex : -1))).toEqual([3, 4]);
  });

  it("collapses add and delete of the same bookmark anchor", () => {
    let state = enqueue(EMPTY_QUEUE, bookmarkAdd(17, 4, 320));
    state = enqueue(state, bookmarkAdd(17, 4, 900));
    expect(pendingCount(state)).toBe(2);
    state = enqueue(state, { id: newOpId("bookmark", 2), kind: "bookmark-delete", bookId: 17, at: 2, chapterIndex: 4, charOffset: 320 });
    expect(pendingCount(state)).toBe(2);
    expect(state.ops.map((op) => op.kind)).toEqual(["bookmark-add", "bookmark-delete"]);
  });

  it("caps the queue and drops the oldest entries", () => {
    let state = EMPTY_QUEUE;
    for (let i = 0; i < MAX_OPS + 5; i += 1) state = enqueue(state, progress(i, 1, i));
    expect(pendingCount(state)).toBe(MAX_OPS);
    const first = state.ops[0] as Extract<SyncOp, { kind: "progress" }>;
    expect(first.bookId).toBe(5);
  });

  it("acks by id so a newer op queued during the upload survives", () => {
    const sent = progress(17, 3);
    let state = enqueue(EMPTY_QUEUE, sent);
    const newer = progress(17, 8, 2);
    state = enqueue(state, newer);
    expect(state.ops.map((op) => op.id)).toEqual([newer.id]);
    state = ack(state, [sent]);
    expect(state.ops.map((op) => op.id)).toEqual([newer.id]);
    state = ack(state, [newer]);
    expect(pendingCount(state)).toBe(0);
    expect(state.attempts).toBe(0);
  });

  it("backs off exponentially and stops at two minutes", () => {
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
    expect(retryDelay(3)).toBe(8000);
    expect(retryDelay(20)).toBe(120000);
    const failed = markFailure(EMPTY_QUEUE, 1000);
    expect(failed.attempts).toBe(1);
    expect(failed.retryAt).toBe(3000);
  });

  it("only flushes when there is something to send and the backoff has passed", () => {
    const state = enqueue(EMPTY_QUEUE, progress(17, 1));
    expect(canFlush(state, 0)).toBe(true);
    const failed = markFailure(state, 0);
    expect(canFlush(failed, 1999)).toBe(false);
    expect(canFlush(failed, 2000)).toBe(true);
    expect(canFlush(EMPTY_QUEUE, 9999)).toBe(false);
    expect(batchOf(state, 1)).toHaveLength(1);
  });

  it("tells a dropped connection apart from a rejected payload", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkError(new Error("划线跨度过长"))).toBe(false);
    expect(isNetworkError(new Error("HTTP 400"))).toBe(false);
  });

  it("parses a damaged queue back to something safe", () => {
    expect(parseQueue(null)).toEqual(EMPTY_QUEUE);
    expect(parseQueue("{oops")).toEqual(EMPTY_QUEUE);
    expect(parseQueue(JSON.stringify({ ops: "nope" })).ops).toEqual([]);
    const raw = JSON.stringify({
      ops: [{ id: "a", kind: "progress", bookId: 17, at: 1 }, { id: "b", kind: "bogus", bookId: 17 }],
      attempts: "3",
      retryAt: 42,
      lastSyncAt: "2026-11-02 01:02:03",
    });
    const state = parseQueue(raw);
    expect(state.ops).toHaveLength(1);
    expect(state.attempts).toBe(3);
    expect(state.retryAt).toBe(42);
    expect(state.lastSyncAt).toBe("2026-11-02 01:02:03");
  });
});
