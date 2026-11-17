<template>
  <section class="page">
    <header class="page-head">
      <div class="row">
        <div class="grow">
          <h1 class="page-title">发现</h1>
          <p class="page-sub">{{ subtitle }}</p>
        </div>
        <button class="source-picker-btn" @click="showPicker = true">
          <span class="dot" :class="healthClass(sourceId)" />
          <span class="ellipsis">{{ currentName }}</span>
          <span class="muted">切换</span>
        </button>
      </div>
      <div class="explore-toolbar">
        <div v-if="showRankTab" class="seg explore-tabs">
          <button :class="{ active: tab === 'category' }" @click="switchTab('category')">分类</button>
          <button :class="{ active: tab === 'rank' }" @click="switchTab('rank')">
            榜单<span v-if="rankGroups.length > 1" class="tab-count">{{ rankGroups.length }}</span>
          </button>
        </div>
        <div class="explore-view" role="group" aria-label="显示方式">
          <button
            type="button"
            :class="{ active: layout === 'list' }"
            aria-label="列表显示"
            title="列表显示"
            @click="setLayout('list')"
          >
            ☰
          </button>
          <button
            type="button"
            :class="{ active: layout === 'grid' }"
            aria-label="网格显示"
            title="网格显示"
            @click="setLayout('grid')"
          >
            ▦
          </button>
        </div>
        <button
          v-if="groups.length && !hasSections && !isShushan && !isDhl"
          class="rank-config-btn"
          type="button"
          title="手动标记这个书源的榜单入口"
          @click="openRankEditor"
        >
          榜单设置
        </button>
      </div>
    </header>

    <div v-if="isShushan && shushan" class="ss-bar">
      <button class="ss-chip" type="button" @click="picker = 'gender'">
        <span class="ss-label">性别</span>
        <span class="ss-value">{{ shushan.gender === "girl" ? "♀ 女频" : "♂ 男频" }}</span>
      </button>
      <button class="ss-chip" type="button" @click="picker = 'mode'">
        <span class="ss-label">模式</span>
        <span class="ss-value">{{ modeLabel }}</span>
      </button>
      <button class="ss-chip" type="button" @click="picker = 'site'">
        <span class="ss-label">源站</span>
        <span class="ss-value ellipsis">{{ shushan.site || "聚合" }}</span>
      </button>
      <button v-if="shushan.site === '晋江'" class="ss-chip" type="button" @click="picker = 'tag'">
        <span class="ss-label">频道</span>
        <span class="ss-value">{{ shushan.tag || "言情" }}</span>
      </button>
    </div>

    <div v-if="isDhl && dhl" class="ss-bar dhl-bar">
      <button class="ss-chip" type="button" @click="picker = 'gender'">
        <span class="ss-label">频道</span>
        <span class="ss-value">{{ dhl.gender === "女频" ? "♀ 女频" : "♂ 男频" }}</span>
      </button>
      <button class="ss-chip" type="button" @click="picker = 'mode'">
        <span class="ss-label">模式</span>
        <span class="ss-value">{{ dhlModeLabel }}</span>
      </button>
      <button class="ss-chip" type="button" @click="picker = 'site'">
        <span class="ss-label">平台</span>
        <span class="ss-value ellipsis">{{ dhl.source || "番茄" }}</span>
      </button>
      <template v-if="dhlFilters">
        <button class="ss-chip" type="button" @click="picker = 'word'">
          <span class="ss-label">字数</span>
          <span class="ss-value">{{ dhl.filters.word }}</span>
        </button>
        <button class="ss-chip" type="button" @click="picker = 'status'">
          <span class="ss-label">状态</span>
          <span class="ss-value">{{ dhl.filters.status }}</span>
        </button>
        <button class="ss-chip" type="button" @click="picker = 'sort'">
          <span class="ss-label">排序</span>
          <span class="ss-value">{{ dhl.filters.sort }}</span>
        </button>
      </template>
    </div>
    <p v-if="isDhl && dhl && dhl.mode !== '小说'" class="ss-note">
      当前是「{{ dhl.mode }}」模式：可以浏览发现内容；播放器和图片阅读器还没接入，书籍详情里暂不能加入书架。
    </p>

    <template v-if="tab === 'category'">
      <div v-if="visibleCategoryGroups.length" class="category-head">
        <div class="category-head-title">
          <span class="category-head-label">分类浏览</span>
          <span class="category-head-meta">{{ visibleCategoryGroups.length }} 个分类</span>
          <span class="category-head-hint">拖动或方向键浏览</span>
        </div>
        <button
          class="category-all"
          type="button"
          aria-haspopup="dialog"
          :aria-expanded="showGroupPicker"
          title="打开全部分类"
          @click="openGroupPicker"
        >
          <span aria-hidden="true">⌕</span> 全部分类
        </button>
      </div>

      <div
        v-if="sections.length > 1"
        class="scroll-wrap section-wrap"
        :class="{ 'can-left': sectionScroll.state.canLeft, 'can-right': sectionScroll.state.canRight }"
      >
        <div
          ref="sectionScroller"
          class="section-scroller"
          :class="{ 'is-dragging': sectionScroll.state.dragging }"
          role="group"
          aria-label="内容频道，可拖动或使用左右方向键浏览"
          title="按住拖动，或使用左右方向键浏览"
          tabindex="0"
          @pointerdown="sectionScroll.onPointerDown"
          @click.capture="sectionScroll.onClickCapture"
          @keydown="sectionScroll.onKeydown"
        >
          <button
            type="button"
            class="section-chip"
            :class="{ active: !activeSection }"
            :aria-pressed="!activeSection"
            @click="pickSection('')"
          >
            全部
          </button>
          <button
            v-for="section in sections"
            :key="section.name"
            type="button"
            class="section-chip"
            :class="{ active: activeSection === section.name }"
            :aria-pressed="activeSection === section.name"
            @click="pickSection(section.name)"
          >
            {{ section.name }}<span class="section-count">{{ section.count }}</span>
          </button>
        </div>
        <div v-if="sectionScroll.state.overflowing" class="scroll-tools" role="group" aria-label="频道滚动">
          <button
            type="button"
            class="scroll-tool"
            :disabled="!sectionScroll.state.canLeft"
            aria-label="向左滚动频道"
            @click="sectionScroll.scrollBy(-1)"
          >
            ‹
          </button>
          <button
            type="button"
            class="scroll-tool"
            :disabled="!sectionScroll.state.canRight"
            aria-label="向右滚动频道"
            @click="sectionScroll.scrollBy(1)"
          >
            ›
          </button>
        </div>
      </div>

      <div
        v-if="visibleCategoryGroups.length"
        class="scroll-wrap group-wrap"
        :class="{ 'can-left': groupScroll.state.canLeft, 'can-right': groupScroll.state.canRight }"
      >
        <div
          ref="groupScroller"
          class="group-scroller"
          :class="{ 'is-dragging': groupScroll.state.dragging }"
          role="group"
          aria-label="分类，可拖动或使用左右方向键浏览"
          title="按住拖动，或使用左右方向键浏览"
          tabindex="0"
          @pointerdown="groupScroll.onPointerDown"
          @click.capture="groupScroll.onClickCapture"
          @keydown="groupScroll.onKeydown"
        >
          <button
            v-for="entry in visibleCategoryGroups"
            :key="entry.group.url"
            type="button"
            class="group-chip"
            :class="{ active: entry.index === groupIndex }"
            :aria-pressed="entry.index === groupIndex"
            @click="selectGroup(entry.index)"
          >
            {{ entry.group.title }}
          </button>
        </div>
        <div v-if="groupScroll.state.overflowing" class="scroll-tools group-tools" role="group" aria-label="分类滚动">
          <button
            type="button"
            class="scroll-tool"
            :disabled="!groupScroll.state.canLeft"
            aria-label="向左滚动分类"
            @click="groupScroll.scrollBy(-1)"
          >
            ‹
          </button>
          <button
            type="button"
            class="scroll-tool"
            :disabled="!groupScroll.state.canRight"
            aria-label="向右滚动分类"
            @click="groupScroll.scrollBy(1)"
          >
            ›
          </button>
        </div>
      </div>

      <div v-if="error" class="card explore-error">
        <p class="explore-error-title">这个书源没抓到内容</p>
        <p class="explore-error-detail">{{ error }}</p>
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <button class="btn btn-tonal" :disabled="loading" @click="retryExplore">重试</button>
          <button class="btn btn-tonal" @click="showPicker = true">换个书源</button>
          <button v-if="!isDhl" class="btn btn-primary" :disabled="autoTrying" @click="autoFind">
            {{ autoTrying ? autoProgress : "自动找可用的源" }}
          </button>
        </div>
        <p class="muted small" style="margin-top: 8px">
          <template v-if="isDhl">大灰狼聚合的发现页来自上游线路；某个平台报错时，换平台或稍后再试通常就好。</template>
          <template v-else>发现页依赖书源的「发现/分类」规则，规则失效或站点改版时会失败；换一个带绿色圆点的书源通常可用。</template>
        </p>
      </div>

      <ExploreBookList
        v-else
        :items="items"
        :source-id="sourceId"
        :layout="layout"
        :loading="loading || loadingMore"
        :has-more="hasMore"
        :empty-text="'「' + currentGroupTitle + '」这个分类没有书，换个分类试试。'"
        @open="open"
        @more="loadMore"
      />
    </template>

    <template v-else>
      <div class="rank-head">
        <div class="grow">
          <p class="rank-title">{{ rankPicked ? rankPicked.title : "本源的榜单" }}</p>
          <p class="rank-sub">
            <template v-if="rankPicked">{{ rankBooks.length }} 本已加载 · 来自「{{ currentName }}」</template>
            <template v-else>{{ rankRows.length }} 个榜单 · 只列当前书源「{{ currentName }}」</template>
          </p>
        </div>
        <button v-if="rankPicked" class="icon-chip" @click="closeRank">← 全部榜单</button>
      </div>

      <template v-if="rankPicked">
        <div v-if="rankError" class="card explore-error">
          <p class="explore-error-title">这个榜单没抓到内容</p>
          <p class="explore-error-detail">{{ rankError }}</p>
          <button class="btn btn-tonal" @click="closeRank">换个榜单</button>
        </div>
        <ExploreBookList
          v-else
          :items="rankBooks"
          :source-id="sourceId"
          :layout="layout"
          :loading="rankLoading || rankLoadingMore"
          :has-more="rankHasMore"
          :empty-text="'「' + rankPicked.title + '」暂时没有书。'"
          @open="open"
          @more="loadRankMore"
        />
      </template>

      <template v-else-if="rankRows.length">
        <div class="rank-list">
          <button v-for="(row, i) in rankRows" :key="row.url" :ref="(el) => observeRankRow(el, row)" class="rank-row" @click="openRank(row)">
            <span class="rank-no">{{ String(i + 1).padStart(2, "0") }}</span>
            <span class="rank-row-main">
              <span class="rank-row-title">{{ row.title }}</span>
              <span class="rank-row-meta">
                <template v-if="rankSamples[row.url]?.length">{{ rankSamples[row.url].length }} 个预览</template>
                <template v-else-if="rankSamplePending[row.url]">正在取预览…</template>
                <template v-else>点开查看</template>
              </span>
              <span v-if="rankSamples[row.url]?.length" class="rank-row-covers">
                <BookCover
                  v-for="(sample, si) in rankSamples[row.url].slice(0, 3)"
                  :key="si"
                  :url="sample.coverUrl"
                  :source-id="sourceId"
                  :name="sample.name"
                  :width="28"
                  :height="38"
                  :radius="4"
                  :initial-font="8"
                />
              </span>
              <span v-if="rankSamples[row.url]?.length" class="rank-row-names">{{ sampleNames(row.url) }}</span>
            </span>
            <span class="rank-row-arrow" aria-hidden="true">›</span>
          </button>
        </div>
        <div class="explore-bottom">
          共 {{ rankRows.length }} 个榜单 · 预览按当前书源实时抓取
        </div>
      </template>

      <div v-else class="card explore-error">
        <p class="explore-error-title">这个书源没有榜单入口</p>
        <p class="explore-error-detail">
          它的发现规则里只有分类。去「分类」里翻一翻，或者切换一个带榜单的书源。
        </p>
        <button class="btn btn-tonal" @click="switchTab('category')">去分类看看</button>
      </div>
    </template>

    <BottomSheet
      :open="showRankEditor"
      title="榜单入口"
      :subtitle="currentName + ' · ' + groups.length + ' 个入口'"
      @close="showRankEditor = false"
    >
      <div class="rank-editor">
        <p class="muted small">勾选属于「榜单」的入口。保存后只看勾选的；一个都不勾则恢复按标题自动识别。</p>
        <div class="rank-options">
          <label v-for="group in groups" :key="group.url" class="rank-option">
            <input type="checkbox" :checked="rankDraft.has(group.url)" @change="toggleRankDraft(group.url)" />
            <span class="ellipsis">{{ group.title }}</span>
            <em v-if="splitRankGroups(groups).ranks.some((item) => item.url === group.url)" class="rank-auto">自动识别</em>
          </label>
        </div>
        <div class="row" style="gap: 10px; margin-top: 12px">
          <button class="btn btn-primary grow" type="button" @click="saveRankEditor">保存</button>
          <button class="btn btn-ghost" type="button" @click="resetRankEditor">恢复自动识别</button>
        </div>
      </div>
    </BottomSheet>

    <BottomSheet :open="picker !== ''" :title="pickerTitle" @close="picker = ''">
      <div class="ss-options">
        <button
          v-for="option in pickerOptions"
          :key="option.value"
          class="ss-option"
          :class="{ active: option.value === pickerCurrent }"
          type="button"
          @click="chooseOption(option.value)"
        >
          <span class="ellipsis">{{ option.label }}</span>
          <span v-if="option.hint" class="ss-hint">{{ option.hint }}</span>
        </button>
        <p v-if="!pickerOptions.length" class="loading">正在读取源站清单…</p>
      </div>
    </BottomSheet>

    <BottomSheet
      :open="showGroupPicker"
      title="全部分类"
      :subtitle="currentName + ' · ' + categoryGroups.length + ' 个入口'"
      tall
      @close="showGroupPicker = false"
    >
      <div class="group-picker">
        <input v-model="groupQuery" class="picker-search" placeholder="搜索分类名，例如 玄幻 / 都市 / 历史" />
        <div v-for="section in groupPickerSections.sections" :key="section.name" class="group-picker-section">
          <p class="group-picker-label">
            {{ section.name }}<span>{{ section.entries.length }}</span>
          </p>
          <div class="group-picker-grid">
            <button
              v-for="entry in section.entries"
              :key="entry.group.url"
              type="button"
              class="group-picker-item"
              :class="{ active: entry.index === groupIndex }"
              @click="pickGroupFromPicker(entry)"
            >
              {{ entry.group.title }}
            </button>
          </div>
        </div>
        <p v-if="!groupPickerSections.sections.length" class="loading">没有匹配的分类</p>
        <p v-if="groupPickerSections.truncated" class="group-picker-hint">
          匹配 {{ groupPickerSections.total }} 个，先显示前 {{ groupPickerSections.shown }} 个；输入关键词继续缩小范围。
        </p>
      </div>
    </BottomSheet>

    <BottomSheet :open="showPicker" title="选择发现书源" @close="showPicker = false">
      <template #head>
        <span class="muted">{{ sources.length }} 个</span>
      </template>
      <div class="source-sheet-body">
        <input v-model="pickerQuery" class="picker-search" placeholder="搜索书源名称或分组" />
        <label class="picker-filter">
          <input v-model="onlyRule" type="checkbox" />
          <span>只看有独立发现规则的书源</span>
        </label>
        <p class="picker-legend">
          <span class="dot ok" /> 最近可用
          <span class="dot bad" /> 最近失败
          <span class="muted">· 失败会自动换下一个源</span>
        </p>
        <div class="picker-list">
          <button
            v-for="s in filteredSources"
            :key="s.id"
            class="picker-row"
            :class="{ active: s.id === sourceId }"
            @click="pickSource(s.id)"
          >
            <span class="dot" :class="healthClass(s.id)" />
            <span class="picker-main">
              <span class="picker-name ellipsis">{{ s.name }}</span>
              <span class="picker-meta ellipsis">{{ s.group || "未分组" }}</span>
            </span>
            <span class="picker-tags">
              <span v-if="s.builtin" class="badge builtin">内置</span>
              <span v-if="s.hasExploreRule" class="badge ok">发现规则</span>
              <span v-else class="badge">搜索规则</span>
              <span v-if="s.status !== 'ok'" class="badge retest">{{ s.status }}</span>
            </span>
          </button>
          <p v-if="!filteredSources.length" class="loading">没有匹配的书源</p>
        </div>
      </div>
    </BottomSheet>

    <BottomSheet :open="Boolean(active)" title="书籍详情" @close="active = null">
      <div v-if="active" class="detail-sheet">
        <div class="row" style="gap: 12px; align-items: flex-start">
          <BookCover :url="active.coverUrl" :source-id="sourceId" :name="active.name" :width="72" />
          <div class="grow">
            <p class="source-name">{{ active.name }}</p>
            <p class="source-meta">
              <span>{{ activeDisplay?.author || "作者未知" }}</span>
              <template v-for="category in activeDisplay?.categories.slice(0, 3) ?? []" :key="category">
                <span class="detail-dot">·</span><span>{{ category }}</span>
              </template>
            </p>
            <p v-if="activeDisplay?.status || activeDisplay?.wordCountText || activeDisplay?.rating != null" class="source-meta detail-stats">
              <span v-if="activeDisplay?.status" class="detail-status" :class="'tone-' + statusTone(activeDisplay.status)">{{ activeDisplay.status }}</span>
              <span v-if="activeDisplay?.wordCountText">{{ activeDisplay.wordCountText }}</span>
              <span v-if="activeDisplay?.rating != null">{{ activeDisplay.rating }} 分</span>
            </p>
            <p v-if="activeDisplay?.lastChapter" class="source-meta">最新 {{ activeDisplay.lastChapter }}</p>
          </div>
        </div>
        <p class="intro">{{ activeDisplay?.intro || "暂无简介" }}</p>
        <p v-if="activeUnsupported" class="ss-note">
          这是「{{ activeModeLabel }}」内容：现在可以浏览榜单与目录，播放器和图片阅读器还没做，所以暂时不能加入书架。
        </p>
        <div class="row" style="gap: 10px; margin-top: 14px">
          <button class="btn btn-filled grow" :disabled="adding || activeUnsupported" @click="addActive">
            {{ activeUnsupported ? "暂不支持" : adding ? "加入中…" : "加入书架" }}
          </button>
          <button class="btn btn-ghost" @click="active = null">关闭</button>
        </div>
      </div>
    </BottomSheet>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  api,
  type DahuilangExploreState,
  type DahuilangGender,
  type DahuilangMode,
  type SearchBook,
  type ShushanExploreState,
  type ShushanMode,
} from "../api";
import BookCover from "../components/BookCover.vue";
import BottomSheet from "../components/BottomSheet.vue";
import ExploreBookList from "../components/ExploreBookList.vue";
import { useHorizontalScroller } from "../composables/useHorizontalScroller";
import { displayOf, statusTone } from "../lib/explore-display";
import { EXPLORE_BURST_PAGES, mergeBooks, parseRankOverrides, splitRankGroups } from "../lib/explore-rank";
import { toast } from "../lib/toast";

