// node --test: kinds and types (src/kinds.js) on small schematics built here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeNbt, gzip, encodeVarints } from "../src/nbt.js";
import { Schematic } from "../src/schematic.js";
import { classify, typesOf, familyOf, familiesOf, firstKinds, KIND_ORDER, codeGroups, HiddenCells, kindsOfId, kindsShown, kindsOfMask, KINDS, KIND_BIT, REDSTONE_REASONS, KINDS_MIN_BLOCKS, KINDS_MIN_SECOND } from "../src/kinds.js";

const i32 = (v) => ({ t: 3, v }), i16 = (v) => ({ t: 2, v });

/** A W × H × L Sponge schematic of air with `blocks` ("x,y,z" -> palette key) placed. */
async function build(W, H, L, blocks, dataVersion = 4000) {
  const palette = { "minecraft:air": i32(0) }, data = new Array(W * H * L).fill(0);
  let next = 1;
  for (const [at, key] of Object.entries(blocks)) {
    if (!(key in palette)) palette[key] = i32(next++);
    const [x, y, z] = at.split(",").map(Number);
    data[(y * L + z) * W + x] = palette[key].v;
  }
  const nbt = { name: "", value: { Version: i32(2), DataVersion: i32(dataVersion), Width: i16(W), Height: i16(H), Length: i16(L), Offset: new Int32Array([0, 0, 0]), PaletteMax: i32(next), Palette: palette, BlockData: encodeVarints(data) } };
  return Schematic.load(await gzip(encodeNbt(nbt)), "t.schem");
}
const kindsAt = (s, k, x, y, z) => kindsOfMask(k.mask[s.index(x, y, z)]);
const whyAt = (s, k, x, y, z) => REDSTONE_REASONS[k.reason[s.index(x, y, z)]];

test("kinds by id: vanilla and modded words, and the false friends", () => {
  const has = (id, key) => (kindsOfId(id) & KIND_BIT[key]) !== 0;
  assert.ok(has("minecraft:comparator", "redstone"));
  assert.ok(has("minecraft:hopper", "redstone") && has("minecraft:hopper", "storage"));
  assert.ok(has("minecraft:furnace", "storage") && has("minecraft:furnace", "stations"));
  assert.ok(has("minecraft:sea_lantern", "lighting") && has("mcwlights:iron_chandelier", "lighting"));
  assert.ok(!has("minecraft:redstone_torch", "lighting"), "a redstone torch is redstone, not lighting");
  assert.ok(!has("mcwfurnitures:light_gray_chair", "lighting"), "light gray is a colour");
  assert.ok(has("minecraft:grass_block", "terrain") && !has("minecraft:grass_block", "plants"));
  assert.ok(has("minecraft:short_grass", "plants") && has("minecraft:iron_ore", "terrain"));
  assert.ok(!has("minecraft:stone_bricks", "terrain") && !has("minecraft:cobblestone_stairs", "terrain"), "shaped blocks are building");
  assert.ok(has("minecraft:oak_fence", "fences") && !has("minecraft:oak_fence_gate", "fences") && has("minecraft:oak_fence_gate", "openings"));
  assert.ok(has("minecraft:cobblestone_wall", "fences") && !has("minecraft:oak_wall_sign", "fences") && has("minecraft:oak_wall_sign", "signs"));
  assert.ok(has("minecraft:rail", "rails") && !has("mcwfences:railing_gate", "rails"));
  assert.ok(has("storagedrawers:oak_full_drawers_1", "storage") && has("minecraft:light_blue_stained_glass_pane", "glass"));
  assert.equal(kindsOfId("minecraft:oak_log"), 0, "a log is a tree's only beside its leaves");
});

