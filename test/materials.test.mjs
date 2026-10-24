// node --test: the materials list (src/materials/): the recipe book read from jar-shaped zips, blocks to items, the
// count of a scope, the rollups and what having something mid-recipe takes off.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { encodeNbt, gzip, encodeVarints } from "../src/nbt.js";
import { Schematic } from "../src/schematic.js";
import { buildBook } from "../src/materials/book.js";
import { blockItems, countScope, prepareBook, plan, planGroups, leavesOf, totalsOf, packText, parseHave, nameOf, altText, noteOf, stackOf, memberOf, recipeOf, wouldLoop, lookupOf } from "../src/materials/engine.js";

const i32 = (v) => ({ t: 3, v }), i16 = (v) => ({ t: 2, v });
const json = (o) => JSON.stringify(o);

/** A client jar and a mod in miniature: items with names and models, recipes in each format, tags, loops, a crop, a
 *  storage pair the mod adds, and a machine the list does not follow. */
async function jar() {
  const z = new JSZip();
  const item = (id, model, ns = "minecraft") => z.file(`assets/${ns}/items/${id}.json`, json({ model: { type: "minecraft:model", model } }));
  for (const id of ["iron_ingot", "iron_nugget", "stick", "oak_sign", "bone_meal", "bone", "sugar", "egg", "milk_bucket", "wheat"]) { item(id, `minecraft:item/${id}`); z.file(`assets/minecraft/models/item/${id}.json`, json({ parent: "minecraft:item/generated", textures: { layer0: `minecraft:item/${id}` } })); }
  for (const id of ["iron_block", "anvil", "oak_planks", "spruce_planks", "oak_log", "chest", "deepslate", "cobbled_deepslate", "deepslate_bricks", "stone", "cobblestone", "glass", "sand", "red_sand", "copper_block", "exposed_copper", "white_concrete", "white_concrete_powder", "white_dye", "gravel", "oak_door", "candle", "cauldron", "water_bucket", "flower_pot", "poppy", "redstone", "torch", "oak_slab", "oak_fence", "bone_block", "cake", "short_grass", "coal", "charcoal"]) {
    item(id, `minecraft:block/${id}`);
  }
  for (const id of ["rice", "rice_bag", "rice_cake", "cake_slice", "cabbage", "cabbage_seeds", "cabbage_leaf", "wheat_dough"]) item(id, `fd:item/${id}`, "fd");
  item("bread", "minecraft:item/bread");
  z.file("assets/minecraft/models/block/deepslate.json", json({ parent: "minecraft:block/cube_column", textures: { end: "minecraft:block/deepslate_top", side: "minecraft:block/deepslate" } }));
  z.file("assets/minecraft/models/block/glass.json", json({ parent: "minecraft:block/cube_all", textures: { all: { sprite: "minecraft:block/glass", force_translucent: true } } }));
  z.file("assets/minecraft/lang/en_us.json", json({ "block.minecraft.iron_block": "Block of Iron", "item.minecraft.iron_ingot": "Iron Ingot", "block.minecraft.anvil": "Anvil", "block.minecraft.oak_planks": "Oak Planks", "block.minecraft.spruce_planks": "Spruce Planks", "item.minecraft.coal": "Coal", "item.minecraft.charcoal": "Charcoal", "block.minecraft.cobbled_deepslate": "Cobbled Deepslate" }));
  const r = (name, o, ns = "minecraft") => z.file(`data/${ns}/recipe/${name}.json`, json(o));
  r("anvil", { type: "minecraft:crafting_shaped", key: { I: "minecraft:iron_block", i: "minecraft:iron_ingot" }, pattern: ["III", " i ", "iii"], result: { id: "minecraft:anvil" } });
  r("iron_block", { type: "minecraft:crafting_shaped", key: { "#": "minecraft:iron_ingot" }, pattern: ["###", "###", "###"], result: { id: "minecraft:iron_block" } });
  r("iron_ingot_from_iron_block", { type: "minecraft:crafting_shapeless", ingredients: ["minecraft:iron_block"], result: { id: "minecraft:iron_ingot", count: 9 } });
  r("iron_ingot_from_nuggets", { type: "minecraft:crafting_shaped", key: { "#": "minecraft:iron_nugget" }, pattern: ["###", "###", "###"], result: { id: "minecraft:iron_ingot" } });
  r("iron_nugget", { type: "minecraft:crafting_shapeless", ingredients: ["minecraft:iron_ingot"], result: { id: "minecraft:iron_nugget", count: 9 } });
  r("chest", { type: "minecraft:crafting_shaped", key: { "#": "#minecraft:planks" }, pattern: ["###", "# #", "###"], result: { id: "minecraft:chest" } });
  r("oak_planks", { type: "minecraft:crafting_shapeless", ingredients: ["#minecraft:oak_logs"], result: { id: "minecraft:oak_planks", count: 4 } });
  r("stick", { type: "minecraft:crafting_shaped", key: { "#": "#minecraft:planks" }, pattern: ["#", "#"], result: { id: "minecraft:stick", count: 4 } });
  r("oak_sign", { type: "minecraft:crafting_shaped", key: { "#": "minecraft:oak_planks", X: "#c:rods/wooden" }, pattern: ["###", "###", " X "], result: { id: "minecraft:oak_sign", count: 3 } });
  r("deepslate", { type: "minecraft:smelting", ingredient: "minecraft:cobbled_deepslate", result: { id: "minecraft:deepslate" } });
  r("cobbled_deepslate_from_deepslate", { type: "minecraft:stonecutting", ingredient: "minecraft:deepslate", result: { id: "minecraft:cobbled_deepslate" } });
  r("deepslate_bricks", { type: "minecraft:stonecutting", ingredient: "minecraft:cobbled_deepslate", result: { id: "minecraft:deepslate_bricks" } });
  r("stone", { type: "minecraft:smelting", ingredient: "minecraft:cobblestone", result: { id: "minecraft:stone" } });
  r("glass", { type: "minecraft:smelting", ingredient: "#minecraft:smelts_to_glass", result: { id: "minecraft:glass" } });
  r("white_concrete_powder", { type: "minecraft:crafting_shapeless", ingredients: ["minecraft:white_dye", "minecraft:sand", "minecraft:sand", "minecraft:sand", "minecraft:sand", "minecraft:gravel", "minecraft:gravel", "minecraft:gravel", "minecraft:gravel"], result: { id: "minecraft:white_concrete_powder", count: 8 } });
  r("old_format", { type: "minecraft:crafting_shapeless", ingredients: [{ item: "minecraft:iron_ingot" }, [{ item: "minecraft:stick" }, { item: "minecraft:torch" }]], result: { id: "minecraft:candle", count: 1 } });
  r("modded_machine", { type: "create:milling", ingredients: ["minecraft:stone"], results: [{ id: "minecraft:gravel" }] });
  // the same set of alternatives spelled as a list in one recipe and as a tag in another
  r("torch_coal", { type: "minecraft:crafting_shaped", key: { c: ["minecraft:coal", "minecraft:charcoal"], s: "minecraft:stick" }, pattern: ["c", "s"], result: { id: "minecraft:torch", count: 4 } });
  r("torch_coal_tag", { type: "minecraft:crafting_shapeless", ingredients: ["#minecraft:coals", "minecraft:stick", "minecraft:stick"], result: { id: "minecraft:torch", count: 4 } });
  // bone meal and bone blocks make each other; bone meal also comes from bones
  r("bone_meal", { type: "minecraft:crafting_shapeless", ingredients: ["minecraft:bone"], result: { id: "minecraft:bone_meal", count: 3 } });
  r("bone_block", { type: "minecraft:crafting_shaped", key: { "#": "minecraft:bone_meal" }, pattern: ["###", "###", "###"], result: { id: "minecraft:bone_block" } });
  r("bone_meal_from_bone_block", { type: "minecraft:crafting_shapeless", ingredients: ["minecraft:bone_block"], result: { id: "minecraft:bone_meal", count: 9 } });
  r("cake", { type: "minecraft:crafting_shaped", key: { A: "minecraft:milk_bucket", B: "minecraft:sugar", C: "minecraft:wheat", E: "minecraft:egg" }, pattern: ["AAA", "BEB", "CCC"], result: { id: "minecraft:cake" } });
  // the mod: a rice bag that is nine rice and unpacks into nine (rice has no other recipe), a rice cake of rice, a
  // cake of seven slices only its cutting board makes
  r("rice_bag", { type: "minecraft:crafting_shaped", key: { "#": "fd:rice" }, pattern: ["###", "###", "###"], result: { id: "fd:rice_bag" } }, "fd");
  r("rice_from_bag", { type: "minecraft:crafting_shapeless", ingredients: ["fd:rice_bag"], result: { id: "fd:rice", count: 9 } }, "fd");
  r("rice_cake", { type: "minecraft:crafting_shapeless", ingredients: ["fd:rice", "fd:rice"], result: { id: "fd:rice_cake" } }, "fd");
  r("cake_from_slices", { type: "minecraft:crafting_shapeless", ingredients: Array(7).fill("fd:cake_slice"), result: { id: "minecraft:cake" } }, "fd");
  r("cutting_cake", { type: "fd:cutting", ingredients: [{ item: "minecraft:cake" }], result: [{ item: { id: "fd:cake_slice", count: 7 } }] }, "fd");
  // a mod crop with a recipe of its own (cabbage from two leaves, which the cutting board makes from cabbage)
  r("cabbage_from_leaves", { type: "minecraft:crafting_shapeless", ingredients: ["fd:cabbage_leaf", "fd:cabbage_leaf"], result: { id: "fd:cabbage" } }, "fd");
  r("cutting_cabbage", { type: "fd:cutting", ingredients: [{ item: "fd:cabbage" }], result: [{ item: { id: "fd:cabbage_leaf", count: 2 } }] }, "fd");
  // bread: three wheat, or smelted from the mod's dough (wheat and water)
  r("bread", { type: "minecraft:crafting_shaped", key: { "#": "minecraft:wheat" }, pattern: ["###"], result: { id: "minecraft:bread" } });
  r("wheat_dough", { type: "minecraft:crafting_shapeless", ingredients: ["minecraft:wheat", "minecraft:water_bucket"], result: { id: "fd:wheat_dough", count: 3 } }, "fd");
  r("bread_from_dough", { type: "minecraft:smelting", ingredient: "fd:wheat_dough", result: { id: "minecraft:bread" } }, "fd");
  // a crop: no item of the block's name, its loot table drops the crop and its seeds
  z.file("data/fd/loot_table/blocks/cabbages.json", json({ type: "minecraft:block", pools: [{ entries: [{ type: "minecraft:alternatives", children: [{ type: "minecraft:item", name: "fd:cabbage", conditions: [{ condition: "minecraft:block_state_property", block: "fd:cabbages", properties: { age: "7" } }] }, { type: "minecraft:item", name: "fd:cabbage_seeds" }] }] }] }));
  z.file("data/minecraft/loot_table/blocks/stone.json", json({ type: "minecraft:block", pools: [{ entries: [{ type: "minecraft:item", name: "minecraft:cobblestone" }] }] }));
  z.file("data/minecraft/tags/item/planks.json", json({ values: ["minecraft:oak_planks", "minecraft:spruce_planks", "minecraft:not_an_item"] }));
  z.file("data/minecraft/tags/item/oak_logs.json", json({ values: ["minecraft:oak_log"] }));
  z.file("data/minecraft/tags/item/coals.json", json({ values: ["minecraft:coal", "minecraft:charcoal"] }));
  z.file("data/minecraft/tags/item/smelts_to_glass.json", json({ values: ["minecraft:sand", "minecraft:red_sand"] }));
  return z;
}
const bookOf = async () => prepareBook(await buildBook([await jar()]));
const leaves = (book, preset, demand, opts = {}) => Object.fromEntries(leavesOf(plan(book, demand, { preset, ...opts })).map((n) => [n.id.replace("minecraft:", ""), n.net]));

