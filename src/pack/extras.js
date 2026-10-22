// Resource packs the visitor can add on top of the built pack: an exact file from Modrinth (sha512 checked), downloaded
// by the browser like the mods and kept in the page's IndexedDB, so it is fetched once.
import { sha512Hex } from "@craftlabs/packrat";
import { getFile, putFile } from "./store.js";

/** Redstone Tweaks (MIT): the signal strength on dust, repeater delays and comparator modes; the plan viewer's own. */
export const REDSTONE_TWEAKS = {
  name: "Redstone Tweaks 1.5",
  url: "https://cdn.modrinth.com/data/VQ3xRU3R/versions/w2qJ69wk/Redstone%20Tweaks.zip",
  sha512: "7692f0c16da93e00c865e65bd240a22d24bb716885cb0975d1b39850f228227160285d0fbbf936495a02fd92b2cc7975d455a0fa58a5cc7994b74f090e962521",
  size: 981964,
  page: "https://modrinth.com/resourcepack/redstonetweaksresourcepack",
};

/** The pack's zip: from this browser when it has it, else from Modrinth (its hash checked). */
export async function extraPackBlob(extra, { signal } = {}) {
  const key = `extra:${extra.sha512}`;
  const kept = await getFile(key);
  if (kept) return kept;
  const r = await fetch(extra.url, { signal });
  if (!r.ok) throw new Error(`${r.status} for ${extra.name}`);
  const buf = await r.arrayBuffer();
  if ((await sha512Hex(buf)) !== extra.sha512) throw new Error(`${extra.name}: the download does not match its hash`);
  const blob = new Blob([buf], { type: "application/zip" });
  await putFile(key, blob, extra.name);
  return blob;
}
