<template>
  <section class="page replace-page">
    <header class="rep-head">
      <button class="back-btn" @click="goBack('/me')">← 返回</button>
      <div class="rep-head-row">
        <div class="rep-head-main">
          <h1 class="rep-title">替换规则</h1>
          <p class="rep-sub">{{ rules.length }} 条规则 · {{ enabledCount }} 条生效 · 按顺序应用</p>
        </div>
        <button class="rep-add" @click="showAdd = true"><span class="rep-add-plus">＋</span>新规则</button>
      </div>
    </header>

    <EmptyState v-if="!rules.length && !loading" title="还没有替换规则" desc="可以先去「推荐规则」里一键添加常见的去广告规则。" />

    <div v-else class="rep-list">
      <article v-for="(rule, i) in rules" :key="rule.id" class="rep-item" :class="{ off: !rule.enabled }">
        <div class="rep-item-main">
          <div class="rep-item-top">
            <span class="rep-index">{{ i + 1 }}</span>
            <code class="rep-pattern">{{ rule.pattern }}</code>
          </div>
          <p class="rep-arrow">
            <span class="rep-arrow-sign">→</span>
            <span class="rep-replacement">{{ rule.replacement || "（删除）" }}</span>
            <span class="rep-tag">{{ rule.isRegex ? "正则" : "文本" }}</span>
            <span v-if="rule.scope === 'all'" class="rep-tag">全书</span>
          </p>
        </div>
        <div class="rep-item-actions">
          <button class="switch" :class="{ on: rule.enabled }" :aria-label="rule.enabled ? '停用' : '启用'" @click="toggle(rule)"><span /></button>
          <button class="rep-del" aria-label="删除" @click="remove(rule)">删除</button>
        </div>
      </article>
    </div>

    <div class="rep-section">
      <button class="rep-section-head" @click="showPresets = !showPresets">
        <span class="rep-section-title">推荐规则</span>
        <span class="rep-section-meta">{{ pendingPresets ? pendingPresets + " 条可添加" : "全部已添加" }}</span>
        <span class="rep-chevron" :class="{ open: showPresets }">›</span>
      </button>
      <div v-show="showPresets" class="rep-presets">
        <div class="rep-presets-head">
          <p>针对常见站点广告与网页残留，可单条添加，也可一键全部启用。</p>
          <button class="btn btn-primary btn-sm" :disabled="presetBusy || !pendingPresets" @click="addAllPresets">
            全部添加{{ pendingPresets ? "（" + pendingPresets + "）" : "" }}
          </button>
        </div>
        <div v-for="preset in presets" :key="preset.key" class="rep-preset" :class="{ installed: preset.installed }">
          <div class="rep-preset-main">
            <strong>{{ preset.name }}</strong>
            <span class="rep-preset-desc">{{ preset.description }}</span>
            <code class="rep-preset-code">{{ preset.pattern }}</code>
          </div>
          <button class="rep-preset-btn" :disabled="preset.installed || presetBusy" @click="addPreset(preset)">
            {{ preset.installed ? "已添加" : "添加" }}
          </button>
        </div>
        <p v-if="presetMessage" class="rep-note">{{ presetMessage }}</p>
      </div>
    </div>

    <div class="rep-section">
      <button class="rep-section-head" @click="showTest = !showTest">
        <span class="rep-section-title">试运行</span>
        <span class="rep-section-meta">拿一段正文验证效果</span>
        <span class="rep-chevron" :class="{ open: showTest }">›</span>
      </button>
      <div v-show="showTest" class="rep-test">
        <textarea v-model="sample" class="rep-textarea" rows="4" placeholder="粘贴一段正文测试" />
        <button class="btn btn-primary btn-sm" @click="test">测试</button>
        <pre v-if="tested !== null" class="rep-result">{{ tested || "（内容被全部替换为空）" }}</pre>
      </div>
    </div>

    <p v-if="message" class="rep-note rep-note-bottom">{{ message }}</p>

    <BottomSheet :open="showAdd" title="新建替换规则" subtitle="按顺序在正文里执行" @close="showAdd = false">
      <div class="rep-form">
        <label class="rep-label">查找内容</label>
        <input v-model="pattern" class="rep-input" placeholder="文本，或正则表达式" />
        <label class="rep-label">替换为</label>
        <input v-model="replacement" class="rep-input" placeholder="留空表示删除" />
        <div class="rep-checks">
          <label class="rep-check"><input v-model="isRegex" type="checkbox" /> 正则表达式</label>
          <label class="rep-check"><input v-model="scopeAll" type="checkbox" /> 应用到书名与目录</label>
        </div>
        <button class="btn btn-primary rep-submit" @click="add">添加规则</button>
        <p v-if="message" class="rep-note">{{ message }}</p>
      </div>
    </BottomSheet>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { goBack } from "../lib/nav";
import BottomSheet from "../components/BottomSheet.vue";
import EmptyState from "../components/EmptyState.vue";

interface Rule {
  id: number;
  name: string;
  pattern: string;
  replacement: string;
  scope: string;
  isRegex: boolean;
  enabled: boolean;
}

interface Preset {
  key: string;
  name: string;
  description: string;
  pattern: string;
  replacement: string;
  scope: string;
  installed: boolean;
}

const rules = ref<Rule[]>([]);
const presets = ref<Preset[]>([]);
const loading = ref(true);
const presetBusy = ref(false);
const presetMessage = ref("");
const pattern = ref("");
const replacement = ref("");
const isRegex = ref(false);
const scopeAll = ref(false);
const message = ref("");
const sample = ref("笔趣阁www.biquge.com 最新章节！请记住本站域名");
const tested = ref<string | null>(null);
const showAdd = ref(false);
const showPresets = ref(false);
const showTest = ref(false);

