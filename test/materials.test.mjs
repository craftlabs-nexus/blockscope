// node --test: the materials list (src/materials/): the recipe book read from jar-shaped zips, blocks to items, the
// count of a scope, the rollups and what having something mid-recipe takes off.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { encodeNbt, gzip, encodeVarints } from "../src/nbt.js";
import { Schematic } from "../src/schematic.js";
import { buildBook } from "../src/materials/book.js";
import { blockItems, countScope, prepareBook, plan, leavesOf, totalsOf, packText, parseHave, nameOf, noteOf, stackOf, memberOf } from "../src/materials/engine.js";

const i32 = (v) => ({ t: 3, v }), i16 = (v) => ({ t: 2, v });
const json = (o) => JSON.stringify(o);

/** A client jar in miniature: items with names and models, a few recipes in each format, tags, a loop. */
async function jar() {
  const z = new JSZip();
  const item = (id, model) => z.file(`assets/minecraft/items/${id}.json`, json({ model: { type: "minecraft:model", model } }));
  for (const id of ["iron_ingot", "iron_nugget", "stick", "oak_sign"]) { item(id, `minecraft:item/${id}`); z.file(`assets/minecraft/models/item/${id}.json`, json({ parent: "minecraft:item/generated", textures: { layer0: `minecraft:item/${id}` } })); }
  for (const id of ["iron_block", "anvil", "oak_planks", "oak_log", "chest", "deepslate", "cobbled_deepslate", "deepslate_bricks", "stone", "cobblestone", "glass", "sand", "red_sand", "copper_block", "exposed_copper", "white_concrete", "white_concrete_powder", "white_dye", "gravel", "oak_door", "candle", "cauldron", "water_bucket", "flower_pot", "poppy", "redstone", "torch", "oak_slab"]) {
    item(id, `minecraft:block/${id}`);
  }
  z.file("assets/minecraft/models/block/deepslate.json", json({ parent: "minecraft:block/cube_column", textures: { end: "minecraft:block/deepslate_top", side: "minecraft:block/deepslate" } }));
  z.file("assets/minecraft/models/block/glass.json", json({ parent: "minecraft:block/cube_all", textures: { all: { sprite: "minecraft:block/glass", force_translucent: true } } }));
  z.file("assets/minecraft/lang/en_us.json", json({ "block.minecraft.iron_block": "Block of Iron", "item.minecraft.iron_ingot": "Iron Ingot", "block.minecraft.anvil": "Anvil", "block.minecraft.oak_planks": "Oak Planks" }));
  const r = (name, o) => z.file(`data/minecraft/recipe/${name}.json`, json(o));
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
  // a mod's crop: no item of the block's name, its loot table drops the crop and its seeds
  for (const id of ["cabbage", "cabbage_seeds"]) z.file(`assets/fd/items/${id}.json`, json({ model: { type: "minecraft:model", model: `fd:item/${id}` } }));
  z.file("data/fd/loot_table/blocks/cabbages.json", json({ type: "minecraft:block", pools: [{ entries: [{ type: "minecraft:alternatives", children: [{ type: "minecraft:item", name: "fd:cabbage", conditions: [{ condition: "minecraft:block_state_property" }] }, { type: "minecraft:item", name: "fd:cabbage_seeds" }] }] }] }));
  z.file("data/minecraft/loot_table/blocks/stone.json", json({ type: "minecraft:block", pools: [{ entries: [{ type: "minecraft:item", name: "minecraft:cobblestone" }] }] }));
  z.file("data/minecraft/tags/item/planks.json", json({ values: ["minecraft:oak_planks", "minecraft:not_an_item"] }));
  z.file("data/minecraft/tags/item/oak_logs.json", json({ values: ["minecraft:oak_log"] }));
  z.file("data/minecraft/tags/item/smelts_to_glass.json", json({ values: ["minecraft:sand", "minecraft:red_sand"] }));
  return z;
}

