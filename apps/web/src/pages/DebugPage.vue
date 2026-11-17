<template>
  <section class="page dbg-page">
    <header class="page-head">
      <button class="back-btn" @click="router.back()">← 返回</button>
      <h1 class="page-title">{{ data?.source.name || healthData?.source.name || "调试台" }}</h1>
      <p class="page-sub">{{ data?.source.url || healthData?.source.url || "单源调试：搜索 → 规则 → 执行轨迹" }}</p>
      <div class="dbg-actions">
        <span v-if="data" class="dbg-chip">{{ data.ms }} ms</span>
        <span v-if="data" class="dbg-chip">{{ data.total }} 条结果</span>
        <span v-if="data" class="dbg-chip">{{ data.events.length }} 个事件</span>
      </div>
    </header>

    <div class="dbg-tabs">
      <button v-if="!isBuiltin" :class="{ active: tab === 'search' }" @click="tab = 'search'">搜索调试</button>
      <button v-if="!isBuiltin" :class="{ active: tab === 'audit' }" @click="openAudit">规则体检</button>
      <button v-if="!isBuiltin" :class="{ active: tab === 'request' }" @click="openRequest">请求设置</button>
      <button v-if="!isBuiltin" :class="{ active: tab === 'trace' }" @click="tab = 'trace'">解析追踪</button>
      <button v-if="!isBuiltin" :class="{ active: tab === 'preview' }" @click="openPreview">正文预览</button>
      <button :class="{ active: tab === 'health' }" @click="openHealth">健康体检</button>
    </div>

    <template v-if="tab === 'audit'">
      <div v-if="auditLoading" class="dbg-loading"><span class="dbg-spinner" />正在检查规则…</div>
      <template v-else-if="auditData">
        <section class="dbg-section">
          <header class="dbg-section-head">
            <span class="dbg-section-title">
              静态体检
              <span class="dbg-count" :class="{ 'audit-bad-count': auditData.errors > 0 }">{{ auditData.ok ? "通过" : auditData.errors + " 个错误" }}</span>
            </span>
            <button class="btn btn-sm btn-ghost" @click="loadAudit">重新检查</button>
          </header>
          <div class="audit-summary" :class="{ bad: auditData.errors > 0 }">
            <strong>{{ auditData.errors > 0 ? "启用前需要修复" : "规则结构完整" }}</strong>
            <span>{{ auditData.warnings }} 警告 · {{ auditData.infos }} 提示</span>
          </div>
          <p class="dbg-health-formula">静态体检不联网：检查必填字段、选择器结构、@regex 正则、JS 语法、header 格式和 nextContentUrl 循环风险。字段为空、规则写错这类问题在这里就能发现。</p>
          <div v-if="auditData.issues.length" class="audit-list">
            <article v-for="(issue, i) in auditData.issues" :key="issue.code + issue.field + i" class="audit-issue">
              <span class="audit-badge" :class="'audit-' + issue.severity">{{ issueLabel(issue.severity) }}</span>
              <div class="audit-body">
                <b>{{ stageLabel(issue.stage) }} · {{ issue.field }}</b>
                <p>{{ issue.message }}</p>
                <code v-if="issue.sample">{{ issue.sample }}</code>
              </div>
            </article>
          </div>
          <p v-else class="dbg-empty">没有发现规则问题。可以再去「健康体检」跑一次联网体检。</p>
        </section>
      </template>
      <p v-else class="dbg-error">{{ auditError || "规则体检失败" }}</p>
    </template>

    <div v-if="tab === 'search'" class="dbg-run">
      <label class="dbg-input">
        <span class="dbg-search-icon" aria-hidden="true">🔍</span>
        <input v-model="keyword" placeholder="测试关键词" @keyup.enter="run" />
      </label>
      <button class="btn btn-primary btn-sm" :disabled="loading" @click="run">{{ loading ? "运行中" : "运行" }}</button>
    </div>

    <template v-if="tab === 'request'">
      <div v-if="requestLoading" class="dbg-loading"><span class="dbg-spinner" />正在读取请求设置…</div>
      <template v-else-if="requestReady">
        <section class="dbg-section">
          <header class="dbg-section-head">
            <span class="dbg-section-title">请求头与登录态</span>
            <span v-if="requestDirty" class="dbg-chip">未保存</span>
          </header>
          <p class="dbg-health-formula">
            很多源需要 Cookie、Referer 或特定 UA 才能返回正文。每行一个 <code>Key: Value</code>，也可以粘贴 JSON。Cookie 只保存在本机数据库。
          </p>
          <label class="req-field">
            <span>Header</span>
            <textarea v-model="requestHeader" rows="5" class="req-textarea" placeholder="Cookie: uid=123; token=abc&#10;Referer: https://example.com/"></textarea>
          </label>
          <label class="req-field">
            <span>登录页 <small>可选，用于手动登录后复制 Cookie</small></span>
            <input v-model="requestLoginUrl" class="req-input" placeholder="https://example.com/login" />
          </label>
          <label class="req-check">
            <input v-model="requestCookieJar" type="checkbox" />
            <span>保持站点 Cookie 会话（enabledCookieJar）</span>
          </label>
          <div class="req-actions">
            <button class="btn btn-sm btn-primary" :disabled="requestSaving || !requestDirty" @click="saveRequest">{{ requestSaving ? "保存中…" : "保存" }}</button>
            <button class="btn btn-sm btn-tonal" :disabled="requestProbing" @click="probeRequest">{{ requestProbing ? "探测中…" : "探测登录态" }}</button>
            <a v-if="requestLoginUrl" class="btn btn-sm btn-ghost" :href="requestLoginUrl" target="_blank" rel="noreferrer">打开登录页</a>
          </div>
          <p v-if="requestNote" class="req-note" :class="{ bad: requestNoteBad }">{{ requestNote }}</p>
        </section>

        <section v-if="requestProbe" class="dbg-section">
          <header class="dbg-section-head">
            <span class="dbg-section-title">探测结果</span>
            <span class="req-state" :class="'req-state-' + requestProbe.loginState">{{ loginStateLabel(requestProbe.loginState) }}</span>
          </header>
          <div class="req-meta">
            <span>HTTP <b>{{ requestProbe.status || "—" }}</b></span>
            <span>耗时 <b>{{ msLabel(requestProbe.ms) }}</b></span>
            <span>大小 <b>{{ requestProbe.bytes ? Math.round(requestProbe.bytes / 1024) + " KB" : "—" }}</b></span>
            <span v-if="requestProbe.charset">编码 <b>{{ requestProbe.charset }}</b></span>
          </div>
          <p class="req-reason">{{ requestProbe.loginReason }}</p>
          <p v-if="requestProbe.title" class="req-title">页面标题：{{ requestProbe.title }}</p>
          <p v-if="requestProbe.excerpt" class="req-excerpt">{{ requestProbe.excerpt }}</p>
          <p v-if="requestProbe.finalUrl && requestProbe.finalUrl !== requestProbe.url" class="req-url">最终地址：{{ requestProbe.finalUrl }}</p>
          <p v-if="requestProbe.setCookie" class="dbg-empty">响应带 Set-Cookie，登录态可能已更新。</p>
          <p v-if="requestProbe.error" class="dbg-error">{{ requestProbe.error }}</p>
          <p class="dbg-health-formula">登录态只能根据 HTTP 状态、重定向和页面关键词判断，不能保证一定已登录；以正文能否解析为准。探测地址默认用登录页，没有登录页时用书源首页。</p>
        </section>
      </template>
      <p v-else class="dbg-error">{{ requestError || "请求设置读取失败" }}</p>
    </template>

    <SourceTracePanel v-if="tab === 'trace' && !isBuiltin" :source-id="id" :keyword="keyword" />

    <template v-if="tab === 'preview'">
      <section class="dbg-section">
        <header class="dbg-section-head">
          <span class="dbg-section-title">正文分页预览</span>
          <span v-if="previewData" class="dbg-chip">{{ previewData.pageCount || 0 }} 页 · {{ previewData.chars || 0 }} 字</span>
        </header>
        <p class="dbg-health-formula">
          按真实阅读链路跑一遍：搜索 → 详情 → 目录 → 正文，并逐页执行 nextContentUrl。只预览，不写书架；正文最多显示 2 万字。
        </p>
        <div class="preview-form">
          <label class="preview-field">
            <span>搜索词</span>
            <input v-model="previewKey" class="req-input" placeholder="诡秘之主" @keyup.enter="loadPreview" />
          </label>
          <label class="preview-field preview-field-sm">
            <span>最多页数</span>
            <input v-model.number="previewMaxPages" type="number" min="1" max="20" class="req-input" />
          </label>
          <button class="btn btn-sm btn-primary" :disabled="previewLoading" @click="loadPreview">
            {{ previewLoading ? "解析中…" : "开始预览" }}
          </button>
        </div>
        <p class="preview-hint">想直接看某一章，可以在下方地址栏粘贴章节 URL 后再预览。</p>
        <div class="preview-form">
          <label class="preview-field">
            <span>章节 URL（可选）</span>
            <input v-model="previewChapterUrl" class="req-input" placeholder="https://example.com/book/1/2.html" @keyup.enter="loadPreview" />
          </label>
          <button class="btn btn-sm btn-tonal" :disabled="previewLoading" @click="loadPreview">预览这一章</button>
        </div>
        <p v-if="previewError" class="dbg-error">{{ previewError }}</p>
      </section>

      <div v-if="previewLoading" class="dbg-loading"><span class="dbg-spinner" />正在抓取并解析正文…</div>
      <template v-else-if="previewData && previewData.ok">
        <section class="dbg-section">
          <header class="dbg-section-head">
            <span class="dbg-section-title">{{ previewData.book?.name || "手动章节" }} <span class="dbg-count">{{ previewData.chapter?.title }}</span></span>
            <span class="dbg-chip">{{ msLabel(previewData.ms) }}</span>
          </header>
          <div class="req-meta">
            <span v-if="previewData.book?.author">作者 <b>{{ previewData.book.author }}</b></span>
            <span>目录 <b>{{ previewData.chapterCount || 0 }}</b> 章</span>
            <span>插图 <b>{{ previewData.imageCount || 0 }}</b> 张</span>
            <span v-if="previewData.chapter?.isVip" class="preview-vip">VIP 章节</span>
          </div>
          <div class="preview-pages">
            <article v-for="(page, i) in previewData.pages" :key="page.url + i" class="preview-page">
              <div class="preview-page-head">
                <b>第 {{ i + 1 }} 页</b>
                <span>{{ page.chars }} 字 · {{ page.rows }} 段 · {{ page.images }} 图</span>
              </div>
              <p class="preview-page-url">{{ page.url }}</p>
              <p v-if="page.nextUrl" class="preview-page-next">下一页 → {{ page.nextUrl }}</p>
              <p v-else class="preview-page-next">没有下一页</p>
            </article>
          </div>
          <p v-if="previewData.pages?.some((p) => p.nextUrl && p.nextUrl === p.url)" class="dbg-error">
            nextContentUrl 指回了当前页，已在访问过的页面处停止。
          </p>
        </section>
        <section class="dbg-section">
          <header class="dbg-section-head">
            <span class="dbg-section-title">解析正文</span>
            <span v-if="previewData.truncated" class="dbg-chip">已截断</span>
          </header>
          <div class="preview-text">
            <p v-for="(line, i) in previewParagraphs" :key="i">{{ line }}</p>
          </div>
          <p v-if="previewData.truncated" class="dbg-empty">正文超过 2 万字，这里只显示前 2 万字。</p>
        </section>
      </template>
      <p v-else-if="previewData && !previewData.ok" class="dbg-error">
        {{ previewData.stage ? "阶段 " + previewData.stage + "：" : "" }}{{ previewData.error || "预览失败" }}
      </p>
    </template>

    <template v-if="tab === 'health'">
      <div v-if="healthLoading" class="dbg-loading"><span class="dbg-spinner" />正在读取健康档案…</div>
      <template v-else-if="healthData">
        <section class="dbg-section">
          <header class="dbg-section-head">
            <span class="dbg-section-title">健康档案 <span class="dbg-count">{{ stateLabel(healthData.health.state) }}</span></span>
            <div class="dbg-health-actions">
              <button class="btn btn-sm btn-tonal" :disabled="probing" @click="probe('quick')">{{ probing ? "体检中…" : "快速体检" }}</button>
              <button class="btn btn-sm btn-tonal" :disabled="probing" @click="probe('full')">完整体检</button>
              <button class="btn btn-sm btn-ghost" :disabled="probing" @click="resetHealth">重置</button>
            </div>
          </header>
          <div class="dbg-health-meta">
            <span>评分 <b>{{ healthData.health.score }}</b></span>
            <span>平均 <b>{{ msLabel(healthData.health.avgMs) }}</b></span>
            <span>体检 <b>{{ healthData.health.checks }}</b> 次</span>
            <span>正常 <b>{{ healthData.health.ok }}</b></span>
            <span v-if="healthData.health.lastCheckAt">最近 {{ shortDate(healthData.health.lastCheckAt) }}</span>
          </div>
          <p v-if="healthData.health.lastStageError" class="dbg-health-error">{{ healthData.health.lastStageError }}</p>
          <p v-else-if="healthData.health.state === 'blocked'" class="dbg-health-hint">
            源需要登录或会员。大灰狼聚合可到 <button class="link-btn" @click="router.push('/settings')">设置 → 大灰狼聚合</button> 登录后重试。
          </p>
          <div class="dbg-health-stages">
            <div v-for="stage in stageCards" :key="stage.key" class="dbg-health-stage" :class="'hs-' + stage.status">
              <div class="dbg-health-stage-head"><b>{{ stage.label }}</b><span>{{ stageStatusLabel(stage.status) }}</span></div>
              <div class="dbg-health-stage-meta">
                <span v-if="stage.ms">{{ msLabel(stage.ms) }}</span>
                <span v-if="stage.count !== undefined">{{ stage.count }} 条</span>
                <span v-if="stage.chars !== undefined">{{ stage.chars }} 字</span>
              </div>
              <p v-if="stage.message" class="dbg-health-stage-msg">{{ stage.message }}</p>
            </div>
          </div>
          <p class="dbg-health-formula">评分 = 阶段质量 × 覆盖率 × 70 + 稳定性 × 20 + 速度 × 10；搜索、详情、目录、正文权重 25/15/25/35。空结果不算硬失败，需登录/会员记为 blocked。</p>
        </section>

        <section v-if="probeReport" class="dbg-section">
          <header class="dbg-section-head">
            <span class="dbg-section-title">本次体检 <span class="dbg-count">{{ probeReport.mode === "full" ? "完整" : "快速" }}</span></span>
            <span class="dbg-chip">{{ msLabel(probeReport.elapsedMs) }}</span>
          </header>
          <p v-if="probeReport.error" class="dbg-error">{{ probeReport.error }}</p>
          <p class="dbg-empty">样本：{{ probeReport.samples.bookUrl || "无" }}<template v-if="probeReport.samples.chapterUrl"> · {{ probeReport.samples.chapterUrl }}</template></p>
          <details v-if="probeReport.debug.length" class="dbg-event">
            <summary class="dbg-event-head"><span class="dbg-stage">debug</span><span class="dbg-event-text">{{ probeReport.debug.length }} 条执行轨迹</span></summary>
            <pre class="dbg-code dbg-event-json">{{ JSON.stringify(probeReport.debug, null, 2) }}</pre>
          </details>
          <button class="btn btn-sm btn-ghost" @click="copyReport">复制脱敏报告</button>
          <span v-if="copyNote" class="dbg-copy-note">{{ copyNote }}</span>
        </section>

        <section class="dbg-section">
          <header class="dbg-section-head"><span class="dbg-section-title">最近体检记录 <span class="dbg-count">{{ healthData.checks.length }}</span></span></header>
          <p v-if="!healthData.checks.length" class="dbg-empty">
            还没有阶段记录。{{ healthData.health.checks ? "已有体检次数来自旧版回填或早期体检，阶段明细从 0.56 起记录；点上面的「快速体检」补一条。" : "点上面的「快速体检」跑一次。" }}
          </p>
          <p v-else-if="healthData.health.checks > healthData.checks.length" class="dbg-empty">
            阶段明细从 0.56 起记录，早期 {{ healthData.health.checks - healthData.checks.length }} 次体检没有明细。
          </p>
          <div v-for="check in healthData.checks" :key="check.id" class="dbg-check-row">
            <span class="dbg-check-ok" :class="checkTone(check.code, check.ok)">{{ checkLabel(check.code, check.ok) }}</span>
            <span class="dbg-check-code">{{ check.code || check.kind }}</span>
            <span class="dbg-check-msg">{{ check.message || "—" }}</span>
            <span class="dbg-check-time">{{ shortDate(check.createdAt) }}</span>
          </div>
        </section>
      </template>
      <p v-else class="dbg-error">{{ healthError || "健康档案读取失败" }}</p>
    </template>

    <div v-if="tab === 'search' && loading" class="dbg-loading">
      <span class="dbg-spinner" />
      正在执行搜索…
    </div>

    <p v-if="tab === 'search' && data?.error" class="dbg-error">{{ data.error }}</p>

    <template v-if="tab === 'search' && data && !loading">
      <section class="dbg-section">
        <header class="dbg-section-head">
          <span class="dbg-section-title">搜索结果 <span class="dbg-count">{{ data.books.length }}</span></span>
        </header>
        <p v-if="!data.books.length" class="dbg-empty">这个关键词没有返回结果，先看下面的执行轨迹定位是哪一步空了。</p>
        <div v-for="(book, i) in data.books" :key="i" class="dbg-book">
          <BookCover :url="book.coverUrl" :source-id="id" :name="book.name" :width="36" :height="48" :radius="6" :initial-font="11" />
          <div class="dbg-book-body">
            <div class="dbg-book-name">{{ book.name }}</div>
            <div class="dbg-book-meta">{{ book.author || "佚名" }}<template v-if="book.lastChapter"> · {{ book.lastChapter }}</template></div>
          </div>
          <button class="btn btn-sm btn-tonal" @click="add(book)">加入</button>
        </div>
      </section>

      <section class="dbg-section">
        <header class="dbg-section-head">
          <span class="dbg-section-title">规则</span>
          <button class="btn btn-sm btn-ghost" @click="showRules = !showRules">{{ showRules ? "收起" : "展开" }}</button>
        </header>
        <pre v-if="showRules" class="dbg-code">{{ JSON.stringify(data.rules, null, 2) }}</pre>
        <p v-else class="dbg-empty">共 {{ ruleCount }} 个字段规则，展开查看原始 JSON。</p>
      </section>

      <section class="dbg-section">
        <header class="dbg-section-head">
          <span class="dbg-section-title">执行轨迹 <span class="dbg-count">{{ data.events.length }}</span></span>
          <button class="btn btn-sm btn-ghost" @click="toggleAllEvents">{{ allEventsOpen ? "全部收起" : "全部展开" }}</button>
        </header>
        <p v-if="!data.events.length" class="dbg-empty">没有事件记录。</p>
        <details v-for="(event, i) in data.events" :key="i" class="dbg-event" :open="allEventsOpen">
          <summary class="dbg-event-head">
            <span class="dbg-stage">{{ event.stage }}</span>
            <span class="dbg-event-text">{{ summarize(event) }}</span>
          </summary>
          <pre class="dbg-code dbg-event-json">{{ pretty(event) }}</pre>
        </details>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  api,
  type SearchBook,
  type SourceAuditIssue,
  type SourceAuditReport,
  type SourceContentPreview,
  type SourceDetail,
  type SourceHealthDetail,
  type SourceProbeReport,
  type SourceRequestProbe,
} from "../api";
import BookCover from "../components/BookCover.vue";
import SourceTracePanel from "../components/SourceTracePanel.vue";

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);
const tab = ref<"search" | "health" | "audit" | "request" | "trace" | "preview">("search");
const keyword = ref("诡秘之主");
const loading = ref(false);
const showRules = ref(false);
const allEventsOpen = ref(false);
const data = ref<Awaited<ReturnType<typeof api.debugSource>> | null>(null);
const healthData = ref<SourceHealthDetail | null>(null);
const isBuiltin = computed(() => {
  const url = healthData.value?.source.url ?? "";
  return url.startsWith("dhl://") || url.startsWith("shushan://");
});
const healthLoading = ref(false);
const healthError = ref("");
const auditLoading = ref(false);
const auditError = ref("");
const auditData = ref<SourceAuditReport | null>(null);
const sourceData = ref<SourceDetail | null>(null);
const requestLoading = ref(false);
const requestError = ref("");
const requestReady = ref(false);
const requestHeader = ref("");
const requestLoginUrl = ref("");
const requestCookieJar = ref(true);
const requestSaving = ref(false);
const requestProbing = ref(false);
const requestProbe = ref<SourceRequestProbe | null>(null);
const requestNote = ref("");
const requestNoteBad = ref(false);
const previewLoading = ref(false);
const previewError = ref("");
const previewData = ref<SourceContentPreview | null>(null);
const previewKey = ref("诡秘之主");
const previewMaxPages = ref(10);
const previewChapterUrl = ref("");
const requestDirty = computed(() => {
  const saved = sourceData.value?.request;
  if (!saved) return false;
  return requestHeader.value.trim() !== saved.header.trim()
    || requestLoginUrl.value.trim() !== saved.loginUrl.trim()
    || requestCookieJar.value !== saved.enabledCookieJar;
});
const probeReport = ref<SourceProbeReport | null>(null);
const probing = ref(false);
const copyNote = ref("");

