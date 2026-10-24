// The materials list, worked out from the schematic in memory and the recipe book (book.js): which item each block
// is placed from, how many of each the blocks in view take, and what those items are made of. No DOM here, so the
// tests run it in node.
//
// Counting: one item per block, except where the game says otherwise (blockItems): a wall sign is a sign, dust is
// redstone, a door or a bed is one item for two blocks, a double slab two slabs, a candle block up to four candles,
// a water cauldron a cauldron and a bucket. Water and lava sources and waterlogged blocks are kept apart (fluids),
// blocks no item places (fire, a piston's head) are skipped, and a block with no item the list can find is reported
// (unknown), never dropped. Signs add their dye, glow ink and wax; a framed drawer its three framing materials.
//
// Rolling up (plan): demand flows down the recipe graph in dependency order, as a crafting planner does it. For each
// item, what is still needed is its demand less what the person has of it; if the item is broken down, that many are
// crafted (rounded up to whole crafts, the spare kept) and its ingredients' demand grows by as much. What is not
// broken down is on the list. So having two iron blocks of the twelve four anvils take means 90 fewer ingots to get.
// An ingredient any of several items will do (any planks) is counted as one of them, the one the build uses most, so
// it shares a row, and what the person has of it, with that item.
import { parseBlockKey } from "../schematic.js";

export const SHULKER = 27, INVENTORY = 36;
const AIR = /^minecraft:(cave_|void_)?air$/;
const path = (id) => id.replace(/^[^:]*:/, "");
const nsOf = (id) => (id.includes(":") ? id.split(":")[0] : "minecraft");
export const fmt = (n) => Math.round(n).toLocaleString("en-US");

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

/**
 * The items a block (a palette key, "id[state]") is placed from: { items: [[item, n], …], wet } (`wet`: it is
 * waterlogged), { fluid: item } for a water or lava source, null for a block no item places (air, the upper half of a
 * door, fire), or { unknown: id }. `lookup` is the book's { has(item), from(block) } (from: what the block's loot table
 * drops), or null before there is a book: then every id is taken as its own item once the rules have had their say.
 */
export function blockItems(key, lookup = null) {
  const has = lookup?.has ?? null, from = lookup?.from ?? null, ok = (x) => (has ? has(x) : true);
  const k = parseBlockKey(key); if (!k) return null;
  const id = k.id.includes(":") ? k.id : `minecraft:${k.id}`, props = k.props, p = path(id), mc = nsOf(id) === "minecraft";
  if (AIR.test(id)) return null;
  if (mc && (p === "water" || p === "lava")) return (props.level ?? "0") === "0" ? { fluid: `minecraft:${p}_bucket` } : null;
  // the second block of a two-block item: a door's or tall plant's upper half, a bed's head
  if (props.half === "upper" || (props.part === "head" && /_bed$/.test(p))) return null;
  const wet = props.waterlogged === "true";
  const items = (list) => ({ items: list, ...(wet ? { wet } : {}) });
  if (mc && p in CAULDRONS) return items([["minecraft:cauldron", 1], [`minecraft:${CAULDRONS[p]}`, 1]]);
  if (mc && p in PLACED_FROM) { const it = PLACED_FROM[p]; return it ? items([[`minecraft:${it}`, 1]]) : null; }
  if (props.type === "double" && /_slab$/.test(p)) return items([[id, 2]]);
  let n = 1;
  for (const [key_, re] of MANY) if (props[key_] !== undefined && re.test(p) && Number(props[key_]) > 0) { n = Number(props[key_]); break; }
  if (has?.(id)) return items([[id, n]]);
  const dropped = from?.(id); if (dropped?.length) return items(dropped.map((it) => [it, dropped.length > 1 ? 1 : n]));
  // a wall variant is its standing item: dark_oak_wall_sign, skeleton_wall_skull, white_wall_banner, tube_coral_wall_fan
  if (p.includes("_wall_")) { const s = id.replace("_wall_", "_"); if (ok(s)) return items([[s, n]]); }
  if (p.startsWith("wall_")) { const s = id.replace(":wall_", ":"); if (ok(s)) return items([[s, n]]); }
  // a potted plant: the pot and the plant
  if (p.startsWith("potted_")) {
    const plant = id.replace(":potted_", ":"), alt = plant.replace(/_bush$/, "");
    const it = ok(plant) ? plant : ok(alt) ? alt : null;
    if (it) return items([["minecraft:flower_pot", 1], [it, 1]]);
  }
  if (!has) return items([[id, n]]);
  // a mod's "<name>_block" or crop: the item it is named after
  for (const s of [id.replace(/_block$/, ""), id.replace(/_crop$/, "_seeds"), id.replace(/_plant$/, "")]) if (s !== id && has(s)) return items([[s, n]]);
  return { unknown: id };
}