test("book: items, names, icons, recipes in every format, tags, storage pairs", async () => {
  const b = await buildBook([await jar()]);
  assert.deepEqual(b.items["minecraft:iron_ingot"], ["Iron Ingot", ["f", "minecraft:item/iron_ingot"]]);
  assert.deepEqual(b.items["minecraft:deepslate"][1], ["c", "minecraft:block/deepslate_top", "minecraft:block/deepslate", "minecraft:block/deepslate"]);
  assert.deepEqual(b.items["minecraft:glass"][1], ["c", "minecraft:block/glass", "minecraft:block/glass", "minecraft:block/glass"], "a texture given as { sprite }");
  assert.equal(b.items["minecraft:oak_door"][0], null, "no name in the lang file");
  assert.deepEqual(b.recipes["minecraft:anvil"], [["craft", 1, [["minecraft:iron_block", 3], ["minecraft:iron_ingot", 4]]]]);
  // a one-member tag is its member; an unknown member is dropped; a conventional tag no jar defines is guessed
  assert.deepEqual(b.recipes["minecraft:chest"], [["craft", 1, [["minecraft:oak_planks", 8]]]]);
  assert.deepEqual(b.recipes["minecraft:oak_sign"][0][2], [["minecraft:oak_planks", 6], ["minecraft:stick", 1]]);
  assert.deepEqual(b.tags["#minecraft:smelts_to_glass"], ["minecraft:sand", "minecraft:red_sand"]);
  assert.deepEqual(b.recipes["minecraft:candle"][0][2].map(([k]) => (k.startsWith("#~") ? b.tags[k] : k)), [["minecraft:stick", "minecraft:torch"], "minecraft:iron_ingot"], "the older { item } format and alternatives");
  assert.equal(b.recipes["minecraft:gravel"], undefined, "a mod's machine is not followed");
  assert.deepEqual(b.blocks, { "fd:cabbages": ["fd:cabbage_seeds"] }, "a block with an item of its own name needs no entry");
  assert.deepEqual(blockItems("fd:cabbages[age=3]", { has: (id) => id in b.items, from: (id) => b.blocks[id] }), { items: [["fd:cabbage_seeds", 1]] });
  assert.deepEqual(b.packs, { "minecraft:iron_ingot": "minecraft:iron_block", "minecraft:iron_nugget": "minecraft:iron_ingot" });
});

test("blocks to items", () => {
  const has = (id) => !/^minecraft:(dark_oak_wall_sign|wall_torch|potted_poppy|redstone_wire|water|lava|carrots)$/.test(id);
  assert.deepEqual(blockItems("minecraft:dark_oak_wall_sign[facing=north]", has), { items: [["minecraft:dark_oak_sign", 1]] });
  assert.deepEqual(blockItems("minecraft:wall_torch[facing=east]", has), { items: [["minecraft:torch", 1]] });
  assert.deepEqual(blockItems("minecraft:redstone_wire[power=0]", has), { items: [["minecraft:redstone", 1]] });
  assert.equal(blockItems("minecraft:oak_door[half=upper,facing=north]", has), null);
  assert.deepEqual(blockItems("minecraft:oak_door[half=lower,facing=north]", has), { items: [["minecraft:oak_door", 1]] });
  assert.equal(blockItems("minecraft:red_bed[part=head]", has), null);
  assert.deepEqual(blockItems("minecraft:oak_slab[type=double]", has), { items: [["minecraft:oak_slab", 2]] });
  assert.deepEqual(blockItems("minecraft:oak_slab[type=top]", has), { items: [["minecraft:oak_slab", 1]] });
  assert.deepEqual(blockItems("minecraft:candle[candles=3,lit=false]", has), { items: [["minecraft:candle", 3]] });
  assert.deepEqual(blockItems("minecraft:water_cauldron[level=3]", has), { items: [["minecraft:cauldron", 1], ["minecraft:water_bucket", 1]] });
  assert.deepEqual(blockItems("minecraft:potted_poppy", has), { items: [["minecraft:flower_pot", 1], ["minecraft:poppy", 1]] });
  assert.deepEqual(blockItems("minecraft:water[level=0]", has), { fluid: "minecraft:water_bucket" });
  assert.equal(blockItems("minecraft:water[level=3]", has), null, "flowing water is not a source");
  assert.equal(blockItems("minecraft:air", has), null);
  assert.equal(blockItems("minecraft:piston_head[facing=up]", has), null);
  assert.deepEqual(blockItems("minecraft:carrots[age=7]", has), { items: [["minecraft:carrot", 1]] });
  assert.deepEqual(blockItems("somemod:strange_thing", () => false), { unknown: "somemod:strange_thing" });
});

