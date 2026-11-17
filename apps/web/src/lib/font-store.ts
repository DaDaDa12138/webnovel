/**
 * 导入字体存 IndexedDB：字体动辄几 MB，localStorage 只有 5 MB 且要整串序列化。
 * meta 与 data 分两个 store，列清单时不必把每个字体的字节都读进内存。
 */

export interface StoredFontMeta {
  family: string;
  name: string;
  size: number;
  type: string;
  addedAt: number;
}

export interface StoredFont extends StoredFontMeta {
  data: ArrayBuffer;
}

const DB_NAME = "legado-reader-fonts";
const DB_VERSION = 1;
const META_STORE = "meta";
const DATA_STORE = "data";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      dbPromise = null;
      reject(new Error("这个浏览器不支持 IndexedDB，无法保存导入的字体"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "family" });
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE, { keyPath: "family" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("打开字体库失败"));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("字体库被另一个标签页占用，请关掉其它阅读页再试"));
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("字体库写入失败"));
    tx.onabort = () => reject(tx.error ?? new Error("字体库写入被取消"));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("字体库读取失败"));
  });
}

export async function listStoredFonts(): Promise<StoredFontMeta[]> {
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readonly");
  const items = await result(tx.objectStore(META_STORE).getAll() as IDBRequest<StoredFontMeta[]>);
  return items.sort((a, b) => b.addedAt - a.addedAt);
}

export async function readStoredFont(family: string): Promise<StoredFont | null> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, DATA_STORE], "readonly");
  const [meta, data] = await Promise.all([
    result(tx.objectStore(META_STORE).get(family) as IDBRequest<StoredFontMeta | undefined>),
    result(tx.objectStore(DATA_STORE).get(family) as IDBRequest<{ family: string; data: ArrayBuffer } | undefined>),
  ]);
  if (!meta || !data) return null;
  return { ...meta, data: data.data };
}

export async function writeStoredFont(meta: StoredFontMeta, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, DATA_STORE], "readwrite");
  tx.objectStore(META_STORE).put(meta);
  tx.objectStore(DATA_STORE).put({ family: meta.family, data });
  await done(tx);
}

export async function deleteStoredFont(family: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, DATA_STORE], "readwrite");
  tx.objectStore(META_STORE).delete(family);
  tx.objectStore(DATA_STORE).delete(family);
  await done(tx);
}
