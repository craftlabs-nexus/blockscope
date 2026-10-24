// Item icons for the materials list, drawn in the page from the pack's own textures: an item's flat icon as it is, a
// block as a small isometric cube (top and two shaded sides), the way the game's inventory shows it. The textures are
// read from the merged pack (the renderer's copy), each once; the icons are kept as data URLs for the page's life.
// They are drawn at four times the size they show (a texture pixel is a 4 × 4 square, edges stay sharp) and scaled
// down smoothly by the browser, so they hold their shape at any screen density.
const SIZE = 64;
// the cube as the game's inventory draws a block (turned 45°, tipped 30°): a top whose width is twice its height, and
// sides a little taller than the top (cos 30° to sin 45° · sin 30°); 56 wide, 28 + 34 tall, in the 64 square
const W = 56, TOP = W / 2, SIDE = Math.round(W * 0.6124), X0 = (SIZE - W) / 2, Y0 = Math.floor((SIZE - TOP - SIDE) / 2);
// textures the game tints by biome or colour: drawn grey in the jar, given their usual colour here
const TINTS = [
  [/block\/(grass_block_top|short_grass|tall_grass_(top|bottom)|fern|large_fern_(top|bottom)|grass_block_side_overlay)$/, "#7cbd6b"],
  [/block\/(oak|jungle|acacia|dark_oak|mangrove)_leaves$|block\/vine$/, "#59ae30"],
  [/block\/birch_leaves$/, "#80a755"], [/block\/spruce_leaves$/, "#619961"], [/block\/lily_pad$/, "#208030"],
];
const tintOf = (ref) => TINTS.find(([re]) => re.test(ref))?.[1] ?? null;

const cache = new Map();      // item id -> Promise<data URL | null>
const textures = new Map();   // texture ref -> Promise<ImageBitmap | null>

/** Forgets the icons and textures (another pack). */
export function resetIcons() { cache.clear(); textures.clear(); }

/** The icon of an item as a data URL (null when the pack has no texture for it). `spec` is the book's ["f", tex] or
 *  ["c", top, left, right]; `readTexture(path)` resolves to the PNG's Blob from the pack, or null. */
export function iconUrl(id, spec, readTexture) {
  if (!spec || !readTexture) return Promise.resolve(null);
  if (!cache.has(id)) cache.set(id, draw(spec, readTexture).catch(() => null));
  return cache.get(id);
}

function texture(ref, readTexture) {
  if (!textures.has(ref)) {
    const [ns, p] = ref.includes(":") ? ref.split(":") : ["minecraft", ref];
    textures.set(ref, readTexture(`assets/${ns}/textures/${p}.png`).then(async (blob) => {
      if (!blob) return null;
      const img = await createImageBitmap(blob);
      // an animated texture is a strip of square frames: the first one
      const w = img.width, h = Math.min(img.height, img.width);
      const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
      g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, w, h, 0, 0, w, h);
      const tint = tintOf(ref);
      if (tint) { g.globalCompositeOperation = "multiply"; g.fillStyle = tint; g.fillRect(0, 0, w, h); g.globalCompositeOperation = "destination-in"; g.drawImage(img, 0, 0, w, h, 0, 0, w, h); }
      return c;
    }).catch(() => null));
  }
  return textures.get(ref);
}

async function draw(spec, readTexture) {
  const c = document.createElement("canvas"); c.width = c.height = SIZE;
  const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
  if (spec[0] === "f") {
    const t = await texture(spec[1], readTexture); if (!t) return null;
    g.drawImage(t, 0, 0, t.width, t.height, 0, 0, SIZE, SIZE);
    return c.toDataURL();
  }
  const [top, left, right] = await Promise.all(spec.slice(1, 4).map((r) => (r ? texture(r, readTexture) : null)));
  if (!top && !left && !right) return null;
  // the corners: the top's back (T), left (L), right (R) and front (C) corners; the sides hang SIDE below L, C and R
  const T = [X0 + W / 2, Y0], L = [X0, Y0 + TOP / 2], R = [X0 + W, Y0 + TOP / 2], C = [X0 + W / 2, Y0 + TOP];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], down = [0, SIDE];
  // each face: a texture square mapped onto its parallelogram (origin, the texture's u and v edges), a shade as the
  // game lights a block in the inventory (the left side 80 %, the right 60 %), and a hair larger than the face so no
  // background shows through the seams
  const faces = [[left ?? top, L, sub(C, L), down, 0.2], [right ?? left ?? top, C, sub(R, C), down, 0.4], [top ?? left, T, sub(R, T), sub(L, T), 0]];
  const grow = 0.02;
  for (const [t, o, u, v, shade] of faces) {
    if (!t) continue;
    const layer = document.createElement("canvas"); layer.width = layer.height = SIZE;
    const lg = layer.getContext("2d"); lg.imageSmoothingEnabled = false;
    const k = 1 + grow, ox = o[0] - (u[0] + v[0]) * grow / 2, oy = o[1] - (u[1] + v[1]) * grow / 2;
    lg.setTransform((u[0] * k) / t.width, (u[1] * k) / t.width, (v[0] * k) / t.height, (v[1] * k) / t.height, ox, oy);
    lg.drawImage(t, 0, 0);
    if (shade) { lg.globalCompositeOperation = "source-atop"; lg.fillStyle = `rgba(0,0,0,${shade})`; lg.fillRect(0, 0, t.width, t.height); }
    g.drawImage(layer, 0, 0);
  }
  return c.toDataURL();
}