const ruleCount = computed(() => {
  const rules = data.value?.rules as Record<string, unknown> | undefined;
  return rules ? Object.keys(rules).length : 0;
});

function summarize(event: Record<string, unknown>): string {
  const { stage, ...rest } = event;
  const text = JSON.stringify(rest);
  return text.length > 140 ? text.slice(0, 140) + "…" : text;
}

function pretty(event: Record<string, unknown>): string {
  const { stage, ...rest } = event;
  return JSON.stringify(rest, null, 2);
}

function toggleAllEvents(): void {
  allEventsOpen.value = !allEventsOpen.value;
}

const STAGES = [
  { key: "search", label: "搜索" },
  { key: "detail", label: "详情" },
  { key: "toc", label: "目录" },
  { key: "content", label: "正文" },
] as const;

const stageCards = computed(() =>
  STAGES.map((stage) => {
    const value = healthData.value?.health.stages?.[stage.key];
    return {
      ...stage,
      status: value?.status ?? "skip",
      ms: value?.ms ?? 0,
      count: value?.count,
      chars: value?.chars,
      message: value?.message ?? value?.code ?? "",
    };
  }),
);

function stateLabel(state: string): string {
  return { healthy: "健康", partial: "待补测", degraded: "降级", blocked: "需登录", broken: "失效", unknown: "未测" }[state] ?? state;
}