const router = useRouter();
type ExploreSource = {
  id: number;
  name: string;
  group: string;
  status: string;
  hasExploreRule: boolean;
  exploreKind: string;
  builtin?: boolean;
  builtinKind?: "shushan" | "dahuilang";
};
type ExploreGroup = { title: string; url: string; section?: string };
type Layout = "list" | "grid";

const sources = ref<ExploreSource[]>([]);
const sourceId = ref(0);
const showPicker = ref(false);
const pickerQuery = ref("");
const onlyRule = ref(false);
const autoTrying = ref(false);
const autoProgress = ref("");
const groups = ref<ExploreGroup[]>([]);
const groupIndex = ref(0);
const showGroupPicker = ref(false);
const groupQuery = ref("");
const items = ref<SearchBook[]>([]);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const error = ref("");
const active = ref<SearchBook | null>(null);
const activeDisplay = computed(() => (active.value ? displayOf(active.value) : null));
const adding = ref(false);
const tab = ref<"category" | "rank">("category");
const layout = ref<Layout>("list");

// ---------------------------------------------------------------- 书山聚合：模式 / 性别 / 源站

/** 当前书源是内置聚合源时，控制条才有意义（它一家代理几十个源站）。 */
const currentSource = computed(() => sources.value.find((s) => s.id === sourceId.value));
const isShushan = computed(() => currentSource.value?.builtinKind === "shushan");
const isDhl = computed(() => currentSource.value?.builtinKind === "dahuilang");
const shushan = ref<ShushanExploreState | null>(null);
const dhl = ref<DahuilangExploreState | null>(null);
const picker = ref<"" | "gender" | "mode" | "site" | "tag" | "word" | "status" | "sort">("");
const activeMode = ref<ShushanMode>("novel");

