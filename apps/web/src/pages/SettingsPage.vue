<template>
  <section class="page set-page">
    <header class="page-head">
      <button class="back-btn" @click="router.back()">← 返回</button>
      <h1 class="page-title">设置<span v-if="dirty" class="set-dirty-pill">未保存</span></h1>
      <p class="page-sub">阅读偏好与搜索参数</p>
    </header>

    <ReaderPreview :settings="previewSettings" title="设置预览" />

    <h2 class="section-title">阅读主题</h2>
    <div class="theme-row">
      <button
        v-for="theme in themes"
        :key="theme.id"
        class="theme-chip"
        :class="{ active: form.theme === theme.id }"
        :style="{ background: theme.bg, color: theme.fg, borderColor: form.theme === theme.id ? theme.accent : 'transparent' }"
        @click="form.theme = theme.id"
      >
        <span class="theme-dot" :style="{ background: theme.accent }" />{{ theme.label }}
      </button>
    </div>

    <h2 class="section-title">排版</h2>
    <p class="set-sync-hint">这里改所有书的默认值；单本书的覆盖在阅读页「设置 → 本书」里调整。</p>
    <div class="set-group">
      <SettingRange
        v-model="form.fontSize"
        class="set-field"
        label="字号"
        unit="px"
        :min="READER_RANGES.fontSize.min"
        :max="READER_RANGES.fontSize.max"
        :step="READER_RANGES.fontSize.step"
      />
      <div class="set-field">
        <div class="set-label"><span>字重</span><strong>{{ weightLabel }}</strong></div>
        <div class="seg">
          <button
            v-for="item in FONT_WEIGHTS"
            :key="item.value"
            class="seg-btn"
            :class="{ active: form.fontWeight === item.value }"
            @click="form.fontWeight = item.value"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <SettingRange
        v-model="form.lineHeight"
        class="set-field"
        label="行距"
        :precision="1"
        :min="READER_RANGES.lineHeight.min"
        :max="READER_RANGES.lineHeight.max"
        :step="READER_RANGES.lineHeight.step"
      />
      <SettingRange
        v-model="form.paraSpacing"
        class="set-field"
        label="段距"
        unit="em"
        :precision="1"
        :min="READER_RANGES.paraSpacing.min"
        :max="READER_RANGES.paraSpacing.max"
        :step="READER_RANGES.paraSpacing.step"
      />
      <SettingRange
        v-model="form.letterSpacing"
        class="set-field"
        label="字间距"
        unit="em"
        :precision="2"
        :min="READER_RANGES.letterSpacing.min"
        :max="READER_RANGES.letterSpacing.max"
        :step="READER_RANGES.letterSpacing.step"
      />
      <div class="set-field set-inline">
        <span class="set-inline-label">正文字体</span>
        <select v-model="form.fontFamily" class="set-input">
          <option v-for="font in fonts" :key="font.id" :value="font.id">{{ font.label }}</option>
        </select>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">自定义字体</span>
        <input v-model="form.customFont" class="set-input" placeholder="如 霞鹜文楷" maxlength="40" />
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">页宽</span>
        <select v-model.number="form.pageWidth" class="set-input">
          <option v-for="width in READER_PAGE_WIDTHS" :key="width" :value="width">{{ width }}px</option>
        </select>
      </div>
      <SettingRange
        v-model="form.pageMargin"
        class="set-field"
        label="左右边距"
        unit="px"
        :min="READER_RANGES.pageMargin.min"
        :max="READER_RANGES.pageMargin.max"
        :step="READER_RANGES.pageMargin.step"
      />
      <SettingRange
        v-model="form.pagePaddingY"
        class="set-field"
        label="上下留白"
        unit="px"
        :min="READER_RANGES.pagePaddingY.min"
        :max="READER_RANGES.pagePaddingY.max"
        :step="READER_RANGES.pagePaddingY.step"
      />
      <div class="set-field set-inline">
        <span class="set-inline-label">首行缩进</span>
        <label class="set-check">
          <input v-model="form.indent" type="checkbox" />
          <span>段首空两字</span>
        </label>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">两端对齐</span>
        <label class="set-check">
          <input v-model="form.justify" type="checkbox" />
          <span>左右边缘对齐</span>
        </label>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">阅读模式</span>
        <div class="seg">
          <button class="seg-btn" :class="{ active: form.readerMode === 'scroll' }" @click="form.readerMode = 'scroll'">滚动</button>
          <button class="seg-btn" :class="{ active: form.readerMode === 'page' }" @click="form.readerMode = 'page'">翻页</button>
        </div>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">智能分段</span>
        <label class="set-check">
          <input type="checkbox" :checked="smartParagraph" @change="toggleSmart" />
          <span>合并硬换行、长段细分、对话独立成段</span>
        </label>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">特殊段落</span>
        <label class="set-check">
          <input type="checkbox" :checked="form.paragraph.special" @change="toggleSpecial" />
          <span>诗歌、书信、短信、系统提示和分节线独立排版</span>
        </label>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">背景颜色</span>
        <div class="set-color">
          <input
            type="color"
            :value="form.customBg || activeTheme.bg"
            class="set-color-input"
            aria-label="自定义阅读背景"
            @input="form.customBg = ($event.target as HTMLInputElement).value"
          />
          <span class="set-color-text">{{ form.customBg || "跟随主题" }}</span>
          <button v-if="form.customBg" class="btn btn-ghost btn-sm" @click="form.customBg = ''">恢复</button>
        </div>
      </div>
      <div class="set-field">
        <div class="set-label"><span>每日阅读目标</span><strong>{{ form.readingGoalMinutes }} 分钟</strong></div>
        <input v-model.number="form.readingGoalMinutes" type="range" min="10" max="120" step="5" />
      </div>
    </div>

    <h2 class="section-title">搜索</h2>
    <div class="set-group">
      <div class="set-field set-inline">
        <span class="set-inline-label">并发书源数</span>
        <input v-model.number="form.searchConcurrency" type="number" min="1" max="64" class="set-input set-input-num" />
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">默认关键词</span>
        <input v-model="form.searchKeyword" class="set-input" />
      </div>
    </div>

    <h2 class="section-title">设置备份</h2>
    <div class="set-group">
      <div class="set-field">
        <p class="set-sync-hint">导出的文件只包含阅读外观、排版和搜索参数，不包含账号、密码与书源。</p>
        <div class="set-backup-row">
          <button class="btn btn-ghost" type="button" @click="exportSettings">导出设置</button>
          <button class="btn btn-ghost" type="button" :disabled="importing" @click="pickImport">
            {{ importing ? "导入中…" : "导入设置" }}
          </button>
          <input ref="importInput" class="set-file" type="file" accept=".json,application/json" @change="importSettings" />
        </div>
      </div>
    </div>

    <h2 class="section-title">书山聚合</h2>
    <div class="set-group">
      <div class="set-field set-inline">
        <span class="set-inline-label">状态</span>
        <strong class="set-sync-value">{{ shushanText }}</strong>
      </div>
      <div class="set-field">
        <div class="set-inline" style="width: 100%">
          <span class="set-inline-label">书源规则</span>
          <strong class="set-sync-value">{{ ruleText }}</strong>
        </div>
        <p class="set-sync-hint">{{ ruleHint }}</p>
        <div class="row" style="gap: 8px; margin-top: 8px">
          <button class="btn btn-ghost set-sync-btn" type="button" :disabled="ruleBusy" @click="checkRule">
            {{ ruleBusy ? "检查中…" : "检查更新" }}
          </button>
          <button
            v-if="shushan?.updateAvailable"
            class="btn btn-primary set-sync-btn"
            type="button"
            :disabled="ruleBusy"
            @click="updateRule"
          >
            更新到 {{ shushan?.latest }}
          </button>
        </div>
      </div>
      <div v-if="shushan?.configured" class="set-field">
        <p class="set-sync-hint">
          内置源已可用：番茄小说与七猫的正文免费直读{{ shushan.member ? "；会员额度已生效，书旗、晋江、QQ 阅读等付费源也能读。" : "；书旗、晋江、QQ 阅读等源需要 VIP，账号升级后无需再配置。" }}
        </p>
        <button class="btn btn-ghost set-sync-btn" type="button" :disabled="shushanBusy" @click="logoutShushan">
          {{ shushanBusy ? "处理中…" : "退出书山聚合账号" }}
        </button>
      </div>
      <template v-else>
        <div class="set-field set-inline">
          <span class="set-inline-label">邮箱</span>
          <input v-model="shushanEmail" class="set-input" type="email" autocomplete="username" placeholder="书山聚合注册邮箱" />
        </div>
        <div class="set-field set-inline">
          <span class="set-inline-label">密码</span>
          <input v-model="shushanPassword" class="set-input" type="password" autocomplete="current-password" placeholder="书山聚合密码" />
        </div>
        <div class="set-field">
          <button class="btn btn-primary set-sync-btn" type="button" :disabled="shushanBusy || !shushanEmail || !shushanPassword" @click="loginShushan">
            {{ shushanBusy ? "登录中…" : "登录书山聚合" }}
          </button>
          <p v-if="shushanError" class="set-sync-error">{{ shushanError }}</p>
          <p class="set-sync-hint">
            免费账号可搜全部源站、看全部目录，正文能读番茄与七猫；书旗、晋江、QQ 阅读等需要 VIP，账号升级后这里不用改任何设置。
          </p>
        </div>
      </template>
    </div>

    <h2 class="section-title">大灰狼聚合</h2>
    <div class="set-group">
      <div class="set-field set-inline">
        <span class="set-inline-label">状态</span>
        <strong class="set-sync-value">{{ dhlText }}</strong>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">线路</span>
        <input v-model="dhlServer" class="set-input" type="url" placeholder="https://v5.langge.uk" autocomplete="off" />
      </div>
      <p class="set-sync-hint">
        留空使用默认线路 https://v5.langge.uk；连不上时可以换 v4/v2/v7。登录成功后会记住能用的线路。
      </p>
      <div v-if="dhl?.configured" class="set-field">
        <p class="set-sync-hint">
          {{ dhl.member ? "会员额度已生效：" + (dhl.vipLabel || "VIP") + "，可读付费源站的正文。" : "已登录，免费额度可读番茄等免费源；付费源需要账号开通会员。" }}
        </p>
        <button class="btn btn-ghost set-sync-btn" type="button" :disabled="dhlBusy" @click="logoutDhl">
          {{ dhlBusy ? "处理中…" : "退出大灰狼聚合账号" }}
        </button>
      </div>
      <template v-else>
        <div class="set-field set-inline">
          <span class="set-inline-label">邮箱</span>
          <input v-model="dhlEmail" class="set-input" type="email" autocomplete="username" placeholder="大灰狼聚合注册邮箱" />
        </div>
        <div class="set-field set-inline">
          <span class="set-inline-label">密码</span>
          <input v-model="dhlPassword" class="set-input" type="password" autocomplete="current-password" placeholder="大灰狼聚合密码" />
        </div>
        <div class="set-field">
          <button class="btn btn-primary set-sync-btn" type="button" :disabled="dhlBusy || !dhlEmail || !dhlPassword" @click="loginDhl">
            {{ dhlBusy ? "登录中…" : "登录大灰狼聚合" }}
          </button>
        </div>
        <div class="set-field set-inline">
          <span class="set-inline-label">密钥</span>
          <input v-model="dhlKey" class="set-input" type="password" autocomplete="off" placeholder="已有 qttoken 时直接填这里" />
        </div>
        <div class="set-field">
          <button class="btn btn-ghost set-sync-btn" type="button" :disabled="dhlBusy || !dhlKey" @click="loginDhlKey">
            {{ dhlBusy ? "校验中…" : "用密钥登录" }}
          </button>
          <p v-if="dhlError" class="set-sync-error">{{ dhlError }}</p>
          <p class="set-sync-hint">
            大灰狼是付费聚合源：搜索、详情和目录可以匿名看，正文每天只有 3 次免登录额度；登录后按账号额度阅读。密钥就是登录后的 qttoken。
          </p>
        </div>
      </template>
    </div>

    <h2 class="section-title">数据</h2>
    <div class="set-group">
      <a class="set-link" href="/api/export" download>导出全部书源<span class="set-chevron">›</span></a>
      <router-link class="set-link" to="/subscriptions">订阅源管理<span class="set-chevron">›</span></router-link>
      <router-link class="set-link" to="/replace">替换规则<span class="set-chevron">›</span></router-link>
    </div>

    <h2 class="section-title">OPDS 目录</h2>
    <div class="set-group">
      <a class="set-link" :href="opdsUrl" target="_blank" rel="noreferrer">打开 OPDS 目录<span class="set-chevron">›</span></a>
      <div class="set-field">
        <p class="set-sync-hint">在 KOReader、Moon+ Reader、Thorium 等支持 OPDS 的阅读器里添加下面的地址，可浏览书架、搜索书名或作者，并下载已缓存的 EPUB。</p>
        <div class="set-opds-row">
          <code class="set-opds-url">{{ opdsUrl }}</code>
          <button class="btn btn-ghost btn-sm" type="button" @click="copyOpds">复制</button>
        </div>
      </div>
    </div>

    <h2 class="section-title">同步</h2>
    <div class="set-group">
      <div class="set-field set-inline">
        <span class="set-inline-label">待补传</span>
        <strong class="set-sync-value">{{ sync.pending.value }} 条</strong>
      </div>
      <div class="set-field set-inline">
        <span class="set-inline-label">上次同步</span>
        <span class="set-sync-text">{{ lastSyncText }}</span>
      </div>
      <div class="set-field">
        <button class="btn btn-ghost set-sync-btn" type="button" :disabled="sync.flushing.value || !sync.pending.value" @click="sync.flush(true)">
          {{ sync.flushing.value ? "同步中…" : "立即同步" }}
        </button>
        <p v-if="sync.lastError.value" class="set-sync-error">{{ sync.lastError.value }}</p>
        <p class="set-sync-hint">断网时读到的进度、划线与书签会先存本机，恢复网络后自动补传。</p>
      </div>
    </div>

    <div v-if="dirty" class="set-save">
      <div class="set-save-row">
        <p class="set-dirty-hint">有改动尚未保存</p>
        <button class="btn btn-primary set-save-btn" :disabled="saving" @click="save">
          {{ saving ? "保存中…" : "保存设置" }}
        </button>
      </div>
      <p v-if="message" class="set-message">{{ message }}</p>
    </div>
    <p v-else-if="message" class="set-message set-message-foot">{{ message }}</p>
    <p class="set-foot">legado-web · v0.70.2 · GPL-3.0</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, type DahuilangStatus, type ShushanStatus } from "../api";
