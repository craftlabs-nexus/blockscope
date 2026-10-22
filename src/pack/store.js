// The page's own IndexedDB ("blockscope"): the downloaded files (the client jar by its sha1, the mod jars by their
// pack hash) and what each jar provides (its namespaces with their blockstate counts), so a second visit, or another
// schematic, builds its pack without a download. The merged pack itself lives in the renderer's database
// ("ResourcePacksDB"), which this module also tidies before the renderer opens it (packs.js).
const DB = "blockscope", VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");   // key -> { blob, name, at }
      if (!db.objectStoreNames.contains("jars")) db.createObjectStore("jars");     // key -> { filename, namespaces }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");     // key -> any
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error ?? new Error(`IndexedDB ${store}`));
  });
}

export const get = (store, key) => tx(store, "readonly", (s) => s.get(key)).catch(() => undefined);
export const put = (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key)).catch((e) => console.warn("[blockscope] could not store", store, key, e));
export const keys = (store) => tx(store, "readonly", (s) => s.getAllKeys()).catch(() => []);
export const clear = (store) => tx(store, "readwrite", (s) => s.clear());

/** The stored file's bytes as a Blob, or undefined. */
export const getFile = async (key) => (await get("files", key))?.blob;
export const putFile = (key, blob, name) => put("files", key, { blob, name, at: Date.now() });

/** How much the page keeps: { files, bytes }. */
export async function usage() {
  const db = await open().catch(() => null); if (!db) return { files: 0, bytes: 0 };
  return new Promise((resolve) => {
    let files = 0, bytes = 0;
    const req = db.transaction("files").objectStore("files").openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return resolve({ files, bytes }); files++; bytes += c.value?.blob?.size ?? 0; c.continue(); };
    req.onerror = () => resolve({ files, bytes });
  });
}

/** The key a pack entry's bytes are stored under: its strongest listed hash (none: not cached). */
export function entryKey(entry) {
  if (entry.sha512) return `sha512:${entry.sha512.toLowerCase()}`;
  if (entry.sha256) return `sha256:${entry.sha256.toLowerCase()}`;
  if (entry.sha1) return `sha1:${entry.sha1.toLowerCase()}`;
  return null;
}
