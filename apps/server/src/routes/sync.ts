import type { FastifyInstance } from "fastify";
import type { SyncOp } from "@legado/shared";
import { applySyncOps, MAX_OPS } from "../services/sync.js";

export async function syncRoutes(app: FastifyInstance) {
  /** 离线写入的补传口：断网时攒下的进度 / 划线 / 书签，恢复网络后一次送上来。 */
  app.post<{ Body: { ops?: SyncOp[] } }>("/api/sync", async (req, reply) => {
    const ops = Array.isArray(req.body?.ops) ? (req.body!.ops as SyncOp[]) : [];
    if (!ops.length) return reply.code(400).send({ error: "empty_batch", message: "没有待同步的操作" });
    if (ops.length > MAX_OPS) {
      return reply.code(413).send({ error: "too_many_ops", message: `一次最多补传 ${MAX_OPS} 条` });
    }
    return reply.send(applySyncOps(ops));
  });
}