test("book: items, names, icons, recipes in every format, tags, storage pairs, crops, machines", async () => {
  const b = await buildBook([await jar()]);
  assert.deepEqual(b.items["minecraft:iron_ingot"], ["Iron Ingot", ["f", "minecraft:item/iron_ingot"]]);
  assert.deepEqual(b.items["minecraft:deepslate"][1], ["c", "minecraft:block/deepslate_top", "minecraft:block/deepslate", "minecraft:block/deepslate"]);
  assert.deepEqual(b.items["minecraft:glass"][1], ["c", "minecraft:block/glass", "minecraft:block/glass", "minecraft:block/glass"], "a texture given as { sprite }");
  assert.equal(b.items["minecraft:oak_door"][0], null, "no name in the lang file");
  assert.deepEqual(b.recipes["minecraft:anvil"], [["craft", 1, [["minecraft:iron_block", 3], ["minecraft:iron_ingot", 4]]]]);
  // a tag of several members stays a set; an unknown member is dropped; a conventional tag no jar defines is guessed
  assert.deepEqual(b.recipes["minecraft:chest"], [["craft", 1, [["#minecraft:planks", 8]]]]);
  assert.deepEqual(b.tags["#minecraft:planks"], ["minecraft:oak_planks", "minecraft:spruce_planks"]);
  assert.deepEqual(b.recipes["minecraft:oak_sign"][0][2], [["minecraft:oak_planks", 6], ["minecraft:stick", 1]]);
  assert.deepEqual(b.recipes["minecraft:candle"][0][2], [["#~minecraft:stick|minecraft:torch", 1], ["minecraft:iron_ingot", 1]], "the older { item } format; a list of alternatives keyed by its members");
  // a list with the same members as a tag is that tag
  assert.deepEqual(b.recipes["minecraft:torch"].map((r) => r[2][0][0]), ["#minecraft:coals", "#minecraft:coals"]);
  assert.equal(b.recipes["minecraft:gravel"], undefined, "a mod's machine is not followed");
  assert.deepEqual(b.made, { "fd:cake_slice": "fd:cutting", "fd:cabbage_leaf": "fd:cutting" }, "what only a mod's machine makes, of the mod's own items (not the mill's gravel); the result in a machine's list form");
  assert.deepEqual(b.crops, ["fd:cabbage"], "what a grown crop drops");
  assert.deepEqual(b.blocks, { "fd:cabbages": ["fd:cabbage_seeds"] }, "a block with an item of its own name needs no entry");
  assert.deepEqual(b.packs, { "minecraft:iron_ingot": "minecraft:iron_block", "minecraft:iron_nugget": "minecraft:iron_ingot", "minecraft:bone_meal": "minecraft:bone_block", "fd:rice": "fd:rice_bag" });
});

