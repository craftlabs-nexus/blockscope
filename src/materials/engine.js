// The materials list, worked out from the schematic in memory and the recipe book (book.js): which item each block
// is placed from, how many of each the blocks in view take, and what those items are made of. No DOM here, so the
// tests run it in node.
//
// Counting: one item per block, except where the game says otherwise (blockItems): a wall sign is a sign, dust is
// redstone, a door or a bed is one item for two blocks, a double slab two slabs, a candle block up to four candles,
// a water cauldron a cauldron and a bucket. Water and lava sources are kept apart (fluids), blocks no item places
// (fire, a piston's head) are skipped, and a block with no item the list can find is reported (unknown), never
// dropped. Signs add their dye, glow ink and wax; a framed drawer its three framing materials.
//
// Rolling up (plan): demand flows down the recipe graph in dependency order, as a crafting planner does it. For each
// item, what is still needed is its demand less what the person has of it; if the item is broken down, that many are
// crafted (rounded up to whole crafts, the spare kept) and its ingredients' demand grows by as much. What is not
// broken down is on the list. So having two iron blocks of the twelve four anvils take means 90 fewer ingots to get.

export const SHULKER = 27, INVENTORY = 36;
const AIR = /^minecraft:(cave_|void_)?air$/;
const path = (id) => id.replace(/^[^:]*:/, "");
const nsOf = (id) => (id.includes(":") ? id.split(":")[0] : "minecraft");

// ---- blocks to items ------------------------------------------------------------------------------------------------
// Blocks that are placed from an item of another name, or from none.
const PLACED_FROM = {
  redstone_wire: "redstone", tripwire: "string", wall_torch: "torch", soul_wall_torch: "soul_torch", redstone_wall_torch: "redstone_torch",
  copper_wall_torch: "copper_torch", carrots: "carrot", potatoes: "potato", beetroots: "beetroot_seeds", wheat: "wheat_seeds",
  melon_stem: "melon_seeds", attached_melon_stem: "melon_seeds", pumpkin_stem: "pumpkin_seeds", attached_pumpkin_stem: "pumpkin_seeds",
  cocoa: "cocoa_beans", sweet_berry_bush: "sweet_berries", cave_vines: "glow_berries", cave_vines_plant: "glow_berries", kelp_plant: "kelp",
  twisting_vines_plant: "twisting_vines", weeping_vines_plant: "weeping_vines", bamboo_sapling: "bamboo", big_dripleaf_stem: "big_dripleaf",
  torchflower_crop: "torchflower_seeds", pitcher_crop: "pitcher_pod", tall_seagrass: "seagrass", powder_snow: "powder_snow_bucket",
  dirt_path: "dirt", farmland: "dirt", frogspawn: null, fire: null, soul_fire: null, nether_portal: null, end_portal: null, end_gateway: null,
  piston_head: null, moving_piston: null, frosted_ice: null, bubble_column: null, light: null, structure_void: null,
};
const CAULDRONS = { water_cauldron: "water_bucket", lava_cauldron: "lava_bucket", powder_snow_cauldron: "powder_snow_bucket" };
// a state that holds several items in one block
const MANY = [["candles", /candle$/], ["pickles", /^sea_pickle$/], ["eggs", /turtle_egg$/], ["layers", /^snow$/], ["flower_amount", /./], ["segment_amount", /./]];

