// Plan files: a schematic on the site (or on an allowed origin) with what its generator wrote beside it, the block
// metadata (<name>.meta.json: owner, role, item, part, shell per world position) and the paintings
// (<name>.paintings.json). `?schem=` names one: a path under the plans base (VITE_PLANS_BASE, default /plans/,
// which the dev server maps to the storage plan's folder) or a full URL on one of the allowed origins.

export const PLANS_BASE = import.meta.env.VITE_PLANS_BASE || "/plans/";
// the origins a ?schem= URL may point at besides the page's own (they must allow cross-origin reads)
export const ALLOWED_ORIGINS = ["https://gg.craftlabs.nexus", ...(import.meta.env.VITE_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)];
export const DEFAULT_PLAN = import.meta.env.VITE_DEFAULT_PLAN ?? "storage-hall.schem";
export const SCHEMATIC_EXT = /\.(schem|schematic|litematic|nbt)$/i;

/** The URL a ?schem= value names, or an error for an origin that is not allowed. */
export function resolvePlan(param) {
  const base = new URL(PLANS_BASE, location.href);
  const url = /^https?:\/\//i.test(param) ? new URL(param) : new URL(param.replace(/^\/+/, ""), base);
  if (url.origin !== location.origin && !ALLOWED_ORIGINS.includes(url.origin)) throw new Error(`${url.origin} is not an allowed origin for ?schem=`);
  if (!SCHEMATIC_EXT.test(url.pathname)) throw new Error(`${url.pathname.split("/").pop()} is not a schematic (.schem, .schematic, .litematic, .nbt)`);
  return url;
}

async function optionalJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

/** The schematic's bytes, metadata and paintings: { name, url, bytes, meta, paintings, paintingsBase }. */
export async function loadPlan(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url.pathname.split("/").pop()}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const stem = url.href.replace(/\.[^./?#]+(?=([?#].*)?$)/, "");
  const metaUrl = new URL(`${stem}.meta.json`), paintingsUrl = new URL(`${stem}.paintings.json`);
  const [meta, paintings] = await Promise.all([optionalJson(metaUrl), optionalJson(paintingsUrl)]);
  return { name: decodeURIComponent(url.pathname.split("/").pop()), url, bytes, meta, paintings: paintings?.paintings ?? [], paintingsBase: paintingsUrl.href };
}
