import { onBeforeUnmount, ref } from "vue";

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
}

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/**
 * Screen Wake Lock wrapper. The browser drops the lock whenever the tab is
 * hidden, so every visibility change re-syncs instead of trusting `held`.
 */
export function useScreenWakeLock(shouldHold: () => boolean) {
  const supported = typeof navigator !== "undefined" && Boolean((navigator as WakeLockNavigator).wakeLock);
  const held = ref(false);
  let sentinel: WakeLockSentinelLike | null = null;
  let pending = false;

  async function acquire(): Promise<void> {
    if (!supported || sentinel || pending) return;
    pending = true;
    try {
      const request = (navigator as WakeLockNavigator).wakeLock?.request;
      if (!request) return;
      const next = await request.call((navigator as WakeLockNavigator).wakeLock, "screen");
      sentinel = next;
      held.value = true;
      next.addEventListener("release", () => {
        if (sentinel === next) sentinel = null;
        held.value = false;
      });
    } catch {
      // Denied (insecure context, battery saver, iframe): reading still works.
      sentinel = null;
      held.value = false;
    } finally {
      pending = false;
    }
  }

  async function release(): Promise<void> {
    const current = sentinel;
    sentinel = null;
    held.value = false;
    try {
      await current?.release();
    } catch {
      // Already released by the platform.
    }
  }

  function sync(): void {
    if (shouldHold()) void acquire();
    else void release();
  }

  function onVisibility(): void {
    sync();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  onBeforeUnmount(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    void release();
  });

  return { supported, held, sync, acquire, release };
}
