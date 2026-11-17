<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type CSSProperties } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  api,
  type AnnotationItem,
  type BookDetail,
  type BookmarkItem,
  type ChapterImage,
  type ChapterItem,
  type ProgressHistoryItem,
  type TtsCapabilities,
} from "../api";
import type { AnnotationColor, ReanchorApplyResult, SwitchReanchor, SwitchResult } from "@legado/shared";
import { goBack } from "../lib/nav";
import { toast } from "../lib/toast";
import {
  DEFAULT_READER_SETTINGS,
  fontStack,
  fromServerSettings,
  hasStoredReaderSettings,
  loadReaderSettings,
  normalizeReaderSettings,
  readerPalette,
  saveReaderSettings,
  toServerSettings,
  type ReaderSettings,
} from "../lib/reader-settings";
import {
  applyBookTypography,
  clearBookTypography,
  isBookTypographyPatch,
  loadBookTypography,
  pickBookTypography,
  saveBookTypography,
  type BookTypographyOverride,
} from "../lib/reader-book-settings";
import { bookPercent, buildStarts, chapterLength, clamp01, paragraphAt, readingMinutes, remainingChars } from "../lib/reader-progress";
import { clearSwitchAnchor, fromServerSwitchAnchor, loadSwitchAnchor, makeSwitchAnchor, resolveSwitchAnchor, saveSwitchAnchor, toSwitchAnchorPayload } from "../lib/switch-anchor";
import { takeSwitchNoticeDetail } from "../lib/switch-notice";
import {
  annotationsMarkdown,
  matchAnnotation,
  quoteAround,
  type AnnotationRange,
} from "../lib/annotations";
import type { LoadedChapter } from "../lib/reader-types";
import { blockIndexAt, buildDisplayBlocks } from "../lib/reader-blocks";
import {
  loadParagraphFixes,
  removeParagraphFix,
  resolveParagraphFixes,
  saveParagraphFix,
  type ParagraphFix,
  type ParagraphFixKind,
} from "../lib/reader-paragraph-fixes";
import { chapterText, splitParagraphs } from "../lib/reader-text";
import { firstVisibleOffset, offsetFromPoint, rangeAtOffset } from "../lib/reader-dom";
import { actionForKey, isEditableTarget } from "../lib/reader-keys";
import { isNetworkError, newOpId } from "../lib/sync-queue";
import { sleepEndsAt as sleepEndsAtOf, sleepLeft as sleepLeftOf } from "../lib/reader-sleep";
import { pageDwellMs } from "../lib/reader-autoturn";
import { applyAdjust, type AdjustKind } from "../lib/reader-adjust";
import { wakelockWanted } from "../lib/reader-wakelock";
import { useScreenWakeLock } from "../composables/useScreenWakeLock";
import { useReaderFonts } from "../composables/useReaderFonts";
import type { TapAction } from "../lib/reader-tap";
import ChapterSection from "../components/reader/ChapterSection.vue";
import ReaderChrome from "../components/reader/ReaderChrome.vue";
import ReaderReadout from "../components/reader/ReaderReadout.vue";
import ReaderProgressBar from "../components/reader/ReaderProgressBar.vue";
import ReaderSettingsSheet from "../components/reader/ReaderSettingsSheet.vue";
import ReaderSwitchSheet from "../components/reader/ReaderSwitchSheet.vue";
import ReaderReanchorSheet from "../components/reader/ReaderReanchorSheet.vue";
import ReaderParagraphSheet from "../components/reader/ReaderParagraphSheet.vue";
import ReaderCatalog from "../components/reader/ReaderCatalog.vue";
import ReaderSidebar from "../components/reader/ReaderSidebar.vue";
import ReaderBookmarks from "../components/reader/ReaderBookmarks.vue";
import ReaderAnnotations from "../components/reader/ReaderAnnotations.vue";
import ReaderNoteSheet from "../components/reader/ReaderNoteSheet.vue";
import ReaderMoreSheet from "../components/reader/ReaderMoreSheet.vue";
import ReaderMarkPopover from "../components/reader/ReaderMarkPopover.vue";
import ReaderSearch from "../components/reader/ReaderSearch.vue";
import ReaderSearchNav from "../components/reader/ReaderSearchNav.vue";
import ReaderSelectionBar from "../components/reader/ReaderSelectionBar.vue";
import ReaderSpeechBar from "../components/reader/ReaderSpeechBar.vue";
import ReaderImageViewer from "../components/reader/ReaderImageViewer.vue";
import ReaderAdjustHud from "../components/reader/ReaderAdjustHud.vue";
import QuoteCardSheet from "../components/reader/QuoteCardSheet.vue";
import ReaderIcon from "../components/reader/ReaderIcon.vue";
import { useReaderPager } from "../composables/useReaderPager";
import { useReaderGestures } from "../composables/useReaderGestures";
import { useReaderAutoScroll } from "../composables/useReaderAutoScroll";
import { useReaderAutoTurn } from "../composables/useReaderAutoTurn";
import { systemVoices, useReaderSpeech } from "../composables/useReaderSpeech";
import { useReadingActivity } from "../composables/useReadingActivity";
import { useSyncQueue } from "../composables/useSyncQueue";
import { useReaderSearch } from "../composables/useReaderSearch";

const route = useRoute();
const router = useRouter();
const bookId = Number(route.params.id);
const initialIndex = Math.max(0, Number(route.params.index) || 0);

const book = ref<BookDetail | null>(null);
const total = ref(0);
const index = ref(initialIndex);
const windowStart = ref(initialIndex);
const windowEnd = ref(initialIndex);
const chapters = reactive(new Map<number, LoadedChapter>());
const inflight = new Map<number, Promise<void>>();
const scroller = ref<HTMLElement | null>(null);
/** 滚动超过一屏才显示吸顶书眉，避免正文第一行就被胶囊压住。 */
const stickyVisible = ref(false);
const flow = ref<HTMLElement | null>(null);
const ready = ref(false);
const loadError = ref("");
const restored = ref(false);

const chromeVisible = ref(true);
const showSettings = ref(false);
const showCatalog = ref(false);
const showMarks = ref(false);
const showMore = ref(false);
const markPopover = ref<{
  item: AnnotationItem;
  rect: { left: number; top: number; bottom: number; width: number };
} | null>(null);
const showSwitch = ref(false);
/** 段落手动纠正：本书、本机保存，按章号+原文/章名重新认回。 */
const paragraphFixes = ref<ParagraphFix[]>(loadParagraphFixes(bookId));
const correcting = ref(false);
const showParagraphSheet = ref(false);
const correctTarget = ref<{
  chapterIndex: number;
  chapterTitle: string;
  para: number;
  text: string;
  current: ParagraphFixKind | null;
} | null>(null);
const offline = ref(typeof navigator !== "undefined" && !navigator.onLine);
// 断网期间攒下的进度 / 划线 / 书签：恢复网络后由这个队列统一补传。
const sync = useSyncQueue();

/** 换源成功：书源、目录、正文缓存全变了，重开这个阅读页最稳（顺带清掉旧的章节窗口）。 */
function onSwitched(result: SwitchResult): void {
  // 换源已经把这本书的目录、正文缓存、进度全换掉了，这一页手里的 scrollTop 与
  // charOffset 属于旧源。必须立刻闭嘴，否则 pagehide 的保存会把旧偏移写到新章上，
  // 新页面一恢复就落到下一章去（实测就是这样「换源后跳了一章」）。
  leaving = true;
  const target = result.progress?.index ?? index.value;
  const chapter = currentChapter.value;
  if (chapter?.paragraphs.length) {
    const anchor = makeSwitchAnchor({
      bookId: String(bookId),
      chapterIndex: target,
      chapterTitle: chapter.title,
      text: chapterText(chapter.paragraphs),
      charOffset: progress.charOffset,
      chapterPercent: progress.chapterPercent,
    });
    if (anchor) saveSwitchAnchor(anchor);
  }
  window.location.assign("/read/" + bookId + "/" + target);
}

function onOnline() {
  offline.value = false;
  void sync.flush(true);
  toast("网络已恢复");
}

function onOffline() {
  offline.value = true;
  toast("已离线，最近读过的章节仍可打开", "error");
}

/** 切回前台时补一次同步：既把断网期间攒的写操作送出去，也把别的设备新加的划线拉回来。 */
function onVisible() {
  if (document.visibilityState !== "visible") return;
  void sync.flush();
  wakeLock.sync();
  if (!noteOpen.value && !selection.rect) void loadAnnotations();
}

/** 全局偏好与本书覆盖分开存：改本书不会污染其他书，恢复时也有一个干净的基线。 */
const initialBaseSettings = loadReaderSettings();
const baseSettings = ref<ReaderSettings>(initialBaseSettings);
const bookOverride = ref<BookTypographyOverride>(loadBookTypography(bookId));
const settings = ref<ReaderSettings>(applyBookTypography(initialBaseSettings, bookOverride.value));
const settingScope = ref<"global" | "book">(Object.keys(bookOverride.value).length ? "book" : "global");
const bookCustomized = computed(() => Object.keys(bookOverride.value).length > 0);
/** 面板显示哪一层：全局作用域下显示基线，本书作用域下显示叠加后的实际排版。 */
const panelSettings = computed(() => (settingScope.value === "book" ? settings.value : baseSettings.value));
const progress = reactive({ charOffset: 0, chapterPercent: 0, percent: 0 });
const catalogItems = ref<ChapterItem[]>([]);
/** 拖动进度条时按 idx 取章名：目录里含卷行，不能直接拿数组下标当章节号。 */
const catalogTitles = computed(() => {
  const titles: string[] = [];
  for (const item of catalogItems.value) titles[item.idx] = item.title;
  return titles;
});
const catalogLoading = ref(false);
const bookmarks = ref<BookmarkItem[]>([]);
const annotations = ref<AnnotationItem[]>([]);
/** 已读章节：目录里压暗读过的章，只记「打开过」，位置仍由 progress 负责。 */
const readChapters = ref<Set<number>>(new Set());
const showNotes = ref(false);
const showCard = ref(false);
const cardQuote = ref("");
const notesLoading = ref(false);

/** 当前选区：章节内字符偏移 + 选区矩形（浮动条定位用）。 */
const selection = reactive({
  chapter: 0,
  start: 0,
  end: 0,
  quote: "",
  rect: null as { top: number; left: number; width: number; height: number } | null,
});

const noteOpen = ref(false);
const noteEditing = ref<AnnotationItem | null>(null);
/** 章末「写笔记」：不依附选区，保存成一条本章笔记。 */
const noteChapter = ref(false);
const noteChapterIndex = ref(0);
const noteQuote = ref("");
const noteColor = ref<AnnotationColor>("yellow");
const noteComment = ref("");
let selTimer = 0;
const pageNo = ref(1);
const pageCount = ref(1);

// 跟随系统深色：只在用户开启 followSystemTheme 时影响取色，其余情况仍用主题本身。
const systemDark = ref(false);
let darkQuery: MediaQueryList | null = null;