test("blocks to items, with a book and before it arrives", async () => {
  const L = lookupOf(await bookOf());
  assert.deepEqual(blockItems("minecraft:wall_torch[facing=east]", L), { items: [["minecraft:torch", 1]] });
  assert.deepEqual(blockItems("minecraft:redstone_wire[power=0]", L), { items: [["minecraft:redstone", 1]] });
  assert.equal(blockItems("minecraft:oak_door[half=upper,facing=north]", L), null);
  assert.deepEqual(blockItems("minecraft:oak_door[half=lower,facing=north]", L), { items: [["minecraft:oak_door", 1]] });
  assert.equal(blockItems("minecraft:red_bed[part=head]", L), null);
  assert.deepEqual(blockItems("minecraft:oak_slab[type=double]", L), { items: [["minecraft:oak_slab", 2]] });
  assert.deepEqual(blockItems("minecraft:oak_slab[type=top]", L), { items: [["minecraft:oak_slab", 1]] });
  assert.deepEqual(blockItems("minecraft:candle[candles=3,lit=false]", L), { items: [["minecraft:candle", 3]] });
  assert.deepEqual(blockItems("minecraft:water_cauldron[level=3]", L), { items: [["minecraft:cauldron", 1], ["minecraft:water_bucket", 1]] });
  assert.deepEqual(blockItems("minecraft:potted_poppy", L), { items: [["minecraft:flower_pot", 1], ["minecraft:poppy", 1]] });
  assert.deepEqual(blockItems("minecraft:oak_fence[waterlogged=true]", L), { items: [["minecraft:oak_fence", 1]], wet: true });
  assert.deepEqual(blockItems("minecraft:water[level=0]", L), { fluid: "minecraft:water_bucket" });
  assert.equal(blockItems("minecraft:water[level=3]", L), null, "flowing water is not a source");
  assert.equal(blockItems("minecraft:air", L), null);
  assert.equal(blockItems("minecraft:piston_head[facing=up]", L), null);
  assert.deepEqual(blockItems("minecraft:carrots[age=7]", L), { items: [["minecraft:carrot", 1]] });
  assert.deepEqual(blockItems("fd:cabbages[age=3]", L), { items: [["fd:cabbage_seeds", 1]] }, "a crop by its loot table");
  assert.deepEqual(blockItems("somemod:strange_thing", L), { unknown: "somemod:strange_thing" });
  // before the recipes arrive: the rules still turn a wall sign into a sign and a pot into a pot and its plant
  assert.deepEqual(blockItems("minecraft:dark_oak_wall_sign[facing=north]"), { items: [["minecraft:dark_oak_sign", 1]] });
  assert.deepEqual(blockItems("minecraft:white_wall_banner[facing=north]"), { items: [["minecraft:white_banner", 1]] });
  assert.deepEqual(blockItems("minecraft:potted_poppy"), { items: [["minecraft:flower_pot", 1], ["minecraft:poppy", 1]] });
  assert.deepEqual(blockItems("somemod:strange_thing"), { items: [["somemod:strange_thing", 1]] });
});

