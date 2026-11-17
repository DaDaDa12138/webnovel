<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BottomSheet from "../BottomSheet.vue";
import ReaderPreview from "./ReaderPreview.vue";
import SettingRange from "../settings/SettingRange.vue";
import {
  DEFAULT_READER_SETTINGS,
  READER_FONTS,
  READER_PAGE_WIDTHS,
  READER_RANGES,
  READER_THEMES,
  readerPalette,
  sectionDefaults,
  type ReaderFontId,
  type ReaderSettings,
  type ReaderSettingsSection,
  type ReaderThemeId,
} from "../../lib/reader-settings";
import type { ParagraphOptions } from "../../lib/reader-blocks";
import { TAP_ACTIONS, TAP_PRESETS, tapPresetOf, withTapCell, type TapAction } from "../../lib/reader-tap";
import { READOUT_FIELDS, READOUT_SLOTS, type ReadoutSlot } from "../../lib/reader-readout";
import { SLEEP_CHOICES, formatCountdown } from "../../lib/reader-sleep";
import { formatDwell } from "../../lib/reader-autoturn";
import { SETTINGS_TABS, SETTINGS_TAB_KEY, normalizeTab, type SettingsTabId } from "../../lib/reader-settings-tabs";
import { searchSettings, settingTabLabel, type SettingSearchEntry } from "../../lib/reader-settings-search";
import { useReaderFonts } from "../../composables/useReaderFonts";
import { FONT_FAMILY_PREFIX } from "../../lib/reader-fonts";
import { toast } from "../../lib/toast";
import { contrastRatio } from "../../lib/reader-contrast";

const TAP_CELL_LABELS = ["左上", "中上", "右上", "左中", "中中", "右中", "左下", "中下", "右下"];
const FONT_WEIGHTS = [
  { value: 400, label: "常规" },
  { value: 500, label: "中等" },
  { value: 600, label: "加粗" },
] as const;

/** 半屏/拖拽高度：只影响设置面板本身，不写进阅读设置，换设备不会被同步走。 */
const sheetRef = ref<InstanceType<typeof BottomSheet> | null>(null);
const sheetCompact = ref(false);

function toggleSheetSize(): void {
  sheetRef.value?.toggleCompact();
}

function onSheetResize(height: number): void {
  sheetCompact.value = height <= 64;
}

const SLOT_LABELS: Record<ReadoutSlot, string> = {
  topLeft: "左上",
  topRight: "右上",
  bottomLeft: "左下",
  bottomRight: "右下",
};

function readTab(): SettingsTabId {
  try {
    return normalizeTab(localStorage.getItem(SETTINGS_TAB_KEY));
  } catch {
    /* 隐私模式下 localStorage 可能直接抛错 */
    return "display";
  }
}

const props = defineProps<{
  modelValue: boolean;
  settings: ReaderSettings;
  chapterTitle?: string;
  /** 当前章正文，给排版预览用；没有就用内置例句。 */
  paragraphs?: string[];
  /** 可选音色：服务端配的，或本机装了的。空数组表示只能「自动」。 */
  voices?: Array<{ value: string; label: string }>;
  /** 服务端是否配置了朗读地址。 */
  ttsEnabled?: boolean;
  /** 视口够宽时才显示双页开关（窄屏铺两列会把字挤成竖条）。 */
  wide?: boolean;
  /** 睡眠定时：选中的分钟数（0 为关闭）与剩余毫秒。 */
  sleepMinutes?: number;
  sleepLeft?: number;
  /** 分页模式的每页停留毫秒（由屏高与速度换算），只用于显示。 */
  dwell?: number;
  /** 当前设置面板在改「全局」还是「本书」。 */
  scope?: "global" | "book";
  bookName?: string;
  /** 本书是否已有排版覆盖；没有时「跟随全局」不用显示。 */
  bookCustomized?: boolean;
  /** 本书手动纠正过的段落数。 */
  fixCount?: number;
}>();

const wideScreen = computed(() => props.wide === true);
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  change: [patch: Partial<ReaderSettings>];
  sleep: [minutes: number];
  "update:scope": [value: "global" | "book"];
  "reset-book": [];
  correct: [];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const tab = ref<SettingsTabId>(readTab());
const barEl = ref<HTMLElement | null>(null);

const {
  fonts: importedFonts,
  error: fontError,
  refresh: refreshFonts,
  importFile,
  remove: removeFont,
  formatBytes,
} = useReaderFonts();
const fontInput = ref<HTMLInputElement | null>(null);
const fontBusy = ref(false);
onMounted(() => {
  void refreshFonts();
});

function pickFontFile() {
  fontInput.value?.click();
}

async function onFontFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  fontBusy.value = true;
  try {
    const meta = await importFile(file);
    emit("change", { customFont: meta.family });
    toast("已导入 " + meta.name);
  } catch (err) {
    toast(err instanceof Error ? err.message : "导入字体失败", "error");
  } finally {
    fontBusy.value = false;
  }
}

