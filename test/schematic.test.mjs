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

test("parts", async () => {
  const { BlockMeta } = await import("../src/blockmeta.js");
  const records = [{ owner: "planks" }, { owner: "planks:feed" }, { owner: "room", role: "wall north" }, { part: "drawer wall" }];
  const meta = new BlockMeta([0, 0, 0], [4, 1, 1], new Uint32Array([1, 2, 3, 4]), records);
  assert.equal(partOf(records[1]), "planks");
  assert.deepEqual(partsOf(meta).map((p) => p.name), ["planks", "drawer wall", "room shell"]);
});

// ---- the formats read in the page: Litematica, vanilla structure, the block metadata --------------------------------
const i64s = (vals) => BigInt64Array.from(vals.map((v) => BigInt.asIntN(64, v)));
/** Litematica's bit packing: entry i at bit i * bits, running across longs. */
function pack(states, bits) {
  const longs = new Array(Math.ceil((states.length * bits) / 64)).fill(0n);
  states.forEach((v, i) => { const s = i * bits, a = s >> 6, off = BigInt(s & 63); longs[a] |= BigInt(v) << off; if (((s + bits - 1) >> 6) !== a) longs[a + 1] |= BigInt(v) >> (64n - off); });
  return i64s(longs.map((l) => BigInt.asUintN(64, l)));
}
const list = (et, v) => ({ t: 9, et, v });
const xyz = (x, y, z) => ({ x: i32(x), y: i32(y), z: i32(z) });
/** BlockInfo for a box: entries by file cell. */
function blockInfo(origin, size, byCell) {
  const records = [], cells = new Int32Array(size[0] * size[1] * size[2]);
  for (const [[x, y, z], rec] of byCell) { records.push(rec); cells[(y * size[2] + z) * size[0] + x] = records.length; }
  return { Version: i32(1), Origin: new Int32Array(origin), Size: new Int32Array(size), Records: list(10, records), Cells: cells };
}
/**
 * Two regions over a 5 × 2 × 1 box. "base" (x 0..4, y 0): stone with a structure void at x 4. "top", written with a
 * negative x size from x 4 back to x 1 (y 0..1): air on y 0 (it must not erase the stone), on y 1 a chest at x 1 with
 * its tile entity, stone at x 3, and 14 more palette entries so it needs 5 bits a block (entries cross a long).
 */
function litematic(extra = {}) {
  const basePal = [{ Name: "minecraft:air" }, { Name: "minecraft:stone" }, { Name: "minecraft:structure_void" }];
  const topPal = [{ Name: "minecraft:air" }, { Name: "minecraft:chest", Properties: { facing: "north", type: "single" } }, { Name: "minecraft:stone" }, { Name: "minecraft:structure_void" }];
  for (let i = 0; i < 14; i++) topPal.push({ Name: `minecraft:filler_${i}` });
  // top's cells: x 0..3 in the region are file x 1..4; y 0 all air, y 1: chest, void, stone, void
  const top = [0, 0, 0, 0, 1, 3, 2, 3];
  return {
    MinecraftDataVersion: i32(4440), Version: i32(6),
    Metadata: { Name: "two regions", Author: "test", EnclosingSize: xyz(5, 2, 1) },
    Regions: {
      base: { Position: xyz(0, 0, 0), Size: xyz(5, 1, 1), BlockStatePalette: list(10, basePal), BlockStates: pack([1, 1, 1, 1, 2], 2), TileEntities: list(10, []) },
      top: { Position: xyz(4, 0, 0), Size: xyz(-4, 2, 1), BlockStatePalette: list(10, topPal), BlockStates: pack(top, 5), TileEntities: list(10, [{ id: "minecraft:chest", x: i32(0), y: i32(1), z: i32(0), Items: list(10, []) }]) },
    },
    ...extra,
  };
}

test("litematic: regions merged, voids and air never erase, tile entities, regions as parts", async () => {
  const s = await Schematic.load(await gzip(encodeNbt({ name: "", value: litematic() })), "t.litematic");
  assert.equal(s.format, "litematic");
  assert.deepEqual([s.width, s.height, s.length], [5, 2, 1]);
  const at = (x, y) => s.idAt(s.index(x, y, 0));
  assert.deepEqual([0, 1, 2, 3, 4].map((x) => at(x, 0)), ["minecraft:stone", "minecraft:stone", "minecraft:stone", "minecraft:stone", "minecraft:air"]);
  assert.deepEqual([0, 1, 2, 3, 4].map((x) => at(x, 1)), ["minecraft:air", "minecraft:chest[facing=north,type=single]", "minecraft:air", "minecraft:stone", "minecraft:air"]);
  assert.equal(s.entities.length, 1);
  assert.deepEqual([...s.entities[0].Pos], [1, 1, 0]);
  assert.equal(s.entities[0].Id, "minecraft:chest");
  assert.equal(s.metaSource, "regions");
  assert.deepEqual(partsOf(s.meta).map((p) => [p.name, p.count]), [["base", 4], ["top", 2]]);
  // the file the renderer gets reads back as the same blocks
  const out = await Schematic.load(await s.render(), "out.schem");
  assert.equal(out.idAt(out.index(1, 1, 0)), "minecraft:chest[facing=north,type=single]");
});

