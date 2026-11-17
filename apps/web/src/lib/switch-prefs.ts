import type { SwitchCandidate } from "@legado/shared";

/** 换源偏好只存在本机：来源很多，用户通常只是不想再看到某个坏源。 */
export interface SwitchPrefs {
  pinned: number[];
  blocked: number[];
}

export const SWITCH_PREFS_KEY = "legado-switch-prefs";

function normalizeIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const raw of value) {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) seen.add(id);
  }
  return Array.from(seen);
}

export function normalizeSwitchPrefs(value: unknown): SwitchPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { pinned: normalizeIds(raw.pinned), blocked: normalizeIds(raw.blocked) };
}

export function loadSwitchPrefs(): SwitchPrefs {
  try {
    const raw = localStorage.getItem(SWITCH_PREFS_KEY);
    if (!raw) return { pinned: [], blocked: [] };
    return normalizeSwitchPrefs(JSON.parse(raw));
  } catch {
    return { pinned: [], blocked: [] };
  }
}

export function saveSwitchPrefs(prefs: SwitchPrefs): void {
  try {
    localStorage.setItem(SWITCH_PREFS_KEY, JSON.stringify(normalizeSwitchPrefs(prefs)));
  } catch {
    /* 隐私模式或存储已满时静默降级，不影响换源本身 */
  }
}

export function isSourcePinned(prefs: SwitchPrefs, sourceId: number): boolean {
  return prefs.pinned.includes(sourceId);
}

export function isSourceBlocked(prefs: SwitchPrefs, sourceId: number): boolean {
  return prefs.blocked.includes(sourceId);
}

/** 置顶与屏蔽互斥：置顶一个源时顺手解除屏蔽。 */
export function togglePinnedSource(prefs: SwitchPrefs, sourceId: number): SwitchPrefs {
  const next = normalizeSwitchPrefs(prefs);
  if (next.pinned.includes(sourceId)) {
    next.pinned = next.pinned.filter((id) => id !== sourceId);
  } else {
    next.pinned = [...next.pinned, sourceId];
    next.blocked = next.blocked.filter((id) => id !== sourceId);
  }
  return next;
}

export function toggleBlockedSource(prefs: SwitchPrefs, sourceId: number): SwitchPrefs {
  const next = normalizeSwitchPrefs(prefs);
  if (next.blocked.includes(sourceId)) {
    next.blocked = next.blocked.filter((id) => id !== sourceId);
  } else {
    next.blocked = [...next.blocked, sourceId];
    next.pinned = next.pinned.filter((id) => id !== sourceId);
  }
  return next;
}

/** 先滤掉屏蔽源，再把置顶源稳定地提到最前；其余保持调用方排序结果。 */
export function applySwitchPrefs<T extends SwitchCandidate>(list: T[], prefs: SwitchPrefs): T[] {
  const pinned = new Set(prefs.pinned);
  const blocked = new Set(prefs.blocked);
  return list
    .filter((item) => !blocked.has(item.sourceId))
    .sort((a, b) => Number(pinned.has(b.sourceId)) - Number(pinned.has(a.sourceId)));
}
