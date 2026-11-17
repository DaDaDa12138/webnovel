<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  healthStateLabel,
  type ChapterMeasure,
  type SwitchAnchorPayload,
  type SwitchCandidate,
  type SwitchHistoryItem,
  type SwitchResult,
} from "@legado/shared";
import BottomSheet from "../BottomSheet.vue";
import { api } from "../../api";
import { readSseStream } from "../../lib/sse";
import {
  chapterDelta,
  charRatio,
  charVerdict,
  collapseMirrors,
  excludeSource,
  filterMoreComplete,
  formatAge,
  formatCharCount,
  matchClass,
  matchLabel,
  sortByChapterChars,
  measureBlocked,
  recommendCandidate,
  sortByChapters,
  sortByHealth,
  sortByQuality,
} from "../../lib/switch-rank";
import {
  applySwitchPrefs,
  isSourceBlocked,
  isSourcePinned,
  loadSwitchPrefs,
  saveSwitchPrefs,
  toggleBlockedSource,
  togglePinnedSource,
  type SwitchPrefs,
} from "../../lib/switch-prefs";
import { saveSwitchNotice } from "../../lib/switch-notice";
import { toast } from "../../lib/toast";

const props = defineProps<{
  modelValue: boolean;
  bookId: number;
  bookName: string;
  bookAuthor?: string;
  /** 当前正在读的章节：测字与换源后定位都用它。 */
  chapterIndex: number;
  chapterTitle?: string;
  /** 当前源这一章的字符数，用来算「新源少了多少」。 */
  currentChars?: number;
  /** 当前源目录有多少章：用来标「比当前多 / 少几章」。 */
  currentChapters?: number;
  /** 当前源这一章的开头（阅读页缓存里有正文时传），用于和候选并排比较。 */
  currentExcerpt?: string;
  /** 当前正在使用的源：面板单独展示，并从候选/推荐里排除，避免「换到自己」。 */
  currentSourceId?: number;
  currentSourceName?: string;
  /** 当前书的目录地址：同一 toc 的其它书源条目也是「自己」，不能推荐换过去。 */
  currentTocUrl?: string;
  /** 当前源健康状态：换源面板先告诉读者「这个源还稳不稳」。 */
  currentSourceHealthState?: string | null;
  currentSourceHealthScore?: number;
  /** 服务端是否记着可撤销的换源历史；没有时不要给一个点了只报错的「换回原源」。 */
  canUndo?: boolean;
  /** 上一次换源前的源名，用来把按钮写清楚：「换回 XX」比「换回原源」更可信。 */
  lastSourceName?: string;
  /** 上次换源是手动还是自动：自动换源也写历史，面板要解释清楚。 */
  lastSwitchKind?: string;
  /** 换源前读者所在的那一句：随换源请求落库，另一台设备打开时接续。 */
  switchAnchor?: SwitchAnchorPayload | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  switched: [result: SwitchResult];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const currentHealthText = computed(() => {
  const state = props.currentSourceHealthState;
  if (!state || state === "unknown") return "";
  const label = healthStateLabel(state);
  return typeof props.currentSourceHealthScore === "number" && props.currentSourceHealthScore > 0
    ? label + " " + props.currentSourceHealthScore
    : label;
});

type SortMode = "chapters" | "chars" | "health" | "quality";

const phase = ref<"idle" | "searching" | "done">("idle");
/** 这一轮是不是深度搜索：决定提示文案、进度条，以及结果要不要缓存。 */
const deep = ref(false);
const sortMode = ref<SortMode>("chapters");
const onlyMore = ref(false);
/** 默认只列「章节名对得上」的源：只靠章号/位置凑出来的，换过去就是错章。 */
const onlyMatched = ref(true);
/** 作者一致性提示：默认开启但不隐藏候选。聚合站作者字段常是脏数据，硬过滤会挡掉能用的源。 */
const onlyAuthor = ref(true);
/** 按书源分组收窄：订阅源、自建源、内置源的可信度差别很大。 */
const groupFilter = ref("all");
/** 候选源名/分组/域名搜索：源多的时候比逐个分组翻更快。 */
const sourceQuery = ref("");
const showFailed = ref(false);
/** 换源记录：最近 5 条，展开才请求一次，不拖慢面板首屏。 */
const history = ref<SwitchHistoryItem[]>([]);
const historyLoading = ref(false);
const showHistory = ref(false);
const hint = ref("");
const candidates = ref<SwitchCandidate[]>([]);
const switching = ref(0);
/** 目标源目录明显缩水时，服务端会 409 拦下来；这里存下来给用户一个「仍要换」。 */
const shorter = ref<{ item: SwitchCandidate; text: string } | null>(null);
const searched = ref(0);
const totalSources = ref(0);
/** 这次被服务端跳过（刚查过）的源数量：跳过全部时说明面板拿到的是缓存快照。 */
const skippedSources = ref(0);
/** 缓存快照的时间描述（「12 分钟前」），只在首屏展示缓存时出现。 */
const cacheAge = ref("");
/** 参与换源的源总数：skipped 追平它就说明这一轮没源可搜了，深度搜索必须强制刷新。 */
const poolSize = ref(0);
/** 内置源（书山聚合、大灰狼聚合）在服务端的搜索状态：搜过没有、有没有候选，都要说清楚。 */
type BuiltinState = { id: number; name: string; searched: boolean; found: boolean };
const builtins = ref<BuiltinState[]>([]);
const builtin = computed(() => builtins.value[0] ?? null);
let controller: AbortController | null = null;
/** 默认搜索没找到更全的源时自动升级到深度搜索：只自动跑一次，用户点过停止就不再自作主张。 */
let autoDeep = false;
/** 本机的来源偏好：置顶优先推荐，屏蔽的源不再出现在候选里。 */
const prefs = ref<SwitchPrefs>(loadSwitchPrefs());
/** 展开了「试读开头」的候选（按 bookUrl 记），和候选列表的选中/切换状态无关。 */
const expanded = ref<Record<string, boolean>>({});

const baseline = computed(() => props.currentChars ?? 0);
const currentChapters = computed(() => props.currentChapters ?? 0);
/** 排除当前源后的候选：列表只留「能换过去的其它源」。 */
const others = computed(() =>
  excludeSource(candidates.value, props.currentSourceId, props.currentTocUrl),
);
/** 这一轮搜索里命中当前源本身的数量：全部候选都是自己时，空态要解释清楚而不是说「没找到」。 */
const currentSkipped = computed(() => Math.max(0, candidates.value.length - others.value.length));
const ordered = computed(() => {
  const sorted =
    sortMode.value === "health"
      ? sortByHealth(others.value, baseline.value)
      : sortMode.value === "quality"
        ? sortByQuality(others.value, baseline.value)
        : sortMode.value === "chapters"
          ? sortByChapters(others.value, baseline.value)
          : sortByChapterChars(others.value, baseline.value);
  return applySwitchPrefs(sorted, prefs.value);
});
/** 候选里出现过的分组：空分组统一显示「未分组」。
 *  只统计还能换的源——某个分组如果全是失败候选，列出来只会让人选中后看到空列表。 */
const groups = computed(() => {
  const names = new Set<string>();
  for (const item of others.value) {
    if (item.status === "fail") continue;
    names.add(String(item.sourceGroup ?? ""));
  }
  return Array.from(names).sort((a, b) => (a || "未分组").localeCompare(b || "未分组", "zh"));
});
const recommended = computed(() =>
  recommendCandidate(others.value, baseline.value, prefs.value, currentChapters.value),
);
const mismatchCount = computed(() => others.value.filter((item) => matchClass(item) === "mismatch").length);
const authorDiff = computed(() => ordered.value.filter((item) => item.authorOk !== true).length);
function matchesSourceQuery(item: SwitchCandidate): boolean {
  const query = sourceQuery.value.trim().toLowerCase();
  if (!query) return true;
  return [item.sourceName, item.sourceGroup, item.bookUrl].some((value) =>
    String(value ?? "").toLowerCase().includes(query),
  );
}

const visible = computed(() => {
  const queried = ordered.value.filter(matchesSourceQuery);
  const byGroup = groupFilter.value === "all" ? queried : queried.filter((item) => String(item.sourceGroup ?? "") === groupFilter.value);
  const named = onlyMatched.value ? byGroup.filter((item) => matchClass(item) !== "mismatch") : byGroup;
  const pool = onlyMore.value ? filterMoreComplete(named, currentChapters.value) : named;
  const shown = pool.filter((item) => showFailed.value || item.status !== "fail");
  // 同一个站群的五六个域名内容完全一样，折叠成一行再渲染。
  return collapseMirrors(shown);
});
const failedCount = computed(() => others.value.filter((item) => item.status === "fail").length);
const measuredCount = computed(() => others.value.filter((item) => typeof item.chars === "number" && item.chars > 0).length);
/** 这一轮没轮到测字的候选（25 秒窗口用完）：给一个「只补这些」的入口。 */
const unmeasuredCount = computed(
  () => others.value.filter((item) => item.status !== "fail" && typeof item.chars !== "number" && !item.measureError).length,
);
const okCount = computed(() => others.value.filter((item) => item.status === "ok").length);
const percent = computed(() => (totalSources.value ? Math.min(100, Math.round((searched.value / totalSources.value) * 100)) : 0));
const bestChapters = computed(() => others.value.reduce((max, item) => Math.max(max, item.chapters || 0), 0));
/** 默认搜索一个「更全的源」都没找到：这是深度搜索最该被点的时候。 */
const allShorter = computed(
  () => phase.value === "done" && !deep.value && currentChapters.value > 0 && bestChapters.value <= currentChapters.value,
);
/** 已屏蔽的源：候选缓存里还留着名字，就在顶部列成可点恢复的小标签，而不是只给一句「清除偏好」。 */
const blockedSources = computed(() =>
  prefs.value.blocked.map((id) => ({
    id,
    name: candidates.value.find((item) => item.sourceId === id)?.sourceName || `源 #${id}`,
  })),
);
const undoLabel = computed(() => {
  if (switching.value === -1) return "换回中…";
  return props.canUndo && props.lastSourceName ? "换回上次源" : "换回原源";
});
const lastSwitchLabel = computed(() => {
  if (!props.lastSwitchKind && !props.lastSourceName) return "";
  const kind = props.lastSwitchKind === "auto" ? "自动换源" : "手动换源";
  return `上次${kind}前是「${props.lastSourceName || "原来源"}」`;
});

/** 换源记录是辅助信息：请求失败就安静地不显示，不能挡住换源主流程。 */
async function loadHistory(): Promise<void> {
  if (historyLoading.value) return;
  historyLoading.value = true;
  try {
    const result = await api.switchHistory(props.bookId);
    history.value = result.items;
  } catch {
    history.value = [];
  } finally {
    historyLoading.value = false;
  }
}

/** 历史时间是 SQLite 的 UTC 字符串，转成本地 MM-DD HH:mm；解析失败就原样截取。 */
function historyTime(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const iso = text.includes("T") ? text : text.replace(" ", "T") + "Z";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return text.slice(5, 16);
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const cacheKey = computed(() => `${props.bookId}:${props.chapterIndex}`);

/** 内置源的状态文案：用户最容易怀疑「聚合源到底搜没搜」。 */
function builtinText(item: BuiltinState): string {
  if (phase.value === "searching" && !item.searched) return "正在搜索…";
  if (!item.searched) return "本轮没有参与搜索（源未启用）";
  return item.found ? "已搜到候选" : "已搜，未收录这本书";
}

function stop(): void {
  const running = phase.value === "searching";
  controller?.abort();
  controller = null;
  if (running) {
    phase.value = "done";
    hint.value = `已停止 · 保留 ${others.value.length} 个候选`;
  }
}

function applyMeasure(measure: ChapterMeasure): void {
  const target = candidates.value.find((item) => item.bookUrl === measure.bookUrl);
  if (!target) return;
  target.chars = measure.ok ? measure.chars : 0;
  target.chapterTitle = measure.chapterTitle;
  target.measureMs = measure.ms;
  target.measureError = measure.ok ? "" : measure.error;
  target.matched = measure.matched;
  target.matchReason = measure.matchReason;
  target.matchScore = measure.matchScore;
  if (measure.excerpt) target.excerpt = measure.excerpt;
  if (measure.preview) target.preview = measure.preview;
  target.contentQuality = measure.contentQuality;
  target.contentQualityScore = measure.contentQualityScore;
  target.contentQualityReason = measure.contentQualityReason;
}

/** 试读开头的正文：优先用测字时多截的 600 字，旧缓存/失败时退回 120 字摘要。 */
function previewText(item: SwitchCandidate): string {
  return String(item.preview || item.excerpt || "").trim();
}

function isPreviewOpen(item: SwitchCandidate): boolean {
  return Boolean(expanded.value[item.bookUrl]);
}

function togglePreview(item: SwitchCandidate): void {
  expanded.value = { ...expanded.value, [item.bookUrl]: !expanded.value[item.bookUrl] };
}

/** 当前源这一章的开头；阅读页没缓存正文时给一句诚实的说明，而不是空白对比列。 */
const currentPreview = computed(() =>
  String(props.currentExcerpt ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, 600),
);

/**
 * 换源搜索 + 逐源测字：candidate 事件给目录信息，measure 事件补当前章节字数。
 *
 * force=false 时服务端会先回一份缓存（start 事件里的 cached），并跳过刚查过的源——
 * 换源面板最常被反复打开，每次都从零扫 788 个站要一两分钟。
 */
async function start(deepRun = false, force = false): Promise<void> {
  stop();
  const local = new AbortController();
  controller = local;
  deep.value = deepRun;
  phase.value = "searching";
  candidates.value = [];
  searched.value = 0;
  totalSources.value = 0;
  skippedSources.value = 0;
  cacheAge.value = "";
  hint.value = force ? "重新搜索全部书源…" : deepRun ? "深度搜索：逐个源取目录，约 2 分钟…" : "正在搜索书源…";
  try {
    const params = new URLSearchParams({
      chapter: String(props.chapterIndex),
      limit: deepRun ? "300" : "60",
      budget: deepRun ? "120000" : "15000",
    });
    if (deepRun) params.set("deep", "1");
    if (force) params.set("refresh", "1");
    // 章节名是换源定位的主证据（目录错乱的站按章号会落到邻章），顺手也让测字测对章。
    if (props.chapterTitle) params.set("title", props.chapterTitle);
    const res = await fetch(`/api/books/${props.bookId}/switch/candidates?${params.toString()}`, { signal: local.signal });
    if (!res.ok || !res.body) throw new Error("换源服务不可用");
    await readSseStream(res.body, (event, data) => {
      if (event === "start") {
        const rows = (Array.isArray(data?.cached) ? data.cached : []) as SwitchCandidate[];
        skippedSources.value = Number(data?.skipped) || 0;
        poolSize.value = Number(data?.pool) || 0;
        const measuring = Number(data?.measuring) || 0;
        const builtinRows = Array.isArray(data?.builtins)
          ? data.builtins
          : data?.builtin
            ? [data.builtin]
            : [];
        builtins.value = builtinRows.map((row: Record<string, unknown>) => ({
          id: Number(row.id) || 0,
          name: String(row.name ?? "聚合书源"),
          searched: row.searched === true,
          found: row.found === true,
        }));
        if (rows.length) {
          candidates.value = rows.slice();
          const shown = excludeSource(rows, props.currentSourceId, props.currentTocUrl).length;
          const oldest = rows.reduce(
            (min, item) => Math.min(min, typeof item.ageMs === "number" ? item.ageMs : 0),
            Number.MAX_SAFE_INTEGER,
          );
          cacheAge.value = formatAge(Number.isFinite(oldest) ? oldest : 0);
          hint.value = measuring > 0
            ? `上次检测 ${cacheAge.value} · ${shown} 个候选 · 正在补测第 ${props.chapterIndex + 1} 章的字数…`
            : skippedSources.value
              ? `上次检测 ${cacheAge.value} · ${shown} 个候选 · 跳过 ${skippedSources.value} 个刚查过的源`
              : `上次检测 ${cacheAge.value} · ${shown} 个候选，正在复查…`;
        }
      } else if (event === "search") {
        searched.value = Number(data.sources) || 0;
        totalSources.value = Number(data.total) || 0;
        hint.value = `已搜 ${data.sources}/${data.total} 源 · ${data.candidates} 候选`;
      } else if (event === "candidate") {
        const candidate = data as SwitchCandidate;
        const at = candidates.value.findIndex((item) => item.bookUrl === candidate.bookUrl);
        if (at >= 0) candidates.value[at] = candidate;
        else candidates.value.push(candidate);
      } else if (event === "measure") {
        applyMeasure(data as ChapterMeasure);
      } else if (event === "done") {
        const builtinRows = Array.isArray(data?.builtins)
          ? data.builtins
          : data?.builtin
            ? [data.builtin]
            : [];
        builtins.value = builtinRows.map((row: Record<string, unknown>) => ({
          id: Number(row.id) || 0,
          name: String(row.name ?? "聚合书源"),
          searched: row.searched === true,
          found: row.found === true,
        }));
        // done 里是「缓存 + 这一轮新探到」的合并结果，按地址去重，新的覆盖旧的。
        const fresh = (Array.isArray(data?.candidates) ? data.candidates : []) as SwitchCandidate[];
        if (fresh.length) {
          const merged = new Map(candidates.value.map((item) => [item.bookUrl, item]));
          for (const item of fresh) merged.set(item.bookUrl, item);
          candidates.value = Array.from(merged.values());
        }
        const count = others.value.length;
        if (skippedSources.value && !totalSources.value && !fresh.length) {
          hint.value = `已是最新 · ${count} 个候选（${cacheAge.value || "刚检测"}），点「重新搜索」可全量复查`;
        } else if (deepRun && props.currentChapters > 0) {
          const longer = others.value.filter((item) => item.status !== "fail" && item.chapters > props.currentChapters).length;
          hint.value = longer
            ? `找到 ${longer} 个比当前更全的源 · 共 ${count} 个候选`
            : `已搜完全部书源，没有比当前 ${props.currentChapters} 章更全的 · 共 ${count} 个候选`;
        } else {
          hint.value = `完成 · ${count} 候选 · ${okCount.value} 可用 · 测字 ${measuredCount.value}`;
        }
        // 默认搜索先到的总是那批「同书名的转载站」：如果一个比当前源更全的都没找到，
        // 说明剩下的长尾源根本没被搜过（788 个源默认只跑三十来个），直接升级深度搜索。
        // 这一轮一个源都没搜（全部命中缓存）时不要升级，否则只会立刻空转一轮。
        const best = others.value.reduce((max, item) => Math.max(max, item.chapters || 0), 0);
        if (!deepRun && !autoDeep && !force && totalSources.value > 0 && props.currentChapters > 0 && best <= props.currentChapters) {
          autoDeep = true;
          hint.value = `默认搜索只找到 ${best} 章的源，正在深度搜索全部书源…`;
          // 不能拿 controller === local 当守卫：done 事件之后 readSseStream 立刻结束，
          // finally 已经把 controller 置空，守卫永远为假（实测自动深度搜索根本没启动）。
          setTimeout(() => { if (open.value) void start(true); }, 900);
        }
      } else if (event === "error") {
        hint.value = "换源搜索失败：" + String(data.message ?? "");
      }
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") hint.value = "换源搜索失败：" + String((err as Error).message).slice(0, 80);
  } finally {
    if (controller === local) {
      controller = null;
      phase.value = "done";
    }
  }
}

function ratioOf(item: SwitchCandidate): number | null {
  return charRatio(item.chars, baseline.value);
}

function verdictClass(item: SwitchCandidate): string {
  return "is-" + charVerdict(ratioOf(item));
}

/** 字数远大于当前章时百分比没有意义（1428% 只会吓人），直接说明怀疑是整本。 */
function ratioText(item: SwitchCandidate): string {
  const ratio = ratioOf(item);
  if (ratio === null) return "";
  if (charVerdict(ratio) === "over") return "疑似整本";
  return Math.round(ratio * 100) + "%";
}

function isMismatch(item: SwitchCandidate): boolean {
  return matchClass(item) === "mismatch";
}

function matchText(item: SwitchCandidate): string {
  return matchLabel(item)?.text ?? "";
}

function matchTone(item: SwitchCandidate): string {
  return matchLabel(item)?.tone ?? "ok";
}

/** 候选卡上的健康徽标：只在有明确状态时显示，未知不打扰。 */
function healthText(item: SwitchCandidate): string {
  if (!item.sourceHealthState || item.sourceHealthState === "unknown") return "";
  const label = healthStateLabel(item.sourceHealthState);
  return typeof item.sourceHealthScore === "number" ? `${label} ${item.sourceHealthScore}` : label;
}

function qualityText(item: SwitchCandidate): string {
  if (item.contentQuality === "bad") return "正文可疑";
  if (item.contentQuality === "suspect") return "正文待确认";
  return "";
}

function qualityTitle(item: SwitchCandidate): string {
  return item.contentQualityReason || "测字时对正文做了占位、防盗和 HTML 残留检查";
}

/** 明确判定为 bad 的来源不再让用户白点一次。 */
function qualityBlocked(item: SwitchCandidate): boolean {
  return item.contentQuality === "bad";
}

/** 章名对不上时不能显示「3,580 字 98%」——那是另一章的字数，比了也是错的。 */
function charsText(item: SwitchCandidate): string {
  if (isMismatch(item)) return "未测到本章";
  if (formatCharCount(item.chars)) return formatCharCount(item.chars);
  // 失败也分种类：超时只是这一轮没抢到时间（下次打开会补测），空正文才是真的取不到。
  if (item.measureError) {
    if (/超时|timeout/i.test(item.measureError)) return "测字超时";
    if (/empty content|正文是空的/i.test(item.measureError)) return "正文为空";
    return "测字失败";
  }
  // 这一章还没测过：服务端会在 start 之后补测（measuring），别把它显示成「上次未测到」。
  if (item.measured === false) return phase.value === "done" ? "未测到字数" : "测字中…";
  // 缓存里的行这一轮不会再测（那个源刚查过），不能显示「测字中…」骗人等。
  if ((item.ageMs ?? 0) > 0) return "上次未测到";
  return phase.value === "done" ? "未测到字数" : "测字中…";
}

function deltaOf(item: SwitchCandidate): number {
  return chapterDelta(item, currentChapters.value);
}

/** 服务端把底层报错原样带上来（比如 "empty content: https://…"），直接显示太吓人，这里翻成人话。 */
function reasonText(item: SwitchCandidate): string {
  const raw = item.measureError || item.reason || "";
  if (/empty content|正文是空的/i.test(raw)) return "取不到正文（可能被反爬或规则失效）";
  if (/超时|timeout/i.test(raw)) return "正文请求超时（可能只是慢），可以换过去试试";
  return raw;
}

function togglePin(item: SwitchCandidate): void {
  prefs.value = togglePinnedSource(prefs.value, item.sourceId);
  saveSwitchPrefs(prefs.value);
  toast(isSourcePinned(prefs.value, item.sourceId) ? "已置顶 " + item.sourceName : "已取消置顶", "success");
}

function toggleBlock(item: SwitchCandidate): void {
  prefs.value = toggleBlockedSource(prefs.value, item.sourceId);
  saveSwitchPrefs(prefs.value);
  toast(
    isSourceBlocked(prefs.value, item.sourceId)
      ? "已屏蔽 " + item.sourceName + "，可在上方「已屏蔽」里恢复"
      : "已取消屏蔽 " + item.sourceName,
    "success",
  );
}

/** 顶部「已屏蔽」标签：点一下即恢复，不用把整份偏好清掉。 */
function unblockSource(id: number, name: string): void {
  if (!isSourceBlocked(prefs.value, id)) return;
  prefs.value = toggleBlockedSource(prefs.value, id);
  saveSwitchPrefs(prefs.value);
  toast("已恢复 " + name, "success");
}

function clearPrefs(): void {
  prefs.value = { pinned: [], blocked: [] };
  saveSwitchPrefs(prefs.value);
  toast("已清除来源偏好", "success");
}

async function pick(item: SwitchCandidate, allowShorter = false): Promise<void> {
  if (switching.value) return;
  switching.value = item.sourceId;
  try {
    const result = await api.switchBook(props.bookId, {
      sourceId: item.sourceId,
      bookUrl: item.bookUrl,
      expectName: props.bookName,
      expectAuthor: props.bookAuthor ?? "",
      force: item.status !== "ok",
      allowShorter,
      chapterIndex: props.chapterIndex,
      chapterTitle: props.chapterTitle ?? "",
      anchor: props.switchAnchor ?? null,
    });
    if (!result.chapters) {
      toast("目标书源没取到目录，已保留原来源", "error");
      return;
    }
    const before = result.chaptersBefore ?? currentChapters.value;
    const bits = [`已换到 ${result.source?.name ?? item.sourceName}`];
    bits.push(before && before !== result.chapters ? `${before} → ${result.chapters} 章` : `${result.chapters} 章`);
    if (result.progress?.matched) bits.push(`进度接续到「${result.progress.title}」`);
    else if (result.progress) bits.push("没找到同名章节，按比例接续");
    if (result.reanchor) {
      const a = result.reanchor.annotations;
      const b = result.reanchor.bookmarks;
      const total = a.total + b.total;
      if (total) {
        bits.push(`标注/书签跟上 ${a.moved + a.kept + b.moved + b.kept}/${total}`);
        if (a.failed + b.failed) bits.push(`${a.failed + b.failed} 条待重试`);
      }
    }
    if (result.warnings?.length) bits.push(result.warnings[0]);
    const message = bits.join(" · ");
    // 换源成功会整页重载，旧页面的 toast 看不到；留一张回执给 ReaderPage 展示。
    saveSwitchNotice(props.bookId, message, result.reanchor);
    toast(message);
    shorter.value = null;
    emit("update:modelValue", false);
    emit("switched", result);
  } catch (err) {
    const failure = err as Error & { code?: string };
    // 目录缩水是「需要用户确认」而不是「失败」：留在面板里，给一个仍要换的入口。
    if (failure.code === "toc_shorter") {
      shorter.value = {
        item,
        text: `${item.sourceName} 只有 ${item.chapters} 章（当前 ${currentChapters.value} 章），目录可能不全`,
      };
      return;
    }
    toast("换源失败：" + String(failure.message).slice(0, 60), "error");
  } finally {
    switching.value = 0;
  }
}

/** 换回上一次的源：服务端记着换源前的源、地址和当时读到的章节。 */
async function undo(): Promise<void> {
  if (switching.value) return;
  switching.value = -1;
  try {
    const result = await api.undoSwitch(props.bookId, {
      chapterIndex: props.chapterIndex,
      chapterTitle: props.chapterTitle,
    });
    const bits = [`已换回 ${result.source?.name ?? "原来源"}`, `${result.chapters} 章`];
    if (result.progress?.matched) bits.push(`进度接续到「${result.progress.title}」`);
    if (result.reanchor && result.reanchor.annotations.total + result.reanchor.bookmarks.total > 0) {
      bits.push(`标注/书签已还原 ${result.reanchor.annotations.kept + result.reanchor.bookmarks.kept} 条`);
    }
    const message = bits.join(" · ");
    saveSwitchNotice(props.bookId, message, result.reanchor);
    toast(message);
    emit("update:modelValue", false);
    emit("switched", result);
  } catch (err) {
    const failure = err as Error & { code?: string };
    toast(failure.code === "no_history" ? "没有可撤销的换源记录" : "换回失败：" + failure.message.slice(0, 60), "error");
  } finally {
    switching.value = 0;
  }
}

// 换了一本书/一章就重新给自动升级的机会，不然上一本的「已自动深度搜索过」会一直压着。
watch(cacheKey, () => {
  autoDeep = false;
});

// 换一批候选后原来的分组可能已经不存在：回到「全部」，别让列表莫名空掉。
watch(groups, (list) => {
  if (groupFilter.value !== "all" && !list.includes(groupFilter.value)) groupFilter.value = "all";
});

watch(
  () => props.modelValue,
  (value) => {
    if (!value) {
      stop();
      return;
    }
    prefs.value = loadSwitchPrefs();
    // 缓存由服务端在 start 事件里回，打开即出结果；这里不再自己存一份。
    void loadHistory();
    void start(false);
  },
  { immediate: true },
);
</script>

<template>
  <BottomSheet
    inline
    :open="open"
    title="换源"
    :subtitle="`第 ${chapterIndex + 1} 章${chapterTitle ? ' · ' + chapterTitle : ''}`"
    tall
    @close="open = false"
  >
    <div class="switch-sheet">
      <div v-if="currentSourceName || currentSourceId" class="switch-current">
        <span class="switch-current-label">当前源</span>
        <strong class="switch-current-name">{{ currentSourceName || `源 #${currentSourceId}` }}</strong>
        <span v-if="currentHealthText" class="switch-tag health" :class="'health-' + currentSourceHealthState" :title="'当前源' + currentHealthText">
          {{ currentHealthText }}
        </span>
        <span class="switch-current-meta">{{ formatCharCount(currentChars) || "字数未知" }}{{ currentChapters ? ` · ${currentChapters} 章` : "" }}</span>
        <span class="switch-current-excluded">候选已排除</span>
      </div>

      <div class="switch-bar">
        <span class="switch-hint">{{ hint || "准备中…" }}</span>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="phase === 'searching'" @click="start(false, true)">
          {{ phase === "searching" ? "搜索中…" : "重新搜索" }}
        </button>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          :disabled="switching > 0 || !canUndo"
          :title="canUndo ? (lastSourceName ? `换回 ${lastSourceName}` : '换回上一次的源') : '还没有可撤销的换源记录'"
          @click="undo"
        >
          {{ undoLabel }}
        </button>
      </div>

      <div class="switch-search">
        <input
          v-model="sourceQuery"
          type="search"
          placeholder="搜索源名 / 分组 / 域名"
          aria-label="搜索候选书源"
          autocomplete="off"
        />
        <button v-if="sourceQuery" type="button" class="switch-search-clear" @click="sourceQuery = ''">清除</button>
      </div>
      <p v-if="lastSwitchLabel" class="switch-tip switch-last">
        {{ lastSwitchLabel }}<template v-if="lastSwitchKind === 'auto'"> · 自动换源也可撤销</template>
      </p>

      <p class="switch-tip switch-keep">换源后会按你正在读的段落定位，读到哪里换过去还在哪里。</p>

      <section v-if="history.length || historyLoading" class="switch-history">
        <button class="switch-history-toggle" type="button" @click="showHistory = !showHistory">
          <span>换源记录</span>
          <span class="switch-history-count">{{ history.length }}</span>
          <span class="switch-history-action">{{ showHistory ? "收起" : "展开" }}</span>
        </button>
        <div v-if="showHistory" class="switch-history-list">
          <div v-for="item in history" :key="item.id" class="switch-history-row">
            <span class="switch-history-kind" :class="item.kind">{{ item.kind === "auto" ? "自动" : "手动" }}</span>
            <span class="switch-history-from">从「{{ item.sourceName }}」换走</span>
            <span class="switch-history-meta">{{ item.chapters }} 章 · {{ historyTime(item.createdAt) }}</span>
          </div>
          <p class="switch-history-note">「从谁换走」是换源前的书源；自动换源同样可以从这里换回。</p>
        </div>
      </section>

      <div v-if="shorter" class="switch-shorter">
        <span class="switch-shorter-text">{{ shorter.text }}</span>
        <button class="btn btn-ghost btn-sm" type="button" :disabled="switching > 0" @click="pick(shorter.item, true)">
          仍要换
        </button>
        <button class="btn btn-ghost btn-sm" type="button" @click="shorter = null">取消</button>
      </div>

      <p v-for="item in builtins" :key="item.id" class="switch-tip switch-builtin">
        {{ item.name }}（内置）：{{ builtinText(item) }}
      </p>

      <section v-if="recommended" class="switch-recommend">
        <div class="switch-recommend-head">
          <span class="switch-tag recommend">综合推荐</span>
          <strong class="switch-recommend-name">{{ recommended.candidate.sourceName }}</strong>
          <span v-if="recommended.candidate.mirrors && recommended.candidate.mirrors > 1" class="switch-tag mirror">
            等 {{ recommended.candidate.mirrors }} 个镜像
          </span>
          <span class="switch-recommend-meta">
            {{ formatCharCount(recommended.candidate.chars) || "字数未知" }} · {{ recommended.candidate.chapters }} 章
          </span>
        </div>
        <p class="switch-recommend-reason">{{ recommended.reason }}</p>
        <p v-if="!isPreviewOpen(recommended.candidate) && recommended.candidate.excerpt" class="switch-recommend-excerpt">{{ recommended.candidate.excerpt }}</p>
        <div class="switch-recommend-actions">
          <button
            v-if="previewText(recommended.candidate)"
            class="btn btn-ghost btn-sm"
            type="button"
            @click="togglePreview(recommended.candidate)"
          >
            {{ isPreviewOpen(recommended.candidate) ? "收起试读" : "试读开头" }}
          </button>
          <button
            class="btn btn-primary btn-sm switch-recommend-go"
            type="button"
            :disabled="switching > 0"
            @click="pick(recommended.candidate)"
          >
            {{ switching === recommended.candidate.sourceId ? "切换中…" : "换到这本" }}
          </button>
        </div>
        <div v-if="isPreviewOpen(recommended.candidate)" class="switch-preview-wrap">
          <div class="switch-compare">
            <div class="switch-compare-col">
              <span class="switch-compare-label">当前源</span>
              <p class="switch-compare-text">{{ currentPreview || "当前章正文还没加载；换源仍会按段落定位。" }}</p>
            </div>
            <div class="switch-compare-col">
              <span class="switch-compare-label">{{ recommended.candidate.sourceName }}</span>
              <p class="switch-compare-text">{{ previewText(recommended.candidate) || "这个源没有返回试读。" }}</p>
            </div>
          </div>
          <p class="switch-preview-note">试读取该源本章开头约 600 字，只用于比较文风与排版；完整正文换源后再抓。</p>
        </div>
      </section>

      <div class="switch-tools">
        <div class="switch-sort" role="group" aria-label="排序方式">
          <button type="button" :class="{ active: sortMode === 'chapters' }" @click="sortMode = 'chapters'">按章数</button>
          <button type="button" :class="{ active: sortMode === 'chars' }" @click="sortMode = 'chars'">按本章字数</button>
          <button type="button" :class="{ active: sortMode === 'health' }" @click="sortMode = 'health'">按健康度</button>
          <button type="button" :class="{ active: sortMode === 'quality' }" @click="sortMode = 'quality'">按质量</button>
        </div>
        <label v-if="currentChapters" class="switch-only-more">
          <input v-model="onlyMore" type="checkbox" />
          只看更全的
        </label>
        <label class="switch-only-more">
          <input v-model="onlyMatched" type="checkbox" />
          只看章名对得上
        </label>
        <label class="switch-only-more" title="开启后在作者未知或不一致的候选上标警告，但不会隐藏它们">
          <input v-model="onlyAuthor" type="checkbox" />
          提示作者差异
        </label>
        <label v-if="groups.length > 1" class="switch-group-filter">
          <span>分组</span>
          <select v-model="groupFilter">
            <option value="all">全部</option>
            <option v-for="name in groups" :key="name || 'none'" :value="name">{{ name || "未分组" }}</option>
          </select>
        </label>
      </div>

      <div v-if="prefs.pinned.length || prefs.blocked.length" class="switch-tools switch-prefs">
        <span class="switch-hint">已置顶 {{ prefs.pinned.length }} 个源 · 已屏蔽 {{ prefs.blocked.length }} 个源</span>
        <button class="btn btn-ghost btn-sm" type="button" @click="clearPrefs">清除偏好</button>
      </div>
      <div v-if="prefs.blocked.length" class="switch-blocked">
        <span class="switch-blocked-label">已屏蔽</span>
        <button
          v-for="source in blockedSources"
          :key="source.id"
          class="switch-blocked-chip"
          type="button"
          :title="`点击恢复 ${source.name}`"
          @click="unblockSource(source.id, source.name)"
        >
          {{ source.name }}<span class="switch-blocked-x" aria-hidden="true">×</span>
        </button>
      </div>

      <p v-if="onlyMatched && mismatchCount" class="switch-tip">
        已隐藏 {{ mismatchCount }} 个章节名对不上的源（它们多半是另一本书或目录错乱），取消勾选可以看。
      </p>
      <p v-if="onlyAuthor && authorDiff" class="switch-tip">
        有 {{ authorDiff }} 个候选的作者未知或不一致，已用「作者不一致」标出；不隐藏，换之前看一眼即可。
      </p>

      <p class="switch-tip">
        章数来自各源自己的目录；字数只测「当前这一章」。速度 = 详情 + 目录 + 正文三次请求。
      </p>

      <div v-if="phase === 'searching' && deep" class="switch-deep">
        <div class="switch-progress"><i :style="{ width: percent + '%' }"></i></div>
        <div class="switch-deep-row">
          <span class="switch-deep-text">已搜 {{ searched }}/{{ totalSources || "?" }} 源</span>
          <button class="btn btn-ghost btn-sm" type="button" @click="stop">停止</button>
        </div>
      </div>
      <div v-if="phase === 'done' && unmeasuredCount > 0" class="switch-deep">
        <button class="btn btn-ghost btn-sm switch-deep-btn" type="button" @click="start(false, false)">补测这些源</button>
        <span class="switch-deep-text">还有 {{ unmeasuredCount }} 个源没测到本章字数（上一轮时间用完了），补测只重跑它们</span>
      </div>

      <div v-else-if="phase === 'done' && !deep" class="switch-deep">
        <button
          class="btn btn-ghost btn-sm switch-deep-btn"
          type="button"
          @click="start(true, poolSize > 0 && skippedSources >= poolSize)"
        >
          深度搜索全部书源
        </button>
        <span class="switch-deep-text">
          {{
            allShorter
              ? `找到的源都不超过 ${currentChapters} 章；深度搜索会逐个源取目录，约 1–2 分钟`
              : "默认只搜前几十个源；深度搜索会逐个源取目录，约 1–2 分钟"
          }}
        </span>
      </div>

      <div v-if="!visible.length" class="switch-empty">
        <template v-if="phase === 'searching'">
          {{ deep ? "正在逐个源取目录，结果会陆续出现…" : "正在并发搜索并实测各源…" }}
        </template>
        <template v-else-if="sourceQuery">
          没有匹配「{{ sourceQuery }}」的源。
          <button class="btn btn-ghost btn-sm" type="button" @click="sourceQuery = ''">清除搜索</button>
        </template>
        <template v-else-if="onlyMatched && mismatchCount">
          章名对得上的源暂时没有；已隐藏 {{ mismatchCount }} 个章名对不上的源。
          <button class="btn btn-ghost btn-sm" type="button" @click="onlyMatched = false">显示全部候选</button>
        </template>
        <template v-else-if="groupFilter !== 'all'">
          分组「{{ groupFilter || "未分组" }}」里没有符合当前筛选的源；换一个分组，或取消上面的勾选。
        </template>
        <template v-else-if="onlyMore">
          没有比当前更全的源，取消勾选「只看更全的」看看全部候选。
        </template>
        <template v-else-if="currentSkipped">
          候选里只有当前正在使用的源（已自动排除，避免换到自己）。可以重新搜索，或换回上次的源。
        </template>
        <template v-else>
          没有找到候选，稍后重试。
        </template>
      </div>

      <article v-for="item in visible" :key="item.bookUrl" class="switch-item" :class="{ 'is-fail': item.status === 'fail' }">
        <div class="switch-item-head">
          <strong class="switch-name">{{ item.sourceName }}</strong>
          <span v-if="item.sourceGroup" class="switch-tag group">{{ item.sourceGroup }}</span>
          <span v-if="item.builtin" class="switch-tag builtin">内置</span>
          <span v-if="item.status === 'warn'" class="switch-tag">信息不一致</span>
          <span v-if="item.status === 'fail'" class="switch-tag fail">不可用</span>
          <span v-if="healthText(item)" class="switch-tag health" :class="'health-' + item.sourceHealthState">{{ healthText(item) }}</span>
          <span v-if="qualityText(item)" class="switch-tag" :class="qualityBlocked(item) ? 'fail' : 'quality-warn'" :title="qualityTitle(item)">{{ qualityText(item) }}</span>
          <span v-if="matchText(item)" class="switch-tag" :class="'match-' + matchTone(item)">{{ matchText(item) }}</span>
          <span
            v-if="onlyAuthor && item.authorOk !== true"
            class="switch-tag author-diff"
            :title="item.author ? '该源作者：' + item.author : '该源没有作者信息'"
          >作者不一致</span>
          <span v-if="(item.mirrors ?? 1) > 1" class="switch-tag mirror">等 {{ item.mirrors }} 个镜像</span>
          <span class="switch-speed">{{ item.measureMs ? item.measureMs + " ms" : item.ms ? item.ms + " ms" : "…" }}</span>
          <span class="switch-pref-actions">
            <button
              class="switch-pref-btn"
              :class="{ active: isSourcePinned(prefs, item.sourceId) }"
              type="button"
              @click="togglePin(item)"
            >{{ isSourcePinned(prefs, item.sourceId) ? "已置顶" : "置顶" }}</button>
            <button class="switch-pref-btn" type="button" @click="toggleBlock(item)">屏蔽</button>
          </span>
        </div>
        <div class="switch-item-body">
          <div class="switch-metrics">
            <span class="switch-chars" :class="isMismatch(item) ? 'is-unknown' : verdictClass(item)">
              {{ charsText(item) }}
            </span>
            <span v-if="!isMismatch(item) && ratioOf(item) !== null" class="switch-ratio" :class="{ 'is-over': charVerdict(ratioOf(item)) === 'over' }">{{ ratioText(item) }}</span>
            <span class="switch-chapters">
              {{ item.chapters }} 章
              <em v-if="deltaOf(item) > 0" class="switch-delta up">+{{ deltaOf(item) }}</em>
              <em v-else-if="deltaOf(item) < 0" class="switch-delta down">{{ deltaOf(item) }}</em>
            </span>
          </div>
          <div v-if="onlyAuthor && item.authorOk !== true && item.author" class="switch-author-note">
            该源作者：{{ item.author }}
          </div>
          <div v-if="item.chapterTitle" class="switch-chapter ellipsis">
            {{ isMismatch(item) ? "它目录里的同一位置：" : "" }}「{{ item.chapterTitle }}」
          </div>
          <p v-if="!isPreviewOpen(item) && item.excerpt" class="switch-excerpt">{{ item.excerpt }}</p>
          <button
            v-if="previewText(item)"
            class="switch-preview-toggle"
            type="button"
            @click="togglePreview(item)"
          >
            {{ isPreviewOpen(item) ? "收起试读" : "试读开头 · 对比当前源" }}
          </button>
          <div v-if="item.status === 'fail' || item.measureError" class="switch-reason ellipsis">
            {{ reasonText(item) }}
          </div>
        </div>
        <button
          class="btn btn-primary btn-sm switch-go"
          type="button"
          :disabled="switching > 0 || item.status === 'fail' || measureBlocked(item) || qualityBlocked(item)"
          :title="qualityBlocked(item) ? qualityTitle(item) : measureBlocked(item) ? '这个源取不到本章正文，换过去会缺字' : item.measureError ? '这一章没取到，可能只是慢，可以换过去试试' : ''"
          @click="pick(item)"
        >
          {{ switching === item.sourceId ? "切换中…" : "换到这本" }}
        </button>
        <div v-if="isPreviewOpen(item)" class="switch-preview-wrap">
          <div class="switch-compare">
            <div class="switch-compare-col">
              <span class="switch-compare-label">当前源</span>
              <p class="switch-compare-text">{{ currentPreview || "当前章正文还没加载；换源仍会按段落定位。" }}</p>
            </div>
            <div class="switch-compare-col">
              <span class="switch-compare-label">{{ item.sourceName }}</span>
              <p class="switch-compare-text">{{ previewText(item) || "这个源没有返回试读。" }}</p>
            </div>
          </div>
          <p class="switch-preview-note">试读取该源本章开头约 600 字，只用于比较文风与排版；完整正文换源后再抓。</p>
        </div>
      </article>

      <button v-if="failedCount" class="switch-failed-toggle" type="button" @click="showFailed = !showFailed">
        {{ showFailed ? "隐藏不可用" : `显示不可用（${failedCount}）` }}
      </button>
    </div>
  </BottomSheet>
</template>
