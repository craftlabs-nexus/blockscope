// What the merged pack generates because no jar has it: block models for the chests, and composite models for the
// framed drawers of the loaded schematic.
//
// Chests: vanilla 26.2 has no block model for any chest (a block-entity renderer draws them in game), and the
// renderer draws chests from the pack only (its blockEntityModels option stays empty). So the pack gets a blockstate
// per chest id with a single, a left-half and a right-half model built from the entity textures, so double chests
// join and copper chests show in their oxidation state.
//
// Framed drawers: the mod draws them in game from three materials the block entity names (side, trim, front),
// layering the raw drawer's sides, trim edges and front with each material's texture plus a translucent shading
// overlay (its models/block/framed/*.json, one "#mat" texture each). The page renders every framed cell as
// blockscope:framed_<kind>__<side>__<trim>__<front> (framed.js); this writes that blockstate and a composite model
// per material set the schematic uses, each material's texture taken from its own block model in the merged pack
// (all / side / end / particle, so a log shows its bark).
import { FRAMED_NS, matId } from "../framed.js";

const GEN = "blockscope";

/** Full resource location of a model or texture reference ("block/x" -> "minecraft:block/x"). */
export const loc = (ref) => (typeof ref !== "string" ? ref : ref.startsWith("#") || ref.includes(":") ? ref : `minecraft:${ref}`);
const split = (ref) => { const [ns, p] = loc(ref).split(":"); return [ns, p]; };
const sprite = (v) => (v && typeof v === "object" && typeof v.sprite === "string" ? v.sprite : v);

/** Writes the chest blockstates, models and textures into `zip`; returns how many chest ids it covers. */
export async function addChests(zip, clientZip) {
  const states = { "": "copper", exposed_: "copper_exposed", weathered_: "copper_weathered", oxidized_: "copper_oxidized" };
  const uv = (x0, y0, x1, y1) => [x0 / 4, y0 / 4, x1 / 4, y1 / 4]; // entity textures are 64×64 px; model UVs are 0..16
  // 1.15+ chest texture layout: latch at (0,0); lid box w×5×14 at tex (0,0); base box w×10×14 at tex (0,19); w = 14 for
  // a single chest, 15 for either half of a double (the half runs to the shared edge). Each box's faces as
  // ModelPart.Cube maps them (its polygons' vertices and UV corners), with the chest model upright (the lid above the
  // base, no flip): the region's first row lands at the box's bottom, so every side reads turned 180° next to a block
  // model's UV, and the top face takes the region the cube calls UP (u + d + w). The latch-shadow notches of the lid's
  // and base's front panels then meet at the latch, and a trapped chest's red rings the latch, on the front.
  const box = (from, to, u, v, w, h, d) => {
    const u0 = u, u1 = u + d, u2 = u + d + w, u3 = u + d + 2 * w, u4 = u + 2 * d + w, u5 = u + 2 * d + 2 * w;
    const v0 = v, v1 = v + d, v2 = v + d + h;
    return {
      from, to,
      faces: {
        up: { uv: uv(u2, v1, u3, v0), texture: "#t" },
        down: { uv: uv(u1, v0, u2, v1), texture: "#t" },
        north: { uv: uv(u2, v2, u1, v1), texture: "#t" },
        south: { uv: uv(u5, v2, u4, v1), texture: "#t" },
        west: { uv: uv(u1, v2, u0, v1), texture: "#t" },
        east: { uv: uv(u4, v2, u2, v1), texture: "#t" },
      },
    };
  };
  // Model space: front (latch) at +z, i.e. facing=south. The LEFT half's partner lies at facing.getClockWise(), for
  // south that is west (-x), so the left half runs x 0..15 with its latch on the seam at x 0..1; the right half runs
  // x 1..16, latch at x 15..16 (ChestModel's boxes).
  const models = {
    single: (tex, particle) => ({ textures: { particle, t: tex }, elements: [box([1, 0, 1], [15, 10, 15], 0, 19, 14, 10, 14), box([1, 9, 1], [15, 14, 15], 0, 0, 14, 5, 14), box([7, 7, 15], [9, 11, 16], 0, 0, 2, 4, 1)] }),
    left: (tex, particle) => ({ textures: { particle, t: tex }, elements: [box([0, 0, 1], [15, 10, 15], 0, 19, 15, 10, 14), box([0, 9, 1], [15, 14, 15], 0, 0, 15, 5, 14), box([0, 7, 15], [1, 11, 16], 0, 0, 1, 4, 1)] }),
    right: (tex, particle) => ({ textures: { particle, t: tex }, elements: [box([1, 0, 1], [16, 10, 15], 0, 19, 15, 10, 14), box([1, 9, 1], [16, 14, 15], 0, 0, 15, 5, 14), box([15, 7, 15], [16, 11, 16], 0, 0, 1, 4, 1)] }),
  };
  const ROT = { south: 0, west: 90, north: 180, east: 270 };
  let made = 0;
  // singleOnly: a chest that never joins (the ender chest)
  const emit = async (id, texBase, particle, singleOnly = false) => {
    const types = singleOnly ? ["single"] : ["single", "left", "right"];
    for (const type of types) {
      const srcName = type === "single" ? texBase : `${texBase}_${type}`;
      const src = clientZip.file(`assets/minecraft/textures/entity/chest/${srcName}.png`);
      if (!src) return;
      zip.file(`assets/${GEN}/textures/block/chest/${srcName}.png`, await src.async("uint8array"));
      zip.file(`assets/${GEN}/models/block/chest/${id}_${type}.json`, JSON.stringify(models[type](`${GEN}:block/chest/${srcName}`, particle)));
    }
    const variants = {};
    const v = (type, y) => (y ? { model: `${GEN}:block/chest/${id}_${type}`, y } : { model: `${GEN}:block/chest/${id}_${type}` });
    for (const [facing, y] of Object.entries(ROT)) {
      if (!singleOnly) for (const type of types) variants[`facing=${facing},type=${type}`] = v(type, y);
      variants[`facing=${facing}`] = v("single", y);
    }
    zip.file(`assets/minecraft/blockstates/${id}.json`, JSON.stringify({ variants }));
    made++;
  };
  const copperBlock = { "": "copper_block", exposed_: "exposed_copper", weathered_: "weathered_copper", oxidized_: "oxidized_copper" };
  for (const [prefix, texName] of Object.entries(states)) for (const waxed of ["", "waxed_"]) await emit(`${waxed}${prefix}copper_chest`, texName, `minecraft:block/${copperBlock[prefix]}`);
  await emit("chest", "normal", "minecraft:block/oak_planks");
  await emit("trapped_chest", "trapped", "minecraft:block/oak_planks");
  await emit("ender_chest", "ender", "minecraft:block/obsidian", true);
  return made;
}

