<template>
  <section class="page org-page">
    <header class="page-head">
      <button class="back-btn" @click="back">← 返回</button>
      <h1 class="page-title">书源整理</h1>
      <p class="page-sub">
        {{ report.stats.total }} 个站点 · {{ report.stats.groups }} 个分组 · {{ report.stats.disabled }} 个已停用
      </p>
      <div class="org-actions">
        <button class="icon-chip" :disabled="loading" @click="load">{{ loading ? "加载中" : "↻ 刷新" }}</button>
      </div>
    </header>

    <div class="org-stats">
      <div class="org-stat">
        <span class="org-stat-value">{{ report.stats.total }}</span>
        <span class="org-stat-label">站点总数</span>
      </div>
      <div class="org-stat warn">
        <span class="org-stat-value">{{ report.stats.duplicateExtra }}</span>
        <span class="org-stat-label">可合并</span>
      </div>
      <div class="org-stat ok">
        <span class="org-stat-value">{{ report.stats.ok }}</span>
        <span class="org-stat-label">可用</span>
      </div>
      <div class="org-stat warn">
        <span class="org-stat-value">{{ report.stats.blocked }}</span>
        <span class="org-stat-label">需登录</span>
      </div>
      <div class="org-stat danger">
        <span class="org-stat-value">{{ report.stats.invalid }}</span>
        <span class="org-stat-label">失效</span>
      </div>
      <div class="org-stat muted">
        <span class="org-stat-value">{{ report.stats.retest }}</span>
        <span class="org-stat-label">待补测</span>
      </div>
    </div>

    <section class="org-section">
      <header class="org-section-head">
        <div class="org-section-title">
          疑似重复
          <span class="org-count">{{ report.duplicates.length }}</span>
        </div>
        <button class="btn btn-sm btn-ghost" :disabled="!report.duplicates.length || busy" @click="mergeAll">全部合并</button>
      </header>
      <p class="org-note">同一域名下有多条规则，可能是同一站点的不同频道（如塔读的出版 / 二次元），展开确认地址后再合并。</p>
      <p v-if="loading" class="org-empty">加载中…</p>
      <p v-else-if="!report.duplicates.length" class="org-empty">没有同域名重复，很干净。</p>
      <div v-for="group in report.duplicates" :key="group.key" class="dup-row">
        <div class="dup-head">
          <button class="dup-toggle" @click="toggleDup(group.key)">
            <span class="dup-name">{{ group.keep.name }}</span>
            <span class="dup-meta">{{ group.count }} 条</span>
            <span class="dup-chevron" :class="{ open: openDups.has(group.key) }">›</span>
          </button>
          <button class="btn btn-sm btn-ghost" :disabled="busy" @click="mergeOne(group.key)">合并</button>
        </div>
        <div v-if="openDups.has(group.key)" class="dup-members">
          <div v-for="member in group.members" :key="member.id" class="dup-member">
            <span class="dup-tag" :class="member.keep ? 'keep' : 'drop'">{{ member.keep ? "保留" : "删除" }}</span>
            <div class="dup-body">
              <div class="dup-member-name">#{{ member.id }} · {{ member.name }}</div>
              <div class="dup-url">{{ member.url }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="report.stats.blocked" class="org-section">
      <header class="org-section-head">
        <div class="org-section-title">
          需要登录或受限
          <span class="org-count">{{ report.stats.blocked }}</span>
        </div>
        <div class="org-section-actions">
          <button class="btn btn-sm btn-ghost" @click="openSettings">去设置登录</button>
        </div>
      </header>
      <p class="org-note">
        规则没有失效，只是当前账号、会员或线路取不到内容。登录内置源或调整线路后重新体检即可，不建议直接停用。
      </p>
      <div v-for="item in blockedPreview" :key="item.id" class="blocked-row">
        <span class="blocked-tag">需登录</span>
        <div class="invalid-body">
          <div class="invalid-name">{{ item.name }}</div>
          <div class="invalid-url" :title="item.error">{{ item.url }} · {{ item.error || "需要登录后重试" }}</div>
        </div>
      </div>
      <p v-if="report.blocked.length > blockedPreview.length" class="org-more">
        仅显示前 {{ blockedPreview.length }} 条，共 {{ report.blocked.length }} 条
      </p>
    </section>

    <section class="org-section">
      <header class="org-section-head">
        <div class="org-section-title">
          失效站点
          <span class="org-count">{{ report.invalid.length }}</span>
        </div>
        <div class="org-section-actions">
          <button class="btn btn-sm btn-ghost" :disabled="!report.invalid.length || busy" @click="disableInvalid">全部停用</button>
          <button class="btn btn-sm btn-ghost danger" :disabled="!report.invalid.length || busy" @click="deleteInvalid">全部删除</button>
        </div>
      </header>
      <p class="org-note">
        健康体检判定为 broken 的站点（搜索、详情、目录、正文多阶段硬失败）。需登录和待补测的源单列，不在这里。
      </p>
      <p v-if="!report.invalid.length" class="org-empty">没有失效站点，很干净。</p>
      <div v-for="item in invalidPreview" :key="item.id" class="invalid-row">
        <span class="status-dot" :class="'status-' + item.status" />
        <div class="invalid-body">
          <div class="invalid-name">{{ item.name }} <span class="health-score">{{ item.healthScore }} 分</span></div>
          <div class="invalid-url" :title="item.error">{{ item.url }} · {{ item.error || item.healthState }}</div>
        </div>
      </div>
      <p v-if="report.invalid.length > invalidPreview.length" class="org-more">
        仅显示前 {{ invalidPreview.length }} 条，共 {{ report.invalid.length }} 条
      </p>
    </section>

    <section class="org-section">
      <header class="org-section-head">
        <div class="org-section-title">
          分组管理
          <span class="org-count">{{ report.groups.length }}</span>
        </div>
      </header>
      <p v-if="!report.groups.length" class="org-empty">还没有分组。</p>
      <div v-for="group in report.groups" :key="group.name" class="grp-row">
        <div class="grp-main">
          <span class="grp-name">{{ group.name }}</span>
          <span class="grp-meta">
            {{ group.count }} 个 · {{ group.ok }} 可用
            <template v-if="group.blocked"> · {{ group.blocked }} 需登录</template>
            <template v-if="group.broken"> · {{ group.broken }} 失效</template>
          </span>
        </div>
        <div class="grp-actions">
          <button class="chip" :disabled="busy" @click="setGroupEnabled(group.name, true)">启用</button>
          <button class="chip" :disabled="busy" @click="setGroupEnabled(group.name, false)">停用</button>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type OrganizeReport } from "../api";