test("redstone: what a wire stands on and points into, and a lone dot's neighbours", async () => {
  const s = await build(5, 3, 5, {
    "1,0,1": "minecraft:stone", "1,1,1": "minecraft:redstone_wire[east=side,north=none,south=none,west=none,power=0]", "2,1,1": "minecraft:stone", "0,1,1": "minecraft:stone",
    "3,0,3": "minecraft:stone", "3,1,3": "minecraft:redstone_wire[east=none,north=none,south=none,west=none,power=0]", "4,1,3": "minecraft:oak_planks", "3,1,4": "minecraft:glass",
  });
  const k = classify(s);
  assert.deepEqual(kindsAt(s, k, 1, 1, 1), ["redstone"]);
  assert.equal(whyAt(s, k, 1, 1, 1), "a component");
  assert.equal(whyAt(s, k, 1, 0, 1), "holds a component");
  assert.equal(whyAt(s, k, 2, 1, 1), "powered by a component", "the wire runs into it");
  assert.deepEqual(kindsAt(s, k, 0, 1, 1), ["terrain"], "the wire does not point west");
  assert.equal(k.reason[s.index(4, 1, 3)], 0, "a dot (since 1.16) powers only what it stands on");
  assert.equal(whyAt(s, k, 3, 0, 3), "holds a component");
  assert.deepEqual(kindsAt(s, k, 3, 1, 4), ["glass"], "glass is not solid");
});

test("redstone: a comparator reads a chest through a block, and powers what is in front", async () => {
  // facing west: it reads from the west (its facing) and outputs east
  const s = await build(5, 2, 1, { "3,1,0": "minecraft:comparator[facing=west,mode=compare,powered=false]", "3,0,0": "minecraft:stone", "2,1,0": "minecraft:stone", "1,1,0": "minecraft:chest[facing=north,type=single]", "4,1,0": "minecraft:oak_planks", "0,1,0": "minecraft:barrel[facing=up]" });
  const k = classify(s);
  assert.equal(whyAt(s, k, 2, 1, 0), "read by a comparator");
  assert.equal(whyAt(s, k, 1, 1, 0), "read by a comparator");
  assert.deepEqual(kindsAt(s, k, 1, 1, 0), ["redstone", "storage"]);
  assert.equal(whyAt(s, k, 4, 1, 0), "powered by a component");
  assert.equal(whyAt(s, k, 3, 0, 0), "holds a component");
  assert.deepEqual(kindsAt(s, k, 0, 1, 0), ["storage"], "two blocks away: not read");
});

test("redstone: a piston pushes the line in front of it, up to air", async () => {
  const s = await build(7, 1, 1, { "0,0,0": "minecraft:piston[extended=false,facing=east]", "1,0,0": "minecraft:stone", "2,0,0": "minecraft:dirt", "3,0,0": "minecraft:oak_planks", "5,0,0": "minecraft:stone" });
  const k = classify(s);
  for (const x of [1, 2, 3]) assert.equal(whyAt(s, k, x, 0, 0), "pushed by a piston");
  assert.equal(k.reason[s.index(5, 0, 0)], 0, "past the gap");
  // an obsidian block stops the line
  const t = await build(4, 1, 1, { "0,0,0": "minecraft:sticky_piston[extended=false,facing=east]", "1,0,0": "minecraft:obsidian", "2,0,0": "minecraft:stone" });
  const kt = classify(t);
  assert.equal(kt.reason[t.index(1, 0, 0)], 0); assert.equal(kt.reason[t.index(2, 0, 0)], 0);
});

test("redstone: a hopper feeds the chest it faces and is fed by the one above; a lamp beside a lever is worked", async () => {
  const s = await build(3, 3, 3, { "1,1,1": "minecraft:hopper[enabled=true,facing=down]", "1,2,1": "minecraft:chest[facing=north,type=single]", "1,0,1": "minecraft:barrel[facing=up]", "0,1,1": "minecraft:chest[facing=north,type=single]",
    "2,0,0": "minecraft:lever[face=floor,facing=north,powered=false]", "2,0,1": "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]" });
  const k = classify(s);
  assert.equal(whyAt(s, k, 1, 2, 1), "fed by a hopper or dropper");
  assert.equal(whyAt(s, k, 1, 0, 1), "fed by a hopper or dropper");
  assert.deepEqual(kindsAt(s, k, 0, 1, 1), ["storage"], "beside the hopper: not fed");
  assert.equal(whyAt(s, k, 2, 0, 1), "worked by a component");
  assert.deepEqual(kindsAt(s, k, 2, 0, 1), ["redstone", "openings"]);
});

