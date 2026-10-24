// The recipe book: what the materials list knows about items, read from the jars the pack is built from (the client
// jar and the mods' jars) while the pack is built, and kept inside the pack as blockscope-materials.json, so it is
// always the book of the jars that pack was made of. Nothing here is hand-written except the fallbacks for the
// conventional `c:` tags (Fabric API's, a jar the page never fetches) that mods use in their recipes.
//
// The book (version 1), every id with its namespace:
//   items:   { id: [name, icon] }      every item an items/<id>.json defines; the name from the jars' en_us.json;
//                                      icon: ["f", texture] for a flat item icon, ["c", top, left, right] for a block
//   recipes: { id: [[how, yield, [[ingredient, count], ...]], ...] }  how: craft, stonecut, smelt, smithing
//   tags:    { "#ns:path": [id, ...] } the item tags the recipes name, resolved, and the alternative lists that are no
//                                      tag ("#~" and their members joined with "|")
//   packs:   { id: block }             the 9-to-1 storage pairs (iron_ingot: iron_block, iron_nugget: iron_ingot)
//   blocks:  { block: [item, …] }      blocks no item of their name places, by their loot table (a crop's seed)
//   made:    { id: recipe type }       items only a recipe type the list does not follow makes (a mod's machine)
//   crops:   [id, ...]                 what a grown crop drops (by the loot tables' "age" conditions)

export const BOOK_FILE = "blockscope-materials.json";
export const BOOK_VERSION = 1;

const TYPES = {
  "minecraft:crafting_shaped": "craft", "minecraft:crafting_shapeless": "craft", "minecraft:crafting_transmute": "craft",
  "minecraft:stonecutting": "stonecut", "minecraft:smelting": "smelt", "minecraft:smithing_transform": "smithing",
};
const ns = (id) => (id.includes(":") ? id : `minecraft:${id}`);

// Conventional tags (`c:`) that no fetched jar defines: the vanilla items they stand for. A tag not listed here is
// guessed from its name (ingots/iron -> iron_ingot, dyes/red -> red_dye), and kept only when that item exists.
const CONVENTIONAL = {
  "c:rods/wooden": ["stick"], "c:chests/wooden": ["chest", "trapped_chest"], "c:chests": ["chest", "trapped_chest"],
  "c:chests/trapped": ["trapped_chest"], "c:barrels/wooden": ["barrel"], "c:barrels": ["barrel"], "c:string": ["string"],
  "c:strings": ["string"], "c:leathers": ["leather"], "c:leather": ["leather"], "c:slime_balls": ["slime_ball"], "c:slimeballs": ["slime_ball"],
  "c:glass_blocks": ["glass"], "c:glass_blocks/colorless": ["glass"], "c:glass_blocks/cheap": ["glass"], "c:glass_panes": ["glass_pane"],
  "c:glass_panes/colorless": ["glass_pane"], "c:stones": ["stone"], "c:cobblestones": ["cobblestone"], "c:cobblestones/normal": ["cobblestone"],
  "c:obsidians": ["obsidian"], "c:obsidians/normal": ["obsidian"], "c:gunpowders": ["gunpowder"], "c:feathers": ["feather"], "c:bones": ["bone"],
  "c:eggs": ["egg"], "c:ender_pearls": ["ender_pearl"], "c:sands": ["sand"], "c:sands/colorless": ["sand"], "c:gravels": ["gravel"],
  "c:fences/wooden": ["oak_fence"], "c:fence_gates/wooden": ["oak_fence_gate"], "c:player_workstations/crafting_tables": ["crafting_table"],
  "c:player_workstations/furnaces": ["furnace"], "c:bricks/normal": ["brick"], "c:bricks/nether": ["nether_brick"], "c:crops/wheat": ["wheat"],
  "c:wooden_rods": ["stick"], "c:rods/blaze": ["blaze_rod"], "c:rods/breeze": ["breeze_rod"], "c:buckets/empty": ["bucket"],
  "c:buckets/water": ["water_bucket"], "c:buckets/lava": ["lava_bucket"], "c:buckets/milk": ["milk_bucket"], "c:foods/milk": ["milk_bucket"],
  "c:dusts/glowstone": ["glowstone_dust"], "c:dusts/redstone": ["redstone"], "c:gems/lapis": ["lapis_lazuli"], "c:gems/quartz": ["quartz"],
  "c:gems/amethyst": ["amethyst_shard"], "c:storage_blocks/lapis": ["lapis_block"], "c:storage_blocks/quartz": ["quartz_block"],
  "c:storage_blocks/redstone": ["redstone_block"], "c:storage_blocks/slime": ["slime_block"], "c:storage_blocks/wheat": ["hay_block"],
  "c:dyes": ["white_dye", "orange_dye", "magenta_dye", "light_blue_dye", "yellow_dye", "lime_dye", "pink_dye", "gray_dye", "light_gray_dye", "cyan_dye", "purple_dye", "blue_dye", "brown_dye", "green_dye", "red_dye", "black_dye"],
  "c:shulker_boxes": ["shulker_box"], "c:flowers": ["dandelion", "poppy"], "c:mushrooms": ["brown_mushroom", "red_mushroom"],
  "c:ores": [], "c:nuggets": ["iron_nugget", "gold_nugget"], "c:ingots": ["iron_ingot", "gold_ingot", "copper_ingot"],
};
function guessConventional(tag, has) {
  const listed = CONVENTIONAL[tag]; if (listed) return listed.map(ns).filter(has);
  const m = tag.match(/^c:([a-z_]+)\/([a-z_]+)$/); if (!m) return [];
  const [, kind, mat] = m;
  const guess = { ingots: [`${mat}_ingot`], nuggets: [`${mat}_nugget`], gems: [mat], dusts: [mat, `${mat}_dust`], dyes: [`${mat}_dye`],
    storage_blocks: [`${mat}_block`], raw_materials: [`raw_${mat}`], glass_blocks: [`${mat}_stained_glass`], glass_panes: [`${mat}_stained_glass_pane`],
    concretes: [`${mat}_concrete`], concrete_powders: [`${mat}_concrete_powder`], glazed_terracottas: [`${mat}_glazed_terracotta`] }[kind] ?? [];
  return guess.map(ns).filter(has).slice(0, 1);
}