function onScheme(event: MediaQueryListEvent) {
  systemDark.value = event.matches;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const theme = computed(() => readerPalette(settings.value, systemDark.value));
const readerStyle = computed<CSSProperties>(
  () =>
    ({
      "--reader-bg": theme.value.bg,
      "--reader-fg": theme.value.fg,
      "--reader-muted": theme.value.muted,
      "--reader-panel": theme.value.panel,
      "--reader-border": theme.value.border,
      "--reader-accent": theme.value.accent,
      "--reader-font": fontStack(settings.value.fontFamily, settings.value.customFont),
      "--reader-size": settings.value.fontSize + "px",
      "--reader-weight": String(settings.value.fontWeight),
      "--reader-line": String(settings.value.lineHeight),
      "--reader-para": settings.value.paraSpacing + "em",
      "--reader-letter": settings.value.letterSpacing + "em",
      "--reader-page": settings.value.pageWidth + "px",
      "--reader-margin": settings.value.pageMargin + "px",
      "--reader-pad-y": settings.value.pagePaddingY + "px",
    }) as CSSProperties,
);

const visible = computed(() => {
  const out: number[] = [];
  for (let i = windowStart.value; i <= windowEnd.value; i += 1) {
    if (i >= 0 && (!total.value || i < total.value)) out.push(i);
  }
  return out;
});

const currentChapter = computed(() => chapters.get(index.value) ?? null);
/** 当前章要求登录时，整本书都读不了：只留这一块提示，别把前后章也铺成三份同样的错误。 */
const loginBlocked = computed(() => Boolean(currentChapter.value?.error && /登录/.test(currentChapter.value.error)));

const visibleChapters = computed(() => {
  const list = visible.value.map((i) => chapters.get(i)).filter((chapter): chapter is LoadedChapter => Boolean(chapter));
  if (loginBlocked.value && currentChapter.value) return [currentChapter.value];
  return list;
});
const chapterTitle = computed(() => currentChapter.value?.title || "第 " + (index.value + 1) + " 章");
/** 换源面板的「当前源」对照列：只取当前章开头，和候选测字截取的 600 字对齐。 */
const currentExcerpt = computed(() =>
  (currentChapter.value?.paragraphs ?? [])
    .map((paragraph) => String(paragraph).trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 600),
);

/** 换源前所在的那一句：面板把它随请求发给服务端，换到新源后由服务端锚点接续。 */
const switchAnchorDraft = computed(() => {
  // 只有打开换源面板才需要这段引文：否则每次滚动都会重算一遍整章字符串。
  if (!showSwitch.value) return null;
  const chapter = currentChapter.value;
  if (!chapter?.paragraphs.length) return null;
  const anchor = makeSwitchAnchor({
    bookId: String(bookId),
    chapterIndex: index.value,
    chapterTitle: chapter.title,
    text: chapterText(chapter.paragraphs),
    charOffset: progress.charOffset,
    chapterPercent: progress.chapterPercent,
  });
  return anchor ? toSwitchAnchorPayload(anchor) : null;
});

/** 换源会整页重载，面板里的 toast 活不过 reload；这里接住回执再提示一次。 */
const switchNotice = ref("");
const switchReanchor = ref<SwitchReanchor | null>(null);
/** 自动换源的回执带「撤销」：服务端这次也写了 switch_history，撤销是真实可用的。 */
const switchUndoable = ref(false);
/** 同一本书并发预取多章时，服务端只换一次源；提示也只弹一次。 */
const announcedAutoSwitch = new Set<number>();
const switchUndoing = ref(false);
const reanchoring = ref(false);
const showReanchor = ref(false);
let switchNoticeTimer = 0;

function showSwitchNotice(
  text: string,
  reanchor: SwitchReanchor | null = null,
  undoable = false,
  sticky = false,
): void {
  if (!text) return;
  switchNotice.value = text;
  switchReanchor.value = reanchor;
  switchUndoable.value = undoable;
  window.clearTimeout(switchNoticeTimer);
  // 自动换源是可撤销操作，不能 9 秒后自己消失；手动换源回执仍然自动收起。
  if (!sticky) {
    switchNoticeTimer = window.setTimeout(() => {
      switchNotice.value = "";
      switchReanchor.value = null;
      switchUndoable.value = false;
    }, 9000);
  }
}

function dismissSwitchNotice(): void {
  window.clearTimeout(switchNoticeTimer);
  switchNotice.value = "";
  switchReanchor.value = null;
  switchUndoable.value = false;
}

/** 撤销自动换源：换回旧源后整页重载，不把新源的位置写回旧源。 */
async function undoAutoSwitch(): Promise<void> {
  if (switchUndoing.value) return;
  switchUndoing.value = true;
  try {
    const result = await api.undoSwitch(bookId, {
      chapterIndex: index.value,
      chapterTitle: currentChapter.value?.title ?? chapterTitle.value,
    });
    leaving = true;
    dismissSwitchNotice();
    toast(`已换回 ${result.source?.name ?? "原来源"}`);
    window.location.assign("/read/" + bookId + "/" + (result.progress?.index ?? index.value));
  } catch (err) {
    toast("撤销失败：" + String((err as Error).message ?? err).slice(0, 60), "error");
  } finally {
    switchUndoing.value = false;
  }
}

/** 换源时没能跟过来的标注/书签数量：>0 才值得给一个「重试重贴」。 */
const reanchorFailed = computed(() => {
  const report = switchReanchor.value;
  return report ? report.annotations.failed + report.bookmarks.failed : 0;
});

/** 重试重贴：正文抓取超时/被限流时位置会留在旧章，这里用同一份快照再跑一次。 */
async function retryReanchor(): Promise<void> {
  if (reanchoring.value) return;
  reanchoring.value = true;
  try {
    const result = await api.retryReanchor(bookId);
    switchReanchor.value = result.reanchor;
    const a = result.reanchor.annotations;
    const b = result.reanchor.bookmarks;
    const moved = a.moved + a.kept + b.moved + b.kept;
    showSwitchNotice(`已重新定位 ${moved} 条标注/书签${a.failed + b.failed ? `，仍有 ${a.failed + b.failed} 条没找到` : ""}`, result.reanchor);
    await Promise.all([loadMarks(), loadAnnotations()]);
  } catch (err) {
    toast("重贴失败：" + String((err as Error).message ?? err).slice(0, 60), "error");
  } finally {
    reanchoring.value = false;
  }
}

function openReanchorSheet(): void {
  if (!reanchorFailed.value) return;
  showReanchor.value = true;
}

/** 手动定位成功一条：同步回执计数，避免横幅还显示旧失败数。 */
function onReanchorApplied(result: ReanchorApplyResult): void {
  const report = switchReanchor.value;
  if (report) {
    const bucket = result.kind === "annotation" ? report.annotations : report.bookmarks;
    bucket.failed = Math.max(0, bucket.failed - 1);
    bucket.moved += 1;
    if (report.failures) {
      report.failures = report.failures.filter((item) => !(item.kind === result.kind && String(item.id) === String(result.id)));
    }
  }
  void Promise.all([loadMarks(), loadAnnotations()]);
}

/** 正文质量提示只在本章生效；读者点「忽略」后，本次会话不再打扰。 */
const qualityDismissed = ref<number[]>([]);
const qualityNotice = computed(() => {
  const chapter = currentChapter.value;
  const report = chapter?.quality;
  if (!chapter || !report || report.quality === "ok") return null;
  if (qualityDismissed.value.includes(chapter.index)) return null;
  return report;
});

function dismissQuality(): void {
  const chapter = currentChapter.value;
  if (!chapter || qualityDismissed.value.includes(chapter.index)) return;
  qualityDismissed.value = [...qualityDismissed.value, chapter.index];
}

/**
 * 搜索：本章即时、全书流式。命中跳转走同一个 go()，所以定位和进度保存只有一条路。
 * 面板在跳转后自动收起（它会盖住大半个屏幕），底部留一条「上一处 / 下一处」。
 */
const search = useReaderSearch({
  bookId,
  chapterIndex: index,
  chapter: currentChapter,
  onLocate: (chapterIndex, offset) => {
    search.open.value = false;
    void go(chapterIndex, offset);
  },
});

const remainingCharsNow = computed(() => {
  const chapter = currentChapter.value;
  if (!chapter || !chapter.paragraphs.length) return 0;
  return remainingChars(chapter.paragraphs, chapter.starts, progress.charOffset);
});
const remainingMinutesNow = computed(() => readingMinutes(remainingCharsNow.value));
/** 本章已读字符数：与进度保存共用 charOffset，翻页、滚动、换源后都不会另算一套。 */
const readCharsNow = computed(() => {
  const chapter = currentChapter.value;
  if (!chapter) return 0;
  return Math.max(0, Math.min(chapter.length, Math.round(progress.charOffset)));
});
const chapterCharsNow = computed(() => currentChapter.value?.length ?? 0);

function sectionEl(i: number): HTMLElement | null {
  return scroller.value?.querySelector<HTMLElement>('[data-chapter="' + i + '"]') ?? null;
}

// 宽屏布局：>=1280 可以把目录钉在正文左边，正文区变窄后双页的门槛也要跟着挪。
const viewportWidth = ref(typeof window === "undefined" ? 1024 : window.innerWidth);
const SIDEBAR_WIDTH = 280;
const canSidebar = computed(() => viewportWidth.value >= 1280);
// 只有一个状态：设置里的「常驻目录」。顶栏按钮和侧栏收起按钮都改它，免得刷新后又冒出来。
const sidebarVisible = computed(() => canSidebar.value && settings.value.desktopCatalog);
const bodyWidth = computed(() => viewportWidth.value - (sidebarVisible.value ? SIDEBAR_WIDTH : 0));
const spreadActive = computed(() => settings.value.spread && settings.value.mode === "page" && bodyWidth.value >= 1024);

// 分页几何全部交给 useReaderPager：它只读 DOM、写 transform，不碰章节数据。
const pager = useReaderPager({
  scroller,
  flow,
  perView: () => (spreadActive.value ? 2 : 1),
  onRelayout: () => onPagerRelayout(),
});

function onResize() {
  const width = window.innerWidth;
  if (width === viewportWidth.value) return;
  viewportWidth.value = width;
}

const ttsCaps = ref<TtsCapabilities | null>(null);
const ttsEnabled = computed(() => ttsCaps.value?.enabled === true);
/** 服务端音色优先；没配服务端时列出浏览器装了的语音，用户至少能挑一个。 */
const ttsVoices = computed<Array<{ value: string; label: string }>>(() => {
  const caps = ttsCaps.value;
  if (caps?.enabled && caps.voices.length) return caps.voices.map((voice) => ({ value: voice, label: voice }));
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return systemVoices()
    .filter((voice) => voice.lang?.toLowerCase().startsWith("zh"))
    .map((voice) => ({ value: voice.name, label: voice.name }));
});

/** 朗读念到下一屏时换页；滚动模式返回 false，交给默认的 scrollIntoView。 */
function revealRange(range: Range): boolean {
  if (settings.value.mode !== "page") return false;
  const flowEl = flow.value;
  if (!flowEl) return false;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[0] : range.getBoundingClientRect();
  const target = pager.pageOfLeft(rect.left - flowEl.getBoundingClientRect().left);
  if (target !== pager.page.value) pager.goTo(target, false);
  return true;
}

const speech = useReaderSpeech({
  index,
  total,
  currentChapter,
  scroller,
  settings: () => ({ engine: settings.value.ttsEngine, voice: settings.value.ttsVoice, rate: settings.value.ttsRate }),
  httpEnabled: () => ttsEnabled.value,
  go,
  sectionEl,
  reveal: revealRange,
});
const speaking = speech.speaking;
const speechPaused = speech.paused;
const stopSpeak = speech.stop;
const pauseSpeak = speech.pause;
const resumeSpeak = speech.resume;

/**
 * 一个按钮三种状态：没读→开始；读着→暂停；暂停→继续。
 * 停止放在朗读条上，避免「再点一下到底是暂停还是退出」这种猜谜。
 */
function onSpeechButton(): void {
  if (!speaking.value) speech.start();
  else if (speechPaused.value) speech.resume();
  else speech.pause();
}

const autoScroll = useReaderAutoScroll({
  scroller,
  index,
  total,
  speed: () => settings.value.autoSpeed,
  mode: () => settings.value.mode,
  go,
  onStart: () => scheduleAutoHide(),
});
/** 分页模式的自动翻页：停留时间按屏高与速度换算，与滚动模式共用一个速度设置。 */
const autoTurn = useReaderAutoTurn({
  mode: () => settings.value.mode,
  dwell: () => pageDwellMs(scroller.value?.clientHeight ?? 0, settings.value.autoSpeed),
  turn: () => turnPageForAuto(),
  onStart: () => scheduleAutoHide(),
});
const autoPlaying = computed(() => autoScroll.autoPlaying.value || autoTurn.autoPlaying.value);

/**
 * 阅读时不让屏幕睡过去：手动阅读看设置，自动翻页与朗读期间始终持有。
 * 浏览器切到后台会自己释放锁，所以每次可见性变化都重新同步一次。
 */
const fonts = useReaderFonts();

const wakeLock = useScreenWakeLock(() =>
  wakelockWanted({
    keepAwake: settings.value.keepAwake,
    autoPlaying: autoPlaying.value,
    speaking: speaking.value,
    visible: document.visibilityState === "visible",
  }),
);
watch([autoPlaying, speaking, () => settings.value.keepAwake], () => wakeLock.sync());
const startAutoScroll = autoScroll.start;
/** 两种模式只有一个在跑，停的时候一起停，免得切模式后还在后台翻页。 */
function stopAutoScroll(): void {
  autoScroll.stop();
  autoTurn.stop();
}
const pauseAutoScroll = autoScroll.pause;

function startAutoReading(): void {
  if (settings.value.mode === "page") autoTurn.start();
  else startAutoScroll();
}

/** 边缘上下滑：左边调亮度、右边调字号；只在分页模式接管，滚动模式的竖向拖动要留给滚动。 */
const adjustState = reactive({ kind: null as AdjustKind | null, value: 0, base: 0 });
const adjustVisible = ref(false);
let adjustTimer = 0;
/** 拖动期间锁住起点：每一步都按同一个字符锚点重排，否则会被上一页的锚点一路带回去。 */
let adjustAnchor: { chapter: number; charOffset: number } | null = null;

const ADJUST_RANGES: Record<AdjustKind, { min: number; max: number; span: number }> = {
  brightness: { min: 0, max: 100, span: 100 },
  font: { min: 12, max: 36, span: 24 },
};

function onAdjustStart(kind: AdjustKind): void {
  if (autoPlaying.value) stopAutoScroll();
  adjustState.kind = kind;
  adjustState.base = kind === "brightness" ? settings.value.dim : settings.value.fontSize;
  adjustState.value = adjustState.base;
  adjustAnchor = { chapter: index.value, charOffset: progress.charOffset };
  adjustVisible.value = true;
  window.clearTimeout(adjustTimer);
}

/** 拖动中只改 CSS 变量；字号要重排，所以按整数步提交，松手时再统一保存。 */
function onAdjustMove(dy: number): void {
  const kind = adjustState.kind;
  if (!kind) return;
  const range = ADJUST_RANGES[kind];
  const height = scroller.value?.clientHeight || window.innerHeight;
  const next = Math.round(applyAdjust(adjustState.base, dy, height, range.span, range.min, range.max));
  if (next === adjustState.value) return;
  adjustState.value = next;
  if (kind === "brightness") {
    settings.value = { ...settings.value, dim: next };
    return;
  }
  settings.value = { ...settings.value, fontSize: next };
  void nextTick(() => {
    if (settings.value.mode !== "page" || !adjustAnchor) return;
    measurePager();
    locatePage(adjustAnchor.chapter, adjustAnchor.charOffset);
  });
}

function onAdjustEnd(): void {
  const kind = adjustState.kind;
  if (!kind) return;
  const value = adjustState.value;
  const anchor = adjustAnchor;
  adjustState.kind = null;
  adjustAnchor = null;
  window.clearTimeout(adjustTimer);
  adjustTimer = window.setTimeout(() => {
    adjustVisible.value = false;
  }, 900);
  void patchSettings(kind === "brightness" ? { dim: value } : { fontSize: value }, anchor ?? undefined);
}

/** 睡眠定时：只活在当前会话（刷新即失效），到点把朗读与自动阅读一起停掉。 */
const sleepMinutes = ref(0);
const sleepLeft = ref(0);
const sleepEndsAt = ref(0);
let sleepTimer = 0;

function clearSleepTimer(): void {
  if (sleepTimer) {
    window.clearInterval(sleepTimer);
    sleepTimer = 0;
  }
}

/** 到点：先停朗读再停自动阅读，最后把状态清干净，免得设置面板一直亮着上一档。 */
function finishSleep(): void {
  clearSleepTimer();
  sleepEndsAt.value = 0;
  sleepLeft.value = 0;
  sleepMinutes.value = 0;
  if (speaking.value) stopSpeak();
  if (autoPlaying.value) stopAutoScroll();
  toast("睡眠定时已到，已停止朗读与自动阅读");
}

function tickSleep(): void {
  sleepLeft.value = sleepLeftOf(sleepEndsAt.value);
  if (sleepLeft.value <= 0) finishSleep();
}

function setSleep(minutes: number): void {
  clearSleepTimer();
  sleepMinutes.value = minutes;
  if (minutes <= 0) {
    sleepEndsAt.value = 0;
    sleepLeft.value = 0;
    toast("已关闭睡眠定时");
    return;
  }
  sleepEndsAt.value = sleepEndsAtOf(minutes);
  sleepLeft.value = sleepLeftOf(sleepEndsAt.value);
  sleepTimer = window.setInterval(tickSleep, 1000);
  toast("将在 " + minutes + " 分钟后停止朗读与自动阅读");
}

const activity = useReadingActivity({ bookId, index, saveProgress: () => saveNow(true) });

const gestures = useReaderGestures({
  target: scroller,
  tapGrid: () => settings.value.tapGrid,
  swipeTurn: () => settings.value.swipeTurn,
  onTap: (action, target) => onTap(action, target),
  onSwipe: (direction) => {
    if (autoPlaying.value) {
      stopAutoScroll();
      return;
    }
    flip(direction);
  },
  onGestureStart: () => {
    if (autoPlaying.value) stopAutoScroll();
  },
  adjustEnabled: () => settings.value.mode === "page" && settings.value.edgeAdjust,
  onAdjustStart: (kind) => onAdjustStart(kind),
  onAdjustMove: (dy) => onAdjustMove(dy),
  onAdjustEnd: () => onAdjustEnd(),
});

function captureAnchor() {
  const el = scroller.value;
  const section = sectionEl(index.value);
  if (!el || !section) return null;
  return {
    index: index.value,
    top: section.offsetTop - el.scrollTop,
    scrollTop: el.scrollTop,
  };
}

function restoreAnchor(anchor: ReturnType<typeof captureAnchor>) {
  const el = scroller.value;
  if (!el || !anchor) return;
  if (Math.abs(el.scrollTop - anchor.scrollTop) > 240) return;
  const section = sectionEl(anchor.index);
  if (!section) return;
  el.scrollTop = section.offsetTop - anchor.top;
}

async function loadChapter(i: number, force = false): Promise<void> {
  if (i < 0 || (total.value > 0 && i >= total.value)) return;
  // 当前章已经明确要登录时，预取前后章只会换来一串相同的 401。
  if (i !== index.value && loginBlocked.value) return;
  const existing = chapters.get(i);
  if (existing && !force && !existing.loading && !existing.error) return;
  const running = inflight.get(i);
  if (running) return running;

  if (!existing) {
    chapters.set(i, { index: i, title: "", paragraphs: [], starts: [], blocks: [], length: 0, images: [], loading: true, error: "" });
  }
  const chapter = chapters.get(i)!;
  chapter.loading = true;
  chapter.error = "";
  if (force) {
    chapter.paragraphs = [];
    chapter.starts = [];
    chapter.blocks = [];
    chapter.length = 0;
    chapter.images = [];
    chapter.quality = null;
    qualityDismissed.value = qualityDismissed.value.filter((item) => item !== i);
  }

  const task = (async () => {
    const anchor = captureAnchor();
    try {
      const data = await api.content(bookId, i);
      if (data.total && data.total !== total.value) total.value = data.total;
      const paragraphs = splitParagraphs(data.content);
      const target = chapters.get(i);
      if (!target) return;
      target.title = data.chapter?.title || target.title || "第 " + (i + 1) + " 章";
      target.paragraphs = paragraphs;
      target.starts = buildStarts(paragraphs);
      target.length = chapterLength(paragraphs, target.starts);
      target.images = data.images ?? [];
      target.quality = data.quality ?? null;
      const imageAfter = new Set(target.images.map((img) => img.after));
      target.blocks = buildDisplayBlocks(
        paragraphs,
        target.starts,
        target.title,
        settings.value.paragraph,
        imageAfter,
        resolveParagraphFixes(paragraphFixes.value, i, target.title, paragraphs),
      );
      target.loading = false;
      target.error = paragraphs.length ? "" : "本章没有取到正文，可能是书源失效或章节需要登录。";
      if (i === index.value && paragraphs.length) markRead(i);
      if (data.autoSwitch?.switched) {
        const auto = data.autoSwitch;
        const toName = auto.toSourceName ?? "其它书源";
        const message = "当前书源正文不全，已自动切换到「" + toName + "」";
        showSwitchNotice(message, auto.reanchor ?? null, Boolean(auto.canUndo && auto.historyId), true);
        if (!auto.historyId || !announcedAutoSwitch.has(auto.historyId)) {
          if (auto.historyId) announcedAutoSwitch.add(auto.historyId);
          toast(message);
        }
        // 服务端已经把这本切到新源了，但当前页的详情还是换源前的快照：
        // 不更新的话，换源面板会把旧源标成「当前源」，撤销按钮也会指错来源。
        if (book.value) {
          if (auto.historyId) {
            book.value.lastSwitch = {
              id: auto.historyId,
              kind: "auto",
              sourceId: auto.fromSourceId ?? null,
              sourceName: auto.fromSourceName ?? "原来源",
              chapters: auto.chaptersBefore ?? 0,
              chapterIndex: i,
              chapterTitle: target.title,
              createdAt: new Date().toISOString(),
            };
          }
          if (auto.toSourceId) book.value.book.sourceId = auto.toSourceId;
          if (auto.toSourceName) book.value.book.originName = auto.toSourceName;
          if (book.value.source) book.value.source.name = toName;
        }
      }
      await nextTick();
      if (settings.value.mode === "page") {
        // 新章节改变列数：不重新按字符锚点定位，正在读的那一行会整体位移。
        // 但跳章途中布局是残缺的（同窗口其它章还没到），此时定位会算错列，
        // 交给 go() 在 ensureWindow 之后统一收尾。
        if (!jumping) {
          measurePager();
          locatePage(index.value, progress.charOffset);
        }
      } else if (i === index.value) {
        if (!restored.value) await restorePosition();
        updateProgress();
      } else if (i < index.value) {
        restoreAnchor(anchor);
      }
    } catch (error) {
      const target = chapters.get(i);
      if (target) {
        target.loading = false;
        target.quality = null;
        target.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      inflight.delete(i);
    }
  })();
  inflight.set(i, task);
  return task;
}

/** 滚动模式：把视口移到 charOffset 所在段落（字符锚点不受字号/行距影响）。
 *
 * 刻意不用像素 offset 兜底：字号、行距、窗口宽度一变，旧像素值就指向别的地方。
 * 实测「chapter_index=39 + 上一版布局的 offset=32050」会把读者直接送到第 42 章。
 */
function blockElAt(section: HTMLElement, chapter: LoadedChapter, offset: number): HTMLElement | null {
  const block = chapter.blocks[blockIndexAt(chapter.blocks, offset)];
  if (!block) return null;
  return section.querySelector<HTMLElement>('[data-block="' + blockIndexAt(chapter.blocks, offset) + '"]');
}

/** 块内精确到行的 Range；取不到时退回块本身。 */
function rangeAtBlock(section: HTMLElement, chapter: LoadedChapter, offset: number): { block: HTMLElement; range: Range | null } | null {
  const block = blockElAt(section, chapter, offset);
  if (!block) return null;
  const start = Number(block.dataset.start) || 0;
  const end = Number(block.dataset.end) || start;
  const at = Math.max(start, Math.min(offset, Math.max(start, end - 1)));
  return { block, range: rangeAtOffset(block, at, Math.min(end, at + 1)) };
}

function locateScroll(chapterIndex: number, charOffset: number) {
  const el = scroller.value;
  const chapter = chapters.get(chapterIndex);
  const section = sectionEl(chapterIndex);
  if (!el || !chapter || !section || !chapter.blocks.length) return;
  const hit = charOffset > 0 ? rangeAtBlock(section, chapter, charOffset) : null;
  let top = 0;
  if (hit) {
    const blockRect = hit.block.getBoundingClientRect();
    const rangeRect = hit.range?.getBoundingClientRect();
    const delta = rangeRect ? Math.max(0, rangeRect.top - blockRect.top) : 0;
    top = hit.block.offsetTop + delta;
  }
  el.scrollTop = Math.max(0, section.offsetTop + Math.max(0, top - 8) - 12);
  updateProgress();
}

function measurePager() {
  if (settings.value.mode !== "page") return;
  // 分页容器靠 transform 平移，自身不该有滚动偏移。overflow: hidden 的元素仍然可以被
  // scrollIntoView 程序化滚动，一旦被推动就会整屏横移半列（看起来像两列并排）。
  const el = scroller.value;
  if (el && (el.scrollLeft || el.scrollTop)) {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  }
  pager.measure();
}

/** 量列位置用的锚点：章节盒在多列布局里可能从上一列末尾的一小截外边距开始，
 * 直接量 section 会差一列，所以用标题（或首段）当锚点。 */
function spanAnchor(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>(".chapter-head") ?? el.querySelector<HTMLElement>("[data-block]") ?? el;
}

function chapterSpanAt(i: number): { start: number; pages: number } | null {
  const section = sectionEl(i);
  if (!section) return null;
  const next = sectionEl(i + 1);
  return pager.spanOf(spanAnchor(section), next ? spanAnchor(next) : null);
}

/** 分页模式：charOffset 落在第几列。 */
function pageForChar(chapterIndex: number, charOffset: number): number {
  const section = sectionEl(chapterIndex);
  const chapter = chapters.get(chapterIndex);
  const span = chapterSpanAt(chapterIndex);
  if (!section || !chapter || !span || !chapter.paragraphs.length) return 0;
  const limit = Math.max(0, chapter.length - 1);
  const offset = Math.min(Math.max(0, charOffset), limit);
  // 章首要落在章标题那一列，而不是第一段所在的列（标题可能单独占一列）。
  if (offset <= 0) return span.start;
  const hit = rangeAtBlock(section, chapter, offset);
  if (!hit) return span.start;
  const flowRect = flow.value?.getBoundingClientRect();
  const rect = hit.range?.getBoundingClientRect() ?? hit.block.getBoundingClientRect();
  const left = flowRect ? rect.left - flowRect.left : 0;
  return Math.min(span.start + span.pages - 1, Math.max(span.start, pager.pageOfLeft(left)));
}

function locatePage(chapterIndex: number, charOffset: number) {
  if (settings.value.mode !== "page") return;
  measurePager();
  pager.goTo(pageForChar(chapterIndex, charOffset), false);
  updatePageLabel();
  // 定位成功后立刻把字符锚点写回进度：后台补章（loadChapter）和 relayout 都要靠它
  // 重新算列，如果留着上一页的旧锚点，读者会被弹到别的页。
  const chapter = chapters.get(chapterIndex);
  if (chapter && chapterIndex === index.value) applyCharOffset(chapter, charOffset);
}

function updatePageLabel() {
  const span = chapterSpanAt(index.value);
  if (!span) {
    pageNo.value = 1;
    pageCount.value = Math.max(1, pager.pages.value);
    return;
  }
  pageCount.value = span.pages;
  pageNo.value = Math.min(span.pages, Math.max(1, pager.page.value - span.start + 1));
}

/** 当前页左上角第一个字符：它是这一页的字符锚点，精确到行而不是段首。 */
function firstOffsetOnPage(section: HTMLElement, chapter: LoadedChapter): number {
  const flowRect = flow.value?.getBoundingClientRect();
  if (!flowRect) return chapter.blocks[0]?.start ?? 0;
  // 一屏可能是两列（双页），所以左边界要乘 perView。
  const pageLeft = pager.page.value * pager.metrics.value.perView * pager.metrics.value.stride;
  const min = chapter.blocks[0]?.start ?? 0;
  const max = chapter.blocks[chapter.blocks.length - 1]?.end ?? min;
  const scrollerRect = scroller.value?.getBoundingClientRect();
  if (scrollerRect && flow.value) {
    const probe = offsetFromPoint(flowRect.left + pageLeft + 4, scrollerRect.top + 12, flow.value);
    if (probe !== null && probe >= min && probe <= max) return probe;
  }
  const blocks = section.querySelectorAll<HTMLElement>("[data-block]");
  let start = min;
  for (let i = 0; i < blocks.length; i += 1) {
    const rect = blocks[i].getBoundingClientRect();
    if (rect.right - flowRect.left > pageLeft + 1) {
      start = Number(blocks[i].dataset.start) || 0;
      break;
    }
    start = Number(blocks[i].dataset.start) || start;
  }
  return start;
}

function pageInfo(): { chapter: number; offset: number } | null {
  let best: { chapter: number; start: number } | null = null;
  for (const i of visible.value) {
    const span = chapterSpanAt(i);
    if (!span) continue;
    if (span.start <= pager.page.value && (!best || span.start >= best.start)) best = { chapter: i, start: span.start };
  }
  if (!best) return null;
  const section = sectionEl(best.chapter);
  const chapter = chapters.get(best.chapter);
  if (!section || !chapter) return null;
  return { chapter: best.chapter, offset: firstOffsetOnPage(section, chapter) };
}

/** 翻过章界后：同步 index / 进度 / 预取，窗口不够就提前补章。 */
function syncPageState() {
  if (settings.value.mode !== "page" || jumping) return;
  const info = pageInfo();
  if (!info) return;
  const chapter = chapters.get(info.chapter);
  const changed = info.chapter !== index.value;
  if (changed) {
    index.value = info.chapter;
    history.replaceState(history.state, "", "/read/" + bookId + "/" + info.chapter);
    void loadChapter(index.value + 1);
    void loadChapter(index.value - 1);
  }
  if (chapter) applyCharOffset(chapter, info.offset);
  updatePageLabel();
  scheduleSave();
  if (!changed) return;
  if (index.value >= windowEnd.value - 1) void extendDown();
  else if (index.value <= windowStart.value + 1) void extendUp();
}

let pagerSyncing = false;
function onPagerRelayout() {
  if (pagerSyncing || !ready.value || settings.value.mode !== "page") return;
  pagerSyncing = true;
  try {
    locatePage(index.value, progress.charOffset);
    updatePageLabel();
  } finally {
    pagerSyncing = false;
  }
}

/** 点正文插图看大图；查看器自己处理缩放与关闭，这里只管开关。 */
const viewerSrc = ref("");

function openImageViewer(src: string): void {
  if (!src) return;
  viewerSrc.value = src;
  if (autoPlaying.value) stopAutoScroll();
}

function closeImageViewer(): void {
  viewerSrc.value = "";
}

let imageTimer = 0;
/**
 * 插图是异步解码的：加载完会改变列高，分页必须重新量一遍。
 * 用字符锚点重新定位，读者当前那一行不会因为图片变高而跳走。
 */
function onChapterImage(): void {
  if (settings.value.mode !== "page" || !restored.value) return;
  window.clearTimeout(imageTimer);
  imageTimer = window.setTimeout(() => {
    if (settings.value.mode !== "page" || jumping) return;
    locatePage(index.value, progress.charOffset);
    updatePageLabel();
  }, 200);
}

async function restorePosition() {
  const chapter = chapters.get(index.value);
  if (!scroller.value || !chapter || !chapter.paragraphs.length) return;
  const saved = book.value?.progress;
  let charOffset = 0;
  // 换源整页重载后，优先回到换源前的那一句；服务端进度这时已经被清零。
  // 本标签页先用 sessionStorage（换源瞬间最准），其它设备再用服务端锚点。
  const localAnchor = loadSwitchAnchor(String(bookId));
  let switchAnchor = localAnchor && localAnchor.chapterIndex === index.value ? localAnchor : null;
  if (localAnchor && !switchAnchor) clearSwitchAnchor(String(bookId));
  if (!switchAnchor) {
    const remote = book.value?.switchAnchor;
    const untouched = !saved || saved.chapterIndex !== index.value || (!saved.charOffset && !saved.chapterPercent);
    // 只在进度还停在章首时用服务端锚点：否则读者已经在新源里读过一段，不能被旧位置拽回去。
    if (remote && remote.chapterIndex === index.value && untouched) {
      switchAnchor = fromServerSwitchAnchor(String(bookId), remote);
    }
  }
  let usedAnchor = false;
  if (switchAnchor) {
    if (localAnchor) clearSwitchAnchor(String(bookId));
    const hit = resolveSwitchAnchor(chapterText(chapter.paragraphs), switchAnchor);
    charOffset = hit.offset;
    usedAnchor = true;
    toast(hit.matched ? "已回到换源前的段落" : "新源正文差异较大，已按比例定位");
  }
  if (!usedAnchor && saved && saved.chapterIndex === index.value) {
    charOffset = saved.charOffset || 0;
    if (!charOffset && saved.chapterPercent > 0) {
      charOffset = Math.round(saved.chapterPercent * chapter.length);
    }
  }
  if (settings.value.mode === "page") {
    locatePage(index.value, charOffset);
  } else {
    locateScroll(index.value, charOffset);
  }
  restored.value = true;
}

function updateProgress() {
  if (settings.value.mode === "page") {
    syncPageState();
    return;
  }
  const el = scroller.value;
  const chapter = chapters.get(index.value);
  const section = sectionEl(index.value);
  const flowEl = flow.value;
  if (!el || !chapter || !section || !flowEl || !chapter.blocks.length) return;
  const offset = firstVisibleOffset(chapter.blocks, section, flowEl, el);
  pageCount.value = Math.max(1, Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)));
  pageNo.value = Math.min(pageCount.value, Math.floor(el.scrollTop / Math.max(1, el.clientHeight)) + 1);
  applyCharOffset(chapter, Math.max(0, Math.min(chapter.length - 1, offset)));
}