test("rollups: placed, gather, raw; loops with no way in; the stonecutter wins", async () => {
  const book = await bookOf();
  const anvils = [{ item: "minecraft:anvil", n: 4, from: "minecraft:anvil" }];
  assert.deepEqual(leaves(book, "placed", anvils), { anvil: 4 });
  assert.deepEqual(leaves(book, "gather", anvils), { iron_ingot: 124 });
  // deepslate and cobbled deepslate make each other: cobbled is gathered, deepslate smelted from it (Raw only)
  const bricks = [{ item: "minecraft:deepslate_bricks", n: 10 }, { item: "minecraft:deepslate", n: 5 }];
  assert.deepEqual(leaves(book, "gather", bricks), { cobbled_deepslate: 10, deepslate: 5 });
  assert.deepEqual(leaves(book, "raw", bricks), { cobbled_deepslate: 15 });
  assert.equal(noteOf(book, "minecraft:deepslate", null, { preset: "gather" }), "Silk Touch, or smelt Cobbled Deepslate");
  // whole crafts: 10 chests are 80 planks, 20 logs; 10 signs are 4 crafts of 3, 24 planks and 4 sticks (1 craft of 4)
  assert.deepEqual(leaves(book, "gather", [{ item: "minecraft:chest", n: 10 }]), { oak_planks: 80 });
  assert.deepEqual(leaves(book, "raw", [{ item: "minecraft:chest", n: 10 }]), { oak_log: 20 });
  const signs = plan(book, [{ item: "minecraft:oak_sign", n: 10 }], { preset: "gather" });
  assert.deepEqual([signs.nodes.get("minecraft:oak_sign").crafts, signs.nodes.get("minecraft:oak_sign").spare], [4, 2]);
  assert.deepEqual(Object.fromEntries(leavesOf(signs).map((n) => [n.id, n.net])), { "minecraft:oak_planks": 26 });
  // weathering and concrete are recipes too
  assert.deepEqual(leaves(book, "gather", [{ item: "minecraft:exposed_copper", n: 2 }]), { copper_block: 2 });
  assert.deepEqual(leaves(book, "gather", [{ item: "minecraft:white_concrete", n: 16 }]), { sand: 8, gravel: 8, white_dye: 2 });
  // a mod's storage pair: rice is gathered (never unpacked from its bag), the bag is nine rice
  assert.equal(recipeOf(book, "fd:rice"), null);
  assert.deepEqual(leaves(book, "gather", [{ item: "fd:rice_bag", n: 2 }, { item: "fd:rice_cake", n: 3 }]), { "fd:rice": 24 });
  // what only a machine makes is never the cheap way: a cake is milk, sugar, eggs and wheat, not seven slices
  assert.deepEqual(recipeOf(book, "minecraft:cake")[2].map(([k]) => k), ["minecraft:egg", "minecraft:milk_bucket", "minecraft:sugar", "minecraft:wheat"]);
  assert.equal(noteOf(book, "fd:cake_slice", null, {}), "made by cutting (fd)");
  // the bone meal from bones, not from a bone block (which is made of bone meal)
  assert.deepEqual(recipeOf(book, "minecraft:bone_meal")[2], [["minecraft:bone", 1]]);
  assert.equal(noteOf(book, "minecraft:short_grass", null, {}), "shears");
  // a crop is gathered, whatever a mod also makes it from; bread is wheat, not the mod's dough
  assert.equal(recipeOf(book, "fd:cabbage"), null);
  assert.deepEqual(recipeOf(book, "minecraft:bread")[2], [["minecraft:wheat", 3]]);
});