test("rollups: placed, gather, raw; a loop with no way in; the stonecutter wins", async () => {
  const book = prepareBook(await buildBook([await jar()]));
  const leaves = (preset, demand, opts = {}) => Object.fromEntries(leavesOf(plan(book, demand, { preset, ...opts })).map((n) => [n.id.replace("minecraft:", ""), n.net]));
  const anvils = [{ item: "minecraft:anvil", n: 4, from: "minecraft:anvil" }];
  assert.deepEqual(leaves("placed", anvils), { anvil: 4 });
  assert.deepEqual(leaves("gather", anvils), { iron_ingot: 124 });
  // deepslate and cobbled deepslate make each other: cobbled is gathered, deepslate smelted from it (Raw only)
  const bricks = [{ item: "minecraft:deepslate_bricks", n: 10 }, { item: "minecraft:deepslate", n: 5 }];
  assert.deepEqual(leaves("gather", bricks), { cobbled_deepslate: 10, deepslate: 5 });
  assert.deepEqual(leaves("raw", bricks), { cobbled_deepslate: 15 });
  assert.equal(noteOf(book, "minecraft:deepslate", null, { preset: "gather" }), "Silk Touch, or smelt Cobbled Deepslate");
  // whole crafts: 10 chests are 80 planks, 20 logs; 10 signs are 4 crafts of 3, 24 planks and 4 sticks (1 craft of 4)
  assert.deepEqual(leaves("gather", [{ item: "minecraft:chest", n: 10 }]), { oak_planks: 80 });
  assert.deepEqual(leaves("raw", [{ item: "minecraft:chest", n: 10 }]), { oak_log: 20 });
  const signs = plan(book, [{ item: "minecraft:oak_sign", n: 10 }], { preset: "gather" });
  assert.deepEqual([signs.nodes.get("minecraft:oak_sign").crafts, signs.nodes.get("minecraft:oak_sign").spare], [4, 2]);
  assert.deepEqual(Object.fromEntries(leavesOf(signs).map((n) => [n.id, n.net])), { "minecraft:oak_planks": 26 });
  // weathering and concrete are recipes too
  assert.deepEqual(leaves("gather", [{ item: "minecraft:exposed_copper", n: 2 }]), { copper_block: 2 });
  assert.deepEqual(leaves("gather", [{ item: "minecraft:white_concrete", n: 16 }]), { sand: 8, gravel: 8, white_dye: 2 });
  // a tag reads as its members when it is short
  assert.equal(nameOf("#minecraft:smelts_to_glass", book), "Sand or Red Sand");
  assert.equal(memberOf(book, "#minecraft:smelts_to_glass", new Map([["minecraft:red_sand", 3]])), "minecraft:red_sand");
});

test("having something mid-recipe, ticking, breaking down by hand", async () => {
  const book = prepareBook(await buildBook([await jar()]));
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
  const closed = plan(book, anvils, { preset: "gather", open: { "minecraft:iron_block": false } });
  assert.deepEqual(leavesOf(closed).map((n) => [n.id, n.net]), [["minecraft:iron_ingot", 16], ["minecraft:iron_block", 12]]);
  // Placed with one item made by hand
  assert.deepEqual(leavesOf(plan(book, anvils, { preset: "placed", open: { "minecraft:anvil": true } })).map((n) => [n.id, n.net]), [["minecraft:iron_ingot", 16], ["minecraft:iron_block", 12]]);
});

test("units and what a person types", async () => {
  const book = prepareBook(await buildBook([await jar()]));
  assert.equal(packText(811, "minecraft:deepslate", { units: "items" }), "811");
  assert.equal(packText(811, "minecraft:deepslate", { units: "stacks" }), "12×64 + 43");
  assert.equal(packText(2000, "minecraft:deepslate", { units: "shulkers" }), "1 sb + 4×64 + 16");
  assert.equal(packText(40, "minecraft:oak_sign", { units: "stacks" }), "2×16 + 8");
  assert.equal(packText(3, "minecraft:water_bucket", { units: "stacks" }), "3 × 1");
  assert.equal(packText(1000, "minecraft:iron_ingot", { units: "stacks", compact: true, book }), "1×64 + 47 blocks + 1");
  assert.deepEqual([stackOf("minecraft:oak_sign"), stackOf("minecraft:bucket"), stackOf("minecraft:water_bucket"), stackOf("minecraft:red_bed"), stackOf("minecraft:stone")], [16, 16, 1, 1, 64]);
  assert.equal(parseHave("120", "minecraft:stone"), 120);
  assert.equal(parseHave("2s + 5", "minecraft:stone"), 133);
  assert.equal(parseHave("1sb", "minecraft:oak_sign"), 432);
  assert.equal(parseHave("3b", "minecraft:iron_ingot", book), 27);
  assert.equal(parseHave("1,200", "minecraft:stone"), 1200);
  assert.equal(parseHave("", "minecraft:stone"), 0);
  assert.equal(parseHave("lots", "minecraft:stone"), null);
});

