<template>
  <div class="setting-range" :class="{ 'is-dense': dense }">
    <div class="setting-label">
      <span>{{ label }}</span>
      <b>{{ display }}</b>
    </div>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :aria-label="label"
      @input="onInput"
    />
    <p v-if="hint" class="setting-range-hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

/**
 * 设置页与阅读设置面板共用的滑杆字段。
 * 范围、单位、精度只在这里拼一次，避免两处文案和格式漂移。
 */
const props = withDefaults(
  defineProps<{
    modelValue: number;
    label: string;
    min: number;
    max: number;
    step: number;
    unit?: string;
    precision?: number;
    hint?: string;
    dense?: boolean;
  }>(),
  { unit: "", precision: 0, hint: "", dense: false },
);

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const display = computed(() => {
  const value = props.precision > 0 ? props.modelValue.toFixed(props.precision) : String(props.modelValue);
  return value + props.unit;
});

function onInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) emit("update:modelValue", value);
}
</script>

<style scoped>
.setting-range {
  width: 100%;
}
.setting-range .setting-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  font-size: var(--text-md);
}
.setting-range .setting-label b {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--reader-fg, var(--color-primary));
  font-variant-numeric: tabular-nums;
}
.setting-range input[type="range"] {
  display: block;
  width: 100%;
  margin: 0;
}
.setting-range-hint {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--reader-muted, var(--color-on-surface-variant));
}
.setting-range.is-dense .setting-label {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--reader-muted);
}
.setting-range.is-dense .setting-label b {
  font-size: 12px;
}
.setting-range.is-dense .setting-range-hint {
  margin-top: 4px;
  font-size: 11px;
}
</style>