const HEALTH_CODES = new Set(["healthy", "partial", "degraded", "blocked", "broken", "unknown"]);

function checkLabel(code: string, ok: boolean): string {
  return HEALTH_CODES.has(code) ? stateLabel(code) : ok ? "正常" : "失败";
}

function checkTone(code: string, ok: boolean): string {
  if (code === "broken") return "bad";
  if (code === "degraded" || code === "blocked") return "warn";
  if (HEALTH_CODES.has(code)) return "";
  return ok ? "" : "bad";
}

function stageStatusLabel(status: string): string {
  return { ok: "正常", empty: "空结果", blocked: "需登录", fail: "失败", skip: "跳过" }[status] ?? status;
}

function msLabel(ms: number): string {
  if (!ms) return "—";
  return ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s";
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadHealth(): Promise<void> {
  healthLoading.value = true;
  healthError.value = "";
  try {
    healthData.value = await api.sourceHealth(id);
  } catch (err) {
    healthData.value = null;
    healthError.value = String((err as Error).message);
  } finally {
    healthLoading.value = false;
  }
}

function openHealth(): void {
  tab.value = "health";
  if (!healthData.value) void loadHealth();
}

async function loadAudit(): Promise<void> {
  auditLoading.value = true;
  auditError.value = "";
  try {
    auditData.value = await api.auditSource(id);
  } catch (err) {
    auditData.value = null;
    auditError.value = String((err as Error).message);
  } finally {
    auditLoading.value = false;
  }
}

function openAudit(): void {
  tab.value = "audit";
  if (!auditData.value) void loadAudit();
}

function issueLabel(severity: SourceAuditIssue["severity"]): string {
  return severity === "error" ? "错误" : severity === "warning" ? "警告" : "提示";
}

function stageLabel(stage: SourceAuditIssue["stage"]): string {
  return ({ search: "搜索", explore: "发现", bookInfo: "详情", toc: "目录", content: "正文", source: "书源" } as Record<string, string>)[stage] ?? stage;
}

async function loadRequest(): Promise<void> {
  requestLoading.value = true;
  requestError.value = "";
  try {
    const detail = await api.sourceDetail(id);
    sourceData.value = detail;
    requestHeader.value = detail.request.header;
    requestLoginUrl.value = detail.request.loginUrl;
    requestCookieJar.value = detail.request.enabledCookieJar;
    requestReady.value = true;
  } catch (err) {
    requestReady.value = false;
    requestError.value = String((err as Error).message);
  } finally {
    requestLoading.value = false;
  }
}

function openRequest(): void {
  tab.value = "request";
  if (!requestReady.value) void loadRequest();
}

const previewParagraphs = computed(() =>
  String(previewData.value?.text ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 60),
);

function openPreview(): void {
  tab.value = "preview";
}

async function loadPreview(): Promise<void> {
  if (previewLoading.value) return;
  previewLoading.value = true;
  previewError.value = "";
  previewData.value = null;
  try {
    previewData.value = await api.previewSourceContent(id, {
      key: previewKey.value.trim() || "诡秘之主",
      chapterUrl: previewChapterUrl.value.trim() || undefined,
      maxPages: Math.max(1, Math.min(20, Number(previewMaxPages.value) || 10)),
    });
  } catch (err) {
    previewError.value = String((err as Error).message);
  } finally {
    previewLoading.value = false;
  }
}

async function saveRequest(silent = false): Promise<boolean> {
  if (!requestReady.value || requestSaving.value) return false;
  requestSaving.value = true;
  requestNote.value = "";
  requestNoteBad.value = false;
  try {
    const res = await api.saveSourceRequest(id, {
      header: requestHeader.value.trim(),
      loginUrl: requestLoginUrl.value.trim(),
      enabledCookieJar: requestCookieJar.value,
    });
    if (sourceData.value) sourceData.value.request = res.request;
    requestHeader.value = res.request.header;
    requestLoginUrl.value = res.request.loginUrl;
    requestCookieJar.value = res.request.enabledCookieJar;
    if (!silent) requestNote.value = "已保存，下一次搜索或正文请求会带上新的 Header。";
    return true;
  } catch (err) {
    requestNote.value = "保存失败：" + String((err as Error).message);
    requestNoteBad.value = true;
    return false;
  } finally {
    requestSaving.value = false;
  }
}

async function probeRequest(): Promise<void> {
  if (requestProbing.value) return;
  if (requestDirty.value) {
    const ok = await saveRequest(true);
    if (!ok) return;
  }
  requestProbing.value = true;
  requestNote.value = "";
  requestNoteBad.value = false;
  try {
    requestProbe.value = await api.probeSourceRequest(id);
  } catch (err) {
    requestNote.value = "探测失败：" + String((err as Error).message);
    requestNoteBad.value = true;
  } finally {
    requestProbing.value = false;
  }
}

function loginStateLabel(state: SourceRequestProbe["loginState"]): string {
  return { ok: "可访问", login: "疑似未登录", blocked: "被拒绝", unknown: "未知" }[state] ?? state;
}

async function probe(mode: "quick" | "full"): Promise<void> {
  if (probing.value) return;
  probing.value = true;
  copyNote.value = "";
  try {
    probeReport.value = await api.probeSource(id, { mode, key: keyword.value.trim() || "诡秘之主" });
    await loadHealth();
  } catch (err) {
    healthError.value = "体检失败：" + String((err as Error).message);
  } finally {
    probing.value = false;
  }
}

async function resetHealth(): Promise<void> {
  if (!window.confirm("重置这个源的健康档案？评分、阶段结果和体检次数会清零，历史记录保留。")) return;
  try {
    await api.resetSourceHealth(id);
    probeReport.value = null;
    await loadHealth();
  } catch (err) {
    healthError.value = "重置失败：" + String((err as Error).message);
  }
}

const SECRET_KEYS = new Set([
  "token",
  "key",
  "apikey",
  "cookie",
  "password",
  "passwd",
  "authorization",
  "secret",
  "accesstoken",
  "refreshtoken",
  "qttoken",
]);

/** 诊断报告会贴到 issue/聊天里：键名命中凭据词就整体打码，URL 查询参数与 Bearer 头也替换。 */
function redactText(input: string): string {
  return input
    .replace(/([?&](?:token|key|api_?key|access_?token|refresh_?token|password|cookie|authorization|secret|qttoken)=)[^&#\s]*/gi, "$1***")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/g, "Bearer ***")
    .replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\n,}]+/gi, "$1***");
}