// ---- counting what is in view ---------------------------------------------------------------------------------------
const DYE = (c) => `minecraft:${c}_dye`;
/**
 * Counts the blocks of `schem` in the scope ({ lo, hi } file layers, `hidden` block indices), split into groups when
 * `groupOf(i)` names one per block index. Per group: placed (item -> n), extras ([{ item, n, from, why }]: a sign's
 * dye, glow ink and wax, a framed drawer's materials), fluids (bucket -> sources), wet (waterlogged blocks), unknown
 * (block id -> n), blocks. `lookup` is blockItems'; `framed` the schematic's framed cells ([[index, id, materials]]);
 * `matItem(token)` turns a framing material into its item.
 */
export function countScope(schem, { lo = 0, hi = schem.height - 1, hidden = new Set(), lookup = null, groupOf = null, framed = [], matItem = null } = {}) {
  const has = lookup?.has ?? (() => true);
  const per = schem.perLayer, start = Math.max(0, lo) * per, end = Math.min(schem.height, hi + 1) * per;
  const tallies = new Map();   // group -> Int32Array over the palette
  const tally = (g) => { let t = tallies.get(g); if (!t) { t = new Int32Array(schem.keys.length); tallies.set(g, t); } return t; };
  const inScope = (i) => i >= start && i < end && !hidden.has(i) && !schem.air.has(schem.data[i]);
  const all = groupOf ? null : tally("all");
  for (let i = start; i < end && i < schem.data.length; i++) {
    const p = schem.data[i]; if (schem.air.has(p) || hidden.has(i)) continue;
    (all ?? tally(groupOf(i) ?? ""))[p]++;
  }
  const itemsOf = paletteItems(schem, lookup);
  const groups = new Map();
  const group = (g) => { let o = groups.get(g); if (!o) { o = { key: g, placed: new Map(), extras: [], fluids: new Map(), wet: 0, unknown: new Map(), blocks: 0 }; groups.set(g, o); } return o; };
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
      else { for (const [item, k] of r.items) add(o.placed, item, n * k); if (r.wet) o.wet += n; }
    }
  }
  const groupAt = (i) => group(groupOf ? groupOf(i) ?? "" : "all");
  // signs: dye on a side that is not black, glow ink, wax
  for (const s of schem.signs ?? []) {
    const i = schem.index(s.x, s.y, s.z); if (!inScope(i)) continue;
    const o = groupAt(i), from = itemsOf[schem.data[i]]?.items?.[0]?.[0] ?? s.id;
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
    const o = groupAt(i);
    for (const t of [mats.side, mats.trim, mats.front]) { const it = t && matItem?.(t); if (it) { o.extras.push({ item: it, n: 1, from: id, why: "framing material" }); firstFramed ??= o; } }
  }
  if (firstFramed && has("storagedrawers:framing_table")) firstFramed.extras.push({ item: "storagedrawers:framing_table", n: 1, from: "storagedrawers:framing_table", why: "one framing table for all of them" });
  for (const o of groups.values()) o.extras = mergeExtras(o.extras);
  return groups;
}
function mergeExtras(list) {
  const m = new Map();
  for (const e of list) { const k = `${e.item}|${e.from}|${e.why}`; const x = m.get(k); if (x) x.n += e.n; else m.set(k, { ...e }); }
  return [...m.values()];
}
const paletteCache = new WeakMap();
/** blockItems for each palette entry of a schematic, once per schematic and lookup. */
export function paletteItems(schem, lookup) {
  let c = paletteCache.get(schem);
  if (!c || c.lookup !== lookup) { c = { lookup, items: schem.keys.map((k) => (k ? blockItems(k, lookup) : null)) }; paletteCache.set(schem, c); }
  return c.items;
}
/** The book's lookup for blockItems and countScope. */
export const lookupOf = (book) => (book ? { has: (id) => id in book.items, from: (id) => book.blocks?.[id] ?? null } : null);

