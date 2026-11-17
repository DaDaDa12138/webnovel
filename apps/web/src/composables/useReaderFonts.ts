import { ref } from "vue";
import { FONT_FAMILY_PREFIX, checkFontFile, fontFamilyFor, formatBytes } from "../lib/reader-fonts";
import {
  deleteStoredFont,
  listStoredFonts,
  readStoredFont,
  writeStoredFont,
  type StoredFontMeta,
} from "../lib/font-store";

/**
 * 模块级单例：设置面板负责导入/删除，阅读页负责在打开书之前把字体注册进 document.fonts，
 * 两处必须看到同一份状态，所以不放在组件内部。
 */

const fonts = ref<StoredFontMeta[]>([]);
const loading = ref(false);
const error = ref("");
const faces = new Map<string, FontFace>();
let refreshing: Promise<void> | null = null;

async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  loading.value = true;
  refreshing = listStoredFonts()
    .then((items) => {
      fonts.value = items;
      error.value = "";
    })
    .catch((err: unknown) => {
      fonts.value = [];
      error.value = err instanceof Error ? err.message : "读取字体库失败";
    })
    .finally(() => {
      loading.value = false;
      refreshing = null;
    });
  return refreshing;
}

async function registerFamily(family: string): Promise<void> {
  if (faces.has(family)) return;
  const record = await readStoredFont(family);
  if (!record) throw new Error("字体文件已不存在，请重新导入");
  const face = new FontFace(family, record.data, { display: "swap" });
  await face.load();
  document.fonts.add(face);
  faces.set(family, face);
}

/** 只处理导入字体（LegadoFont- 前缀）；本机字体名交给系统，注册会失败但不该报错。 */
async function ensure(family: string): Promise<void> {
  const name = family.trim();
  if (!name.startsWith(FONT_FAMILY_PREFIX)) return;
  try {
    await registerFamily(name);
  } catch {
    /* 字体缺失时正文回退到系统字体，阅读不受影响 */
  }
}

async function importFile(file: File): Promise<StoredFontMeta> {
  const check = checkFontFile({ name: file.name, size: file.size });
  if (!check.ok) throw new Error(check.message);
  const data = await file.arrayBuffer();
  const meta: StoredFontMeta = {
    family: fontFamilyFor(file.name, file.size),
    name: file.name.replace(/\.[^.]+$/, "") || file.name,
    size: file.size,
    type: check.format,
    addedAt: Date.now(),
  };
  await writeStoredFont(meta, data);
  await registerFamily(meta.family);
  await refresh();
  return meta;
}

async function remove(family: string): Promise<void> {
  await deleteStoredFont(family);
  const face = faces.get(family);
  if (face) {
    document.fonts.delete(face);
    faces.delete(family);
  }
  await refresh();
}

export function useReaderFonts() {
  return { fonts, loading, error, refresh, ensure, importFile, remove, formatBytes };
}
