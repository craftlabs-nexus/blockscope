// node --test: the blocks the game draws with block-entity renderers: banners and pots per design (decorated.js), and
// the geometry the pack's models are built from (pack/entities.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeNbt, gzip, encodeVarints } from "../src/nbt.js";
import { Schematic } from "../src/schematic.js";
import { bannerPatterns, bannerKey, potSides, decoratedViewerId, decoratedRealId, headSkin, skinUrl } from "../src/decorated.js";
import { cube, place, rotationSteps, HEADS, wallHeadId, pngSize } from "../src/pack/entities.js";

const i32 = (v) => ({ t: 3, v }), i16 = (v) => ({ t: 2, v });

test("banner patterns: the 1.20.5+ list and the older codes", () => {
  const now = { patterns: { t: 9, et: 10, v: [{ pattern: "minecraft:stripe_top", color: "red" }, { pattern: "minecraft:cross", color: "black" }] } };
  assert.deepEqual(bannerPatterns(now), [{ pattern: "stripe_top", color: "red" }, { pattern: "cross", color: "black" }]);
  const old = { Patterns: { t: 9, et: 10, v: [{ Pattern: "ts", Color: i32(14) }, { Pattern: "cre", Color: i32(5) }] } };
  assert.deepEqual(bannerPatterns(old), [{ pattern: "stripe_top", color: "red" }, { pattern: "creeper", color: "lime" }]);
  assert.deepEqual(bannerPatterns({}), []);
  assert.equal(bannerKey(bannerPatterns(now)), bannerKey(bannerPatterns(now)));
  assert.notEqual(bannerKey(bannerPatterns(now)), bannerKey(bannerPatterns(old)));
});

test("decorated ids: a patterned banner or a sherd pot gets its own, a plain one keeps the game's", () => {
  const be = { patterns: { t: 9, et: 10, v: [{ pattern: "minecraft:border", color: "blue" }] } };
  const b = decoratedViewerId("minecraft:white_wall_banner", be);
  assert.match(b.id, /^blockscope:white_wall_banner__[0-9a-z]+$/);
  assert.deepEqual([b.kind, b.base, b.wall], ["banner", "white", true]);
  assert.deepEqual(decoratedRealId(b.id), { id: "minecraft:white_wall_banner", kind: "banner" });
  assert.equal(decoratedViewerId("minecraft:white_banner", {}), null);
  assert.equal(decoratedViewerId("minecraft:stone", be), null);

  const sherds = { sherds: { t: 9, et: 8, v: ["minecraft:angler_pottery_sherd", "minecraft:brick", "minecraft:heart_pottery_sherd", "minecraft:skull_pottery_sherd"] } };
  assert.deepEqual(potSides(sherds), ["angler", "brick", "heart", "skull"]);
  const p = decoratedViewerId("minecraft:decorated_pot", sherds);
  assert.equal(p.id, "blockscope:decorated_pot__angler__brick__heart__skull");
  assert.deepEqual(decoratedRealId(p.id), { id: "minecraft:decorated_pot", kind: "pot", sides: ["angler", "brick", "heart", "skull"] });
  assert.equal(decoratedViewerId("minecraft:decorated_pot", {}), null);
});

