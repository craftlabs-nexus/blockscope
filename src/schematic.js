// The loaded schematic in memory, and everything the page reads from it or does to it before the renderer sees it:
// its size and world offset, whether its top layer is a roof, its shell (roof, walls, floor), its parts' cells, its
// signs, its namespaces and framed material sets, how many blocks each layer has, and the file the renderer gets
// (layers sliced off, hidden cells turned to air, framed drawers renamed per material set). A Sponge .schem is read
// as it is; a .litematic or a structure .nbt is turned into one in the page (formats.js), anything else (an MCEdit
// .schematic) by Nucleation, the renderer's WASM. The block metadata comes from the file when it carries some
// (BlockInfo, formats.js), and a Litematica file's regions stand in for parts in a file without it.
import { readNbt, encodeNbt, gzip, decodeVarints, encodeVarints } from "./nbt.js";
import { formatOf, litematicToSponge, structureToSponge, readBlockInfo, readMods, readDescription } from "./formats.js";
import { framedKind, framedViewerId } from "./framed.js";
import { partOf, shellPart } from "./parts.js";

const AIR = /^minecraft:(cave_|void_)?air$/;
const baseId = (key) => key.replace(/\[.*$/, "");
const num = (v) => (v && typeof v === "object" && "v" in v ? Number(v.v) : Number(v));

// A roof, for a file with no shell metadata: a nearly full top layer (topFill, the share of the footprint it covers)
// over a mostly open layer, in a file at least four layers tall. A two-high fixture is all "top layer", an engine
// room's top layer is empty; neither counts.
export const ROOF_FILL = 0.75, ROOF_BELOW = 0.5, ROOF_MIN_HEIGHT = 4;
// The inert building blocks that may be shell in a file without metadata (on the outside of the box only).
export const INERT = /^(minecraft:(.*_(stone|bricks|brick|tiles|tile|planks|log|wood|concrete|terracotta|wool|carpet|slab|stairs|wall|glass)|stone|deepslate|cobblestone|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dirt|grass_block|gravel|sand|red_sand|sandstone|red_sandstone|obsidian|netherrack|basalt|blackstone|end_stone|glass|moss_block|mud|packed_mud|clay|bone_block|quartz_block|smooth_stone|smooth_quartz|terracotta|bedrock)|promenade:.*blunite.*|trailiertales:.*(bricks|calcite).*|mcwpaths:.*)$/;

/** Converts any format Nucleation reads to Sponge .schem bytes. */
async function toSponge(bytes) {
  const { SchematicWrapper, initializeNucleationWasm } = await import("@craftlabs/schematic-renderer");
  await initializeNucleationWasm?.();
  const w = new SchematicWrapper();
  w.from_data(bytes);
  try { return w.to_schematic(); } finally { w.free?.(); }
}

export class Schematic {
  /** Reads a schematic from its bytes, whatever its name says: its contents decide the format. */
  static async load(bytes, name) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let nbt = null;
    try { nbt = await readNbt(u8); } catch { /* not NBT this page reads: Nucleation's turn */ }
    const format = nbt ? formatOf(nbt.value) : null;
    const info = nbt ? readBlockInfo(nbt.value) : null;
    const mods = nbt ? readMods(nbt.value) : null, description = nbt ? readDescription(nbt.value) : null;
    let regions = null, regionOf = null;
    if (format === "litematic") ({ value: nbt.value, regions, regionOf } = litematicToSponge(nbt.value));
    else if (format === "structure") nbt.value = structureToSponge(nbt.value).value;
    else if (format !== "sponge") nbt = await readNbt(await toSponge(u8));
    const s = new Schematic(nbt, name, { format: format ?? "converted", info });
    s.mods = mods; s.description = description;
    if (regions?.length > 1) s.#useRegions(regions, regionOf);
    return s;
  }
  static isSponge(nbt) { return formatOf(nbt?.value) === "sponge"; }

  constructor(nbt, name, { format = "sponge", info = null } = {}) {
    this.name = name;
    this.nbt = nbt;
    this.format = format;   // sponge, litematic, structure, or converted (by Nucleation)
    /** The file's own block metadata (keyed "x,y,z" in world coordinates) or null; metaSource says where any came
     *  from: "file" (BlockInfo), "regions" (a Litematica file's), or null. regions: a Litematica file's, else null. */
    this.meta = info?.meta ?? null;
    this.metaSource = this.meta ? "file" : null;
    /** The parts in the order the file lists them (BlockInfo Parts), or null. */
    this.partOrder = info?.parts ?? null;
    /** The mod list the file carries (formats.js readMods), or null; its description, or null. */
    this.mods = null; this.description = null;
    this.regions = null;
    // v1/v2 keep Width, Palette and BlockData at the root; v3 nests the root under Schematic and the blocks under Blocks
    this.v3 = !!nbt.value.Schematic;
    this.root = nbt.value.Schematic ?? nbt.value;
    this.blocks = this.root.Blocks?.Palette ? this.root.Blocks : this.root;
    this.width = num(this.root.Width); this.height = num(this.root.Height); this.length = num(this.root.Length);
    const o = this.root.Offset;
    // a format with no offset of its own takes the world position its BlockInfo gives, so a cell has the same world
    // position (and metadata key) in each of a build's files
    this.offset = o && format === "sponge" ? Array.from(o.v ?? o, Number) : info ? info.origin.slice() : o ? Array.from(o.v ?? o, Number) : [0, 0, 0];
    this.keys = []; for (const [k, v] of Object.entries(this.blocks.Palette)) this.keys[num(v)] = k;
    this.data = decodeVarints(this.blocks.BlockData ?? this.blocks.Data);
    this.air = new Set(this.keys.map((k, i) => (k && AIR.test(baseId(k)) ? i : -1)).filter((i) => i >= 0));
    this.entities = Array.from(this.blocks.BlockEntities?.v ?? this.root.TileEntities?.v ?? []);
    this.signs = this.#readSigns();
  }

  /** A Litematica file's regions as its parts, when it carries no metadata: each placed block's entry is { part }. */
  #useRegions(regions, regionOf) {
    this.regions = regions;
    if (this.meta) return;
    const meta = {}, [ox, oy, oz] = this.offset, entry = regions.map((r) => ({ part: r.name }));
    for (let i = 0; i < regionOf.length; i++) {
      if (!regionOf[i]) continue;
      const [x, y, z] = this.cellOf(i);
      meta[`${x + ox},${y + oy},${z + oz}`] = entry[regionOf[i] - 1];
    }
    this.meta = meta; this.metaSource = "regions";
  }

  get perLayer() { return this.width * this.length; }
  index(x, y, z) { return (y * this.length + z) * this.width + x; }
  cellOf(i) { const x = i % this.width, z = Math.floor(i / this.width) % this.length, y = Math.floor(i / this.perLayer); return [x, y, z]; }
  idAt(i) { return this.keys[this.data[i]] ?? "minecraft:air"; }
  /** The palette's ids by namespace: { namespaces (not minecraft), ids } */
  namespaces() {
    const ns = new Set();
    for (const k of this.keys) if (k) { const id = baseId(k); ns.add(id.includes(":") ? id.split(":")[0] : "minecraft"); }
    ns.delete("minecraft");
    return [...ns].sort();
  }

  /** Size, offset and the roof test. */
  info() {
    const fill = (y) => { let n = 0; for (let i = y * this.perLayer; i < (y + 1) * this.perLayer && i < this.data.length; i++) if (!this.air.has(this.data[i])) n++; return this.perLayer ? n / this.perLayer : 0; };
    const topFill = this.height ? fill(this.height - 1) : 0, belowFill = this.height > 1 ? fill(this.height - 2) : 0;
    const r2 = (v) => Math.round(v * 100) / 100;
    return { width: this.width, height: this.height, length: this.length, offset: this.offset, topFill: r2(topFill), belowFill: r2(belowFill), roof: this.height >= ROOF_MIN_HEIGHT && topFill >= ROOF_FILL && belowFill <= ROOF_BELOW };
  }

  /** The metadata entry of a cell (file coordinates), keyed by world position in the meta file. */
  metaAt(meta, x, y, z) { const [ox, oy, oz] = this.offset; return meta?.[`${x + ox},${y + oy},${z + oz}`] ?? null; }

  /** Every shell cell: Map of block index -> part, how many cells each part has, and the share of the footprint the
   *  roof covers. From the metadata when it tags any shell, else the inert blocks on the outside of a roofed box. */
  shellOf(meta) {
    if (meta && !Object.values(meta).some((m) => shellPart(m))) meta = null;
    const roofed = this.info().roof;
    const parts = new Map(), counts = { roof: 0, wall: 0, floor: 0 };
    for (let i = 0; i < this.data.length; i++) {
      if (this.air.has(this.data[i])) continue;
      const [x, y, z] = this.cellOf(i);
      let part = null;
      if (meta) part = shellPart(this.metaAt(meta, x, y, z));
      else if (roofed && INERT.test(baseId(this.idAt(i)))) part = y === this.height - 1 ? "roof" : y === 0 ? "floor" : x === 0 || x === this.width - 1 || z === 0 || z === this.length - 1 ? "wall" : null;
      if (part) { parts.set(i, part); counts[part]++; }
    }
    return { parts, counts, roofCover: Math.round((counts.roof / (this.perLayer || 1)) * 100) / 100 };
  }

  /** The block indices of every cell whose metadata puts it in one of the named parts. */
  partIndices(meta, names) {
    const out = new Set();
    if (!meta || !names.size) return out;
    for (let i = 0; i < this.data.length; i++) { const [x, y, z] = this.cellOf(i); const p = partOf(this.metaAt(meta, x, y, z)); if (p && names.has(p)) out.add(i); }
    return out;
  }

  /** How many blocks that are not air each layer has, bottom first, with the hidden cells counted as air. */
  layerCounts(hidden = new Set()) {
    const out = new Array(this.height).fill(0);
    for (let i = 0; i < this.data.length && i < this.perLayer * this.height; i++) if (!this.air.has(this.data[i]) && !hidden.has(i)) out[Math.floor(i / this.perLayer)]++;
    return out;
  }

  /** Every framed material set the file uses: [{ id, kind, side, trim, front }]. */
  framedCombos() {
    const out = new Map();
    for (const [i, id, be] of this.#framedCells()) { const f = framedViewerId(id, be); if (!out.has(f.id)) out.set(f.id, f); void i; }
    return [...out.values()];
  }
  /** Every framed cell with its materials: [[block index, id, { side, trim, front }], …] (tokens as framed.js). */
  framedCells() {
    const out = [];
    for (const [i, id, be] of this.#framedCells()) { const f = framedViewerId(id, be); out.push([i, id, { side: f.side, trim: f.trim, front: f.front }]); }
    return out;
  }
  *#framedCells() {
    const framed = new Map(); this.keys.forEach((k, i) => { if (k && framedKind(baseId(k))) framed.set(i, baseId(k)); });
    if (!framed.size) return;
    const be = this.#entitiesByCell();
    for (let i = 0; i < this.data.length; i++) { const id = framed.get(this.data[i]); if (id) { const [x, y, z] = this.cellOf(i); yield [i, id, be.get(`${x},${y},${z}`)]; } }
  }
  #entitiesByCell() {
    const m = new Map();
    for (const e of this.entities) { const p = e.Pos; if (!p) continue; const [x, y, z] = Array.from(p.v ?? p, Number); m.set(`${x},${y},${z}`, e.Data ?? e); }
    return m;
  }

  /** The signs as plain records, file coordinates: { x, y, z, id, facing, rotation, lines, color, glow, waxed, back }. */
  #readSigns() {
    const out = [];
    const line = (l) => {
      let s = typeof l === "string" ? l : String(l?.v ?? l?.text ?? "");
      // a JSON text component ("\"text\"" or {"text": ...}) as older files store it
      if (/^["{[]/.test(s)) { try { const j = JSON.parse(s); s = typeof j === "string" ? j : j?.text ?? (Array.isArray(j) ? j.map((x) => x?.text ?? x).join("") : s); } catch {} }
      return s;
    };
    for (const e of this.entities) {
      const d = e.Data ?? e, ft = d.front_text; if (!ft || !e.Pos) continue;
      const [x, y, z] = Array.from(e.Pos.v ?? e.Pos, Number);
      if (x < 0 || y < 0 || z < 0 || x >= this.width || y >= this.height || z >= this.length) continue;
      const key = this.idAt(this.index(x, y, z));
      const m = key.match(/^([^[]+)(?:\[(.*)\])?$/); if (!m) continue;
      const props = Object.fromEntries((m[2] ?? "").split(",").filter(Boolean).map((kv) => kv.split("=")));
      const text = (t) => ({ lines: Array.from(t?.messages?.v ?? t?.messages ?? [], line), color: t?.color ?? "black", glow: !!num(t?.has_glowing_text ?? 0) });
      const front = text(ft), back = text(d.back_text);
      out.push({ x, y, z, id: m[1], facing: props.facing ?? null, rotation: props.rotation !== undefined ? Number(props.rotation) : null, ...front, waxed: !!num(d.is_waxed ?? 0), back: back.lines.some(Boolean) ? back : null });
    }
    return out;
  }

  /**
   * The file the renderer gets, gzipped: only the layers minY <= y < maxY (maxY null for the top, negative from the
   * top), the `hidden` block indices turned to air (their block entities dropped), and framed drawers renamed per
   * material set (framed.js) so the pack's composite models apply.
   */
  async render({ hidden = new Set(), minY = 0, maxY = null, framed = true } = {}) {
    if (maxY === null || maxY === undefined) maxY = this.height;
    if (maxY < 0) maxY = this.height + maxY;
    maxY = Math.min(maxY, this.height); minY = Math.max(0, minY ?? 0);
    const palette = Object.fromEntries(Object.entries(this.blocks.Palette).map(([k, v]) => [k, { t: 3, v: num(v) }]));
    let next = Math.max(-1, ...Object.values(palette).map((v) => v.v)) + 1;
    const idOf = (key) => { if (!(key in palette)) palette[key] = { t: 3, v: next++ }; return palette[key].v; };
    const air = [...this.air][0] ?? idOf("minecraft:air");
    const data = this.data.slice();
    const lo = minY * this.perLayer, hi = maxY * this.perLayer;
    const gone = (i) => i < lo || i >= hi || hidden.has(i);
    if (framed) for (const [i, id, be] of this.#framedCells()) {
      const state = this.idAt(i).match(/(\[.*)$/)?.[1] ?? "";
      data[i] = idOf(framedViewerId(id, be).id + state);
    }
    for (let i = 0; i < data.length; i++) if (gone(i)) data[i] = air;
    const keep = (e) => { const p = e.Pos; if (!p) return true; const [x, y, z] = Array.from(p.v ?? p, Number); return !gone(this.index(x, y, z)); };
    const dataKey = "BlockData" in this.blocks ? "BlockData" : "Data";   // v3 calls it Data
    const blocks = { ...this.blocks, Palette: palette, [dataKey]: encodeVarints(data) };
    if (blocks.PaletteMax) blocks.PaletteMax = { t: 3, v: next };
    if (this.blocks.BlockEntities) blocks.BlockEntities = { ...this.blocks.BlockEntities, v: this.blocks.BlockEntities.v.filter(keep) };
    let root = this.blocks === this.root ? blocks : { ...this.root, Blocks: blocks };
    // the block metadata is the page's, not the renderer's: left out of the file it gets
    if (root.Metadata?.BlockInfo) { const { BlockInfo, ...rest } = root.Metadata; root = { ...root, Metadata: rest }; void BlockInfo; }
    if (root.BlockInfo) { const { BlockInfo, ...rest } = root; root = rest; void BlockInfo; }
    if (!this.blocks.BlockEntities && this.root.TileEntities) root = { ...root, TileEntities: { ...this.root.TileEntities, v: this.root.TileEntities.v.filter(keep) } };
    const value = this.v3 ? { ...this.nbt.value, Schematic: root } : root;
    return gzip(encodeNbt({ name: this.nbt.name, value }));
  }
}
