// node --test: the paintings a file carries (formats.js readPaintings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPaintings } from "../src/formats.js";

test("readPaintings: a file's own paintings, in a Sponge file's Metadata or at the root of another format", () => {
  const png = new Int8Array([-119, 80, 78, 71, 1]);
  const pos = { t: 9, et: 6, v: [{ t: 6, v: 0.5 }, { t: 6, v: 1 }, { t: 6, v: 2.03125 }] };
  const entry = { Label: "The Valley", Name: "arboretum:name-board", Pos: pos, W: { t: 3, v: 5 }, H: { t: 3, v: 2 }, Dir: "S", Image: png };
  const pics = { Version: { t: 3, v: 1 }, List: { t: 9, et: 10, v: [entry] } };
  for (const value of [{ Schematic: { Metadata: { Paintings: pics } } }, { Paintings: pics }]) {
    const [p] = readPaintings(value);
    assert.deepEqual([p.label, p.name, p.x, p.y, p.z, p.w, p.h, p.dir], ["The Valley", "arboretum:name-board", 0.5, 1, 2.03125, 5, 2, "S"]);
    assert.deepEqual([...p.bytes], [137, 80, 78, 71, 1]);
  }
  // another version, no image or a side that is not one: nothing
  assert.deepEqual(readPaintings({ Paintings: { Version: { t: 3, v: 2 }, List: pics.List } }), []);
  assert.deepEqual(readPaintings({ Paintings: { ...pics, List: { t: 9, et: 10, v: [{ ...entry, Image: new Int8Array(0) }] } } }), []);
  assert.deepEqual(readPaintings({ Paintings: { ...pics, List: { t: 9, et: 10, v: [{ ...entry, Dir: "up" }] } } }), []);
  assert.deepEqual(readPaintings({}), []);
});
