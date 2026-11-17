<script setup lang="ts">
/**
 * 朗读进行中的浮条：只有「暂停/继续」和「停止」两件事。
 * 放在阅读区底部而不是工具栏里，因为工具栏会自动隐藏，而朗读状态必须随时可停。
 */
defineProps<{
  paused?: boolean;
  engine?: "system" | "http" | null;
  rate?: number;
  /** 工具栏可见时抬高，避免压在进度条上。 */
  lifted?: boolean;
}>();

const emit = defineEmits<{
  pause: [];
  resume: [];
  stop: [];
}>();
</script>

<template>
  <div class="reader-speech-bar" :class="{ lifted, 'is-paused': paused }">
    <span class="speech-dot" aria-hidden="true"></span>
    <span class="speech-label">{{ engine === "http" ? "服务端朗读" : "浏览器朗读" }}</span>
    <span class="speech-rate">{{ (rate ?? 1).toFixed(1) }}×</span>
    <button
      v-if="paused"
      class="speech-btn"
      type="button"
      aria-label="继续朗读"
      @click="emit('resume')"
    >
      ▶
    </button>
    <button v-else class="speech-btn" type="button" aria-label="暂停朗读" @click="emit('pause')">⏸</button>
    <button class="speech-btn" type="button" aria-label="停止朗读" @click="emit('stop')">■</button>
  </div>
</template>