function applyCharOffset(chapter: LoadedChapter, charOffset: number) {
  progress.charOffset = charOffset;
  progress.chapterPercent = chapter.length ? clamp01(charOffset / chapter.length) : 0;
  progress.percent = bookPercent(index.value, progress.chapterPercent, total.value);
}

function detectCurrent() {
  const el = scroller.value;
  if (!el) return;
  const probe = el.scrollTop + Math.min(120, el.clientHeight * 0.25);
  let found = index.value;
  for (const idx of visible.value) {
    const section = sectionEl(idx);
    if (!section) continue;
    if (section.offsetTop <= probe && section.offsetTop + section.offsetHeight > probe) {
      found = idx;
      break;
    }
  }
  if (found !== index.value) {
    index.value = found;
    history.replaceState(history.state, "", "/read/" + bookId + "/" + found);
    void loadChapter(found + 1);
    void loadChapter(found - 1);
    trimWindow(found);
  }
}

function trimWindow(center: number) {
  if (windowEnd.value - windowStart.value <= 4) return;
  const anchor = captureAnchor();
  const charAnchor = { chapter: index.value, charOffset: progress.charOffset };
  windowStart.value = Math.max(0, center - 2);
  windowEnd.value = Math.min(Math.max(0, total.value - 1), center + 2);
  void nextTick().then(() => {
    if (settings.value.mode === "page") {
      measurePager();
      locatePage(charAnchor.chapter, charAnchor.charOffset);
    } else {
      restoreAnchor(anchor);
    }
  });
}

