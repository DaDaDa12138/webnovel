import type { SyncOp, SyncResult } from "@legado/shared";
import { upsertAnnotation, removeAnnotation } from "./books/annotations.js";
import { addBookmark, removeBookmarkByAnchor } from "./books/bookmarks.js";
import { saveProgress } from "./books/progress.js";
import { markChapterRead } from "./books/reads.js";

/** 一批最多 500 条：客户端攒一天也就几十条，超过说明它在把整本书往回灌。 */
export const MAX_OPS = 500;

const KINDS = new Set(["progress", "annotation", "annotation-delete", "bookmark-add", "bookmark-delete", "read"]);

type OpResult = { ok: true } | { ok: false; error: string };

function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function applyOp(op: SyncOp): OpResult {
  switch (op.kind) {
    case "progress":
      saveProgress(Number(op.bookId), {
        chapterIndex: op.chapterIndex,
        charOffset: op.charOffset,
        chapterPercent: op.chapterPercent,
        percent: op.percent,
        offset: op.offset,
      });
      return { ok: true };
    case "annotation": {
      const result = upsertAnnotation(Number(op.bookId), op.annotation ?? {});
      return result.ok ? { ok: true } : { ok: false, error: result.body.error };
    }
    case "annotation-delete":
      // 已经删过（或根本没同步上来）也算成功：补传是幂等的，报错只会让队列永远清不掉。
      removeAnnotation(Number(op.bookId), String(op.annotationId ?? ""));
      return { ok: true };
    case "bookmark-add":
      addBookmark(Number(op.bookId), {
        chapterIndex: op.chapterIndex,
        title: op.title,
        excerpt: op.excerpt,
        charOffset: op.charOffset,
      });
      return { ok: true };
    case "bookmark-delete":
      removeBookmarkByAnchor(Number(op.bookId), Number(op.chapterIndex ?? 0), Number(op.charOffset ?? 0));
      return { ok: true };
    case "read":
      // 离线读过的章节：书或章已被删掉时也当成功，不然队列会永远卡在一条死数据上。
      markChapterRead(Number(op.bookId), Number(op.chapterIndex ?? 0));
      return { ok: true };
    default:
      return { ok: false, error: "unknown_kind" };
  }
}

/**
 * 补传离线期间攒下的写操作。
 *
 * 逐条应用而不是整批事务：一条坏数据（比如划线跨度过长）不该把整本进度一起回滚。
 * 失败的操作会带 error 返回，客户端只负责把它从队列里摘掉——同一条数据重试一百次也不会变好。
 */
export function applySyncOps(ops: SyncOp[]): SyncResult {
  const failed: Array<{ id: string; error: string }> = [];
  let applied = 0;
  for (const op of ops.slice(0, MAX_OPS)) {
    const id = typeof op?.id === "string" ? op.id : "";
    if (!id || !op?.kind || !KINDS.has(op.kind) || !Number.isFinite(Number(op.bookId))) {
      failed.push({ id: id || "(missing)", error: "bad_op" });
      continue;
    }
    try {
      const result = applyOp(op);
      if (result.ok) applied += 1;
      else failed.push({ id, error: result.error });
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }
  return { ok: true, applied, failed, at: sqliteNow() };
}
