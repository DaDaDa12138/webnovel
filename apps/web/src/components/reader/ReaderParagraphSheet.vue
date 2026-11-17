<script setup lang="ts">
import { computed } from "vue";
import BottomSheet from "../BottomSheet.vue";
import type { ParagraphFixKind } from "../../lib/reader-paragraph-fixes";

const props = defineProps<{
  modelValue: boolean;
  text: string;
  chapterTitle?: string;
  current: ParagraphFixKind | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [kind: ParagraphFixKind | null];
}>();

const options: Array<{ kind: ParagraphFixKind | null; label: string; hint: string }> = [
  { kind: null, label: "自动识别", hint: "恢复按正文位置和内容自动判断" },
  { kind: "text", label: "正文", hint: "普通段落，参与合段和长段细分" },
  { kind: "note", label: "作者话", hint: "弱化颜色，适合更新说明、请假条" },
  { kind: "subhead", label: "小标题", hint: "加粗、不缩进，适合章节内的小标题" },
];

const excerpt = computed(() => String(props.text ?? "").trim().replace(/\s+/g, " ").slice(0, 120));
</script>

<template>
  <BottomSheet
    inline
    :open="modelValue"
    title="这一段是"
    :subtitle="chapterTitle ? chapterTitle + ' · 只影响本书' : '只影响本书'"
    @close="emit('update:modelValue', false)"
  >
    <p class="para-fix-excerpt">{{ excerpt }}{{ text.trim().length > 120 ? "…" : "" }}</p>
    <div class="para-fix-options">
      <button
        v-for="option in options"
        :key="option.label"
        type="button"
        class="para-fix-option"
        :class="{ active: current === option.kind }"
        @click="emit('pick', option.kind)"
      >
        <span class="para-fix-label">{{ option.label }}</span>
        <span class="para-fix-hint">{{ option.hint }}</span>
        <span v-if="current === option.kind" class="para-fix-check" aria-hidden="true">✓</span>
      </button>
    </div>
    <p class="para-fix-foot">纠正只改这一段的展示方式，不改原文、进度、书签和划线。</p>
  </BottomSheet>
</template>

<style scoped>
.para-fix-excerpt {
  margin: 0 0 10px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--reader-soft, rgba(127, 127, 127, 0.08));
  color: var(--reader-muted, #6f6a61);
  font-size: 12.5px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.para-fix-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.para-fix-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  padding: 9px 40px 9px 12px;
  border: 1px solid var(--line, #e6e2da);
  border-radius: 14px;
  background: var(--card, #fff);
  text-align: left;
}
.para-fix-option.active {
  border-color: var(--accent, #b07d3a);
  background: color-mix(in srgb, var(--accent, #b07d3a) 7%, var(--card, #fff));
}
.para-fix-label {
  font-size: 14.5px;
  font-weight: 600;
}
.para-fix-hint {
  font-size: 11.5px;
  color: var(--muted, #7a746a);
  line-height: 1.4;
}
.para-fix-check {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--accent, #b07d3a);
  font-size: 18px;
  font-weight: 700;
}
.para-fix-foot {
  margin: 10px 2px 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--muted, #7a746a);
}
</style>
