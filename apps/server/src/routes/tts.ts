import type { FastifyInstance } from "fastify";
import { cacheSize, clearTtsCache, synthesize, ttsCapabilities } from "../services/tts.js";

/** 朗读：能力查询、合成（正文走 POST body）、清缓存。 */
export async function ttsRoutes(app: FastifyInstance) {
  app.get("/api/tts", async () => ttsCapabilities());

  app.post<{ Body: { text?: string; voice?: string; rate?: number } }>("/api/tts/speak", async (request, reply) => {
    const body = request.body ?? {};
    try {
      const audio = await synthesize({ text: String(body.text ?? ""), voice: body.voice, rate: body.rate });
      reply.header("content-type", audio.contentType);
      reply.header("x-tts-cache", audio.cache);
      reply.header("cache-control", "private, max-age=86400");
      return reply.send(audio.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("未配置") ? "tts_disabled" : message.includes("最长") || message.includes("为空") ? "tts_bad_request" : "tts_upstream";
      return reply.code(code === "tts_bad_request" ? 400 : code === "tts_disabled" ? 409 : 502).send({ error: code, message });
    }
  });

  app.get("/api/tts/cache", async () => ({ bytes: cacheSize() }));

  app.post("/api/tts/cache/clear", async () => ({ removed: clearTtsCache() }));
}
