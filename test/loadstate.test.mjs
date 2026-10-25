// node --test: what the renderer holds of the page's file, and loads on their way (src/loadstate.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LoadState } from "../src/loadstate.js";

test("a second file: once its load is in, the renderer holds it and a change draws from it", () => {
  const s = new LoadState(), a = { name: "a" }, b = { name: "b" };
  const ia = s.begin({ file: a, cut: false, asked: "all|" });
  assert.equal(s.holds(a), false, "not before it is in");
  assert.equal(s.coming(a), true, "a change waits for it");
  assert.equal(s.arrived(ia, "all|"), false, "nothing changed meanwhile");
  assert.equal(s.holds(a), true);
  // the next file: while it is on its way the renderer still has the first, and a change waits; once in, it is held
  // and nothing waits any more (a layer step then draws at once)
  s.newFile(); const ib = s.begin({ file: b, cut: false, asked: "all|" });
  assert.deepEqual([s.holds(a), s.holds(b), s.coming(b)], [false, false, true]);
  assert.equal(s.arrived(ib, "0-4|"), true, "a layer change made while it was on its way is shown once it is in");
  assert.deepEqual([s.holds(b), s.coming(b)], [true, false]);
});

test("an older load arriving after a newer one began settles nothing; the first load's callback settles the pending one", () => {
  const s = new LoadState(), a = { name: "a" }, b = { name: "b" };
  const ia = s.begin({ file: a, cut: false, asked: "k" }), ib = s.begin({ file: b, cut: true, asked: "k" });
  assert.equal(s.arrived(ia, "k"), false);
  assert.deepEqual([s.file, s.coming(b) || !!s.pending], [null, true], "still waiting for the newer one");
  s.arrived(ib, "k");
  assert.equal(s.file, b);
  const ic = s.begin({ file: a, cut: false, asked: "k" });
  assert.equal(s.arrived(null, "k"), false); assert.equal(s.file, a, "no id: whatever is pending (the first file)");
  assert.ok(ic > ib);
});

test("a failed load or a dropped file leaves the renderer with nothing; a cut load is never waited for", () => {
  const s = new LoadState(), a = { name: "a" }, b = { name: "b" };
  s.arrived(s.begin({ file: a, cut: false, asked: "k" }), "k");
  s.begin({ file: b, cut: false, asked: "k" }); s.failed();
  assert.deepEqual([s.holds(a), s.coming(b), s.file], [false, false, null], "the renderer drops its file before reading another");
  s.arrived(s.begin({ file: a, cut: false, asked: "k" }), "k"); s.dropped();
  assert.equal(s.holds(a), false);
  const ib = s.begin({ file: b, cut: true, asked: "k" });
  assert.equal(s.coming(b), false, "a cut file carries only what was asked: a change loads again");
  s.arrived(ib, "k");
  assert.equal(s.holds(b), false, "a cut file cannot show other cells");
});

test("a renderer with no showCells keeps every file cut; another build gets its chance per file", () => {
  const s = new LoadState();
  s.live = false; s.newFile(); assert.equal(s.live, true, "the last file's build could not; this one may");
  s.live = s.canFilter = false; s.newFile(); assert.equal(s.live, false);
});