import ReaderPreview from "../components/reader/ReaderPreview.vue";
import SettingRange from "../components/settings/SettingRange.vue";
import {
  DEFAULT_READER_SETTINGS,
  READER_FONTS,
  READER_PAGE_WIDTHS,
  READER_RANGES,
  READER_THEMES,
  fromServerSettings,
  hasStoredReaderSettings,
  loadReaderSettings,
  normalizeReaderSettings,
  saveReaderSettings,
  toServerSettings,
  type ReaderSettings,
} from "../lib/reader-settings";
import { DEFAULT_PARAGRAPH_OPTIONS, type ParagraphOptions } from "../lib/reader-blocks";
import { toast } from "../lib/toast";
import { useSyncQueue } from "../composables/useSyncQueue";

const router = useRouter();
const sync = useSyncQueue();
const opdsUrl = computed(() => window.location.origin + "/opds");

async function copyOpds(): Promise<void> {
  try {
    await navigator.clipboard.writeText(opdsUrl.value);
    toast("OPDS 地址已复制", "success");
  } catch {
    toast("复制失败，请手动选择地址", "error");
  }
}

const shushan = ref<ShushanStatus | null>(null);
const shushanEmail = ref("");
const shushanPassword = ref("");
const shushanBusy = ref(false);
const shushanError = ref("");
const shushanText = computed(() => {
  const status = shushan.value;
  if (!status) return "读取中…";
  if (!status.configured) return "未登录";
  const who = status.nickname || status.email || "已登录";
  const plan = status.member ? "VIP" : "免费账号";
  const tail = status.deviceTail ? " · 设备 …" + status.deviceTail : "";
  return who + " · " + plan + tail;
});

