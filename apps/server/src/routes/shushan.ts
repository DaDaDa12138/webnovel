import type { FastifyInstance } from "fastify";
import {
  clearShushanAuth,
  ensureShushanSource,
  shushanApplyUpdate,
  shushanAuth,
  shushanCheckUpdate,
  shushanConfigured,
  shushanExploreState,
  shushanLogin,
  shushanRuleInfo,
  saveShushanExploreState,
  shushanSourceId,
} from "../services/shushan.js";

/** 书山聚合账号：登录换 api_key、看当前状态、退出。api_key 永远不出现在响应里。 */
function status(): Record<string, unknown> {
  const auth = shushanAuth();
  return {
    configured: shushanConfigured(),
    sourceId: shushanSourceId(),
    email: auth.email,
    nickname: auth.nickname,
    member: auth.member,
    deviceTail: auth.deviceId ? auth.deviceId.slice(-6) : "",
    ...shushanRuleInfo(),
  };
}

export async function shushanRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/shushan/status", async () => status());

  app.post("/api/shushan/login", async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || !password) {
      return reply.code(400).send({ error: "missing_credentials", message: "请填写书山聚合的邮箱与密码" });
    }
    try {
      await shushanLogin(email, password);
      return { ok: true, ...status() };
    } catch (err) {
      return reply.code(502).send({ error: "login_failed", message: String((err as Error).message ?? err) });
    }
  });

  /** 发现页的控制条：模式 / 性别 / 源站 / 标签，以及 74 个源站的清单。 */
  app.get("/api/shushan/explore", async () => shushanExploreState());

  app.post("/api/shushan/explore", async (req, reply) => {
    const body = (req.body ?? {}) as { mode?: unknown; gender?: unknown; site?: unknown; tag?: unknown };
    try {
      const state = await saveShushanExploreState(body);
      return { ok: true, ...state };
    } catch (err) {
      return reply.code(400).send({ error: "bad_explore_state", message: String((err as Error).message ?? err) });
    }
  });

  app.post("/api/shushan/logout", async () => {
    clearShushanAuth();
    return { ok: true, ...status() };
  });

  /** 只查版本：设置页点「检查更新」走这里。 */
  app.post("/api/shushan/check", async (_req, reply) => {
    try {
      return { ok: true, ...(await shushanCheckUpdate(true)) };
    } catch (err) {
      return reply.code(502).send({ error: "check_failed", message: String((err as Error).message ?? err) });
    }
  });

  /** 下载最新书源，刷新分类表与上游令牌。 */
  app.post("/api/shushan/update", async (_req, reply) => {
    try {
      return { ok: true, ...(await shushanApplyUpdate(true)) };
    } catch (err) {
      return reply.code(502).send({ error: "update_failed", message: String((err as Error).message ?? err) });
    }
  });

  // 设置页可能是全新库的第一个访问者：这里兜底登记一次，避免源列表里没有它。
  app.addHook("onReady", async () => {
    ensureShushanSource();
    // 书源会定期发新版：启动后查一次，之后每 12 小时查一次，有新版就自动更新分类表。
    const tick = async (): Promise<void> => {
      try {
        const info = await shushanCheckUpdate();
        if (info.updateAvailable) await shushanApplyUpdate();
      } catch {
        /* 网络不通就下次再试，不影响阅读 */
      }
    };
    const first = setTimeout(() => void tick(), 15_000);
    first.unref?.();
    const timer = setInterval(() => void tick(), 12 * 3600_000);
    timer.unref?.();
  });
}