function useImported(family: string) {
  emit("change", { customFont: family });
}

async function removeImported(family: string, name: string) {
  try {
    await removeFont(family);
    if (props.settings.customFont === family) emit("change", { customFont: "" });
    toast("已删除 " + name);
  } catch (err) {
    toast(err instanceof Error ? err.message : "删除字体失败", "error");
  }
}

function persistTab(id: SettingsTabId) {
  try {
    localStorage.setItem(SETTINGS_TAB_KEY, id);
  } catch {
    /* 记不住就算了 */
  }
}

function setTab(id: SettingsTabId, resetScroll = true) {
  // 本书作用域只有排版有意义，点到主题/翻页/朗读时自动回到全局，避免改了没反应。
  if (scope.value === "book" && id !== "type") emit("update:scope", "global");
  tab.value = id;
  // 切组回到顶部：上一组滚到一半再切，新一组会从中间开始，标题和分组条都不在视野里。
  if (resetScroll) barEl.value?.closest<HTMLElement>(".sheet")?.scrollTo({ top: 0 });
  persistTab(id);
}

/** 恢复默认要按两下：一下改回默认太容易误触，尤其面板里全是滑杆。 */
const resetArmed = ref(false);
const resetAllArmed = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
let resetAllTimer: ReturnType<typeof setTimeout> | undefined;

function armReset() {
  if (!resetArmed.value) {
    resetArmed.value = true;
    resetTimer = setTimeout(() => {
      resetArmed.value = false;
    }, 4000);
    return;
  }
  if (resetTimer) clearTimeout(resetTimer);
  resetArmed.value = false;
  emit("change", sectionDefaults(tab.value as ReaderSettingsSection));
}

function armResetAll() {
  if (!resetAllArmed.value) {
    resetAllArmed.value = true;
    resetAllTimer = setTimeout(() => {
      resetAllArmed.value = false;
    }, 4000);
    return;
  }
  if (resetAllTimer) clearTimeout(resetAllTimer);
  resetAllArmed.value = false;
  emit("change", { ...DEFAULT_READER_SETTINGS, paragraph: { ...DEFAULT_READER_SETTINGS.paragraph } });
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer);
  if (resetAllTimer) clearTimeout(resetAllTimer);
  if (flashTimer) clearTimeout(flashTimer);
});

function setTheme(id: ReaderThemeId) {
  emit("change", { theme: id });
}

function patch(partial: Partial<ReaderSettings>) {
  emit("change", partial);
}

/** 排版模板：把最常一起调的几项一次到位，仍可继续用滑杆微调。 */
const TYPE_PRESETS = [
  { id: "comfort", label: "舒适", hint: "19px · 1.9", patch: { fontSize: 19, lineHeight: 1.9, paraSpacing: 0.7, letterSpacing: 0, pageMargin: 16 } },
  { id: "compact", label: "紧凑", hint: "17px · 1.65", patch: { fontSize: 17, lineHeight: 1.65, paraSpacing: 0.4, letterSpacing: 0, pageMargin: 12 } },
  { id: "large", label: "大字", hint: "22px · 2.0", patch: { fontSize: 22, lineHeight: 2.0, paraSpacing: 0.9, letterSpacing: 0.02, pageMargin: 20 } },
] as const;

const activePreset = computed(() => {
  const s = props.settings;
  return (
    TYPE_PRESETS.find(
      (preset) =>
        preset.patch.fontSize === s.fontSize &&
        preset.patch.lineHeight === s.lineHeight &&
        preset.patch.paraSpacing === s.paraSpacing &&
        preset.patch.letterSpacing === s.letterSpacing &&
        preset.patch.pageMargin === s.pageMargin,
    )?.id ?? ""
  );
});

function applyPreset(preset: (typeof TYPE_PRESETS)[number]) {
  emit("change", { ...preset.patch });
}

/** 快捷排版条：字号一次一级，行距/段距一次 0.1，和滑杆的范围保持一致。 */
function bumpFont(delta: number) {
  emit("change", { fontSize: Math.max(12, Math.min(36, props.settings.fontSize + delta)) });
}
function bumpLine(delta: number) {
  emit("change", { lineHeight: Math.max(1.4, Math.min(2.6, props.settings.lineHeight + delta)) });
}
function bumpPara(delta: number) {
  emit("change", { paraSpacing: Math.max(0, Math.min(1.6, props.settings.paraSpacing + delta)) });
}

const paragraph = computed(() => props.settings.paragraph);
const smartParagraph = computed(() => paragraph.value.mode === "smart");

function patchParagraph(partial: Partial<ParagraphOptions>) {
  emit("change", { paragraph: { ...paragraph.value, ...partial } });
}

function toggleSmart(event: Event) {
  patchParagraph({ mode: (event.target as HTMLInputElement).checked ? "smart" : "off" });
}

function onSplitLength(event: Event) {
  patchParagraph({ splitLength: Number((event.target as HTMLInputElement).value) });
}