test("trees: the logs under leaves, not a stripped beam elsewhere", async () => {
  const s = await build(6, 5, 1, { "0,0,0": "minecraft:oak_log[axis=y]", "0,1,0": "minecraft:oak_log[axis=y]", "0,2,0": "minecraft:oak_log[axis=y]", "0,3,0": "minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]",
    "3,1,0": "minecraft:stripped_oak_log[axis=x]", "4,1,0": "minecraft:stripped_oak_log[axis=x]", "5,1,0": "minecraft:stripped_oak_log[axis=x]" });
  const k = classify(s);
  for (const y of [0, 1, 2, 3]) assert.deepEqual(kindsAt(s, k, 0, y, 0), ["trees"]);
  for (const x of [3, 4, 5]) assert.deepEqual(kindsAt(s, k, x, 1, 0), []);
});

test("the shell and the metadata's own kinds", async () => {
  const s = await build(2, 1, 1, { "0,0,0": "minecraft:oak_planks", "1,0,0": "minecraft:stone" });
  const { BlockMeta } = await import("../src/blockmeta.js");
  const meta = new BlockMeta([0, 0, 0], [2, 1, 1], new Uint32Array([1, 0]), [{ kind: ["lighting"] }]);
  const k = classify(s, { shellCells: new Map([[s.index(1, 0, 0), "floor"]]), meta });
  assert.deepEqual(kindsAt(s, k, 0, 0, 0), ["lighting"]);
  assert.deepEqual(kindsAt(s, k, 1, 0, 0), ["terrain", "floor"]);
});

test("kinds shown: at least 64 blocks, two kinds of 2 or more, the second of 8 or more", () => {
  const counts = (o) => KINDS.map((x) => o[x.key] ?? 0);
  assert.deepEqual(kindsShown(counts({ terrain: 50, plants: 8, glass: 1 }), KINDS_MIN_BLOCKS), { listed: ["plants", "terrain"], shown: true });
  assert.equal(kindsShown(counts({ terrain: 50, plants: 8 }), KINDS_MIN_BLOCKS - 1).shown, false);
  assert.equal(kindsShown(counts({ terrain: 60, plants: KINDS_MIN_SECOND - 1 }), 100).shown, false);
  assert.equal(kindsShown(counts({ terrain: 300 }), 300).shown, false, "one kind splits nothing");
});

test("types: by id, the state left out, most blocks first", async () => {
  const s = await build(4, 1, 1, { "0,0,0": "minecraft:oak_stairs[facing=north]", "1,0,0": "minecraft:oak_stairs[facing=south]", "2,0,0": "promenade:blunite", "3,0,0": "minecraft:oak_stairs[facing=east]" });
  const { types, ofPalette } = typesOf(s);
  assert.deepEqual(types, [{ id: "minecraft:oak_stairs", name: "oak stairs", mod: null, count: 3 }, { id: "promenade:blunite", name: "blunite", mod: "promenade", count: 1 }]);
  assert.equal(ofPalette[s.data[s.index(1, 0, 0)]], 1);
  assert.equal(ofPalette[s.data[s.index(2, 0, 0)]], 2);
  assert.equal(ofPalette[0], 0, "air has no type");
});