const modeLabel = computed(() => {
  const state = shushan.value;
  if (!state) return "小说";
  return state.modes.find((item) => item.id === state.mode)?.label ?? "小说";
});
const activeModeLabel = computed(() => shushan.value?.modes.find((item) => item.id === activeMode.value)?.label ?? "小说");
const dhlModeLabel = computed(() => dhl.value?.mode ?? "小说");
/** 听书 / 漫画 / 视频还没有播放器与图片阅读器，先只做发现。 */
const activeUnsupported = computed(
  () =>
    (isShushan.value && activeMode.value !== "novel") ||
    Boolean(isDhl.value && dhl.value && dhl.value.mode !== "小说"),
);
/** 只有番茄小说的分类接口接受字数/状态/排序筛选，榜单不吃这些参数。 */
const dhlFilters = computed(() => isDhl.value && dhl.value?.mode === "小说" && dhl.value?.source === "番茄");

const pickerTitle = computed(() => {
  if (isDhl.value) {
    if (picker.value === "gender") return "选择频道";
    if (picker.value === "mode") return "选择内容模式";
    if (picker.value === "site") return "选择平台";
    if (picker.value === "word") return "按字数筛选";
    if (picker.value === "status") return "按状态筛选";
    if (picker.value === "sort") return "排序方式";
  }
  if (picker.value === "gender") return "选择频道";
  if (picker.value === "mode") return "选择模式";
  if (picker.value === "site") return "选择源站";
  if (picker.value === "tag") return "晋江标签频道";
  return "";
});

const pickerOptions = computed<Array<{ value: string; label: string; hint?: string }>>(() => {
  if (isDhl.value) {
    const state = dhl.value;
    if (!state) return [];
    if (picker.value === "gender") {
      return [
        { value: "男频", label: "♂ 男频" },
        { value: "女频", label: "♀ 女频" },
      ];
    }
    if (picker.value === "mode") {
      return state.modes.map((item) => ({ value: item.id, label: item.label, hint: item.count + " 个平台" }));
    }
    if (picker.value === "site") {
      return state.sources.map((source) => ({ value: source, label: source }));
    }
    if (picker.value === "word") return state.filterOptions.word.map((value) => ({ value, label: value }));
    if (picker.value === "status") return state.filterOptions.status.map((value) => ({ value, label: value }));
    if (picker.value === "sort") return state.filterOptions.sort.map((value) => ({ value, label: value }));
    return [];
  }
  const state = shushan.value;
  if (!state) return [];
  if (picker.value === "gender") {
    return [
      { value: "boy", label: "♂ 男频" },
      { value: "girl", label: "♀ 女频" },
    ];
  }
  if (picker.value === "mode") {
    return state.modes.map((item) => ({ value: item.id, label: item.label, hint: item.count + " 个源站" }));
  }
  if (picker.value === "site") {
    const options: Array<{ value: string; label: string; hint?: string }> = [];
    if (state.mode === "novel") options.push({ value: "", label: "聚合（番茄分类）", hint: "36 个分类" });
    for (const site of state.sites) options.push({ value: site.name, label: site.name, hint: site.free ? "免费" : "" });
    return options;
  }
  if (picker.value === "tag") return ["言情", "纯爱", "百合", "无Cp", "多元"].map((tag) => ({ value: tag, label: tag }));
  return [];
});