const themeBg = computed(() => READER_THEMES.find((theme) => theme.id === props.settings.theme)?.bg ?? "#faf8f3");

/** 自定义背景不是「选完就算」：显示最终正文对比度，让自动校正有据可查。 */
const customContrast = computed(() => {
  if (!props.settings.customBg) return 0;
  const palette = readerPalette(props.settings);
  return contrastRatio(palette.fg, palette.bg);
});

const activeTapPreset = computed(() => tapPresetOf(props.settings.tapGrid));

/** 倒计时归零后高亮回到「关闭」，否则会一直亮着上次选的那档。 */
const activeSleep = computed(() => ((props.sleepLeft ?? 0) > 0 ? (props.sleepMinutes ?? 0) : 0));

const voiceOptions = computed(() => props.voices ?? []);
/** 选了「服务端」但服务端没配地址时给一句解释，否则用户只会看到按钮没反应。 */
const engineHint = computed(() => {
  if (props.settings.ttsEngine === "http" && !props.ttsEnabled) return "服务端未配置朗读地址，将退回浏览器语音";
  if (props.settings.ttsEngine === "system" && typeof window !== "undefined" && !("speechSynthesis" in window)) return "当前浏览器不支持语音合成";
  return "";
});

function patchReadout(slot: ReadoutSlot, value: string) {
  emit("change", { readout: { ...props.settings.readout, [slot]: value as ReaderSettings["readout"][ReadoutSlot] } });
}

/** 改一格热区；没有「工具栏」格时把中间那格强制换回来，否则工具栏再也叫不出来。 */
function setTapCell(index: number, event: Event) {
  const value = (event.target as HTMLSelectElement).value as TapAction;
  emit("change", { tapGrid: withTapCell(props.settings.tapGrid, index, value) });
}

function onNumber(
  key: "fontSize" | "lineHeight" | "paraSpacing" | "letterSpacing" | "autoSpeed" | "ttsRate" | "dim" | "warmth" | "pageMargin" | "pagePaddingY",
  event: Event,
) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("change", { [key]: value } as Partial<ReaderSettings>);
}

function setFont(id: ReaderFontId) {
  // 内置字体与导入字体互斥：不清掉 customFont 的话，宋体/楷体按钮会「按了没反应」。
  emit("change", { fontFamily: id, customFont: "" });
}

/** 导入字体在 customFont 里存的是内部 family 名，不该出现在「本机字体名」输入框里。 */
const manualFont = computed(() =>
  props.settings.customFont.startsWith(FONT_FAMILY_PREFIX) ? "" : props.settings.customFont,
);

/** 设置面板的作用域：全局是基线，本书只覆盖排版。 */
const scope = computed<"global" | "book">(() => (props.scope === "book" ? "book" : "global"));
const bookLabel = computed(() => (props.bookName ? `《${props.bookName}》` : "本书"));
const resetLabel = computed(() => {
  if (scope.value === "book") return props.bookCustomized ? "跟随全局" : "已跟随全局";
  const label = SETTINGS_TABS.find((item) => item.id === tab.value)?.label ?? "本组";
  return resetArmed.value ? `确认恢复${label}` : `恢复${label}`;
});
const resetDisabled = computed(() => scope.value === "book" && !props.bookCustomized);

function headerReset() {
  if (scope.value === "book") {
    if (props.bookCustomized) emit("reset-book");
    return;
  }
  armReset();
}

function setScope(next: "global" | "book") {
  if (next === scope.value) return;
  emit("update:scope", next);
  // 本书只有排版覆盖，进「本书」时直接落在排版组，省得读者在主题页找不到能改的东西。
  if (next === "book" && tab.value !== "type") setTab("type");
}

watch(
  () => props.scope,
  (value) => {
    if (value === "book" && tab.value !== "type") {
      tab.value = "type";
      persistTab("type");
    }
  },
);