const parseKey = (key) => {
  const m = key.match(/^([^[]+)(?:\[(.*)\])?$/); const id = m ? m[1] : key;
  const props = {}; for (const kv of (m?.[2] ?? "").split(",")) { if (!kv) continue; const [k, v] = kv.split("="); props[k] = v; }
  return { id: id.includes(":") ? id : `minecraft:${id}`, props };
};

/**
 * The items a block (a palette key, "id[state]") is placed from: { items: [[item, n], …] }, { fluid: item } for a
 * water or lava source, null for a block no item places (air, the upper half of a door, fire), or { unknown: id }.
 * `has(item)` says whether the book knows an item; without a book every id is taken as its own item.
 */
export function blockItems(key, lookup = () => true) {
  // lookup: has(item), or { has, from } where from(block) is what the book's loot tables say places it
  const { has = () => true, from = null } = typeof lookup === "function" ? { has: lookup } : lookup ?? {};
  const { id, props } = parseKey(key), p = path(id), mc = nsOf(id) === "minecraft";
  if (AIR.test(id)) return null;
  if (mc && (p === "water" || p === "lava")) return (props.level ?? "0") === "0" ? { fluid: `minecraft:${p}_bucket` } : null;
  // the second block of a two-block item: a door's or tall plant's upper half, a bed's head
  if (props.half === "upper" || (props.part === "head" && /_bed$/.test(p))) return null;
  if (mc && p in CAULDRONS) return { items: [["minecraft:cauldron", 1], [`minecraft:${CAULDRONS[p]}`, 1]] };
  if (mc && p in PLACED_FROM) { const it = PLACED_FROM[p]; return it ? { items: [[`minecraft:${it}`, 1]] } : null; }
  if (props.type === "double" && /_slab$/.test(p)) return { items: [[id, 2]] };
  let n = 1;
  for (const [k, re] of MANY) if (props[k] !== undefined && re.test(p) && Number(props[k]) > 0) { n = Number(props[k]); break; }
  if (has(id)) return { items: [[id, n]] };
  const dropped = from?.(id); if (dropped?.length) return { items: dropped.map((it) => [it, dropped.length > 1 ? 1 : n]) };
  // a wall variant is its standing item: dark_oak_wall_sign, skeleton_wall_skull, white_wall_banner, tube_coral_wall_fan
  if (p.includes("_wall_")) { const s = id.replace("_wall_", "_"); if (has(s)) return { items: [[s, n]] }; }
  if (p.startsWith("wall_")) { const s = id.replace(":wall_", ":"); if (has(s)) return { items: [[s, n]] }; }
  // a potted plant: the pot and the plant
  if (p.startsWith("potted_")) {
    const plant = id.replace(":potted_", ":"), alt = plant.replace(/_bush$/, "");
    const it = has(plant) ? plant : has(alt) ? alt : null;
    if (it) return { items: [["minecraft:flower_pot", 1], [it, 1]] };
  }
  // a mod's "<name>_block" or crop: the item it is named after
  for (const s of [id.replace(/_block$/, ""), id.replace(/_crop$/, "_seeds"), id.replace(/_plant$/, "")]) if (s !== id && has(s)) return { items: [[s, n]] };
  return { unknown: id };
}

// ---- counting what is in view ---------------------------------------------------------------------------------------
const DYE = (c) => `minecraft:${c}_dye`;
/**
 * Counts the blocks of `schem` in the scope ({ lo, hi } file layers, `hidden` block indices), split into groups when
 * `groupOf(i)` names one per block index. Per group: placed (item -> n), extras ([{ item, n, from, why }]: a sign's
 * dye, glow ink and wax, a framed drawer's materials), fluids (bucket -> sources), unknown (block id -> n), blocks.
 * `framed` is the schematic's framed cells, [[index, id, blockEntity], …], and `matItem(token)` turns a framing
 * material into its item. `has(item)` says whether an item exists; `lookup` (blockItems') may add the book's blocks.
 */
export function countScope(schem, { lo = 0, hi = schem.height - 1, hidden = new Set(), has, lookup = has, groupOf = null, framed = [], matItem = null } = {}) {
  const per = schem.perLayer, start = Math.max(0, lo) * per, end = Math.min(schem.height, hi + 1) * per;
  const tallies = new Map();   // group -> Int32Array over the palette
  const tally = (g) => { let t = tallies.get(g); if (!t) { t = new Int32Array(schem.keys.length); tallies.set(g, t); } return t; };
  const inScope = (i) => i >= start && i < end && !hidden.has(i) && !schem.air.has(schem.data[i]);
  const all = groupOf ? null : tally("all");
  for (let i = start; i < end && i < schem.data.length; i++) {
    const p = schem.data[i]; if (schem.air.has(p) || hidden.has(i)) continue;
    (all ?? tally(groupOf(i) ?? "")) [p]++;
  }
  const itemsOf = paletteItems(schem, lookup ?? (() => true));
  const groups = new Map();
  const group = (g) => { let o = groups.get(g); if (!o) { o = { key: g, placed: new Map(), extras: [], fluids: new Map(), unknown: new Map(), blocks: 0 }; groups.set(g, o); } return o; };
  const add = (m, k, n) => m.set(k, (m.get(k) ?? 0) + n);
  for (const [g, t] of tallies) {
    const o = group(g);
    for (let p = 0; p < t.length; p++) {
      const n = t[p]; if (!n) continue;
      o.blocks += n;
      const r = itemsOf[p];
      if (!r) continue;
      if (r.fluid) add(o.fluids, r.fluid, n);
      else if (r.unknown) add(o.unknown, r.unknown, n);
      else for (const [item, k] of r.items) add(o.placed, item, n * k);
    }
  }
  // signs: dye on a side that is not black, glow ink, wax
  for (const s of schem.signs ?? []) {
    const i = schem.index(s.x, s.y, s.z); if (!inScope(i)) continue;
    const o = group(groupOf ? groupOf(i) ?? "" : "all"), from = itemsOf[schem.data[i]]?.items?.[0]?.[0] ?? s.id;
    for (const side of [s, s.back].filter(Boolean)) {
      if (!side.lines?.some(Boolean)) continue;
      if (side.color && side.color !== "black") o.extras.push({ item: DYE(side.color), n: 1, from, why: "sign text colour" });
      if (side.glow) o.extras.push({ item: "minecraft:glow_ink_sac", n: 1, from, why: "glowing sign text" });
    }
    if (s.waxed) o.extras.push({ item: "minecraft:honeycomb", n: 1, from, why: "waxed sign" });
  }
  // framed drawers and trim: one of each framing material, on the framing table
  let firstFramed = null;   // the group of the first framed block, where the one framing table is listed
  for (const [i, id, mats] of framed) {
    if (!inScope(i)) continue;
    const o = group(groupOf ? groupOf(i) ?? "" : "all");
    for (const t of [mats.side, mats.trim, mats.front]) { const it = t && matItem?.(t); if (it) { o.extras.push({ item: it, n: 1, from: id, why: "framing material" }); firstFramed ??= o; } }
  }
  if (firstFramed && has?.("storagedrawers:framing_table")) firstFramed.extras.push({ item: "storagedrawers:framing_table", n: 1, from: "storagedrawers:framing_table", why: "one framing table for all of them" });
  for (const o of groups.values()) o.extras = mergeExtras(o.extras);
  return groups;
}
function mergeExtras(list) {
  const m = new Map();
  for (const e of list) { const k = `${e.item}|${e.from}|${e.why}`; const x = m.get(k); if (x) x.n += e.n; else m.set(k, { ...e }); }
  return [...m.values()];
}
const paletteCache = new WeakMap();
/** blockItems for each palette entry of a schematic, once per schematic and book. */
export function paletteItems(schem, lookup) {
  let c = paletteCache.get(schem);
  if (!c || c.lookup !== lookup) { c = { lookup, items: schem.keys.map((k) => (k ? blockItems(k, lookup) : null)) }; paletteCache.set(schem, c); }
  return c.items;
}

// ---- the book, ready to plan with ---------------------------------------------------------------------------------
// Recipes the jars do not have as JSON: copper weathering, concrete powder setting in water, an axe stripping a log.
const STEP = { stonecut: 0.01, oxidize: 0.02, water: 0.02, axe: 0.02, craft: 0.05, framing: 0.05, smithing: 0.1, smelt: 0.5 };
export const HOW = { craft: "crafting table", stonecut: "stonecutter", smelt: "furnace", smithing: "smithing table", oxidize: "weathers over time", water: "water", axe: "an axe", framing: "framing table" };
// What a person gathers rather than makes, whatever recipes the jars have for it (andesite from diorite, leather from
// rabbit hide, an ingot from nuggets): mined, grown, dropped or smelted from ore.
const NATURAL = /^minecraft:(cobblestone|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|blackstone|basalt|netherrack|end_stone|sand|red_sand|gravel|dirt|coarse_dirt|rooted_dirt|mud|clay_ball|clay|snowball|ice|obsidian|crying_obsidian|quartz|diamond|emerald|coal|lapis_lazuli|redstone|amethyst_shard|glowstone_dust|bamboo|sugar_cane|cactus|vine|moss_block|wheat|string|leather|slime_ball|honeycomb|prismarine_shard|prismarine_crystals|soul_sand|soul_soil|magma_block|bone|feather|gunpowder|ender_pearl|blaze_rod|breeze_rod|ink_sac|glow_ink_sac|egg|kelp|seagrass|lily_pad|pumpkin|melon_slice|apple|cocoa_beans|sweet_berries|glow_berries|nether_wart|netherite_scrap|raw_iron|raw_gold|raw_copper|flint|sponge|nautilus_shell|heart_of_the_sea|shulker_shell|phantom_membrane|rabbit_hide|armadillo_scute|turtle_scute|resin_clump|pointed_dripstone|amethyst_block|honey_bottle|.*_mushroom|.*_sapling|.*_tulip|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|torchflower|pitcher_plant)$|^(?![^:]*:stripped_).*_(ingot|log|stem)$/;
const isNatural = (id) => NATURAL.test(id);
/** The book with the recipes the jars leave out, the preferred recipe of each item (`best`) and its cost. */
export function prepareBook(raw) {
  const book = { ...raw, recipes: { ...raw.recipes } };
  const has = (id) => id in book.items;
  const addSynthetic = (out, how, from) => { if (has(out) && has(from) && !(book.recipes[out] ?? []).some((r) => r[0] === how)) book.recipes[out] = [...(book.recipes[out] ?? []), [how, 1, [[from, 1]]]]; };
  for (const id of Object.keys(book.items)) {
    const [n, p] = id.split(":");
    const ox = p.match(/^(exposed|weathered|oxidized)_(.+)$/);
    if (ox) addSynthetic(id, "oxidize", `${n}:${ox[1] === "exposed" ? (ox[2] === "copper" ? "copper_block" : ox[2]) : `${ox[1] === "weathered" ? "exposed" : "weathered"}_${ox[2]}`}`);
    if (/_concrete$/.test(p)) addSynthetic(id, "water", `${id}_powder`);
    if (p.startsWith("stripped_")) addSynthetic(id, "axe", id.replace(":stripped_", ":"));
    // a framed drawer or trim is a plain one put through the framing table (its materials are counted per block)
    if (n === "storagedrawers" && p.startsWith("framed_")) { const rest = p.slice(7); addSynthetic(id, "framing", has(`${n}:oak_${rest}`) ? `${n}:oak_${rest}` : `${n}:${rest}`); }
  }
  // costs: an item no recipe makes costs 1, and so does one a person gathers rather than makes (cobblestone, andesite,
  // logs, ingots: they have recipes, but nobody crafts andesite from diorite); a recipe costs its ingredients over its
  // yield plus a little per step (the stonecutter least, the furnace most), so storage blocks never undo themselves and
  // the stonecutter wins a tie. Items left in a loop with no way in (deepslate and cobbled deepslate make each other)
  // are taken as gathered, and the rest worked out again from them.
  const cost = new Map(), best = {};
  const ingCost = (k) => (k.startsWith("#") ? Math.min(...(book.tags[k] ?? []).map((m) => cost.get(m) ?? Infinity)) : cost.get(k) ?? (book.recipes[k] ? Infinity : 1));
  for (const id of Object.keys(book.items)) if (!book.recipes[id] || isNatural(id)) cost.set(id, 1);
  const relax = () => {
    for (let pass = 0, changed = true; changed && pass < 60; pass++) {
      changed = false;
      for (const [id, list] of Object.entries(book.recipes)) {
        if (isNatural(id)) continue;
        let c = cost.get(id) ?? Infinity, b = best[id];
        list.forEach(([how, y, ins], i) => { const v = ins.reduce((s, [k, n]) => s + ingCost(k) * n, 0) / y + (STEP[how] ?? 0.1); if (v < c - 1e-9) { c = v; b = i; } });
        if (b !== best[id]) { best[id] = b; changed = true; }
        if (c !== cost.get(id)) { cost.set(id, c); changed = true; }
      }
    }
  };
  relax();
  for (let round = 0; round < 8; round++) {
    // the stuck items no other stuck item needs first: a loop's members that something outside it is made from
    const stuck = Object.keys(book.recipes).filter((id) => id in book.items && !Number.isFinite(cost.get(id) ?? Infinity));
    if (!stuck.length) break;
    for (const id of stuck) cost.set(id, 3);
    relax();
  }
  book.best = best; book.cost = cost;
  return book;
}

// ---- names, stacks, packing ---------------------------------------------------------------------------------------
const humanize = (s) => s.replace(/^.*[:/]/, "").replaceAll("_", " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** An item's or a tag's display name. */
export function nameOf(id, book) {
  if (id.startsWith("#~")) { const m = book?.tags?.[id] ?? []; return m.slice(0, 2).map((x) => nameOf(x, book)).join(" or ") + (m.length > 2 ? " or …" : ""); }
  if (id.startsWith("#")) {
    // a short tag reads as its members ("Sand or Red Sand"), a long one as what it is ("Planks (any)")
    const m = book?.tags?.[id] ?? [];
    if (m.length >= 2 && m.length <= 3) { const names = m.map((x) => nameOf(x, book)); return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`; }
    return `${humanize(id.slice(1))} (any)`;
  }
  return book?.items?.[id]?.[0] ?? humanize(id);
}
const STACK1 = /(_sword|_pickaxe|_axe|_shovel|_hoe|_spear|_helmet|_chestplate|_leggings|_boots|_armor|_bucket|_boat|_raft|minecart|_bed|shulker_box|_banner_pattern|_stew|_soup|_harness)$|^(elytra|shield|trident|bow|crossbow|mace|fishing_rod|carrot_on_a_stick|warped_fungus_on_a_stick|flint_and_steel|shears|brush|spyglass|saddle|totem_of_undying|potion|splash_potion|lingering_potion|enchanted_book|writable_book|knowledge_book|cake|bundle|.*_bundle|goat_horn|debug_stick|framing_table|drawer_key|.*_key)$|^music_disc_/;
const STACK16 = /(_sign|_hanging_sign|_banner)$|^(ender_pearl|egg|blue_egg|brown_egg|snowball|honey_bottle|armor_stand|bucket|written_book)$/;
/** How many of an item stack in a slot: 1, 16 or 64 (the game keeps this in code, so it is a list here). */
export function stackOf(id) {
  if (id.startsWith("#")) return 64;
  const p = path(id);
  if (p === "milk_bucket" || p === "bucket") return p === "bucket" ? 16 : 1;
  return STACK1.test(p) ? 1 : STACK16.test(p) ? 16 : 64;
}
const fmt = (n) => Math.round(n).toLocaleString("en-US");
/** n of an item as items, stacks ("11×64 + 45") or shulker boxes ("2 sb + 5×64 + 3"); with `compact` an item that
 *  has a 9-to-1 block counts in blocks ("13 blocks + 7"). */
export function packText(n, id, { units = "items", compact = false, book = null } = {}) {
  if (n <= 0) return "0";
  if (compact && book?.packs?.[id] && n >= 9) { const b = Math.floor(n / 9), r = n % 9; return `${packText(b, book.packs[id], { units: units === "items" ? "items" : units })} ${b === 1 ? "block" : "blocks"}${r ? ` + ${r}` : ""}`; }
  const s = stackOf(id);
  if (units === "items") return fmt(n);
  if (s === 1) return `${fmt(n)} × 1`;
  const q = Math.floor(n / s), r = n % s;
  if (units === "stacks" || q < SHULKER) return q ? `${q}×${s}${r ? ` + ${r}` : ""}` : `${r}`;
  const sb = Math.floor(q / SHULKER), qs = q % SHULKER;
  return [`${sb} sb`, qs ? `${qs}×${s}` : "", r ? `${r}` : ""].filter(Boolean).join(" + ");
}
/** A have value as typed: "120", "2s" (stacks), "1sb" (shulker boxes), "3b" (9-to-1 blocks), "2s + 5". */
export function parseHave(text, id, book = null) {
  const s = String(text ?? "").trim().toLowerCase().replaceAll(",", "");
  if (!s) return 0;
  let total = 0;
  for (const part of s.split("+")) {
    const m = part.trim().match(/^(\d+(?:\.\d+)?)\s*(sb|shulkers?|s|st|stacks?|b|blocks?)?$/);
    if (!m) return null;
    const n = Number(m[1]), u = m[2] ?? "";
    total += /^(sb|shulker)/.test(u) ? n * SHULKER * stackOf(id) : /^s/.test(u) ? n * stackOf(id) : /^b/.test(u) ? n * (book?.packs?.[id] ? 9 : 1) : n;
  }
  return Math.round(total);
}

// ---- rolling up ---------------------------------------------------------------------------------------------------
// What each rollup breaks down. Gather: what is crafted at a table, cut, smithed, weathered, set in water or
// stripped, down to what a person goes and gets (smelted things, ingots, dyes, planks, wool, paper). Raw: everything a
// recipe makes, down to what is mined, grown or dropped; ingots, gems, dusts and dyes stay as they are.
const GATHER_HOW = new Set(["craft", "stonecut", "smithing", "oxidize", "water", "axe", "framing"]);
const GATHER_STOP = /(_ingot|_nugget|_dye|_planks|_wool)$|^(diamond|emerald|lapis_lazuli|quartz|amethyst_shard|redstone|glowstone_dust|coal|charcoal|string|leather|paper|slime_ball|honeycomb|bone_meal|sugar|wheat|bamboo|blaze_powder|gunpowder)$/;
const RAW_STOP = /(_ingot|_nugget|_dye)$|^(diamond|emerald|lapis_lazuli|quartz|amethyst_shard|redstone|coal|charcoal|netherite_scrap|leather|glowstone_dust|blaze_powder)$/;
export const PRESETS = ["placed", "gather", "raw"];

/** The recipe an item is made with here: the one picked by hand, else the book's best; [how, yield, ingredients]. */
export function recipeOf(book, id, pick = {}) {
  const list = book?.recipes?.[id]; if (!list?.length) return null;
  const i = pick[id] ?? book.best?.[id];
  return i === undefined ? null : list[i] ?? null;
}
/** A tag's stand-in: the member placed most in the file (`prefer`), else its cheapest. */
export function memberOf(book, tag, prefer = null) {
  const m = book?.tags?.[tag] ?? []; if (!m.length) return null;
  if (prefer) { let best = null, n = 0; for (const x of m) { const c = prefer.get(x) ?? 0; if (c > n) { n = c; best = x; } } if (best) return best; }
  let best = m[0], c = Infinity; for (const x of m) { const v = book.cost?.get(x) ?? 1; if (v < c - 1e-9) { c = v; best = x; } }
  return best;
}
/** Whether an item is broken down into its ingredients under a rollup: a choice made by hand wins. */
export function brokenDown(book, id, { preset = "gather", open = {}, pick = {}, prefer = null } = {}) {
  const real = id.startsWith("#") ? memberOf(book, id, prefer) : id;
  const r = real && recipeOf(book, real, pick); if (!r) return false;
  if (id in open) return !!open[id];
  if (preset === "placed") return false;
  const p = path(real);
  if (preset === "gather") return GATHER_HOW.has(r[0]) && !GATHER_STOP.test(p);
  return !RAW_STOP.test(p);
}

/**
 * The plan for a demand ([{ item, n, from }], `from` the placed item it is for): nodes by item, each { id, gross
 * (needed in all), have, net (still to get), broken (broken down here), crafts, spare, recipe, member (a tag's
 * stand-in) }, `order` (dependency order: every item before its ingredients), `uses` (item -> Map(parent -> n)) and
 * `roots` (item -> Set of the placed items it goes into). have: item -> n; done: item -> true (all of it in hand).
 */
export function plan(book, demand, opts = {}) {
  const { have = {}, done = {}, pick = {}, prefer = null } = opts;
  const need = new Map(), uses = new Map(), roots = new Map();
  const addRoot = (id, r) => { let s = roots.get(id); if (!s) roots.set(id, (s = new Set())); s.add(r); };
  for (const d of demand) { if (!d.n) continue; need.set(d.item, (need.get(d.item) ?? 0) + d.n); addRoot(d.item, d.from ?? d.item); if (d.from && d.from !== d.item) { let u = uses.get(d.item); if (!u) uses.set(d.item, (u = new Map())); u.set(d.from, (u.get(d.from) ?? 0) + d.n); } }
  const isBroken = (id) => brokenDown(book, id, opts);
  const ingredients = (id) => { const real = id.startsWith("#") ? memberOf(book, id, prefer) : id; return recipeOf(book, real, pick)?.[2] ?? []; };
  // dependency order over the edges that are followed (a cycle's back edge is left out)
  const order = [], state = new Map();
  const visit = (id) => {
    if (state.get(id) === 2 || state.get(id) === 1) return;
    state.set(id, 1);
    if (isBroken(id)) for (const [k] of ingredients(id)) visit(k);
    state.set(id, 2); order.push(id);
  };
  for (const id of [...need.keys()].sort()) visit(id);
  order.reverse();
  const nodes = new Map(), done_ = new Set();
  for (const id of order) {
    const gross = need.get(id) ?? 0; if (!gross) continue;
    const got = done[id] ? gross : Math.max(0, Math.min(have[id] ?? 0, gross)), net = gross - got;
    const broken = isBroken(id), member = id.startsWith("#") ? memberOf(book, id, prefer) : null;
    const recipe = broken ? recipeOf(book, member ?? id, pick) : null;
    const crafts = broken && net > 0 ? Math.ceil(net / recipe[1]) : 0;
    nodes.set(id, { id, gross, have: got, net, broken, crafts, spare: crafts ? crafts * recipe[1] - net : 0, recipe, member });
    done_.add(id);
    if (!crafts) continue;
    for (const [k, c] of recipe[2]) {
      const q = crafts * c;
      need.set(k, (need.get(k) ?? 0) + q);
      let u = uses.get(k); if (!u) uses.set(k, (u = new Map())); u.set(id, (u.get(id) ?? 0) + q);
      for (const r of roots.get(id) ?? []) addRoot(k, r);
      if (done_.has(k)) { const n = nodes.get(k); if (n) { n.gross += q; n.net += q; } else nodes.set(k, { id: k, gross: q, have: 0, net: q, broken: false, crafts: 0, spare: 0, recipe: null, member: null }); }
    }
  }
  return { nodes, order: order.filter((id) => nodes.has(id)), uses, roots };
}

/** What the plan leaves to get: the items not broken down, most still to get first. */
export const leavesOf = (p) => [...p.nodes.values()].filter((n) => !n.broken).sort((a, b) => b.net - a.net || b.gross - a.gross || (a.id < b.id ? -1 : 1));
/** Totals over a list of nodes: items, kinds, stacks (each item rounded up to whole stacks), shulker boxes, trips. */
export function totalsOf(list, key = "net") {
  let items = 0, stacks = 0, kinds = 0;
  for (const n of list) { const v = n[key]; if (!v) continue; items += v; kinds++; stacks += Math.ceil(v / stackOf(n.id)); }
  return { items, kinds, stacks, shulkers: stacks / SHULKER, trips: stacks / INVENTORY };
}

// ---- notes --------------------------------------------------------------------------------------------------------
const GOT_FROM = {
  "minecraft:prismarine_shard": "from guardians", "minecraft:prismarine_crystals": "from guardians", "minecraft:honeycomb": "shears on a full bee nest",
  "minecraft:glow_ink_sac": "from glow squids", "minecraft:ink_sac": "from squids", "minecraft:moss_block": "bone meal spreads it",
  "minecraft:crying_obsidian": "ruined portals, piglin barter", "minecraft:sculk": "the deep dark", "minecraft:budding_amethyst": "cannot be moved",
  "minecraft:water_bucket": "the bucket comes back", "minecraft:lava_bucket": "the bucket comes back", "minecraft:sponge": "ocean monuments",
};
// what a pickaxe or hand only picks up with Silk Touch
const SILK = /^(stone|deepslate|grass_block|mycelium|podzol|ice|blue_ice|packed_ice|bookshelf|chiseled_bookshelf|glowstone|sea_lantern|bee_nest|beehive|turtle_egg|.*_coral_block|.*_coral|.*_coral_fan|sculk.*|.*_ore|amethyst_cluster)$/;
/** A short note on how to come by an item the list leaves as it is, or null. */
export function noteOf(book, id, node, { preset = "gather" } = {}) {
  if (node?.broken || id.startsWith("#")) return null;
  const r = recipeOf(book, id), p = path(id), mc = nsOf(id) === "minecraft";
  if (r?.[0] === "oxidize" && preset !== "placed") return `weathers from ${nameOf(r[2][0][0], book)}`;
  if (r?.[0] === "smelt" && preset !== "placed") return `${mc && SILK.test(p) ? "Silk Touch, or " : ""}smelt ${nameOf(r[2][0][0], book)}`;
  if (GOT_FROM[id]) return GOT_FROM[id];
  if (!r && mc && SILK.test(p) && preset !== "placed") return "Silk Touch";
  return null;
}
