// The Minecraft client jar, from Mojang as a launcher gets it: the version manifest, the version's JSON, the jar,
// its sha1 checked. All three hosts (piston-meta, piston-data) answer cross-origin reads. The jar is kept in the
// page's IndexedDB by its sha1, the version's download record under the version, so a later visit needs no request.
import { get, put, getFile, putFile } from "./store.js";
import { sha1Hex } from "@craftlabs/packrat";
import { fetchWithProgress } from "./download.js";

export const VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

async function json(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

/** The client download record of a version: { url, sha1, size } (from the cache, else from Mojang). */
export async function clientRecord(version, signal) {
  const cached = await get("meta", `client:${version}`);
  if (cached) return cached;
  const manifest = await json(VERSION_MANIFEST, signal);
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error(`Minecraft ${version} is not in Mojang's version manifest`);
  const v = await json(entry.url, signal);
  const rec = { url: v.downloads.client.url, sha1: v.downloads.client.sha1, size: v.downloads.client.size };
  await put("meta", `client:${version}`, rec);
  return rec;
}

/** Whether the version's jar is already in this browser. */
export async function hasClient(version) {
  const rec = await get("meta", `client:${version}`);
  return !!(rec && (await getFile(`sha1:${rec.sha1}`)));
}

/** The client jar as a Blob, downloaded (sha1 checked) unless cached. onProgress(bytes, total). */
export async function clientJar(version, { signal, onProgress } = {}) {
  const rec = await clientRecord(version, signal);
  const key = `sha1:${rec.sha1}`;
  const have = await getFile(key);
  if (have) return have;
  const buf = await fetchWithProgress(rec.url, { signal, total: rec.size, onProgress });
  const got = await sha1Hex(buf);
  if (got !== rec.sha1) throw new Error(`the client jar's sha1 is ${got}, Mojang lists ${rec.sha1}`);
  const blob = new Blob([buf], { type: "application/java-archive" });
  await putFile(key, blob, `client-${version}.jar`);
  return blob;
}