test("a set (any planks) counts as one of its members, sharing its row and what the person has", async () => {
  const book = await bookOf();
  const chests = [{ item: "minecraft:chest", n: 10, from: "minecraft:chest" }];
  const p = plan(book, chests, { preset: "gather" });
  const planks = p.nodes.get("minecraft:oak_planks");
  assert.deepEqual([planks.net, planks.anyOf], [80, ["#minecraft:planks"]]);
  assert.equal(altText(book, planks), "or Spruce Planks");
  assert.equal(p.nodes.has("#minecraft:planks"), false, "no row of its own");
  // having oak planks covers the chests' planks
  assert.deepEqual(leaves(book, "gather", chests, { have: { "minecraft:oak_planks": 80 } }), { oak_planks: 0 });
  // the build's own spruce planks make the chests' planks spruce, on one row with them
  assert.deepEqual(leaves(book, "gather", [...chests, { item: "minecraft:spruce_planks", n: 5 }], { prefer: new Map([["minecraft:spruce_planks", 5]]) }), { spruce_planks: 85 });
  // and what the first pass asks for by name decides it when nothing placed does: the signs' oak planks
  // (80 for the chests, 6 for one craft of signs, 2 for its stick)
  assert.deepEqual(leaves(book, "gather", [...chests, { item: "minecraft:oak_sign", n: 3 }]), { oak_planks: 88 });
  // the same set spelled two ways is one row: torches from coal or charcoal
  const torches = plan(book, [{ item: "minecraft:torch", n: 8 }], { preset: "gather", open: { "minecraft:torch": true } });
  assert.deepEqual(leavesOf(torches).map((n) => n.id).sort(), ["minecraft:coal", "minecraft:oak_planks"]);
  assert.equal(nameOf("#minecraft:smelts_to_glass", book), "Sand or Red Sand");
  assert.equal(memberOf(book, "#minecraft:smelts_to_glass", new Map([["minecraft:red_sand", 3]])), "minecraft:red_sand");
});

