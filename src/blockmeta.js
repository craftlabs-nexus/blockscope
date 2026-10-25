// The generator's block metadata (owner, role, item, part, shell per block: a file's BlockInfo, or a Litematica
// file's regions), kept as one number per cell, an index into the few distinct records, over a box of
// world positions. A million tagged blocks are 4 bytes each, not a million "x,y,z" string keys, and a scan over every
// cell (the parts, the shell, the cell groups) is a typed-array loop, not a walk over a million-key object.

export class BlockMeta {
  /**
   * `origin`: the world position of the box's first cell; `size`: [width, height, length]; `cells`: each cell's
   * record index + 1 (0: none), x fastest, then z, then y (a Sponge file's order); `records`: the distinct records.
   */
  constructor(origin, size, cells, records) {
    this.origin = origin.slice(0, 3).map(Number);
    this.size = size.slice(0, 3).map(Number);
    this.cells = cells;
    this.records = records;
    let n = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i]) n++;
    /** How many cells have a record. */
    this.count = n;
  }

  /** The record at a world position, or null. */
  at(x, y, z) {
    const [W, H, L] = this.size, lx = x - this.origin[0], ly = y - this.origin[1], lz = z - this.origin[2];
    if (!(lx >= 0 && ly >= 0 && lz >= 0 && lx < W && ly < H && lz < L)) return null;
    const r = this.cells[(ly * L + lz) * W + lx];
    return r ? this.records[r - 1] : null;
  }

  /** The record of the box's cell `i`, or null. */
  recordAt(i) { const r = this.cells[i]; return r ? this.records[r - 1] : null; }

  /** Whether the box is a file's own (the same origin and size), so a file's cell index is the box's. */
  alignedWith(origin, size) { return [0, 1, 2].every((a) => this.origin[a] === origin[a] && this.size[a] === size[a]); }

  /** Each record mapped once (`fn(record)`), for per-cell answers without calling `fn` a cell at a time. */
  mapRecords(fn) { return this.records.map(fn); }

  /** Every tagged cell: [x, y, z] world position and its record. */
  *entries() {
    const [W, , L] = this.size, [ox, oy, oz] = this.origin, layer = W * L;
    for (let i = 0; i < this.cells.length; i++) {
      const r = this.cells[i]; if (!r) continue;
      yield [[ox + (i % W), oy + Math.floor(i / layer), oz + (Math.floor(i / W) % L)], this.records[r - 1]];
    }
  }
}
