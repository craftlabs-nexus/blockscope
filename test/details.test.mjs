// node --test: the Schematic group (details.js) and what a file says about itself (formats.js readFileInfo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeNbt, encodeVarints, gzip } from "../src/nbt.js";
import { Schematic } from "../src/schematic.js";
import { readFileInfo } from "../src/formats.js";
import { gameVersion, schematicDetails, byteText, dateText } from "../src/details.js";

const i16 = (v) => ({ t: 2, v }), i32 = (v) => ({ t: 3, v }), i64 = (v) => ({ t: 4, v: BigInt(v) });
const list = (et, v) => ({ t: 9, et, v });
const xyz = (x, y, z) => ({ x: i32(x), y: i32(y), z: i32(z) });
const load = async (value, name) => Schematic.load(await gzip(encodeNbt({ name: "", value })), name);
const rowsOf = (d) => Object.fromEntries(d.rows.map((r) => [r.key, r.value]));

test("a data version names its release, the release a snapshot led up to, or says it is past the table", () => {
  assert.equal(gameVersion(3955), "1.21.1");
  assert.equal(gameVersion(2566), "1.16");
  assert.equal(gameVersion(4903), "26.2");
  assert.equal(gameVersion(4320), "a 1.21.5 snapshot");
  assert.equal(gameVersion(99999), "newer than 26.3");
  assert.equal(gameVersion(100), "older than 1.9");
  assert.equal(gameVersion(0), null);
  assert.equal(gameVersion(undefined), null);
});

test("sizes and dates read as people read them", () => {
  assert.equal(byteText(812), "812 B");
  assert.equal(byteText(14_200), "14.2 KB");
  assert.equal(byteText(3_140_000), "3.1 MB");
  assert.match(dateText(Date.UTC(2026, 9, 23, 12, 0)), /^2026-10-2[34] \d\d:\d\d$/);
  assert.equal(dateText(null), null);
});

/** A 3 × 2 × 2 Sponge v3 schematic: a stone floor, a mod's block and a chest above, a pig, saved by 1.21.1. */
function sponge() {
  const W = 3, H = 2, L = 2, data = new Array(W * H * L).fill(0);
  for (let i = 0; i < W * L; i++) data[i] = 1;
  data[W * L] = 2; data[W * L + 1] = 3;
  return {
    Schematic: {
      Version: i32(3), DataVersion: i32(3955), Width: i16(W), Height: i16(H), Length: i16(L), Offset: new Int32Array([100, 64, -20]),
      Metadata: { Name: "Hut", Author: "zoot", Date: i64(Date.UTC(2026, 0, 2, 3, 4)), RequiredMods: list(8, ["wilderwild"]) },
      Blocks: {
        Palette: { "minecraft:air": i32(0), "minecraft:stone": i32(1), "wilderwild:hollowed_oak_log[axis=x]": i32(2), "minecraft:chest[facing=north]": i32(3), "minecraft:dirt": i32(4) },
        Data: encodeVarints(data),
        BlockEntities: list(10, [{ Id: "minecraft:chest", Pos: new Int32Array([1, 1, 0]) }]),
      },
      Entities: list(10, [{ Id: "minecraft:pig", Pos: list(6, [{ t: 6, v: 0.5 }, { t: 6, v: 1 }, { t: 6, v: 0.5 }]) }]),
    },
  };
}

test("a Sponge file: its size, how full it is, its types and mods, its game version and its own metadata", async () => {
  const s = await load(sponge(), "hut.schem");
  const d = schematicDetails(s);
  assert.equal(d.summary, "3 × 2 × 2");
  assert.deepEqual(d.data.size, [3, 2, 2]);
  assert.equal(d.data.blocks, 8);
  // dirt is in the palette but no cell uses it: not counted
  assert.deepEqual([d.data.types, d.data.states], [3, 3]);
  assert.deepEqual(d.data.mods, ["wilderwild"]);
  assert.deepEqual([d.data.game, d.data.dataVersion, d.data.format], ["1.21.1", 3955, "Sponge v3"]);
  assert.deepEqual([d.data.author, d.data.blockEntities, d.data.entities], ["zoot", 1, 1]);
  assert.deepEqual(d.data.origin, [100, 64, -20]);
  assert.deepEqual(d.data.requiredMods, ["wilderwild"]);
  const rows = rowsOf(d);
  assert.equal(rows.size, "3 × 2 × 2");
  assert.equal(rows.blocks, "8 of 12 (67%)");
  assert.equal(rows.types, "3 types, 3 states");
  assert.equal(rows.mods, "1: wilderwild");
  assert.equal(rows.game, "Minecraft 1.21.1");
  assert.match(rows.format, /^Sponge v3, \d+ B$/);
  assert.equal(rows.name, "Hut");
  assert.equal(rows.origin, "100, 64, -20");
  assert.equal(rows.entities, "1 block entity, 1 entity");
  assert.ok(rows.created);
  // the rows come in a fixed order, the ones with nothing to say left out
  assert.deepEqual(d.rows.map((r) => r.key), ["size", "blocks", "types", "mods", "needs", "game", "format", "name", "author", "created", "origin", "entities"]);
});