const query = ref("");
const searchActive = computed(() => query.value.trim().length > 0);
const searchResults = computed(() => searchSettings(query.value));
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** 搜索结果只做定位：切到对应分组，滚到锚点并短暂高亮，不复制控件。 */
function jumpTo(entry: SettingSearchEntry) {
  query.value = "";
  if (scope.value === "book" && entry.tab !== "type") emit("update:scope", "global");
  setTab(entry.tab, false);
  void nextTick(() => {
    const root = barEl.value?.closest<HTMLElement>(".sheet");
    const target = root?.querySelector<HTMLElement>(`[data-setting="${entry.target}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("setting-flash");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => target.classList.remove("setting-flash"), 1400);
  });
}

function clearSearch() {
  query.value = "";
}
</script>

<template>
  <BottomSheet
    ref="sheetRef"
    inline
    :open="open"
    title="阅读设置"
    :subtitle="chapterTitle"
    tall
    resizable
    storage-key="legado-reader-settings-sheet-height"
    @close="open = false"
    @resize="onSheetResize"
  >
    <template #head>
      <button
        class="chip setting-reset"
        :class="{ armed: resetArmed && scope === 'global' }"
        type="button"
        :disabled="resetDisabled"
        @click="headerReset"
      >
        {{ resetLabel }}
      </button>
    </template>

    <div ref="barEl" class="setting-tabs" role="tablist" aria-label="设置分组">
      <button
        v-for="item in SETTINGS_TABS"
        :key="item.id"
        class="setting-tab"
        :class="{ active: tab === item.id }"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        @click="setTab(item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="setting-scope">
      <div class="seg setting-scope-seg" role="group" aria-label="设置作用范围">
        <button type="button" :class="{ active: scope === 'global' }" @click="setScope('global')">全局</button>
        <button type="button" :class="{ active: scope === 'book' }" @click="setScope('book')">本书</button>
      </div>
      <div class="setting-scope-copy">
        <b>{{ scope === "book" ? bookLabel : "所有书" }}</b>
        <span>{{ scope === "book" ? "只覆盖字体、字号、行距、页宽和分段" : "主题、翻页、朗读与排版默认值" }}</span>
      </div>
      <button
        v-if="scope === 'book' && bookCustomized"
        class="chip setting-scope-reset"
        type="button"
        @click="emit('reset-book')"
      >
        跟随全局
      </button>
      <button
        class="chip setting-scope-size"
        :class="{ active: sheetCompact }"
        data-setting="sheet-size"
        type="button"
        :aria-pressed="sheetCompact"
        :title="sheetCompact ? '恢复设置面板高度' : '缩小面板，边看正文边调'"
        @click="toggleSheetSize"
      >
        {{ sheetCompact ? "展开" : "半屏" }}
      </button>
    </div>
    <div v-if="scope === 'book'" class="setting-scope-note">主题、翻页、朗读和热区仍使用全局设置。</div>
    <div v-else-if="bookCustomized" class="setting-scope-note">本书已有独立排版；这里改的是其他书的默认值。</div>

    <div class="setting-search">
      <input
        v-model="query"
        type="search"
        inputmode="search"
        placeholder="搜索设置，如 行距、夜间、自动翻页"
        aria-label="搜索阅读设置"
        @keydown.enter.prevent="searchResults[0] && jumpTo(searchResults[0])"
        @keydown.esc.prevent="clearSearch"
      />
      <button v-if="searchActive" class="setting-search-clear" type="button" aria-label="清除搜索" @click="clearSearch">×</button>
    </div>
    <div v-if="searchActive" class="setting-search-results" role="listbox" aria-label="设置搜索结果">
      <button
        v-for="entry in searchResults"
        :key="entry.key"
        class="setting-search-hit"
        type="button"
        role="option"
        @click="jumpTo(entry)"
      >
        <span class="setting-search-hit-main">
          <b>{{ entry.label }}</b>
          <em>{{ entry.hint }}</em>
        </span>
        <span class="setting-search-hit-tab">{{ settingTabLabel(entry.tab) }}</span>
      </button>
      <div v-if="!searchResults.length" class="setting-search-empty">
        没有找到「{{ query }}」，试试「字号」「夜间」「翻页」或「朗读」。
      </div>
    </div>

    <div v-show="tab === 'display' || tab === 'type'" class="setting-preview-wrap">
      <ReaderPreview v-if="!sheetCompact" :settings="settings" :paragraphs="paragraphs" :title="chapterTitle" compact />
      <div v-else class="setting-compact-hint">半屏模式：直接对照正文调整，展开可看排版示例。</div>
      <div class="setting-quick" role="group" aria-label="快捷排版">
        <button type="button" aria-label="减小字号" @click="bumpFont(-1)">A−</button>
        <button type="button" aria-label="增大字号" @click="bumpFont(1)">A+</button>
        <span class="setting-quick-sep" aria-hidden="true" />
        <button type="button" @click="bumpLine(-0.1)">行距 −</button>
        <button type="button" @click="bumpLine(0.1)">行距 +</button>
        <span class="setting-quick-sep" aria-hidden="true" />
        <button type="button" @click="bumpPara(-0.1)">段距 −</button>
        <button type="button" @click="bumpPara(0.1)">段距 +</button>
      </div>
    </div>

    <div v-show="tab === 'display'" class="setting-panel" role="tabpanel" aria-label="显示">
      <div class="setting-block" data-setting="theme">
        <div class="setting-label">主题</div>
        <div class="theme-row">
          <button
            v-for="theme in READER_THEMES"
            :key="theme.id"
            class="theme-dot"
            :class="{ active: settings.theme === theme.id }"
            :style="{ background: theme.bg, color: theme.fg, borderColor: theme.accent }"
            :title="theme.label"
            @click="setTheme(theme.id)"
          >
            <span>{{ theme.label }}</span>
          </button>
        </div>
      </div>

      <div class="setting-block" data-setting="background">
        <div class="setting-label">背景颜色</div>
        <div class="color-row">
          <input
            type="color"
            class="color-input"
            :value="settings.customBg || themeBg"
            aria-label="自定义背景颜色"
            @input="patch({ customBg: ($event.target as HTMLInputElement).value })"
          />
          <span class="muted">{{ settings.customBg ? "自定义 " + settings.customBg : "跟随主题「" + settings.theme + "」" }}</span>
          <span v-if="settings.customBg" class="setting-contrast" :title="'正文与背景的 WCAG 对比度，已自动校正到 4.5:1 以上'">
            {{ customContrast.toFixed(1) }}:1 · 已校正
          </span>
          <button class="chip" :disabled="!settings.customBg" @click="patch({ customBg: '' })">恢复主题</button>
        </div>
      </div>

      <div class="setting-block" data-setting="brightness">
        <div class="setting-label">亮度 <b>{{ settings.dim }}</b></div>
        <input type="range" min="0" max="100" step="1" :value="settings.dim" @input="onNumber('dim', $event)" />
      </div>

      <div class="setting-block" data-setting="warmth">
        <div class="setting-label">色温 <b>{{ settings.warmth }}</b></div>
        <input type="range" min="0" max="100" step="1" :value="settings.warmth" @input="onNumber('warmth', $event)" />
      </div>

      <div class="setting-row" data-setting="follow-system">
        <span>跟随系统深色</span>
        <label class="switch"
          ><input
            type="checkbox"
            :checked="settings.followSystemTheme"
            @change="patch({ followSystemTheme: ($event.target as HTMLInputElement).checked })"
          /><i
        /></label>
      </div>

      <div class="setting-block" data-setting="readout">
        <div class="setting-label">页角读数</div>
        <div class="readout-grid">
          <label v-for="slot in READOUT_SLOTS" :key="slot" class="readout-slot">
            <span>{{ SLOT_LABELS[slot] }}</span>
            <select :value="settings.readout[slot]" @change="patchReadout(slot, ($event.target as HTMLSelectElement).value)">
              <option v-for="field in READOUT_FIELDS" :key="field.id" :value="field.id">{{ field.label }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="setting-row" data-setting="readout-always">
        <span>常显读数（工具栏打开时也显示）</span>
        <label class="switch"
          ><input
            type="checkbox"
            :checked="settings.readoutAlways"
            @change="patch({ readoutAlways: ($event.target as HTMLInputElement).checked })"
          /><i
        /></label>
      </div>

      <div class="setting-block setting-danger" data-setting="reset-all">
        <button class="setting-reset-all" :class="{ armed: resetAllArmed }" type="button" @click="armResetAll">
          {{ resetAllArmed ? "再点一次，确认全部重置" : "恢复全部设置…" }}
        </button>
        <div class="muted">包括主题、翻页、朗读和热区；不会删除书签、划线或阅读进度。</div>
      </div>
    </div>

    <div v-show="tab === 'type'" class="setting-panel" role="tabpanel" aria-label="排版">
      <div class="setting-block" data-setting="presets">
        <div class="setting-label">排版模板</div>
        <div class="chip-row setting-presets">
          <button
            v-for="preset in TYPE_PRESETS"
            :key="preset.id"
            class="chip setting-preset"
            :class="{ active: activePreset === preset.id }"
            type="button"
            @click="applyPreset(preset)"
          >
            <b>{{ preset.label }}</b>
            <span>{{ preset.hint }}</span>
          </button>
        </div>
        <div class="muted">一次调整字号、行距、段距和边距，之后仍可细调。</div>
      </div>

      <div class="setting-block" data-setting="font">
        <div class="setting-label">字体</div>
        <div class="chip-row">
          <button
            v-for="font in READER_FONTS"
            :key="font.id"
            class="chip"
            :class="{ active: !settings.customFont && settings.fontFamily === font.id }"
            :style="{ fontFamily: font.stack }"
            @click="setFont(font.id)"
          >
            {{ font.label }}
          </button>
        </div>
        <div class="font-import">
          <button class="chip" type="button" :disabled="fontBusy" @click="pickFontFile">
            {{ fontBusy ? "正在导入…" : "导入字体文件" }}
          </button>
          <span class="font-hint">ttf / otf / woff / woff2，最大 20 MB</span>
          <input ref="fontInput" class="font-file" type="file" accept=".ttf,.otf,.woff,.woff2" @change="onFontFile" />
        </div>
        <ul v-if="importedFonts.length" class="font-list">
          <li v-for="font in importedFonts" :key="font.family" class="font-row">
            <span class="font-name">{{ font.name }}</span>
            <span class="font-size">{{ formatBytes(font.size) }}</span>
            <span v-if="settings.customFont === font.family" class="font-in-use">使用中</span>
            <button v-else class="font-use" type="button" @click="useImported(font.family)">使用</button>
            <button class="font-del" type="button" :aria-label="'删除字体 ' + font.name" @click="removeImported(font.family, font.name)">删除</button>
          </li>
        </ul>
        <div v-if="fontError" class="font-error">{{ fontError }}</div>
        <input
          class="custom-font-input"
          :value="manualFont"
          maxlength="40"
          placeholder="本机已安装的字体名（可选），如 霞鹜文楷"
          @input="patch({ customFont: ($event.target as HTMLInputElement).value })"
        />
      </div>

      <div class="setting-block" data-setting="font-size">
        <SettingRange
          dense
          label="字号"
          unit="px"
          :model-value="settings.fontSize"
          :min="READER_RANGES.fontSize.min"
          :max="READER_RANGES.fontSize.max"
          :step="READER_RANGES.fontSize.step"
          @update:model-value="patch({ fontSize: $event })"
        />
      </div>

      <div class="setting-block" data-setting="font-weight">
        <div class="setting-label">字重</div>
        <div class="chip-row">
          <button
            v-for="item in FONT_WEIGHTS"
            :key="item.value"
            class="chip"
            :class="{ active: settings.fontWeight === item.value }"
            @click="patch({ fontWeight: item.value })"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="muted">加粗会让字距略紧，长读可以选中等</div>
      </div>

      <div class="setting-block" data-setting="line-height">
        <SettingRange
          dense
          label="行距"
          :precision="1"
          :model-value="settings.lineHeight"
          :min="READER_RANGES.lineHeight.min"
          :max="READER_RANGES.lineHeight.max"
          :step="READER_RANGES.lineHeight.step"
          @update:model-value="patch({ lineHeight: $event })"
        />
      </div>

      <div class="setting-block" data-setting="para-spacing">
        <SettingRange
          dense
          label="段距"
          unit="em"
          :precision="1"
          :model-value="settings.paraSpacing"
          :min="READER_RANGES.paraSpacing.min"
          :max="READER_RANGES.paraSpacing.max"
          :step="READER_RANGES.paraSpacing.step"
          @update:model-value="patch({ paraSpacing: $event })"
        />
      </div>

      <div class="setting-block" data-setting="letter-spacing">
        <SettingRange
          dense
          label="字间距"
          unit="em"
          :precision="2"
          :model-value="settings.letterSpacing"
          :min="READER_RANGES.letterSpacing.min"
          :max="READER_RANGES.letterSpacing.max"
          :step="READER_RANGES.letterSpacing.step"
          @update:model-value="patch({ letterSpacing: $event })"
        />
      </div>

      <div class="setting-block" data-setting="page-width">
        <div class="setting-label">页宽</div>
        <div class="chip-row">
          <button
            v-for="width in READER_PAGE_WIDTHS"
            :key="width"
            class="chip"
            :class="{ active: settings.pageWidth === width }"
            @click="patch({ pageWidth: width })"
          >
            {{ width }}
          </button>
        </div>
      </div>

      <div class="setting-block" data-setting="page-margin">
        <SettingRange
          dense
          label="左右边距"
          unit="px"
          hint="窄屏上边距越小，一行字越多"
          :model-value="settings.pageMargin"
          :min="READER_RANGES.pageMargin.min"
          :max="READER_RANGES.pageMargin.max"
          :step="READER_RANGES.pageMargin.step"
          @update:model-value="patch({ pageMargin: $event })"
        />
      </div>

      <div class="setting-block" data-setting="page-padding-y">
        <SettingRange
          dense
          label="上下留白"
          unit="px"
          hint="正文离顶栏和底栏更远一点，长读不压抑"
          :model-value="settings.pagePaddingY"
          :min="READER_RANGES.pagePaddingY.min"
          :max="READER_RANGES.pagePaddingY.max"
          :step="READER_RANGES.pagePaddingY.step"
          @update:model-value="patch({ pagePaddingY: $event })"
        />
      </div>

      <div class="setting-row" data-setting="indent">
        <span>首行缩进</span>
        <label class="switch"><input type="checkbox" :checked="settings.indent" @change="patch({ indent: ($event.target as HTMLInputElement).checked })" /><i /></label>
      </div>

      <div class="setting-row" data-setting="justify">
        <span>两端对齐</span>
        <label class="switch"><input type="checkbox" :checked="settings.justify" @change="patch({ justify: ($event.target as HTMLInputElement).checked })" /><i /></label>
      </div>

      <div class="setting-row" data-setting="dialog-indent">
        <span>对话悬挂缩进<em class="setting-hint">引号对话不缩首行</em></span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="paragraph.dialogIndent"
            @change="patchParagraph({ dialogIndent: ($event.target as HTMLInputElement).checked })"
          /><i />
        </label>
      </div>

      <div class="setting-row" data-setting="paragraph">
        <span>智能分段</span>
        <label class="switch"><input type="checkbox" :checked="smartParagraph" @change="toggleSmart" /><i /></label>
      </div>
      <div class="setting-row" data-setting="special">
        <span>特殊段落样式<em class="setting-hint">诗歌 / 书信 / 短信</em></span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="paragraph.special"
            @change="patchParagraph({ special: ($event.target as HTMLInputElement).checked })"
          /><i />
        </label>
      </div>
      <div class="setting-block setting-hint setting-special-hint">
        识别诗歌、书信、短信、系统提示和分节线；只改展示，不改原文和阅读位置。
      </div>
      <div class="setting-row" data-setting="author-note">
        <span>作者话<em class="setting-hint">章首章末的更新说明</em></span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="paragraph.authorNote"
            @change="patchParagraph({ authorNote: ($event.target as HTMLInputElement).checked })"
          /><i />
        </label>
      </div>
      <div class="setting-row" data-setting="subhead">
        <span>小标题<em class="setting-hint">长段之间的短行</em></span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="paragraph.subhead"
            @change="patchParagraph({ subhead: ($event.target as HTMLInputElement).checked })"
          /><i />
        </label>
      </div>
      <div v-if="smartParagraph" class="setting-sub">
        <div class="setting-row">
          <span>合并硬换行</span>
          <label class="switch">
            <input
              type="checkbox"
              :checked="paragraph.mergeWrapped"
              @change="patchParagraph({ mergeWrapped: ($event.target as HTMLInputElement).checked })"
            /><i />
          </label>
        </div>
        <div class="setting-row">
          <span>长段细分</span>
          <label class="switch">
            <input
              type="checkbox"
              :checked="paragraph.splitLong"
              @change="patchParagraph({ splitLong: ($event.target as HTMLInputElement).checked })"
            /><i />
          </label>
        </div>
        <div class="setting-block setting-sub-block">
          <div class="setting-label">细分长度 <b>{{ paragraph.splitLength }} 字</b></div>
          <input
            type="range"
            min="120"
            max="400"
            step="20"
            :value="paragraph.splitLength"
            :disabled="!paragraph.splitLong"
            @input="onSplitLength"
          />
        </div>
        <div class="setting-row">
          <span>对话独立成段</span>
          <label class="switch">
            <input
              type="checkbox"
              :checked="paragraph.splitDialogue"
              @change="patchParagraph({ splitDialogue: ($event.target as HTMLInputElement).checked })"
            /><i />
          </label>
        </div>
        <div class="setting-row">
          <span>去掉重复章标题</span>
          <label class="switch">
            <input
              type="checkbox"
              :checked="paragraph.dedupeTitle"
              @change="patchParagraph({ dedupeTitle: ($event.target as HTMLInputElement).checked })"
            /><i />
          </label>
        </div>
      </div>
      <div class="setting-block setting-hint">
        智能分段只改排版，不改原文，也不移动阅读进度、书签和划线。
      </div>
      <div class="setting-correct">
        <div class="setting-correct-text">
          <b>段落识别不对？</b>
          <em>点正文段落，手动改成正文、作者话或小标题。</em>
          <span v-if="fixCount" class="setting-correct-count">本书已纠正 {{ fixCount }} 段</span>
        </div>
        <button type="button" class="chip setting-correct-btn" @click="emit('correct')">开始纠正</button>
      </div>
    </div>

    <div v-show="tab === 'turn'" class="setting-panel" role="tabpanel" aria-label="翻页">
      <div class="setting-row" data-setting="mode">
        <span>翻页模式</span>
        <div class="seg">
          <button :class="{ active: settings.mode === 'scroll' }" @click="patch({ mode: 'scroll' })">滚动</button>
          <button :class="{ active: settings.mode === 'page' }" @click="patch({ mode: 'page' })">翻页</button>
        </div>
      </div>

      <div v-if="settings.mode === 'page'" class="setting-row" data-setting="page-animation">
        <span>翻页动画</span>
        <div class="seg">
          <button :class="{ active: settings.pageAnimation === 'slide' }" @click="patch({ pageAnimation: 'slide' })">滑动</button>
          <button :class="{ active: settings.pageAnimation === 'fade' }" @click="patch({ pageAnimation: 'fade' })">淡入</button>
          <button :class="{ active: settings.pageAnimation === 'none' }" @click="patch({ pageAnimation: 'none' })">无</button>
        </div>
      </div>

      <div v-if="settings.mode === 'page' && wideScreen" class="setting-row" data-setting="spread">
        <span>双页排版<em class="setting-hint">宽屏</em></span>
        <label class="switch"
          ><input
            type="checkbox"
            :checked="settings.spread"
            @change="patch({ spread: ($event.target as HTMLInputElement).checked })"
          /><i
        /></label>
      </div>

      <div v-if="wideScreen" class="setting-row" data-setting="desktop-catalog">
        <span>常驻目录<em class="setting-hint">宽屏</em></span>
        <label class="switch"
          ><input
            type="checkbox"
            :checked="settings.desktopCatalog"
            @change="patch({ desktopCatalog: ($event.target as HTMLInputElement).checked })"
          /><i
        /></label>
      </div>

      <div class="setting-row" data-setting="edge-adjust">
        <span>左右边缘上下滑<em class="setting-hint">亮度 / 字号</em></span>
        <label class="switch"
          ><input
            type="checkbox"
            :checked="settings.edgeAdjust"
            @change="patch({ edgeAdjust: ($event.target as HTMLInputElement).checked })"
          /><i
        /></label>
      </div>

      <div class="setting-row" data-setting="swipe-turn">
        <span>左右滑动翻页</span>
        <label class="switch"
          ><input
            type="checkbox"
            :checked="settings.swipeTurn"
            @change="patch({ swipeTurn: ($event.target as HTMLInputElement).checked })"
          /><i
        /></label>
      </div>

      <div class="setting-block" data-setting="tap-grid">
        <div class="setting-label">点击热区</div>
        <div class="chip-row">
          <button
            v-for="preset in TAP_PRESETS"
            :key="preset.id"
            class="chip"
            :class="{ active: activeTapPreset === preset.id }"
            @click="patch({ tapGrid: [...preset.grid] })"
          >
            {{ preset.label }}
          </button>
        </div>
        <div class="tap-grid">
          <select
            v-for="(action, i) in settings.tapGrid"
            :key="i"
            class="tap-cell"
            :value="action"
            :aria-label="'热区 ' + TAP_CELL_LABELS[i]"
            @change="setTapCell(i, $event)"
          >
            <option v-for="item in TAP_ACTIONS" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </div>
        <div class="muted">九宫格按屏幕三等分；至少保留一格「工具栏」，否则会自动放回中间</div>
      </div>

      <div class="setting-row" data-setting="auto-hide">
        <span>点击中间隐藏工具栏</span>
        <label class="switch"><input type="checkbox" :checked="settings.autoHide" @change="patch({ autoHide: ($event.target as HTMLInputElement).checked })" /><i /></label>
      </div>

      <div class="setting-row" data-setting="auto-scroll">
        <span>自动阅读</span>
        <label class="switch"><input type="checkbox" :checked="settings.autoScroll" @change="patch({ autoScroll: ($event.target as HTMLInputElement).checked })" /><i /></label>
      </div>

      <div class="setting-row" data-setting="keep-awake">
        <span>阅读时屏幕常亮<em class="setting-hint">自动翻页与朗读时始终开启</em></span>
        <label class="switch"
          ><input
            type="checkbox"
            :checked="settings.keepAwake"
            @change="patch({ keepAwake: ($event.target as HTMLInputElement).checked })"
          /><i
        /></label>
      </div>

      <div v-if="settings.autoScroll" class="setting-block" data-setting="auto-speed">
        <div class="setting-label">
          {{ settings.mode === "page" ? "自动翻页间隔" : "自动阅读速度" }}
          <b>{{ settings.mode === "page" ? formatDwell(dwell ?? 0) : settings.autoSpeed + " px/s" }}</b>
        </div>
        <input type="range" min="20" max="160" step="5" :value="settings.autoSpeed" @input="onNumber('autoSpeed', $event)" />
        <div v-if="settings.mode === 'page'" class="muted">按屏高换算：数值越大，每页停留越短</div>
      </div>

      <div class="setting-block" data-setting="sleep">
        <div class="setting-label">
          睡眠定时
          <b v-if="(sleepLeft ?? 0) > 0">{{ formatCountdown(sleepLeft ?? 0) }}</b>
          <em v-else class="setting-hint">到点停止朗读与自动阅读</em>
        </div>
        <div class="chip-row">
          <button
            v-for="choice in SLEEP_CHOICES"
            :key="choice.minutes"
            class="chip"
            :class="{ active: activeSleep === choice.minutes }"
            @click="emit('sleep', choice.minutes)"
          >
            {{ choice.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-show="tab === 'speech'" class="setting-panel" role="tabpanel" aria-label="朗读">
      <div class="setting-block" data-setting="tts-engine">
        <div class="setting-label">朗读引擎</div>
        <div class="chip-row">
          <button class="chip" :class="{ active: settings.ttsEngine === 'auto' }" @click="patch({ ttsEngine: 'auto' })">自动</button>
          <button class="chip" :class="{ active: settings.ttsEngine === 'system' }" @click="patch({ ttsEngine: 'system' })">浏览器</button>
          <button
            class="chip"
            :class="{ active: settings.ttsEngine === 'http' }"
            :disabled="!ttsEnabled"
            @click="patch({ ttsEngine: 'http' })"
          >
            服务端
          </button>
        </div>
        <div v-if="engineHint" class="muted">{{ engineHint }}</div>
        <label v-if="voiceOptions.length" class="voice-select">
          <span>音色</span>
          <select :value="settings.ttsVoice" @change="patch({ ttsVoice: ($event.target as HTMLSelectElement).value })">
            <option value="">自动</option>
            <option v-for="voice in voiceOptions" :key="voice.value" :value="voice.value">{{ voice.label }}</option>
          </select>
        </label>
      </div>

      <div class="setting-block" data-setting="tts-rate">
        <div class="setting-label">朗读语速 <b>{{ settings.ttsRate.toFixed(1) }}×</b></div>
        <input type="range" min="0.6" max="1.8" step="0.1" :value="settings.ttsRate" @input="onNumber('ttsRate', $event)" />
      </div>
    </div>
  </BottomSheet>
</template>