/** Writes the framed drawers' blockstates and composite models for `combos` (Schematic.framedCombos()); returns
 *  how many it wrote and the materials it could not find. */
export async function addFramed(zip, combos) {
  const readJson = async (ns, path) => { const f = zip.file(`assets/${ns}/${path}`); if (!f) return null; try { return JSON.parse(await f.async("string")); } catch { return null; } };
  const RAW = "storagedrawers:block/drawers_raw_side";
  const missing = new Set();
  const texCache = new Map();
  async function materialTexture(mat) {
    if (!mat) return RAW;
    if (texCache.has(mat)) return texCache.get(mat);
    const [ns, name] = split(mat);
    const bs = await readJson(ns, `blockstates/${name}.json`);
    let model = null;
    if (bs?.variants) { const v = Object.values(bs.variants)[0]; model = (Array.isArray(v) ? v[0] : v)?.model; }
    else if (bs?.multipart?.length) { const a = bs.multipart[0].apply; model = (Array.isArray(a) ? a[0] : a)?.model; }
    // the model and its parents' textures, the child's winning
    let tex = {}, m = model ? loc(model) : null;
    for (let i = 0; i < 8 && m; i++) {
      const [mns, mp] = split(m);
      const j = await readJson(mns, `models/${mp}.json`); if (!j) break;
      tex = { ...Object.fromEntries(Object.entries(j.textures ?? {}).map(([k, v]) => [k, loc(sprite(v))])), ...tex };
      m = j.parent ? loc(j.parent) : null;
    }
    let t = tex.all ?? tex.side ?? tex.end ?? tex.top ?? tex.particle ?? Object.values(tex)[0] ?? null;
    for (let i = 0; i < 5 && typeof t === "string" && t.startsWith("#"); i++) t = tex[t.slice(1)];
    let out = typeof t === "string" ? t : RAW;
    const [tns, tp] = split(out);
    if (!zip.file(`assets/${tns}/textures/${tp}.png`)) { missing.add(mat); out = RAW; }
    texCache.set(mat, out);
    return out;
  }
  // the mod's layer models per kind: [model name, which material it takes ("shade": the overlay's own texture)]
  const layersOf = (kind) => {
    if (kind === "trim") return [["framed_trim_sides", "side"], ["framed_trim_trim", "trim"]];
    const [k, n] = kind.split("_"), half = k === "half" || k === "halfcomp", comp = k === "comp" || k === "halfcomp", d = half ? "half" : "full";
    return [[`framed_${d}_drawers_sides`, "side"], [`framed_${d}_drawers_trim_${n}`, "trim"], [`framed_${d}_drawers_front_${n}`, "front"], [comp ? `framed_${d}_compdrawers_${n}_front_shading_open1` : `framed_${d}_drawers_front_shading_${n}`, "shade"]];
  };
  let made = 0;
  for (const c of combos) {
    const textures = { side: await materialTexture(matId(c.side)), trim: await materialTexture(matId(c.trim)), front: await materialTexture(matId(c.front)) };
    textures.particle = textures.side;
    const elements = [];
    for (const [model, use] of layersOf(c.kind)) {
      const j = await readJson("storagedrawers", `models/block/framed/${model}.json`);
      if (!j) { missing.add(`storagedrawers:block/framed/${model}`); continue; }
      if (use === "shade") textures.shade = loc(sprite(j.textures?.mat) ?? "storagedrawers:block/overlay/shading_1");
      for (const el of j.elements ?? []) {
        const e = structuredClone(el);
        for (const f of Object.values(e.faces ?? {})) { if (f.texture === "#mat") f.texture = `#${use}`; delete f.cullface; }
        if (use === "shade") e.shade = false;
        elements.push(e);
      }
    }
    const short = c.id.replace(`${FRAMED_NS}:`, "");
    zip.file(`assets/${FRAMED_NS}/models/block/framed/${short}.json`, JSON.stringify({ ambientocclusion: false, textures, elements }));
    const ref = `${FRAMED_NS}:block/framed/${short}`, variants = {};
    if (c.kind === "trim") variants[""] = { model: ref };
    else for (const [facing, y] of Object.entries({ north: 0, east: 90, south: 180, west: 270 })) variants[`facing=${facing}`] = y ? { model: ref, y } : { model: ref };
    zip.file(`assets/${FRAMED_NS}/blockstates/${short}.json`, JSON.stringify({ variants }));
    made++;
  }
  return { made, missing: [...missing] };
}