const pickerCurrent = computed(() => {
  if (isDhl.value) {
    const state = dhl.value;
    if (!state) return "";
    if (picker.value === "gender") return state.gender;
    if (picker.value === "mode") return state.mode;
    if (picker.value === "site") return state.source;
    if (picker.value === "word") return state.filters.word;
    if (picker.value === "status") return state.filters.status;
    if (picker.value === "sort") return state.filters.sort;
    return "";
  }
  const state = shushan.value;
  if (!state) return "";
  if (picker.value === "gender") return state.gender;
  if (picker.value === "mode") return state.mode;
  if (picker.value === "site") return state.site;
  if (picker.value === "tag") return state.tag;
  return "";
});

async function loadShushan(): Promise<void> {
  if (!isShushan.value) {
    shushan.value = null;
    return;
  }
  try {
    shushan.value = await api.shushanExplore();
    activeMode.value = shushan.value.mode;
  } catch {
    shushan.value = null;
  }
}

async function loadDhl(): Promise<void> {
  if (!isDhl.value) {
    dhl.value = null;
    return;
  }
  try {
    dhl.value = await api.dahuilangExplore();
  } catch {
    dhl.value = null;
  }
}

async function chooseOption(value: string): Promise<void> {
  const kind = picker.value;
  picker.value = "";
  if (!kind) return;
  if (isDhl.value) {
    try {
      let next: DahuilangExploreState;
      if (kind === "gender") next = await api.dahuilangExploreSave({ gender: value as DahuilangGender });
      else if (kind === "mode") next = await api.dahuilangExploreSave({ mode: value as DahuilangMode });
      else if (kind === "site") next = await api.dahuilangExploreSave({ source: value });
      else if (kind === "word") next = await api.dahuilangExploreSave({ word: value });
      else if (kind === "status") next = await api.dahuilangExploreSave({ status: value });
      else if (kind === "sort") next = await api.dahuilangExploreSave({ sort: value });
      else return;
      dhl.value = next;
    } catch (err) {
      toast("切换失败：" + String((err as Error).message).slice(0, 40), "error");
      return;
    }
    activeSection.value = "";
    await loadGroups();
    return;
  }
  try {
    if (kind === "gender") shushan.value = await api.shushanExploreSave({ gender: value as "boy" | "girl" });
    else if (kind === "mode") shushan.value = await api.shushanExploreSave({ mode: value as ShushanMode });
    else if (kind === "site") shushan.value = await api.shushanExploreSave({ site: value });
    else shushan.value = await api.shushanExploreSave({ tag: value });
    activeMode.value = shushan.value.mode;
  } catch (err) {
    toast("切换失败：" + String((err as Error).message).slice(0, 40), "error");
    return;
  }
  activeSection.value = "";
  await loadGroups();
}

const STORE_KEY = "explore-source";
const HEALTH_KEY = "explore-health";
const LAYOUT_KEY = "explore-layout";
/** 手动标记的榜单入口：{ 书源 id: [分组 url] }。有标记时以标记为准，没标记的源仍用标题关键词自动识别。 */
const RANK_KEY = "explore-rank-groups";
const rankOverrides = ref<Record<string, string[]>>({});
const showRankEditor = ref(false);
const rankDraft = ref<Set<string>>(new Set());
const health = ref<Record<string, boolean>>({});
try {
  health.value = JSON.parse(localStorage.getItem(HEALTH_KEY) ?? "{}") as Record<string, boolean>;
} catch {
  health.value = {};
}
const savedLayout = localStorage.getItem(LAYOUT_KEY);
if (savedLayout === "grid" || savedLayout === "list") layout.value = savedLayout;

function setLayout(next: Layout): void {
  layout.value = next;
  localStorage.setItem(LAYOUT_KEY, next);
}

function healthClass(id: number): string {
  const value = health.value[String(id)];
  return value === true ? "ok" : value === false ? "bad" : "";
}

function markHealth(id: number, ok: boolean): void {
  health.value = { ...health.value, [String(id)]: ok };
  localStorage.setItem(HEALTH_KEY, JSON.stringify(health.value));
}

const currentName = computed(() => sources.value.find((s) => s.id === sourceId.value)?.name ?? "选择书源");
const currentGroup = computed<ExploreGroup | undefined>(() => groups.value[groupIndex.value]);
const currentGroupTitle = computed(() => currentGroup.value?.title ?? "");
const filteredSources = computed(() => {
  const query = pickerQuery.value.trim().toLowerCase();
  return sources.value
    .filter((s) => (onlyRule.value ? s.hasExploreRule : true))
    .filter((s) => !query || s.name.toLowerCase().includes(query) || (s.group ?? "").toLowerCase().includes(query))
    .slice(0, 120);
});

const loadedText = computed(() => (loading.value && !items.value.length ? "加载中…" : items.value.length + " 本"));

const subtitle = computed(() => {
  if (!sourceId.value) return "正在加载书源…";
  if (tab.value === "rank") {
    if (rankPicked.value) {
      const count = rankLoading.value && !rankBooks.value.length ? "加载中…" : rankBooks.value.length + " 本";
      return rankPicked.value.title + " · " + count;
    }
    return currentName.value + " · " + rankRows.value.length + " 个榜单";
  }
  if (isShushan.value && shushan.value?.site) {
    return shushan.value.site + " · " + categoryGroups.value.length + " 入口 · " + loadedText.value;
  }
  if (isDhl.value && dhl.value) {
    return dhl.value.mode + " · " + dhl.value.source + " · " + categoryGroups.value.length + " 入口 · " + loadedText.value;
  }
  return currentName.value + " · " + categoryGroups.value.length + " 分类 · " + loadedText.value;
});

async function loadSources(): Promise<void> {
  const res = await api.exploreSources();
  sources.value = res.items;
  if (!res.items.length || sourceId.value) return;
  const saved = Number(localStorage.getItem(STORE_KEY) ?? 0);
  sourceId.value = res.items.some((s) => s.id === saved) ? saved : res.items[0].id;
}

/** 首屏拉前几页：书源一页 20 本，三页刚好铺满一屏半。 */
async function fetchBurst(
  group: ExploreGroup,
  pages: number[],
): Promise<{ items: SearchBook[]; lastPage: number; hasMore: boolean }> {
  const empty = { total: 0, items: [] as SearchBook[] };
  const fetchPage = (p: number) => api.exploreItems(sourceId.value, group.url, p, group.title);
  // 大灰狼上游对并发很敏感：同一分类三页并发经常只回一页甚至 EOF。串行取，失败再补一次。
  const results: Array<{ total: number; items: SearchBook[] }> = [];
  if (isDhl.value) {
    for (const p of pages) {
      try {
        results.push(await fetchPage(p));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 260));
        try {
          results.push(await fetchPage(p));
        } catch {
          results.push(empty);
        }
      }
    }
  } else {
    results.push(...(await Promise.all(pages.map((p) => fetchPage(p).catch(() => empty)))));
  }
  let merged: SearchBook[] = [];
  let lastPage = 0;
  let hasMore = false;
  for (let i = 0; i < results.length; i += 1) {
    const list = results[i].items ?? [];
    if (!list.length) {
      hasMore = false;
      break;
    }
    const before = merged.length;
    merged = mergeBooks(merged, list);
    // 有些上游忽略 page 参数，第 2、3 页仍是同一批书；没有新增就不要再假装还有下一页。
    if (i > 0 && merged.length === before) {
      hasMore = false;
      break;
    }
    lastPage = pages[i];
    hasMore = i === results.length - 1;
  }
  return { items: merged, lastPage: Math.max(1, lastPage), hasMore };
}