let extending = false;
let jumping = false;
/** 跳章后必须把整个窗口补齐：只加载 ±1 会留下空洞，滚动到空洞处就「跳章」了。 */
async function ensureWindow(center: number) {
  windowStart.value = Math.max(0, center - 2);
  windowEnd.value = Math.min(Math.max(0, total.value - 1), center + 2);
  const wanted: number[] = [];
  for (let i = windowStart.value; i <= windowEnd.value; i += 1) {
    if (!chapters.has(i)) wanted.push(i);
  }
  await Promise.all(wanted.map((i) => loadChapter(i)));
}

async function extendUp() {
  if (extending || jumping || windowStart.value <= 0) return;
  if (chapters.get(windowStart.value)?.loading) return;
  extending = true;
  const anchor = captureAnchor();
  const charAnchor = { chapter: index.value, charOffset: progress.charOffset };
  windowStart.value -= 1;
  await loadChapter(windowStart.value);
  await nextTick();
  if (settings.value.mode === "page") {
    measurePager();
    locatePage(charAnchor.chapter, charAnchor.charOffset);
  } else {
    restoreAnchor(anchor);
  }
  extending = false;
}

async function extendDown() {
  if (extending || jumping || windowEnd.value >= total.value - 1) return;
  if (chapters.get(windowEnd.value)?.loading) return;
  extending = true;
  windowEnd.value += 1;
  await loadChapter(windowEnd.value);
  await nextTick();
  if (settings.value.mode === "page") {
    measurePager();
    updatePageLabel();
  }
  extending = false;
}

let scrollRaf = 0;
let lastScrollTop = 0;

/** 滚动方向决定沉浸感：往下读时收起工具栏，往回翻时立刻还回来。 */
function trackScrollDirection(top: number) {
  const delta = top - lastScrollTop;
  lastScrollTop = top;
  if (Math.abs(delta) < 8 || overlayOpen()) return;
  if (delta > 0 && top > 64) {
    chromeVisible.value = false;
    window.clearTimeout(hideTimer);
  } else if (delta < 0) {
    chromeVisible.value = true;
    scheduleAutoHide();
  }
}

function onScroll() {
  if (markPopover.value) closeMarkPopover();
  if (settings.value.mode === "page" || jumping) return;
  if (scroller.value) trackScrollDirection(scroller.value.scrollTop);
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    detectCurrent();
    updateProgress();
    const el = scroller.value;
    if (el) {
      stickyVisible.value = el.scrollTop > 140;
      if (el.scrollTop < 500) void extendUp();
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 900) void extendDown();
    }
    scheduleSave();
  });
}

let saveTimer: number | undefined;
let hideTimer: number | undefined;
let settingsTimer: number | undefined;
let fadeTimer: number | undefined;
let previousBodyOverflow = "";
/** 换源成功、正在跳走：这一页的进度不再代表这本书。 */
let leaving = false;

function scheduleSave(immediate = false) {
  if (immediate) {
    void saveNow();
    return;
  }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), 800);
}

async function saveNow(keepalive = false) {
  if (!bookId || !total.value || leaving) return;
  const payload = {
    chapterIndex: index.value,
    offset: Math.round(scroller.value?.scrollTop ?? 0),
    charOffset: progress.charOffset,
    chapterPercent: progress.chapterPercent,
    percent: progress.percent,
  };
  try {
    // 离线时先落队列：pagehide 那条 keepalive 请求在断网时只会静默失败，位置就白丢了。
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      sync.push({ id: newOpId("progress"), kind: "progress", bookId, at: Date.now(), ...payload });
      return;
    }
    if (keepalive && typeof fetch === "function") {
      await fetch("/api/books/" + bookId + "/progress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } else {
      await api.saveProgress(bookId, payload);
    }
  } catch (error) {
    // 进度不能因为断网就丢：这是「地铁上读了 20 分钟」最容易消失的东西。
    if (isNetworkError(error)) {
      sync.push({ id: newOpId("progress"), kind: "progress", bookId, at: Date.now(), ...payload });
    }
  }
}

