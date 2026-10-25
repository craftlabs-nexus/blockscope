// node --test: a layer step lands on the nearest layer that changes what is drawn (layers.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepTarget, filledLayers } from "../src/layers.js";

// a part that holds blocks on layers 10 to 14 of a 74-layer file, with a gap at 12
const part = [10, 11, 13, 14];

test("below: down from high above a part goes straight under its top layer", () => {
  assert.equal(stepTarget("below", 72, -1, part), 13);   // 72 shows the whole part: the first change drops 14
  assert.equal(stepTarget("below", 13, -1, part), 11);   // skips the empty 12
  assert.equal(stepTarget("below", 11, -1, part), 10);
  assert.equal(stepTarget("below", 10, -1, part), null); // under 10 nothing is drawn
});

test("below: up adds the next layer with blocks", () => {
  assert.equal(stepTarget("below", 11, 1, part), 13);
  assert.equal(stepTarget("below", 0, 1, part), 10);
  assert.equal(stepTarget("below", 14, 1, part), null);
  assert.equal(stepTarget("below", 40, 1, part), null);
});

test("above: up drops the lowest layer shown, down adds the next one under it", () => {
  assert.equal(stepTarget("above", 0, 1, part), 11);     // 0 shows the whole part: the first change drops 10
  assert.equal(stepTarget("above", 11, 1, part), 13);
  assert.equal(stepTarget("above", 14, 1, part), null);
  assert.equal(stepTarget("above", 13, -1, part), 11);
  assert.equal(stepTarget("above", 60, -1, part), 14);
  assert.equal(stepTarget("above", 10, -1, part), null);
});

test("single: the next layer with blocks either way", () => {
  assert.equal(stepTarget("single", 11, 1, part), 13);
  assert.equal(stepTarget("single", 11, -1, part), 10);
  assert.equal(stepTarget("single", 50, -1, part), 14);
  assert.equal(stepTarget("single", 2, 1, part), 10);
  assert.equal(stepTarget("single", 14, 1, part), null);
});

test("nothing drawn at all: no step", () => {
  for (const mode of ["below", "above", "single"]) for (const d of [1, -1]) assert.equal(stepTarget(mode, 5, d, []), null);
});

test("the filled layers from per-layer counts", () => {
  assert.deepEqual(filledLayers([0, 3, 0, 1, 0]), [1, 3]);
});
