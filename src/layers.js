// Stepping through the layers (PageUp / PageDown, [ ], the arrow buttons): a step goes to the nearest layer that
// changes what is drawn, so with one part shown (or a few layers of blocks under a tall empty file) the view never
// sits on a step that shows the same blocks as the one before.

/**
 * The layer a step from `cur` in direction `d` (1 up, -1 down) lands on in `mode` ("below": layers 0..cur, "above":
 * cur..top, "single": cur alone), given the layers that hold a block once the hidden parts and shell are air
 * (`filled`, ascending); null when no layer that way changes the view.
 *
 * Below: down drops the highest filled layer shown and lands on the next filled one under it (the top of what is
 * left); up adds the next filled layer. Above, the other way round. Single: the next filled layer.
 */
export function stepTarget(mode, cur, d, filled) {
  const below = (y) => last(filled, (f) => f < y);    // the highest filled layer under y
  const above = (y) => first(filled, (f) => f > y);   // the lowest filled layer over y
  if (mode === "below") {
    if (d > 0) return above(cur);
    const top = last(filled, (f) => f <= cur);   // the top of what is drawn now
    return top === null ? null : below(top);
  }
  if (mode === "above") {
    if (d < 0) return below(cur);
    const bottom = first(filled, (f) => f >= cur);   // the bottom of what is drawn now
    return bottom === null ? null : above(bottom);
  }
  return d > 0 ? above(cur) : below(cur);
}

/** The layers with at least one block, ascending, from per-layer block counts. */
export const filledLayers = (counts) => counts.flatMap((n, y) => (n > 0 ? [y] : []));

function first(a, ok) { for (const v of a) if (ok(v)) return v; return null; }
function last(a, ok) { for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return a[i]; return null; }