function redact(value: unknown, key = ""): unknown {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (SECRET_KEYS.has(normalized) || normalized.endsWith("token") || normalized.endsWith("password") || normalized.endsWith("secret") || normalized.endsWith("apikey")) {
    return "***";
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redact(item, name)]));
  }
  return value;
}

async function copyReport(): Promise<void> {
  const payload = {
    source: healthData.value?.source,
    health: healthData.value?.health,
    probe: probeReport.value
      ? {
          mode: probeReport.value.mode,
          elapsedMs: probeReport.value.elapsedMs,
          stages: probeReport.value.stages,
          samples: probeReport.value.samples,
          error: probeReport.value.error,
        }
      : null,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(redact(payload), null, 2));
    copyNote.value = "已复制（已脱敏）";
    window.setTimeout(() => (copyNote.value = ""), 2000);
  } catch {
    copyNote.value = "复制失败，请手动选择文本";
  }
}

async function run() {
  if (isBuiltin.value) {
    tab.value = "health";
    return;
  }
  loading.value = true;
  try {
    data.value = await api.debugSource(id, keyword.value.trim() || "诡秘之主");
  } catch (err) {
    data.value = null;
    alert(String((err as Error).message));
  } finally {
    loading.value = false;
  }
}

async function add(book: SearchBook) {
  const created = await api.createBook({
    sourceId: id,
    bookUrl: book.bookUrl,
    name: book.name,
    author: book.author,
    coverUrl: book.coverUrl,
    intro: book.intro,
    wordCount: book.wordCount,
    lastChapter: book.lastChapter,
  });
  router.push(`/book/${created.book.id}`);
}

