// Block models for the blocks the game draws with a block-entity renderer: vanilla 26.x gives them a model with no
// shape (a particle texture and nothing else), so the renderer would draw nothing. Banners, mob heads and skulls,
// shulker boxes, decorated pots, the conduit, copper golem statues, the end portal and gateway get models here built
// from their entity textures: the boxes and texture offsets of the game's entity model (its LayerDefinition), placed
// in the block as its block-entity renderer places them. Banners with patterns and pots with sherds get a model per
// design the schematic uses (decorated.js). The books a lectern and an enchanting table show join their blocks' own
// models.
//
// Entity models are drawn upside down: their y runs down and their front faces -z, and the renderers turn them over
// (y and z negated). A model box at (x, y, z), w × h × d texels, lands at x + cx, cy - y, cz - z in the block (scaled
// by s), with its front to the south; ModelPart.Cube's texture unwrap then puts, from texOffs (u, v):
//   up    u+d .. u+d+w,       v .. v+d          down  u+d+w .. u+d+2w,    v .. v+d
//   west  u .. u+d,           v+d .. v+d+h      south u+d .. u+d+w,       v+d .. v+d+h (the front)
//   east  u+d+w .. u+2d+w,    v+d .. v+d+h      north u+2d+w .. u+2d+2w,  v+d .. v+d+h (the back)
// Facing and rotation go in the blockstate (y in 90° steps); a standing banner's or head's 22.5° steps between those
// are element rotations (a model allows -45 to 45 in 22.5° steps).
import { DYES } from "../decorated.js";

const GEN = "blockscope";
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
/** A PNG's width and height, from its header. */
export const pngSize = (b) => [u32(b, 16), u32(b, 20)];

// the dyes' colors as entity textures take them (DyeColor's texture diffuse color)
export const DYE_RGB = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa, brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};

/**
 * A box of an entity model's texture on a block-model element from `from` to `to` (block units, 0..16), its front to
 * the south. `size` is the texture's (square) size in texels; `skip` the faces left out; `mirror` the model's mirrored
 * boxes.
 */
export function cube(from, to, [u, v], [w, h, d], size, { tex = "#t", skip = [], rotation = null, mirror = false } = {}) {
  const k = 16 / size, R = (x0, y0, x1, y1) => [x0, y0, x1, y1].map((n) => r4(n * k));
  const s0 = v + d, s1 = v + d + h;
  let faces = {
    up: R(u + d, v, u + d + w, v + d),
    down: R(u + d + w, v, u + d + 2 * w, v + d),
    south: R(u + d, s0, u + d + w, s1),
    north: R(u + 2 * d + w, s0, u + 2 * d + 2 * w, s1),
    west: R(u, s0, u + d, s1),
    east: R(u + d + w, s0, u + 2 * d + w, s1),
  };
  if (mirror) {
    const flip = ([x0, y0, x1, y1]) => [x1, y0, x0, y1];
    faces = { up: flip(faces.up), down: flip(faces.down), south: flip(faces.south), north: flip(faces.north), west: flip(faces.east), east: flip(faces.west) };
  }
  return {
    from: from.map(r4), to: to.map(r4), ...(rotation ? { rotation } : {}),
    faces: Object.fromEntries(Object.entries(faces).filter(([f]) => !skip.includes(f)).map(([f, uv]) => [f, { uv, texture: tex }])),
  };
}

/** A model box ({ uv, at: [x, y, z] with its part's offset, size: [w, h, d], g: inflation }) placed in the block. */
export function place(b, { c = [8, 0, 8], s = 1 } = {}) {
  const [x, y, z] = b.at, [w, h, d] = b.size, g = b.g ?? 0;
  return [[c[0] + s * (x - g), c[1] - s * (y + h + g), c[2] - s * (z + d + g)], [c[0] + s * (x + w + g), c[1] - s * (y - g), c[2] - s * (z - g)]];
}
const boxes = (list, frame, size, tex = "#t") => list.map((b) => {
  const [from, to] = place(b, frame);
  // a part turned about z (a piglin's ears): its pivot placed like a point of the model, the angle negated with z
  const rotation = b.rotZ ? { origin: place({ at: b.pivot, size: [0, 0, 0] }, frame)[0].map(r4), axis: "z", angle: -b.rotZ } : null;
  return cube(from, to, b.uv, b.size, size, { tex, rotation, mirror: b.mirror });
});

