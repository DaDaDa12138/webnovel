/**
 * 换源成功回执：换源后面板会整页重载（新源目录/正文都要重新取），
 * 旧页面里的 toast 会连同页面一起消失，读者只看到「页面闪了一下」。
 * 用 sessionStorage 留一张短时回执，ReaderPage 打开后取走并展示。
 */
import type { SwitchReanchor } from "@legado/shared";

const PREFIX = "legado-switch-notice:";
/** 回执只对紧接着的一次加载有意义；超过这个时间说明页面没打开成功，别再补弹。 */
export const SWITCH_NOTICE_TTL_MS = 30_000;

export interface SwitchNotice {
  text: string;
  at: number;
  /** 换源时标注/书签的搬迁结果：failed > 0 时阅读页给一个「重试重贴」。 */
  reanchor?: SwitchReanchor;
}

export interface SwitchNoticeDetail {
  text: string;
  reanchor: SwitchReanchor | null;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveSwitchNotice(bookId: number | string, text: string, reanchor?: SwitchReanchor | null): void {
  const store = storage();
  const value = String(text ?? "").trim();
  if (!store || !value) return;
  const notice: SwitchNotice = { text: value.slice(0, 240), at: Date.now(), reanchor: reanchor ?? undefined };
  try {
    store.setItem(PREFIX + bookId, JSON.stringify(notice));
  } catch {
    // 隐私模式/配额满：换源本身已经成功，回执丢了也不能影响主流程。
  }
}

/** 取走即删除：同一条回执不能在下一次刷新时再弹一遍。 */
export function takeSwitchNoticeDetail(bookId: number | string): SwitchNoticeDetail | null {
  const store = storage();
  if (!store) return null;
  const key = PREFIX + bookId;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    store.removeItem(key);
    const parsed = JSON.parse(raw) as Partial<SwitchNotice>;
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > SWITCH_NOTICE_TTL_MS) return null;
    return { text: parsed.text.trim().slice(0, 240), reanchor: parsed.reanchor ?? null };
  } catch {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }
}

export function takeSwitchNotice(bookId: number | string): string | null {
  return takeSwitchNoticeDetail(bookId)?.text ?? null;
}

export function clearSwitchNotice(bookId: number | string): void {
  try {
    storage()?.removeItem(PREFIX + bookId);
  } catch {
    // ignore
  }
}