const dhl = ref<DahuilangStatus | null>(null);
const dhlServer = ref("");
const dhlEmail = ref("");
const dhlPassword = ref("");
const dhlKey = ref("");
const dhlBusy = ref(false);
const dhlError = ref("");
const dhlText = computed(() => {
  const status = dhl.value;
  if (!status) return "读取中…";
  if (!status.configured) return "未登录";
  const who = status.nickname || status.email || "已登录";
  const plan = status.member ? status.vipLabel || "VIP" : "免费账号";
  const tail = status.deviceTail ? " · 设备 …" + status.deviceTail : "";
  return who + " · " + plan + tail;
});

const ruleBusy = ref(false);
const ruleText = computed(() => {
  const status = shushan.value;
  if (!status) return "读取中…";
  return "v" + (status.version || "?") + " · " + (status.categories || 0) + " 个分类";
});
/** 书源会定期发新版；这里把上次检查时间与最新版本讲清楚。 */
const ruleHint = computed(() => {
  const status = shushan.value;
  if (!status) return "";
  const checked = status.checkedAt ? new Date(status.checkedAt.replace(" ", "T") + "Z") : null;
  const when = checked && !Number.isNaN(checked.getTime())
    ? checked.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  if (status.updateAvailable) return "上游已有 v" + status.latest + "（" + status.latestDate + "），更新后分类表会跟着刷新。";
  if (when) return "已是最新，上次检查：" + when + "。服务端每 12 小时自动检查一次。";
  return "服务端每 12 小时自动检查一次；有新版会自动刷新分类表。";
});