// A standing banner's or head's rotation (0..15, 22.5° steps clockwise from south seen from above) as a blockstate y
// in 90° steps and an element turn (k steps, -1..2) between them; element angles run the other way.
export const rotationSteps = (r) => { const q = Math.floor((r + 1) / 4), k = r - 4 * q; return { y: (90 * q) % 360, k }; };
const turned = (elements, k, origin = [8, 8, 8]) => (k ? elements.map((e) => ({ ...e, rotation: { origin, axis: "y", angle: -22.5 * k } })) : elements);
const ys = (y) => (y ? { y } : {});
const FACING_Y = { south: 0, west: 90, north: 180, east: 270 };

// --- textures ---------------------------------------------------------------------------------------------------------
const canvas = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
const bitmap = (bytes) => createImageBitmap(new Blob([bytes], { type: "image/png" }));
async function pngOf(c) {
  const blob = c.convertToBlob ? await c.convertToBlob({ type: "image/png" }) : await new Promise((r) => c.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
// `img` multiplied by `rgb`, its alpha kept, drawn onto g
function drawTinted(g, img, rgb, w, h) {
  const t = canvas(w, h), tg = t.getContext("2d");
  tg.imageSmoothingEnabled = false;
  tg.drawImage(img, 0, 0, w, h);
  tg.globalCompositeOperation = "multiply"; tg.fillStyle = `#${rgb.toString(16).padStart(6, "0")}`; tg.fillRect(0, 0, w, h);
  tg.globalCompositeOperation = "destination-in"; tg.drawImage(img, 0, 0, w, h);
  g.drawImage(t, 0, 0);
}

class Textures {
  constructor(src, zip) { this.src = src; this.zip = zip; this.cache = new Map(); }
  bytes(path) { const f = this.src.file(`assets/minecraft/textures/${path}.png`); return f ? f.async("uint8array") : null; }
  /** An entity texture as a model references it, with its size: its own path when square, else a square copy. */
  async use(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    const bytes = await this.bytes(path);
    let out = null;
    if (bytes) {
      const [w, h] = pngSize(bytes);
      if (w === h) out = { ref: `minecraft:${path}`, size: w };
      else {
        const s = Math.max(w, h), c = canvas(s, s), g = c.getContext("2d");
        g.drawImage(await bitmap(bytes), 0, 0);
        const name = `block/entity/${path.replace(/^entity\//, "")}`;
        this.zip.file(`assets/${GEN}/textures/${name}.png`, await pngOf(c));
        out = { ref: `${GEN}:${name}`, size: s };
      }
    }
    this.cache.set(path, out);
    return out;
  }
  /** A banner's texture: the pole, bar and flag, the base color and the patterns over it, written once per design. */
  async banner(key, base, patterns) {
    const name = `block/entity/banner/${key}`;
    if (this.cache.has(name)) return this.cache.get(name);
    const flag = await this.bytes("entity/banner/banner_base"); if (!flag) return null;
    const [w, h] = pngSize(flag), c = canvas(w, h), g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(await bitmap(flag), 0, 0);
    for (const p of [{ pattern: "base", color: base }, ...patterns]) {
      const b = await this.bytes(`entity/banner/${p.pattern}`); if (!b) continue;
      drawTinted(g, await bitmap(b), DYE_RGB[p.color], w, h);
    }
    this.zip.file(`assets/${GEN}/textures/${name}.png`, await pngOf(c));
    const out = { ref: `${GEN}:${name}`, size: w };
    this.cache.set(name, out);
    return out;
  }
  /** The end portal's view: the starfield layers over the dark, as one still texture. */
  async portal() {
    const stars = await this.bytes("entity/end_portal/end_portal"); if (!stars) return null;
    const S = 64, c = canvas(S, S), g = c.getContext("2d"), img = await bitmap(stars);
    g.fillStyle = "#0b0d17"; g.fillRect(0, 0, S, S);
    for (const [rgb, scale] of [[0x2a8a8a, 1], [0x5a3fa8, 2], [0x3fbf9f, 3]]) {
      const t = canvas(S, S), tg = t.getContext("2d");
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) tg.drawImage(img, (x * S) / scale, (y * S) / scale, S / scale, S / scale);
      const tinted = canvas(S, S); drawTinted(tinted.getContext("2d"), t, rgb, S, S);
      g.globalCompositeOperation = "lighter"; g.drawImage(tinted, 0, 0);
    }
    const name = "block/entity/end_portal_view";
    this.zip.file(`assets/${GEN}/textures/${name}.png`, await pngOf(c));
    return { ref: `${GEN}:${name}`, size: S };
  }
}

// --- the models ---------------------------------------------------------------------------------------------------------
// Mob heads (SkullModel, PiglinHeadModel, DragonHeadModel), facing south at rotation 0. Floor heads stand on the block's
// floor; a wall head sits 4 higher and 4 toward the wall (SkullBlockRenderer).
const HEAD = { uv: [0, 0], at: [-4, -8, -4], size: [8, 8, 8] };
const HAT = { uv: [32, 0], at: [-4, -8, -4], size: [8, 8, 8], g: 0.25 };
export const HEADS = {
  skeleton_skull: { tex: "entity/skeleton/skeleton", boxes: [HEAD] },
  wither_skeleton_skull: { tex: "entity/skeleton/wither_skeleton", boxes: [HEAD] },
  zombie_head: { tex: "entity/zombie/zombie", boxes: [HEAD, HAT] },
  creeper_head: { tex: "entity/creeper/creeper", boxes: [HEAD] },
  player_head: { tex: "entity/player/wide/steve", boxes: [HEAD, HAT] },
  piglin_head: {
    tex: "entity/piglin/piglin",
    boxes: [
      { uv: [0, 0], at: [-5, -8, -4], size: [10, 8, 8] }, { uv: [31, 1], at: [-2, -4, -5], size: [4, 4, 1] },
      { uv: [2, 4], at: [2, -2, -5], size: [1, 2, 1] }, { uv: [2, 0], at: [-3, -2, -5], size: [1, 2, 1] },
      // the ears hang at 30° (22.5 here, the nearest a block model takes)
      { uv: [51, 6], at: [4.5, -6, -2], size: [1, 5, 4], pivot: [4.5, -6, 0], rotZ: -22.5 },
      { uv: [39, 6], at: [-5.5, -6, -2], size: [1, 5, 4], pivot: [-4.5, -6, 0], rotZ: 22.5 },
    ],
  },
  dragon_head: {
    tex: "entity/enderdragon/dragon", s: 0.75, cy: 0.374375 * 16,
    boxes: [
      { uv: [176, 44], at: [-6, -1, -24], size: [12, 5, 16] }, { uv: [112, 30], at: [-8, -8, -10], size: [16, 16, 16] },
      { uv: [0, 0], at: [-5, -12, -4], size: [2, 4, 6], mirror: true }, { uv: [112, 0], at: [-5, -3, -22], size: [2, 2, 4], mirror: true },
      { uv: [0, 0], at: [3, -12, -4], size: [2, 4, 6] }, { uv: [112, 0], at: [3, -3, -22], size: [2, 2, 4] },
      { uv: [176, 65], at: [-6, 4, -24], size: [12, 4, 16] },
    ],
  },
};
export const wallHeadId = (name) => name.replace(/_(skull|head)$/, "_wall_$1");

// The copper golem (CopperGolemModel) standing, as a statue shows it facing south; the parts' offsets folded in.
const GOLEM = [
  { uv: [0, 15], at: [-4, 13, -3], size: [8, 6, 6] },    // body
  { uv: [0, 0], at: [-4, 8, -5], size: [8, 5, 10] },     // head
  { uv: [56, 0], at: [-1, 11, -6], size: [2, 3, 2] },    // nose
  { uv: [37, 8], at: [-1, 4, -1], size: [2, 4, 2] },     // rod
  { uv: [37, 0], at: [-2, 0, -2], size: [4, 4, 4] },     // its knob
  { uv: [36, 16], at: [-7, 12, -2], size: [3, 10, 4] },  // right arm
  { uv: [50, 16], at: [4, 12, -2], size: [3, 10, 4] },   // left arm
  { uv: [0, 27], at: [-4, 19, -2], size: [4, 5, 4] },    // right leg
  { uv: [16, 27], at: [0, 19, -2], size: [4, 5, 4] },    // left leg
];

// Banners (BannerRenderer: two thirds of the model's size), the flag to the south. A standing banner's pole stands at
// the block's middle; a wall banner's bar is against the north side, its flag hanging into the block below.
const POLE = { uv: [44, 0], at: [-1, -30, -1], size: [2, 42, 2] };
const BAR = { uv: [0, 42], at: [-10, -32, -1], size: [20, 2, 2] };
const FLAG = { uv: [0, 0], at: [-10, -32, -2], size: [20, 40, 1] };
const STANDING = { c: [8, 8, 8], s: 2 / 3 }, WALL = { c: [8, -8 / 3 - 5, 1], s: 2 / 3 };

/**
 * Writes the models and blockstates of the blocks drawn by block-entity renderers into `zip` (the merged pack), from
 * the client jar's entity textures, and those of `designs` (Schematic.decoratedCombos()); returns how many block ids
 * it covers and the textures it could not find.
 */
export async function addEntityBlocks(zip, clientZip, designs = []) {
  const T = new Textures(clientZip, zip), missing = new Set();
  let made = 0;
  const model = (name, textures, elements, extra = {}) => zip.file(`assets/${GEN}/models/block/${name}.json`, JSON.stringify({ textures, elements, ...extra }));
  const state = (ns, id, variants) => { zip.file(`assets/${ns}/blockstates/${id}.json`, JSON.stringify({ variants })); made++; };
  const need = async (path) => { const t = await T.use(path); if (!t) missing.add(path); return t; };

  // shulker boxes (ShulkerModel, closed): the lid (4..16) overlaps the base (0..8), and their textures take turns
  // where they do: the lid's sides are open at the latch, the base's are clear but for it
  for (const color of ["", ...DYES]) {
    const id = color ? `${color}_shulker_box` : "shulker_box", t = await need(`entity/shulker/shulker${color ? `_${color}` : ""}`); if (!t) continue;
    model(`shulker/${id}`, { particle: `minecraft:block/${id}`, t: t.ref }, [
      cube([0, 4, 0], [16, 16, 16], [0, 0], [16, 12, 16], t.size, { skip: ["down"] }),
      cube([0, 0, 0], [16, 8, 16], [0, 28], [16, 8, 16], t.size, { skip: ["up"] }),
    ]);
    const m = `${GEN}:block/shulker/${id}`;
    state("minecraft", id, {
      "facing=up": { model: m }, "facing=down": { model: m, x: 180 }, "facing=north": { model: m, x: 90 },
      "facing=south": { model: m, x: 90, y: 180 }, "facing=west": { model: m, x: 90, y: 270 }, "facing=east": { model: m, x: 90, y: 90 },
    });
  }

  // mob heads and skulls (the player head with the default skin: a profile's own skin is not in the file)
  for (const [name, h] of Object.entries(HEADS)) {
    const t = await need(h.tex); if (!t) continue;
    const s = h.s ?? 1, cy = h.cy ?? 0, tex = { particle: t.ref, t: t.ref };
    for (const k of [-1, 0, 1, 2]) {
      // a part turned about z cannot also turn about y: between the 90° steps it hangs straight
      const els = boxes(k ? h.boxes.map(({ rotZ, ...b }) => (void rotZ, b)) : h.boxes, { c: [8, cy, 8], s }, t.size);
      model(`head/${name}_${k + 1}`, tex, turned(els, k));
    }
    model(`head/${wallHeadId(name)}`, tex, boxes(h.boxes, { c: [8, cy + 4, 4], s }, t.size));
    const floor = {};
    for (let r = 0; r < 16; r++) { const { y, k } = rotationSteps(r); floor[`rotation=${r}`] = { model: `${GEN}:block/head/${name}_${k + 1}`, ...ys(y) }; }
    state("minecraft", name, floor);
    state("minecraft", wallHeadId(name), Object.fromEntries(Object.entries(FACING_Y).map(([f, y]) => [`facing=${f}`, { model: `${GEN}:block/head/${wallHeadId(name)}`, ...ys(y) }])));
  }

  // banners: one texture per color (and per pattern design), its standing turns and its wall model
  const bannerModels = async (key, base, patterns, ns, standingId, wallId) => {
    const t = await T.banner(key, base, patterns); if (!t) { missing.add("entity/banner/banner_base"); return; }
    const tex = { particle: t.ref, t: t.ref };
    for (const k of [-1, 0, 1, 2]) model(`banner/${key}_${k + 1}`, tex, turned(boxes([POLE, BAR, FLAG], STANDING, t.size), k));
    model(`banner/${key}_wall`, tex, boxes([BAR, FLAG], WALL, t.size));
    const standing = {};
    for (let r = 0; r < 16; r++) { const { y, k } = rotationSteps(r); standing[`rotation=${r}`] = { model: `${GEN}:block/banner/${key}_${k + 1}`, ...ys(y) }; }
    state(ns, standingId, standing);
    state(ns, wallId, Object.fromEntries(Object.entries(FACING_Y).map(([f, y]) => [`facing=${f}`, { model: `${GEN}:block/banner/${key}_wall`, ...ys(y) }])));
  };
  for (const color of DYES) await bannerModels(color, color, [], "minecraft", `${color}_banner`, `${color}_wall_banner`);
  for (const d of designs.filter((x) => x.kind === "banner")) {
    const short = d.id.replace(`${GEN}:`, ""), hash = short.split("__")[1];
    // one design id per standing or wall cell; both forms are written, whichever the file has
    await bannerModels(`${d.base}__${hash}`, d.base, d.patterns, GEN, `${d.base}_banner__${hash}`, `${d.base}_wall_banner__${hash}`);
  }

  // decorated pots (DecoratedPotRenderer): the body's four sides (back, left, right, front: a sherd's pattern or the
  // plain side), its top and bottom, the neck and its lip; the front faces the block's facing
  const potBase = await need("entity/decorated_pot/decorated_pot_base");
  const potModel = async (name, sides) => {
    const tex = { particle: "minecraft:block/terracotta", base: potBase.ref };
    for (const [slot, sherd] of [["back", sides[0]], ["left", sides[1]], ["right", sides[2]], ["front", sides[3]]]) {
      const t = await need(sherd === "brick" ? "entity/decorated_pot/decorated_pot_side" : `entity/decorated_pot/${sherd}_pottery_pattern`);
      tex[slot] = t?.ref ?? potBase.ref;
    }
    const k = 16 / potBase.size, side = (texture) => ({ uv: [1, 0, 15, 16], texture });
    model(`pot/${name}`, tex, [
      { from: [1, 0, 1], to: [15, 16, 15], faces: {
        south: side("#front"), north: side("#back"), west: side("#left"), east: side("#right"),
        up: { uv: [0, 13 * k, 14 * k, 27 * k], texture: "#base" }, down: { uv: [14 * k, 13 * k, 28 * k, 27 * k], texture: "#base" },
      } },
      cube([4, 17, 4], [12, 20, 12], [0, 0], [8, 3, 8], potBase.size, { tex: "#base", skip: ["down"] }),
      cube([5, 16, 5], [11, 17, 11], [0, 5], [6, 1, 6], potBase.size, { tex: "#base", skip: ["up", "down"] }),
    ]);
    return Object.fromEntries(Object.entries(FACING_Y).map(([f, y]) => [`facing=${f}`, { model: `${GEN}:block/pot/${name}`, ...ys(y) }]));
  };
  if (potBase) {
    state("minecraft", "decorated_pot", await potModel("decorated_pot", ["brick", "brick", "brick", "brick"]));
    for (const d of designs.filter((x) => x.kind === "pot")) {
      const short = d.id.replace(`${GEN}:`, "");
      state(GEN, short, await potModel(short, d.sides));
    }
  }

  // the conduit, shut (ConduitRenderer's shell: a 6-texel cube at the block's middle)
  const conduit = await need("entity/conduit/base");
  if (conduit) {
    model("conduit", { particle: conduit.ref, t: conduit.ref }, [cube([5, 5, 5], [11, 11, 11], [0, 0], [6, 6, 6], conduit.size)]);
    state("minecraft", "conduit", { "": { model: `${GEN}:block/conduit` } });
  }

  // copper golem statues: the golem standing, in its copper's state (every pose shows standing)
  for (const [prefix, texName] of Object.entries({ "": "copper_golem", exposed_: "copper_golem_exposed", weathered_: "copper_golem_weathered", oxidized_: "copper_golem_oxidized" })) {
    const t = await need(`entity/copper_golem/${texName}`); if (!t) continue;
    const name = `${prefix}copper_golem_statue`;
    model(`statue/${name}`, { particle: t.ref, t: t.ref }, boxes(GOLEM, { c: [8, 24, 8] }, t.size));
    const variants = Object.fromEntries(Object.entries(FACING_Y).map(([f, y]) => [`facing=${f}`, { model: `${GEN}:block/statue/${name}`, ...ys(y) }]));
    state("minecraft", name, variants);
    state("minecraft", `waxed_${name}`, variants);
  }

  // the books: open on a lectern that has one (LecternRenderer; on its sloped top, turned as the top is) and over an
  // enchanting table (EnchantTableRenderer floats it open; here its two halves in a shallow V, spine north-south)
  const book = await need("entity/enchantment/enchanting_table_book");
  if (book) {
    const k = 16 / book.size, uv = (x0, y0, x1, y1) => [x0 * k, y0 * k, x1 * k, y1 * k];
    // a cover (the leather outside, regions at 0,0 and 16,0) and its pages (the white at 1,11 and 13,11) on it
    const half = (x0, x1, y, cover, pages, rotation) => [
      { from: [x0, y, 4], to: [x1, y + 0.25, 14], ...(rotation ? { rotation } : {}), faces: Object.fromEntries(["up", "down", "north", "south", "west", "east"].map((f) => [f, { uv: cover, texture: "#t" }])) },
      { from: [x0 + (x0 < 8 ? 1 : 0), y + 0.25, 5], to: [x1 - (x1 > 8 ? 1 : 0), y + 1.25, 13], ...(rotation ? { rotation } : {}), faces: {
        up: { uv: pages, texture: "#t" }, ...Object.fromEntries(["north", "south", "west", "east"].map((f) => [f, { uv: uv(1, 10, 6, 11), texture: "#t" }])),
      } },
    ];
    const slope = { origin: [8, 8, 8], axis: "x", angle: -22.5 };   // the lectern's top
    model("lectern_book", { particle: book.ref, t: book.ref }, [
      ...half(2, 8, 16, uv(0, 0, 6, 10), uv(1, 11, 6, 19), slope), ...half(8, 14, 16, uv(16, 0, 22, 10), uv(13, 11, 18, 19), slope),
    ]);
    model("enchanting_book", { particle: book.ref, t: book.ref }, [
      ...half(2, 8, 14, uv(0, 0, 6, 10), uv(1, 11, 6, 19), { origin: [8, 14, 8], axis: "z", angle: -22.5 }),
      ...half(8, 14, 14, uv(16, 0, 22, 10), uv(13, 11, 18, 19), { origin: [8, 14, 8], axis: "z", angle: 22.5 }),
    ]);
    const parts = [];
    for (const [f, y] of Object.entries({ north: 0, east: 90, south: 180, west: 270 })) {
      parts.push({ when: { facing: f }, apply: { model: "minecraft:block/lectern", ...ys(y) } });
      parts.push({ when: { facing: f, has_book: "true" }, apply: { model: `${GEN}:block/lectern_book`, ...ys(y) } });
    }
    zip.file("assets/minecraft/blockstates/lectern.json", JSON.stringify({ multipart: parts })); made++;
    zip.file("assets/minecraft/blockstates/enchanting_table.json", JSON.stringify({ multipart: [{ apply: { model: "minecraft:block/enchanting_table" } }, { apply: { model: `${GEN}:block/enchanting_book` } }] })); made++;
  }

  // the end portal (its view drawn at 12 texels up, seen from below at 6, as EndPortalRenderer does) and gateway
  const portal = await T.portal();
  if (portal) {
    const face = { uv: [0, 0, 16, 16], texture: "#t" };
    model("end_portal", { particle: "minecraft:block/obsidian", t: portal.ref }, [{ from: [0, 6, 0], to: [16, 12, 16], shade: false, faces: { up: face, down: face } }], { ambientocclusion: false });
    model("end_gateway", { particle: "minecraft:block/obsidian", t: portal.ref }, [{ from: [0, 0, 0], to: [16, 16, 16], shade: false, faces: Object.fromEntries(["up", "down", "north", "south", "east", "west"].map((f) => [f, face])) }], { ambientocclusion: false });
    state("minecraft", "end_portal", { "": { model: `${GEN}:block/end_portal` } });
    state("minecraft", "end_gateway", { "": { model: `${GEN}:block/end_gateway` } });
  } else missing.add("entity/end_portal/end_portal");

  return { made, missing: [...missing] };
}
