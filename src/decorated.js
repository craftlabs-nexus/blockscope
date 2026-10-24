// Banners with patterns and decorated pots with sherds look like their block entity's data, which no block model can
// read. Like framed drawers (framed.js), the page renders each such cell under an id of its own, and the pack builder
// (pack/entities.js) writes a model for every id the schematic uses:
//   blockscope:<color>_banner__<hash>, blockscope:<color>_wall_banner__<hash>  (hash: the patterns, see bannerKey)
//   blockscope:decorated_pot__<back>__<left>__<right>__<front>                  (each side: a sherd name, or "brick")
// A plain banner or pot keeps its own id: the pack's models for those draw the base color and the plain sides.
export const DECORATED_NS = "blockscope";

export const DYES = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
// the patterns' codes in files written before 1.20.5 (Patterns: [{ Pattern: "bs", Color: 14 }])
const OLD_PATTERNS = {
  b: "base", bs: "stripe_bottom", ts: "stripe_top", ls: "stripe_left", rs: "stripe_right", cs: "stripe_center", ms: "stripe_middle",
  drs: "stripe_downright", dls: "stripe_downleft", ss: "small_stripes", cr: "cross", sc: "straight_cross", bt: "triangle_bottom",
  tt: "triangle_top", bts: "triangles_bottom", tts: "triangles_top", ld: "diagonal_left", rd: "diagonal_up_right", lud: "diagonal_up_left",
  rud: "diagonal_right", mc: "circle", mr: "rhombus", vh: "half_vertical", hh: "half_horizontal", vhr: "half_vertical_right",
  hhb: "half_horizontal_bottom", bl: "square_bottom_left", br: "square_bottom_right", tl: "square_top_left", tr: "square_top_right",
  bo: "border", cbo: "curly_border", gra: "gradient", gru: "gradient_up", bri: "bricks", glb: "globe", cre: "creeper", sku: "skull",
  flo: "flower", moj: "mojang", pig: "piglin",
};
const BANNER = /^minecraft:([a-z_]+?)(_wall)?_banner$/;
const val = (x) => (x && typeof x === "object" && "v" in x ? x.v : x);
const list = (x) => { const v = val(x); return Array.isArray(v) ? v : []; };

/** A banner block entity's patterns, bottom layer first: [{ pattern: "stripe_top", color: "red" }] (empty for none). */
export function bannerPatterns(be) {
  const out = [];
  for (const p of list(be?.patterns)) {
    const pat = val(p?.pattern), color = val(p?.color);
    const name = typeof pat === "string" ? pat.replace(/^minecraft:/, "") : typeof pat?.asset_id === "string" ? pat.asset_id.replace(/^minecraft:/, "") : null;
    if (name && DYES.includes(color)) out.push({ pattern: name, color });
  }
  for (const p of list(be?.Patterns)) {
    const name = OLD_PATTERNS[val(p?.Pattern)], color = DYES[Number(val(p?.Color))];
    if (name && color) out.push({ pattern: name, color });
  }
  return out;
}
// a short, stable name for a pattern list (FNV-1a over its text)
export function bannerKey(patterns) {
  let h = 0x811c9dc5;
  for (const c of patterns.map((p) => `${p.pattern}:${p.color}`).join(",")) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const SHERD = /^minecraft:([a-z_]+)_pottery_sherd$/;
/** A decorated pot's four sides, [back, left, right, front], each a sherd's name ("angler") or "brick". */
export function potSides(be) {
  const s = list(be?.sherds ?? be?.Sherds).map((x) => String(val(x) ?? ""));
  return [0, 1, 2, 3].map((i) => s[i]?.match(SHERD)?.[1] ?? "brick");
}

/**
 * The id a banner or decorated pot is rendered as (no block state), or null when its own id draws it: a banner
 * without patterns, a pot with brick sides, any other block.
 */
export function decoratedViewerId(id, be) {
  const b = id.match(BANNER);
  if (b && DYES.includes(b[1])) {
    const patterns = bannerPatterns(be); if (!patterns.length) return null;
    return { id: `${DECORATED_NS}:${b[1]}${b[2] ?? ""}_banner__${bannerKey(patterns)}`, kind: "banner", base: b[1], wall: !!b[2], patterns };
  }
  if (id === "minecraft:decorated_pot") {
    const sides = potSides(be); if (sides.every((s) => s === "brick")) return null;
    return { id: `${DECORATED_NS}:decorated_pot__${sides.join("__")}`, kind: "pot", sides };
  }
  return null;
}

/** The block behind a rendered banner or pot id (Inspect), with what it shows, or null for any other id. */
export function decoratedRealId(viewerId) {
  const b = viewerId.match(/^blockscope:([a-z_]+?)(_wall)?_banner__[0-9a-z]+$/);
  if (b) return { id: `minecraft:${b[1]}${b[2] ?? ""}_banner`, kind: "banner" };
  const p = viewerId.match(/^blockscope:decorated_pot__([a-z_]+)__([a-z_]+)__([a-z_]+)__([a-z_]+)$/);
  if (p) return { id: "minecraft:decorated_pot", kind: "pot", sides: p.slice(1, 5) };
  return null;
}
