// Plan files: a schematic on the site (or on an allowed origin), its block metadata and paintings in the file itself
// (BlockInfo, Paintings). `?schem=` names one: a path under the plans base
// (VITE_PLANS_BASE: in development /plans/, which the dev server maps to the BLOCKSCOPE_PLANS folder; on the site the
// files bucket, https://files.craftlabs.nexus/, from .env.production) or a full URL on one of the allowed origins.

export const PLANS_BASE = import.meta.env.VITE_PLANS_BASE || "/plans/";
// the origins a ?schem= URL may point at besides the page's own (they must allow cross-origin reads)
export const ALLOWED_ORIGINS = ["https://gg.craftlabs.nexus", "https://files.craftlabs.nexus", ...(import.meta.env.VITE_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)];
// the file opened without ?schem=: none until VITE_DEFAULT_PLAN names one (in development, a file in the
// BLOCKSCOPE_PLANS folder; on the site, one in the files bucket, from .env.production)
export const DEFAULT_PLAN = import.meta.env.VITE_DEFAULT_PLAN ?? "";
export const SCHEMATIC_EXT = /\.(schem|schematic|litematic|nbt)$/i;

// a name given without its extension opens the first of these that is there: the .schem the page reads as it is,
// then the formats it converts
export const NAME_FORMATS = [".schem", ".litematic", ".nbt"];

/**
 * The URL a ?schem= value names, or an error for an origin that is not allowed. A name without an extension
 * (?schem=farm_kelp) is the .schem, with the other formats as its `fallbacks` (loadPlan tries them in turn).
 */
export function resolvePlan(param) {
  const base = new URL(PLANS_BASE, location.href);
  let url = /^https?:\/\//i.test(param) ? new URL(param) : new URL(param.replace(/^\/+/, ""), base);
  if (url.origin !== location.origin && !ALLOWED_ORIGINS.includes(url.origin)) throw new Error(`${url.origin} is not an allowed origin for ?schem=`);
  const last = url.pathname.split("/").pop();
  if (!last.includes(".")) {
    const [first, ...rest] = NAME_FORMATS.map((ext) => new URL(`${url.pathname}${ext}${url.search}`, url));
    url = Object.assign(first, { fallbacks: rest });
  } else if (!SCHEMATIC_EXT.test(url.pathname)) throw new Error(`${last} is not a schematic (.schem, .schematic, .litematic, .nbt)`);
  return url;
}

/** The schematic's bytes: { name, url, bytes }. */
export async function loadPlan(url) {
  // a name without its extension: the first of its formats that is there (not a page some hosts answer with)
  let r = null;
  for (const u of [url, ...(url.fallbacks ?? [])]) {
    r = await fetch(u);
    if (r.ok && !/text\/html/i.test(r.headers.get("content-type") ?? "")) { url = u; break; }
    if (u === url && !url.fallbacks) break;
    r = null;
  }
  if (!r?.ok) {
    const what = url.fallbacks ? `${url.pathname.split("/").pop().replace(/\.[^.]+$/, "")} (${NAME_FORMATS.join(", ")})` : url.pathname.split("/").pop();
    throw new Error(r ? `${r.status} ${r.statusText} for ${what}` : `no ${what}`);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { name: decodeURIComponent(url.pathname.split("/").pop()), url, bytes };
}