test("having something mid-recipe, ticking, breaking down by hand, a recipe that loops", async () => {
  const book = await bookOf();
  const anvils = [{ item: "minecraft:anvil", n: 4, from: "minecraft:anvil" }];
  // the four anvils take 12 iron blocks and 16 ingots: with 2 blocks in hand, 10 blocks are made, 106 ingots in all
  const p = plan(book, anvils, { preset: "gather", have: { "minecraft:iron_block": 2 } });
  assert.deepEqual([p.nodes.get("minecraft:iron_block").net, p.nodes.get("minecraft:iron_block").crafts, p.nodes.get("minecraft:iron_ingot").net], [10, 10, 106]);
  assert.deepEqual([...p.uses.get("minecraft:iron_ingot")], [["minecraft:anvil", 16], ["minecraft:iron_block", 90]]);
  assert.deepEqual([...p.roots.get("minecraft:iron_ingot")], ["minecraft:anvil"]);
  // having more than is needed takes it all and no more
  assert.equal(plan(book, anvils, { preset: "gather", have: { "minecraft:iron_block": 50 } }).nodes.get("minecraft:iron_ingot").net, 16);
  // ticked: all of it in hand, nothing below it
  assert.equal(plan(book, anvils, { preset: "gather", done: { "minecraft:anvil": true } }).nodes.get("minecraft:iron_ingot"), undefined);
  // getting the iron blocks as they are: the anvil's branch closed by hand
  assert.deepEqual(leavesOf(plan(book, anvils, { preset: "gather", open: { "minecraft:iron_block": false } })).map((n) => [n.id, n.net]), [["minecraft:iron_ingot", 16], ["minecraft:iron_block", 12]]);
  // Placed with one item made by hand
  assert.deepEqual(leavesOf(plan(book, anvils, { preset: "placed", open: { "minecraft:anvil": true } })).map((n) => [n.id, n.net]), [["minecraft:iron_ingot", 16], ["minecraft:iron_block", 12]]);
  // bone meal from a bone block, while a bone block is made of bone meal: a loop, refused; from bones, fine
  const list = book.recipes["minecraft:bone_meal"], fromBlock = list.findIndex((r) => r[2][0][0] === "minecraft:bone_block"), fromBone = list.findIndex((r) => r[2][0][0] === "minecraft:bone");
  assert.equal(wouldLoop(book, "minecraft:bone_meal", fromBlock), true);
  assert.equal(wouldLoop(book, "minecraft:bone_meal", fromBone), false);
  assert.equal(wouldLoop(book, "minecraft:iron_block", 0), false);
});