async function checkRule(): Promise<void> {
  if (ruleBusy.value) return;
  ruleBusy.value = true;
  try {
    shushan.value = await api.shushanCheck();
    message.value = shushan.value.updateAvailable ? "发现新版 v" + shushan.value.latest : "书源规则已是最新";
  } catch (err) {
    message.value = "检查失败：" + String((err as Error).message ?? err);
  } finally {
    ruleBusy.value = false;
  }
}

async function updateRule(): Promise<void> {
  if (ruleBusy.value) return;
  ruleBusy.value = true;
  try {
    shushan.value = await api.shushanUpdate();
    message.value = "已更新到 v" + shushan.value.version;
  } catch (err) {
    message.value = "更新失败：" + String((err as Error).message ?? err);
  } finally {
    ruleBusy.value = false;
  }
}

async function loginShushan(): Promise<void> {
  if (shushanBusy.value) return;
  shushanBusy.value = true;
  shushanError.value = "";
  try {
    const res = await api.shushanLogin(shushanEmail.value.trim(), shushanPassword.value);
    shushan.value = res;
    shushanPassword.value = "";
    message.value = "已登录书山聚合，去发现页或搜索试试";
  } catch (err) {
    shushanError.value = String((err as Error).message ?? err);
  } finally {
    shushanBusy.value = false;
  }
}