test("structure .nbt: palette, blocks, block entities; unlisted cells are air", async () => {
  const value = {
    size: list(3, [i32(2), i32(1), i32(2)]), DataVersion: i32(4440), entities: list(10, []),
    palette: list(10, [{ Name: "minecraft:stone" }, { Name: "minecraft:oak_sign", Properties: { rotation: "4" } }]),
    blocks: list(10, [
      { pos: list(3, [i32(0), i32(0), i32(0)]), state: i32(0) },
      { pos: list(3, [i32(1), i32(0), i32(1)]), state: i32(1), nbt: { id: "minecraft:sign", front_text: { messages: list(8, ["hi", "", "", ""]), color: "black", has_glowing_text: { t: 1, v: 0 } } } },
    ]),
  };
  const s = await Schematic.load(await gzip(encodeNbt({ name: "", value })), "t.nbt");
  assert.equal(s.format, "structure");
  assert.deepEqual([s.width, s.height, s.length], [2, 1, 2]);
  assert.equal(s.idAt(s.index(0, 0, 0)), "minecraft:stone");
  assert.equal(s.idAt(s.index(1, 0, 0)), "minecraft:air");
  assert.equal(s.signs.length, 1);
  assert.deepEqual([s.signs[0].x, s.signs[0].z, s.signs[0].lines[0], s.signs[0].rotation], [1, 1, "hi", 4]);
});

test("block metadata in the file: Sponge Metadata, litematic and structure roots; it wins over regions", async () => {
  const rec = { owner: "aisle 1", part: "Aisle 1", ids: list(8, ["minecraft:stone", "minecraft:dirt"]) };
  // the Sponge sample at offset 10, 64, -5 with its stone floor's corner described
  const sp = sample(); sp.value.Metadata = { Name: "t", BlockInfo: blockInfo([10, 64, -5], [3, 4, 2], [[[0, 0, 0], rec]]) };
  const s = await Schematic.load(await gzip(encodeNbt(sp)), "t.schem");
  assert.equal(s.metaSource, "file");
  assert.deepEqual([...s.meta.entries()], [[[10, 64, -5], { owner: "aisle 1", part: "Aisle 1", ids: ["minecraft:stone", "minecraft:dirt"] }]]);
  assert.deepEqual(s.metaAt(s.meta, 0, 0, 0)?.part, "Aisle 1");
  // the renderer's file leaves it out
  const out = await readNbt(await s.render());
  assert.equal(out.value.Metadata.BlockInfo, undefined);
  assert.equal(out.value.Metadata.Name, "t");
  // a litematic carrying it: the regions do not stand in, and the file takes the origin as its offset
  const lit = await Schematic.load(await gzip(encodeNbt({ name: "", value: litematic({ BlockInfo: blockInfo([100, 0, 7], [5, 2, 1], [[[1, 1, 0], { role: "the chest" }]]) }) })), "t.litematic");
  assert.equal(lit.metaSource, "file");
  assert.deepEqual(lit.offset, [100, 0, 7]);
  assert.equal(lit.metaAt(lit.meta, 1, 1, 0)?.role, "the chest");
  assert.equal(lit.regions.length, 2);
});

test("a file is read by what it holds, not its name", async () => {
  const s = await Schematic.load(await gzip(encodeNbt({ name: "", value: litematic() })), "misnamed.schem");
  assert.equal(s.format, "litematic");
});

