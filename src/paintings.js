// Paintings overlay: Immersive Paintings are entities whose pictures live on the game's server, so a schematic shows
// only where they hang. A file may carry them (a Paintings compound: formats.js readPaintings; README, "Paintings in
// the file"): each is drawn as a textured plane on the wall it hangs on (a tan plate until the image loads).
import * as THREE from "three";

const GROUP = "blockscope_paintings";

// The surface position lies a hair in front of the block a painting hangs on: the next block against its facing.
const BEHIND = { S: [0, 0, -1], N: [0, 0, 1], E: [-1, 0, 0], W: [1, 0, 0] };
/** The world cells of the wall blocks a painting hangs on: w across the wall, h up, from its center on the surface. */
export function paintingCells(p) {
  const [dx, , dz] = BEHIND[p.dir] ?? [0, 0, 0];
  const out = [];
  const along = p.dir === "S" || p.dir === "N" ? "x" : "z";
  const a0 = Math.floor(p[along] - p.w / 2), y0 = Math.floor(p.y - p.h / 2);
  for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) {
    const x = along === "x" ? a0 + i : Math.floor(p.x), z = along === "z" ? a0 + i : Math.floor(p.z);
    out.push([x + dx, y0 + j, z + dz]);
  }
  return out;
}

const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");
const textures = new Map();   // image URL -> promise of a texture, kept across reloads
const textureOf = (url) => { if (!textures.has(url)) textures.set(url, loader.loadAsync(url).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }).catch(() => null)); return textures.get(url); };

/** Draws the paintings in the schematic group `g` and returns the ones placed, each with the world cells of the
 *  blocks it hangs on ({ painting, cells }), so the page can describe a painting when its plane is picked. */
export function buildPaintings({ group: g, paintings = [], offset, lo, hi, redraw = () => {}, isHidden = () => false }) {
  const placed = [];
  if (!g) return placed;
  let group = g.getObjectByName(GROUP);
  if (!group) { group = new THREE.Group(); group.name = GROUP; g.add(group); }
  for (const c of group.children) c.geometry?.dispose();
  group.clear();
  const [ox, oy, oz] = offset;
  for (const p of paintings) {
    const y = Math.floor(p.y - oy);
    if (y < lo || y > hi) continue;
    const [dx, , dz] = BEHIND[p.dir] ?? [0, 0, 0];
    if (isHidden(Math.floor(p.x) + dx, Math.floor(p.y), Math.floor(p.z) + dz)) continue;
    const mat = new THREE.MeshBasicMaterial({ color: 0xd9c38a, transparent: true, alphaTest: 0.05 }); // one-sided, like the game's
    if (p.img) textureOf(p.img).then((tex) => { if (!tex) return; mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; redraw(); });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
    // a plane faces +z: turn it toward `dir`
    mesh.rotation.y = { S: 0, W: -Math.PI / 2, N: Math.PI, E: Math.PI / 2 }[p.dir] ?? 0;
    // file coordinates, then half a block back: the renderer centers block (x, y, z) at local (x, y, z)
    mesh.position.set(p.x - ox - 0.5, p.y - oy - 0.5, p.z - oz - 0.5);
    mesh.name = `painting ${p.label}`;
    mesh.userData.painting = p;           // picked like a block: the page resolves the hit to the wall block behind
    mesh.userData.behind = [dx, 0, dz];   // the way into that block from the plane (main.js cellOfHit)
    group.add(mesh); placed.push({ painting: p, cells: paintingCells(p) });
  }
  return placed;
}