async function logoutShushan(): Promise<void> {
  if (shushanBusy.value) return;
  shushanBusy.value = true;
  shushanError.value = "";
  try {
    shushan.value = await api.shushanLogout();
    message.value = "已退出书山聚合";
  } catch (err) {
    shushanError.value = String((err as Error).message ?? err);
  } finally {
    shushanBusy.value = false;
  }
}
async function loginDhl(): Promise<void> {
  if (dhlBusy.value) return;
  dhlBusy.value = true;
  dhlError.value = "";
  try {
    const res = await api.dahuilangLogin({
      email: dhlEmail.value.trim(),
      password: dhlPassword.value,
      server: dhlServer.value.trim() || undefined,
    });
    dhl.value = res;
    dhlServer.value = res.server;
    dhlPassword.value = "";
    message.value = "已登录大灰狼聚合，去搜索试试";
  } catch (err) {
    dhlError.value = String((err as Error).message ?? err);
  } finally {
    dhlBusy.value = false;
  }
}

async function loginDhlKey(): Promise<void> {
  if (dhlBusy.value) return;
  dhlBusy.value = true;
  dhlError.value = "";
  try {
    const res = await api.dahuilangLogin({
      key: dhlKey.value.trim(),
      server: dhlServer.value.trim() || undefined,
    });
    dhl.value = res;
    dhlServer.value = res.server;
    dhlKey.value = "";
    message.value = "已登录大灰狼聚合，去搜索试试";
  } catch (err) {
    dhlError.value = String((err as Error).message ?? err);
  } finally {
    dhlBusy.value = false;
  }
}