let loadToken = 0;

async function reloadBooks(): Promise<void> {
  const group = currentGroup.value;
  if (!group) return;
  const token = ++loadToken;
  items.value = [];
  page.value = 1;
  hasMore.value = false;
  error.value = "";
  loading.value = true;
  loadingMore.value = false;
  try {
    let res = await fetchBurst(group, Array.from({ length: EXPLORE_BURST_PAGES }, (_, i) => i + 1));
    // 大灰狼偶发首屏空包/超时：隔半秒再试一次，别让用户第一次打开就只看到错误。
    if (isDhl.value && !res.items.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (token !== loadToken) return;
      res = await fetchBurst(group, Array.from({ length: EXPLORE_BURST_PAGES }, (_, i) => i + 1));
    }
    if (token !== loadToken) return;
    items.value = res.items;
    page.value = res.lastPage;
    hasMore.value = res.hasMore;
    if (!res.items.length) {
      error.value = "「" + group.title + "」分类没有解析到书籍，换个分类或书源试试。";
      markHealth(sourceId.value, false);
    } else {
      markHealth(sourceId.value, true);
      localStorage.setItem(STORE_KEY, String(sourceId.value));
    }
  } catch (err) {
    if (token !== loadToken) return;
    items.value = [];
    error.value = "抓取失败：" + String((err as Error).message);
    markHealth(sourceId.value, false);
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  const group = currentGroup.value;
  if (!group || loading.value || loadingMore.value || !hasMore.value) return;
  const token = loadToken;
  loadingMore.value = true;
  try {
    const next = page.value + 1;
    const res = await api.exploreItems(sourceId.value, group.url, next, group.title);
    if (token !== loadToken) return;
    const list = res.items ?? [];
    const before = items.value.length;
    items.value = mergeBooks(items.value, list);
    page.value = next;
    // 上游忽略 page 时返回的还是同一批书：没有新增就收尾，避免无限「加载更多」。
    if (!list.length || items.value.length === before) hasMore.value = false;
  } catch {
    if (token === loadToken) hasMore.value = false;
  } finally {
    if (token === loadToken) loadingMore.value = false;
  }
}

let groupsToken = 0;

async function loadGroups(): Promise<void> {
  const token = ++groupsToken;
  groups.value = [];
  groupIndex.value = 0;
  items.value = [];
  error.value = "";
  activeSection.value = "";
  resetRank();
  if (!sourceId.value) return;
  loading.value = true;
  try {
    const res = await api.exploreGroups(sourceId.value);
    // 切换书源/模式时可能有多个 loadGroups 并发；只让最后一次请求落地，避免旧响应把新状态覆盖。
    if (token !== groupsToken) return;
    groups.value = res.groups.map((group) => ({ title: group.title, url: group.url, section: group.section }));
    // 书山聚合的源站动辄几百个入口（番茄听书 501 个）：默认落在第一段，别把整页铺成按钮墙。
    // 大灰狼的番茄默认第一段是「排行榜」；发现页更适合先看分类，有「热门标签」就落在那一段。
    const preferredSection = isDhl.value
      ? ["热门标签", "分类"].find((name) => groups.value.some((group) => group.section === name))
      : undefined;
    const firstSection = preferredSection ?? groups.value.find((group) => group.section)?.section ?? "";
    if (firstSection) {
      activeSection.value = firstSection;
      const at = groups.value.findIndex((group) => group.section === firstSection);
      if (at > 0) groupIndex.value = at;
    }
    revealActiveGroup();
    if (!res.groups.length) {
      error.value = isShushan.value
        ? "「" + (shushan.value?.site || "聚合") + "」在这个频道暂时没有可用的入口，换一个源站或模式试试。"
        : isDhl.value
          ? "「" + (dhl.value?.source || "这个平台") + "」在「" + (dhl.value?.mode || "小说") + " · " + (dhl.value?.gender || "男频") + "」下暂时没有发现入口，换一个平台或模式试试。"
          : "该源没有解析出可用分类，通常是发现规则为空或站点已改版。";
      markHealth(sourceId.value, false);
      return;
    }
    await reloadBooks();
    if (token !== groupsToken) return;
    // 上游偶发返回空分类或首屏空包：再等一拍重试一次，避免用户第一次打开只看到错误。
    if (isDhl.value && error.value) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (token !== groupsToken) return;
      await reloadBooks();
    }
  } catch (err) {
    if (token !== groupsToken) return;
    error.value = "分类加载失败：" + String((err as Error).message);
    markHealth(sourceId.value, false);
  } finally {
    if (token === groupsToken) loading.value = false;
  }
}

async function retryExplore(): Promise<void> {
  if (!groups.value.length) await loadGroups();
  else await reloadBooks();
}

async function pickSource(id: number): Promise<void> {
  showPicker.value = false;
  sourceId.value = id;
  localStorage.setItem(STORE_KEY, String(id));
  await loadShushan();
  await loadDhl();
  await loadGroups();
}

async function autoFind(): Promise<void> {
  if (autoTrying.value) return;
  autoTrying.value = true;
  const start = sources.value.findIndex((s) => s.id === sourceId.value);
  const ordered = [...sources.value.slice(start + 1), ...sources.value.slice(0, Math.max(0, start))];
  const candidates = ordered
    .filter((s) => health.value[String(s.id)] !== false)
    .sort((a, b) => Number(health.value[String(b.id)] === true) - Number(health.value[String(a.id)] === true))
    .slice(0, 10);
  try {
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      autoProgress.value = "正在尝试 " + (i + 1) + "/" + candidates.length + "：" + candidate.name;
      try {
        const groupsRes = await api.exploreGroups(candidate.id);
        if (!groupsRes.groups.length) {
          markHealth(candidate.id, false);
          continue;
        }
        const first = groupsRes.groups[0];
        const itemsRes = await api.exploreItems(candidate.id, first.url, 1, first.title);
        if (!itemsRes.items.length) {
          markHealth(candidate.id, false);
          continue;
        }
        sourceId.value = candidate.id;
        groups.value = groupsRes.groups.map((group) => ({ title: group.title, url: group.url }));
        groupIndex.value = 0;
        resetRank();
        items.value = itemsRes.items;
        page.value = 1;
        hasMore.value = itemsRes.items.length > 0;
        error.value = "";
        markHealth(candidate.id, true);
        localStorage.setItem(STORE_KEY, String(candidate.id));
        return;
      } catch {
        markHealth(candidate.id, false);
      }
    }
    error.value = "自动尝试了 " + candidates.length + " 个书源，都没能取到分类内容；可以稍后再试或换用「榜单」。";
  } finally {
    autoTrying.value = false;
    autoProgress.value = "";
  }
}

function revealActiveGroup(): void {
  void nextTick(() => {
    const track = groupScroller.value;
    const node = track?.querySelector<HTMLElement>(".group-chip.active");
    if (!track || !node) return;
    const trackRect = track.getBoundingClientRect();
    const chipRect = node.getBoundingClientRect();
    const leftPad = 16;
    const rightPad = window.matchMedia("(min-width: 641px) and (hover: hover) and (pointer: fine)").matches ? 86 : 20;
    let delta = 0;
    if (chipRect.left < trackRect.left + leftPad) delta = chipRect.left - trackRect.left - leftPad;
    else if (chipRect.right > trackRect.right - rightPad) delta = chipRect.right - trackRect.right + rightPad;
    if (!delta) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: delta, behavior: reduced ? "auto" : "smooth" });
  });
}

function selectGroup(index: number): void {
  groupIndex.value = index;
  void reloadBooks();
  revealActiveGroup();
}

// ---------------------------------------------------------------- 榜单（只针对当前书源）