import { toast } from "../lib/toast";

const router = useRouter();

const empty: OrganizeReport = {
  stats: {
    total: 0,
    ok: 0,
    invalid: 0,
    blocked: 0,
    retest: 0,
    healthy: 0,
    degraded: 0,
    unknown: 0,
    disabled: 0,
    duplicateGroups: 0,
    duplicateExtra: 0,
    groups: 0,
  },
  duplicates: [],
  invalid: [],
  blocked: [],
  groups: [],
};

const report = ref<OrganizeReport>(empty);
const loading = ref(false);
const busy = ref(false);
const openDups = reactive(new Set<string>());
const invalidPreview = computed(() => report.value.invalid.slice(0, 8));
const blockedPreview = computed(() => report.value.blocked.slice(0, 8));

function back(): void {
  if (window.history.length > 1) router.back();
  else router.push("/me");
}

function openSettings(): void {
  router.push("/settings");
}

function toggleDup(key: string): void {
  if (openDups.has(key)) openDups.delete(key);
  else openDups.add(key);
}

async function load() {
  loading.value = true;
  try {
    report.value = await api.organize();
  } catch (err) {
    toast("加载失败：" + String((err as Error).message), "error");
  } finally {
    loading.value = false;
  }
}

async function run(task: () => Promise<string>) {
  busy.value = true;
  try {
    toast(await task(), "success");
    await load();
  } catch (err) {
    toast("操作失败：" + String((err as Error).message), "error");
  } finally {
    busy.value = false;
  }
}

function mergeOne(key: string) {
  return run(async () => {
    const res = await api.mergeDuplicates({ keys: [key] });
    return `已合并 ${res.mergedGroups} 组，删除 ${res.removed} 条`;
  });
}

