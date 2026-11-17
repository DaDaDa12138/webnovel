import { router } from "../router";

/**
 * Go back only when the browser actually has an in-app entry to return to.
 * A hard refresh (or a shared link) leaves history.state.back empty, which used
 * to make `router.back()` do nothing and trapped people on the detail page.
 */
export function goBack(fallback = "/shelf"): void {
  const state = window.history.state as { back?: string | null } | null;
  if (state && state.back) {
    router.back();
    return;
  }
  void router.push(fallback);
}