const rankPicked = ref<ExploreGroup | null>(null);
const rankBooks = ref<SearchBook[]>([]);
const rankPage = ref(1);
const rankHasMore = ref(false);
const rankLoading = ref(false);
const rankLoadingMore = ref(false);
const rankError = ref("");
const rankSamples = ref<Record<string, SearchBook[]>>({});
const rankSamplePending = ref<Record<string, boolean>>({});
let rankObserver: IntersectionObserver | null = null;
let rankToken = 0;

const rankUrlSet = computed(() => new Set(rankOverrides.value[String(sourceId.value)] ?? []));
/** 有手动标记就完全按标记来（哪怕一个都没勾，也尊重「这个源没有榜单」）；否则标题关键词自动识别。 */
const rankGroups = computed<ExploreGroup[]>(() => {
  const marked = rankUrlSet.value;
  if (marked.size) return groups.value.filter((group) => marked.has(group.url));
  return splitRankGroups(groups.value).ranks;
});
const rankRows = computed(() => rankGroups.value);

// ---------------------------------------------------------------- 分段（书山聚合的 /type_api 会按「排行榜」「分类」分段）

/** 有分段信息的源（书山聚合的源站分支）已经自己把「排行榜」单列一段，不需要再按标题猜。 */
const sections = computed(() => {
  const counts = new Map<string, number>();
  for (const group of groups.value) {
    const name = group.section ?? "";
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }));
});
const hasSections = computed(() => sections.value.length > 0);

/** 分类 chips 不该把榜单入口再列一遍：有榜单时只显示剩下的分类（index 仍指向 groups，供 selectGroup 用）。 */
const categoryGroups = computed(() => {
  const rankUrls = hasSections.value ? new Set<string>() : new Set(rankGroups.value.map((group) => group.url));
  const list = groups.value.filter((group) => !rankUrls.has(group.url));
  return list.map((group) => ({ group, index: groups.value.indexOf(group) }));
});

/** 分段里已经有「排行榜」时，顶部的榜单 tab 是重复的，藏起来（原客户端也是这么做的）。 */
const showRankTab = computed(() => rankGroups.value.length > 0 && !hasSections.value);

// 整页换源后别把用户留在一个空 tab 上。
watch([rankGroups, hasSections], () => {
  if (tab.value === "rank" && !showRankTab.value) tab.value = "category";
});

const activeSection = ref("");
const visibleCategoryGroups = computed(() => {
  const list = categoryGroups.value;
  if (!activeSection.value) return list;
  return list.filter((entry) => (entry.group.section ?? "") === activeSection.value);
});

const sectionScroller = ref<HTMLElement | null>(null);
const groupScroller = ref<HTMLElement | null>(null);
const sectionScroll = useHorizontalScroller(sectionScroller);
const groupScroll = useHorizontalScroller(groupScroller);

/** 分类入口一多（书山某些源站有 500+ 个），横向 chips 翻不动；用可搜索的全部分类面板兜底。 */
const groupPickerSections = computed(() => {
  const query = groupQuery.value.trim().toLowerCase();
  const buckets = new Map<string, { group: ExploreGroup; index: number }[]>();
  let total = 0;
  let shown = 0;
  const LIMIT = 160;
  for (const entry of categoryGroups.value) {
    const title = entry.group.title;
    if (query && !title.toLowerCase().includes(query)) continue;
    total += 1;
    if (shown >= LIMIT) continue;
    const section = entry.group.section || "其他分类";
    const bucket = buckets.get(section) ?? [];
    bucket.push(entry);
    buckets.set(section, bucket);
    shown += 1;
  }
  return {
    sections: Array.from(buckets, ([name, entries]) => ({ name, entries })),
    total,
    shown,
    truncated: total > shown,
  };
});

function openGroupPicker(): void {
  groupQuery.value = "";
  showGroupPicker.value = true;
}

function pickGroupFromPicker(entry: { group: ExploreGroup; index: number }): void {
  activeSection.value = entry.group.section ?? "";
  showGroupPicker.value = false;
  selectGroup(entry.index);
}

/** 切分段直接落到该段第一个入口：像截图那样点「排行榜」就能看到书，而不是先看到一排按钮再点一次。 */
function pickSection(name: string): void {
  activeSection.value = name;
  const list = visibleCategoryGroups.value;
  if (!list.length) return;
  if (!list.some((entry) => entry.index === groupIndex.value)) selectGroup(list[0].index);
  else revealActiveGroup();
}

async function loadRankOverrides(): Promise<void> {
  try {
    const all = await api.settings();
    rankOverrides.value = parseRankOverrides(all[RANK_KEY]);
  } catch {
    rankOverrides.value = {};
  }
}

function openRankEditor(): void {
  rankDraft.value = new Set(rankGroups.value.map((group) => group.url));
  showRankEditor.value = true;
}

function toggleRankDraft(url: string): void {
  const next = new Set(rankDraft.value);
  if (next.has(url)) next.delete(url);
  else next.add(url);
  rankDraft.value = next;
}

async function persistRankOverrides(next: Record<string, string[]>): Promise<void> {
  rankOverrides.value = next;
  try {
    await api.saveSettings({ [RANK_KEY]: JSON.stringify(next) });
  } catch (err) {
    toast("保存榜单设置失败：" + String((err as Error).message).slice(0, 40), "error");
  }
}

async function saveRankEditor(): Promise<void> {
  const key = String(sourceId.value);
  const next = { ...rankOverrides.value };
  if (rankDraft.value.size) next[key] = Array.from(rankDraft.value);
  else delete next[key];
  await persistRankOverrides(next);
  showRankEditor.value = false;
  toast(`已标记 ${rankDraft.value.size} 个榜单入口`);
  if (rankDraft.value.size && tab.value === "category" && !categoryGroups.value.length) tab.value = "rank";
}

async function resetRankEditor(): Promise<void> {
  const key = String(sourceId.value);
  const next = { ...rankOverrides.value };
  delete next[key];
  await persistRankOverrides(next);
  showRankEditor.value = false;
  toast("已恢复自动识别榜单");
}

function sampleNames(url: string): string {
  const list = rankSamples.value[url] ?? [];
  return list.map((book) => book.name).join(" · ");
}

function resetRank(): void {
  rankPicked.value = null;
  rankBooks.value = [];
  rankPage.value = 1;
  rankHasMore.value = false;
  rankError.value = "";
  rankSamples.value = {};
  rankSamplePending.value = {};
  rankObserver?.disconnect();
  rankObserver = null;
}

/** 行进入视口才去抓预览，36 个榜单不会在打开页面时打出 36 个请求。 */
function observeRankRow(el: unknown, row: ExploreGroup): void {
  if (!(el instanceof HTMLElement)) return;
  el.dataset.rankUrl = row.url;
  if (!rankObserver) {
    rankObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const url = (entry.target as HTMLElement).dataset.rankUrl ?? "";
          const target = rankRows.value.find((item) => item.url === url);
          if (target) void loadRankSample(target);
          rankObserver?.unobserve(entry.target);
        }
      },
      { rootMargin: "240px 0px" },
    );
  }
  rankObserver.observe(el);
}

async function loadRankSample(row: ExploreGroup): Promise<void> {
  if (rankSamples.value[row.url] || rankSamplePending.value[row.url]) return;
  rankSamplePending.value = { ...rankSamplePending.value, [row.url]: true };
  try {
    const res = await api.exploreItems(sourceId.value, row.url, 1, row.title);
    rankSamples.value = { ...rankSamples.value, [row.url]: (res.items ?? []).slice(0, 3) };
  } catch {
    rankSamples.value = { ...rankSamples.value, [row.url]: [] };
  } finally {
    rankSamplePending.value = { ...rankSamplePending.value, [row.url]: false };
  }
}

async function openRank(row: ExploreGroup): Promise<void> {
  rankPicked.value = row;
  rankBooks.value = [];
  rankPage.value = 1;
  rankHasMore.value = false;
  rankError.value = "";
  const token = ++rankToken;
  rankLoading.value = true;
  window.scrollTo(0, 0);
  try {
    const res = await fetchBurst(row, Array.from({ length: EXPLORE_BURST_PAGES }, (_, i) => i + 1));
    if (token !== rankToken) return;
    rankBooks.value = res.items;
    rankPage.value = res.lastPage;
    rankHasMore.value = res.hasMore;
    if (!res.items.length) rankError.value = "「" + row.title + "」没有解析到书籍。";
  } catch (err) {
    if (token === rankToken) rankError.value = "抓取失败：" + String((err as Error).message);
  } finally {
    if (token === rankToken) rankLoading.value = false;
  }
}