function mergeAll() {
  if (!window.confirm(`将 ${report.value.duplicates.length} 组同域名书源各保留一条，其余删除。确定继续？`)) return;
  return run(async () => {
    const res = await api.mergeDuplicates({ all: true });
    return `已合并 ${res.mergedGroups} 组，删除 ${res.removed} 条`;
  });
}

function disableInvalid() {
  return run(async () => {
    const ids = report.value.invalid.map((item) => item.id);
    const res = await api.batchSources(ids, "disable");
    return `已停用 ${res.affected} 个站点`;
  });
}

function deleteInvalid() {
  if (!window.confirm(`确定删除 ${report.value.invalid.length} 个失效站点？规则将一并移除。`)) return;
  return run(async () => {
    const ids = report.value.invalid.map((item) => item.id);
    const res = await api.batchSources(ids, "delete");
    return `已删除 ${res.affected} 个站点`;
  });
}

function setGroupEnabled(name: string, enabled: boolean) {
  return run(async () => {
    const result = await api.batchSources([], enabled ? "enable" : "disable", { group: name });
    return `${name}：已${enabled ? "启用" : "停用"} ${result.affected} 个`;
  });
}

onMounted(load);
</script>

<style scoped>
.org-page { padding-bottom: 32px; }

.org-actions { margin-top: 12px; display: flex; gap: 8px; }

.org-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 18px;
}
.org-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  border-radius: var(--radius-md);
  background: var(--color-surface-container);
}
.org-stat-value { font-size: var(--text-lg); font-weight: 700; line-height: 1.2; }
.org-stat-label { font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.org-stat.warn .org-stat-value { color: #c77700; }
.org-stat.danger .org-stat-value { color: #c1543f; }
.org-stat.ok .org-stat-value { color: #2e7d52; }
.org-stat.muted .org-stat-value { color: var(--color-on-surface-variant); }

.org-section {
  margin-bottom: 18px;
  padding: 14px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-container-lowest);
  border: 1px solid var(--color-outline-variant);
}
.org-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.org-section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-md);
  font-weight: 650;
}
.org-count {
  min-width: 20px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
}
.org-section-actions { display: inline-flex; gap: 6px; }
.org-note {
  margin: 6px 0 10px;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-on-surface-variant);
}
.org-empty {
  margin: 8px 0 2px;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.org-more {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}

.dup-row { border-top: 1px solid var(--color-outline-variant); }
.dup-row:first-of-type { border-top: 0; }
.dup-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}
.dup-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dup-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}
.dup-meta { flex: 0 0 auto; font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.dup-chevron {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--color-on-surface-variant);
  transition: transform .18s var(--ease-standard);
}
.dup-chevron.open { transform: rotate(90deg); }
.dup-members { padding: 0 0 8px 4px; }
.dup-member {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
}
.dup-tag {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 600;
}
.dup-tag.keep { background: rgba(63, 155, 99, .14); color: #2e7d52; }
.dup-tag.drop { background: rgba(193, 84, 63, .12); color: #b04a35; }
.dup-body { min-width: 0; }
.dup-member-name { font-size: var(--text-sm); }
.dup-url {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  word-break: break-all;
}

.invalid-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--color-outline-variant);
}
.invalid-row:first-of-type { border-top: 0; }
.invalid-row .status-dot { margin-top: 6px; }
.invalid-body { min-width: 0; }
.invalid-name {
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.invalid-url {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.health-score { margin-left: 4px; font-size: var(--text-xs); font-weight: 500; color: var(--color-on-surface-variant); }

.blocked-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--color-outline-variant);
}
.blocked-row:first-of-type { border-top: 0; }
.blocked-tag {
  flex: 0 0 auto;
  margin-top: 1px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: rgba(199, 119, 0, .12);
  color: #a46100;
  font-size: var(--text-xs);
  font-weight: 600;
}

.grp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid var(--color-outline-variant);
}
.grp-row:first-of-type { border-top: 0; }
.grp-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.grp-name { font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp-meta { font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.grp-actions { flex: 0 0 auto; display: inline-flex; gap: 6px; }

.btn-ghost.danger { color: #b04a35; }

@media (max-width: 560px) {
  .org-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
