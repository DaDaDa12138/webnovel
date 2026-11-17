<script setup lang="ts">
/**
 * 书摘卡片：把选中的正文画成一张 1080×1440 的图，可以保存或分享。
 *
 * 换行与文件名的规则在 lib/quote-card.ts 里（有单测），
 * 这里只负责 canvas 绘制、预览和下载/分享。
 */
import { computed, ref, watch } from "vue";
import BottomSheet from "../BottomSheet.vue";
import { CARD_HEIGHT, CARD_PADDING, CARD_WIDTH, cardDate, cardFileName, wrapText } from "../../lib/quote-card";

const props = defineProps<{
  modelValue: boolean;
  quote: string;
  bookName: string;
  chapterTitle: string;
  palette: { bg: string; fg: string; muted: string; accent: string };
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const UI_FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const QUOTE_FONT = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", STSong, serif';

const preview = ref("");
const busy = ref(false);
const error = ref("");
const canShare = ref(false);

const fileName = computed(() => cardFileName(props.bookName, props.chapterTitle));

function trim(value: string, length: number): string {
  const text = value.trim();
  return text.length > length ? text.slice(0, length - 1) + "…" : text;
}

/** 引文越长字号越小，免得整张卡只剩三行字。 */
function quoteStyle(): { size: number; line: number } {
  if (props.quote.length <= 60) return { size: 58, line: 104 };
  if (props.quote.length <= 140) return { size: 48, line: 88 };
  return { size: 42, line: 78 };
}

async function render(): Promise<string> {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 canvas");

  const palette = props.palette;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // 顶部一小段强调色，替代标题下划线
  ctx.fillStyle = palette.accent;
  ctx.fillRect(CARD_PADDING, 128, 64, 8);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.muted;
  ctx.font = "500 34px " + UI_FONT;
  ctx.fillText(trim(props.bookName || "未命名书籍", 18), CARD_PADDING, 224);
  ctx.font = "400 26px " + UI_FONT;
  ctx.fillText(trim(props.chapterTitle || "", 24), CARD_PADDING, 276);

  const { size, line } = quoteStyle();
  ctx.fillStyle = palette.fg;
  ctx.font = "400 " + size + "px " + QUOTE_FONT;
  const text = props.quote.replace(/\s+/g, " ").trim();
  const maxLines = Math.max(1, Math.floor((CARD_HEIGHT - 470 - 200) / line));
  const lines = wrapText(text, {
    maxWidth: CARD_WIDTH - CARD_PADDING * 2,
    measure: (value) => ctx.measureText(value).width,
    maxLines,
  });
  // 短引文不要挤在顶部：在页眉与页脚之间垂直居中，长引文仍从 430 起排。
  const top = 430;
  const bottom = CARD_HEIGHT - 220;
  let y = top + Math.max(0, (bottom - top - lines.length * line) / 2);
  for (const item of lines) {
    ctx.fillText(item, CARD_PADDING, y);
    y += line;
  }

  ctx.fillStyle = palette.muted;
  ctx.font = "400 26px " + UI_FONT;
  ctx.fillText(cardDate(new Date()), CARD_PADDING, CARD_HEIGHT - 104);
  ctx.textAlign = "right";
  ctx.fillStyle = palette.accent;
  ctx.font = "500 28px " + UI_FONT;
  ctx.fillText("legado-web", CARD_WIDTH - CARD_PADDING, CARD_HEIGHT - 104);

  return canvas.toDataURL("image/png");
}

watch(
  () => [props.modelValue, props.quote] as const,
  async ([open]) => {
    if (!open) return;
    busy.value = true;
    error.value = "";
    preview.value = "";
    try {
      preview.value = await render();
      canShare.value = typeof navigator !== "undefined" && typeof navigator.canShare === "function";
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  },
  { immediate: true },
);

function save(): void {
  if (!preview.value) return;
  const link = document.createElement("a");
  link.href = preview.value;
  link.download = fileName.value;
  link.click();
}

async function share(): Promise<void> {
  if (!preview.value) return;
  try {
    const blob = await (await fetch(preview.value)).blob();
    const file = new File([blob], fileName.value, { type: "image/png" });
    if (!navigator.canShare?.({ files: [file] })) {
      save();
      return;
    }
    await navigator.share({ files: [file], title: props.bookName });
  } catch (err) {
    // 用户取消分享不算失败；其他错误退回下载。
    if ((err as Error)?.name !== "AbortError") save();
  }
}
</script>

<template>
  <BottomSheet
    inline
    tall
    :open="modelValue"
    title="书摘卡片"
    :subtitle="bookName"
    @close="emit('update:modelValue', false)"
  >
    <div class="quote-card">
      <div class="quote-card-preview">
        <img v-if="preview" :src="preview" :alt="'《' + bookName + '》书摘'" />
        <p v-else class="quote-card-hint">{{ error || (busy ? "正在生成…" : "先选中一段正文") }}</p>
      </div>
      <p class="quote-card-hint">1080 × 1440 PNG，可直接发朋友圈或存进相册。</p>
      <div class="quote-card-actions">
        <button class="btn" type="button" :disabled="!preview" @click="save">保存图片</button>
        <button v-if="canShare" class="btn ghost" type="button" :disabled="!preview" @click="share">分享</button>
      </div>
    </div>
  </BottomSheet>
</template>
