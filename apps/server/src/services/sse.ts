import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * 一条 Server-Sent-Events 通道。
 *
 * 这段样板（hijack + 四个响应头 + abort 判定 + 帧格式）原本在 debug/search/books
 * 四个路由里各抄了一遍，其中「`req.raw` 的 close 事件在请求体读完时就触发」这个
 * 坑只在一处写了注释，抄漏一次整条流就会在第一帧前被判定为断开。
 */
export interface SseChannel {
  /** 推一帧；客户端已断开时静默丢弃。 */
  send(event: string, data: unknown): void;
  /** 客户端走了就别再算下去了。 */
  isClosed(): boolean;
  end(): void;
}

export function openSse(req: FastifyRequest, reply: FastifyReply): SseChannel {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  let closed = false;
  // req.raw 的 "close" 在请求体读完后立刻触发（POST 就是「立刻」），用它判定会让
  // 每条流在首帧之前就中止。只有客户端 abort 或响应关闭才代表「真的走了」。
  req.raw.on("aborted", () => {
    closed = true;
  });
  raw.on("close", () => {
    closed = true;
  });
  return {
    send(event, data) {
      if (raw.writableEnded) return;
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    isClosed: () => closed || raw.writableEnded,
    end() {
      if (!raw.writableEnded) raw.end();
    },
  };
}
