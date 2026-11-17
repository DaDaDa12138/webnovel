<script setup lang="ts">
import { computed } from "vue";
import { ANNOTATION_COLORS, type AnnotationColor } from "@legado/shared";

const props = defineProps<{
  rect: { top: number; left: number; width: number; height: number } | null;
  quote: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (event: "pick", color: AnnotationColor): void;
  (event: "note"): void;
  (event: "share"): void;
  (event: "copy"): void;
  (event: "cancel"): void;
}>();

const BAR_WIDTH = 320;
const BAR_HEIGHT = 46;

/**
 * 浮动条位置：默认贴选区上方，放不下就翻到下方；左右都夹在视口内。
 * 用 rect 而不是选区元素：跨段落选区没有单一容器。
 */
const style = computed(() => {
  const rect = props.rect;
  if (!rect) return { display: "none" };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const center = rect.left + rect.width / 2;
  const left = Math.min(Math.max(8, center - BAR_WIDTH / 2), Math.max(8, vw - BAR_WIDTH - 8));
  const above = rect.top - BAR_HEIGHT - 10;
  const top = above >= 8 ? above : Math.min(vh - BAR_HEIGHT - 8, rect.top + rect.height + 10);
  return { left: left + "px", top: top + "px" };
});

const LABELS: Record<AnnotationColor, string> = {
  yellow: "黄色高亮",
  green: "绿色高亮",
  blue: "蓝色高亮",
  pink: "粉色高亮",
  purple: "紫色高亮",
};
</script>

<template>
  <div v-if="rect" class="hl-bar" :style="style" role="toolbar" aria-label="划线操作">
    <button
      v-for="color in ANNOTATION_COLORS"
      :key="color"
      class="hl-dot"
      :class="'hl-dot-' + color"
      type="button"
      :aria-label="LABELS[color]"
      :disabled="busy"
      @pointerdown.prevent
      @click="emit('pick', color)"
    />
    <span class="hl-bar-sep" />
    <button class="hl-act" type="button" :disabled="busy" @pointerdown.prevent @click="emit('note')">笔记</button>
    <button class="hl-act" type="button" @pointerdown.prevent @click="emit('share')">分享</button>
    <button class="hl-act" type="button" @pointerdown.prevent @click="emit('copy')">复制</button>
    <button class="hl-act hl-act-close" type="button" aria-label="取消" @pointerdown.prevent @click="emit('cancel')">
      ✕
    </button>
  </div>
</template>
