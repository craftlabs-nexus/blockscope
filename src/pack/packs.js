// The merged packs in the renderer's own database ("ResourcePacksDB", store "packs": { id, name, enabled, priority,
// loadedAt, data }). The renderer loads every enabled pack it holds when it starts, and fetches a page-provided pack
// only when it holds none of that name. Before it starts, the page therefore enables the pack of the schematic it
// opens (when it is there), disables its other packs and drops all but the most recent few; packs the visitor
// dropped (resource-pack zips) are left as they are. While the page runs, switchPack does the same through the
// renderer's API.
import { PACK_PREFIX } from "./build.js";

const KEEP = 3;   // merged packs kept per browser (each about 15 to 40 MB)

/** Run before the renderer opens its database: only the current pack enabled, at most KEEP kept. */
export async function tidyRendererPacks(current) {
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    if (!dbs.some((d) => d.name === "ResourcePacksDB")) return;   // never create it: the renderer's upgrade must run
  } catch { return; }
  const db = await new Promise((resolve) => { const r = indexedDB.open("ResourcePacksDB"); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); r.onupgradeneeded = () => { r.transaction.abort(); }; });
  if (!db) return;
  try {
    if (!db.objectStoreNames.contains("packs")) return;
    await new Promise((resolve) => {
      const t = db.transaction("packs", "readwrite"), s = t.objectStore("packs");
      const req = s.getAll();
      req.onsuccess = () => {
        const ours = req.result.filter((p) => p.name?.startsWith(PACK_PREFIX)).sort((a, b) => (b.name === current) - (a.name === current) || (b.loadedAt ?? 0) - (a.loadedAt ?? 0));
        ours.forEach((p, i) => {
          if (i >= KEEP) { s.delete(p.id); return; }
          const enabled = p.name === current;
          if (p.enabled !== enabled) s.put({ ...p, enabled });
        });
      };
      t.oncomplete = t.onerror = t.onabort = () => resolve();
    });
  } finally { db.close(); }
}

/** The renderer's pack manager. */
export const packManager = (renderer) => renderer?.resourcePackManager ?? renderer?.renderManager?.resourcePackManager ?? null;

/**
 * The merged pack lowest, so a pack on top (one the visitor dropped, Redstone Tweaks) wins. In the renderer a lower
 * priority number wins (it loads packs from the highest number to the lowest and the last one loaded overrides), so
 * the merged pack gets the highest number.
 */
export async function keepBaseLowest(renderer) {
  const rpm = packManager(renderer); if (!rpm?.getAllPacks) return;
  const all = rpm.getAllPacks(), base = all.find((p) => p.enabled && p.name.startsWith(PACK_PREFIX));
  const others = all.filter((p) => p !== base);
  if (!base || !others.length) return;
  const max = Math.max(...others.map((p) => p.priority));
  if (base.priority <= max) await rpm.setPackPriority(base.id, max + 1);
}

/**
 * Makes `name` the one enabled merged pack: enables it when the renderer holds it, else builds it (`build()` resolves
 * to a Blob) and adds it; disables the other merged packs and removes all but the most recent KEEP. One atlas rebuild.
 */
export async function switchPack(renderer, name, build) {
  const rpm = packManager(renderer); if (!rpm) throw new Error("the renderer has no pack manager");
  const ours = () => rpm.getAllPacks().filter((p) => p.name.startsWith(PACK_PREFIX));
  let target = ours().find((p) => p.name === name);
  const blob = target ? null : await build();
  rpm.beginPackBatchUpdate();
  try {
    if (blob) {
      // the highest number: the lowest of the packs (see keepBaseLowest)
      const max = Math.max(0, ...rpm.getAllPacks().map((p) => p.priority));
      await rpm.loadPackFromBlob(blob, name, { priority: max + 1 });
      target = ours().find((p) => p.name === name);
    } else if (!target.enabled) await rpm.enablePack(target.id);
    const rest = ours().filter((p) => p.name !== name).sort((a, b) => (b.loadedAt ?? 0) - (a.loadedAt ?? 0));
    for (const [i, p] of rest.entries()) {
      if (i >= KEEP - 1) await rpm.removePack(p.id);
      else if (p.enabled) await rpm.disablePack(p.id);
    }
  } finally { await rpm.endPackBatchUpdate(); }
}
