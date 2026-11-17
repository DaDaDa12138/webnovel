import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { getSetting } from "./settings.js";

/**
 * 服务端朗读（TTS）：只做代理与缓存，不合成语音。
 * 上游可以是任何接受 text/speed 的本地服务（edge-tts、Piper、GPT-SoVITS 的 HTTP 封装）。
 * 正文走 POST body，绝不放进 query string：800 字中文编码后有几 KB，会撞上游与代理的长度上限。
 */

export interface TtsCapabilities {
  enabled: boolean;
  format: string;
  maxChars: number;
  voices: string[];
}

export interface TtsRequest {
  text: string;
  voice?: string;
  rate?: number;
}

export interface TtsAudio {
  body: Buffer;
  contentType: string;
  cache: "hit" | "miss";
}

export const TTS_MAX_CHARS = 600;
const TTS_TIMEOUT_MS = 20_000;
const CONCURRENCY = 2;
const CACHE_LIMIT_BYTES = 200 * 1024 * 1024;
const CACHE_KEEP_RATIO = 0.8;

function ttsDir(): string {
  const dir = join(config.dataDir, "tts");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function ttsConfig() {
  return {
    url: getSetting("ttsUrl", "").trim(),
    method: getSetting("ttsMethod", "GET").trim().toUpperCase() === "POST" ? "POST" : "GET",
    format: getSetting("ttsFormat", "mp3").trim() || "mp3",
    defaultVoice: getSetting("ttsVoice", "").trim(),
  };
}

export function ttsCapabilities(): TtsCapabilities {
  const conf = ttsConfig();
  const voices = getSetting("ttsVoices", "")
    .split(/[,，\n]/)
    .map((item: string) => item.trim())
    .filter(Boolean);
  return {
    enabled: Boolean(conf.url),
    format: conf.format,
    maxChars: TTS_MAX_CHARS,
    voices,
  };
}

/** 两个并发的合成上限：上游多是单进程模型，压太多只会一起变慢。 */
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

function cacheKey(conf: ReturnType<typeof ttsConfig>, req: TtsRequest): string {
  return createHash("sha256")
    .update([conf.url, conf.method, conf.format, req.voice ?? conf.defaultVoice, String(req.rate ?? 1), req.text].join("\u0000"))
    .digest("hex")
    .slice(0, 40);
}

function readCache(key: string, format: string): TtsAudio | null {
  const file = join(ttsDir(), key + "." + format);
  const meta = join(ttsDir(), key + ".json");
  if (!existsSync(file) || !existsSync(meta)) return null;
  try {
    const info = JSON.parse(readFileSync(meta, "utf8")) as { contentType?: string };
    const body = readFileSync(file);
    const now = new Date();
    utimesSync(file, now, now);
    return { body, contentType: info.contentType || "audio/mpeg", cache: "hit" };
  } catch {
    return null;
  }
}

function writeCache(key: string, format: string, audio: { body: Buffer; contentType: string }): void {
  try {
    const dir = ttsDir();
    writeFileSync(join(dir, key + "." + format), audio.body);
    writeFileSync(join(dir, key + ".json"), JSON.stringify({ contentType: audio.contentType, at: Date.now() }));
    enforceCacheLimit(dir);
  } catch {
    /* 缓存写不进去不影响播放 */
  }
}

/** 超过上限就按 mtime 从旧到新删到 80%，读命中会刷新 mtime，等价于 LRU。 */
function enforceCacheLimit(dir: string): void {
  const entries: Array<{ path: string; size: number; mtime: number }> = [];
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json")) continue;
    try {
      const full = join(dir, name);
      const stat = statSync(full);
      entries.push({ path: full, size: stat.size, mtime: stat.mtimeMs });
      total += stat.size;
    } catch {
      /* 文件刚被删掉，跳过 */
    }
  }
  if (total <= CACHE_LIMIT_BYTES) return;
  entries.sort((a, b) => a.mtime - b.mtime);
  let size = total;
  for (const entry of entries) {
    if (size <= CACHE_LIMIT_BYTES * CACHE_KEEP_RATIO) break;
    try {
      unlinkSync(entry.path);
      unlinkSync(entry.path.replace(/\.[^.]+$/, ".json"));
      size -= entry.size;
    } catch {
      /* 删不掉就留着，下次再试 */
    }
  }
}

export function clearTtsCache(): number {
  const dir = ttsDir();
  let removed = 0;
  for (const name of readdirSync(dir)) {
    try {
      unlinkSync(join(dir, name));
      removed += 1;
    } catch {
      /* 忽略 */
    }
  }
  return removed;
}

export function cacheSize(): number {
  const dir = ttsDir();
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json")) continue;
    try {
      total += statSync(join(dir, name)).size;
    } catch {
      /* 忽略 */
    }
  }
  return total;
}

async function requestUpstream(conf: ReturnType<typeof ttsConfig>, req: TtsRequest): Promise<{ body: Buffer; contentType: string }> {
  const voice = req.voice || conf.defaultVoice;
  const rate = Math.min(2, Math.max(0.5, Number(req.rate) || 1));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    let response: Response;
    if (conf.method === "POST") {
      response = await fetch(conf.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: req.text, voice: voice || undefined, rate, speed: rate, format: conf.format }),
        signal: controller.signal,
      });
    } else {
      const url = new URL(conf.url);
      url.searchParams.set("text", req.text);
      url.searchParams.set("speed", String(rate));
      if (voice) url.searchParams.set("voice", voice);
      url.searchParams.set("format", conf.format);
      response = await fetch(url, { signal: controller.signal });
    }
    if (!response.ok) {
      throw new Error("上游朗读服务返回 " + response.status);
    }
    const contentType = response.headers.get("content-type") || "audio/mpeg";
    if (contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error("上游朗读服务返回了 JSON：" + text.slice(0, 160));
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("上游朗读服务返回了空音频");
    return { body: buffer, contentType };
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesize(req: TtsRequest): Promise<TtsAudio> {
  const conf = ttsConfig();
  if (!conf.url) throw new Error("未配置朗读服务地址");
  const text = req.text.trim();
  if (!text) throw new Error("朗读内容为空");
  if (text.length > TTS_MAX_CHARS) throw new Error("单次朗读最长 " + TTS_MAX_CHARS + " 字");
  const key = cacheKey(conf, { ...req, text });
  const cached = readCache(key, conf.format);
  if (cached) return cached;
  await acquire();
  try {
    // 排队期间可能已经被另一个请求填好
    const again = readCache(key, conf.format);
    if (again) return again;
    const audio = await requestUpstream(conf, { ...req, text });
    writeCache(key, conf.format, audio);
    return { ...audio, cache: "miss" };
  } finally {
    release();
  }
}
