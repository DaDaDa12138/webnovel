<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { coverInitial, imgUrl, isJunkCover } from "../lib/img";

/**
 * 统一的封面：脏链接（站点 logo / 横幅 / 占位图）直接跳过，
 * 加载失败退回首字占位，调用方不用再各自写 isJunkCover + @error + 占位块。
 */
const props = withDefaults(
  defineProps<{
    url?: string | null;
    sourceId?: number;
    name?: string | null;
    width?: number;
    height?: number;
    radius?: number;
    initialFont?: number;
    eager?: boolean;
  }>(),
  { radius: 8, initialFont: 13, eager: false },
);

const broken = ref(false);
watch(
  () => props.url,
  () => {
    broken.value = false;
  },
);

const usable = computed(() => Boolean(props.url) && !isJunkCover(props.url) && !broken.value);
const initial = computed(() => coverInitial(props.name));

const boxStyle = computed(() => ({
  borderRadius: props.radius + "px",
  width: props.width ? props.width + "px" : "100%",
  ...(props.height ? { height: props.height + "px" } : { aspectRatio: "3 / 4" }),
}));
</script>

<template>
  <div class="book-cover" :style="boxStyle">
    <img
      v-if="usable"
      :src="imgUrl(url, sourceId)"
      :alt="name || ''"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      @error="broken = true"
    />
    <span v-else class="book-cover-initial" :style="{ fontSize: initialFont + 'px' }" aria-hidden="true">{{ initial }}</span>
  </div>
</template>

<style scoped>
.book-cover {
  position: relative;
  flex: none;
  overflow: hidden;
  background: var(--color-surface-container-high, #eae5d8);
  display: grid;
  place-items: center;
}
.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.book-cover-initial {
  font-weight: 600;
  color: var(--color-on-surface-variant);
  letter-spacing: 0.02em;
  user-select: none;
}
</style>