test("cell groups: one a (part, kinds, type) combination, air 0, and the cells they hide", async () => {
  const s = await build(4, 1, 1, { "0,0,0": "minecraft:stone", "1,0,0": "minecraft:stone", "2,0,0": "minecraft:cobblestone" });
  const { BlockMeta } = await import("../src/blockmeta.js");
  const meta = new BlockMeta([0, 0, 0], [4, 1, 1], new Uint32Array([1, 2, 2, 0]), [{ part: "a" }, { part: "b" }]);
  const part = s.partIndex(meta, ["a", "b"]);
  assert.deepEqual([...part], [1, 2, 2, 0]);
  const k = classify(s), t = typesOf(s), c = codeGroups(s, part, k.mask, t.ofPalette);
  assert.equal(c.typed, true);
  assert.equal(c.groups[3], 0, "air");
  assert.equal(new Set(c.groups.slice(0, 3)).size, 3, "stone in a, stone in b, cobblestone in b");
  const g = c.groups[1];
  assert.deepEqual([c.part[g], c.kinds[g], t.types[c.type[g] - 1].id], [2, KIND_BIT.terrain, "minecraft:stone"]);
  // too many combinations for the code: the types are left out
  const small = codeGroups(s, part, k.mask, t.ofPalette, 2);
  assert.equal(small.typed, false);
  assert.equal(small.groups[1], small.groups[2], "b's stone and cobblestone (both terrain) share a group without their types");
  // hide group of b's stone; the lookup answers per cell and lists like a Set
  const flags = new Uint8Array(c.size); flags[g] = 1;
  const hidden = new HiddenCells(c.groups, flags), extra = new HiddenCells(c.groups, new Uint8Array(c.size), (i) => i === 3);
  assert.deepEqual([0, 1, 2, 3].map((i) => hidden.has(i)), [false, true, false, false]);
  assert.deepEqual([0, 1, 2, 3].map((i) => extra.has(i)), [false, false, false, true]);
});

test("materials by kind: each block in the first of its kinds, what it is for before what it is part of", () => {
  const mask = new Uint16Array([KIND_BIT.lighting | KIND_BIT.roof, KIND_BIT.terrain | KIND_BIT.floor, KIND_BIT.redstone | KIND_BIT.storage, 0]);
  assert.deepEqual([...firstKinds(mask)].map((g) => KIND_ORDER[g] ?? "none"), ["lighting", "floor", "redstone", "none"]);
  assert.deepEqual([...KIND_ORDER].sort(), KINDS.map((k) => k.key).sort(), "every kind has a place");
});

test("families: colours, woods and copper's weathering folded; a lone type stays itself", () => {
  assert.equal(familyOf("minecraft:light_blue_concrete").key, "minecraft:concrete");
  assert.deepEqual(familyOf("minecraft:spruce_stairs"), { key: "minecraft:wooden_stairs", name: "wooden stairs", by: "wood" });
  assert.equal(familyOf("minecraft:dark_oak_planks").name, "planks");
  assert.equal(familyOf("minecraft:stripped_cherry_log").name, "stripped log");
  assert.equal(familyOf("minecraft:waxed_oxidized_copper_chest").key, "minecraft:copper_chest");
  assert.equal(familyOf("mcwfences:oak_picket_fence").key, "mcwfences:wooden_picket_fence", "a mod's families stay in the mod");
  const t = (id, count) => ({ id, name: id.split(":")[1].replace(/_/g, " "), mod: null, count });
  const fams = familiesOf([t("minecraft:stone", 90), t("minecraft:white_concrete", 10), t("minecraft:terracotta", 8), t("minecraft:red_concrete", 5), t("minecraft:orange_terracotta", 4), t("minecraft:oak_stairs", 3), t("minecraft:copper_chest", 2)]);
  assert.deepEqual(fams.map((f) => [f.name, f.count, f.members.length]), [["concrete", 15, 2], ["terracotta", 12, 2]]);
});

test("modded ids: the work blocks are stations, not every table or pot; a wire is redstone only by name", () => {
  const has = (id, key) => (kindsOfId(id) & KIND_BIT[key]) !== 0;
  assert.ok(!has("somemod:barbed_wire", "redstone") && !has("somemod:wire_fence", "redstone"));
  assert.ok(has("create:gearshift", "redstone") && has("somemod:redstone_relay", "redstone"));
  assert.ok(!has("mcwfurnitures:oak_table", "stations") && !has("somemod:flower_pot", "stations"));
  assert.ok(has("farmersdelight:cooking_pot", "stations") && has("farmersdelight:cutting_board", "stations"));
  assert.ok(!has("somemod:light_oak_planks", "lighting") && has("somemod:wall_lamp", "lighting"));
});

