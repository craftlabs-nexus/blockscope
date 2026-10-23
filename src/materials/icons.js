// Item icons for the materials list, drawn in the page from the pack's own textures: an item's flat icon as it is, a
// block as a small isometric cube (top and two shaded sides), the way the game's inventory shows it. The textures are
// read from the merged pack (the renderer's copy), each once; the icons are kept as data URLs for the page's life.
const SIZE = 32;
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
  // three faces of a cube seen from above: each a texture square under an affine map (a, b, c, d, e, f on a 32-unit
  // canvas, a 16-pixel texture side spanning 16 units), drawn on a layer of its own so a side's shade stays on it
  const faces = [[left ?? top, [1, 0.5, 0, 1, 0, 8], 0.22], [right ?? left ?? top, [1, -0.5, 0, 1, 16, 16], 0.4], [top ?? left, [1, 0.5, -1, 0.5, 16, 0], 0]];
  const k = SIZE / 32;
  for (const [t, [a, b, cc, d, e, f], shade] of faces) {
    if (!t) continue;
    const o = document.createElement("canvas"); o.width = o.height = SIZE;
    const og = o.getContext("2d"); og.imageSmoothingEnabled = false;
    og.setTransform((a * k * 16) / t.width, (b * k * 16) / t.width, (cc * k * 16) / t.height, (d * k * 16) / t.height, e * k, f * k);
    og.drawImage(t, 0, 0);
    if (shade) { og.globalCompositeOperation = "source-atop"; og.fillStyle = `rgba(0,0,0,${shade})`; og.fillRect(0, 0, t.width, t.height); }
    g.drawImage(o, 0, 0);
  }
  return c.toDataURL();
}