test("schematic: decorated designs listed and renamed in the rendered file, their state kept", async () => {
  const palette = { "minecraft:air": i32(0), "minecraft:red_banner[rotation=4]": i32(1), "minecraft:decorated_pot[cracked=false,facing=east,waterlogged=false]": i32(2), "minecraft:blue_banner[rotation=0]": i32(3) };
  const be = [
    { Id: "minecraft:banner", Pos: new Int32Array([0, 0, 0]), patterns: { t: 9, et: 10, v: [{ pattern: "minecraft:skull", color: "white" }] } },
    { Id: "minecraft:decorated_pot", Pos: new Int32Array([1, 0, 0]), sherds: { t: 9, et: 8, v: ["minecraft:brick", "minecraft:brick", "minecraft:brick", "minecraft:prize_pottery_sherd"] } },
  ];
  const nbt = { name: "", value: { Version: i32(2), DataVersion: i32(4000), Width: i16(3), Height: i16(1), Length: i16(1), PaletteMax: i32(4), Palette: palette, BlockData: encodeVarints([1, 2, 3]), BlockEntities: { t: 9, et: 10, v: be } } };
  const s = await Schematic.load(await gzip(encodeNbt(nbt)), "d.schem");
  const ids = s.decoratedCombos().map((d) => d.id).sort();
  assert.equal(ids.length, 2);
  const out = await Schematic.load(await s.render(), "out.schem");
  assert.match(out.idAt(out.index(0, 0, 0)), /^blockscope:red_banner__[0-9a-z]+\[rotation=4\]$/);
  assert.equal(out.idAt(out.index(1, 0, 0)), "blockscope:decorated_pot__brick__brick__brick__prize[cracked=false,facing=east,waterlogged=false]");
  assert.equal(out.idAt(out.index(2, 0, 0)), "minecraft:blue_banner[rotation=0]");   // no patterns: the game's own
});

test("cube: ModelPart's texture unwrap, the front to the south", () => {
  // a mob head: 8 × 8 × 8 at texOffs 0,0 on a 64-texel texture (UVs in 0..16)
  const e = cube([4, 0, 4], [12, 8, 12], [0, 0], [8, 8, 8], 64);
  assert.deepEqual(e.faces.up.uv, [2, 0, 4, 2]);
  assert.deepEqual(e.faces.down.uv, [4, 0, 6, 2]);
  assert.deepEqual(e.faces.west.uv, [0, 2, 2, 4]);
  assert.deepEqual(e.faces.south.uv, [2, 2, 4, 4]);   // the face
  assert.deepEqual(e.faces.east.uv, [4, 2, 6, 4]);
  assert.deepEqual(e.faces.north.uv, [6, 2, 8, 4]);
  assert.deepEqual(Object.keys(cube([0, 0, 0], [1, 1, 1], [0, 0], [1, 1, 1], 16, { skip: ["up", "down"] }).faces).sort(), ["east", "north", "south", "west"]);
  const m = cube([0, 0, 0], [1, 1, 1], [0, 0], [8, 8, 8], 64, { mirror: true });
  assert.deepEqual(m.faces.west.uv, [6, 2, 4, 4]);   // the east region, flipped
});

test("place: a model box turned over into the block", () => {
  // a skull's head box (-4, -8, -4, 8 × 8 × 8) stands on the floor in the middle
  assert.deepEqual(place({ at: [-4, -8, -4], size: [8, 8, 8] }), [[4, 0, 4], [12, 8, 12]]);
  // the snout in front (model -z) lands on the south side
  assert.deepEqual(place({ at: [-2, -4, -5], size: [4, 4, 1] }), [[6, 0, 12], [10, 4, 13]]);
  // a standing banner's pole: two thirds of 42 texels, from the floor
  const [from, to] = place({ at: [-1, -30, -1], size: [2, 42, 2] }, { c: [8, 8, 8], s: 2 / 3 });
  assert.deepEqual([from[1], to[1]].map((n) => Math.round(n * 1000) / 1000), [0, 28]);
});

test("rotations: blockstate y in 90° steps, element turns of 22.5° between", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 8, 12, 15].map(rotationSteps), [
    { y: 0, k: 0 }, { y: 0, k: 1 }, { y: 0, k: 2 }, { y: 90, k: -1 }, { y: 90, k: 0 }, { y: 180, k: 0 }, { y: 270, k: 0 }, { y: 0, k: -1 },
  ]);
  for (let r = 0; r < 16; r++) { const { y, k } = rotationSteps(r); assert.equal((y / 22.5 + k + 16) % 16, r); }
});