test("trees: a nether fungus's stem under its wart blocks, a huge mushroom's stem, a bamboo block by leaves", async () => {
  const s = await build(5, 3, 1, { "0,0,0": "minecraft:crimson_stem[axis=y]", "0,1,0": "minecraft:nether_wart_block", "2,0,0": "minecraft:mushroom_stem[down=true,east=true,north=true,south=true,up=true,west=true]", "2,1,0": "minecraft:red_mushroom_block[down=true,east=true,north=true,south=true,up=true,west=true]", "4,0,0": "minecraft:bamboo_block[axis=y]", "4,1,0": "minecraft:jungle_leaves[distance=1,persistent=true,waterlogged=false]" });
  const k = classify(s);
  for (const [x, y] of [[0, 0], [0, 1], [2, 0], [2, 1], [4, 0], [4, 1]]) assert.ok(kindsAt(s, k, x, y, 0).includes("trees"), `${x},${y}`);
  // a melon's stem is a plant, never a tree's log
  const m = await build(2, 1, 1, { "0,0,0": "minecraft:melon_stem[age=7]", "1,0,0": "minecraft:oak_leaves[distance=1,persistent=true,waterlogged=false]" });
  assert.deepEqual(kindsAt(m, classify(m), 0, 0, 0), ["plants"]);
});

test("families: copper's weathering is one family; colours only of the dyed blocks or of two colours; the nether's no wood", () => {
  for (const id of ["copper_block", "waxed_copper_block", "exposed_copper", "waxed_oxidized_copper"]) assert.equal(familyOf(`minecraft:${id}`).key, "minecraft:copper", id);
  assert.equal(familyOf("minecraft:weathered_lightning_rod").key, "minecraft:lightning_rod");
  assert.equal(familyOf("minecraft:crimson_nylium").by, null);
  assert.equal(familyOf("minecraft:warped_roots").by, null);
  assert.equal(familyOf("minecraft:crimson_planks").name, "planks");
  const t = (id, count) => ({ id: `minecraft:${id}`, name: id, mod: null, count });
  const names = familiesOf([t("sand", 9), t("red_sand", 3), t("nether_bricks", 8), t("red_nether_bricks", 2), t("terracotta", 5), t("orange_terracotta", 2), t("copper_block", 4), t("exposed_copper", 3), t("waxed_weathered_copper", 1)]).map((f) => `${f.name} ${f.members.length}`);
  assert.deepEqual(names, ["copper 3", "terracotta 2"]);
});

test("redstone: a wire with no side connected was a cross before 1.16, powering its solid neighbours", async () => {
  const blocks = { "1,0,1": "minecraft:stone", "1,1,1": "minecraft:redstone_wire[east=none,north=none,south=none,west=none,power=0]", "2,1,1": "minecraft:oak_planks" };
  const old = await build(3, 2, 3, blocks, 2230), now = await build(3, 2, 3, blocks, 3700);
  assert.equal(whyAt(old, classify(old), 2, 1, 1), "powered by a component");
  assert.equal(classify(now).reason[now.index(2, 1, 1)], 0);
});

test("cell groups past every limit: one group, nothing broken", async () => {
  const s = await build(2, 1, 1, { "0,0,0": "minecraft:stone", "1,0,0": "minecraft:chest[facing=north,type=single]" });
  const k = classify(s), t = typesOf(s), c = codeGroups(s, new Uint16Array([1, 2]), k.mask, t.ofPalette, 1);
  assert.deepEqual([c.size, c.typed, [...c.groups]], [1, false, [0, 0]]);
});

test("the metadata's own kinds, over a box of its own", async () => {
  const s = await build(2, 1, 1, { "0,0,0": "minecraft:oak_planks", "1,0,0": "minecraft:oak_planks" });
  const { BlockMeta } = await import("../src/blockmeta.js");
  // one cell wider than the file, starting a cell to the west: the file's cells are the box's second and third
  const meta = new BlockMeta([-1, 0, 0], [3, 1, 1], new Uint32Array([0, 1, 0]), [{ kind: "lighting", part: "a" }]);
  const k = classify(s, { meta });
  assert.deepEqual([kindsAt(s, k, 0, 0, 0), kindsAt(s, k, 1, 0, 0)], [["lighting"], []]);
});