test("counting a scope: layers, hidden cells, signs' dye and wax, framed materials, fluids, groups", async () => {
  // 3 × 3 × 1: layer 0 stone, stone, water; layer 1 a waxed glowing yellow sign, a framed drawer, a door's lower half;
  // layer 2 the door's upper half, a double slab, an unknown block
  const W = 3, H = 3, L = 1;
  const keys = ["minecraft:air", "minecraft:stone", "minecraft:water[level=0]", "minecraft:oak_wall_sign[facing=south]", "storagedrawers:framed_full_drawers_1[facing=north]", "minecraft:oak_door[half=lower]", "minecraft:oak_door[half=upper]", "minecraft:oak_slab[type=double]", "somemod:mystery"];
  const palette = Object.fromEntries(keys.map((k, i) => [k, i32(i)]));
  const data = [1, 1, 2, 3, 4, 5, 6, 7, 8];
  const be = [
    { Id: "minecraft:sign", Pos: new Int32Array([0, 1, 0]), is_waxed: { t: 1, v: 1 }, front_text: { messages: { t: 9, et: 8, v: ["hi", "", "", ""] }, color: "yellow", has_glowing_text: { t: 1, v: 1 } } },
    { Id: "storagedrawers:framed_full_drawers_1", Pos: new Int32Array([1, 1, 0]), MatS: { id: "minecraft:oak_log", count: i32(1) }, MatT: { id: "minecraft:stone", count: i32(1) } },
  ];
  const nbt = { name: "", value: { Version: i32(2), DataVersion: i32(4000), Width: i16(W), Height: i16(H), Length: i16(L), Offset: new Int32Array([0, 0, 0]), PaletteMax: i32(keys.length), Palette: palette, BlockData: encodeVarints(data), BlockEntities: { t: 9, et: 10, v: be } } };
  const s = await Schematic.load(await gzip(encodeNbt(nbt)), "t.schem");
  const has = (id) => id !== "somemod:mystery" && id !== "minecraft:oak_wall_sign";
  const matItem = (t) => (t === "raw" ? null : t.includes("-") ? t.replace("-", ":") : `minecraft:${t}`);
  const all = countScope(s, { has, framed: s.framedCells(), matItem }).get("all");
  assert.deepEqual(Object.fromEntries(all.placed), { "minecraft:stone": 2, "minecraft:oak_sign": 1, "storagedrawers:framed_full_drawers_1": 1, "minecraft:oak_door": 1, "minecraft:oak_slab": 2 });
  assert.deepEqual(Object.fromEntries(all.fluids), { "minecraft:water_bucket": 1 });
  assert.deepEqual(Object.fromEntries(all.unknown), { "somemod:mystery": 1 });
  assert.deepEqual(all.extras.map((e) => [e.item, e.n, e.from]).sort(), [["minecraft:glow_ink_sac", 1, "minecraft:oak_sign"], ["minecraft:honeycomb", 1, "minecraft:oak_sign"], ["minecraft:oak_log", 1, "storagedrawers:framed_full_drawers_1"], ["minecraft:stone", 1, "storagedrawers:framed_full_drawers_1"], ["minecraft:yellow_dye", 1, "minecraft:oak_sign"], ["storagedrawers:framing_table", 1, "storagedrawers:framing_table"]], "and one framing table for all of them");
  // layer 0 only, with one stone hidden
  const low = countScope(s, { lo: 0, hi: 0, hidden: new Set([0]), has }).get("all");
  assert.deepEqual(Object.fromEntries(low.placed), { "minecraft:stone": 1 });
  assert.equal(low.extras.length, 0);
  // one group per layer
  const byLayer = countScope(s, { has, groupOf: (i) => Math.floor(i / s.perLayer) });
  assert.deepEqual([...byLayer.keys()].sort(), [0, 1, 2]);
  assert.deepEqual(Object.fromEntries(byLayer.get(2).placed), { "minecraft:oak_slab": 2 });
  // the totals round each item up to whole stacks
  assert.deepEqual(totalsOf([{ id: "minecraft:stone", net: 65 }, { id: "minecraft:oak_sign", net: 17 }]), { items: 82, kinds: 2, stacks: 4, shulkers: 4 / 27, trips: 4 / 36 });
});