const enabledCount = computed(() => rules.value.filter((rule) => rule.enabled).length);

async function load() {
  loading.value = true;
  try {
    const res = await api.replaceRules();
    rules.value = res.items as Rule[];
  } finally {
    loading.value = false;
  }
}

async function loadPresets() {
  try {
    const res = await api.replacePresets();
    presets.value = res.items;
  } catch {
    presets.value = [];
  }
}

const pendingPresets = computed(() => presets.value.filter((preset) => !preset.installed).length);

async function addPreset(preset: Preset) {
  if (preset.installed || presetBusy.value) return;
  presetBusy.value = true;
  presetMessage.value = "";
  try {
    const res = await api.addReplacePresets([preset.key]);
    presetMessage.value = res.added ? `已添加「${preset.name}」` : "这条规则已经存在";
    await Promise.all([load(), loadPresets()]);
  } catch (err) {
    presetMessage.value = "添加失败：" + String((err as Error).message);
  } finally {
    presetBusy.value = false;
  }
}

async function addAllPresets() {
  const keys = presets.value.filter((preset) => !preset.installed).map((preset) => preset.key);
  if (!keys.length || presetBusy.value) return;
  presetBusy.value = true;
  presetMessage.value = "";
  try {
    const res = await api.addReplacePresets(keys);
    presetMessage.value = `已添加 ${res.added} 条推荐规则` + (res.skipped ? `，跳过 ${res.skipped} 条重复` : "");
    await Promise.all([load(), loadPresets()]);
  } catch (err) {
    presetMessage.value = "添加失败：" + String((err as Error).message);
  } finally {
    presetBusy.value = false;
  }
}

async function add() {
  if (!pattern.value.trim()) {
    message.value = "查找内容不能为空";
    return;
  }
  try {
    new RegExp(pattern.value);
  } catch {
    if (isRegex.value) {
      message.value = "正则表达式不合法";
      return;
    }
  }
  await api.addReplaceRule({
    pattern: pattern.value,
    replacement: replacement.value,
    scope: scopeAll.value ? "all" : "content",
    is_regex: isRegex.value,
  });
  pattern.value = "";
  replacement.value = "";
  message.value = "已添加";
  await load();
}

async function toggle(rule: Rule) {
  await api.patchReplaceRule(rule.id, { enabled: !rule.enabled });
  rule.enabled = !rule.enabled;
}

async function remove(rule: Rule) {
  await api.deleteReplaceRule(rule.id);
  await load();
}

async function test() {
  const res = await api.testReplace(sample.value);
  tested.value = res.result;
}

onMounted(() => {
  void load();
  void loadPresets();
});
</script>

<style scoped>
.replace-page {
  padding-bottom: 32px;
}
.rep-head {
  padding: 16px 0 12px;
}
.rep-head-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.rep-head-main {
  min-width: 0;
}
.rep-title {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.rep-sub {
  margin: 5px 0 0;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.rep-add {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.rep-add-plus {
  font-size: 15px;
  line-height: 1;
}

.rep-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rep-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
  transition: opacity 0.2s ease;
}
.rep-item.off {
  opacity: 0.58;
}
.rep-item-main {
  flex: 1;
  min-width: 0;
}
.rep-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rep-index {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.rep-pattern {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rep-arrow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0 26px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  min-width: 0;
}
.rep-arrow-sign {
  opacity: 0.6;
}
.rep-replacement {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rep-tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  font-size: 10px;
}
.rep-item-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.rep-del {
  border: 0;
  background: none;
  padding: 4px;
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
}
.rep-del:active {
  color: #b4432f;
}

.rep-section {
  margin-top: 18px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-lg);
  background: #fffdf8;
  overflow: hidden;
}
.rep-section-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border: 0;
  background: none;
  font-family: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.rep-section-title {
  font-size: var(--text-md);
  font-weight: 600;
}
.rep-section-meta {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rep-chevron {
  flex: 0 0 auto;
  font-size: 18px;
  line-height: 1;
  color: var(--color-on-surface-variant);
  transform: rotate(90deg);
  transition: transform 0.2s var(--ease-standard);
}
.rep-chevron.open {
  transform: rotate(-90deg);
}
.rep-presets {
  padding: 0 14px 12px;
  border-top: 1px solid var(--color-outline);
}
.rep-presets-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
}
.rep-presets-head p {
  flex: 1;
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--color-on-surface-variant);
}
.rep-preset {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px dashed var(--color-outline);
}
.rep-preset.installed {
  opacity: 0.55;
}
.rep-preset-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rep-preset-main strong {
  font-size: var(--text-sm);
  font-weight: 600;
}
.rep-preset-desc {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  line-height: 1.5;
}
.rep-preset-code {
  font-size: 10px;
  color: var(--color-on-surface-variant);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rep-preset-btn {
  flex: 0 0 auto;
  padding: 5px 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
}
.rep-preset-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.rep-test {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--color-outline);
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.rep-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fff;
  font-size: var(--text-sm);
  font-family: inherit;
  line-height: 1.6;
  resize: none;
  color: inherit;
}
.rep-result {
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-container);
  font-size: var(--text-xs);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.rep-note {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.rep-note-bottom {
  margin-top: 16px;
  text-align: center;
}

.rep-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 16px 8px;
}
.rep-label {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.rep-input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
  font-size: var(--text-sm);
  font-family: inherit;
  color: inherit;
}
.rep-checks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}
.rep-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.rep-submit {
  width: 100%;
  margin-top: 12px;
}
</style>