test("heads: every kind with its wall form", () => {
  assert.equal(wallHeadId("skeleton_skull"), "skeleton_wall_skull");
  assert.equal(wallHeadId("dragon_head"), "dragon_wall_head");
  assert.deepEqual(Object.keys(HEADS).sort(), ["creeper_head", "dragon_head", "piglin_head", "player_head", "skeleton_skull", "wither_skeleton_skull", "zombie_head"]);
});

test("pngSize reads the header", () => {
  const b = new Uint8Array(24); b.set([0, 0, 0, 64], 16); b.set([0, 0, 0, 32], 20);
  assert.deepEqual(pngSize(b), [64, 32]);
});

const HASH = "31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb";
const textures = (url) => Buffer.from(JSON.stringify({ timestamp: 1, profileName: "x", textures: { SKIN: { url } } })).toString("base64");

test("head skins: the profile's textures, in either format; a bare name or another host has none", () => {
  const now = { profile: { name: "MHF_OakLog", id: new Int32Array([1, 2, 3, 4]), properties: { t: 9, et: 10, v: [{ name: "textures", value: textures(`http://textures.minecraft.net/texture/${HASH}`), signature: "s" }] } } };
  assert.equal(headSkin(now), HASH);
  const old = { SkullOwner: { Name: "x", Properties: { textures: { t: 9, et: 10, v: [{ Value: textures(`https://textures.minecraft.net/texture/${HASH.toUpperCase()}`) }] } } } };
  assert.equal(headSkin(old), HASH);
  assert.equal(headSkin({ profile: "Notch" }), null);
  assert.equal(headSkin({ profile: { name: "BeyazKrral", id: new Int32Array([1, 2, 3, 4]) } }), null);
  assert.equal(headSkin({ profile: { properties: { t: 9, et: 10, v: [{ name: "textures", value: textures(`https://example.com/texture/${HASH}`) }] } } }), null);
  assert.equal(skinUrl(HASH), `https://textures.minecraft.net/texture/${HASH}`);

  const d = decoratedViewerId("minecraft:player_wall_head", now);
  assert.deepEqual(d, { id: `blockscope:player_wall_head__${HASH.slice(0, 24)}`, kind: "head", wall: true, skin: HASH });
  assert.deepEqual(decoratedRealId(d.id), { id: "minecraft:player_wall_head", kind: "head" });
  assert.equal(decoratedViewerId("minecraft:player_head", { profile: "Notch" }), null);   // Steve: the game's own id
});

test("schematic: a skinned head renamed per skin, a skinless one kept", async () => {
  const palette = { "minecraft:air": i32(0), "minecraft:player_wall_head[facing=east,powered=false]": i32(1), "minecraft:player_head[powered=false,rotation=8]": i32(2) };
  const be = [{ Id: "minecraft:skull", Pos: new Int32Array([0, 0, 0]), profile: { name: "x", properties: { t: 9, et: 10, v: [{ name: "textures", value: textures(`http://textures.minecraft.net/texture/${HASH}`) }] } } }];
  const nbt = { name: "", value: { Version: i32(2), DataVersion: i32(4000), Width: i16(2), Height: i16(1), Length: i16(1), PaletteMax: i32(3), Palette: palette, BlockData: encodeVarints([1, 2]), BlockEntities: { t: 9, et: 10, v: be } } };
  const s = await Schematic.load(await gzip(encodeNbt(nbt)), "h.schem");
  assert.deepEqual(s.decoratedCombos().map((c) => [c.kind, c.skin]), [["head", HASH]]);
  const out = await Schematic.load(await s.render(), "out.schem");
  assert.equal(out.idAt(out.index(0, 0, 0)), `blockscope:player_wall_head__${HASH.slice(0, 24)}[facing=east,powered=false]`);
  assert.equal(out.idAt(out.index(1, 0, 0)), "minecraft:player_head[powered=false,rotation=8]");
});
