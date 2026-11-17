<script setup lang="ts">
/** 空态/错误态的统一外观：标题 + 说明 + 可选操作。 */
defineProps<{ title: string; desc?: string }>();
</script>

<template>
  <div class="empty-state">
    <p class="empty-title">{{ title }}</p>
    <p v-if="desc" class="empty-desc">{{ desc }}</p>
    <slot />
  </div>
</template>