test("a file's own name is left out when it is the file name, and a vanilla file says so", async () => {
  const v = sponge(); v.Schematic.Metadata = { Name: "hut" }; v.Schematic.Offset = new Int32Array([0, 0, 0]);
  v.Schematic.Blocks.Palette = { "minecraft:air": i32(0), "minecraft:stone": i32(1), "minecraft:oak_planks": i32(2), "minecraft:chest[facing=north]": i32(3) };
  const rows = rowsOf(schematicDetails(await load(v, "hut.schem")));
  assert.equal(rows.name, undefined);
  assert.equal(rows.origin, undefined);
  assert.equal(rows.mods, "none, vanilla blocks only");
});

test("a Litematica file: its metadata's name, author, dates and its regions' entities", async () => {
  const pal = [{ Name: "minecraft:air" }, { Name: "minecraft:stone" }];
  const value = {
    MinecraftDataVersion: i32(4440), Version: i32(7),
    Metadata: { Name: "Tower", Author: "someone", Description: "a tall one", TimeCreated: i64(1_700_000_000_000), TimeModified: i64(1_700_000_600_000) },
    Regions: {
      main: { Position: xyz(0, 0, 0), Size: xyz(2, 1, 1), BlockStatePalette: list(10, pal), BlockStates: BigInt64Array.from([0b0101n]), TileEntities: list(10, []), Entities: list(10, [{ id: "minecraft:item_frame" }, { id: "minecraft:painting" }]) },
    },
  };
  const info = readFileInfo(value);
  assert.deepEqual(info, { name: "Tower", author: "someone", description: "a tall one", created: 1_700_000_000_000, modified: 1_700_000_600_000, dataVersion: 4440, formatVersion: 7, entities: 2, requiredMods: [] });
  const d = schematicDetails(await load(value, "tower.litematic"));
  assert.deepEqual([d.data.game, d.data.format, d.data.blocks], ["1.21.8", "Litematica v7", 2]);
  const rows = rowsOf(d);
  assert.equal(rows.about, "a tall one");
  assert.ok(rows.created && rows.modified);
  assert.equal(rows.entities, "2 entities");
});

test("a structure .nbt: its data version and entities; a mod list's own Minecraft version wins over the data version", async () => {
  const value = {
    size: list(3, [i32(1), i32(1), i32(1)]), DataVersion: i32(4325), author: "builder",
    entities: list(10, [{ nbt: { id: "minecraft:armor_stand" } }]),
    palette: list(10, [{ Name: "minecraft:stone" }]),
    blocks: list(10, [{ pos: list(3, [i32(0), i32(0), i32(0)]), state: i32(0) }]),
  };
  assert.deepEqual(readFileInfo(value), { name: null, author: "builder", description: null, created: null, modified: null, dataVersion: 4325, formatVersion: null, entities: 1, requiredMods: [] });
  const s = await load(value, "thing.nbt");
  assert.deepEqual([schematicDetails(s).data.game, schematicDetails(s).data.format], ["1.21.5", "structure .nbt"]);
  s.mods = { minecraft: "1.21.4", loader: "neoforge", loaderVersion: "21.4.1", list: [] };
  const d = schematicDetails(s);
  assert.equal(d.data.game, "1.21.4");
  assert.match(d.rows.find((r) => r.key === "game").title, /data version 4325 \(1\.21\.5\); the mod list names 1\.21\.4/);
  assert.equal(rowsOf(d).mods, "none, vanilla blocks only");
  assert.equal(rowsOf(d).game, "Minecraft 1.21.4");
  assert.match(d.rows.find((r) => r.key === "game").title, /its mods are for NeoForge 21\.4\.1$/);
});

test("a long mod list shows the three with the most blocks and counts the rest", async () => {
  const v = sponge(), W = 3, H = 2, L = 2;
  // five mods' blocks, the fifth with the most
  v.Schematic.Blocks.Palette = { "minecraft:air": i32(0), "a:x": i32(1), "b:x": i32(2), "c:x": i32(3), "d:x": i32(4), "e:x": i32(5) };
  v.Schematic.Blocks.Data = encodeVarints([5, 5, 5, 5, 4, 4, 4, 3, 3, 2, 1, 0].slice(0, W * H * L));
  v.Schematic.Blocks.BlockEntities = list(10, []);
  const d = schematicDetails(await load(v, "mods.schem"));
  assert.deepEqual(d.data.mods.slice(0, 3), ["e", "d", "c"]);
  assert.deepEqual([...d.data.mods].sort(), ["a", "b", "c", "d", "e"]);
  const r = d.rows.find((x) => x.key === "mods");
  assert.equal(r.value, "5: e, d, c +2 more");
  assert.match(r.title, /\ne, d, c, [ab], [ab]$/);
});
