/** 睡眠定时：到点停掉朗读与自动阅读，别让人开着自动翻页睡着后一直翻到天亮。
 *
 * 计时只活在这个页面会话里（刷新即失效）：定时器跨会话恢复没有意义，还会在第二天早上
 * 突然把人手里的书停掉。
 */

export interface SleepChoice {
  minutes: number;
  label: string;
}

export const SLEEP_CHOICES: SleepChoice[] = [
  { minutes: 0, label: "关闭" },
  { minutes: 15, label: "15 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 45, label: "45 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 90, label: "1.5 小时" },
];

/** 0 表示未启用。返回绝对时间戳，便于倒计时与「剩多少」共用一份状态。 */
export function sleepEndsAt(minutes: number, now = Date.now()): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return now + Math.round(minutes) * 60_000;
}

export function sleepLeft(endsAt: number, now = Date.now()): number {
  if (!Number.isFinite(endsAt) || endsAt <= 0) return 0;
  return Math.max(0, endsAt - now);
}

/** mm:ss；未启用或已到点返回空串（页角读数的空格子会被 CSS 收起来）。 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return (minutes < 10 ? "0" + minutes : String(minutes)) + ":" + (seconds < 10 ? "0" + seconds : String(seconds));
}

export function sleepChoiceLabel(minutes: number): string {
  const found = SLEEP_CHOICES.find((choice) => choice.minutes === minutes);
  return found ? found.label : minutes + " 分钟";
}
