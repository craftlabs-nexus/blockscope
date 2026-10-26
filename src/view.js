// Framing beside the panel: the camera carries a view offset that puts the picture's middle in the area beside the
// panel, and a fit there must fill that area no more than the library's fit fills the whole canvas. No DOM: the page
// (main.js) hands in the camera, its pivot and the box.
import * as THREE from "three";

/** The eight corners of a box. */
export const cornersOf = (box) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));

/**
 * How much of an area `corners` take on screen (1: edge to edge), across and up: the area's middle at `x0` and half
 * its width `hw`, in normalized device coordinates, as the camera projects now (its view offset included).
 */
export function fillOf(cam, corners, x0 = 0, hw = 1) {
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  let f = 0;
  for (const c of corners) { const p = c.clone().project(cam); f = Math.max(f, Math.abs(p.x - x0) / hw, Math.abs(p.y)); }
  return f;
}

/** How much of the whole canvas `corners` take with the camera's view offset left out. */
export function fillWithoutOffset(cam, corners) {
  const v = cam.view?.enabled ? { ...cam.view } : null;
  if (v) cam.clearViewOffset();
  const f = fillOf(cam, corners);
  if (v) cam.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height);
  cam.updateProjectionMatrix();
  return f;
}

/**
 * Backs the camera off (a perspective camera along its line to `target`, an orthographic one by its zoom) until
 * `corners` fill the area right of `x0` (normalized device coordinates, the view offset's middle) no more than `want`.
 * Never moves closer, so calling it again changes nothing: a fit run again after a moment keeps its size.
 */
export function fitInto(cam, target, corners, x0, want) {
  const hw = 1 - x0;
  for (let i = 0; i < 6; i++) {
    const k = fillOf(cam, corners, x0, hw) / want; if (!(k > 1.001)) break;
    if (cam.isOrthographicCamera) cam.zoom /= k;
    else cam.position.sub(target).multiplyScalar(k).add(target);
  }
  cam.updateProjectionMatrix();
}

const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
/**
 * The side the fronts clearly face (Fit turns to it), from their counts by facing (Schematic.fronts), or null. Clear:
 * the side has at least twice the fronts of the side opposite it, and most of the fronts that do not cancel (a
 * storage room: drawers north against a few south, its aisles' east and west chests cancelling).
 */
export function clearSide(net) {
  const [side, lead] = Object.keys(OPPOSITE).map((d) => [d, net[d] - net[OPPOSITE[d]]]).sort((a, b) => b[1] - a[1])[0];
  const unpaired = Math.abs(net.north - net.south) + Math.abs(net.east - net.west);
  return lead >= 2 && net[side] >= 2 * net[OPPOSITE[side]] && lead >= 0.6 * unpaired ? side : null;
}