async function loadRankMore(): Promise<void> {
  const row = rankPicked.value;
  if (!row || rankLoading.value || rankLoadingMore.value || !rankHasMore.value) return;
  const token = rankToken;
  rankLoadingMore.value = true;
  try {
    const next = rankPage.value + 1;
    const res = await api.exploreItems(sourceId.value, row.url, next, row.title);
    if (token !== rankToken) return;
    const list = res.items ?? [];
    const before = rankBooks.value.length;
    rankBooks.value = mergeBooks(rankBooks.value, list);
    rankPage.value = next;
    if (!list.length || rankBooks.value.length === before) rankHasMore.value = false;
  } catch {
    if (token === rankToken) rankHasMore.value = false;
  } finally {
    if (token === rankToken) rankLoadingMore.value = false;
  }
}

function closeRank(): void {
  rankPicked.value = null;
  rankBooks.value = [];
  rankError.value = "";
}

function switchTab(next: "category" | "rank"): void {
  tab.value = next;
}

/** 正在打开（建预览记录）的地址：连点两本只处理第一本。 */
const opening = ref("");

/**
 * 点一本书 → 直接进详情页看简介。加入书架是详情页里的下一步，不在发现页替用户做决定。
 *
 * 预览记录是本地秒建的（不联网抓详情/目录），详情页再按需拉目录；漫画/有声还没有
 * 阅读器，保留原来的说明弹层。
 */
async function open(book: SearchBook): Promise<void> {
  const mode = shushan.value?.mode ?? "novel";
  activeMode.value = mode;
  if ((isShushan.value && mode !== "novel") || (isDhl.value && dhl.value && dhl.value.mode !== "小说")) {
    active.value = book;
    return;
  }
  if (opening.value) return;
  opening.value = book.bookUrl;
  try {
    const created = await api.createBook({
      sourceId: sourceId.value,
      bookUrl: book.bookUrl,
      name: book.name,
      author: book.author,
      coverUrl: book.coverUrl,
      intro: book.intro,
      wordCount: book.wordCount,
      lastChapter: book.lastChapter,
      preview: true,
    });
    router.push("/book/" + created.book.id);
  } catch (err) {
    toast("打开失败：" + String((err as Error).message).slice(0, 60), "error");
  } finally {
    opening.value = "";
  }
}

async function addActive(): Promise<void> {
  const book = active.value;
  if (!book) return;
  adding.value = true;
  try {
    const created = await api.createBook({
      sourceId: sourceId.value,
      bookUrl: book.bookUrl,
      name: book.name,
      author: book.author,
      coverUrl: book.coverUrl,
      intro: book.intro,
      wordCount: book.wordCount,
      lastChapter: book.lastChapter,
    });
    active.value = null;
    router.push("/book/" + created.book.id);
  } catch (err) {
    alert("加入失败：" + String((err as Error).message));
  } finally {
    adding.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadSources(), loadRankOverrides()]);
  await loadShushan();
  await loadDhl();
  await loadGroups();
  // 内置聚合源的空频道（例如七猫短剧）不该把用户甩到别的书源上。
  if (error.value && !isShushan.value && !isDhl.value) await autoFind();
});

onBeforeUnmount(() => {
  rankObserver?.disconnect();
  rankObserver = null;
});
</script>