test("the file's mod list: read from the file, only Modrinth's CDN with a sha512, namespaces told to the build", async () => {
  const { fileSource } = await import("../src/pack/sources.js");
  const mod = (name, url, ns, sha = "a") => ({ Name: name, ModId: name, Project: "P", VersionId: "V", File: `${name}.jar`, Url: url, Size: i32(5), Sha512: sha.repeat(128), Sha1: "b".repeat(40), Namespaces: list(8, ns) });
  const sp = sample();
  sp.value.Metadata = { Mods: { Version: i32(1), Minecraft: "26.2", Loader: "fabric", LoaderVersion: "0.19.5", List: list(10, [
    mod("storagedrawers", "https://cdn.modrinth.com/data/guitPqEi/versions/cJA3JdCZ/StorageDrawers.jar", ["storagedrawers"]),
    mod("promenade", "https://cdn.modrinth.com/data/P3/versions/V3/p.jar", ["promenade"], "c"),
    mod("evil", "https://example.com/evil.jar", ["evil"], "d"),
    mod("nohash", "https://cdn.modrinth.com/data/P4/versions/V4/n.jar", ["nohash"], "zz"),
  ]) }, BlockInfo: { Version: i32(1), Origin: new Int32Array([10, 64, -5]), Size: new Int32Array([3, 4, 2]), Parts: list(8, ["z part", "a part"]), Records: list(10, [{ part: "a part" }, { part: "z part" }]), Cells: Int32Array.from({ length: 24 }, (_, i) => (i === 0 ? 1 : i === 1 ? 2 : 0)) } };
  const s = await Schematic.load(await gzip(encodeNbt(sp)), "t.schem");
  assert.equal(s.mods.minecraft, "26.2");
  assert.deepEqual(s.mods.list.map((m) => m.file), ["storagedrawers.jar", "promenade.jar", "evil.jar"], "an entry without a sha512 is dropped on reading");
  assert.deepEqual(partsOf(s.meta, s.partOrder).map((p) => p.name), ["z part", "a part"], "the file's own order");
  const src = fileSource(s.mods);
  assert.deepEqual([...src.covers()].sort(), ["promenade", "storagedrawers"], "an entry off Modrinth's CDN is dropped");
  const d = await src.describe();
  assert.equal(d.minecraft, "26.2");
  assert.match(d.id, /^file:[0-9a-f]{32}$/);
  const a = await src.analyze();
  assert.deepEqual(a.entries.map((e) => [e.filename, e.origin.url.startsWith("https://cdn.modrinth.com/"), e.sha512.length]), [["storagedrawers.jar", true, 128], ["promenade.jar", true, 128]]);
  assert.deepEqual(src.provides().get(a.entries[0].key), { storagedrawers: 1 });
  assert.equal(fileSource({ list: [] }), null);
});

test("block metadata kept a record a cell: by world position and by a file's cell index", async () => {
  const { BlockMeta } = await import("../src/blockmeta.js");
  const shared = { owner: "room", role: "wall north" };
  // a 2 × 1 × 2 box at world (5, 60, 7): three cells tagged, two with the same record (cells: record index + 1)
  const meta = new BlockMeta([5, 60, 7], [2, 1, 2], new Uint32Array([1, 2, 0, 2]), [{ part: "a" }, shared]);
  assert.equal(meta.count, 3);
  assert.deepEqual(meta.at(5, 60, 7), { part: "a" });
  assert.equal(meta.at(6, 60, 8), shared);
  assert.equal(meta.at(5, 60, 8), null);
  assert.equal(meta.at(4, 60, 7), null);
  assert.equal(meta.recordAt(3), shared);   // (x 1, z 1): index (0 * 2 + 1) * 2 + 1
  assert.ok(meta.alignedWith([5, 60, 7], [2, 1, 2]));
  assert.deepEqual(partsOf(meta).map((p) => [p.name, p.count]), [["a", 1], ["room shell", 2]]);
});

test("fronts: the facing of drawers, chests and wall signs among the layers drawn, the hidden cells left out", async () => {
  const s = await Schematic.load(await gzip(encodeNbt(sample())), "t.schem");
  // the drawer faces north (counts 2), the wall sign south (counts half), both on layer 1
  assert.deepEqual(s.fronts(0, 3), { north: 2, south: 0.5, east: 0, west: 0 });
  assert.deepEqual(s.fronts(2, 3), { north: 0, south: 0, east: 0, west: 0 });
  assert.deepEqual(s.fronts(0, 3, new Set([s.index(0, 1, 0)])), { north: 0, south: 0.5, east: 0, west: 0 });
});

test("metadata over a box of its own: read by world position, its parts counted inside the file only", async () => {
  const { BlockMeta } = await import("../src/blockmeta.js");
  const s = await Schematic.load(await gzip(encodeNbt(sample())), "t.schem");   // 3 × 4 × 2 at (10, 64, -5)
  // a 4 × 1 × 1 box from (9, 64, -5): its first cell lies outside the file, the other three in it
  const meta = new BlockMeta([9, 64, -5], [4, 1, 1], new Uint32Array([1, 2, 2, 2]), [{ part: "outside" }, { part: "inside" }]);
  assert.equal(s.metaAtIndex(meta, s.index(0, 0, 0)).part, "inside");
  assert.equal(s.metaAtIndex(meta, s.index(0, 1, 0)), null);
  assert.deepEqual(partsOf(meta, null, { origin: s.offset, size: [s.width, s.height, s.length] }).map((p) => [p.name, p.count]), [["inside", 3]]);
});
