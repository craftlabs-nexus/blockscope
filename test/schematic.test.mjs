// node --test: the NBT codec and the in-page schematic preparation, on a schematic built here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNbt, encodeNbt, readNbt, gzip, decodeVarints, encodeVarints } from "../src/nbt.js";
import { Schematic } from "../src/schematic.js";
import { framedViewerId, framedRealId } from "../src/framed.js";
import { partOf, partsOf } from "../src/parts.js";

const i32 = (v) => ({ t: 3, v }), i16 = (v) => ({ t: 2, v });

/** A 3 × 4 × 2 Sponge v2 schematic: stone floor, a sign on layer 1, a framed drawer, a roof of planks on top. */
function sample() {
  const W = 3, H = 4, L = 2;
  const palette = { "minecraft:air": i32(0), "minecraft:stone": i32(1), "minecraft:oak_wall_sign[facing=south,waterlogged=false]": i32(2), "storagedrawers:framed_full_drawers_1[facing=north]": i32(3), "minecraft:oak_planks": i32(4) };
  const data = new Array(W * H * L).fill(0);
  const at = (x, y, z) => (y * L + z) * W + x;
  for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) { data[at(x, 0, z)] = 1; data[at(x, 3, z)] = 4; }
  data[at(1, 1, 1)] = 2; data[at(0, 1, 0)] = 3;
  const be = [
    { Id: "minecraft:sign", Pos: new Int32Array([1, 1, 1]), is_waxed: { t: 1, v: 1 }, front_text: { messages: { t: 9, et: 8, v: ["hello", "", "", ""] }, color: "yellow", has_glowing_text: { t: 1, v: 1 } }, back_text: { messages: { t: 9, et: 8, v: ["", "", "", ""] }, color: "black", has_glowing_text: { t: 1, v: 0 } } },
    { Id: "storagedrawers:framed_full_drawers_1", Pos: new Int32Array([0, 1, 0]), MatS: { id: "minecraft:oak_log", count: i32(1) }, MatT: { id: "promenade:polished_blunite", count: i32(1) } },
  ];
  return { name: "", value: { Version: i32(2), DataVersion: i32(4000), Width: i16(W), Height: i16(H), Length: i16(L), Offset: new Int32Array([10, 64, -5]), PaletteMax: i32(5), Palette: palette, BlockData: encodeVarints(data), BlockEntities: { t: 9, et: 10, v: be } } };
}

test("NBT round trip", async () => {
  const nbt = sample();
  const bytes = encodeNbt(nbt);
  assert.deepEqual(encodeNbt(parseNbt(bytes)), bytes);
  assert.deepEqual(encodeNbt(await readNbt(await gzip(bytes))), bytes);
});

test("varints", () => {
  const v = [0, 1, 127, 128, 300, 16383, 16384, 2 ** 21];
  assert.deepEqual([...decodeVarints(encodeVarints(v))], v);
});

test("schematic: info, signs, namespaces, framed", async () => {
  const s = await Schematic.load(await gzip(encodeNbt(sample())), "t.schem");
  const info = s.info();
  assert.deepEqual([info.width, info.height, info.length, info.offset], [3, 4, 2, [10, 64, -5]]);
  assert.equal(info.topFill, 1);
  assert.deepEqual(s.namespaces(), ["storagedrawers"]);
  assert.equal(s.signs.length, 1);
  assert.deepEqual({ ...s.signs[0], back: s.signs[0].back }, { x: 1, y: 1, z: 1, id: "minecraft:oak_wall_sign", facing: "south", rotation: null, lines: ["hello", "", "", ""], color: "yellow", glow: true, waxed: true, back: null });
  const [c] = s.framedCombos();
  assert.equal(c.id, "blockscope:framed_full_1__oak_log__promenade-polished_blunite__raw");
  assert.deepEqual(framedRealId(c.id), { id: "storagedrawers:framed_full_drawers_1", kind: "full_1", side: "minecraft:oak_log", trim: "promenade:polished_blunite", front: null });
  assert.equal(framedViewerId("minecraft:stone", null), null);
});

test("schematic: render slices layers, hides cells, renames framed drawers", async () => {
  const s = await Schematic.load(await gzip(encodeNbt(sample())), "t.schem");
  const roof = new Set([...Array(6).keys()].map((i) => i + 18));   // layer 3
  const out = await Schematic.load(await s.render({ hidden: roof, minY: 1 }), "out.schem");
  assert.equal(out.idAt(out.index(0, 0, 0)), "minecraft:air");                     // below minY
  assert.equal(out.idAt(out.index(0, 3, 0)), "minecraft:air");                     // hidden
  assert.match(out.idAt(out.index(1, 1, 1)), /^minecraft:oak_wall_sign\[/);        // kept, with its sign text
  assert.equal(out.signs[0].lines[0], "hello");
  assert.equal(out.idAt(out.index(0, 1, 0)), "blockscope:framed_full_1__oak_log__promenade-polished_blunite__raw[facing=north]");
  assert.deepEqual(s.layerCounts(roof), [6, 2, 0, 0]);
});

test("parts", () => {
  const meta = { "0,0,0": { owner: "planks" }, "1,0,0": { owner: "planks:feed" }, "2,0,0": { owner: "room", role: "wall north" }, "3,0,0": { part: "drawer wall" } };
  assert.equal(partOf(meta["1,0,0"]), "planks");
  assert.deepEqual(partsOf(meta).map((p) => p.name), ["planks", "drawer wall", "room shell"]);
});