<style scoped>
.source-picker-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  max-width: min(210px, 54vw);
  padding: 7px 11px;
  border: 1px solid var(--color-outline, #ded9cc);
  border-radius: 999px;
  background: var(--color-surface, #fffdf8);
  font-size: 12px;
  color: inherit;
  white-space: nowrap;
}
.source-picker-btn .ellipsis { max-width: 104px; }
.source-picker-btn .muted { flex: 0 0 auto; font-size: 11px; }

.explore-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}
.explore-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-outline, #ded9cc) 30%, transparent);
}
.explore-tabs button {
  border: 0;
  border-radius: 999px;
  padding: 6px 18px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.explore-tabs button.active {
  background: var(--color-surface, #fffdf8);
  color: var(--color-primary, #4e6b57);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(40, 44, 36, 0.1);
}
.explore-tabs .tab-count {
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary, #4e6b57) 14%, transparent);
  font-size: 10px;
  font-weight: 600;
}
.explore-view {
  display: inline-flex;
  margin-left: auto;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-outline, #ded9cc) 26%, transparent);
}
.explore-view button {
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.explore-view button.active {
  background: var(--color-surface, #fffdf8);
  color: var(--color-primary, #4e6b57);
  box-shadow: 0 1px 3px rgba(40, 44, 36, 0.12);
}
.rank-config-btn {
  flex: 0 0 auto;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--color-outline, #ded9cc) 60%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.rank-config-btn:active { background: var(--color-surface-container); }
.rank-editor { display: flex; flex-direction: column; gap: 10px; padding: 0 14px 8px; }
.rank-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 52vh;
  overflow-y: auto;
  border: 1px solid color-mix(in srgb, var(--color-outline, #ded9cc) 45%, transparent);
  border-radius: 12px;
  padding: 4px;
}
.rank-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.rank-option:active { background: var(--color-surface-container); }
.rank-option input { flex: 0 0 auto; }
.rank-option span { min-width: 0; }
.rank-auto {
  margin-left: auto;
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary, #4e6b57) 12%, transparent);
  color: var(--color-primary, #4e6b57);
  font-size: 10px;
  font-style: normal;
}

.category-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  min-height: 24px;
}
.category-head-title {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}
.category-head-label {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-on-surface);
}
.category-head-meta {
  flex: none;
  font-size: 11px;
  color: var(--color-on-surface-variant);
  opacity: 0.72;
}
.category-head-hint {
  flex: none;
  font-size: 10.5px;
  color: var(--color-on-surface-variant);
  opacity: 0.52;
}
.category-all {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  margin-left: auto;
  padding: 5px 9px;
  border: 1px solid color-mix(in srgb, var(--color-outline, #e4dfd2) 78%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.category-all:hover {
  border-color: color-mix(in srgb, var(--color-primary) 46%, var(--color-outline, #e4dfd2));
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  color: var(--color-primary);
}
.category-all:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-primary) 58%, transparent);
  outline-offset: 2px;
}

.scroll-wrap {
  position: relative;
  min-width: 0;
}
.section-wrap { margin-top: 8px; }
.group-wrap { margin: 12px -16px 0; }
.scroll-wrap::before,
.scroll-wrap::after {
  content: "";
  position: absolute;
  top: 1px;
  bottom: 1px;
  z-index: 1;
  width: 28px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.16s ease;
}
.scroll-wrap::before {
  left: 0;
  background: linear-gradient(90deg, var(--color-surface, #faf8f3) 8%, transparent);
}
.scroll-wrap::after {
  right: 0;
  background: linear-gradient(270deg, var(--color-surface, #faf8f3) 8%, transparent);
}
.scroll-wrap.can-left::before,
.scroll-wrap.can-right::after { opacity: 1; }

.section-scroller,
.group-scroller {
  display: flex;
  gap: 6px;
  margin: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  cursor: grab;
}
.section-scroller { padding: 0; }
.group-scroller { gap: 8px; padding: 0 16px 4px; }
.section-scroller::-webkit-scrollbar,
.group-scroller::-webkit-scrollbar { display: none; }
.section-scroller.is-dragging,
.group-scroller.is-dragging { cursor: grabbing; }
.section-scroller:focus-visible,
.group-scroller:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-primary) 58%, transparent);
  outline-offset: 3px;
  border-radius: 8px;
}

.scroll-tools {
  position: absolute;
  top: 50%;
  right: 0;
  z-index: 3;
  display: none;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border: 1px solid color-mix(in srgb, var(--color-outline, #e4dfd2) 76%, transparent);
  border-radius: 999px;
  background: var(--color-surface, #faf8f3);
  box-shadow: 0 2px 10px rgba(40, 44, 36, 0.12);
  transform: translateY(-50%);
}
.group-tools { right: 14px; }
.scroll-wrap.can-right .scroll-tools::before {
  content: "";
  position: absolute;
  top: -2px;
  right: 100%;
  bottom: -2px;
  width: 64px;
  background: linear-gradient(90deg, transparent, var(--color-surface, #faf8f3) 84%);
  pointer-events: none;
}
.scroll-tool {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
}
.scroll-tool:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}
.scroll-tool:active:not(:disabled) { transform: scale(0.92); }
.scroll-tool:disabled { opacity: 0.28; cursor: default; }

@media (hover: hover) and (pointer: fine) and (min-width: 641px) {
  .scroll-tools { display: inline-flex; }
  .section-scroller { padding-right: 62px; }
  .group-scroller { padding-right: 74px; }
  /* 桌面端 chip 也显示抓手，提示整行可以按住拖动，而不是只能点。 */
  .section-chip,
  .group-chip { cursor: grab; }
  .section-scroller.is-dragging .section-chip,
  .group-scroller.is-dragging .group-chip { cursor: grabbing; }
  .scroll-wrap.can-right::after {
    width: 78px;
    background: linear-gradient(270deg, var(--color-surface, #faf8f3) 34%, transparent);
  }
}

.group-chip {
  flex: none;
  padding: 7px 14px;
  border: 1px solid var(--color-outline, #e4dfd2);
  border-radius: 999px;
  background: var(--color-surface, #fffdf8);
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.group-chip:hover:not(.active) {
  border-color: color-mix(in srgb, var(--color-primary) 42%, var(--color-outline, #e4dfd2));
  background: color-mix(in srgb, var(--color-primary) 5%, var(--color-surface, #fffdf8));
  color: var(--color-on-surface);
}
.group-chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-primary) 58%, transparent);
  outline-offset: 2px;
}
.group-chip.active {
  border-color: transparent;
  background: var(--color-primary);
  color: #fff;
  font-weight: 600;
}

.explore-error {
  margin-top: 14px;
  padding: 16px;
}
.explore-error-title { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
.explore-error-detail {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-on-surface-variant);
  word-break: break-word;
}

.rank-head {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.rank-title { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.01em; }
.rank-sub {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-on-surface-variant);
}
.rank-list { display: flex; flex-direction: column; margin-top: 10px; }
.rank-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 4px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-outline, #ded9cc) 34%, transparent);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rank-row:active { background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
.rank-no {
  flex: none;
  align-self: flex-start;
  width: 26px;
  padding-top: 3px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-primary);
  opacity: 0.7;
}
.rank-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.rank-row-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-row-meta { font-size: 11px; color: var(--color-on-surface-variant); }
.rank-row-covers {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
}
.rank-row-names {
  display: block;
  margin-top: 5px;
  font-size: 10px;
  line-height: 1.4;
  color: var(--color-on-surface-variant);
  opacity: 0.78;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-row-arrow { flex: none; font-size: 18px; opacity: 0.5; }
.explore-bottom {
  padding: 12px 0 4px;
  font-size: 11px;
  text-align: center;
  color: var(--color-on-surface-variant);
  opacity: 0.72;
}

.source-sheet-body { padding: 0 16px; }
.detail-sheet { padding: 0 16px; }
.group-picker {
  padding-bottom: 18px;
}
.group-picker-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-on-surface-variant);
}
.group-picker-label span {
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-on-surface-variant) 10%, transparent);
  font-size: 10px;
  font-weight: 500;
  line-height: 15px;
}
.group-picker-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.group-picker-item {
  max-width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--color-outline, #ded9cc);
  border-radius: 999px;
  background: var(--color-surface, #fffdf8);
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.group-picker-item.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}
.group-picker-hint {
  margin: 14px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-on-surface-variant);
}
.picker-search {
  width: 100%;
  margin: 10px 0;
  padding: 9px 12px;
  border: 1px solid var(--color-outline, #ded9cc);
  border-radius: 10px;
  background: var(--color-surface, #fffdf8);
  font-size: 13px;
}
.picker-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--color-on-surface-variant);
}
.picker-list {
  max-height: 52vh;
  overflow-y: auto;
  border-top: 1px solid var(--color-outline, #ece8dd);
}
.picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 4px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-outline, #ded9cc) 34%, transparent);
  background: transparent;
  text-align: left;
  color: inherit;
}
.picker-row.active { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
.picker-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.picker-name { font-size: 13px; font-weight: 600; }
.picker-meta { font-size: 11px; color: var(--color-on-surface-variant); }
.picker-tags { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.picker-legend {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--color-on-surface-variant);
}
.picker-legend .dot { margin-left: 6px; }
.picker-legend .dot:first-child { margin-left: 0; }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c9c4b6;
  flex: none;
}
.dot.ok { background: #4e8c63; }
.dot.bad { background: #c2603f; }
.intro {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-on-surface-variant);
  max-height: 30vh;
  overflow-y: auto;
}
.source-name { margin: 0 0 4px; font-size: 15px; font-weight: 650; }
.source-meta { margin: 0 0 3px; font-size: 12px; color: var(--color-on-surface-variant); }
.detail-dot { margin: 0 4px; opacity: 0.45; }
.detail-stats { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.detail-status {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 16px;
  background: color-mix(in srgb, var(--color-on-surface-variant) 10%, transparent);
}
.detail-status.tone-ongoing {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 11%, transparent);
}
.detail-status.tone-paused {
  color: #a5671a;
  background: color-mix(in srgb, #d99a3d 16%, transparent);
}

/* 书山聚合：一家代理 74 个源站，模式 / 性别 / 源站就是它的「书架层」 */
.ss-bar {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.ss-bar::-webkit-scrollbar { display: none; }
@media (max-width: 640px) {
  /* 手机上 6 个筛选 chip 排成一行会被截断，换行让「状态/排序」也能直接看到。 */
  .dhl-bar {
    flex-wrap: wrap;
    overflow-x: visible;
    row-gap: 6px;
  }
  .dhl-bar .ss-chip { max-width: none; }
}
.ss-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  max-width: 46vw;
  padding: 7px 11px;
  border: 1px solid var(--color-outline, #ded9cc);
  border-radius: 10px;
  background: var(--color-surface, #fffdf8);
  font-size: 12px;
  color: inherit;
}
.ss-label { font-size: 11px; color: var(--color-on-surface-variant); }
.ss-value { font-weight: 600; }
.ss-chip .ellipsis { max-width: 96px; }
.ss-options {
  display: flex;
  flex-direction: column;
  max-height: 58vh;
  overflow-y: auto;
  padding: 4px 16px 12px;
}
.ss-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 10px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-outline, #ded9cc) 34%, transparent);
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  text-align: left;
  color: inherit;
}
.ss-option.active {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
  font-weight: 600;
}
.ss-option .ellipsis { flex: 1; min-width: 0; }
.ss-hint { flex: none; font-size: 11px; color: var(--color-on-surface-variant); }
.ss-note {
  margin: 10px 0 0;
  padding: 9px 11px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-on-surface-variant);
}

/* 分段：排行榜 / 分类 / 情节主题…（书山聚合的 /type_api 自带分段） */
.section-chip {
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-outline, #ded9cc) 26%, transparent);
  font: inherit;
  font-size: 12px;
  color: var(--color-on-surface-variant);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.section-chip:hover:not(.active) {
  background: color-mix(in srgb, var(--color-outline, #ded9cc) 38%, transparent);
  color: var(--color-on-surface);
}
.section-chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-primary) 58%, transparent);
  outline-offset: 2px;
}
.section-chip.active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
  font-weight: 600;
}
.section-count { margin-left: 5px; font-size: 10px; opacity: 0.7; }

@media (max-width: 900px) {
  .category-head-hint { display: none; }
}
@media (max-width: 380px) {
  .category-head-meta { display: none; }
}
</style>
