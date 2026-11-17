<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ReanchorApplyResult, ReanchorFailure, ReanchorLocateResult } from "@legado/shared";
import { api } from "../../api";
import { toast } from "../../lib/toast";
import BottomSheet from "../BottomSheet.vue";

const props = defineProps<{
  modelValue: boolean;
  bookId: number;
  failures: ReanchorFailure[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  applied: [result: ReanchorApplyResult];
}>();

const activeKey = ref("");
const loadingKey = ref("");
const applying = ref(false);
const located = ref<ReanchorLocateResult | null>(null);
const error = ref("");
const chapterChoice = ref<number | null>(null);
/** 本次面板里已经定位成功的条目，不必等父组件刷新报告。 */
const resolved = ref<string[]>([]);

const reasonLabel: Record<ReanchorFailure["reason"], string> = {
  chapter_unmatched: "章节对不上",
  chapter_limit: "超过抓取上限",
  budget: "时间不够",
  chapter_fetch: "抓取失败",
  quote_missing: "正文找不到这句",
  quote_ambiguous: "这句出现多次",
};

function keyOf(item: ReanchorFailure): string {
  return item.kind + ":" + item.id;
}

const visible = computed(() => props.failures.filter((item) => !resolved.value.includes(keyOf(item))));
const subtitle = computed(() => (visible.value.length ? "逐条手动定位，不用重试整批" : "全部已定位"));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    activeKey.value = "";
    loadingKey.value = "";
    located.value = null;
    error.value = "";
    chapterChoice.value = null;
    resolved.value = [];
  },
);

function activeFailure(): ReanchorFailure | null {
  return visible.value.find((item) => keyOf(item) === activeKey.value) ?? null;
}

async function locate(item: ReanchorFailure, chapterIndex?: number): Promise<void> {
  activeKey.value = keyOf(item);
  loadingKey.value = keyOf(item);
  error.value = "";
  located.value = null;
  chapterChoice.value = null;
  try {
    const result = await api.locateReanchor(props.bookId, {
      kind: item.kind,
      id: item.id,
      ...(chapterIndex === undefined ? {} : { chapterIndex }),
    });
    located.value = result;
    if (result.targetChapterIndex === null && result.chapters.length) {
      chapterChoice.value = Math.max(0, Math.min(result.chapters.length - 1, item.chapterIndex));
    }
  } catch (err) {
    error.value = String((err as Error).message ?? err);
  } finally {
    loadingKey.value = "";
  }
}

async function findInChapter(): Promise<void> {
  const item = activeFailure();
  if (!item || chapterChoice.value === null) return;
  await locate(item, chapterChoice.value);
}

