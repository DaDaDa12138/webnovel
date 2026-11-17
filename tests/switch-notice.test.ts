import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSwitchNotice,
  saveSwitchNotice,
  SWITCH_NOTICE_TTL_MS,
  takeSwitchNotice,
} from "../apps/web/src/lib/switch-notice";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

let store: Storage;

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal("sessionStorage", store);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T12:00:00+08:00"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("switch success notice", () => {
  it("is shown exactly once", () => {
    saveSwitchNotice(7, "已换到新源 · 36 章");
    expect(takeSwitchNotice(7)).toBe("已换到新源 · 36 章");
    expect(takeSwitchNotice(7)).toBeNull();
  });

  it("keeps books apart", () => {
    saveSwitchNotice(7, "七号书的回执");
    saveSwitchNotice(8, "八号书的回执");
    expect(takeSwitchNotice(8)).toBe("八号书的回执");
    expect(takeSwitchNotice(7)).toBe("七号书的回执");
  });

  it("drops a notice that outlived the page load", () => {
    saveSwitchNotice(7, "迟到的回执");
    vi.advanceTimersByTime(SWITCH_NOTICE_TTL_MS + 1);
    expect(takeSwitchNotice(7)).toBeNull();
    expect(store.getItem("legado-switch-notice:7")).toBeNull();
  });

  it("ignores empty text and clears stale JSON", () => {
    saveSwitchNotice(7, "   ");
    expect(takeSwitchNotice(7)).toBeNull();
    store.setItem("legado-switch-notice:7", "{not json");
    expect(takeSwitchNotice(7)).toBeNull();
    expect(store.getItem("legado-switch-notice:7")).toBeNull();
  });

  it("can be cleared explicitly", () => {
    saveSwitchNotice(7, "手动清掉");
    clearSwitchNotice(7);
    expect(takeSwitchNotice(7)).toBeNull();
  });
});