onMounted(async () => {
  await loadHealth();
  if (isBuiltin.value) {
    tab.value = "health";
    return;
  }
  await run();
});
</script>

<style scoped>
.dbg-page { padding-bottom: 32px; }

.dbg-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.dbg-chip {
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.dbg-tabs {
  display: flex;
  gap: 6px;
  margin: 8px 0 14px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.dbg-tabs::-webkit-scrollbar { display: none; }
.dbg-tabs button {
  flex: 0 0 auto;
  padding: 7px 12px;
  white-space: nowrap;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.dbg-tabs button.active {
  background: var(--color-primary);
  color: #fff;
  font-weight: 600;
}
.dbg-run { display: flex; align-items: center; gap: 8px; margin: 4px 0 14px; }
.dbg-input {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
}
.dbg-search-icon { font-size: 13px; opacity: .55; }
.dbg-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--text-sm);
  outline: none;
}

.dbg-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.dbg-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--color-outline-variant);
  border-top-color: var(--color-primary);
  animation: dbg-spin .7s linear infinite;
}
@keyframes dbg-spin { to { transform: rotate(360deg); } }

.dbg-error {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(193, 84, 63, .1);
  color: #8c2f1e;
  font-size: var(--text-sm);
  line-height: 1.5;
  word-break: break-all;
}