// ---- the book, ready to plan with ---------------------------------------------------------------------------------
// Recipes the jars do not have as JSON: copper weathering, concrete powder setting in water, an axe stripping a log.
const STEP = { stonecut: 0.01, oxidize: 0.02, water: 0.02, axe: 0.02, craft: 0.05, framing: 0.05, smithing: 0.1, smelt: 0.5 };
export const HOW = { craft: "crafting table", stonecut: "stonecutter", smelt: "furnace", smithing: "smithing table", oxidize: "weathers over time", water: "water", axe: "an axe", framing: "framing table" };
// What a person gathers rather than makes, whatever recipes the jars have for it (andesite from diorite, leather from
// rabbit hide, an ingot from nuggets, a carrot from a mod's crate): mined, grown, dropped or smelted from ore.
const NATURAL = /^minecraft:(cobblestone|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|blackstone|basalt|netherrack|end_stone|sand|red_sand|gravel|dirt|coarse_dirt|rooted_dirt|mud|clay_ball|clay|snowball|ice|obsidian|crying_obsidian|quartz|diamond|emerald|coal|lapis_lazuli|redstone|amethyst_shard|glowstone_dust|bamboo|sugar_cane|cactus|vine|moss_block|wheat|string|leather|slime_ball|honeycomb|prismarine_shard|prismarine_crystals|soul_sand|soul_soil|magma_block|bone|feather|gunpowder|ender_pearl|blaze_rod|breeze_rod|ink_sac|glow_ink_sac|egg|kelp|seagrass|lily_pad|pumpkin|melon_slice|melon|apple|carrot|potato|beetroot|cocoa_beans|sweet_berries|glow_berries|chorus_fruit|nether_wart|netherite_scrap|raw_iron|raw_gold|raw_copper|flint|sponge|nautilus_shell|heart_of_the_sea|shulker_shell|phantom_membrane|rabbit_hide|armadillo_scute|turtle_scute|resin_clump|pointed_dripstone|amethyst_block|honey_bottle|milk_bucket|water_bucket|lava_bucket|.*_seeds|.*_mushroom|.*_sapling|.*_tulip|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|torchflower|pitcher_plant|pitcher_pod)$|^(?![^:]*:stripped_).*_(ingot|log|stem)$/;
// Gathered things that are harder to come by than a common block: what a recipe that uses them costs reflects it
// (sugar from cane, not from honey bottles; a nugget is not worth a ninth of the work of an ingot hunt)
const RARE = { "minecraft:honey_bottle": 4, "minecraft:honeycomb": 2, "minecraft:glow_ink_sac": 3, "minecraft:prismarine_shard": 3, "minecraft:prismarine_crystals": 3,
  "minecraft:ender_pearl": 3, "minecraft:blaze_rod": 3, "minecraft:breeze_rod": 4, "minecraft:diamond": 6, "minecraft:emerald": 5, "minecraft:netherite_scrap": 20,
  "minecraft:nautilus_shell": 8, "minecraft:heart_of_the_sea": 20, "minecraft:shulker_shell": 10, "minecraft:phantom_membrane": 4, "minecraft:turtle_scute": 6,
  "minecraft:armadillo_scute": 3, "minecraft:sponge": 8, "minecraft:crying_obsidian": 3, "minecraft:milk_bucket": 2 };