test("groups take what the person has in order, and their totals add up", async () => {
  const book = await bookOf();
  const two = (key) => ({ key, demand: [{ item: "minecraft:anvil", n: 2, from: "minecraft:anvil" }] });
  // two anvils: 6 blocks (54 ingots) and 8 ingots; 10 ingots in hand go to the first group
  const g = planGroups(book, [two(0), two(1)], { preset: "gather", have: { "minecraft:iron_ingot": 10 } });
  assert.deepEqual(g.sections.map((s) => s.plan.nodes.get("minecraft:iron_ingot")).map((n) => [n.have, n.net]), [[10, 52], [0, 62]]);
  assert.deepEqual([g.totals.items, g.totals.kinds, g.gross.items], [114, 1, 124]);
  assert.equal(g.all.nodes.get("minecraft:iron_ingot").gross, 124, "the whole scope at once, for the tree and the hover");
  // one group: its plan is the whole scope's
  const one = planGroups(book, [two("all")], { preset: "gather" });
  assert.equal(one.sections[0].plan, one.all);
});

test("units and what a person types", async () => {
  const book = await bookOf();
  assert.equal(packText(811, "minecraft:deepslate", { units: "items" }), "811");
  assert.equal(packText(811, "minecraft:deepslate", { units: "stacks" }), "12×64 + 43");
  assert.equal(packText(2000, "minecraft:deepslate", { units: "shulkers" }), "1 sb + 4×64 + 16");
  assert.equal(packText(40, "minecraft:oak_sign", { units: "stacks" }), "2×16 + 8");
  assert.equal(packText(3, "minecraft:water_bucket", { units: "stacks" }), "3 × 1");
  assert.equal(packText(1000, "minecraft:iron_ingot", { units: "stacks", compact: true, book }), "111 blocks + 1");
  assert.equal(packText(9, "minecraft:iron_ingot", { units: "stacks", compact: true, book }), "1 block");
  assert.deepEqual([stackOf("minecraft:oak_sign"), stackOf("minecraft:bucket"), stackOf("minecraft:water_bucket"), stackOf("minecraft:red_bed"), stackOf("minecraft:stone")], [16, 16, 1, 1, 64]);
  assert.equal(parseHave("120", "minecraft:stone"), 120);
  assert.equal(parseHave("2s + 5", "minecraft:stone"), 133);
  assert.equal(parseHave("1sb", "minecraft:oak_sign"), 432);
  assert.equal(parseHave("3b", "minecraft:iron_ingot", book), 27);
  assert.equal(parseHave("3b", "minecraft:stone", book), null, "stone has no 9-to-1 block");
  assert.equal(parseHave("1,200", "minecraft:stone"), 1200);
  assert.equal(parseHave("", "minecraft:stone"), 0);
  assert.equal(parseHave("lots", "minecraft:stone"), null);
});

