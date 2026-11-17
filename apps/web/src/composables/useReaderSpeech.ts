import { ref, type Ref } from "vue";
import type { LoadedChapter } from "../lib/reader-types";
import { rangeAtOffset } from "../lib/reader-dom";
import { toast } from "../lib/toast";
import {
  clampTtsRate,
  rangeForOffsets,
  resolveTtsEngine,
  splitSpeechChunks,
  type SpeechChunk,
  type TtsEngine,
} from "../lib/reader-tts";

export { splitSpeechChunks, splitSentences } from "../lib/reader-tts";
export type { SpeechChunk, TtsEngine } from "../lib/reader-tts";

export interface ReaderSpeechSettings {
  engine: TtsEngine;
  voice: string;
  rate: number;
}

export interface ReaderSpeechDeps {
  index: Ref<number>;
  total: Ref<number>;
  currentChapter: Ref<LoadedChapter | null>;
  scroller: Ref<HTMLElement | null>;
  /** 实时读取朗读设置（语速可以在朗读过程中改）。 */
  settings: () => ReaderSpeechSettings;
  /** 服务端是否配置了朗读服务。 */
  httpEnabled: () => boolean;
  go: (next: number, charOffset?: number, options?: { keepSpeech?: boolean }) => Promise<void>;
  sectionEl: (index: number) => HTMLElement | null;
  /** 分页模式下把正在读的句子翻到眼前；返回 false 表示交给默认的滚动。 */
  reveal?: (range: Range) => boolean;
}

/** 浏览器语音列表是异步就绪的，第一次调用常常是空的。 */
export function systemVoices(): Array<{ name: string; lang: string }> {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().map((voice) => ({ name: voice.name, lang: voice.lang }));
}

/**
 * 逐句朗读当前章，读完自动翻下一章，并把正在读的句子高亮。
 *
 * 两个引擎走同一套句子队列：
 * - system：speechSynthesis，onend 是唯一可靠的换句时机（boundary 事件在 Android WebView 不可靠）；
 * - http：POST /api/tts/speak 拿音频字节用 <audio> 播，只做句级高亮，语速交给服务端。
 * 引擎的 pause 语义不同（speechSynthesis 是真暂停，<audio> 是暂停播放），所以不抽基类。
 */
