// node --test: kinds and types (src/kinds.js) on small schematics built here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeNbt, gzip, encodeVarints } from "../src/nbt.js";
import { Schematic } from "../src/schematic.js";
import { classify, typesOf, kindsOfId, kindsShown, kindsOfMask, KINDS, KIND_BIT, REDSTONE_REASONS, KINDS_MIN_BLOCKS, KINDS_MIN_SECOND } from "../src/kinds.js";

const i32 = (v) => ({ t: 3, v }), i16 = (v) => ({ t: 2, v });

/** A W × H × L Sponge schematic of air with `blocks` ("x,y,z" -> palette key) placed. */
async function build(W, H, L, blocks) {
  const palette = { "minecraft:air": i32(0) }, data = new Array(W * H * L).fill(0);
  let next = 1;
  for (const [at, key] of Object.entries(blocks)) {
    if (!(key in palette)) palette[key] = i32(next++);
    const [x, y, z] = at.split(",").map(Number);
    data[(y * L + z) * W + x] = palette[key].v;
  }
  const nbt = { name: "", value: { Version: i32(2), DataVersion: i32(4000), Width: i16(W), Height: i16(H), Length: i16(L), Offset: new Int32Array([0, 0, 0]), PaletteMax: i32(next), Palette: palette, BlockData: encodeVarints(data) } };
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
  assert.equal(whyAt(s, k, 4, 1, 3), "powered by a component", "a dot powers its solid neighbours");
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