async function logoutDhl(): Promise<void> {
  if (dhlBusy.value) return;
  dhlBusy.value = true;
  dhlError.value = "";
  try {
    dhl.value = await api.dahuilangLogout();
    message.value = "已退出大灰狼聚合";
  } catch (err) {
    dhlError.value = String((err as Error).message ?? err);
  } finally {
    dhlBusy.value = false;
  }
}
/** 服务端存的是 UTC 的 "YYYY-MM-DD HH:MM:SS"，显示时转成本地时间。 */
const lastSyncText = computed(() => {
  const raw = sync.lastSyncAt.value;
  if (!raw) return "还没有补传过";
  const date = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
});
const themes = READER_THEMES;
const fonts = READER_FONTS;
const FONT_WEIGHTS = [
  { value: 400, label: "常规" },
  { value: 500, label: "中等" },
  { value: 600, label: "加粗" },
] as const;

const form = reactive({
  theme: DEFAULT_READER_SETTINGS.theme,
  fontFamily: DEFAULT_READER_SETTINGS.fontFamily,
  customFont: "",
  fontSize: DEFAULT_READER_SETTINGS.fontSize,
  fontWeight: DEFAULT_READER_SETTINGS.fontWeight,
  lineHeight: DEFAULT_READER_SETTINGS.lineHeight,
  paraSpacing: DEFAULT_READER_SETTINGS.paraSpacing,
  letterSpacing: DEFAULT_READER_SETTINGS.letterSpacing,
  pageWidth: DEFAULT_READER_SETTINGS.pageWidth,
  pageMargin: DEFAULT_READER_SETTINGS.pageMargin,
  pagePaddingY: DEFAULT_READER_SETTINGS.pagePaddingY,
  indent: DEFAULT_READER_SETTINGS.indent,
  justify: DEFAULT_READER_SETTINGS.justify,
  customBg: "",
  readerMode: DEFAULT_READER_SETTINGS.mode,
  readingGoalMinutes: 30,
  searchConcurrency: 16,
  searchKeyword: "诡秘之主",
  paragraph: { ...DEFAULT_PARAGRAPH_OPTIONS } as ParagraphOptions,
});
const saving = ref(false);
const message = ref("");

const activeTheme = computed(() => READER_THEMES.find((item) => item.id === form.theme) ?? READER_THEMES[0]);
const smartParagraph = computed(() => form.paragraph.mode === "smart");
const weightLabel = computed(() => FONT_WEIGHTS.find((item) => item.value === form.fontWeight)?.label ?? "常规");

function toggleSmart(event: Event) {
  form.paragraph = { ...form.paragraph, mode: (event.target as HTMLInputElement).checked ? "smart" : "off" };
}

function toggleSpecial(event: Event) {
  form.paragraph = { ...form.paragraph, special: (event.target as HTMLInputElement).checked };
}

/** 预览和阅读页共用同一个 ReaderSettings 形状，避免两套排版参数越走越远。 */
const previewSettings = computed<ReaderSettings>(() =>
  normalizeReaderSettings({
    ...DEFAULT_READER_SETTINGS,
    theme: form.theme as ReaderSettings["theme"],
    fontFamily: form.fontFamily as ReaderSettings["fontFamily"],
    customFont: form.customFont,
    fontSize: form.fontSize,
    fontWeight: form.fontWeight as ReaderSettings["fontWeight"],
    lineHeight: form.lineHeight,
    paraSpacing: form.paraSpacing,
    letterSpacing: form.letterSpacing,
    pageWidth: form.pageWidth,
    pageMargin: form.pageMargin,
    pagePaddingY: form.pagePaddingY,
    indent: form.indent,
    justify: form.justify,
    customBg: form.customBg,
    mode: form.readerMode as ReaderSettings["mode"],
    paragraph: form.paragraph,
  }),
);

const ready = ref(false);
const baseline = ref("");
const importInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);

