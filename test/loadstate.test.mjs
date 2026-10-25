// node --test: what the renderer holds of the page's file, and loads on their way (src/loadstate.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LoadState } from "../src/loadstate.js";

test("a second file: once its load is in, the renderer holds it and a change draws from it", () => {
  const s = new LoadState(), a = { name: "a" }, b = { name: "b" };
  s.begin({ file: a, hidden: null, cut: false, asked: "all|" });
  assert.equal(s.holds(a), false, "not before it is in");
  assert.equal(s.coming(a), true, "a change waits for it");
  assert.equal(s.arrived("all|"), false, "nothing changed meanwhile");
  assert.equal(s.holds(a), true);
  // the next file: while it is on its way the renderer still has the first, and a change waits; once in, it is held
  // and nothing waits any more (a layer step then draws at once)
  s.newFile(); s.begin({ file: b, hidden: null, cut: false, asked: "all|" });
  assert.deepEqual([s.holds(a), s.holds(b), s.coming(b)], [false, false, true]);
  assert.equal(s.arrived("0-4|"), true, "a layer change made while it was on its way is shown once it is in");
  assert.deepEqual([s.holds(b), s.coming(b)], [true, false]);
});

test("a failed load or a dropped file leaves the renderer with nothing; a cut load is never waited for", () => {
  const s = new LoadState(), a = { name: "a" }, b = { name: "b" };
  s.begin({ file: a, hidden: null, cut: false, asked: "k" }); s.arrived("k");
  s.begin({ file: b, hidden: null, cut: false, asked: "k" }); s.failed();
  assert.deepEqual([s.holds(a), s.coming(b), s.arrived("k")], [false, false, false], "the renderer drops its file before reading another");
  s.begin({ file: a, hidden: null, cut: false, asked: "k" }); s.arrived("k"); s.dropped();
  assert.equal(s.holds(a), false, "taken out before a pack switch: it holds nothing");
  s.begin({ file: b, hidden: new Set(), cut: true, asked: "k" });
  assert.equal(s.coming(b), false, "a cut file carries only what was asked: a change loads again");
  s.arrived("k");
  assert.equal(s.holds(b), false, "a cut file cannot show other cells");
});

test("a renderer with no showCells keeps every file cut; another build gets its chance per file", () => {
  const s = new LoadState();
  s.live = false; s.newFile(); assert.equal(s.live, true, "the last file's build could not; this one may");
  s.live = s.canFilter = false; s.newFile(); assert.equal(s.live, false);
});