async function useCandidate(start: number, end: number): Promise<void> {
  const item = activeFailure();
  const target = located.value?.targetChapterIndex;
  if (!item || target === null || target === undefined || applying.value) return;
  applying.value = true;
  try {
    const result = await api.applyReanchor(props.bookId, {
      kind: item.kind,
      id: item.id,
      chapterIndex: target,
      start,
      end,
    });
    resolved.value = [...resolved.value, keyOf(item)];
    emit("applied", result);
    toast(`已定位到第 ${target + 1} 章`, "success");
    located.value = null;
    activeKey.value = "";
  } catch (err) {
    error.value = String((err as Error).message ?? err);
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <BottomSheet inline :open="modelValue" title="重贴失败" :subtitle="subtitle" @close="emit('update:modelValue', false)">
    <div v-if="!visible.length" class="reanchor-empty">
      <p>没有待定位的标注/书签了</p>
      <p class="muted">换源后没跟过来的位置都已经处理完。</p>
    </div>
    <div v-else class="reanchor-list">
      <div v-for="item in visible" :key="keyOf(item)" class="reanchor-item" :class="{ active: activeKey === keyOf(item) }">
        <button type="button" class="reanchor-main" @click="locate(item)">
          <span class="reanchor-title">
            <span class="reanchor-kind">{{ item.kind === "annotation" ? "标注" : "书签" }}</span>
            {{ item.chapterTitle || `第 ${item.chapterIndex + 1} 章` }}
          </span>
          <span class="reanchor-reason">{{ reasonLabel[item.reason] || item.reason }}</span>
          <span class="reanchor-quote">「{{ item.quote || "（没有引文）" }}」</span>
        </button>
        <div v-if="activeKey === keyOf(item)" class="reanchor-detail">
          <p v-if="loadingKey === keyOf(item)" class="muted">正在新源里找这句…</p>
          <p v-else-if="error" class="reanchor-error">{{ error }}</p>
          <template v-else-if="located">
            <p class="muted reanchor-target">
              目标章：{{ located.targetChapterTitle || "章节对不上" }}
              <span v-if="located.candidates.length">· 找到 {{ located.candidates.length }} 处</span>
            </p>
            <div v-if="located.targetChapterIndex === null" class="reanchor-pick">
              <label>
                选择新源里的章节
                <select v-model.number="chapterChoice">
                  <option v-for="chapter in located.chapters" :key="chapter.index" :value="chapter.index">
                    {{ chapter.index + 1 }}. {{ chapter.title }}
                  </option>
                </select>
              </label>
              <button type="button" class="btn" :disabled="loadingKey === keyOf(item)" @click="findInChapter">在这一章找</button>
            </div>
            <div v-else-if="!located.candidates.length" class="reanchor-miss">
              <p>这一章里没有找到这段引文。</p>
              <div class="reanchor-pick">
                <label>
                  换一章找
                  <select v-model.number="chapterChoice">
                    <option v-for="chapter in located.chapters" :key="chapter.index" :value="chapter.index">
                      {{ chapter.index + 1 }}. {{ chapter.title }}
                    </option>
                  </select>
                </label>
                <button type="button" class="btn" @click="findInChapter">在这一章找</button>
              </div>
            </div>
            <div v-else class="reanchor-candidates">
              <button
                v-for="candidate in located.candidates"
                :key="candidate.start"
                type="button"
                class="reanchor-candidate"
                :disabled="applying"
                @click="useCandidate(candidate.start, candidate.end)"
              >
                <span class="reanchor-context">{{ candidate.context }}</span>
                <span class="reanchor-score">{{ candidate.score >= 1 ? "整段匹配" : "部分匹配" }}</span>
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.reanchor-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.reanchor-item {
  border: 1px solid var(--line, #e6e2da);
  border-radius: 14px;
  overflow: hidden;
  background: var(--card, #fff);
}
.reanchor-item.active {
  border-color: var(--accent, #b07d3a);
}
.reanchor-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  background: transparent;
  border: 0;
}
.reanchor-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.reanchor-kind {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent, #b07d3a) 14%, transparent);
  color: var(--accent, #8c5a00);
  font-size: 12px;
  font-weight: 500;
}
.reanchor-reason {
  align-self: flex-start;
  font-size: 12px;
  color: #8c5a00;
}
.reanchor-quote {
  font-size: 13px;
  color: var(--muted, #7a746a);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.reanchor-detail {
  padding: 0 14px 12px;
}
.reanchor-target {
  margin: 0 0 8px;
  font-size: 13px;
}
.reanchor-candidates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reanchor-candidate {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line, #e6e2da);
  background: var(--soft, #faf8f3);
  text-align: left;
}
.reanchor-context {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text, #2f2a24);
}
.reanchor-score {
  align-self: flex-start;
  font-size: 11px;
  color: var(--muted, #7a746a);
}
.reanchor-pick {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reanchor-pick label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.reanchor-pick select {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--line, #e6e2da);
  background: var(--card, #fff);
  color: inherit;
}
.reanchor-miss p {
  margin: 0 0 8px;
  font-size: 13px;
}
.reanchor-error {
  margin: 0;
  color: #b3261e;
  font-size: 13px;
}
.reanchor-empty {
  padding: 18px 4px;
  text-align: center;
}
.reanchor-empty p {
  margin: 4px 0;
}
</style>