/** 表单与阅读页共用同一套字段；这里只做一次赋值，避免导入和初始化各写一遍。 */
function applyReaderSettings(merged: ReaderSettings): void {
  form.theme = merged.theme;
  form.fontFamily = merged.fontFamily;
  form.customFont = merged.customFont;
  form.fontSize = merged.fontSize;
  form.fontWeight = merged.fontWeight;
  form.lineHeight = merged.lineHeight;
  form.paraSpacing = merged.paraSpacing;
  form.letterSpacing = merged.letterSpacing;
  form.pageWidth = merged.pageWidth;
  form.pageMargin = merged.pageMargin;
  form.pagePaddingY = merged.pagePaddingY;
  form.indent = merged.indent;
  form.justify = merged.justify;
  form.customBg = merged.customBg;
  form.readerMode = merged.mode;
  form.paragraph = { ...merged.paragraph };
}

function applyAppSettings(readingGoal: unknown, concurrency: unknown, keyword: unknown): void {
  const goal = Number(readingGoal);
  if (Number.isFinite(goal)) form.readingGoalMinutes = Math.min(120, Math.max(10, Math.round(goal)));
  const parallel = Number(concurrency);
  if (Number.isFinite(parallel)) form.searchConcurrency = Math.min(64, Math.max(1, Math.round(parallel)));
  if (typeof keyword === "string" && keyword.trim()) form.searchKeyword = keyword.slice(0, 80);
}

function snapshot(): string {
  return JSON.stringify({
    reader: previewSettings.value,
    readingGoalMinutes: form.readingGoalMinutes,
    searchConcurrency: form.searchConcurrency,
    searchKeyword: form.searchKeyword,
  });
}

const dirty = computed(() => ready.value && snapshot() !== baseline.value);
watch(dirty, (value) => {
  if (value && message.value === "已保存") message.value = "";
});

function exportSettings(): void {
  const payload = {
    format: "legado-web-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    reader: previewSettings.value,
    app: {
      readingGoalMinutes: form.readingGoalMinutes,
      searchConcurrency: form.searchConcurrency,
      searchKeyword: form.searchKeyword,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "legado-web-settings-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  message.value = "设置已导出；账号和书源不在文件里";
}

function pickImport(): void {
  importInput.value?.click();
}

async function importSettings(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 1024 * 1024) {
    message.value = "导入失败：设置文件不能超过 1 MB";
    return;
  }
  importing.value = true;
  try {
    const raw: unknown = JSON.parse(await file.text());
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("文件内容不是设置对象");
    const record = raw as Record<string, unknown>;
    if (record.format != null && record.format !== "legado-web-settings") throw new Error("不是 legado-web 设置文件");
    const candidate = record.reader ?? record.settings ?? record;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("没有找到阅读设置");
    const readerRaw = candidate as Partial<ReaderSettings>;
    if (readerRaw.theme == null && readerRaw.fontSize == null && readerRaw.mode == null) {
      throw new Error("没有找到阅读设置字段");
    }
    applyReaderSettings(normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...readerRaw }));
    const app = record.app && typeof record.app === "object" ? (record.app as Record<string, unknown>) : {};
    applyAppSettings(app.readingGoalMinutes, app.searchConcurrency, app.searchKeyword);
    message.value = "设置已导入，检查后点保存";
  } catch (err) {
    message.value = "导入失败：" + String((err as Error).message ?? err);
  } finally {
    importing.value = false;
  }
}

onMounted(async () => {
  const res = await api.settings();
  const server = fromServerSettings(res);
  const local = hasStoredReaderSettings() ? loadReaderSettings() : {};
  applyReaderSettings(normalizeReaderSettings({ ...DEFAULT_READER_SETTINGS, ...server, ...local }));
  applyAppSettings(res.readingGoalMinutes ?? 30, res.searchConcurrency ?? 16, res.searchKeyword ?? "诡秘之主");
  baseline.value = snapshot();
  ready.value = true;
  try {
    shushan.value = await api.shushanStatus();
  } catch {
    shushan.value = null;
  }
  try {
    dhl.value = await api.dahuilangStatus();
    if (dhl.value.server) dhlServer.value = dhl.value.server;
  } catch {
    dhl.value = null;
  }
});

