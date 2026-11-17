<script setup lang="ts">
import { computed } from "vue";
import type { ChapterImage } from "@legado/shared";
import { paragraphSegments, type AnnotationRange } from "../../lib/annotations";
import type { DisplayBlock, DisplayPart } from "../../lib/reader-blocks";
import { readingMinutes } from "../../lib/reader-progress";
import type { LoadedChapter } from "../../lib/reader-types";
import ReaderFigure from "./ReaderFigure.vue";

const props = defineProps<{
  chapter: LoadedChapter;
  total: number;
  paged?: boolean;
  /** 本章的划线（章节内字符偏移），由阅读页按章过滤后传进来。 */
  marks?: AnnotationRange[];
  /** 搜索命中：和划线共用一套字符区间，只是颜色不同。 */
  hits?: AnnotationRange[];
  /** 段落纠正模式：只加可点击的视觉提示，点击由阅读页的手势层统一处理。 */
  correcting?: boolean;
  /** 目录里的下一章标题；目录还没加载时为空，只显示「下一章」。 */
  nextTitle?: string;
}>();

defineEmits<{
  retry: [index: number];
  next: [];
  swap: [];
  image: [];
  zoom: [src: string];
  bookmark: [index: number];
  note: [index: number];
}>();

interface PartView extends DisplayPart {
  segments: ReturnType<typeof paragraphSegments>;
}

interface BlockView {
  block: DisplayBlock;
  index: number;
  parts: PartView[];
}

interface GroupView {
  id: number;
  paraEnd: number;
  blocks: BlockView[];
}

/**
 * 展示块按「原始段落组」包一层：合段/长段细分后仍然共享同一组，
 * 图片按原始 paragraph.after 插在组尾，不会插到拆分出来的半句后面。
 */
const groups = computed<GroupView[]>(() => {
  const ranges = [...(props.marks ?? []), ...(props.hits ?? [])];
  const map = new Map<number, GroupView>();
  props.chapter.blocks.forEach((block, index) => {
    let group = map.get(block.group);
    if (!group) {
      group = { id: block.group, paraEnd: block.paraEnd, blocks: [] };
      map.set(block.group, group);
    }
    group.paraEnd = Math.max(group.paraEnd, block.paraEnd);
    group.blocks.push({
      block,
      index,
      parts: block.parts.map((part) => ({
        ...part,
        segments: paragraphSegments(part.text, part.start, ranges),
      })),
    });
  });
  return [...map.values()];
});

/** 图片按「前面有几段」分桶：after = 0 是章首插图，after = i+1 表示第 i 段之后。 */
const figures = computed(() => {
  const map = new Map<number, ChapterImage[]>();
  for (const image of props.chapter.images ?? []) {
    const list = map.get(image.after);
    if (list) list.push(image);
    else map.set(image.after, [image]);
  }
  return map;
});

function imagesAt(after: number): ChapterImage[] {
  return figures.value.get(after) ?? [];
}

/**
 * 付费源（书山聚合的 VIP 书）取不到正文不是「网络出错」，重试一百次也一样。
 * 单独给一块提示，说清楚升级会员后回来点一下就能读。
 */
const locked = computed(() => /VIP|会员/.test(props.chapter.error));
/** 聚合源要登录才能取正文：给一条直达设置的路，不要让人反复点重试。 */
const loginRequired = computed(() => /登录/.test(props.chapter.error));

/** 章末卡片上的本章字数/预计用时：和阅读进度用同一套 400 字/分钟，别出现两个口径。 */
const chapterChars = computed(() => props.chapter.length);
const chapterMinutes = computed(() => readingMinutes(props.chapter.length));
const hasNext = computed(() => props.chapter.index < props.total - 1);
</script>

<template>
  <section class="chapter-section">
    <header class="chapter-head">
      <span class="chapter-no">第 {{ chapter.index + 1 }} / {{ total }} 章</span>
      <h2>{{ chapter.title || "第 " + (chapter.index + 1) + " 章" }}</h2>
    </header>

    <div v-if="chapter.loading && !chapter.paragraphs.length" class="chapter-loading" role="status" aria-live="polite">
      <span class="sr-only">正在加载本章…</span>
      <span v-for="n in 4" :key="n" class="skeleton-line" :class="{ short: n === 4 }" />
    </div>

    <ReaderFigure
      v-for="(image, k) in imagesAt(0)"
      :key="'lead-' + k"
      :image="image"
      :paged="paged"
      @zoom="$emit('zoom', $event)"
      @load="$emit('image')"
    />

    <div v-for="group in groups" :key="group.id" class="para-group">
      <p
        v-for="item in group.blocks"
        :key="item.block.start"
        class="para"
        :class="['kind-' + item.block.kind, { cont: item.block.cont, dialog: item.block.kind === 'dialog', 'correct-target': correcting }]"
        :data-block="item.index"
        :data-para="item.block.para"
        :data-start="item.block.start"
        :data-end="item.block.end"
      >
        <span v-for="part in item.parts" :key="part.start" class="blk-part" :data-start="part.start" :data-end="part.end"><template v-for="(seg, j) in part.segments" :key="j"><mark v-if="seg.mark" class="hl" :class="'hl-' + seg.mark.color" :data-mark="seg.mark.id">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
      </p>
      <ReaderFigure
        v-for="(image, k) in imagesAt(group.paraEnd + 1)"
        :key="'g' + group.id + '-' + k"
        :image="image"
        :paged="paged"
        @zoom="$emit('zoom', $event)"
        @load="$emit('image')"
      />
    </div>

    <div v-if="chapter.error" class="chapter-error" :class="{ locked }">
      <p class="chapter-error-text">{{ chapter.error }}</p>
      <p v-if="locked" class="chapter-error-hint">
        在设置里升级对应账号的会员后回到这一页，点「重新加载」即可继续读，不需要重新加书。
      </p>
      <p v-else-if="loginRequired" class="chapter-error-hint">
        在「设置 → 大灰狼聚合」登录后回到这一页，点「重新加载」即可继续读。
      </p>
      <div class="chapter-error-actions">
        <button class="btn ghost" @click="$emit('retry', chapter.index)">{{ locked || loginRequired ? "重新加载" : "重试" }}</button>
        <a v-if="loginRequired" class="btn ghost" href="/settings">去登录</a>
        <button v-else-if="!locked" class="btn ghost" @click="$emit('swap')">换源</button>
      </div>
    </div>

    <div v-if="chapter.paragraphs.length" class="chapter-end">
      <div class="chapter-end-card">
        <div class="chapter-end-head">
          <span class="chapter-end-kicker">本章完</span>
          <span class="chapter-end-stats">{{ chapterChars.toLocaleString("zh-CN") }} 字 · 约 {{ chapterMinutes }} 分钟</span>
        </div>
        <p class="chapter-end-hint">
          {{ paged ? "继续翻页阅读下一章" : "继续下滑阅读下一章" }}
        </p>
        <div class="chapter-end-actions">
          <button class="chapter-end-action" type="button" @click="$emit('bookmark', chapter.index)">加入书签</button>
          <button class="chapter-end-action" type="button" @click="$emit('note', chapter.index)">写笔记</button>
        </div>
        <button
          v-if="hasNext"
          class="chapter-next-btn"
          type="button"
          @click="$emit('next')"
        >
          <span class="chapter-next-label">下一章</span>
          <span v-if="nextTitle" class="chapter-next-title">{{ nextTitle }}</span>
        </button>
        <span v-else class="chapter-end-last">已经是最后一章</span>
      </div>
    </div>
  </section>
</template>
