<template>
  <section class="page sources-page">
    <header class="page-head">
      <button class="back-btn" @click="back">← 返回</button>
      <h1 class="page-title">书源</h1>
      <p class="page-sub">{{ stats.enabled ?? stats.total }} 个启用 · {{ stats.disabled ?? 0 }} 个停用 · {{ okCount }} 个健康或可补测</p>
      <div class="src-actions">
        <button class="btn btn-primary btn-sm" :disabled="testing" @click="testAll">{{ testing ? "体检中…" : "体检当前筛选" }}</button>
        <button class="icon-chip" :disabled="audit.running" @click="startAuditRun('quick')">快速巡检</button>
        <button class="icon-chip" :disabled="audit.running" @click="startAuditRun('full')">完整体检</button>
        <button class="icon-chip" @click="router.push('/sources/organize')">整理</button>
        <button class="icon-chip" @click="showImport = true; importAudits = []">导入</button>
      </div>
    </header>

    <section v-if="builtins.length" class="builtin-grid">
      <article v-for="card in builtins" :key="card.kind" class="builtin-card">
        <div class="builtin-head">
          <span class="src-dot" :class="'src-dot-' + card.healthState" />
          <b>{{ card.name }}</b>
          <span class="src-badge" :class="'src-health-' + card.healthState">{{ statusLabel(card.healthState) }}</span>
          <span class="builtin-score">{{ card.healthScore }}</span>
        </div>
        <p class="builtin-meta">
          {{ card.configured ? (card.account || "已配置") : "未登录" }}
          <span v-if="card.plan"> · {{ card.plan }}</span>
          <span v-if="card.server"> · {{ card.server.replace(/^https?:\/\//, "") }}</span>
        </p>
        <div class="builtin-stages">
          <span v-for="stage in stageDots(card)" :key="stage.key" class="stage-dot" :class="'stage-' + stage.status">{{ stage.label }}</span>
          <span class="builtin-checked">{{ card.healthChecks ? `体检 ${card.healthChecks} 次` : "尚未体检" }}</span>
        </div>
        <p v-if="card.lastStageError" class="builtin-error" :title="card.lastStageError">{{ card.lastStageError }}</p>
        <div class="builtin-actions">
          <button class="btn btn-sm btn-ghost" @click="router.push('/settings')">{{ card.configured ? "账号设置" : "去登录" }}</button>
          <button v-if="card.sourceId" class="btn btn-sm btn-ghost" @click="router.push(`/sources/${card.sourceId}/debug`)">健康档案</button>
        </div>
      </article>
    </section>

    <div class="src-stats">
      <button
        v-for="card in statCards"
        :key="card.value"
        class="src-stat"
        :class="[card.tone, { active: isCardActive(card.value) }]"
        :aria-pressed="isCardActive(card.value)"
        :title="card.value ? '只看' + card.label + '书源' : '显示启用中的书源'"
        @click="setHealth(card.value)"
      >
        <span class="src-stat-value">{{ card.count }}</span>
        <span class="src-stat-label">{{ card.label }}</span>
      </button>
    </div>

    <label class="src-search">
      <span class="search-icon" aria-hidden="true">🔍</span>
      <input v-model="keyword" placeholder="搜索书源名称或地址" @keyup.enter="reload" />
      <button v-if="keyword" class="src-search-clear" aria-label="清除" @click.prevent="keyword = ''; reload()">✕</button>
    </label>

    <div class="src-filters">
      <button
        v-for="f in filters"
        :key="f.value"
        class="src-filter"
        :class="{ active: isCardActive(f.value) }"
        @click="setHealth(f.value)"
      >
        {{ f.label }}<span class="src-filter-count">{{ countOf(f.value) }}</span>
      </button>
    </div>

    <div class="src-selects">
      <label>阶段
        <select v-model="stageFilter" @change="reload">
          <option value="">全部</option>
          <option value="search">搜索</option>
          <option value="detail">详情</option>
          <option value="toc">目录</option>
          <option value="content">正文</option>
        </select>
      </label>
      <label>结果
        <select v-model="stageStatusFilter" @change="reload">
          <option value="">全部</option>
          <option value="ok">正常</option>
          <option value="empty">空结果</option>
          <option value="blocked">需登录</option>
          <option value="fail">失败</option>
          <option value="skip">跳过</option>
        </select>
      </label>
      <label>排序
        <select v-model="sortMode" @change="reload">
          <option value="">默认</option>
          <option value="health">健康优先</option>
          <option value="score">评分</option>
          <option value="avgMs">响应速度</option>
          <option value="lastCheck">最近体检</option>
        </select>
      </label>
    </div>

    <div v-if="audit.running || auditSummary" class="speed-panel health-panel">
      <div class="speed-head">
        <strong>{{ audit.running ? (audit.mode === "full" ? "正在完整体检" : "正在快速巡检") : "巡检结果" }}</strong>
        <span class="muted">{{ audit.done }} / {{ audit.total }} · 健康 {{ healthyCount }} · 降级 {{ auditDegraded }} · 需登录 {{ auditBlocked }} · 失效 {{ audit.failed }}</span>
        <button v-if="audit.running" class="link-btn" @click="stopAuditRun">停止</button>
        <template v-else>
          <button v-if="audit.canResume" class="link-btn" @click="resumeAuditRun">继续上次（剩 {{ audit.total - audit.done }}）</button>
          <button v-if="audit.errors.length" class="link-btn" @click="retryFailedAudit">重跑失败</button>
          <button class="link-btn" @click="auditSummary = ''">关闭</button>
        </template>
      </div>
      <div class="progress-track"><div class="progress-fill" :style="{ width: auditPercent + '%' }"></div></div>
      <div class="health-stage-grid">
        <div v-for="row in auditStageRows" :key="row.key" class="health-stage-cell">
          <b>{{ row.label }}</b>
          <span class="hs-ok">{{ row.counts.ok }}</span>
          <span v-if="row.counts.empty" class="hs-empty">{{ row.counts.empty }} 空</span>
          <span v-if="row.counts.blocked" class="hs-blocked">{{ row.counts.blocked }} 登录</span>
          <span v-if="row.counts.fail" class="hs-fail">{{ row.counts.fail }} 失败</span>
        </div>
      </div>
      <div class="health-dist">
        <span v-for="item in auditHealthRows" :key="item.state" class="health-dist-item" :class="'hs-' + item.state">{{ item.label }} {{ item.count }}</span>
      </div>
      <p class="speed-note">
        <template v-if="audit.running">{{ audit.current || "准备中…" }}<span class="muted"> · 关掉页面也会继续跑</span></template>
        <template v-else>{{ auditSummary }}</template>
      </p>
      <details v-if="audit.errors.length" class="health-errors">
        <summary>{{ audit.errors.length }} 条错误</summary>
        <p v-for="err in audit.errors.slice(0, 5)" :key="err.sourceId + err.error">{{ err.name || "#" + err.sourceId }}：{{ err.error }}</p>
      </details>
    </div>

    <div v-if="testing || testSummary" class="speed-panel health-panel">
      <div class="speed-head">
        <strong>{{ testing ? (testingMode === "full" ? "正在完整体检" : "正在快速体检") : "体检结果" }}</strong>
        <span class="muted">{{ testDone }} / {{ testTotal }} · 健康 {{ testOk }} · 降级 {{ testDegraded }} · 需登录 {{ testBlocked }} · 失败 {{ testFailed }}</span>
        <button v-if="testing" class="link-btn" @click="stopTest">停止</button>
        <button v-else class="link-btn" @click="testSummary = ''">关闭</button>
      </div>
      <div class="progress-track"><div class="progress-fill" :style="{ width: testPercent + '%' }"></div></div>
      <p class="speed-note">
        <template v-if="testing">{{ currentName || "准备中…" }}<span v-if="currentMs"> · {{ msLabel(currentMs) }}</span></template>
        <template v-else>{{ testSummary }}</template>
      </p>
    </div>

    <div v-if="selection.length" class="batch-bar">
      <span class="batch-count">已选 {{ selection.length }} 项</span>
      <button class="btn btn-tonal btn-sm" :disabled="testing" @click="checkSelected('quick')">{{ testing ? "体检中…" : "快速体检" }}</button>
      <button class="btn btn-ghost btn-sm" :disabled="testing" @click="checkSelected('full')">完整体检</button>
      <button class="btn btn-ghost btn-sm" @click="batchEnable(true)">启用</button>
      <button class="btn btn-ghost btn-sm" @click="batchEnable(false)">停用</button>
      <button class="btn btn-ghost btn-sm" @click="moveSelected">移动分组</button>
      <button class="btn btn-ghost btn-sm" :disabled="testing" @click="removeSelected">删除</button>
      <button class="btn btn-ghost btn-sm" @click="selection = []">取消</button>
    </div>

    <div class="src-list-head">
      <label class="pick-all"><input type="checkbox" :checked="allSelected" @change="toggleAll" /> 全选本页</label>
      <span class="muted">本页 {{ items.length }} / 共 {{ total }}</span>
    </div>

    <div class="src-card">
      <div v-if="loading && !items.length" class="loading">加载中…</div>
      <template v-else>
        <div v-for="item in items" :key="item.id" class="src-row" :class="{ picked: selection.includes(item.id), 'is-disabled': !item.enabled }">
          <input type="checkbox" class="pick" :checked="selection.includes(item.id)" @change="toggleSelect(item.id)" />
          <button class="src-main" @click="openDebug(item)">
            <span class="src-name ellipsis">
              <span class="src-dot" :class="'src-dot-' + item.healthState" />{{ item.name }}
              <span class="src-badge" :class="item.enabled ? 'src-health-' + item.healthState : 'src-health-disabled'" :title="sourceStateTitle(item)">{{ item.enabled ? sourceStateLabel(item) : "已停用" }}</span>
              <span v-if="item.healthScore && item.enabled" class="src-score">{{ item.healthScore }}</span>
            </span>
            <span class="src-meta ellipsis" :title="item.lastError || item.lastStageError || item.url">
              {{ displayUrl(item.url) }}
              <span class="speed" :class="item.avgMs ? speedClass(item.avgMs) : 'untested'">· {{ item.avgMs ? msLabel(item.avgMs) : "未测速" }}</span>
              <span v-if="item.lastCheckAt" class="src-checked">· {{ shortDate(item.lastCheckAt) }}</span>
            </span>
            <span class="src-stages" :title="healthTitle(item)">
              <span v-for="stage in stageDots(item)" :key="stage.key" class="stage-dot" :class="'stage-' + stage.status">{{ stage.label }}</span>
              <span v-if="item.lastStageError && item.enabled" class="src-last-error ellipsis">{{ item.lastStageError }}</span>
            </span>
            <span v-if="!item.enabled" class="src-disabled-reason ellipsis" :title="disabledReason(item)">停用原因：{{ disabledReason(item) }}</span>
          </button>
          <button v-if="!item.enabled" class="src-reenable" @click.stop="toggleEnabled(item)">重新启用</button>
          <button class="switch" :class="{ on: item.enabled }" :aria-label="item.enabled ? '停用' : '启用'" @click="toggleEnabled(item)">
            <span></span>
          </button>
        </div>
        <div v-if="!items.length" class="loading">没有匹配的书源</div>
      </template>
    </div>

    <div v-if="items.length < total" class="load-more">
      <button class="btn btn-tonal" @click="loadMore">加载更多（{{ items.length }}/{{ total }}）</button>
    </div>

    <p v-if="message" class="muted src-message">{{ message }}</p>

    <BottomSheet :open="showImport" title="导入书源" subtitle="订阅链接或 legado:// 链接" @close="showImport = false">
      <div class="import-sheet">
        <textarea v-model="importUrl" rows="3" class="import-area" placeholder="https://example.com/bookSource.json" />
        <button class="btn btn-primary import-submit" :disabled="importing || !importUrl.trim()" @click="importFromUrlThenClose">
          {{ importing ? "导入中…" : "开始导入" }}
        </button>
        <div v-if="importAudits.length" class="import-audits">
          <b>{{ importAudits.length }} 个书源有静态问题</b>
          <div v-for="audit in importAudits.slice(0, 8)" :key="audit.index" class="import-audit-row">
            <span class="ellipsis">{{ audit.name || "#" + (audit.index + 1) }}</span>
            <span class="import-audit-count">{{ audit.errors }} 错误 · {{ audit.warnings }} 警告</span>
          </div>
          <p v-if="importAudits.length > 8" class="import-note">还有 {{ importAudits.length - 8 }} 个，导入后可在书源详情里逐个检查。</p>
        </div>
        <p class="import-note">本地 JSON 文件请到「我的 → 导入书源」选择。静态体检不联网，只查规则结构、JS 语法和正则。</p>
      </div>
    </BottomSheet>

    <BottomSheet :open="showAudit" title="书源静态体检" :subtitle="auditTarget?.name ?? ''" @close="closeAudit">
      <div v-if="auditReport" class="audit-sheet">
        <div class="audit-summary" :class="{ bad: auditReport.errors > 0 }">
          <strong>{{ auditReport.errors > 0 ? `发现 ${auditReport.errors} 个静态错误` : "没有静态错误" }}</strong>
          <span>{{ auditReport.warnings }} 个警告 · {{ auditReport.infos }} 个提示</span>
        </div>
        <div v-if="auditReport.issues.length" class="audit-list">
          <article v-for="(issue, i) in auditReport.issues" :key="issue.code + issue.field + i" class="audit-issue">
            <span class="audit-badge" :class="'audit-' + auditIssueTone(issue)">{{ auditIssueLabel(issue) }}</span>
            <div class="audit-body">
              <b>{{ auditStageLabel(issue.stage) }} · {{ issue.field }}</b>
              <p>{{ issue.message }}</p>
              <code v-if="issue.sample">{{ issue.sample }}</code>
            </div>
          </article>
        </div>
        <p v-else class="import-note">规则结构完整，可以启用。静态体检不能替代联网体检，建议启用后跑一次快速体检。</p>
        <p class="import-note">这些错误会在解析时让对应字段返回空值。可以「仍要启用」先观察，但更推荐修好规则再启用。</p>
        <div class="audit-actions">
          <button class="btn btn-ghost" @click="closeAudit">取消</button>
          <button v-if="auditReport.errors > 0" class="btn btn-primary" @click="forceEnable">仍要启用</button>
        </div>
      </div>
    </BottomSheet>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type AuditState, type BuiltinSourceCard, type SourceAuditIssue, type SourceAuditReport, type SourceItem, type Stats } from "../api";
import { goBack } from "../lib/nav";
import BottomSheet from "../components/BottomSheet.vue";

const router = useRouter();
const stats = ref<Stats>({ total: 0, status: {}, types: {}, groups: [] });
const items = ref<SourceItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 60;
const keyword = ref("");
const enabledFilter = ref<"0" | "1">("1");
const healthFilter = ref("");
const stageFilter = ref("");
const stageStatusFilter = ref("");
const sortMode = ref("");
const loading = ref(false);
const selection = ref<number[]>([]);
const importing = ref(false);
const importUrl = ref("");
const showImport = ref(false);
const importAudits = ref<Array<{ index: number; name: string; errors: number; warnings: number; issues: SourceAuditIssue[] }>>([]);
const message = ref("");
const showAudit = ref(false);
const auditTarget = ref<SourceItem | null>(null);
const auditReport = ref<SourceAuditReport | null>(null);
const builtins = ref<BuiltinSourceCard[]>([]);

const idleAudit = (): AuditState => ({
  running: false,
  key: "",
  mode: "quick",
  total: 0,
  done: 0,
  ok: 0,
  failed: 0,
  current: "",
  startedAt: 0,
  finishedAt: 0,
  stopped: false,
  cursor: 0,
  stages: {
    search: { ok: 0, empty: 0, blocked: 0, fail: 0, skip: 0 },
    detail: { ok: 0, empty: 0, blocked: 0, fail: 0, skip: 0 },
    toc: { ok: 0, empty: 0, blocked: 0, fail: 0, skip: 0 },
    content: { ok: 0, empty: 0, blocked: 0, fail: 0, skip: 0 },
  },
  health: { unknown: 0, partial: 0, healthy: 0, degraded: 0, blocked: 0, broken: 0 },
  errors: [],
  canResume: false,
  interrupted: false,
});

const audit = ref<AuditState>(idleAudit());
const auditSummary = ref("");
let auditTimer: number | undefined;
const auditPercent = computed(() => (audit.value.total ? Math.round((audit.value.done / audit.value.total) * 100) : 0));
const healthyCount = computed(() => (audit.value.health.healthy ?? 0) + (audit.value.health.partial ?? 0));
const auditDegraded = computed(() => audit.value.health.degraded ?? 0);
const auditBlocked = computed(() => audit.value.health.blocked ?? 0);

const testing = ref(false);
const testingMode = ref<"quick" | "full">("quick");
const testDone = ref(0);
const testTotal = ref(0);
const testOk = ref(0);
const testDegraded = ref(0);
const testBlocked = ref(0);
const testFailed = ref(0);
const currentName = ref("");
const currentMs = ref(0);
const testSummary = ref("");
let testController: AbortController | null = null;

/** Keep a real escape hatch: /sources is reachable from the rail, the tab bar and deep links. */
function back(): void {
  goBack("/shelf");
}

const filters = [
  { label: "全部", value: "" },
  { label: "健康", value: "healthy" },
  { label: "待补测", value: "partial" },
  { label: "降级", value: "degraded" },
  { label: "需登录", value: "blocked" },
  { label: "失效", value: "broken" },
  { label: "未测", value: "unknown" },
  { label: "已停用", value: "disabled" },
];

const enabledHealth = computed(() => stats.value.healthEnabled ?? stats.value.health ?? {});

const statCards = computed(() => [
  { label: "启用中", value: "", count: stats.value.enabled ?? stats.value.total, tone: "" },
  { label: "健康", value: "healthy", count: enabledHealth.value.healthy ?? 0, tone: "ok" },
  { label: "待补测", value: "partial", count: enabledHealth.value.partial ?? 0, tone: "warn" },
  { label: "降级", value: "degraded", count: enabledHealth.value.degraded ?? 0, tone: "warn" },
  { label: "需登录", value: "blocked", count: enabledHealth.value.blocked ?? 0, tone: "muted" },
  { label: "失效", value: "broken", count: enabledHealth.value.broken ?? 0, tone: "bad" },
  { label: "未测", value: "unknown", count: enabledHealth.value.unknown ?? 0, tone: "muted" },
  { label: "已停用", value: "disabled", count: stats.value.disabled ?? 0, tone: "muted" },
]);

const okCount = computed(() => (enabledHealth.value.healthy ?? 0) + (enabledHealth.value.partial ?? 0));

function isCardActive(value: string): boolean {
  return value === "disabled" ? enabledFilter.value === "0" : enabledFilter.value === "1" && healthFilter.value === value;
}

function countOf(value: string): number {
  if (value === "disabled") return stats.value.disabled ?? 0;
  if (!value) return stats.value.enabled ?? stats.value.total;
  return enabledHealth.value[value] ?? 0;
}
const allSelected = computed(() => items.value.length > 0 && items.value.every((item) => selection.value.includes(item.id)));
const testPercent = computed(() => (testTotal.value ? Math.min(100, Math.round((testDone.value / testTotal.value) * 100)) : 0));

function statusLabel(s: string): string {
  return { healthy: "健康", partial: "待补测", degraded: "降级", blocked: "需登录", broken: "失效", unknown: "未测" }[s] ?? "未测";
}

function needsWebView(item: SourceItem): boolean {
  return /java\.(webView|startBrowser)|UNSUPPORTED_WEBVIEW/i.test(`${item.lastStageError ?? ""} ${item.lastError ?? ""}`);
}

/** 只测到搜索无结果的源，直接标「无结果」，比笼统的「待补测」更能解释为什么没通过。 */
function sourceStateLabel(item: SourceItem): string {
  if (needsWebView(item)) return "需 WebView";
  if (item.healthState === "partial" && item.stageSummary.search === "empty") return "无结果";
  return statusLabel(item.healthState);
}

function sourceStateTitle(item: SourceItem): string {
  if (needsWebView(item)) return "该源调用 java.webView / java.startBrowser，需要浏览器内核；服务端阅读引擎不支持，建议换源";
  if (item.healthState === "partial" && item.stageSummary.search === "empty") return "搜索能通，但当前关键词没有结果；换关键词或补测详情/目录/正文后再判定";
  return item.lastStageError || statusLabel(item.healthState);
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "").slice(0, 48);
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return Math.round(diff / 60_000) + " 分钟前";
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + " 小时前";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function msLabel(ms: number): string {
  if (!ms) return "—";
  return ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s";
}

function speedClass(ms: number): string {
  if (ms < 800) return "fast";
  if (ms < 2000) return "mid";
  return "slow";
}

const STAGES = [
  { key: "search", label: "搜" },
  { key: "detail", label: "详" },
  { key: "toc", label: "目" },
  { key: "content", label: "文" },
] as const;

function stageDots(item: Pick<SourceItem, "stageSummary">) {
  return STAGES.map((stage) => ({ ...stage, status: item.stageSummary?.[stage.key] ?? "skip" }));
}

function healthTitle(item: SourceItem): string {
  const parts = STAGES.map((stage) => {
    const status = item.stageSummary?.[stage.key];
    return status ? stage.label + ":" + stageStatusLabel(status) : "";
  }).filter(Boolean);
  return [item.lastStageError, parts.join(" · ")].filter(Boolean).join("\n");
}

function stageStatusLabel(status: string): string {
  return { ok: "正常", empty: "空", blocked: "需登录", fail: "失败", skip: "跳过" }[status] ?? status;
}

const auditStageRows = computed(() =>
  STAGES.map((stage) => ({
    ...stage,
    counts: audit.value.stages?.[stage.key] ?? { ok: 0, empty: 0, blocked: 0, fail: 0, skip: 0 },
  })),
);

const auditHealthRows = computed(() =>
  [
    { state: "healthy", label: "健康" },
    { state: "partial", label: "待补测" },
    { state: "degraded", label: "降级" },
    { state: "blocked", label: "需登录" },
    { state: "broken", label: "失效" },
    { state: "unknown", label: "未测" },
  ].map((item) => ({ ...item, count: audit.value.health?.[item.state as keyof typeof audit.value.health] ?? 0 })),
);

async function fetchPage(nextPage: number, append: boolean) {
  loading.value = true;
  try {
    const res = await api.sources({
      q: keyword.value.trim(),
      enabled: enabledFilter.value,
      health: healthFilter.value,
      stage: stageFilter.value,
      stageStatus: stageStatusFilter.value,
      sort: sortMode.value,
      page: nextPage,
      pageSize,
    });
    items.value = append ? [...items.value, ...res.items] : res.items;
    total.value = res.total;
    page.value = nextPage;
  } finally {
    loading.value = false;
  }
}

function reload() {
  void fetchPage(1, false);
}

function loadMore() {
  void fetchPage(page.value + 1, true);
}

function setHealth(value: string) {
  // 统计卡是“全局健康视图”：点某一类时清掉阶段筛选，避免两个条件叠加后只剩 0 条。
  if (value === "disabled") {
    enabledFilter.value = enabledFilter.value === "0" ? "1" : "0";
    healthFilter.value = "";
  } else {
    enabledFilter.value = "1";
    healthFilter.value = value && healthFilter.value !== value ? value : "";
  }
  stageFilter.value = "";
  stageStatusFilter.value = "";
  reload();
}

function disabledReason(item: SourceItem): string {
  const stage = item.lastStage
    ? ({ search: "搜索", detail: "详情", toc: "目录", content: "正文" } as Record<string, string>)[item.lastStage]
    : "";
  const error = item.lastStageError || item.lastError;
  if (!error) return "手动停用";
  return [stage, error].filter(Boolean).join(" · ");
}

function toggleSelect(id: number) {
  selection.value = selection.value.includes(id) ? selection.value.filter((v) => v !== id) : [...selection.value, id];
}

function toggleAll() {
  selection.value = allSelected.value ? [] : items.value.map((item) => item.id);
}

async function toggleEnabled(item: SourceItem) {
  const next = !item.enabled;
  try {
    await api.patchSource(item.id, { enabled: next });
    item.enabled = next;
    message.value = next ? `已启用「${item.name}」` : `已停用「${item.name}」`;
    try {
      stats.value = await api.stats();
    } catch {
      /* 统计刷新失败不影响启停结果 */
    }
    reload();
  } catch (err) {
    const error = err as Error & { code?: string; data?: { audit?: SourceAuditReport } };
    // 启用前会先跑静态体检；把明细摊开给用户看，而不是只弹一句“失败”。
    if (error.code === "source_audit_failed" && error.data?.audit) {
      auditTarget.value = item;
      auditReport.value = error.data.audit;
      showAudit.value = true;
      return;
    }
    message.value = (next ? "启用失败：" : "停用失败：") + error.message;
  }
}

async function forceEnable() {
  const item = auditTarget.value;
  if (!item) return;
  try {
    await api.patchSource(item.id, { enabled: true, force: true });
    item.enabled = true;
    showAudit.value = false;
    message.value = `已强制启用「${item.name}」，静态问题仍然存在，建议先修规则`;
    try {
      stats.value = await api.stats();
    } catch {
      /* 统计刷新失败不影响启用结果 */
    }
    reload();
  } catch (err) {
    message.value = "强制启用失败：" + String((err as Error).message);
  }
}

function closeAudit() {
  showAudit.value = false;
  auditTarget.value = null;
  auditReport.value = null;
}

function auditIssueTone(issue: SourceAuditIssue) {
  return issue.severity === "error" ? "error" : issue.severity === "warning" ? "warn" : "info";
}

function auditIssueLabel(issue: SourceAuditIssue) {
  return issue.severity === "error" ? "错误" : issue.severity === "warning" ? "警告" : "提示";
}

function auditStageLabel(stage: string) {
  return ({ search: "搜索", explore: "发现", bookInfo: "详情", toc: "目录", content: "正文", source: "书源" } as Record<string, string>)[stage] ?? stage;
}

function openDebug(item: SourceItem) {
  router.push(`/sources/${item.id}/debug`);
}

function applyCheckResult(data: { id: number; status?: string; ms?: number; error?: string | null; healthState?: string; healthScore?: number; stages?: Record<string, string> }) {
  const item = items.value.find((row) => row.id === data.id);
  if (!item) return;
  if (data.status) item.status = data.status;
  if (typeof data.ms === "number") item.lastMs = data.ms;
  item.lastError = data.error ?? "";
  item.lastCheckAt = new Date().toISOString();
  if (data.healthState) item.healthState = data.healthState as SourceItem["healthState"];
  if (typeof data.healthScore === "number") item.healthScore = data.healthScore;
  if (data.stages) {
    item.stageSummary = { ...(item.stageSummary ?? {}) };
    for (const stage of STAGES) {
      const status = data.stages[stage.key];
      if (status) item.stageSummary[stage.key] = status as SourceItem["stageSummary"][typeof stage.key];
    }
  }
}

async function runCheck(payload: { ids?: number[]; all?: boolean; mode?: "quick" | "full" }) {
  if (testing.value) return;
  testingMode.value = payload.mode === "full" ? "full" : "quick";
  testing.value = true;
  testDone.value = 0;
  testTotal.value = 0;
  testOk.value = 0;
  testDegraded.value = 0;
  testBlocked.value = 0;
  testFailed.value = 0;
  currentName.value = "";
  currentMs.value = 0;
  testSummary.value = "";
  message.value = "";
  const controller = new AbortController();
  testController = controller;
  try {
    const res = await fetch("/api/sources/check/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        health: healthFilter.value,
        stage: stageFilter.value,
        stageStatus: stageStatusFilter.value,
        q: keyword.value.trim(),
        mode: testingMode.value,
        concurrency: testingMode.value === "full" ? 6 : 8,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error("体检服务不可用（" + res.status + "）");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        const lines = chunk.split("\n");
        const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
        const raw = lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "";
        if (!event || !raw) continue;
        const data = JSON.parse(raw);
        if (event === "start") testTotal.value = data.total ?? 0;
        if (event === "source") {
          currentName.value = data.name || "";
          currentMs.value = data.ms || 0;
          applyCheckResult(data);
        }
        if (event === "progress") {
          testDone.value = data.done ?? 0;
          testOk.value = data.ok ?? 0;
          testFailed.value = data.failed ?? 0;
          if (data.health) {
            testOk.value = (data.health.healthy ?? 0) + (data.health.partial ?? 0);
            testDegraded.value = data.health.degraded ?? 0;
            testBlocked.value = data.health.blocked ?? 0;
            testFailed.value = data.health.broken ?? 0;
          }
          if (typeof data.total === "number") testTotal.value = data.total;
        }
        if (event === "done") {
          const h = data.health || {};
          testSummary.value = `完成：${data.done} 个书源，健康 ${(h.healthy ?? 0) + (h.partial ?? 0)}，降级 ${h.degraded ?? 0}，需登录 ${h.blocked ?? 0}，失效 ${h.broken ?? 0}，用时 ${msLabel(data.elapsedMs || 0)}`;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") testSummary.value = "已停止体检";
    else message.value = "体检失败：" + String((err as Error).message);
  } finally {
    testing.value = false;
    testController = null;
    try {
      stats.value = await api.stats();
      await fetchPage(1, false);
    } catch {
      /* ignore refresh errors */
    }
  }
}

function testAll() {
  if (enabledFilter.value === "0") {
    message.value = "已停用的书源不参与体检，请先切回启用中或重新启用";
    return;
  }
  void runCheck({ all: true, mode: testingMode.value });
}

function checkSelected(mode: "quick" | "full") {
  if (!selection.value.length) return;
  void runCheck({ ids: [...selection.value], mode });
}

function stopTest() {
  testController?.abort();
}

/** 轮询后台巡检进度；跑完自动刷新统计和当前列表。 */
async function pollAudit() {
  try {
    const next = await api.auditStatus();
    audit.value = next;
    if (!next.running) {
      if (auditTimer) {
        window.clearInterval(auditTimer);
        auditTimer = undefined;
      }
      auditSummary.value = next.stopped
        ? `已停止巡检：完成 ${next.done} / ${next.total} 个源`
        : `巡检完成：${next.total} 个源，${next.ok} 个健康或可补测，${next.failed} 个失效`;
      stats.value = await api.stats();
      await fetchPage(1, false);
    }
  } catch (err) {
    message.value = "巡检状态读取失败：" + String((err as Error).message);
  }
}

function watchAudit() {
  if (auditTimer) return;
  auditTimer = window.setInterval(() => void pollAudit(), 1500);
}

async function startAuditRun(mode: "quick" | "full") {
  if (audit.value.running) return;
  if (enabledFilter.value === "0") {
    message.value = "已停用的书源不参与巡检，请先切回启用中或重新启用";
    return;
  }
  auditSummary.value = "";
  message.value = "";
  try {
    audit.value = await api.auditSources({
      all: true,
      health: healthFilter.value,
      stage: stageFilter.value,
      stageStatus: stageStatusFilter.value,
      q: keyword.value.trim(),
      mode,
    });
    watchAudit();
  } catch (err) {
    message.value = "巡检启动失败：" + String((err as Error).message);
  }
}

async function stopAuditRun() {
  try {
    audit.value = await api.stopAudit();
  } catch (err) {
    message.value = "停止失败：" + String((err as Error).message);
  }
}

async function resumeAuditRun() {
  message.value = "";
  try {
    audit.value = await api.resumeAudit();
    watchAudit();
  } catch (err) {
    message.value = "继续巡检失败：" + String((err as Error).message);
  }
}

/** 只重跑上次记录到错误的源；成功换源/体检的源不重复扫。 */
async function retryFailedAudit() {
  const ids = [...new Set(audit.value.errors.map((item) => item.sourceId))];
  if (!ids.length) return;
  message.value = "";
  try {
    audit.value = await api.auditSources({ ids, mode: audit.value.mode });
    watchAudit();
  } catch (err) {
    message.value = "重跑失败源失败：" + String((err as Error).message);
  }
}

async function batchEnable(enabled: boolean) {
  if (!selection.value.length) return;
  message.value = enabled ? "启用中…" : "停用中…";
  try {
    const res = await api.batchSources(selection.value, enabled ? "enable" : "disable");
    message.value = `已${enabled ? "启用" : "停用"} ${res.affected} 个书源`;
    await refreshAfterBatch();
  } catch (err) {
    message.value = "批量操作失败：" + String((err as Error).message);
  }
}

async function moveSelected() {
  if (!selection.value.length) return;
  const group = window.prompt("移动到哪个分组？留空表示未分组。", "");
  if (group === null) return;
  message.value = "移动分组中…";
  try {
    const res = await api.batchSources(selection.value, "group", { targetGroup: group.trim() });
    message.value = `已移动 ${res.affected} 个书源`;
    await refreshAfterBatch();
  } catch (err) {
    message.value = "移动分组失败：" + String((err as Error).message);
  }
}

async function refreshAfterBatch() {
  selection.value = [];
  stats.value = await api.stats();
  await fetchPage(1, false);
}

async function removeSelected() {
  if (!selection.value.length) return;
  if (!window.confirm(`确定删除选中的 ${selection.value.length} 个书源？此操作不可恢复。`)) return;
  message.value = "删除中…";
  try {
    const res = await api.batchSources(selection.value, "delete");
    message.value = `已删除 ${res.affected} 个书源`;
    selection.value = [];
    stats.value = await api.stats();
    await fetchPage(1, false);
  } catch (err) {
    message.value = "删除失败：" + String((err as Error).message);
  }
}

async function importFromUrlThenClose() {
  await importFromUrl();
  if (!message.value.startsWith("导入失败")) showImport.value = false;
}

async function importFromUrl() {
  const value = importUrl.value.trim();
  if (!value) return;
  importing.value = true;
  message.value = "";
  try {
    const res = await api.importSources({ url: value });
    const flagged = res.audits.filter((item) => item.errors > 0 || item.warnings > 0);
    importAudits.value = flagged;
    const errorCount = flagged.reduce((sum, item) => sum + item.errors, 0);
    message.value = `导入完成：新增 ${res.inserted}，更新 ${res.updated}` +
      (flagged.length ? `；${flagged.length} 个书源有静态问题（${errorCount} 个错误）` : "");
    importUrl.value = "";
    reload();
    stats.value = await api.stats();
  } catch (err) {
    message.value = "导入失败：" + String((err as Error).message);
  } finally {
    importing.value = false;
  }
}

onMounted(async () => {
  try {
    stats.value = await api.stats();
  } catch {
    /* ignore */
  }
  await fetchPage(1, false);
  try {
    builtins.value = (await api.builtinSources()).items;
  } catch {
    /* 内置源卡片只是辅助信息，失败不影响书源列表 */
  }
  try {
    audit.value = await api.auditStatus();
    if (audit.value.running) watchAudit();
    else if (audit.value.interrupted) {
      auditSummary.value = `上次巡检被中断：完成 ${audit.value.done} / ${audit.value.total} 个源，可继续跑剩下的`;
    } else if (audit.value.canResume) {
      auditSummary.value = `上次巡检还剩 ${audit.value.total - audit.value.done} 个源，可继续`;
    } else if (audit.value.finishedAt && Date.now() - audit.value.finishedAt < 10 * 60 * 1000) {
      auditSummary.value = audit.value.stopped
        ? `已停止巡检：完成 ${audit.value.done} / ${audit.value.total} 个源`
        : `上次巡检：${audit.value.total} 个源，${audit.value.ok} 个健康或可补测，${audit.value.failed} 个失效`;
    }
  } catch {
    /* ignore */
  }
});

onBeforeUnmount(() => {
  testController?.abort();
  if (auditTimer) window.clearInterval(auditTimer);
});
</script>

<style scoped>
.sources-page {
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
}
.src-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.src-actions .btn {
  flex: 0 0 auto;
}
.builtin-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}
.builtin-card {
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid var(--color-outline-variant);
  border-radius: var(--radius-lg);
  background: var(--color-surface-container-lowest);
}
.builtin-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.builtin-head b {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}
.builtin-score {
  margin-left: auto;
  flex: none;
  font-size: var(--text-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.builtin-meta {
  margin: 5px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.builtin-stages {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
}
.builtin-checked {
  margin-left: auto;
  font-size: 10px;
  color: var(--color-on-surface-variant);
}
.builtin-error {
  margin: 6px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: #b4463c;
}
.builtin-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.builtin-actions .btn { flex: 0 0 auto; }
.src-stats {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  margin-top: 14px;
}
.src-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-surface-container);
  color: inherit;
  font: inherit;
  text-align: left;
  min-width: 0;
  cursor: pointer;
  transition: background 0.15s var(--ease-standard), box-shadow 0.15s var(--ease-standard);
}
.src-stat:hover {
  background: var(--color-surface-container-high, var(--color-surface-container));
}
.src-stat.active {
  box-shadow: inset 0 0 0 2px var(--color-primary);
}
.src-stat:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.src-stat-value {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
}
.src-stat-label {
  font-size: 10px;
  color: var(--color-on-surface-variant);
  white-space: nowrap;
}
.src-stat.ok .src-stat-value {
  color: #2e7d4f;
}
.src-stat.warn .src-stat-value {
  color: #a9761f;
}
.src-stat.bad .src-stat-value {
  color: #b4463c;
}
.src-stat.muted .src-stat-value {
  color: var(--color-on-surface-variant);
}
.src-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  margin-top: 14px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
}
.src-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--text-md);
  color: inherit;
  outline: none;
}
.src-search-clear {
  border: 0;
  background: transparent;
  color: var(--color-on-surface-variant);
  font-size: 13px;
  line-height: 1;
  padding: 4px;
  cursor: pointer;
}
.src-filters {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  overflow-x: auto;
  scrollbar-width: none;
}
.src-filters::-webkit-scrollbar {
  display: none;
}
.src-filter {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background 0.15s var(--ease-standard), color 0.15s var(--ease-standard);
}
.src-filter.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.src-filter-count {
  font-size: var(--text-xs);
  opacity: 0.72;
}
.src-selects {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.src-selects label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.src-selects select {
  max-width: 110px;
  padding: 4px 6px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: inherit;
  font: inherit;
}
.speed-panel {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--color-surface-container);
}
.speed-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-sm);
}
.speed-head strong {
  font-size: var(--text-md);
}
.speed-head .muted {
  flex: 1;
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.progress-track {
  margin-top: 8px;
  height: 4px;
  border-radius: 999px;
  background: #e2ddcf;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.2s var(--ease-standard);
}
.speed-note {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.health-stage-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 9px;
}
.health-stage-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: baseline;
  font-size: 10px;
  color: var(--color-on-surface-variant);
}
.health-stage-cell b {
  color: var(--color-on-surface);
  font-size: 11px;
}
.hs-ok { color: #2e7d4f; }
.hs-empty { color: #a9761f; }
.hs-blocked { color: #7a5b13; }
.hs-fail { color: #b4463c; }
.health-dist {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.health-dist-item {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  font-size: 10px;
  color: var(--color-on-surface-variant);
}
.health-dist-item.hs-healthy { background: #dcefdc; color: #1f5124; }
.health-dist-item.hs-partial { background: #f8e7c8; color: #7a4a00; }
.health-dist-item.hs-blocked { background: #f2e6c8; color: #6b4b00; }
.health-dist-item.hs-broken { background: #fbe0dc; color: #8c2f1e; }
.health-errors {
  margin-top: 8px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.health-errors summary {
  cursor: pointer;
}
.health-errors p {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
.batch-bar {
  position: sticky;
  bottom: 8px;
  z-index: 6;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  background: var(--color-primary-container);
  box-shadow: var(--shadow-card);
}
.batch-count {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.src-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 2px 0;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.pick-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pick {
  width: 16px;
  height: 16px;
  flex: none;
  accent-color: var(--color-primary);
}
.src-card {
  margin-top: 8px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-xl);
  background: #fffdf8;
  overflow: hidden;
}
.src-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}
.src-row:active {
  background: var(--color-surface-container);
}
.src-row:last-child {
  border-bottom: none;
}
.src-row.picked {
  background: var(--color-primary-container);
}
.src-row.is-disabled {
  background: rgba(0, 0, 0, 0.015);
}
.src-row.is-disabled .src-name {
  color: var(--color-on-surface-variant);
}
.src-row.is-disabled .src-dot {
  background: #b9b3a7;
}
.src-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.src-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13.5px;
  font-weight: 600;
}
.src-score {
  color: var(--color-on-surface-variant);
  font-size: 10px;
  font-weight: 500;
}
.src-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: #c9c3b6;
  vertical-align: middle;
}
.src-dot-healthy { background: #3f9b63; }
.src-dot-partial { background: #d3a552; }
.src-dot-degraded { background: #d3a552; }
.src-dot-blocked { background: #b08a35; }
.src-dot-broken { background: #c1543f; }
.src-dot-unknown { background: #c9c3b6; }
.src-meta {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.src-checked {
  opacity: 0.7;
}
.src-stages {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
.stage-dot {
  flex: none;
  width: 15px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--color-on-surface-variant);
  font-size: 9px;
  line-height: 1;
}
.stage-ok { background: #dcefdc; color: #1f5124; }
.stage-empty { background: #f8e7c8; color: #7a4a00; }
.stage-blocked { background: #f2e6c8; color: #6b4b00; }
.stage-fail { background: #fbe0dc; color: #8c2f1e; }
.stage-skip { opacity: 0.55; }
.src-disabled-reason {
  max-width: 100%;
  color: #8c2f1e;
  font-size: var(--text-xs);
  opacity: 0.78;
}
.src-reenable {
  flex: none;
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
}
.src-reenable:hover {
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.src-last-error {
  max-width: 160px;
  margin-left: 4px;
  color: #b4463c;
  font-size: 10px;
}
.src-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.6;
}
.src-health-healthy { background: #dcefdc; color: #1f5124; }
.src-health-partial { background: #f8e7c8; color: #7a4a00; }
.src-health-degraded { background: #f8e7c8; color: #7a4a00; }
.src-health-blocked { background: #f2e6c8; color: #6b4b00; }
.src-health-broken { background: #fbe0dc; color: #8c2f1e; }
.src-health-unknown { background: var(--color-surface-container); color: var(--color-on-surface-variant); }
.src-health-disabled { background: #ece8df; color: #6f6a60; }
.speed {
  margin-left: 2px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.speed.fast { color: #2e7d4f; }
.speed.mid { color: #a9761f; }
.speed.slow { color: #b4463c; }
.speed.untested { opacity: 0.55; }
.switch {
  width: 36px;
  height: 20px;
  flex: none;
  position: relative;
  border: none;
  border-radius: 999px;
  background: #dcd7ca;
  transition: background 0.15s var(--ease-standard);
}
.switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s var(--ease-standard);
}
.switch.on { background: var(--color-primary); }
.switch.on span { transform: translateX(16px); }
.src-message {
  margin-top: 10px;
  font-size: var(--text-sm);
}
.import-sheet {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 16px;
}
.import-area {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
  font: inherit;
  font-size: var(--text-sm);
  resize: vertical;
}
.import-submit { width: 100%; }
.import-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.import-audits {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-warning, #b26a00) 8%, transparent);
  font-size: var(--text-xs);
}
.import-audit-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.import-audit-count { flex: none; color: var(--color-on-surface-variant); }
.audit-sheet {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px 16px;
}
.audit-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  font-size: var(--text-sm);
}
.audit-summary.bad {
  background: color-mix(in srgb, #b3261e 8%, transparent);
}
.audit-summary span { font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.audit-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 48vh;
  overflow-y: auto;
}
.audit-issue {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
}
.audit-badge {
  flex: none;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: #eee9dc;
  color: #5c5545;
}
.audit-badge.audit-error { background: #fbe3e0; color: #9a2a20; }
.audit-badge.audit-warn { background: #f8ecd0; color: #7a5310; }
.audit-badge.audit-info { background: #e7eef5; color: #35566f; }
.audit-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.audit-body b { font-size: var(--text-xs); font-weight: 600; }
.audit-body p { margin: 0; font-size: var(--text-sm); line-height: 1.5; }
.audit-body code {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--color-on-surface-variant);
}
.audit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}
@media (max-width: 640px) {
  .builtin-grid { grid-template-columns: 1fr; }
  /* 窄屏把健康筛选 chip 换行，避免“失效/未测”被横向裁掉。 */
  .src-filters { flex-wrap: wrap; overflow-x: visible; }
  .src-stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .src-stat:nth-child(n + 5) {
    grid-column: span 1;
  }
  .src-actions .icon-chip {
    padding-inline: 10px;
  }
}
</style>