const MADE_ELSEWHERE = 4, MOD_GATHERED = 1.5, STUCK = 3;
/** The book with the recipes the jars leave out, the preferred recipe of each item (`best`) and its cost. */
export function prepareBook(raw) {
  const book = { ...raw, recipes: { ...raw.recipes }, made: raw.made ?? {} };
  const has = (id) => id in book.items, crops = new Set(raw.crops ?? []);
  const isNatural = (id) => NATURAL.test(id) || crops.has(id);
  // a vanilla item made with a mod's ingredient (packed mud from straw, bread from dough): the game's own way is taken
  // whenever there is one that works, a mod's only when it is the only way
  const modded = (out, ins) => nsOf(out) === "minecraft" && ins.some(([k]) => (k.startsWith("#") ? (book.tags[k] ?? []).every((m) => nsOf(m) !== "minecraft") : nsOf(k) !== "minecraft"));
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
  // costs: what nothing makes costs 1 (a mod's a little more, so a vanilla recipe wins a near tie), and so does what a
  // person gathers rather than makes (cobblestone, andesite, logs, ingots: they have recipes, but nobody crafts
  // andesite from diorite); what only a machine the list does not follow makes costs more, so it is never the cheap
  // way; a recipe costs its ingredients over its yield plus a little per step (the stonecutter least, the furnace
  // most), so storage blocks never undo themselves and the stonecutter wins a tie.
  const cost = new Map(), best = {}, gathered = new Set();
  const fixed = (id) => isNatural(id) || gathered.has(id);
  const ingCost = (k) => (k.startsWith("#") ? Math.min(...(book.tags[k] ?? []).map((m) => cost.get(m) ?? Infinity)) : cost.get(k) ?? Infinity);
  for (const id of Object.keys(book.items)) {
    if (isNatural(id)) cost.set(id, RARE[id] ?? 1);
    else if (!book.recipes[id]) cost.set(id, book.made[id] ? MADE_ELSEWHERE : nsOf(id) === "minecraft" ? RARE[id] ?? 1 : MOD_GATHERED);
  }
  const relax = () => {
    for (let pass = 0, changed = true; changed && pass < 60; pass++) {
      changed = false;
      for (const [id, list] of Object.entries(book.recipes)) {
        if (fixed(id)) continue;
        let c = Infinity, b, cm = Infinity, bm;   // the best way without a mod's ingredient, and the best with one
        list.forEach(([how, y, ins], i) => {
          const v = ins.reduce((s, [k, n]) => s + ingCost(k) * n, 0) / y + (STEP[how] ?? 0.1);
          if (modded(id, ins)) { if (v < cm - 1e-9) { cm = v; bm = i; } } else if (v < c - 1e-9) { c = v; b = i; }
        });
        if (!Number.isFinite(c)) { c = cm; b = bm; }
        if (b !== best[id]) { best[id] = b; changed = true; }
        if (Math.abs(c - (cost.get(id) ?? Infinity)) > 1e-12 || !cost.has(id)) { cost.set(id, c); changed = true; }
      }
    }
  };
  relax();
  // Items in a loop with no way in from outside (a mod's carrot crate and the carrot it unpacks into; deepslate and
  // cobbled deepslate): what a loop unpacks into (a recipe that makes several from one) is gathered first, and the
  // rest worked out from it (the crate is nine carrots); whatever is still stuck is gathered too. Gathered items never
  // get a recipe of their own afterwards.
  const stuck = () => Object.keys(book.recipes).filter((id) => id in book.items && !fixed(id) && !Number.isFinite(cost.get(id) ?? Infinity));
  for (const pick of [(id) => book.recipes[id].every(([, y]) => y > 1), () => true]) {
    const s = stuck().filter(pick);
    if (!s.length) continue;
    for (const id of s) { gathered.add(id); cost.set(id, book.made[id] ? MADE_ELSEWHERE : STUCK); delete best[id]; }
    relax();
  }
  book.best = best; book.cost = cost; book.gathered = gathered;
  return book;
}

