<script setup lang="ts">
import { computed } from "vue";
import { buildDisplayBlocks, type DisplayBlock } from "../../lib/reader-blocks";
import { buildStarts } from "../../lib/reader-progress";
import { fontStack, readerPalette, type ReaderSettings } from "../../lib/reader-settings";

const props = defineProps<{
  settings: ReaderSettings;
  /** 用当前章的真实段落做样例，比固定例句更能看出段距和缩进。 */
  paragraphs?: string[];
  title?: string;
  /** 设置面板里空间小，压一压内边距和标题。 */
  compact?: boolean;
}>();

const FALLBACK = [
  "风从山口吹来，带着雨后泥土的气息。他合上书，抬头看见远处亮起一盏灯。",
  "「你终于来了。」老人把茶推过来，杯沿还冒着热气，「再晚一点，这壶茶就凉了。」",
  "窗外的雨声渐渐密了。两个人谁也没有再说话，只听见纸页翻动的声音。",
];

const source = computed(() => {
  const real = (props.paragraphs ?? []).map((item) => item.trim()).filter(Boolean);
  return real.length ? real : FALLBACK;
});

const allBlocks = computed(() =>
  buildDisplayBlocks(source.value, buildStarts(source.value), props.title ?? "", props.settings.paragraph),
);

/** 优先展示一段特殊段落（诗歌/系统提示等），否则开关打开后预览里看不出变化。 */
const blocks = computed(() => {
  const all = allBlocks.value;
  if (props.settings.paragraph.special) {
    let special = all.findIndex((block) => block.kind !== "text" && block.kind !== "dialog" && block.kind !== "divider");
    if (special < 0) special = all.findIndex((block) => block.kind === "divider");
    if (special > 2) return all.slice(special - 2, special + 1);
  }
  return all.slice(0, 3);
});

const systemDark = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)").matches
  : false;
const palette = computed(() => readerPalette(props.settings, systemDark));

const previewStyle = computed(() => ({
  background: palette.value.bg,
  color: palette.value.fg,
  fontFamily: fontStack(props.settings.fontFamily, props.settings.customFont),
  fontSize: props.compact ? Math.max(14, Math.min(props.settings.fontSize, 18)) + "px" : props.settings.fontSize + "px",
  lineHeight: String(props.settings.lineHeight),
  letterSpacing: props.settings.letterSpacing + "em",
  textAlign: props.settings.justify ? "justify" : "start",
}));

function paraStyle(block: DisplayBlock): Record<string, string> {
  const special = block.kind !== "text" && block.kind !== "dialog";
  return {
    marginBottom: props.settings.paraSpacing + "em",
    textIndent: props.settings.indent && !special ? "2em" : "0",
  };
}
</script>

<template>
  <div class="reader-preview" :class="{ compact }" :style="previewStyle">
    <div class="reader-preview-head">
      <span>排版预览</span>
      <span class="reader-preview-meta">{{ settings.fontSize }}px · 行距 {{ settings.lineHeight }} · 段距 {{ settings.paraSpacing }}</span>
    </div>
    <div class="reader-preview-body">
      <p v-for="block in blocks" :key="block.start" class="reader-preview-para" :class="['kind-' + block.kind, { cont: block.cont }]" :style="paraStyle(block)">
        {{ block.text }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.reader-preview {
  margin: 0 16px 8px;
  padding: 12px 14px;
  border: 1px solid rgba(127, 127, 127, 0.22);
  border-radius: 12px;
  overflow: hidden;
}
.reader-preview.compact {
  margin: 0 12px 6px;
  padding: 9px 12px;
}
.reader-preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.55;
}
.reader-preview-meta {
  font-size: 10px;
  letter-spacing: 0;
  text-transform: none;
  white-space: nowrap;
}
.reader-preview-body {
  max-height: 7.2em;
  overflow: hidden;
}
.reader-preview-para {
  margin-top: 0;
  word-break: break-word;
}
.reader-preview-para.cont {
  text-indent: 0;
}
.reader-preview-para.kind-poem {
  text-align: center;
  letter-spacing: 0.06em;
  opacity: 0.86;
}
.reader-preview-para.kind-letter {
  padding-left: 0.7em;
  border-left: 2px solid currentColor;
  opacity: 0.78;
}
.reader-preview-para.kind-sms {
  margin-left: 1em;
  padding: 0.35em 0.6em;
  border-radius: 10px 10px 10px 3px;
  background: rgba(127, 127, 127, 0.12);
}
.reader-preview-para.kind-system {
  padding: 0.3em 0.55em;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
  opacity: 0.82;
}
.reader-preview-para.kind-divider {
  text-align: center;
  letter-spacing: 0.4em;
  opacity: 0.45;
}
</style>
