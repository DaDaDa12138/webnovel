import type { FastifyInstance } from "fastify";
import {
  clearDahuilangAuth,
  dahuilangAuth,
  dahuilangConfigured,
  dahuilangExploreState,
  dahuilangLogin,
  dahuilangLoginWithKey,
  dahuilangSourceId,
  saveDahuilangExploreState,
  ensureDahuilangSource,
  saveDahuilangAuth,
} from "../services/dahuilang.js";

/** 大灰狼聚合账号：邮箱密码或密钥登录、看状态、退出。token 永远不出现在响应里。 */
function status(): Record<string, unknown> {
  const auth = dahuilangAuth();
  return {
    configured: dahuilangConfigured(),
    sourceId: dahuilangSourceId(),
    server: auth.server,
    email: auth.email,
    nickname: auth.nickname,
    member: auth.member,
    vipLabel: auth.vipLabel,
    deviceTail: auth.deviceId ? auth.deviceId.slice(-6) : "",
  };
}

export async function dahuilangRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dahuilang/status", async () => status());

  app.post("/api/dahuilang/login", async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string; key?: string; server?: string };
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const key = String(body.key ?? "").trim();
    if (!key && (!email || !password)) {
      return reply.code(400).send({ error: "missing_credentials", message: "请填写大灰狼聚合的邮箱与密码，或直接填密钥" });
    }
    try {
      // 先记住用户选的线路，登录请求才会打到这台服务器上；失败也保留，方便换线路重试。
      if (body.server !== undefined) saveDahuilangAuth({ server: body.server });
      if (key) await dahuilangLoginWithKey(key);
      else await dahuilangLogin(email, password);
      return { ok: true, ...status() };
    } catch (err) {
      return reply.code(502).send({ error: "login_failed", message: String((err as Error).message ?? err) });
    }
  });

  /** 发现页控制条：模式 / 频道 / 平台 / 番茄筛选。 */
  app.get("/api/dahuilang/explore", async () => dahuilangExploreState());

  app.post("/api/dahuilang/explore", async (req, reply) => {
    const body = (req.body ?? {}) as {
      mode?: unknown;
      gender?: unknown;
      source?: unknown;
      word?: unknown;
      status?: unknown;
      sort?: unknown;
    };
    try {
      return { ok: true, ...saveDahuilangExploreState(body) };
    } catch (err) {
      return reply.code(400).send({ error: "bad_explore_state", message: String((err as Error).message ?? err) });
    }
  });

  app.post("/api/dahuilang/logout", async () => {
    clearDahuilangAuth();
    return { ok: true, ...status() };
  });

  app.addHook("onReady", async () => {
    ensureDahuilangSource();
  });
}
