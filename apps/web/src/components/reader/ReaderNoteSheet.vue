<script setup lang="ts">
import { ref, watch } from "vue";
import { ANNOTATION_COLORS, type AnnotationColor } from "@legado/shared";
import BottomSheet from "../BottomSheet.vue";

const props = defineProps<{
  modelValue: boolean;
  quote: string;
  comment: string;
  color: AnnotationColor;
  editing?: boolean;
  /** 章末笔记：没有引文，标题和占位文案换成「本章」。 */
  chapterNote?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [payload: { comment: string; color: AnnotationColor }];
  remove: [];
}>();

const draft = ref(props.comment);
const picked = ref<AnnotationColor>(props.color);

watch(
  () => [props.modelValue, props.comment, props.color] as const,
  ([open, comment, color]) => {
    if (!open) return;
    draft.value = comment;
    picked.value = color;
  },
);
</script>

<template>
  <BottomSheet
    inline
    :open="modelValue"
    :title="chapterNote ? '本章笔记' : editing ? '编辑批注' : '写笔记'"
    :subtitle="chapterNote ? quote : quote ? quote.slice(0, 40) + (quote.length > 40 ? '…' : '') : ''"
    @close="emit('update:modelValue', false)"
  >
    <div class="note-body">
      <textarea
        v-model="draft"
        class="note-input"
        rows="4"
        maxlength="2000"
        :placeholder="chapterNote ? '记下这一章的想法…' : '写点什么…（可留空，只保留划线）'"
      />
      <div v-if="!chapterNote" class="note-colors">
        <button
          v-for="color in ANNOTATION_COLORS"
          :key="color"
          class="hl-dot"
          :class="['hl-dot-' + color, { 'is-picked': picked === color }]"
          type="button"
          :aria-label="color"
          @click="picked = color"
        />
      </div>
      <div class="note-actions">
        <button v-if="editing" class="btn ghost" @click="emit('remove')">删除</button>
        <span class="note-gap" />
        <button class="btn" :disabled="chapterNote && !draft.trim()" @click="emit('save', { comment: draft.trim(), color: picked })">保存</button>
      </div>
    </div>
  </BottomSheet>
</template>
