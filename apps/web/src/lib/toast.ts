import { ref } from "vue";

export interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

export const toasts = ref<ToastItem[]>([]);
let seq = 0;

export function toast(text: string, kind: ToastItem["kind"] = "info"): void {
  const id = ++seq;
  toasts.value = [...toasts.value, { id, text, kind }];
  window.setTimeout(
    () => {
      toasts.value = toasts.value.filter((item) => item.id !== id);
    },
    kind === "error" ? 4600 : 2400,
  );
}
