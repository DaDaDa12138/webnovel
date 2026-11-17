import type { ContentQuality, ContentQualityFlags } from "@legado/shared";

export interface ContentQualityResult {
  quality: ContentQuality;
  score: number;
  reason: string;
  flags?: ContentQualityFlags;
  replacementRatio?: number;
}

/**
 * 换源正文质量检查。
 *
 * 换源最怕的不是「这个源没有这本书」，而是「搜到了、目录也有、正文却是一句
 * 『正在手打中』或防盗提示」。字数看起来正常，换过去才发现没字。这里只做低成本的
 * 文本特征判断，不请求额外网络，也不试图理解剧情：
 *
 * - 强提示（占位/登录/付费/验证/章节不存在）直接判 bad；
 * - HTML 标签或实体残留、链接密度、重复段落判 suspect 并扣分；
 * - 其余按 ok 处理，宁可漏判也不把正常正文误伤成 bad。
 */
const STRONG_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /正在手打中|正在手打|手打中|内容正在加载|章节内容加载中|请稍后再来|请稍后再试|页面加载失败/i, label: "占位提示" },
  { re: /请先登录|登录后阅读|登录后即可|VIP章节|付费章节|购买本章|订阅本章|本章需购买|余额不足/i, label: "登录/付费提示" },
  { re: /访问验证|安全验证|人机验证|验证码|滑动验证|请完成验证/i, label: "验证页" },
  { re: /章节不存在|内容不存在|章节已删除|内容已屏蔽|章节已屏蔽|已被和谐/i, label: "空章节提示" },
];

const WEAK_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /防盗|版权所有|请勿转载|仅供试读|本站域名|最新网址/i, label: "站点声明" },
];

const HTML_TAG_RE = /<\/?(?:p|div|br|span|html|body|head|img|a|font|h[1-6])\b[^>]*>/i;
const HTML_ENTITY_RE = /&(?:nbsp|lt|gt|amp|quot|#\d+|#x[0-9a-f]+);/i;
const URL_RE = /https?:\/\/|www\./gi;
const REPLACEMENT_RE = /\uFFFD/g;
const PRIVATE_USE_RE = /[\uE000-\uF8FF]/g;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const QUESTION_GARBLE_RE = /[?？]{2,}|[\u4e00-\u9fff][?？][\u4e00-\u9fff]/g;

export function assessContentQuality(text: string, chars?: number): ContentQualityResult {
  const raw = String(text ?? "");
  const effectiveChars = Number.isFinite(chars) ? Math.max(0, Number(chars)) : raw.replace(/\s+/g, "").length;
  if (!raw.trim() || effectiveChars < 80) {
    return { quality: "bad", score: 10, reason: "正文过短或为空" };
  }

  const reasons: string[] = [];
  let score = 100;

  for (const rule of STRONG_RULES) {
    const match = raw.match(rule.re);
    if (match) {
      return {
        quality: "bad",
        score: 10,
        reason: `${rule.label}：${String(match[0]).slice(0, 24)}`,
      };
    }
  }

  for (const rule of WEAK_RULES) {
    if (rule.re.test(raw)) {
      score -= 20;
      reasons.push(rule.label);
      break;
    }
  }

  if (HTML_TAG_RE.test(raw)) {
    score -= 35;
    reasons.push("HTML 标签残留");
  } else if (HTML_ENTITY_RE.test(raw)) {
    score -= 20;
    reasons.push("HTML 实体残留");
  }

  const urls = raw.match(URL_RE)?.length ?? 0;
  if (urls >= 4 || (effectiveChars > 0 && urls * 120 > effectiveChars)) {
    score -= 25;
    reasons.push(`链接较多（${urls} 处）`);
  }

  // 源站自己坏掉时常见 U+FFFD、私用区字和控制字符；这些不是「正文短」，换源才有用。
  const replacement = raw.match(REPLACEMENT_RE)?.length ?? 0;
  const privateUse = raw.match(PRIVATE_USE_RE)?.length ?? 0;
  const controlChars = raw.match(CONTROL_CHAR_RE)?.length ?? 0;
  const questionMarks = (raw.match(QUESTION_GARBLE_RE) ?? []).reduce((sum, item) => sum + item.length, 0);
  const replacementRatio = effectiveChars > 0 ? replacement / effectiveChars : 0;
  const flags: ContentQualityFlags = { replacement, privateUse, questionMarks, controlChars };
  const hasFlags = replacement + privateUse + controlChars + questionMarks > 0;

  if (replacement > 0) {
    if (replacement >= 3 || replacementRatio >= 0.002) {
      score -= 70;
      reasons.push(`正文含 ${replacement} 个替换字符`);
    } else {
      score -= 30;
      reasons.push("正文含替换字符");
    }
  }
  if (privateUse >= 3) {
    score -= 25;
    reasons.push(`私用区字符 ${privateUse} 个`);
  }
  if (controlChars >= 3) {
    score -= 20;
    reasons.push("控制字符残留");
  }
  if (questionMarks >= 3) {
    score -= questionMarks >= 6 ? 30 : 20;
    reasons.push(`问号乱码 ${questionMarks} 处`);
  }

  if (effectiveChars >= 300) {
    const counts = new Map<string, number>();
    for (const line of raw.split(/\n+/)) {
      const key = line.replace(/\s+/g, "").trim();
      if (key.length < 8) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count >= 3)) {
      score -= 20;
      reasons.push("重复段落");
    }
  }

  const bounded = Math.max(0, Math.min(100, score));
  // 乱码特征即使扣分不足以跌破 75，也至少要提醒一次：读者看到方块字时，分数没有意义。
  const quality: ContentQuality = bounded <= 40 ? "bad" : bounded <= 75 || hasFlags ? "suspect" : "ok";
  const result: ContentQualityResult = {
    quality,
    score: bounded,
    reason: quality === "ok" ? "" : reasons.join("；") || "正文特征可疑",
  };
  if (hasFlags) result.flags = flags;
  if (replacement > 0) result.replacementRatio = Number(replacementRatio.toFixed(5));
  return result;
}