.dbg-section {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-outline-variant);
  background: var(--color-surface-container-lowest);
}
.dbg-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}
.dbg-section-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-md);
  font-weight: 650;
}
.dbg-count {
  min-width: 20px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
}
.dbg-empty {
  margin: 6px 0 2px;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-on-surface-variant);
}

.dbg-book {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--color-outline-variant);
}
.dbg-book:first-of-type { border-top: 0; }
.dbg-book-body { flex: 1; min-width: 0; }
.dbg-book-name {
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dbg-book-meta {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dbg-code {
  margin: 6px 0 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-container);
  color: var(--color-on-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 280px;
  overflow: auto;
}

.dbg-event { border-top: 1px solid var(--color-outline-variant); }
.dbg-event:first-of-type { border-top: 0; }
.dbg-event-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  cursor: pointer;
  list-style: none;
}
.dbg-event-head::-webkit-details-marker { display: none; }
.dbg-stage {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  font-weight: 600;
}
.dbg-event-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--color-on-surface-variant);
}
.dbg-event-json { margin-bottom: 8px; }

.dbg-health-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dbg-health-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 6px;
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.dbg-health-meta b {
  color: var(--color-on-surface);
  font-variant-numeric: tabular-nums;
}
.dbg-health-error,
.dbg-health-hint {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgba(193, 84, 63, 0.08);
  color: #8c2f1e;
  font-size: var(--text-xs);
  line-height: 1.5;
}
.dbg-health-hint {
  background: rgba(169, 118, 31, 0.1);
  color: #7a4a00;
}
.link-btn {
  border: 0;
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.dbg-health-stages {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.dbg-health-stage {
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--color-surface-container);
  border-left: 3px solid var(--color-outline);
}
.dbg-health-stage.hs-ok { border-left-color: #3f9b63; }
.dbg-health-stage.hs-empty { border-left-color: #d3a552; }
.dbg-health-stage.hs-blocked { border-left-color: #b08a35; }
.dbg-health-stage.hs-fail { border-left-color: #c1543f; }
.dbg-health-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: var(--text-sm);
}
.dbg-health-stage-head span {
  font-size: 10px;
  color: var(--color-on-surface-variant);
}
.dbg-health-stage-meta {
  display: flex;
  gap: 8px;
  margin-top: 3px;
  font-size: 10px;
  color: var(--color-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.dbg-health-stage-msg {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--color-on-surface-variant);
  overflow-wrap: anywhere;
}
.dbg-health-formula {
  margin: 10px 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-on-surface-variant);
}
.dbg-check-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--color-outline-variant);
  font-size: var(--text-xs);
}
.dbg-check-row:first-of-type { border-top: 0; }
.dbg-check-ok { color: #2e7d4f; font-weight: 600; }
.dbg-check-ok.warn { color: #9a6b1f; }
.dbg-check-ok.bad { color: #b4463c; }
.dbg-check-code { color: var(--color-on-surface-variant); }
.dbg-check-msg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dbg-check-time { color: var(--color-on-surface-variant); opacity: .75; }
.dbg-copy-note { margin-left: 8px; font-size: var(--text-xs); color: #2e7d4f; }
.audit-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  font-size: var(--text-sm);
}
.audit-summary.bad { background: color-mix(in srgb, #b3261e 8%, transparent); }
.audit-summary span { font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.audit-bad-count { color: #b4463c; }
.audit-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
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
.audit-badge.audit-warning { background: #f8ecd0; color: #7a5310; }
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
.req-field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; font-size: var(--text-xs); }
.req-field > span { font-weight: 600; }
.req-field small { font-weight: 400; color: var(--color-on-surface-variant); }
.req-textarea,
.req-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-md);
  background: #fffdf8;
  color: inherit;
  font: inherit;
  font-size: var(--text-sm);
}
.req-textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; }
.req-check { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: var(--text-sm); }
.req-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
.req-note { margin: 10px 0 0; font-size: var(--text-xs); color: #2e7d4f; }
.req-note.bad { color: #b4463c; }
.req-state {
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  background: var(--color-surface-container);
}
.req-state-ok { background: #e3f2e8; color: #2e7d4f; }
.req-state-login { background: #f8ecd0; color: #7a5310; }
.req-state-blocked { background: #fbe3e0; color: #9a2a20; }
.req-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.req-meta b { color: var(--color-on-surface); font-variant-numeric: tabular-nums; }
.req-reason { margin: 10px 0 0; font-size: var(--text-sm); }
.req-title { margin: 6px 0 0; font-size: var(--text-xs); font-weight: 600; }
.req-excerpt { margin: 6px 0 0; font-size: var(--text-xs); line-height: 1.6; color: var(--color-on-surface-variant); }
.req-url { margin: 6px 0 0; font-size: 10px; color: var(--color-on-surface-variant); overflow-wrap: anywhere; }

.preview-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-top: 12px; }
.preview-field { display: flex; flex: 1 1 220px; flex-direction: column; gap: 6px; font-size: var(--text-xs); }
.preview-field > span { font-weight: 600; }
.preview-field-sm { flex: 0 0 96px; }
.preview-hint { margin: 10px 0 0; font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.preview-pages { display: grid; gap: 8px; margin-top: 12px; }
.preview-page { padding: 10px 12px; border: 1px solid var(--color-outline); border-radius: var(--radius-md); background: #fffdf8; }
.preview-page-head { display: flex; justify-content: space-between; gap: 8px; font-size: var(--text-xs); }
.preview-page-head span { color: var(--color-on-surface-variant); font-variant-numeric: tabular-nums; }
.preview-page-url { margin: 6px 0 0; font-size: 10px; color: var(--color-on-surface-variant); overflow-wrap: anywhere; }
.preview-page-next { margin: 4px 0 0; font-size: 10px; color: var(--color-on-surface-variant); overflow-wrap: anywhere; }
.preview-vip { color: #9a2a20; font-weight: 600; }
.preview-text { margin-top: 12px; padding: 12px 14px; border-radius: var(--radius-md); background: #fffdf8; border: 1px solid var(--color-outline); font-size: var(--text-sm); line-height: 1.9; }
.preview-text p { margin: 0 0 0.7em; text-indent: 2em; }
.preview-text p:last-child { margin-bottom: 0; }
@media (max-width: 480px) {
  .dbg-health-stages { grid-template-columns: 1fr; }
  .dbg-section-head { flex-wrap: wrap; }
}
</style>