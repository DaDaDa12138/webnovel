import { getDb } from "../db/index.js";

export const SETTING_DEFAULTS: Record<string, string> = {
  theme: "paper",
  fontSize: "18",
  lineHeight: "1.9",
  searchConcurrency: "16",
  searchKeyword: "诡秘之主",
  readerMode: "scroll",
  readingGoalMinutes: "30",
};

export function allSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((row) => [row.key, row.value])) };
}

export function getSetting(key: string, fallback = ""): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? SETTING_DEFAULTS[key] ?? fallback;
}