// ---- names, stacks, packing ---------------------------------------------------------------------------------------
const humanize = (s) => s.replace(/^.*[:/]/, "").replaceAll("_", " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** An item's or a tag's display name. */
export function nameOf(id, book) {
  if (id.startsWith("#")) {
    // a short set reads as its members ("Sand or Red Sand"), a long tag as what it is ("Planks (any)")
    const m = book?.tags?.[id] ?? [];
    if (m.length >= 2 && (m.length <= 3 || id.startsWith("#~"))) { const names = m.slice(0, 3).map((x) => nameOf(x, book)); return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}${m.length > 3 ? " or …" : ""}`; }
    return `${humanize(id.slice(1))} (any)`;
  }
  return book?.items?.[id]?.[0] ?? humanize(id);
}
/** What else would do for an item that stands in for a set ("any planks will do", "or Charcoal"), or null. */
export function altText(book, node) {
  const tag = node?.anyOf?.[0]; if (!tag) return null;
  const others = (book?.tags?.[tag] ?? []).filter((x) => x !== node.id);
  if (!others.length) return null;
  if (others.length <= 2) return `or ${others.map((x) => nameOf(x, book)).join(" or ")}`;
  return tag.startsWith("#~") ? `or ${others.length} others` : `any ${humanize(tag.slice(1)).toLowerCase()} will do`;
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
/** n of an item as items, stacks ("11×64 + 45") or shulker boxes ("2 sb + 5×64 + 3"); with `compact` an item that
 *  has a 9-to-1 block counts in blocks ("111 blocks + 1"). */
export function packText(n, id, { units = "items", compact = false, book = null } = {}) {
  if (n <= 0) return "0";
  if (compact && book?.packs?.[id] && n >= 9) { const b = Math.floor(n / 9), r = n % 9; return `${fmt(b)} ${b === 1 ? "block" : "blocks"}${r ? ` + ${r}` : ""}`; }
  const s = stackOf(id);
  if (units === "items") return fmt(n);
  if (s === 1) return `${fmt(n)} × 1`;
  const q = Math.floor(n / s), r = n % s;
  if (units === "stacks" || q < SHULKER) return q ? `${q}×${s}${r ? ` + ${r}` : ""}` : `${r}`;
  const sb = Math.floor(q / SHULKER), qs = q % SHULKER;
  return [`${sb} sb`, qs ? `${qs}×${s}` : "", r ? `${r}` : ""].filter(Boolean).join(" + ");
}
/** A have value as typed: "120", "2s" (stacks), "1sb" (shulker boxes), "3b" (9-to-1 blocks), "2s + 5"; null for
 *  what is no amount (including blocks of an item that has none). */
export function parseHave(text, id, book = null) {
  const s = String(text ?? "").trim().toLowerCase().replaceAll(",", "");
  if (!s) return 0;
  let total = 0;
  for (const part of s.split("+")) {
    const m = part.trim().match(/^(\d+(?:\.\d+)?)\s*(sb|shulkers?|s|st|stacks?|b|blocks?)?$/);
    if (!m) return null;
    const n = Number(m[1]), u = m[2] ?? "";
    if (/^b/.test(u) && !book?.packs?.[id]) return null;
    total += /^(sb|shulker)/.test(u) ? n * SHULKER * stackOf(id) : /^s/.test(u) ? n * stackOf(id) : /^b/.test(u) ? n * 9 : n;
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

/** The recipe an item is made with here: the one picked by hand, else the book's best; [how, yield, ingredients]. */
export function recipeOf(book, id, pick = {}) {
  const list = book?.recipes?.[id]; if (!list?.length) return null;
  const i = pick[id] ?? book.best?.[id];
  return i === undefined ? null : list[i] ?? null;
}
/** A set's stand-in: the member the build wants most (`prefer`: item -> n), else its cheapest. */
export function memberOf(book, tag, prefer = null) {
  const m = book?.tags?.[tag] ?? []; if (!m.length) return null;
  if (prefer) { let best = null, n = 0; for (const x of m) { const c = prefer.get(x) ?? 0; if (c > n) { n = c; best = x; } } if (best) return best; }
  let best = m[0], c = Infinity; for (const x of m) { const v = book.cost?.get(x) ?? 1; if (v < c - 1e-9) { c = v; best = x; } }
  return best;
}
/** Whether an item is broken down into its ingredients under a rollup: a choice made by hand wins. */
export function brokenDown(book, id, { preset = "gather", open = {}, pick = {} } = {}) {
  const r = recipeOf(book, id, pick); if (!r) return false;
  if (id in open) return !!open[id];
  if (preset === "placed") return false;
  const p = path(id);
  if (preset === "gather") return GATHER_HOW.has(r[0]) && !GATHER_STOP.test(p);
  return !RAW_STOP.test(p);
}
/** Whether making `id` with its recipe number `index` would need `id` itself on the way (a loop): picked by hand, a
 *  recipe like bone meal from a bone block, while bone blocks are made of bone meal. */
export function wouldLoop(book, id, index, pick = {}) {
  const trial = { ...pick, [id]: index }, seen = new Set();
  const reaches = (k, depth = 0) => {
    for (const x of k.startsWith("#") ? book.tags?.[k] ?? [] : [k]) {
      if (x === id) return true;
      if (seen.has(x) || depth > 30) continue; seen.add(x);
      const r = recipeOf(book, x, trial); if (r && r[2].some(([y]) => reaches(y, depth + 1))) return true;
    }
    return false;
  };
  return (book?.recipes?.[id]?.[index]?.[2] ?? []).some(([k]) => reaches(k));
}

/**
 * The plan for a demand ([{ item, n, from }], `from` the placed item it is for): nodes by item, each { id, gross
 * (needed in all), have, net (still to get), broken (broken down here), crafts, spare, recipe, anyOf (the sets it
 * stands in for) }, `order` (dependency order: every item before its ingredients), `uses` (item -> Map(parent -> n))
 * and `roots` (item -> Set of the placed items it goes into). have: item -> n; done: item -> true (all of it in hand).
 * A set is counted as the member the build wants most: worked out once, then again with what that first pass asked
 * for by name (the signs' dark oak planks make "any planks" dark oak too).
 */
export function plan(book, demand, opts = {}) {
  const first = planOnce(book, demand, opts, opts.prefer ?? null);
  if (!first.sets) return first;
  const prefer = new Map(opts.prefer ?? []);
  for (const [k, n] of first.byName) prefer.set(k, (prefer.get(k) ?? 0) + n);
  return planOnce(book, demand, opts, prefer);
}
function planOnce(book, demand, opts, prefer) {
  const { have = {}, done = {}, pick = {} } = opts;
  const need = new Map(), uses = new Map(), roots = new Map(), anyOf = new Map(), byName = new Map();
  let sets = 0;
  const addRoot = (id, r) => { let s = roots.get(id); if (!s) roots.set(id, (s = new Set())); s.add(r); };
  const addUse = (k, parent, q) => { let u = uses.get(k); if (!u) uses.set(k, (u = new Map())); u.set(parent, (u.get(parent) ?? 0) + q); };
  // an ingredient as the item it is counted as
  const real = (k) => { if (!k.startsWith("#")) return k; sets++; const m = memberOf(book, k, prefer) ?? k; let a = anyOf.get(m); if (!a) anyOf.set(m, (a = [])); if (!a.includes(k)) a.push(k); return m; };
  for (const d of demand) { if (!d.n) continue; need.set(d.item, (need.get(d.item) ?? 0) + d.n); addRoot(d.item, d.from ?? d.item); if (d.from && d.from !== d.item) addUse(d.item, d.from, d.n); }
  const isBroken = (id) => brokenDown(book, id, opts);
  const ingredients = (id) => recipeOf(book, id, pick)?.[2] ?? [];
  // dependency order over the edges that are followed (a cycle's back edge is left out)
  const order = [], state = new Map();
  const visit = (id) => {
    if (state.has(id)) return;
    state.set(id, 1);
    if (isBroken(id)) for (const [k] of ingredients(id)) visit(real(k));
    state.set(id, 2); order.push(id);
  };
  for (const id of [...need.keys()].sort()) visit(id);
  order.reverse();
  const nodes = new Map(), processed = new Set();
  for (const id of order) {
    const gross = need.get(id) ?? 0; if (!gross) continue;
    const got = done[id] ? gross : Math.max(0, Math.min(have[id] ?? 0, gross)), net = gross - got;
    const broken = isBroken(id), recipe = broken ? recipeOf(book, id, pick) : null;
    const crafts = broken && net > 0 ? Math.ceil(net / recipe[1]) : 0;
    nodes.set(id, { id, gross, have: got, net, broken, crafts, spare: crafts ? crafts * recipe[1] - net : 0, recipe, anyOf: anyOf.get(id) ?? null });
    processed.add(id);
    if (!crafts) continue;
    for (const [k0, c] of recipe[2]) {
      const k = real(k0), q = crafts * c;
      if (!k0.startsWith("#")) byName.set(k, (byName.get(k) ?? 0) + q);
      need.set(k, (need.get(k) ?? 0) + q);
      addUse(k, id, q);
      for (const r of roots.get(id) ?? []) addRoot(k, r);
      // a loop's back edge (only a recipe picked by hand can make one; wouldLoop refuses those): listed as it is
      if (processed.has(k)) { const n = nodes.get(k); if (n) { n.gross += q; n.net += q; } else nodes.set(k, { id: k, gross: q, have: 0, net: q, broken: false, crafts: 0, spare: 0, recipe: null, anyOf: anyOf.get(k) ?? null }); }
    }
  }
  for (const n of nodes.values()) n.anyOf = anyOf.get(n.id) ?? null;
  return { nodes, order: order.filter((id) => nodes.has(id)), uses, roots, sets, byName };
}

/** What the plan leaves to get: the items not broken down, most still to get first. */
export const leavesOf = (p) => [...p.nodes.values()].filter((n) => !n.broken).sort((a, b) => b.net - a.net || b.gross - a.gross || (a.id < b.id ? -1 : 1));
/** Totals over a list of nodes: items, kinds (distinct items), stacks (each row rounded up to whole stacks), shulker
 *  boxes, inventories. */
export function totalsOf(list, key = "net") {
  let items = 0, stacks = 0; const kinds = new Set();
  for (const n of list) { const v = n[key]; if (!v) continue; items += v; kinds.add(n.id); stacks += Math.ceil(v / stackOf(n.id)); }
  return { items, kinds: kinds.size, stacks, shulkers: stacks / SHULKER, trips: stacks / INVENTORY };
}

/**
 * The plans for groups in order ([{ key, demand }]): each group's, with what the person has handed out in that order
 * (the bottom layer, the first part takes it first), and the whole scope's at once (`all`: the tree, the hover). The
 * totals add up the groups, so they agree with the sections shown (each group rounds to whole crafts of its own).
 */
export function planGroups(book, groups, opts = {}) {
  const all = plan(book, groups.flatMap((g) => g.demand), opts);
  if (groups.length < 2) { const leaves = leavesOf(all); return { all, sections: groups.map((g) => ({ key: g.key, plan: all, leaves })), totals: totalsOf(leaves), gross: totalsOf(leaves, "gross") }; }
  const left = { ...(opts.have ?? {}) }, sections = [];
  for (const g of groups) {
    const p = plan(book, g.demand, { ...opts, have: left });
    for (const n of p.nodes.values()) if (!opts.done?.[n.id] && left[n.id]) left[n.id] = Math.max(0, left[n.id] - n.have);
    sections.push({ key: g.key, plan: p, leaves: leavesOf(p) });
  }
  const every = sections.flatMap((s) => s.leaves);
  return { all, sections, totals: totalsOf(every), gross: totalsOf(every, "gross") };
}

// ---- notes --------------------------------------------------------------------------------------------------------
const GOT_FROM = {
  "minecraft:prismarine_shard": "from guardians", "minecraft:prismarine_crystals": "from guardians", "minecraft:honeycomb": "shears on a full bee nest",
  "minecraft:glow_ink_sac": "from glow squids", "minecraft:ink_sac": "from squids", "minecraft:moss_block": "bone meal spreads it",
  "minecraft:crying_obsidian": "ruined portals, piglin barter", "minecraft:sculk": "the deep dark", "minecraft:budding_amethyst": "cannot be moved",
  "minecraft:water_bucket": "the bucket comes back", "minecraft:lava_bucket": "the bucket comes back", "minecraft:sponge": "ocean monuments",
};
// what a pickaxe or hand only picks up with Silk Touch, and what only shears pick up
const SILK = /^(stone|deepslate|grass_block|mycelium|podzol|ice|blue_ice|packed_ice|bookshelf|chiseled_bookshelf|glowstone|sea_lantern|bee_nest|beehive|turtle_egg|.*_coral_block|.*_coral|.*_coral_fan|sculk.*|.*_ore|amethyst_cluster)$/;
const SHEARS = /^(short_grass|tall_grass|fern|large_fern|.*_leaves|vine|glow_lichen|dead_bush|seagrass|cobweb|hanging_roots|nether_sprouts|twisting_vines|weeping_vines|pale_hanging_moss|bush|short_dry_grass|tall_dry_grass)$/;
/** A short note on how to come by an item the list leaves as it is, or null. */
export function noteOf(book, id, node, { preset = "gather" } = {}) {
  if (node?.broken || id.startsWith("#")) return null;
  const r = recipeOf(book, id), p = path(id), mc = nsOf(id) === "minecraft";
  // an ingredient that is a set reads as its likeliest member ("smelt Sand or similar", not the tag's name)
  const from = (k) => (k.startsWith("#") && (book?.tags?.[k]?.length ?? 0) > 3 ? `${nameOf(memberOf(book, k), book)} or similar` : nameOf(k, book));
  if (r?.[0] === "oxidize" && preset !== "placed") return `weathers from ${from(r[2][0][0])}`;
  if (r?.[0] === "smelt" && preset !== "placed") return `${mc && SILK.test(p) ? "Silk Touch, or " : ""}smelt ${from(r[2][0][0])}`;
  if (GOT_FROM[id]) return GOT_FROM[id];
  if (mc && SHEARS.test(p)) return "shears";
  if (!r && book?.made?.[id]) { const t = book.made[id]; return `made by ${humanize(t).toLowerCase()} (${nsOf(t)})`; }
  if (!r && mc && SILK.test(p) && preset !== "placed") return "Silk Touch";
  return null;
}
