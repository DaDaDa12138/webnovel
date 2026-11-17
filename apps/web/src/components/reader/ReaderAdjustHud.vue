<script setup lang="ts">
import { computed } from "vue";
import { adjustPercent, adjustText, type AdjustKind } from "../../lib/reader-adjust";

const props = defineProps<{ kind: AdjustKind | null; value: number; visible: boolean; lifted?: boolean }>();

const min = computed(() => (props.kind === "brightness" ? 0 : 12));
const max = computed(() => (props.kind === "brightness" ? 100 : 36));
const percent = computed(() => adjustPercent(props.value, min.value, max.value));
const text = computed(() => (props.kind ? adjustText(props.kind, props.value) : ""));
</script>

<template>
  <div class="reader-adjust" :class="{ visible, lifted }" role="status" aria-live="polite" :aria-label="text">
    <span class="reader-adjust-icon" aria-hidden="true">{{ kind === "brightness" ? "☀" : "Aa" }}</span>
    <span class="reader-adjust-track"><span class="reader-adjust-fill" :style="{ width: percent + '%' }" /></span>
    <span class="reader-adjust-value">{{ kind === "brightness" ? Math.round(value) : value }}</span>
  </div>
</template>
