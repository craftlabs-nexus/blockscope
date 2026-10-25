// The parts of a schematic: the logical pieces a person wants to see on their own or hide (one autocrafting line,
// the clock, the drawer wall, an aisle, the shell), read from the generator's block metadata (a file's BlockInfo:
// owner, role, item per block; the hall's metadata also tags `part` outright). Shared with the storage
// plan's generators, whose own copy is `storage-plan/parts.mjs`; the two agree on partOf and the order.

/** The part a block belongs to, from its metadata entry, or null for a block without one. */
export function partOf(m) {
  if (!m) return null;
  if (m.part) return m.part;
  const o = m.owner ?? "";
  if (o === "room") return "room shell";
  if (o === "network") return "network";
  if (o === "tap") return "taps & shared runs";
  if (o === "clock") return "clock";
  // the engine room's lines own their cells as "<line>", their feed runs as "<line>:<port>", and a shared run from one
  // tap to several lines as "<tap>:<line>:<port>"
  const seg = o.split(":");
  if (seg.length >= 3) return "taps & shared runs";
  return seg[0] || "other";
}
// the infrastructure parts sort after the lines and aisles, the shell last
const LAST = { "taps & shared runs": 1, network: 2, clock: 3, "drawer wall": 4, "doors: sort chests & stations": 5, disposal: 5.5, "enchanting nooks": 6, other: 8, "room shell": 9, shell: 9 };
const rank = (n) => LAST[n] ?? (n.startsWith("satellite: ") ? 4.5 : 0);   // the hall's satellites follow its drawer wall
const partSort = (a, b) => rank(a) - rank(b) || a.localeCompare(b);

/** Every part of the block metadata (a BlockMeta) with its block count, in display order: the file's own order when
 *  it gives one (`order`, BlockInfo Parts), any part it does not name after those; else the order above. `box`
 *  ({ origin, size }, a file's): only the cells in it count, for metadata over a box of its own. */
export function partsOf(meta, order = null, box = null) {
  // each record's part once, then the cells counted by record
  const counts = new Map(), perRecord = new Uint32Array(meta.records.length + 1);
  if (!box || meta.alignedWith(box.origin, box.size)) for (let i = 0; i < meta.cells.length; i++) perRecord[meta.cells[i]]++;
  else {
    const [W, , L] = meta.size, per = W * L, lo = box.origin.map((v, a) => v - meta.origin[a]), hi = lo.map((v, a) => v + box.size[a]);
    for (let i = 0; i < meta.cells.length; i++) {
      const rec = meta.cells[i]; if (!rec) continue;
      const y = (i / per) | 0, r = i - y * per, z = (r / W) | 0, x = r - z * W;
      if (x >= lo[0] && x < hi[0] && y >= lo[1] && y < hi[1] && z >= lo[2] && z < hi[2]) perRecord[rec]++;
    }
  }
  meta.records.forEach((m, r) => { const p = partOf(m); if (p && perRecord[r + 1]) counts.set(p, (counts.get(p) ?? 0) + perRecord[r + 1]); });
  const at = new Map((order ?? []).map((n, i) => [n, i])), pos = (n) => at.get(n) ?? Infinity;
  return [...counts].sort(([a], [b]) => (order ? pos(a) - pos(b) || 0 : 0) || partSort(a, b)).map(([name, count]) => ({ name, count }));
}

/** The shell part (roof, wall, floor) a metadata entry tags, or null: the hall says `shell` outright, the engine
 *  room's walls, floor and ceiling are the room's with a role that starts with wall / floor / ceiling. */
export function shellPart(m) {
  if (!m) return null;
  if (m.shell) return m.shell;
  if (m.owner !== "room") return null;
  const r = m.role ?? "";
  return /^wall\b/.test(r) ? "wall" : /^floor\b/.test(r) ? "floor" : /^(ceiling|roof)\b/.test(r) ? "roof" : null;
}