async function save() {
  if (!dirty.value) return;
  saving.value = true;
  try {
    const next = previewSettings.value;
    // 本机偏好是阅读页的第一优先级，只写服务端会被本地旧值盖掉。
    saveReaderSettings(next);
    await api.saveSettings({
      ...toServerSettings(next),
      readingGoalMinutes: form.readingGoalMinutes,
      searchConcurrency: form.searchConcurrency,
      searchKeyword: form.searchKeyword,
    });
    baseline.value = snapshot();
    message.value = "已保存";
  } catch (err) {
    message.value = "保存失败：" + String((err as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.set-page {
  padding-bottom: calc(104px + env(safe-area-inset-bottom));
}
.set-preview {
  padding: 16px 18px;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(0, 0, 0, 0.06);
  transition: background 0.2s var(--ease-standard);
}
.set-preview-text {
  margin: 0;
  text-indent: 2em;
  transition: font-size 0.15s var(--ease-standard);
}
.set-preview-meta {
  margin: 12px 0 0;
  font-size: var(--text-xs);
  opacity: 0.6;
  text-align: right;
}
.theme-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding: 2px 2px 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.theme-row > :last-child {
  margin-right: 2px;
}
.theme-row::-webkit-scrollbar {
  display: none;
}
.theme-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 13px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: var(--radius-pill);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color 0.15s var(--ease-standard);
}
.theme-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.set-group {
  margin-top: 8px;
  padding: 4px 14px;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-xl);
  background: #fffdf8;
}
.set-field {
  padding: 11px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}
.set-field:last-child {
  border-bottom: 0;
}
.set-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: var(--text-md);
  margin-bottom: 6px;
}
.set-label strong {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-primary);
}
.set-field input[type="range"] {
  width: 100%;
  margin: 0;
}
.set-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.set-inline-label {
  font-size: var(--text-md);
}
.set-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.set-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
}
.set-input {
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font: inherit;
  font-size: var(--text-sm);
  background: #fffdf8;
  color: inherit;
  max-width: 60%;
}
.set-input-num {
  width: 84px;
}
.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-container);
}
.seg-btn {
  border: 0;
  border-radius: var(--radius-pill);
  padding: 5px 14px;
  background: transparent;
  color: var(--color-on-surface-variant);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.seg-btn.active {
  background: #fffdf8;
  color: var(--color-primary);
  box-shadow: var(--shadow-card);
}
.set-color {
  display: flex;
  align-items: center;
  gap: 8px;
}
.set-color-input {
  width: 44px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--color-outline);
  border-radius: var(--radius-sm);
  background: none;
}
.set-color-text {
  font-size: var(--text-xs);
  color: var(--color-on-surface-variant);
}
.set-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  color: inherit;
  font-size: var(--text-md);
  text-decoration: none;
}
.set-link:last-child {
  border-bottom: 0;
}
.set-chevron {
  font-size: 18px;
  line-height: 1;
  color: var(--color-outline);
}
.set-save {
  position: sticky;
  bottom: calc(72px + env(safe-area-inset-bottom));
  margin-top: 18px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: var(--radius-lg);
  background: rgba(250, 248, 243, 0.94);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(8px);
}
.set-save-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.set-save-row .set-dirty-hint {
  flex: 1;
  margin: 0;
  text-align: left;
}
.set-save-btn {
  flex: none;
  width: auto;
  min-width: 108px;
}
.set-message-foot {
  margin-top: 12px;
}
.set-message {
  margin: 8px 0 0;
  font-size: var(--text-sm);
  text-align: center;
  color: var(--color-primary);
}
.set-dirty-pill {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  vertical-align: 3px;
}
.set-dirty-hint {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  text-align: center;
  color: var(--color-on-surface-variant);
}
.set-backup-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.set-backup-row .btn {
  flex: 1;
}
.set-file {
  display: none;
}
.set-sync-value {
  font-size: var(--text-sm);
  color: var(--color-primary);
}
.set-sync-text {
  font-size: var(--text-sm);
  color: var(--color-on-surface-variant);
}
.set-sync-btn {
  width: 100%;
}
.set-sync-error {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--color-error, #b3261e);
}
.set-sync-hint {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--color-on-surface-variant);
}
.set-opds-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.set-opds-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-container);
  color: var(--color-on-surface-variant);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.set-opds-row .btn {
  flex: none;
}
.set-foot {
  margin: 20px 0 0;
  font-size: var(--text-xs);
  text-align: center;
  color: var(--color-on-surface-variant);
}
</style>