export function useReaderSpeech(deps: ReaderSpeechDeps) {
  const speaking = ref(false);
  const paused = ref(false);
  const activeEngine = ref<"system" | "http" | null>(null);

  let chunkQueue: SpeechChunk[] = [];
  let cursor = 0;
  let currentChunk: SpeechChunk | null = null;
  let generation = 0;
  let failures = 0;
  let audio: HTMLAudioElement | null = null;
  let audioUrl = "";
  let prefetched: { chunk: SpeechChunk; url: string } | null = null;

  function clearHighlight(): void {
    const w = window as unknown as { CSS?: { highlights?: Map<string, unknown> } };
    w.CSS?.highlights?.delete("tts");
  }

  function highlightChunk(chunk: SpeechChunk): void {
    const w = window as unknown as {
      CSS?: { highlights?: Map<string, unknown> };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const section = deps.sectionEl(chunk.chapterIndex);
    if (!section) return;
    const ranges: Range[] = [];
    if (chunk.offset !== undefined) {
      const start = chunk.offset;
      const end = start + chunk.text.length;
      for (const block of section.querySelectorAll<HTMLElement>("[data-block]")) {
        const a = Number(block.dataset.start) || 0;
        const b = Number(block.dataset.end) || a;
        if (b <= start || a >= end) continue;
        const range = rangeAtOffset(block, Math.max(start, a), Math.min(end, b));
        if (range) ranges.push(range);
      }
    } else {
      // 兼容没有绝对偏移的旧片段：退回段内偏移。
      const para = section.querySelector<HTMLElement>('[data-para="' + chunk.paraIndex + '"]');
      if (!para) return;
      const range = rangeForOffsets(para, chunk.start, chunk.start + chunk.text.length);
      if (range) ranges.push(range);
    }
    if (!ranges.length) return;
    if (w.CSS?.highlights && w.Highlight) w.CSS.highlights.set("tts", new w.Highlight(...ranges));
    // 分页模式里容器不滚动，句子翻到下一屏时必须由分页器换页，scrollIntoView 是无效的。
    if (deps.reveal?.(ranges[0])) return;
    const body = deps.scroller.value?.getBoundingClientRect();
    const target = ranges[0].startContainer.parentElement?.closest<HTMLElement>("[data-block]") ?? section;
    const rect = target.getBoundingClientRect();
    if (!body) return;
    if (rect.top < body.top + 60 || rect.bottom > body.bottom - 60) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function pickVoice(name: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    if (name) {
      const hit = voices.find((voice) => voice.name === name || voice.voiceURI === name);
      if (hit) return hit;
    }
    return voices.find((voice) => voice.lang?.toLowerCase().startsWith("zh")) ?? null;
  }

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "auto";
    // 音频元素跨多次朗读复用，所以用 dataset.gen 记住「这段音频属于哪一轮」，
    // 停止后迟到的 ended/error 不会把新的一轮带跑。
    audio.addEventListener("ended", () => {
      if (!speaking.value || paused.value) return;
      if (audio?.dataset.gen !== String(generation)) return;
      advance();
    });
    audio.addEventListener("error", () => {
      if (!speaking.value) return;
      if (audio?.dataset.gen !== String(generation)) return;
      fail("朗读音频播放失败");
    });
    return audio;
  }

  function releaseUrl(url: string): void {
    if (url) URL.revokeObjectURL(url);
  }

  async function fetchAudio(chunk: SpeechChunk, gen: number): Promise<string | null> {
    const current = deps.settings();
    try {
      const response = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: chunk.text, voice: current.voice || undefined, rate: clampTtsRate(current.rate) }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message || "朗读服务返回 " + response.status);
      }
      const blob = await response.blob();
      if (gen !== generation) return null;
      return URL.createObjectURL(blob);
    } catch (error) {
      if (gen !== generation) return null;
      fail(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /** 预取下一句：网络往返藏在当前句的播放时间里，换句才不卡。 */
  function prefetchNext(): void {
    if (activeEngine.value !== "http" || prefetched) return;
    const next = chunkQueue[cursor];
    if (!next) return;
    const gen = generation;
    void fetchAudio(next, gen).then((url) => {
      if (!url || gen !== generation) return;
      if (prefetched) releaseUrl(url);
      else prefetched = { chunk: next, url };
    });
  }

  async function playHttp(chunk: SpeechChunk, gen: number): Promise<void> {
    let url: string | null = null;
    if (prefetched && prefetched.chunk === chunk) {
      url = prefetched.url;
      prefetched = null;
    } else {
      url = await fetchAudio(chunk, gen);
    }
    if (!url || gen !== generation) return;
    if (paused.value) {
      // 暂停期间抓回来的音频先留着，恢复时直接播。
      releaseUrl(audioUrl);
      audioUrl = url;
      return;
    }
    releaseUrl(audioUrl);
    audioUrl = url;
    const player = ensureAudio();
    player.dataset.gen = String(gen);
    player.src = url;
    prefetchNext();
    try {
      await player.play();
    } catch {
      if (gen === generation) fail("朗读音频无法播放（可能被浏览器拦截）");
    }
  }

  function playSystem(chunk: SpeechChunk, gen: number): void {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.lang = "zh-CN";
    utterance.rate = clampTtsRate(deps.settings().rate);
    const voice = pickVoice(deps.settings().voice);
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (gen !== generation) return;
      failures = 0;
      advance();
    };
    utterance.onerror = (event) => {
      if (gen !== generation) return;
      // 主动 cancel 也会走到这里，那不是失败。
      if (event.error === "canceled" || event.error === "interrupted") return;
      failures += 1;
      if (failures >= 3) {
        stop();
        toast("朗读失败：当前浏览器没有可用的语音引擎", "error");
        return;
      }
      advance();
    };
    synth.speak(utterance);
  }

  function play(chunk: SpeechChunk): void {
    if (!speaking.value || paused.value) return;
    const gen = generation;
    currentChunk = chunk;
    highlightChunk(chunk);
    if (activeEngine.value === "http") void playHttp(chunk, gen);
    else playSystem(chunk, gen);
  }

  function fail(message: string): void {
    failures += 1;
    if (failures >= 3) {
      stop();
      toast(message, "error");
      return;
    }
    advance();
  }

  function advance(): void {
    if (!speaking.value || paused.value) return;
    if (cursor >= chunkQueue.length) {
      void nextChapter();
      return;
    }
    play(chunkQueue[cursor]);
    cursor += 1;
  }

  async function nextChapter(): Promise<void> {
    if (deps.index.value >= deps.total.value - 1) {
      stop();
      toast("已读完最后一章");
      return;
    }
    const gen = generation;
    await deps.go(deps.index.value + 1, 0, { keepSpeech: true });
    if (gen !== generation || !speaking.value) return;
    const chapter = deps.currentChapter.value;
    if (!chapter) return;
    chunkQueue = splitSpeechChunks(chapter.index, chapter.paragraphs, 120, chapter.starts);
    cursor = 0;
    advance();
  }

  function systemAvailable(): boolean {
    return "speechSynthesis" in window;
  }

  function start(): void {
    const chapter = deps.currentChapter.value;
    if (!chapter || speaking.value) return;
    const engine = resolveTtsEngine(deps.settings().engine, { system: systemAvailable(), http: deps.httpEnabled() });
    if (!engine) {
      toast("没有可用的朗读引擎：浏览器不支持语音，服务端也没配置朗读地址", "error");
      return;
    }
    activeEngine.value = engine;
    generation += 1;
    failures = 0;
    paused.value = false;
    speaking.value = true;
    chunkQueue = splitSpeechChunks(chapter.index, chapter.paragraphs, 120, chapter.starts);
    cursor = 0;
    advance();
  }

  function stop(): void {
    speaking.value = false;
    paused.value = false;
    generation += 1;
    currentChunk = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    releaseUrl(audioUrl);
    audioUrl = "";
    if (prefetched) releaseUrl(prefetched.url);
    prefetched = null;
    clearHighlight();
  }

  function pause(): void {
    if (!speaking.value || paused.value) return;
    paused.value = true;
    if (activeEngine.value === "http") audio?.pause();
    else if ("speechSynthesis" in window) window.speechSynthesis.pause();
  }

  function resume(): void {
    if (!speaking.value || !paused.value) return;
    paused.value = false;
    if (activeEngine.value === "http") {
      if (audio && audioUrl && !audio.src) audio.src = audioUrl;
      if (audio?.src) void audio.play().catch(() => fail("朗读音频无法继续播放"));
      else if (currentChunk) play(currentChunk);
      return;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.resume();
  }

  function toggle(): void {
    if (speaking.value) stop();
    else start();
  }

  return { speaking, paused, activeEngine, start, stop, toggle, pause, resume };
}