async function go(next: number, charOffset = 0, options: { keepSpeech?: boolean } = {}) {
  if (next < 0) {
    toast("已经是第一章");
    return;
  }
  if (total.value && next >= total.value) {
    toast("已经是最后一章");
    return;
  }
  if (!options.keepSpeech) stopSpeak();
  restored.value = true;
  jumping = true;
  try {
    index.value = next;
    // 主动跳章要立刻改地址栏：滚动/翻页的被动探测要等下一次 scroll 事件才同步。
    history.replaceState(history.state, "", "/read/" + bookId + "/" + next);
    // 跳章从章首（或指定字符）开始：先归零字符锚点，loadChapter 的分页分支才不会用旧锚点定位。
    progress.charOffset = charOffset;
    progress.chapterPercent = 0;
    progress.percent = bookPercent(next, 0, total.value);
    await ensureWindow(next);
    await nextTick();
    if (settings.value.mode === "page") {
      measurePager();
      locatePage(next, charOffset);
    } else {
      if (scroller.value && chapters.get(next)) locateScroll(next, Math.min(charOffset, Math.max(0, (chapters.get(next)?.length ?? 1) - 1)));
    }
    void router.replace("/read/" + bookId + "/" + next);
    scheduleSave(true);
  } finally {
    jumping = false;
  }
}

/** 目录里点当前章：不重新打开本章（那会把读者送回章首），只收起目录并轻闪当前段。
 *
 * 不调用 locateScroll：打开目录会让正文栏宽变化，字符锚点重排后回跳会产生几十像素漂移；
 * 读者本来就在这一页，闪一下当前块比「精确但抖动」更符合预期。
 */
function returnToReading(): void {
  showCatalog.value = false;
  const chapter = chapters.get(index.value);
  const section = sectionEl(index.value);
  if (!chapter || !section) return;
  const block = blockElAt(section, chapter, progress.charOffset);
  if (!block) return;
  block.classList.add("is-located");
  window.setTimeout(() => block.classList.remove("is-located"), 1500);
}

/** 翻页动画：none 直接跳，slide 走 CSS transform 过渡，fade 用短动画遮住跳变。 */
function turnTo(target: number) {
  const animation = settings.value.pageAnimation;
  const el = flow.value;
  if (animation === "fade" && el && !reducedMotion()) {
    pager.goTo(target, false);
    el.classList.remove("fade-turn");
    void el.offsetWidth;
    el.classList.add("fade-turn");
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => el.classList.remove("fade-turn"), 220);
  } else {
    pager.goTo(target, animation === "slide" && !reducedMotion());
  }
  syncPageState();
}

