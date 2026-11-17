<script setup lang="ts">
import { computed } from "vue";
import type { AnnotationItem } from "@legado/shared";
import { popoverPlacement } from "../../lib/reader-popover";

const props = defineProps<{
  item: AnnotationItem;
  rect: { left: number; top: number; bottom: number; width: number };
}>();

const emit = defineEmits<{ close: []; edit: []; copy: []; remove: [] }>();

const style = computed(() => {
  const spot = popoverPlacement(
    props.rect,
    { width: 300, height: 176 },
    { width: window.innerWidth, height: window.innerHeight },
  );
  if (spot.side === "above") {
    // 用底边贴住划线：气泡高度随批注长短变化，top 会把它推得太远。
    return { left: spot.left + "px", top: props.rect.top - 10 + "px", transform: "translateY(-100%)" };
  }
  return { left: spot.left + "px", top: spot.top + "px" };
});
</script>

<template>
  <div class="mark-pop" :style="style" role="dialog" aria-label="划线批注">
    <div class="mark-pop-head">
      <span class="hl-dot" :class="'hl-dot-' + item.color" />
      <span class="mark-pop-title">{{ item.type === "note" ? "批注" : "划线" }}</span>
      <button class="mark-pop-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
    </div>
    <blockquote class="mark-pop-quote">{{ item.quote }}</blockquote>
    <p v-if="item.comment" class="mark-pop-comment">{{ item.comment }}</p>
    <p v-else class="mark-pop-empty">还没有批注</p>
    <div class="mark-pop-actions">
      <button type="button" @click="emit('edit')">编辑批注</button>
      <button type="button" @click="emit('copy')">复制</button>
      <button class="danger" type="button" @click="emit('remove')">删除</button>
    </div>
  </div>
</template>
