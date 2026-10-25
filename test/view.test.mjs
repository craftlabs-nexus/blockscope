// node --test: framing beside the panel (src/view.js), with three's cameras.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { cornersOf, fillOf, fillWithoutOffset, fitInto } from "../src/view.js";

const W = 1600, H = 900, PANEL = 360;
const box = new THREE.Box3(new THREE.Vector3(-40, 0, -20), new THREE.Vector3(40, 10, 20));
const target = new THREE.Vector3(0, 5, 0);
function cameras() {
  const persp = new THREE.PerspectiveCamera(50, W / H, 0.1, 5000); persp.position.set(60, 80, 90); persp.lookAt(target);
  const ortho = new THREE.OrthographicCamera(-80, 80, 45, -45, 0.1, 5000); ortho.position.set(60, 80, 90); ortho.lookAt(target);
  // the picture's middle in the area right of the panel
  for (const c of [persp, ortho]) { c.setViewOffset(W, H, -PANEL / 2, 0, W, H); c.updateProjectionMatrix(); }
  return [persp, ortho];
}
const x0 = PANEL / W;

test("a fit beside the panel fills that area as the library's fit filled the canvas, and stays put when run again", () => {
  const corners = cornersOf(box);
  for (const cam of cameras()) {
    const want = fillWithoutOffset(cam, corners);
    assert.ok(cam.view.enabled, "the view offset is put back");
    fitInto(cam, target, corners, x0, want);
    const after = fillOf(cam, corners, x0, 1 - x0);
    assert.ok(after <= want * 1.002, `${cam.type}: fills ${after} of the area, wanted ${want}`);
    assert.ok(after >= want * 0.98, `${cam.type}: not backed off further than needed`);
    // the deferred passes: the same want, again and again, change nothing
    const pos = cam.position.clone(), zoom = cam.zoom;
    for (let i = 0; i < 3; i++) fitInto(cam, target, corners, x0, want);
    assert.ok(cam.position.distanceTo(pos) < 1e-6 && cam.zoom === zoom, `${cam.type}: a pass run again keeps the size`);
  }
});

test("a model that already fits is left where it is", () => {
  const corners = cornersOf(new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1)));
  for (const cam of cameras()) {
    const pos = cam.position.clone(), zoom = cam.zoom;
    fitInto(cam, target, corners, x0, 0.9);
    assert.ok(cam.position.distanceTo(pos) < 1e-9 && cam.zoom === zoom);
  }
});
