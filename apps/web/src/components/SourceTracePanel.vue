<template>
  <section class="trace-panel">
    <header class="trace-head">
      <div>
        <h2>解析追踪</h2>
        <p>按真实抓取链路跑一遍：每一步都列出规则、命中数和值；失败时给出错误类型。</p>
      </div>
      <span v-if="trace" class="trace-total">{{ trace.ms }} ms</span>
    </header>

    <div class="trace-form">
      <label class="trace-field">
        <span>测试关键词</span>
        <input v-model="key" placeholder="例如：诡秘之主" @keyup.enter="run('pipeline')" />
      </label>
      <label class="trace-field">
        <span>书籍 URL <small>可选</small></span>
        <input v-model="bookUrl" placeholder="不填则用搜索结果第一条" />
      </label>
      <label class="trace-field">
        <span>章节 URL <small>可选</small></span>
        <input v-model="chapterUrl" placeholder="只测正文时填这里" />
      </label>
      <div class="trace-actions">
        <button class="btn btn-primary btn-sm" type="button" :disabled="loading" @click="run('pipeline')">
          {{ loading ? "运行中…" : "运行完整链路" }}
        </button>
        <button class="btn btn-sm btn-ghost" type="button" :disabled="loading || !chapterUrl.trim()" @click="run('content')">
          只测这一章
        </button>
        <button v-if="trace" class="btn btn-sm btn-ghost" type="button" @click="copyTrace">
          {{ copied ? "已复制" : "复制诊断 JSON" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="trace-error">{{ error }}</p>
    <div v-if="loading" class="trace-loading"><span class="trace-spinner" />正在按真实链路请求，最多需要十几秒…</div>

    <template v-else-if="trace">
      <div class="trace-summary">
        <span class="trace-source">{{ trace.source.name }}</span>
        <span v-if="trace.book" class="trace-chip">{{ trace.book.name || "未命中书名" }}</span>
        <span v-if="trace.chapter" class="trace-chip">{{ trace.chapter.title }}</span>
        <span v-if="trace.errorKind" class="trace-badge is-bad">{{ errorKindLabel(trace.errorKind) }}</span>
        <span v-else class="trace-chip">{{ trace.stages.length }} 个阶段</span>
      </div>

      <div v-if="trace.error" class="trace-callout is-bad">
        <b>{{ errorKindLabel(trace.errorKind) }}</b>
        <span>{{ trace.error }}</span>
        <small>{{ trace.hint }}</small>
      </div>

      <article v-for="stage in trace.stages" :key="stage.stage" class="trace-stage" :class="'is-' + stage.status">
        <header class="trace-stage-head">
          <span class="trace-stage-index">{{ stageIndex(stage.stage) }}</span>
          <div class="trace-stage-title">
            <b>{{ stage.label }}</b>
            <span>{{ stage.summary }}</span>
          </div>
          <span class="trace-badge" :class="'is-' + stage.status">{{ statusLabel(stage.status) }}</span>
          <span class="trace-ms">{{ msLabel(stage.ms) }}</span>
        </header>

        <div v-if="stage.request" class="trace-request">
          <code class="trace-url">{{ stage.request.status }} · {{ stage.request.finalUrl }}</code>
          <div class="trace-request-meta">
            <span>{{ stage.request.kind.toUpperCase() }}</span>
            <span>{{ formatBytes(stage.request.bytes) }}</span>
            <span>{{ stage.request.charset }}</span>
            <span>{{ stage.request.cookieJar ? "CookieJar 开" : "CookieJar 关" }}</span>
          </div>
          <details v-if="stage.request.headers.length" class="trace-headers">
            <summary>请求头（{{ stage.request.headers.length }}）</summary>
            <ul>
              <li v-for="header in stage.request.headers" :key="header.name">
                <code>{{ header.name }}</code><span>{{ header.value }}</span>
              </li>
            </ul>
          </details>
          <p v-else class="trace-muted">没有配置自定义 Header。</p>
        </div>

        <div v-if="stage.error" class="trace-callout is-bad">
          <b>{{ errorKindLabel(stage.errorKind) }}</b>
          <span>{{ stage.error }}</span>
          <small>{{ stage.hint }}</small>
        </div>

        <div v-if="stage.fields.length" class="trace-fields">
          <div class="trace-fields-head">
            <span>字段 / 规则</span><span>命中</span>
          </div>
          <details v-for="field in stage.fields" :key="field.field" class="trace-field" :open="field.count === 0">
            <summary>
              <span class="trace-field-name">{{ shortField(field.field) }}</span>
              <span class="trace-kind">{{ field.kind }}</span>
              <span class="trace-count" :class="{ zero: field.count === 0 }">{{ field.count }}</span>
            </summary>
            <code class="trace-rule">{{ field.rule || "（未配置）" }}</code>
            <ul v-if="field.values.length" class="trace-values">
              <li v-for="(value, i) in field.values" :key="i">{{ value }}</li>
            </ul>
            <p v-else class="trace-muted">没有命中值{{ field.error ? "：" + field.error : "" }}</p>
            <p v-if="field.truncated" class="trace-muted">只展示前 {{ field.values.length }} 个值。</p>
          </details>
        </div>

        <div v-if="stage.items?.length" class="trace-items">
          <div class="trace-items-head">
            <span>条目</span><span>{{ stage.items.length }} 条</span>
          </div>
          <div v-for="item in stage.items" :key="item.index" class="trace-item">
            <span class="trace-item-index">{{ item.index }}</span>
            <div class="trace-item-main">
              <b>{{ item.title }}</b>
              <span v-if="item.subtitle">{{ item.subtitle }}</span>
              <code v-if="item.url">{{ item.url }}</code>
            </div>
            <span v-if="item.chars" class="trace-chip">{{ item.chars }} 字</span>
          </div>
        </div>

        <div v-if="stage.pages?.length" class="trace-pages">
          <div class="trace-pages-head">分页</div>
          <div v-for="(page, i) in stage.pages" :key="page.url" class="trace-page">
            <span class="trace-page-index">第 {{ i + 1 }} 页</span>
            <span>{{ page.chars }} 字 · {{ page.paragraphs }} 段 · {{ msLabel(page.ms) }}</span>
            <code v-if="page.nextUrl">下一页：{{ page.nextUrl }}</code>
          </div>
        </div>

        <details v-if="stage.text" class="trace-text">
          <summary>正文预览（{{ stage.text.length }} 字{{ stage.textTruncated ? "，已截断" : "" }}）</summary>
          <pre>{{ stage.text }}</pre>
        </details>
      </article>
    </template>

    <p v-else class="trace-empty">填一个关键词，或直接填章节 URL 后运行。追踪只读，不会改书架和健康档案；Cookie / Authorization 与 URL 中的 token / key / sign 已脱敏。</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { api, type SourceParseTrace } from "../api";

const props = defineProps<{ sourceId: number; keyword?: string }>();

const key = ref(props.keyword?.trim() || "诡秘之主");
const bookUrl = ref("");
const chapterUrl = ref("");
const loading = ref(false);
const error = ref("");
const trace = ref<SourceParseTrace | null>(null);
const copied = ref(false);

async function run(stage: "pipeline" | "content"): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  copied.value = false;
  try {
    trace.value = await api.traceSource(props.sourceId, {
      stage,
      key: key.value.trim() || "诡秘之主",
      bookUrl: bookUrl.value.trim() || undefined,
      chapterUrl: chapterUrl.value.trim() || undefined,
      maxItems: 6,
      maxPages: 3,
    });
  } catch (err) {
    trace.value = null;
    error.value = "追踪失败：" + String((err as Error).message);
  } finally {
    loading.value = false;
  }
}

function statusLabel(status: string): string {
  return { ok: "正常", empty: "空结果", fail: "失败", skip: "跳过" }[status] ?? status;
}

function errorKindLabel(kind?: string): string {
  return {
    timeout: "超时",
    network: "网络错误",
    http: "HTTP 错误",
    blocked: "疑似拦截",
    login: "需要登录",
    vip: "VIP 章节",
    selector_empty: "选择器未命中",
    rule_error: "规则错误",
    js_error: "JS 错误",
    webview: "需 WebView",
    url: "地址错误",
    too_large: "响应过大",
    charset: "编码异常",
    empty_content: "正文过短",
    unknown: "未知错误",
  }[kind ?? ""] ?? (kind || "未识别");
}

function stageIndex(stage: string): string {
  return { search: "1", detail: "2", toc: "3", content: "4" }[stage] ?? "·";
}

function msLabel(ms: number): string {
  if (!ms) return "—";
  return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function shortField(field: string): string {
  return field.replace(/^rule(Search|BookInfo|Toc|Content)\./, "");
}

async function copyTrace(): Promise<void> {
  if (!trace.value) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(trace.value, null, 2));
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1800);
  } catch {
    error.value = "复制失败，请手动选择 JSON。";
  }
}
</script>

