/** 阅读设置的分组：设置项已经三十多个，一次只看一组。 */
export const SETTINGS_TABS = [
  { id: "display", label: "显示" },
  { id: "type", label: "排版" },
  { id: "turn", label: "翻页" },
  { id: "speech", label: "朗读" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

/** 记住上次看的那一组；换设备/清缓存后回到第一组。 */
export const SETTINGS_TAB_KEY = "legado-reader-settings-tab";

export function normalizeTab(value: string | null | undefined): SettingsTabId {
  const hit = SETTINGS_TABS.find((tab) => tab.id === value);
  return hit ? hit.id : "display";
}