test("counting a scope: layers, hidden cells, signs' dye and wax, framed materials, fluids, waterlogging, groups", async () => {
  // 4 × 3 × 1: layer 0 stone, stone, water, a waterlogged fence; layer 1 a waxed glowing yellow sign, a framed drawer,
  // a door's lower half, air; layer 2 the door's upper half, a double slab, an unknown block, air
  const W = 4, H = 3, L = 1;
  const keys = ["minecraft:air", "minecraft:stone", "minecraft:water[level=0]", "minecraft:oak_wall_sign[facing=south]", "storagedrawers:framed_full_drawers_1[facing=north]", "minecraft:oak_door[half=lower]", "minecraft:oak_door[half=upper]", "minecraft:oak_slab[type=double]", "somemod:mystery", "minecraft:oak_fence[waterlogged=true]"];
  const palette = Object.fromEntries(keys.map((k, i) => [k, i32(i)]));
  const data = [1, 1, 2, 9, 3, 4, 5, 0, 6, 7, 8, 0];
  const be = [
    { Id: "minecraft:sign", Pos: new Int32Array([0, 1, 0]), is_waxed: { t: 1, v: 1 }, front_text: { messages: { t: 9, et: 8, v: ["hi", "", "", ""] }, color: "yellow", has_glowing_text: { t: 1, v: 1 } } },
    { Id: "storagedrawers:framed_full_drawers_1", Pos: new Int32Array([1, 1, 0]), MatS: { id: "minecraft:oak_log", count: i32(1) }, MatT: { id: "minecraft:stone", count: i32(1) } },
  ];
  const nbt = { name: "", value: { Version: i32(2), DataVersion: i32(4000), Width: i16(W), Height: i16(H), Length: i16(L), Offset: new Int32Array([0, 0, 0]), PaletteMax: i32(keys.length), Palette: palette, BlockData: encodeVarints(data), BlockEntities: { t: 9, et: 10, v: be } } };
  const s = await Schematic.load(await gzip(encodeNbt(nbt)), "t.schem");
  const lookup = { has: (id) => id !== "somemod:mystery" && id !== "minecraft:oak_wall_sign" };
  const matItem = (t) => (t === "raw" ? null : t.includes("-") ? t.replace("-", ":") : `minecraft:${t}`);
  const all = countScope(s, { lookup, framed: s.framedCells(), matItem }).get("all");
  assert.deepEqual(Object.fromEntries(all.placed), { "minecraft:stone": 2, "minecraft:oak_fence": 1, "minecraft:oak_sign": 1, "storagedrawers:framed_full_drawers_1": 1, "minecraft:oak_door": 1, "minecraft:oak_slab": 2 });
  assert.deepEqual([Object.fromEntries(all.fluids), all.wet], [{ "minecraft:water_bucket": 1 }, 1]);
  assert.deepEqual(Object.fromEntries(all.unknown), { "somemod:mystery": 1 });
  assert.deepEqual(all.extras.map((e) => [e.item, e.n, e.from]).sort(), [["minecraft:glow_ink_sac", 1, "minecraft:oak_sign"], ["minecraft:honeycomb", 1, "minecraft:oak_sign"], ["minecraft:oak_log", 1, "storagedrawers:framed_full_drawers_1"], ["minecraft:stone", 1, "storagedrawers:framed_full_drawers_1"], ["minecraft:yellow_dye", 1, "minecraft:oak_sign"], ["storagedrawers:framing_table", 1, "storagedrawers:framing_table"]], "and one framing table for all of them");
  // layer 0 only, with one stone hidden
  const low = countScope(s, { lo: 0, hi: 0, hidden: new Set([0]), lookup }).get("all");
  assert.deepEqual(Object.fromEntries(low.placed), { "minecraft:stone": 1, "minecraft:oak_fence": 1 });
  assert.equal(low.extras.length, 0);
  // one group per layer; the framing table goes with the group of the first framed block
  const byLayer = countScope(s, { lookup, groupOf: (i) => Math.floor(i / s.perLayer), framed: s.framedCells(), matItem });
  assert.deepEqual([...byLayer.keys()].sort(), [0, 1, 2]);
  assert.deepEqual(Object.fromEntries(byLayer.get(2).placed), { "minecraft:oak_slab": 2 });
  assert.ok(byLayer.get(1).extras.some((e) => e.item === "storagedrawers:framing_table"));
  // the totals round each row up to whole stacks and count each item once
  assert.deepEqual(totalsOf([{ id: "minecraft:stone", net: 65 }, { id: "minecraft:oak_sign", net: 17 }, { id: "minecraft:stone", net: 1 }]), { items: 83, kinds: 2, stacks: 5, shulkers: 5 / 27, trips: 5 / 36 });
});