<style scoped>
.trace-panel { display: grid; gap: 12px; padding-bottom: 24px; }
.trace-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.trace-head h2 { margin: 0; font-size: var(--text-lg); }
.trace-head p { margin: 4px 0 0; color: var(--color-on-surface-variant); font-size: var(--text-xs); line-height: 1.5; }
.trace-total { flex: none; padding: 3px 9px; border-radius: var(--radius-pill); background: var(--color-surface-container); color: var(--color-on-surface-variant); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.trace-form { display: grid; gap: 9px; padding: 12px; border: 1px solid var(--color-outline-variant); border-radius: var(--radius-lg); background: var(--color-surface-container-low); }
.trace-field { display: grid; gap: 5px; font-size: var(--text-xs); color: var(--color-on-surface-variant); }
.trace-field small { opacity: .7; }
.trace-field input { width: 100%; height: 34px; padding: 0 10px; border: 1px solid var(--color-outline-variant); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-on-surface); font: inherit; font-size: var(--text-sm); }
.trace-field input:focus { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.trace-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 2px; }
.trace-loading { display: flex; align-items: center; gap: 8px; padding: 18px 4px; color: var(--color-on-surface-variant); font-size: var(--text-sm); }
.trace-spinner { width: 15px; height: 15px; border: 2px solid var(--color-outline-variant); border-top-color: var(--color-primary); border-radius: 50%; animation: trace-spin .8s linear infinite; }
@keyframes trace-spin { to { transform: rotate(360deg); } }
.trace-error { margin: 0; padding: 10px 12px; border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-error) 10%, transparent); color: var(--color-error); font-size: var(--text-sm); }
.trace-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.trace-source { font-size: var(--text-sm); font-weight: 600; }
.trace-chip { padding: 2px 8px; border-radius: var(--radius-pill); background: var(--color-surface-container); color: var(--color-on-surface-variant); font-size: var(--text-xs); }
.trace-badge { padding: 2px 8px; border-radius: var(--radius-pill); background: var(--color-surface-container); color: var(--color-on-surface-variant); font-size: var(--text-xs); font-weight: 600; }
.trace-badge.is-ok { background: color-mix(in srgb, var(--color-primary) 13%, transparent); color: var(--color-primary); }
.trace-badge.is-empty, .trace-badge.is-skip { background: var(--color-surface-container-high); color: var(--color-on-surface-variant); }
.trace-badge.is-fail, .trace-badge.is-bad { background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error); }
.trace-callout { display: grid; gap: 3px; padding: 10px 12px; border-radius: var(--radius-md); border-left: 3px solid var(--color-error); background: color-mix(in srgb, var(--color-error) 8%, transparent); font-size: var(--text-sm); }
.trace-callout b { color: var(--color-error); }
.trace-callout span { line-height: 1.45; }
.trace-callout small { color: var(--color-on-surface-variant); line-height: 1.5; }
.trace-stage { display: grid; gap: 9px; padding: 12px; border: 1px solid var(--color-outline-variant); border-radius: var(--radius-lg); background: var(--color-surface); }
.trace-stage.is-fail { border-color: color-mix(in srgb, var(--color-error) 45%, var(--color-outline-variant)); }
.trace-stage.is-skip { opacity: .72; }
.trace-stage-head { display: flex; align-items: center; gap: 8px; }
.trace-stage-index { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--color-primary-container); color: var(--color-on-primary-container); font-size: 11px; font-weight: 700; }
.trace-stage-title { display: grid; flex: 1; min-width: 0; gap: 1px; }
.trace-stage-title b { font-size: var(--text-sm); }
.trace-stage-title span { color: var(--color-on-surface-variant); font-size: var(--text-xs); line-height: 1.4; overflow-wrap: anywhere; }
.trace-ms { flex: none; color: var(--color-on-surface-variant); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.trace-request { display: grid; gap: 5px; padding: 8px 9px; border-radius: var(--radius-sm); background: var(--color-surface-container-low); }
.trace-url { color: var(--color-on-surface-variant); font-size: 11px; overflow-wrap: anywhere; }
.trace-request-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--color-on-surface-variant); font-size: 11px; }
.trace-headers summary { color: var(--color-on-surface-variant); font-size: var(--text-xs); cursor: pointer; }
.trace-headers ul { display: grid; gap: 3px; margin: 6px 0 0; padding: 0; list-style: none; }
.trace-headers li { display: flex; gap: 6px; min-width: 0; font-size: 11px; }
.trace-headers code { flex: none; color: var(--color-primary); }
.trace-headers span { min-width: 0; overflow-wrap: anywhere; }
.trace-muted { margin: 0; color: var(--color-on-surface-variant); font-size: 11px; }
.trace-fields { display: grid; gap: 5px; }
.trace-fields-head, .trace-items-head, .trace-pages-head { display: flex; justify-content: space-between; color: var(--color-on-surface-variant); font-size: 11px; font-weight: 600; }
.trace-field { border: 1px solid var(--color-outline-variant); border-radius: var(--radius-sm); overflow: hidden; }
.trace-field summary { display: flex; align-items: center; gap: 7px; padding: 6px 8px; cursor: pointer; list-style: none; }
.trace-field summary::-webkit-details-marker { display: none; }
.trace-field-name { flex: 1; min-width: 0; font-size: var(--text-xs); font-weight: 600; overflow-wrap: anywhere; }
.trace-kind { color: var(--color-on-surface-variant); font-size: 10px; text-transform: uppercase; }
.trace-count { min-width: 18px; padding: 1px 5px; border-radius: var(--radius-pill); background: var(--color-primary-container); color: var(--color-on-primary-container); text-align: center; font-size: 10px; font-variant-numeric: tabular-nums; }
.trace-count.zero { background: color-mix(in srgb, var(--color-error) 12%, transparent); color: var(--color-error); }
.trace-rule { display: block; margin: 0 8px 6px; padding: 6px 7px; border-radius: 5px; background: var(--color-surface-container); color: var(--color-on-surface-variant); font-size: 10px; overflow-wrap: anywhere; white-space: pre-wrap; }
.trace-values { display: grid; gap: 3px; margin: 0 8px 8px; padding: 0; list-style: none; }
.trace-values li { padding: 4px 6px; border-radius: 5px; background: var(--color-surface-container-low); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.trace-items { display: grid; gap: 4px; }
.trace-item { display: flex; gap: 7px; padding: 6px 7px; border-radius: var(--radius-sm); background: var(--color-surface-container-low); }
.trace-item-index { flex: none; color: var(--color-on-surface-variant); font-size: 10px; font-variant-numeric: tabular-nums; }
.trace-item-main { display: grid; flex: 1; min-width: 0; gap: 1px; }
.trace-item-main b { font-size: var(--text-xs); overflow-wrap: anywhere; }
.trace-item-main span, .trace-item-main code { color: var(--color-on-surface-variant); font-size: 10px; overflow-wrap: anywhere; }
.trace-pages { display: grid; gap: 4px; }
.trace-page { display: grid; gap: 2px; padding: 6px 7px; border-radius: var(--radius-sm); background: var(--color-surface-container-low); font-size: 11px; }
.trace-page-index { font-weight: 600; }
.trace-page code { color: var(--color-on-surface-variant); font-size: 10px; overflow-wrap: anywhere; }
.trace-text summary { color: var(--color-primary); font-size: var(--text-xs); cursor: pointer; }
.trace-text pre { max-height: 420px; margin: 7px 0 0; padding: 9px; overflow: auto; border-radius: var(--radius-sm); background: var(--color-surface-container); color: var(--color-on-surface); font-size: 11px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.trace-empty { margin: 0; padding: 18px 4px; color: var(--color-on-surface-variant); font-size: var(--text-sm); line-height: 1.55; }
</style>