/** Reads every JSON file in the zips under `re` as [path, match, json], later zips after earlier ones. */
async function readJson(zips, re) {
  const out = [];
  for (const zip of zips) {
    for (const name of Object.keys(zip.files)) {
      const m = name.match(re); if (!m || zip.files[name].dir) continue;
      try { out.push([name, m, JSON.parse(await zip.file(name).async("string"))]); } catch { /* a file a mod ships broken */ }
    }
  }
  return out;
}

/**
 * Builds the book from the jars (JSZip instances), the client jar first. Recipes a mod ships for items no loaded jar
 * defines, or of a type the list cannot follow (a mod's machine, a special crafting), are left out.
 */
export async function buildBook(zips, { onProgress } = {}) {
  // items: every items/<id>.json; their names from en_us.json
  const itemDefs = new Map();
  for (const [, m, j] of await readJson(zips, /^assets\/([a-z0-9_.-]+)\/items\/([a-z0-9_./-]+)\.json$/)) itemDefs.set(`${m[1]}:${m[2]}`, j);
  const has = (id) => itemDefs.has(id);
  const lang = {};
  for (const [, , j] of await readJson(zips, /^assets\/[a-z0-9_.-]+\/lang\/en_us\.json$/)) Object.assign(lang, j);
  onProgress?.("reading the recipes: names and icons…");
  const models = new Map();
  for (const zip of zips) for (const name of Object.keys(zip.files)) {
    const m = name.match(/^assets\/([a-z0-9_.-]+)\/models\/([a-z0-9_./-]+)\.json$/);
    if (m && !models.has(`${m[1]}:${m[2]}`)) models.set(`${m[1]}:${m[2]}`, { zip, name });
  }
  const modelCache = new Map();
  const model = async (ref) => {
    const id = ns(ref);
    if (modelCache.has(id)) return modelCache.get(id);
    const at = models.get(id) ?? models.get(id.replace(":", ":block/")) ?? models.get(id.replace(":", ":item/"));
    let j = null; if (at) { try { j = JSON.parse(await at.zip.file(at.name).async("string")); } catch {} }
    modelCache.set(id, j); return j;
  };
  // a mod may name its blocks from templates: Storage Drawers' "block.storagedrawers.type.full_drawers_4" is
  // "%s Drawers 2x2" and "block.storagedrawers.mat.oak" is "Oak", for storagedrawers:oak_full_drawers_4
  const templates = new Map();
  for (const [k, v] of Object.entries(lang)) { const m = k.match(/^(?:block|item)\.([a-z0-9_.-]+)\.type\.([a-z0-9_]+)$/); if (m && v.includes("%s")) (templates.get(m[1]) ?? templates.set(m[1], []).get(m[1])).push([m[2], v]); }
  const templated = (n, p) => {
    for (const [suffix, t] of templates.get(n) ?? []) {
      if (!p.endsWith(`_${suffix}`)) continue;
      const mat = p.slice(0, -suffix.length - 1), mn = lang[`block.${n}.mat.${mat}`] ?? lang[`item.${n}.mat.${mat}`];
      if (mn) return t.replace("%s", mn);
    }
    return null;
  };
  const items = {};
  for (const [id, def] of itemDefs) {
    const [n, p] = id.split(":");
    const name = lang[`item.${n}.${p.replaceAll("/", ".")}`] ?? lang[`block.${n}.${p.replaceAll("/", ".")}`] ?? templated(n, p);
    items[id] = [name, await iconOf(def, model)];
  }

  // tags: merged in jar order (a `replace` starts over), then resolved
  const rawTags = new Map();
  for (const [, m, j] of await readJson(zips, /^data\/([a-z0-9_.-]+)\/tags\/items?\/([a-z0-9_./-]+)\.json$/)) {
    const key = `${m[1]}:${m[2]}`, values = (j.values ?? []).map((v) => (typeof v === "string" ? v : v?.id)).filter(Boolean);
    rawTags.set(key, j.replace || !rawTags.has(key) ? values : [...rawTags.get(key), ...values]);
  }
  const resolved = new Map();
  const resolveTag = (key, seen = new Set()) => {
    if (resolved.has(key)) return resolved.get(key);
    if (seen.has(key)) return [];
    seen.add(key);
    let out = [];
    for (const v of rawTags.get(key) ?? []) out.push(...(v.startsWith("#") ? resolveTag(v.slice(1), seen) : [ns(v)].filter(has)));
    if (!out.length && key.startsWith("c:")) out = guessConventional(key, has);
    out = [...new Set(out)];
    resolved.set(key, out); return out;
  };

  // a set of alternatives is keyed by its members, so the same set is one ingredient however a recipe spells it: the
  // named tag with exactly those members when there is one, else "#~" and the members
  const bySet = new Map();
  for (const key of [...rawTags.keys()].sort((a, b) => (a.startsWith("minecraft:") ? 0 : 1) - (b.startsWith("minecraft:") ? 0 : 1) || (a < b ? -1 : 1))) {
    const m = resolveTag(key); if (m.length > 1) { const k = [...m].sort().join("|"); if (!bySet.has(k)) bySet.set(k, `#${key}`); }
  }

  // recipes
  onProgress?.("reading the recipes…");
  const tags = {};
  const ingKey = (ing) => {
    // 1.21.2+: "id", "#tag" or ["id", ...]; older: { item } / { tag } or a list of those
    const list = (Array.isArray(ing) ? ing : [ing]).map((x) => (typeof x === "string" ? x : x?.item ?? (x?.tag ? `#${x.tag}` : null))).filter(Boolean);
    if (!list.length) return null;
    if (list.length === 1 && list[0].startsWith("#")) {
      const t = list[0].slice(1), members = resolveTag(t);
      if (!members.length) return null;
      if (members.length === 1) return members[0];
      const key = bySet.get([...members].sort().join("|")) ?? `#${t}`;
      tags[key] = resolveTag(key.slice(1)).length ? resolveTag(key.slice(1)) : members; return key;
    }
    const ids = [...new Set(list.flatMap((x) => (x.startsWith("#") ? resolveTag(x.slice(1)) : [ns(x)].filter(has))))];
    if (!ids.length) return null;
    if (ids.length === 1) return ids[0];
    const set = [...ids].sort().join("|"), key = bySet.get(set) ?? `#~${set}`;
    tags[key] = key.startsWith("#~") ? ids : resolveTag(key.slice(1));
    return key;
  };
  // what a recipe of a kind the list does not follow makes (a mod's cutting board or cooking pot): such an item is
  // got from that machine, never counted as free
  const made = {};
  // a result as recipes spell it: "id", { id }, { item }, a list of those (a mod's machine), { item: { id } }
  const resultOf = (r) => {
    let x = r?.result ?? r?.results ?? r?.output;
    if (Array.isArray(x)) x = x[0];
    if (x && typeof x.item === "object") x = x.item;
    const id = typeof x === "string" ? x : x?.id ?? x?.item;
    return typeof id === "string" ? ns(id) : null;
  };
  const recipes = {}, seen = new Set();
  for (const [, , r] of await readJson(zips, /^data\/[a-z0-9_.-]+\/recipes?\/.+\.json$/)) {
    const how = TYPES[r?.type], out = resultOf(r);
    if (!out || !has(out)) continue;
    // (a mod's machine marks only the mod's own items: a mill that also makes gravel says nothing about gravel)
    if (!how) { if (typeof r?.type === "string" && !/^minecraft:/.test(r.type) && r.type.split(":")[0] === out.split(":")[0]) made[out] ??= r.type; continue; }
    const yieldN = Number(typeof r.result === "object" ? r.result.count ?? 1 : r.count ?? 1) || 1;
    const counts = new Map(); let ok = true;
    const take = (ing, n = 1) => { const k = ingKey(ing); if (!k) { ok = false; return; } counts.set(k, (counts.get(k) ?? 0) + n); };
    if (r.type === "minecraft:crafting_shaped") {
      const tally = {}; for (const row of r.pattern ?? []) for (const ch of row) if (ch !== " ") tally[ch] = (tally[ch] ?? 0) + 1;
      for (const [ch, n] of Object.entries(tally)) { if (!(ch in (r.key ?? {}))) { ok = false; break; } take(r.key[ch], n); }
    } else if (r.type === "minecraft:crafting_shapeless") for (const ing of r.ingredients ?? []) take(ing);
    else if (r.type === "minecraft:crafting_transmute") { take(r.input); take(r.material); }
    else if (r.type === "minecraft:smithing_transform") { take(r.template); take(r.base); take(r.addition); }
    else take(r.ingredient);
    if (!ok || !counts.size) continue;
    const ins = [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const sig = `${out}|${how}|${yieldN}|${JSON.stringify(ins)}`;
    if (seen.has(sig)) continue; seen.add(sig);
    (recipes[out] ??= []).push([how, yieldN, ins]);
  }

  // blocks with no item of their own name (a crop, a potted plant, a mod's technical block): what their loot table
  // drops, the seed when it drops one (a crop is planted from it), every item for a pot (the pot and the plant)
  // What a crop yields once grown (an entry under an "age" condition: carrots, a mod's cabbages) is gathered, whatever
  // recipes a mod also gives it (cabbage from cabbage leaves), so it is never made of anything.
  const blocks = {}, crops = new Set();
  for (const [, m, j] of await readJson(zips, /^data\/([a-z0-9_.-]+)\/loot_tables?\/blocks\/([a-z0-9_./-]+)\.json$/)) {
    const id = `${m[1]}:${m[2]}`;
    const names = [];
    const aged = (e) => (e?.conditions ?? []).some((c) => c?.condition === "minecraft:block_state_property" && c.properties && "age" in c.properties);
    const walk = (e, d = 0, grown = false) => {
      if (!e || typeof e !== "object" || d > 10) return;
      grown ||= aged(e);
      if (e.type === "minecraft:item" && typeof e.name === "string" && has(ns(e.name))) { names.push(ns(e.name)); if (grown) crops.add(ns(e.name)); }
      for (const k of ["entries", "children", "pools"]) for (const c of Array.isArray(e[k]) ? e[k] : []) walk(c, d + 1, grown);
    };
    walk(j);
    if (has(id)) continue;
    const uniq = [...new Set(names)]; if (!uniq.length) continue;
    const seed = uniq.find((x) => /_(seeds?|pod|sapling|spores?|bulb|berries|beans|cuttings?)$/.test(x));
    blocks[id] = seed ? [seed] : m[2].startsWith("potted_") ? uniq : [uniq[0]];
  }

  // 9-to-1 storage pairs: nine of one item make a block that makes nine again
  const packs = {};
  for (const [out, list] of Object.entries(recipes)) for (const [how, y, ins] of list) {
    if (how !== "craft" || y !== 1 || ins.length !== 1 || ins[0][1] !== 9 || ins[0][0].startsWith("#")) continue;
    const item = ins[0][0];
    if ((recipes[item] ?? []).some(([h, yy, ii]) => h === "craft" && yy === 9 && ii.length === 1 && ii[0][0] === out && ii[0][1] === 1)) packs[item] = out;
  }
  for (const id of Object.keys(made)) if (recipes[id]) delete made[id];
  return { v: BOOK_VERSION, items, recipes, tags, packs, blocks, made, crops: [...crops].sort() };
}

// ---- icons --------------------------------------------------------------------------------------------------------
// An item's icon from its item model definition: the first model it names (a select's fallback, a special model's
// base), its parent chain followed for textures. A generated item model is flat (layer0); anything else is drawn as a
// block, top and two sides.
function firstModelRef(def) {
  const walk = (m, depth = 0) => {
    if (!m || typeof m !== "object" || depth > 8) return null;
    if (m.type === "minecraft:special" && typeof m.base === "string") return m.base;
    if (typeof m.model === "string") return m.model;
    for (const k of ["fallback", "model", "on_true", "on_false"]) { const r = walk(m[k], depth + 1); if (r) return r; }
    for (const k of ["cases", "entries", "models"]) for (const c of Array.isArray(m[k]) ? m[k] : []) { const r = typeof c?.model === "string" ? c.model : walk(c?.model ?? c, depth + 1); if (r) return r; }
    return null;
  };
  return walk(def?.model);
}
async function iconOf(def, model) {
  const ref = firstModelRef(def); if (!ref) return null;
  const textures = {}; let generated = false, depth = 0;
  for (let cur = ref; cur && depth < 10; depth++) {
    if (/^(minecraft:)?(item\/generated|item\/handheld[a-z_]*|builtin\/generated)$/.test(cur)) { generated = true; break; }
    const j = await model(cur); if (!j) break;
    for (const [k, v] of Object.entries(j.textures ?? {})) if (!(k in textures)) textures[k] = v;
    if (/^(minecraft:)?item\/(generated|handheld)/.test(j.parent ?? "")) { generated = true; break; }
    cur = j.parent;
  }
  // a texture is a path, "#another", or (26.x) { sprite, force_translucent }
  const val = (v) => (v && typeof v === "object" ? v.sprite : v);
  const tex = (k, n = 0) => { let v = val(textures[k]); while (typeof v === "string" && v.startsWith("#") && n++ < 8) v = val(textures[v.slice(1)]); return typeof v === "string" ? ns(v) : null; };
  if (generated && tex("layer0")) return ["f", tex("layer0")];
  const top = tex("up") ?? tex("top") ?? tex("end") ?? tex("all") ?? tex("texture") ?? tex("particle");
  const left = tex("front") ?? tex("north") ?? tex("side") ?? tex("all") ?? tex("texture") ?? tex("particle");
  const right = tex("east") ?? tex("side") ?? tex("all") ?? tex("texture") ?? tex("particle");
  if (!top && !left) return tex("layer0") ? ["f", tex("layer0")] : null;
  return ["c", top ?? left, left ?? top, right ?? left ?? top];
}