test("redstone: the one hop goes from what gives power, and takes both halves of a door", async () => {
  const door = (half) => `minecraft:oak_door[facing=north,half=${half},hinge=left,open=false,powered=false]`;
  const s = await build(6, 2, 1, { "0,0,0": "minecraft:hopper[enabled=true,facing=down]", "1,0,0": door("lower"), "1,1,0": door("upper"),
    "3,0,0": "minecraft:lever[face=floor,facing=north,powered=false]", "4,0,0": door("lower"), "4,1,0": door("upper") });
  const k = classify(s);
  assert.deepEqual([kindsAt(s, k, 1, 0, 0), kindsAt(s, k, 1, 1, 0)], [["openings"], ["openings"]], "a hopper takes power, it gives none");
  assert.deepEqual([whyAt(s, k, 4, 0, 0), whyAt(s, k, 4, 1, 0)], ["worked by a component", "worked by a component"]);
});

test("redstone: a lightning rod in every weathering", () => {
  for (const id of ["lightning_rod", "exposed_lightning_rod", "waxed_oxidized_lightning_rod"]) assert.ok(kindsOfId(`minecraft:${id}`) & KIND_BIT.redstone, id);
});

test("trees: a trunk under its crown; not a log frame a hedge touches, a potted sapling's shelf, or bamboo", async () => {
  const hedge = "minecraft:oak_leaves[distance=7,persistent=true,waterlogged=false]";
  // a cabin wall of lying logs, a hedge against its west end; its corner post stands at the east end
  const s = await build(5, 3, 2, { "0,0,1": hedge, "0,0,0": "minecraft:spruce_log[axis=x]", "1,0,0": "minecraft:spruce_log[axis=x]", "2,0,0": "minecraft:spruce_log[axis=x]", "3,0,0": "minecraft:spruce_log[axis=y]", "3,1,0": "minecraft:spruce_log[axis=y]",
    "4,0,0": "minecraft:oak_log[axis=y]", "4,1,0": "minecraft:oak_log[axis=y]", "4,2,0": hedge });
  const k = classify(s);
  assert.deepEqual([0, 1, 2, 3].map((x) => kindsAt(s, k, x, 0, 0).includes("trees")), [true, false, false, false], "only the log the hedge touches");
  assert.deepEqual([kindsAt(s, k, 4, 1, 0), kindsAt(s, k, 4, 0, 0)], [["trees"], ["trees"]], "the trunk, all the way down");
  const p = await build(3, 1, 1, { "0,0,0": "minecraft:potted_oak_sapling", "1,0,0": "minecraft:stripped_oak_log[axis=x]", "2,0,0": "minecraft:bamboo[age=0,leaves=none,stage=0]" });
  const kp = classify(p);
  assert.ok(!kindsAt(p, kp, 1, 0, 0).includes("trees"), "a shelf with a potted sapling on it");
  const b = await build(1, 2, 1, { "0,0,0": "minecraft:bamboo[age=0,leaves=none,stage=0]", "0,1,0": "minecraft:jungle_leaves[distance=1,persistent=false,waterlogged=false]" });
  assert.deepEqual(kindsAt(b, classify(b), 0, 0, 0), ["plants"], "bamboo under leaves");
});

test("redstone: a wire beside a chest, a cauldron or a potted plant does not power it", async () => {
  const s = await build(3, 2, 3, { "1,0,1": "minecraft:stone", "1,1,1": "minecraft:redstone_wire[east=side,north=side,south=side,west=side,power=0]",
    "2,1,1": "minecraft:chest[facing=north,type=single,waterlogged=false]", "0,1,1": "minecraft:cauldron", "1,1,0": "minecraft:potted_poppy", "1,1,2": "minecraft:oak_planks" });
  const k = classify(s);
  assert.equal(k.reason[s.index(2, 1, 1)], 0); assert.equal(k.reason[s.index(0, 1, 1)], 0); assert.equal(k.reason[s.index(1, 1, 0)], 0);
  assert.equal(whyAt(s, k, 1, 1, 2), "powered by a component");
});