function flip(direction: 1 | -1) {
  if (settings.value.mode === "page") {
    const target = pager.page.value + direction;
    if (target < 0) {
      void go(index.value - 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    if (target >= pager.pages.value) {
      void go(index.value + 1);
      return;
    }
    turnTo(target);
    autoTurn.nudge();
    return;
  }
  const el = scroller.value;
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight;
  if (direction > 0 && el.scrollTop >= max - 8) {
    void go(index.value + 1);
    return;
  }
  if (direction < 0 && el.scrollTop <= 4) {
    void go(index.value - 1);
    return;
  }
  el.scrollBy({ top: direction * Math.max(120, el.clientHeight - 32), behavior: "smooth" });
}

/** 自动翻页的一步：正常翻页，末页换章，全书末尾返回 false（由调用方停掉计时器）。 */
function turnPageForAuto(): boolean {
  // 刚跨章、正文还在路上：这一拍先不动，否则会在空文档上再翻一次直接跳章。
  if (chapters.get(index.value)?.loading) return true;
  if (index.value >= total.value - 1 && pager.page.value >= pager.pages.value - 1) {
    toast("已经读到最后一章");
    return false;
  }
  flip(1);
  return true;
}

function hasLiveSelection(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim());
}

function onTap(action: TapAction, target?: Element | null) {
  // 长按拖选之后抬手也会触发一次 tap：有选区时先收起选区，绝不翻页。
  if (selection.rect || hasLiveSelection()) {
    cancelSelection();
    return;
  }
  // 段落纠正模式消费点击：点正文改排版，点空白只提示，不翻页。
  if (correctAt(target)) return;
  // 点在划线上先看批注，别顺手翻页；点别处先收起气泡。
  const mark = target?.closest?.(".hl[data-mark]");
  if (mark) {
    openMarkPopover(mark.getAttribute("data-mark") ?? "");
    return;
  }
  if (markPopover.value) {
    closeMarkPopover();
    return;
  }
  if (action === "none") return;
  if (autoPlaying.value) {
    stopAutoScroll();
    toast("已暂停自动阅读");
    return;
  }
  if (action === "prev-page") flip(-1);
  else if (action === "next-page") flip(1);
  else if (action === "prev-chapter") void go(index.value - 1);
  else if (action === "next-chapter") void go(index.value + 1);
  else if (action === "toggle-menu") toggleChrome();
}

function toggleChrome() {
  chromeVisible.value = !chromeVisible.value;
  if (chromeVisible.value) scheduleAutoHide();
  else window.clearTimeout(hideTimer);
}

function overlayOpen(): boolean {
  return (
    showSettings.value ||
    showCatalog.value ||
    showMarks.value ||
    showNotes.value ||
    noteOpen.value ||
    showCard.value ||
    showMore.value ||
    showSwitch.value ||
    showParagraphSheet.value ||
    !!markPopover.value ||
    !!selection.rect ||
    search.open.value
  );
}

function scheduleAutoHide() {
  window.clearTimeout(hideTimer);
  if (!settings.value.autoHide) return;
  hideTimer = window.setTimeout(() => {
    if (!overlayOpen()) chromeVisible.value = false;
  }, 3500);
}

/** 宽屏上「目录」是常驻侧栏，窄屏仍然是抽屉。 */
function toggleCatalog() {
  if (canSidebar.value) {
    void patchSettings({ desktopCatalog: !settings.value.desktopCatalog });
    return;
  }
  openSheet("catalog");
}

function openSheet(name: "settings" | "catalog" | "marks" | "notes") {
  closeMarkPopover();
  // 面板一开就停自动阅读：正文在面板后面自己翻页，读者会以为书跳了。
  if (autoPlaying.value) stopAutoScroll();
  chromeVisible.value = true;
  window.clearTimeout(hideTimer);
  if (name === "settings") showSettings.value = true;
  if (name === "catalog") showCatalog.value = true;
  if (name === "marks") void openMarks();
  if (name === "notes") void openNotes();
}

async function openNotes() {
  await loadAnnotations();
  showNotes.value = true;
}

/** 点划线弹出的小气泡：引文、批注与三个动作。 */
function openMarkPopover(id: string): void {
  const item = annotations.value.find((entry) => entry.id === id);
  if (!item) return;
  const el = document.querySelector<HTMLElement>(".hl[data-mark=\"" + CSS.escape(id) + "\"]");
  const box = el?.getBoundingClientRect();
  if (!box) return;
  if (autoPlaying.value) stopAutoScroll();
  markPopover.value = {
    item,
    rect: { left: box.left, top: box.top, bottom: box.bottom, width: box.width },
  };
}

function closeMarkPopover(): void {
  markPopover.value = null;
}

function editFromPopover(): void {
  const item = markPopover.value?.item;
  closeMarkPopover();
  if (item) openNoteForEdit(item);
}

function copyFromPopover(): void {
  const text = markPopover.value?.item.quote ?? "";
  if (!text) return;
  void navigator.clipboard
    ?.writeText(text)
    .then(() => toast("已复制引文"))
    .catch(() => toast("复制失败", "error"));
}

function removeFromPopover(): void {
  const id = markPopover.value?.item.id;
  closeMarkPopover();
  if (id) void removeAnnotation(id);
}

watch(annotations, (list) => {
  const current = markPopover.value;
  if (!current) return;
  const next = list.find((entry) => entry.id === current.item.id);
  if (!next) markPopover.value = null;
  else markPopover.value = { ...current, item: next };
});

/** 窄屏「更多」里的动作：先收起面板，再做原来的事。 */
function moreAction(action: "auto" | "speech" | "swap" | "search" | "marks" | "notes"): void {
  showMore.value = false;
  if (action === "auto") void toggleAutoScroll();
  else if (action === "speech") onSpeechButton();
  else if (action === "swap") showSwitch.value = true;
  else if (action === "search") search.openSearch();
  else if (action === "marks") openSheet("marks");
  else void openNotes();
}

/** 从设置页进入纠正模式：点正文段落即可改，不抢划线/翻页。 */
function startCorrecting(): void {
  showSettings.value = false;
  correcting.value = true;
  chromeVisible.value = true;
  scheduleAutoHide();
}

function stopCorrecting(): void {
  correcting.value = false;
  showParagraphSheet.value = false;
  correctTarget.value = null;
}

/** onTap 把点击目标交进来：只有段落纠正模式才消费这次点击，其余照旧翻页。 */
function correctAt(target?: Element | null): boolean {
  if (!correcting.value) return false;
  const paraEl = target?.closest?.(".para[data-para]") as HTMLElement | null;
  if (!paraEl) {
    toast("点正文段落来纠正");
    return true;
  }
  const section = paraEl.closest("[data-chapter]") as HTMLElement | null;
  const chapterIndex = Number(section?.getAttribute("data-chapter") ?? index.value);
  const chapter = chapters.get(chapterIndex);
  const para = Number(paraEl.getAttribute("data-para"));
  const text = chapter?.paragraphs[para] ?? "";
  if (!chapter || !Number.isInteger(para) || !text.trim()) return true;
  const override = resolveParagraphFixes(paragraphFixes.value, chapter.index, chapter.title, chapter.paragraphs)[para] ?? null;
  correctTarget.value = {
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    para,
    text,
    current: override,
  };
  showParagraphSheet.value = true;
  return true;
}

function applyParagraphFix(kind: ParagraphFixKind | null): void {
  const target = correctTarget.value;
  if (!target) return;
  if (kind === null) {
    paragraphFixes.value = removeParagraphFix(bookId, target.chapterIndex, target.text, target.para);
  } else {
    paragraphFixes.value = saveParagraphFix(bookId, {
      chapterIndex: target.chapterIndex,
      chapterTitle: target.chapterTitle,
      text: target.text,
      kind,
      para: target.para,
    });
  }
  rebuildBlocks();
  showParagraphSheet.value = false;
  correctTarget.value = null;
}

/** 分段方式变化后重建所有已加载章节的展示块；paragraphs/starts 坐标不动，进度不用换算。 */
function rebuildBlocks(): void {
  for (const chapter of chapters.values()) {
    if (!chapter.paragraphs.length) continue;
    const imageAfter = new Set(chapter.images.map((img) => img.after));
    chapter.blocks = buildDisplayBlocks(
      chapter.paragraphs,
      chapter.starts,
      chapter.title,
      settings.value.paragraph,
      imageAfter,
      resolveParagraphFixes(paragraphFixes.value, chapter.index, chapter.title, chapter.paragraphs),
    );
  }
}

async function patchSettings(patch: Partial<ReaderSettings>, anchorOverride?: { chapter: number; charOffset: number }) {
  const modeChanged = Boolean(patch.mode) && patch.mode !== settings.value.mode;
  if (patch.autoScroll === false || modeChanged) stopAutoScroll();
  const anchor = anchorOverride ?? { chapter: index.value, charOffset: progress.charOffset };
  const beforeParagraph = JSON.stringify(settings.value.paragraph);
  // 只有「本书」作用域里的纯排版改动才写覆盖；主题、翻页、朗读等永远回全局。
  const bookScoped = settingScope.value === "book" && isBookTypographyPatch(patch);
  if (bookScoped) {
    const nextOverride = { ...bookOverride.value, ...pickBookTypography(patch) };
    bookOverride.value = nextOverride;
    saveBookTypography(bookId, nextOverride);
    settings.value = applyBookTypography(baseSettings.value, nextOverride);
  } else {
    baseSettings.value = normalizeReaderSettings({ ...baseSettings.value, ...patch });
    saveReaderSettings(baseSettings.value);
    settings.value = applyBookTypography(baseSettings.value, bookOverride.value);
  }
  if (JSON.stringify(settings.value.paragraph) !== beforeParagraph) rebuildBlocks();
  await nextTick();
  if (settings.value.mode === "page") {
    measurePager();
    locatePage(anchor.chapter, anchor.charOffset);
  } else {
    pager.clear();
    locateScroll(anchor.chapter, anchor.charOffset);
  }
  window.clearTimeout(settingsTimer);
  // 本书排版只存本机，不能借全局同步通道把别的书一起改掉。
  if (!bookScoped) {
    settingsTimer = window.setTimeout(() => {
      void api.saveSettings(toServerSettings(baseSettings.value)).catch(() => {});
    }, 800);
  }
  scheduleAutoHide();
  if (patch.autoScroll === true && !autoPlaying.value) startAutoReading();
}

/** 本书「跟随全局」：清掉覆盖并立刻按当前阅读位置重排，不把读者甩回章首。 */
async function resetBookTypography() {
  if (!Object.keys(bookOverride.value).length) {
    settingScope.value = "global";
    return;
  }
  const anchor = { chapter: index.value, charOffset: progress.charOffset };
  const beforeParagraph = JSON.stringify(settings.value.paragraph);
  clearBookTypography(bookId);
  bookOverride.value = {};
  settingScope.value = "global";
  settings.value = applyBookTypography(baseSettings.value, {});
  if (JSON.stringify(settings.value.paragraph) !== beforeParagraph) rebuildBlocks();
  await nextTick();
  if (settings.value.mode === "page") {
    measurePager();
    locatePage(anchor.chapter, anchor.charOffset);
  } else {
    pager.clear();
    locateScroll(anchor.chapter, anchor.charOffset);
  }
  scheduleAutoHide();
  toast("本书已跟随全局排版");
}

function setSettingScope(scope: "global" | "book") {
  if (scope === settingScope.value) return;
  settingScope.value = scope;
}

async function toggleAutoScroll() {
  if (autoPlaying.value) {
    stopAutoScroll();
    await patchSettings({ autoScroll: false });
    return;
  }
  await patchSettings({ autoScroll: true });
}

async function loadCatalog() {
  catalogLoading.value = true;
  try {
    const data = await api.chapters(bookId);
    catalogItems.value = data.items;
    if (data.total) total.value = data.total;
  } catch (error) {
    toast("目录加载失败：" + (error instanceof Error ? error.message : String(error)));
  } finally {
    catalogLoading.value = false;
  }
}

async function loadMarks() {
  try {
    const data = await api.bookmarks(bookId);
    bookmarks.value = data.items;
  } catch {
    /* bookmarks are optional */
  }
}

// 注意别叫 history：这个文件里还有 history.replaceState 用来同步地址栏，重名会把它顶掉。
const positions = ref<ProgressHistoryItem[]>([]);
const positionsLoading = ref(false);

async function loadHistory() {
  positionsLoading.value = true;
  try {
    const data = await api.progressHistory(bookId, 50);
    positions.value = data.items;
  } catch {
    /* history is optional */
  } finally {
    positionsLoading.value = false;
  }
}

async function openMarks() {
  await Promise.all([loadMarks(), loadHistory()]);
  showMarks.value = true;
}

function jumpHistory(item: ProgressHistoryItem) {
  showMarks.value = false;
  void go(item.chapterIndex, item.charOffset || 0);
}

async function clearHistory() {
  try {
    await api.clearProgressHistory(bookId);
    positions.value = [];
    toast("已清空位置历史");
  } catch (error) {
    toast("清空失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

async function addBookmark(options: { atEnd?: boolean; openList?: boolean; chapterIndex?: number } = {}) {
  const chapter = chapters.get(options.chapterIndex ?? index.value) ?? currentChapter.value;
  if (!chapter) return;
  const charOffset = options.atEnd ? chapter.length : progress.charOffset;
  const pi = paragraphAt(chapter.starts, charOffset);
  const payload = {
    chapterIndex: chapter.index,
    title: chapter.title,
    excerpt: (chapter.paragraphs[pi] ?? "").slice(0, 80),
    charOffset,
  };
  try {
    await api.addBookmark(bookId, payload);
    toast("已添加书签");
    await loadMarks();
    if (options.openList !== false) showMarks.value = true;
  } catch (error) {
    if (isNetworkError(error)) {
      sync.push({ id: newOpId("bookmark"), kind: "bookmark-add", bookId, at: Date.now(), ...payload });
      toast("已离线保存书签，联网后自动同步");
      return;
    }
    toast("添加书签失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

async function removeMark(id: number) {
  const target = bookmarks.value.find((item) => item.id === id);
  try {
    await api.removeBookmark(bookId, id);
    await loadMarks();
  } catch (error) {
    if (isNetworkError(error) && target) {
      // 离线时服务端 id 没有意义，按锚点删；和补传时用的是同一套身份。
      sync.push({
        id: newOpId("bookmark"),
        kind: "bookmark-delete",
        bookId,
        at: Date.now(),
        chapterIndex: target.chapterIndex,
        charOffset: target.charOffset,
      });
      bookmarks.value = bookmarks.value.filter((item) => item.id !== id);
      toast("已离线删除，联网后自动同步");
      return;
    }
    toast("删除失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

function jumpMark(mark: BookmarkItem) {
  showMarks.value = false;
  void go(mark.chapterIndex, mark.charOffset || 0);
}

/**
 * 划线落到正文：优先按存下的偏移，偏移处的引文对不上就用上下文重新定位。
 * 章节还没加载时先按原偏移画，加载完成后 computed 会重算。
 */
const marksMap = computed(() => {
  const map = new Map<number, AnnotationRange[]>();
  for (const item of annotations.value) {
    const chapter = chapters.get(item.chapterIndex);
    const hit = chapter ? matchAnnotation(chapterText(chapter.paragraphs), item) : null;
    const range: AnnotationRange = {
      id: item.id,
      start: hit ? hit.start : item.start,
      end: hit ? hit.end : item.end,
      color: item.color,
    };
    const list = map.get(item.chapterIndex);
    if (list) list.push(range);
    else map.set(item.chapterIndex, [range]);
  }
  return map;
});

function marksFor(chapterIndex: number): AnnotationRange[] {
  return marksMap.value.get(chapterIndex) ?? [];
}

async function loadReadChapters(): Promise<void> {
  // 补传队列里的已读先算进来：断网重开时 GET 会失败，但本地明明知道读过哪几章。
  const queued = sync.ops.value
    .filter((op) => op.kind === "read" && op.bookId === bookId)
    .map((op) => (op.kind === "read" ? op.chapterIndex : 0));
  if (queued.length) readChapters.value = new Set([...readChapters.value, ...queued]);
  try {
    const data = await api.readChapters(bookId);
    readChapters.value = new Set([...data.items, ...queued]);
  } catch {
    /* 已读标记拉不到不影响读书 */
  }
}

/** 本地先标上再回传，翻页不必等服务端；失败就留着，下次打开会以服务端为准。 */
function markRead(chapterIndex: number): void {
  if (readChapters.value.has(chapterIndex)) return;
  readChapters.value = new Set(readChapters.value).add(chapterIndex);
  void api.markRead(bookId, chapterIndex).catch((error: unknown) => {
    // 离线读的章也要记住：补传后别的设备上同样是「已读」。
    if (isNetworkError(error)) {
      sync.push({ id: newOpId("read"), kind: "read", bookId, at: Date.now(), chapterIndex });
    }
  });
}

async function loadAnnotations() {
  notesLoading.value = true;
  try {
    const data = await api.annotations(bookId);
    annotations.value = data.items;
  } catch {
    /* 标注是增强功能，拉不到不影响读书 */
  } finally {
    notesLoading.value = false;
  }
}

function partEl(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el ? el.closest<HTMLElement>("[data-start]") : null;
}

/** 选区端点 → 段落内字符偏移（走 Range.toString，天然忽略 mark 之类的行内元素）。 */
function offsetWithin(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

function hideSelection() {
  selection.rect = null;
  selection.quote = "";
}

function readSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
    hideSelection();
    return;
  }
  const range = sel.getRangeAt(0);
  const startPara = partEl(range.startContainer);
  const endPara = partEl(range.endContainer);
  if (!startPara || !endPara) {
    hideSelection();
    return;
  }
  const startSection = startPara.closest<HTMLElement>("[data-chapter]");
  const endSection = endPara.closest<HTMLElement>("[data-chapter]");
  if (!startSection || startSection !== endSection) {
    hideSelection();
    return;
  }
  const chapterIndex = Number(startSection.dataset.chapter ?? -1);
  const chapter = chapters.get(chapterIndex);
  if (!chapter) {
    hideSelection();
    return;
  }
  const a = (Number(startPara.dataset.start) || 0) + offsetWithin(startPara, range.startContainer, range.startOffset);
  const b = (Number(endPara.dataset.start) || 0) + offsetWithin(endPara, range.endContainer, range.endOffset);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (end - start < 1) {
    hideSelection();
    return;
  }
  const rect = range.getBoundingClientRect();
  selection.chapter = chapterIndex;
  selection.start = start;
  selection.end = end;
  selection.quote = chapterText(chapter.paragraphs).slice(start, end);
  selection.rect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function onSelectionChange() {
  window.clearTimeout(selTimer);
  selTimer = window.setTimeout(readSelection, 180);
}

function cancelSelection() {
  hideSelection();
  window.getSelection()?.removeAllRanges();
}

function newAnnotationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 断网时先在本机把划线渲染出来。id 与补传用的 payload 完全一致，
 * 所以联网后 upsert 落到同一行，不会出现「本地一条、云端一条」。
 */
function offlineAnnotation(input: {
  id: string;
  type: "highlight" | "note" | "bookmark";
  chapterIndex: number;
  chapterTitle: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  color: AnnotationColor;
}): AnnotationItem {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  return { ...input, bookId, createdAt: stamp, updatedAt: stamp };
}

/** 划线会改变行内元素数量，分页模式下重新量一次并回到原字符位置。 */
async function relayoutAfterMarks() {
  await nextTick();
  if (settings.value.mode !== "page") return;
  measurePager();
  locatePage(index.value, progress.charOffset);
}

async function createAnnotation(type: "highlight" | "note", color: AnnotationColor, comment: string) {
  const chapter = chapters.get(selection.chapter);
  const text = chapter ? chapterText(chapter.paragraphs) : "";
  const { quote, prefix, suffix } = quoteAround(text, selection.start, selection.end);
  const payload = {
    id: newAnnotationId(),
    type,
    chapterIndex: selection.chapter,
    chapterTitle: chapter?.title ?? "",
    start: selection.start,
    end: selection.end,
    quote,
    prefix,
    suffix,
    comment,
    color,
  };
  try {
    const res = await api.saveAnnotation(bookId, payload);
    annotations.value = [...annotations.value, res.item];
    cancelSelection();
    toast(comment ? "已保存笔记" : "已划线");
    await relayoutAfterMarks();
  } catch (error) {
    if (isNetworkError(error)) {
      annotations.value = [...annotations.value, offlineAnnotation(payload)];
      sync.push({ id: newOpId("annotation"), kind: "annotation", bookId, at: Date.now(), annotation: payload });
      cancelSelection();
      toast("已离线保存，联网后自动同步");
      await relayoutAfterMarks();
      return;
    }
    toast("保存失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

/** 分享书摘：把当前选区交给卡片弹层，然后收起选区工具条。 */
function openShareCard(): void {
  if (!selection.quote.trim()) return;
  cardQuote.value = selection.quote;
  showCard.value = true;
  cancelSelection();
}

function openNoteFromSelection() {
  noteEditing.value = null;
  noteChapter.value = false;
  noteChapterIndex.value = 0;
  noteQuote.value = selection.quote;
  noteColor.value = "yellow";
  noteComment.value = "";
  noteOpen.value = true;
  selection.rect = null;
}

function openNoteForEdit(item: AnnotationItem) {
  noteEditing.value = item;
  noteChapter.value = false;
  noteChapterIndex.value = 0;
  noteQuote.value = item.quote;
  noteColor.value = item.color;
  noteComment.value = item.comment;
  noteOpen.value = true;
  showNotes.value = false;
}

/** 章末写笔记：不要求先选文字，记的是「这一章」而不是某一句。 */
function openChapterNote(chapterIndex = index.value) {
  const chapter = chapters.get(chapterIndex) ?? currentChapter.value;
  if (!chapter) return;
  noteEditing.value = null;
  noteChapter.value = true;
  noteChapterIndex.value = chapter.index;
  noteQuote.value = chapter.title;
  noteColor.value = "yellow";
  noteComment.value = "";
  noteOpen.value = true;
}

async function saveNote(payload: { comment: string; color: AnnotationColor }) {
  noteOpen.value = false;
  const editing = noteEditing.value;
  if (editing) {
    try {
      const res = await api.patchAnnotation(bookId, editing.id, {
        comment: payload.comment,
        color: payload.color,
        type: payload.comment ? "note" : "highlight",
      });
      annotations.value = annotations.value.map((item) => (item.id === res.item.id ? res.item : item));
      toast("已更新");
    } catch (error) {
      if (isNetworkError(error)) {
        const merged = offlineAnnotation({
          id: editing.id,
          type: payload.comment ? "note" : "highlight",
          chapterIndex: editing.chapterIndex,
          chapterTitle: editing.chapterTitle,
          start: editing.start,
          end: editing.end,
          quote: editing.quote,
          prefix: editing.prefix,
          suffix: editing.suffix,
          comment: payload.comment,
          color: payload.color,
        });
        annotations.value = annotations.value.map((item) => (item.id === merged.id ? merged : item));
        sync.push({
          id: newOpId("annotation"),
          kind: "annotation",
          bookId,
          at: Date.now(),
          annotation: {
            id: merged.id,
            type: merged.type,
            chapterIndex: merged.chapterIndex,
            chapterTitle: merged.chapterTitle,
            start: merged.start,
            end: merged.end,
            quote: merged.quote,
            prefix: merged.prefix,
            suffix: merged.suffix,
            comment: merged.comment,
            color: merged.color,
          },
        });
        toast("已离线保存，联网后自动同步");
        return;
      }
      toast("保存失败：" + (error instanceof Error ? error.message : String(error)));
    }
    return;
  }
  if (noteChapter.value) {
    await createChapterNote(payload.comment, payload.color);
    return;
  }
  await createAnnotation(payload.comment ? "note" : "highlight", payload.color, payload.comment);
}

/** 本章笔记：位置落在章末，没有引文，不会在正文里画出零宽高亮。 */
async function createChapterNote(comment: string, color: AnnotationColor) {
  const chapter = chapters.get(noteChapterIndex.value) ?? currentChapter.value;
  if (!chapter) return;
  const payload = {
    id: newAnnotationId(),
    type: "note" as const,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    start: chapter.length,
    end: chapter.length,
    quote: "",
    prefix: "",
    suffix: "",
    comment,
    color,
  };
  try {
    const res = await api.saveAnnotation(bookId, payload);
    annotations.value = [...annotations.value, res.item];
    noteChapter.value = false;
    toast("已保存本章笔记");
  } catch (error) {
    if (isNetworkError(error)) {
      annotations.value = [...annotations.value, offlineAnnotation(payload)];
      sync.push({ id: newOpId("annotation"), kind: "annotation", bookId, at: Date.now(), annotation: payload });
      noteChapter.value = false;
      toast("已离线保存，联网后自动同步");
      return;
    }
    toast("保存失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

async function removeAnnotation(id: string) {
  try {
    await api.removeAnnotation(bookId, id);
    annotations.value = annotations.value.filter((item) => item.id !== id);
    if (noteEditing.value?.id === id) {
      noteOpen.value = false;
      noteEditing.value = null;
    }
    toast("已删除");
    await relayoutAfterMarks();
  } catch (error) {
    if (isNetworkError(error)) {
      sync.push({ id: newOpId("annotation"), kind: "annotation-delete", bookId, at: Date.now(), annotationId: id });
      annotations.value = annotations.value.filter((item) => item.id !== id);
      if (noteEditing.value?.id === id) {
        noteOpen.value = false;
        noteEditing.value = null;
      }
      toast("已离线删除，联网后自动同步");
      await relayoutAfterMarks();
      return;
    }
    toast("删除失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

function jumpAnnotation(item: AnnotationItem) {
  showNotes.value = false;
  void go(item.chapterIndex, item.start);
}

/**
 * 从笔记中心跳进来：/read/:id/:index?mark=<annotationId>。
 *
 * 用标注自己的字符偏移定位（比路由里的章号更准——笔记可能是在换源之前记的），
 * 落点后再闪一下高亮，否则读者只能看到一片同样颜色的正文。
 */
async function openMarkFromQuery(): Promise<void> {
  const id = String(route.query.mark ?? "");
  if (!id) return;
  if (!annotations.value.length) await loadAnnotations();
  const item = annotations.value.find((entry) => entry.id === id);
  if (!item) return;
  await go(item.chapterIndex, item.start);
  await nextTick();
  const target = document.querySelector<HTMLElement>(`.hl[data-mark="${item.id}"]`);
  target?.scrollIntoView({ block: "center" });
  if (target) {
    target.classList.add("is-flash");
    window.setTimeout(() => target.classList.remove("is-flash"), 1800);
  }
  const rest = { ...route.query };
  delete rest.mark;
  void router.replace({ query: rest });
}

function copySelection() {
  const text = selection.quote;
  const done = () => toast("已复制");
  const fail = () => toast("复制失败", "error");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fail);
  else fail();
  cancelSelection();
}

function exportAnnotations() {
  const name = book.value?.book.name ?? "book";
  const markdown = annotationsMarkdown(name, annotations.value);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name + "-划线笔记.md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("已导出 Markdown");
}


function onSeekChapter(next: number) {
  void go(next);
}

function onSeekPage(page: number) {
  if (settings.value.mode !== "page") return;
  const span = chapterSpanAt(index.value);
  if (!span) return;
  const target = Math.min(span.start + span.pages - 1, Math.max(span.start, span.start + page - 1));
  turnTo(target);
}

function jumpTop() {
  if (settings.value.mode === "page") {
    const span = chapterSpanAt(index.value);
    if (span) turnTo(span.start);
    return;
  }
  const el = scroller.value;
  const section = sectionEl(index.value);
  if (el && section) el.scrollTo({ top: section.offsetTop, behavior: "smooth" });
}

function jumpBottom() {
  if (settings.value.mode === "page") {
    const span = chapterSpanAt(index.value);
    if (span) turnTo(span.start + span.pages - 1);
    return;
  }
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

async function back() {
  await saveNow(true);
  stopSpeak();
  goBack("/shelf");
}

function onKey(event: KeyboardEvent) {
  if (isEditableTarget(event.target as HTMLElement | null)) return;
  // 看图时键盘归查看器（Esc 关、+/- 缩放），别让方向键把底下的正文翻走。
  if (viewerSrc.value) return;
  const action = actionForKey(event);
  if (!action) return;
  if (action === "escape") {
    showSettings.value = false;
    showCatalog.value = false;
    showMarks.value = false;
    showNotes.value = false;
    showMore.value = false;
    closeMarkPopover();
    noteOpen.value = false;
    search.open.value = false;
    cancelSelection();
    if (!chromeVisible.value) toggleChrome();
    return;
  }
  event.preventDefault();
  if (autoPlaying.value && ["prev-page", "next-page", "prev-chapter", "next-chapter"].includes(action)) stopAutoScroll();
  switch (action) {
    case "prev-page":
      flip(-1);
      break;
    case "next-page":
      flip(1);
      break;
    case "prev-chapter":
      void go(index.value - 1);
      break;
    case "next-chapter":
      void go(index.value + 1);
      break;
    case "menu":
      toggleChrome();
      break;
    case "catalog":
      toggleCatalog();
      break;
    case "search":
      search.openSearch();
      break;
    case "bookmarks":
      openSheet("marks");
      break;
    case "settings":
      openSheet("settings");
      break;
    case "speech":
      onSpeechButton();
      break;
    case "fullscreen":
      toggleFullscreen();
      break;
    case "font-smaller":
      void patchSettings({ fontSize: settings.value.fontSize - 1 });
      break;
    case "font-larger":
      void patchSettings({ fontSize: settings.value.fontSize + 1 });
      break;
    case "chapter-top":
      jumpTop();
      break;
    case "chapter-bottom":
      jumpBottom();
      break;
    case "help":
      toast("←/→ 翻页 · Ctrl+←/→ 换章 · T 目录 · B 书签 · M 工具栏 · F 全屏 · [ ] 字号");
      break;
    default:
      break;
  }
}

function onPageHide() {
  void saveNow(true);
}

watch(index, (value) => {
  const chapter = chapters.get(value);
  if (chapter && !chapter.loading && !chapter.error) markRead(value);
});

onMounted(async () => {
  // The reader owns the viewport; a scrolling page behind it makes the scroll bar and
  // touch gestures jump between two scrollers.
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", onKey);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  if (typeof window.matchMedia === "function") {
    darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    systemDark.value = darkQuery.matches;
    darkQuery.addEventListener("change", onScheme);
  }
  activity.start();
  scheduleAutoHide();

  try {
    const detail = await api.book(bookId);
    book.value = detail;
    total.value = detail.book.chapterCount || 0;
    const start = Math.max(0, Math.min(initialIndex, Math.max(0, total.value - 1)));
    index.value = start;
    await ensureWindow(start);
    // The reader body only exists once ready flips, so mount it before restoring the anchor.
    ready.value = true;
    await nextTick();
    gestures.attach(scroller.value);
    pager.observe();
    window.addEventListener("resize", onResize);
    await restorePosition();
    const notice = takeSwitchNoticeDetail(bookId);
    if (notice) showSwitchNotice(notice.text, notice.reanchor);
    scheduleAutoHide();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }

  void loadCatalog();
  void loadMarks();
  void loadAnnotations();
  void loadReadChapters();
  void openMarkFromQuery();
  wakeLock.sync();
  // 朗读能力是可选功能：服务端没配 TTS_URL 时请求会返回 enabled=false，不是错误。
  void api
    .tts()
    .then((caps) => {
      ttsCaps.value = caps;
    })
    .catch(() => {
      ttsCaps.value = null;
    });

  try {
    const serverSettings = await api.settings();
    const merged = normalizeReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      ...fromServerSettings(serverSettings),
      ...(hasStoredReaderSettings() ? baseSettings.value : {}),
    });
    if (JSON.stringify(merged) !== JSON.stringify(baseSettings.value)) {
      const beforeParagraph = JSON.stringify(settings.value.paragraph);
      baseSettings.value = merged;
      settings.value = applyBookTypography(merged, bookOverride.value);
      if (JSON.stringify(settings.value.paragraph) !== beforeParagraph) rebuildBlocks();
      await nextTick();
      if (restored.value) {
        if (settings.value.mode === "page") {
          measurePager();
          locatePage(index.value, progress.charOffset);
        } else {
          locateScroll(index.value, progress.charOffset);
        }
      }
    }
  } catch {
    /* settings sync is optional */
  }

  // 导入字体存在 IndexedDB 里，必须在正文用上它之前注册；缺失时静默回退系统字体。
  void fonts.ensure(settings.value.customFont);

  if (settings.value.autoScroll) {
    window.setTimeout(() => {
      if (ready.value && !autoPlaying.value) startAutoReading();
    }, 1200);
  }
});

watch(
  () => settings.value.customFont,
  (family) => void fonts.ensure(family),
);

watch(
  () => route.params.index,
  (value) => {
    const next = Number(value);
    if (Number.isFinite(next) && next !== index.value) void go(next);
  },
);

watch(
  () => [settings.value.mode, settings.value.pageWidth, settings.value.fontSize, settings.value.lineHeight],
  async () => {
    await nextTick();
    if (settings.value.mode === "page") {
      measurePager();
      locatePage(index.value, progress.charOffset);
    }
  },
);

// 跨过 1024px、切换双页开关或收起侧栏时列数变了，必须重新量并回到同一个字符锚点。
watch([spreadActive, bodyWidth], async () => {
  await nextTick();
  if (settings.value.mode !== "page" || !restored.value) return;
  measurePager();
  locatePage(index.value, progress.charOffset);
});

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow;
  window.clearTimeout(saveTimer);
  window.clearTimeout(hideTimer);
  window.clearTimeout(settingsTimer);
  window.clearTimeout(adjustTimer);
  window.clearTimeout(fadeTimer);
  window.clearTimeout(imageTimer);
  window.clearTimeout(switchNoticeTimer);
  clearSleepTimer();
  activity.stop();
  stopAutoScroll();
  window.removeEventListener("keydown", onKey);
  document.removeEventListener("selectionchange", onSelectionChange);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("pagehide", onPageHide);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  window.removeEventListener("resize", onResize);
  darkQuery?.removeEventListener("change", onScheme);
  stopSpeak();
  activity.flush();
  void saveNow(true);
});
</script>

<template>
  <div
    class="reader"
    :class="{
      'chrome-hidden': !chromeVisible,
      'page-anim-fade': settings.pageAnimation === 'fade',
      'paged-mode': settings.mode === 'page',
      'layout-side': sidebarVisible,
      'is-adjusting': adjustState.kind !== null,
    }"
    :style="readerStyle"
  >
    <div v-if="!ready && !loadError" class="reader-loading">
      <span class="spinner" />
      <p>正在打开《{{ book?.book.name || "…" }}》</p>
    </div>

    <div v-if="loadError" class="reader-loading">
      <p>打开失败：{{ loadError }}</p>
      <button class="btn" type="button" @click="back">返回书架</button>
    </div>

    <template v-if="ready">
      <ReaderChrome
        :book-name="book?.book.name || ''"
        :chapter-title="chapterTitle"
        :percent="progress.percent"
        :offline="offline"
        :speaking="speaking"
        :auto-playing="autoPlaying"
        :note-count="annotations.length"
        :pending="sync.pending.value"
        :source="book?.book.originName || ''"
        @back="back"
        @catalog="toggleCatalog"
        @settings="openSheet('settings')"
        @marks="openSheet('marks')"
        @notes="openSheet('notes')"
        @speech="onSpeechButton"
        @swap="showSwitch = true"
        @search="search.openSearch()"
        @auto="toggleAutoScroll"
        @more="showMore = true"
        @top="jumpTop"
        @bottom="jumpBottom"
        @shelf="back"
      />

      <Transition name="switch-notice">
        <div v-if="switchNotice" class="reader-switch-notice" role="status">
          <ReaderIcon name="swap" :size="16" />
          <span>{{ switchNotice }}</span>
          <button
            v-if="switchUndoable"
            type="button"
            class="reader-switch-undo"
            :disabled="switchUndoing"
            @click="undoAutoSwitch"
          >{{ switchUndoing ? "撤销中…" : "撤销自动换源" }}</button>
          <button
            v-if="switchReanchor?.failures?.length"
            type="button"
            class="reader-switch-retry"
            @click="openReanchorSheet"
          >逐条定位</button>
          <button
            v-if="reanchorFailed"
            type="button"
            class="reader-switch-retry"
            :disabled="reanchoring"
            @click="retryReanchor"
          >{{ reanchoring ? "重贴中…" : `重试重贴 ${reanchorFailed}` }}</button>
          <button type="button" aria-label="关闭换源提示" @click="dismissSwitchNotice">
            <ReaderIcon name="close" :size="14" />
          </button>
        </div>
      </Transition>

      <Transition name="switch-notice">
        <div v-if="qualityNotice" class="reader-quality-notice" :class="{ 'has-switch': switchNotice }" role="status">
          <div class="reader-quality-text">
            <strong>这一章可能有缺字</strong>
            <span>{{ qualityNotice.reason || "正文特征可疑，换个书源通常能恢复" }}</span>
          </div>
          <button type="button" class="reader-quality-swap" @click="showSwitch = true">换源</button>
          <button type="button" class="reader-quality-close" aria-label="忽略本章质量提示" @click="dismissQuality">
            <ReaderIcon name="close" :size="14" />
          </button>
        </div>
      </Transition>

      <ReaderSidebar
        v-if="sidebarVisible"
        :items="catalogItems"
        :current="index"
        :loading="catalogLoading"
        :read="readChapters"
        :current-percent="Math.round(progress.chapterPercent * 100)"
        @select="go"
        @locate="returnToReading"
        @close="patchSettings({ desktopCatalog: false })"
      />

      <div
        ref="scroller"
        class="reader-body"
        :class="{
          paged: settings.mode === 'page',
          spread: spreadActive,
          'no-indent': !settings.indent,
          'no-justify': !settings.justify,
          'dialog-indent': settings.paragraph.dialogIndent,
        }"
        @scroll.passive="onScroll"
        @wheel.passive="pauseAutoScroll"
      >
        <!-- 滚动模式吸顶：章节名 + 本章进度。height:0 不占正文行，滚动时像书眉一样贴着顶部。 -->
        <div v-if="settings.mode === 'scroll' && stickyVisible" class="reader-sticky-chapter" aria-hidden="true">
          <div class="reader-sticky-inner">
            <span class="reader-sticky-title">{{ chapterTitle }}</span>
            <span class="reader-sticky-percent">{{ Math.round(progress.chapterPercent * 100) }}%</span>
          </div>
        </div>
        <!-- 分页时这一层是裁剪窗口：列会往左右溢出，不裁掉的话宽屏上能看见相邻屏的正文。 -->
        <div class="reader-window">
          <div ref="flow" class="reader-flow">
            <ChapterSection
              v-for="chapter in visibleChapters"
              :key="chapter.index"
              :data-chapter="chapter.index"
              :chapter="chapter"
              :total="total"
              :paged="settings.mode === 'page'"
              :correcting="correcting"
              :next-title="catalogTitles[chapter.index + 1]"
              :marks="marksFor(chapter.index)"
              :hits="search.rangesFor(chapter.index)"
              @retry="loadChapter($event, true)"
              @next="go(chapter.index + 1)"
              @swap="showSwitch = true"
              @bookmark="addBookmark({ atEnd: true, openList: false, chapterIndex: $event })"
              @note="openChapterNote($event)"
              @image="onChapterImage"
              @zoom="openImageViewer"
            />
            <div v-if="windowEnd >= total - 1 && total > 0" class="reader-tail">— 全书完 —</div>
          </div>
        </div>
      </div>

      <footer class="reader-bottom">
        <button class="reader-nav" type="button" :disabled="index <= 0" aria-label="上一章" @click="go(index - 1)">
          <ReaderIcon name="prev" :size="18" />
        </button>
        <ReaderProgressBar
          :chapter="index"
          :total="total"
          :page="pageNo"
          :pages="pageCount"
          :percent="progress.percent"
          :titles="catalogTitles"
          :remaining-chars="remainingCharsNow"
          :read-chars="readCharsNow"
          :chapter-chars="chapterCharsNow"
          :minutes="remainingMinutesNow"
          @seek-chapter="onSeekChapter"
          @seek-page="onSeekPage"
        />
        <button
          class="reader-nav"
          type="button"
          :disabled="total > 0 && index >= total - 1"
          aria-label="下一章"
          @click="go(index + 1)"
        >
          <ReaderIcon name="next" :size="18" />
        </button>
      </footer>

      <div
        v-if="settings.warmth > 0"
        class="reader-tint reader-tint-warm"
        :style="{ opacity: (settings.warmth / 100) * 0.45 }"
      />
      <div v-if="settings.dim > 0" class="reader-tint reader-tint-dim" :style="{ opacity: (settings.dim / 100) * 0.65 }" />

      <ReaderReadout
        :config="settings.readout"
        :book="book?.book.name || ''"
        :chapter="chapterTitle"
        :percent="progress.percent"
        :page="pageNo"
        :pages="pageCount"
        :remaining-chars="remainingCharsNow"
        :read-chars="readCharsNow"
        :sleep-left="sleepLeft"
        :source="book?.book.originName || ''"
        :always="settings.readoutAlways"
        :chrome-visible="chromeVisible"
        :top-visible="!chromeVisible"
      />
    </template>

    <QuoteCardSheet
      v-model="showCard"
      :quote="cardQuote"
      :book-name="book?.book.name ?? ''"
      :chapter-title="chapterTitle"
      :palette="{ bg: theme.bg, fg: theme.fg, muted: theme.muted, accent: theme.accent }"
    />

    <ReaderImageViewer v-if="viewerSrc" :src="viewerSrc" @close="closeImageViewer" />

    <ReaderAdjustHud :kind="adjustState.kind" :value="adjustState.value" :visible="adjustVisible" :lifted="speaking" />

    <ReaderSpeechBar
      v-if="speaking"
      :paused="speechPaused"
      :engine="speech.activeEngine.value"
      :rate="settings.ttsRate"
      :lifted="chromeVisible"
      @pause="pauseSpeak"
      @resume="resumeSpeak"
      @stop="stopSpeak"
    />

    <div v-if="correcting" class="reader-correct-bar" role="status">
      <span class="reader-correct-text"><b>段落纠正</b> 点正文段落改排版</span>
      <button type="button" class="reader-correct-done" @click="stopCorrecting">完成</button>
    </div>

    <ReaderSettingsSheet
      v-model="showSettings"
      :settings="panelSettings"
      :scope="settingScope"
      :book-name="book?.book.name"
      :book-customized="bookCustomized"
      :fix-count="paragraphFixes.length"
      :chapter-title="currentChapter?.title"
      :paragraphs="currentChapter?.paragraphs"
      :voices="ttsVoices"
      :tts-enabled="ttsEnabled"
      :wide="bodyWidth >= 1024"
      :sleep-minutes="sleepMinutes"
      :sleep-left="sleepLeft"
      :dwell="pageDwellMs(scroller?.clientHeight ?? 0, settings.autoSpeed)"
      @change="patchSettings"
      @sleep="setSleep"
      @update:scope="setSettingScope"
      @reset-book="resetBookTypography"
      @correct="startCorrecting"
    />
    <ReaderCatalog
      v-model="showCatalog"
      :items="catalogItems"
      :current="index"
      :loading="catalogLoading"
      :read="readChapters"
      :current-percent="Math.round(progress.chapterPercent * 100)"
      @select="go"
      @locate="returnToReading"
    />
    <ReaderSwitchSheet
      v-model="showSwitch"
      :book-id="bookId"
      :book-name="book?.book.name || ''"
      :book-author="book?.book.author || ''"
      :chapter-index="index"
      :chapter-title="currentChapter?.title"
      :current-chars="currentChapter?.length"
      :current-chapters="total"
      :current-excerpt="currentExcerpt"
      :current-source-id="book?.book.sourceId"
      :current-source-name="book?.source?.name || book?.book.originName || ''"
      :current-toc-url="book?.book.tocUrl || ''"
      :current-source-health-state="book?.source?.healthState"
      :current-source-health-score="book?.source?.healthScore"
      :can-undo="Boolean(book?.lastSwitch)"
      :last-source-name="book?.lastSwitch?.sourceName"
      :last-switch-kind="book?.lastSwitch?.kind"
      :switch-anchor="switchAnchorDraft"
      @switched="onSwitched"
    />
    <ReaderReanchorSheet
      v-model="showReanchor"
      :book-id="bookId"
      :failures="switchReanchor?.failures ?? []"
      @applied="onReanchorApplied"
    />
    <ReaderParagraphSheet
      v-model="showParagraphSheet"
      :text="correctTarget?.text ?? ''"
      :chapter-title="correctTarget?.chapterTitle"
      :current="correctTarget?.current ?? null"
      @pick="applyParagraphFix"
    />
    <ReaderBookmarks
      v-model="showMarks"
      :items="bookmarks"
      :history="positions"
      :history-loading="positionsLoading"
      @select="jumpMark"
      @remove="removeMark"
      @add="addBookmark"
      @select-history="jumpHistory"
      @clear-history="clearHistory"
    />

    <ReaderSearch
      :model-value="search.open.value"
      :query="search.query.value"
      :scope="search.scope.value"
      :chapter-matches="search.chapterMatches.value"
      :book-hits="search.bookHits.value"
      :scanning="search.scanning.value"
      :progress="search.progress.value"
      :error="search.error.value"
      :scanned-once="search.scannedOnce.value"
      :can-continue="search.canContinue.value"
      :next-index="search.nextIndex.value"
      :chapter-index="index"
      :chapter-title="chapterTitle"
      :total="total"
      :active-match="search.activeMatch.value"
      :pinned-index="search.pinnedIndex.value"
      :has-query="search.hasQuery.value"
      @update:model-value="search.open.value = $event"
      @update:query="search.query.value = $event"
      @update:scope="search.scope.value = $event"
      @search-book="search.searchBook()"
      @continue="search.searchBook(search.nextIndex.value)"
      @stop="search.stop()"
      @select-chapter="search.selectChapterMatch($event)"
      @select-book="search.selectBookHit($event)"
      @clear="search.clear()"
    />
    <ReaderSearchNav
      v-if="search.hasQuery.value && !search.open.value && search.hitCount.value > 0"
      :count="search.hitCount.value"
      :position="search.hitPosition.value"
      :scope="search.scope.value"
      :lifted="chromeVisible"
      @prev="search.step(-1)"
      @next="search.step(1)"
      @close="search.clear()"
    />

    <ReaderSelectionBar
      :rect="selection.rect"
      :quote="selection.quote"
      @pick="createAnnotation('highlight', $event, '')"
      @note="openNoteFromSelection"
      @share="openShareCard"
      @copy="copySelection"
      @cancel="cancelSelection"
    />
    <ReaderMarkPopover
      v-if="markPopover"
      :item="markPopover.item"
      :rect="markPopover.rect"
      @close="closeMarkPopover"
      @edit="editFromPopover"
      @copy="copyFromPopover"
      @remove="removeFromPopover"
    />
    <ReaderMoreSheet
      v-model="showMore"
      :auto-playing="autoPlaying"
      :speaking="speaking"
      :note-count="annotations.length"
      @auto="moreAction('auto')"
      @speech="moreAction('speech')"
      @swap="moreAction('swap')"
      @search="moreAction('search')"
      @marks="moreAction('marks')"
      @notes="moreAction('notes')"
    />
    <ReaderAnnotations
      v-model="showNotes"
      :items="annotations"
      :loading="notesLoading"
      @select="jumpAnnotation"
      @remove="removeAnnotation"
      @edit="openNoteForEdit"
      @export="exportAnnotations"
    />
    <ReaderNoteSheet
      v-model="noteOpen"
      :quote="noteQuote"
      :comment="noteComment"
      :color="noteColor"
      :editing="Boolean(noteEditing)"
      :chapter-note="noteChapter"
      @save="saveNote"
      @remove="noteEditing && removeAnnotation(noteEditing.id)"
    />
  </div>
</template>
