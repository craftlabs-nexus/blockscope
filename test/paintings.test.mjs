// node --test: the paintings a file carries (formats.js readPaintings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPaintings } from "../src/formats.js";

test("readPaintings: a file's own paintings and their pictures, in a Sponge file's Metadata or at the root", () => {
  const png = new Int8Array([-119, 80, 78, 71, 1]), marker = new Int8Array([-119, 80, 78, 71, 9]);
  const pos = (x) => ({ t: 9, et: 6, v: [{ t: 6, v: x }, { t: 6, v: 1 }, { t: 6, v: 2.03125 }] });
  const i32 = (v) => ({ t: 3, v });
  const entry = { Label: "The Valley", Name: "arboretum:name-board", Pos: pos(0.5), W: i32(5), H: i32(2), Dir: "S", Image: i32(0) };
  const m1 = { Label: "marker", Name: "", Pos: pos(2.5), W: i32(1), H: i32(2), Dir: "S", Image: i32(1) };
  const m2 = { ...m1, Label: "marker again", Pos: pos(3.5) };
  const pics = { Version: i32(1), Images: { t: 9, et: 7, v: [png, marker] }, List: { t: 9, et: 10, v: [entry, m1, m2] } };
  for (const value of [{ Schematic: { Metadata: { Paintings: pics } } }, { Paintings: pics }]) {
    const [a, b, c] = readPaintings(value);
    assert.deepEqual([a.label, a.name, a.x, a.y, a.z, a.w, a.h, a.dir], ["The Valley", "arboretum:name-board", 0.5, 1, 2.03125, 5, 2, "S"]);
    assert.deepEqual([...a.bytes], [137, 80, 78, 71, 1]);
    assert.deepEqual([...b.bytes], [137, 80, 78, 71, 9]);
    assert.equal(b.bytes, c.bytes, "two paintings of one picture share its bytes");
  }
  // another version, a picture that is not there, or a side that is not one: left out
  assert.deepEqual(readPaintings({ Paintings: { ...pics, Version: i32(2) } }), []);
  assert.deepEqual(readPaintings({ Paintings: { ...pics, List: { t: 9, et: 10, v: [{ ...entry, Image: i32(5) }] } } }), []);
  assert.deepEqual(readPaintings({ Paintings: { ...pics, List: { t: 9, et: 10, v: [{ ...entry, Dir: "up" }] } } }), []);
  assert.deepEqual(readPaintings({}), []);
});
