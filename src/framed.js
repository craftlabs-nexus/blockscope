// Framed drawers and trim (Storage Drawers' framing table) look like their three materials, side, trim and front,
// which the block entity carries as MatS, MatT and MatF item stacks; the block's own model is the bare "raw" drawer.
// The page renders each framed cell under an id of its own per material set,
// blockscope:framed_<kind>__<side>__<trim>__<front> (a material as its block id with the namespace folded in:
// deepslate_tiles, promenade-polished_blunite; "raw" when unset), for which the pack builder writes a composite model
// from the materials' textures (pack/generated.js), and Inspect maps the id back to the mod's block.
const FRAMED = /^storagedrawers:framed_(?:(full|half)_drawers_(\d)|(compacting)_(half_)?drawers_(\d)|(trim))$/;
export const FRAMED_NS = "blockscope";

/** "full_1", "half_4", "comp_3", "halfcomp_3", "trim", or null for a block that is not framed. */
export const framedKind = (id) => {
  const m = id.match(FRAMED); if (!m) return null;
  return m[6] ? "trim" : m[3] ? `${m[4] ? "halfcomp" : "comp"}_${m[5]}` : `${m[1]}_${m[2]}`;
};
const matToken = (st) => {
  const id = typeof st?.id === "string" ? st.id : null; if (!id) return "raw";
  const [ns, p] = id.includes(":") ? id.split(":") : ["minecraft", id];
  return (ns === "minecraft" ? p : `${ns}-${p}`).replace(/[^a-z0-9_.-]/g, "_");
};
/** The id a framed block is rendered as (no block state), with its kind and material tokens; null if not framed. */
export function framedViewerId(id, be) {
  const kind = framedKind(id); if (!kind) return null;
  const side = matToken(be?.MatS), trim = matToken(be?.MatT), front = kind === "trim" ? null : matToken(be?.MatF);
  return { id: `${FRAMED_NS}:framed_${kind}__${side}__${trim}${front === null ? "" : `__${front}`}`, kind, side, trim, front };
}
/** A material token back to its block id (null for "raw"). */
export const matId = (t) => (t === "raw" || !t ? null : t.includes("-") ? t.replace("-", ":") : `minecraft:${t}`);
/** The mod's block id and materials behind a rendered framed id (Inspect), or null for any other id. */
export function framedRealId(viewerId) {
  const m = viewerId.match(/^blockscope:framed_([a-z]+_\d|trim)__([^_].*?)__([^_].*?)(?:__([^_].*))?$/);
  if (!m) return null;
  const [, kind, side, trim, front] = m;
  const id = kind === "trim" ? "storagedrawers:framed_trim" : kind.startsWith("halfcomp") ? `storagedrawers:framed_compacting_half_drawers_${kind.slice(-1)}` : kind.startsWith("comp") ? `storagedrawers:framed_compacting_drawers_${kind.slice(-1)}` : `storagedrawers:framed_${kind.split("_")[0]}_drawers_${kind.slice(-1)}`;
  return { id, kind, side: matId(side), trim: matId(trim), front: kind === "trim" ? null : matId(front) };
}
