// The schematic formats the page reads itself, each turned into a Sponge v2 root (the form the rest of the page and
// the renderer work with), and the block metadata a file may carry (BlockInfo, below).
//   Litematica (.litematic): its regions merged into one box at their positions; a cell takes the last region's block
//     that is neither air nor structure void (a region's empty cells, written as structure void or air, never erase
//     another region's blocks). The regions are kept, so they can stand in for parts.
//   Vanilla structure (.nbt): its palette (the first of `palettes` when there are several) and its blocks; a cell the
//     file does not list is air.
// The values keep the NBT reader's types (numbers as { t, v }, lists as { t: 9, et, v }), so the result encodes back.
import { BlockMeta } from "./blockmeta.js";
import { encodeVarints } from "./nbt.js";

const i16 = (v) => ({ t: 2, v }), i32 = (v) => ({ t: 3, v });
const num = (v) => (v && typeof v === "object" && "v" in v ? Number(v.v) : Number(v));
const list = (v) => (Array.isArray(v) ? v : Array.from(v?.v ?? v ?? []));
const triple = (v) => (v && !ArrayBuffer.isView(v) && !Array.isArray(v) && "x" in v ? [v.x, v.y, v.z] : list(v)).map(num);
const VOID = "minecraft:structure_void";
const AIR = /^minecraft:(cave_|void_)?air$/;

/** What kind of schematic an NBT root is: "sponge", "litematic", "structure", or null (Nucleation's to read). */
export function formatOf(value) {
  const r = value?.Schematic ?? value;
  if (r?.Width && (r.Palette || r.Blocks?.Palette)) return "sponge";
  if (value?.Regions && typeof value.Regions === "object") return "litematic";
  if (value?.size && value?.blocks && (value.palette || value.palettes)) return "structure";
  return null;
}

/** A palette entry's block state key: Name[k=v,...], the properties in the file's order. */
function stateKey(e) {
  const props = Object.entries(e?.Properties ?? {}).map(([k, v]) => `${k}=${typeof v === "string" ? v : num(v)}`);
  return (e?.Name ?? "minecraft:air") + (props.length ? `[${props.join(",")}]` : "");
}

/** A Sponge palette under construction: air at 0, then each key once. */
function paletteBuilder() {
  const ids = new Map([["minecraft:air", 0]]);
  return { ids, id: (key) => { if (AIR.test(key)) return 0; if (!ids.has(key)) ids.set(key, ids.size); return ids.get(key); } };
}

/** A block entity as Sponge v2 keeps one: Id, Pos (file coordinates) and its data beside them. */
function spongeEntity(te, pos, blockKey) {
  const { id, Id, x, y, z, ...rest } = te;
  return { ...rest, Id: id ?? Id ?? blockKey.replace(/\[.*$/, ""), Pos: new Int32Array(pos) };
}

function spongeRoot({ W, H, L, offset, palette, data, entities, dataVersion, metadata }) {
  const Palette = {}; for (const [k, v] of palette.ids) Palette[k] = i32(v);
  return {
    Version: i32(2), DataVersion: i32(dataVersion || 0), Width: i16(W), Height: i16(H), Length: i16(L),
    Offset: new Int32Array(offset), PaletteMax: i32(palette.ids.size), Palette,
    BlockData: encodeVarints(data), BlockEntities: { t: 9, et: 10, v: entities }, ...(metadata ? { Metadata: metadata } : {}),
  };
}

/**
 * The cells of one Litematica region, as palette indices: its BlockStates are bit-packed, bits per entry
 * max(2, ceil(log2(palette size))), entry i at bit i * bits counted across the longs, entries crossing a long's edge.
 */
function regionStates(longs, bits, count) {
  // each long as two unsigned 32-bit words, low first: the same bit stream, read without BigInt per cell
  const words = new Uint32Array(longs.length * 2);
  for (let j = 0; j < longs.length; j++) { const v = BigInt.asUintN(64, BigInt(longs[j])); words[2 * j] = Number(v & 0xffffffffn); words[2 * j + 1] = Number(v >> 32n); }
  const out = new Uint32Array(count), mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const start = i * bits, w = Math.floor(start / 32), off = start % 32;
    let v = words[w] >>> off;
    if (off + bits > 32) v |= words[w + 1] << (32 - off);
    out[i] = (v & mask) >>> 0;
  }
  return out;
}

/**
 * A Litematica root as a Sponge v2 root, with the regions: { value, regions: [{ name, x0, y0, z0, W, H, L }],
 * regionOf (Int16Array: per cell of the merged box, 1 + the region whose block it shows, 0 for air) }. The box is
 * the union of the regions (a negative size runs from the position back); its corner is file position 0, 0, 0.
 */
export function litematicToSponge(value) {
  const regions = Object.entries(value.Regions ?? {}).map(([name, r]) => {
    const pos = triple(r.Position), size = triple(r.Size);
    const lo = pos.map((p, a) => (size[a] < 0 ? p + size[a] + 1 : p));
    return { name, r, lo, dims: size.map(Math.abs) };
  });
  if (!regions.length) throw new Error("the Litematica file has no regions");
  const min = [0, 1, 2].map((a) => Math.min(...regions.map((g) => g.lo[a])));
  const max = [0, 1, 2].map((a) => Math.max(...regions.map((g) => g.lo[a] + g.dims[a])));
  const [W, H, L] = max.map((m, a) => m - min[a]);
  const palette = paletteBuilder(), data = new Int32Array(W * H * L), regionOf = new Int16Array(W * H * L);
  const entities = new Map();   // merged cell index -> block entity
  regions.forEach(({ r, lo, dims }, ri) => {
    const pal = list(r.BlockStatePalette).map(stateKey);
    const map = pal.map((k) => (k === VOID || AIR.test(k) ? -1 : palette.id(k)));
    const [w, h, l] = dims, count = w * h * l;
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(pal.length, 1))));
    const states = regionStates(r.BlockStates ?? [], bits, count);
    const [ox, oy, oz] = lo.map((p, a) => p - min[a]);
    const placed = new Set();
    for (let i = 0; i < count; i++) {
      const s = map[states[i]]; if (s === undefined || s < 0) continue;
      const x = i % w, z = Math.floor(i / w) % l, y = Math.floor(i / (w * l));
      const at = ((y + oy) * L + (z + oz)) * W + (x + ox);
      data[at] = s; regionOf[at] = ri + 1; placed.add(at); entities.delete(at);
    }
    for (const te of list(r.TileEntities)) {
      const [x, y, z] = [te.x, te.y, te.z].map(num), at = ((y + oy) * L + (z + oz)) * W + (x + ox);
      if (placed.has(at)) entities.set(at, spongeEntity(te, [x + ox, y + oy, z + oz], ""));   // no id: the block's, below
    }
  });
  const keys = [...palette.ids.keys()];
  for (const [at, e] of entities) if (!e.Id) e.Id = keys[data[at]].replace(/\[.*$/, "");
  const md = value.Metadata ?? {};
  const metadata = { ...(md.Name ? { Name: md.Name } : {}), ...(md.Author ? { Author: md.Author } : {}), ...(md.Description ? { Description: md.Description } : {}) };
  return {
    value: spongeRoot({ W, H, L, offset: [0, 0, 0], palette, data, entities: [...entities.values()], dataVersion: num(value.MinecraftDataVersion), metadata: Object.keys(metadata).length ? metadata : null }),
    regions: regions.map(({ name, lo, dims }) => ({ name, x0: lo[0] - min[0], y0: lo[1] - min[1], z0: lo[2] - min[2], W: dims[0], H: dims[1], L: dims[2] })),
    regionOf,
  };
}

/** A vanilla structure root as a Sponge v2 root: { value }. */
export function structureToSponge(value) {
  const [W, H, L] = list(value.size).map(num);
  const pal = list(value.palette ?? list(value.palettes)[0]).map(stateKey);
  const palette = paletteBuilder(), map = pal.map((k) => (k === VOID ? 0 : palette.id(k)));
  const data = new Int32Array(W * H * L), entities = [];
  for (const b of list(value.blocks)) {
    const [x, y, z] = list(b.pos).map(num);
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= L) continue;
    const s = map[num(b.state)] ?? 0;
    data[(y * L + z) * W + x] = s;
    if (b.nbt && s) entities.push(spongeEntity(b.nbt, [x, y, z], pal[num(b.state)]));
  }
  return { value: spongeRoot({ W, H, L, offset: [0, 0, 0], palette, data, entities, dataVersion: num(value.DataVersion) }) };
}

/**
 * The block metadata a file carries, as the page keeps metadata (an object keyed "x,y,z" in world coordinates, each
 * entry { owner, role, item, part, shell, ... }), and the world position of the file's cell 0, 0, 0; or null.
 * BlockInfo, version 1, in a Sponge file's Metadata compound or at the root of any format:
 *   Origin (int array x, y, z): the world position of cell 0, 0, 0; Size (int array width, height, length): the box
 *   Cells counts; Records: the distinct entries, compounds of strings and lists of strings; Cells (int array, one per
 *   cell of the box, index (y * length + z) * width + x): 0 for a cell without an entry, else 1 + its index in Records;
 *   Parts (list of strings, optional): the parts in the order to list them.
 */
export function readBlockInfo(value) {
  const r = value?.Schematic ?? value;
  const b = r?.Metadata?.BlockInfo ?? r?.BlockInfo;
  if (!b || num(b.Version) !== 1 || !b.Cells || !b.Size) return null;
  const origin = b.Origin ? Array.from(b.Origin, Number) : [0, 0, 0];
  const records = list(b.Records).map((rec) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, typeof v === "string" ? v : v?.t === 9 ? v.v.map((x) => (typeof x === "string" ? x : num(x))) : num(v)])));
  // the cells as they come: a record index + 1 a cell, x fastest, then z, then y (an index past the records: none)
  const size = Array.from(b.Size, Number), raw = b.Cells.v ?? b.Cells, cells = new Uint32Array(size[0] * size[1] * size[2]);
  for (let i = 0; i < cells.length && i < raw.length; i++) { const n = num(raw[i]); if (n > 0 && records[n - 1]) cells[i] = n; }
  const meta = new BlockMeta(origin, size, cells, records);
  // the parts in the order the generator lists them, when it says
  const parts = b.Parts ? list(b.Parts).filter((n) => typeof n === "string") : null;
  return { origin, meta, parts: parts?.length ? parts : null };
}

/**
 * The mod list a file carries (a Mods compound, version 1, in a Sponge file's Metadata or at the root of any format),
 * or null: { minecraft, loader, loaderVersion, list: [{ name, modId, project, versionId, file, url, size, sha512,
 * sha1, namespaces }] }. Only entries with a file name, a URL and a sha512 are kept; where a jar may be fetched from
 * is the pack source's to decide (sources.js fileSource).
 */
export function readMods(value) {
  const r = value?.Schematic ?? value;
  const m = r?.Metadata?.Mods ?? r?.Mods;
  if (!m || num(m.Version) !== 1) return null;
  const str = (v) => (typeof v === "string" ? v : null);
  const list = list_(m.List).map((e) => ({
    name: str(e.Name), modId: str(e.ModId), project: str(e.Project), versionId: str(e.VersionId), file: str(e.File), url: str(e.Url),
    size: e.Size === undefined ? null : num(e.Size), sha512: str(e.Sha512)?.toLowerCase() ?? null, sha1: str(e.Sha1)?.toLowerCase() ?? null,
    namespaces: list_(e.Namespaces).filter((n) => typeof n === "string"),
  })).filter((e) => e.file && e.url && /^[0-9a-f]{128}$/.test(e.sha512 ?? ""));
  return { minecraft: str(m.Minecraft), loader: str(m.Loader), loaderVersion: str(m.LoaderVersion), list };
}
const list_ = list;

/**
 * The paintings a file carries (a Paintings compound, version 1, in a Sponge file's Metadata or at the root of any
 * format), as the overlay draws them, or an empty list: [{ label, name, x, y, z, w, h, dir, bytes }], world
 * coordinates of each one's centre on its wall's face, `bytes` its PNG (Uint8Array). The page draws these where no
 * <name>.paintings.json comes beside the file (one opened from disk or dropped has none).
 */
export function readPaintings(value) {
  const r = value?.Schematic ?? value;
  const p = r?.Metadata?.Paintings ?? r?.Paintings;
  if (!p || num(p.Version) !== 1) return [];
  const str = (v) => (typeof v === "string" ? v : v?.v !== undefined ? String(v.v) : "");
  return list(p.List).map((e) => {
    const pos = list(e.Pos).map(num), img = e.Image?.v ?? e.Image;
    const bytes = img ? new Uint8Array(img.buffer, img.byteOffset, img.length) : null;
    return { label: str(e.Label), name: str(e.Name), x: pos[0], y: pos[1], z: pos[2], w: num(e.W), h: num(e.H), dir: str(e.Dir), bytes };
  }).filter((q) => q.bytes?.length && [q.x, q.y, q.z, q.w, q.h].every(Number.isFinite) && /^[NSEW]$/.test(q.dir));
}

/**
 * What a file says about itself, read from its own root before it is turned into a Sponge one: { name, author,
 * description, created, modified (ms since 1970, or null), dataVersion, formatVersion (Sponge's or Litematica's
 * Version), entities (mobs, item frames, paintings and the like: the file's Entities, not its block entities),
 * requiredMods (Sponge's Metadata RequiredMods) }. Each is null (requiredMods: empty) where the file has none.
 */
export function readFileInfo(value) {
  const format = formatOf(value), r = value?.Schematic ?? value ?? {};
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const time = (v) => { const n = v === undefined || v === null ? NaN : num(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const int = (v) => { const n = v === undefined || v === null ? NaN : num(v); return Number.isFinite(n) ? n : null; };
  const count = (v) => (v === undefined || v === null ? 0 : list(v).length);
  const md = (format === "litematic" ? value.Metadata : r.Metadata) ?? {};
  const out = { name: str(md.Name), author: str(md.Author), description: str(md.Description), created: null, modified: null, dataVersion: null, formatVersion: int(r.Version), entities: 0, requiredMods: [] };
  if (format === "litematic") {
    Object.assign(out, { created: time(md.TimeCreated), modified: time(md.TimeModified), dataVersion: int(value.MinecraftDataVersion) });
    out.entities = Object.values(value.Regions ?? {}).reduce((n, g) => n + count(g?.Entities), 0);
  } else if (format === "structure") {
    Object.assign(out, { author: str(value.author), dataVersion: int(value.DataVersion), entities: count(value.entities) });
  } else {
    Object.assign(out, { created: time(md.Date), dataVersion: int(r.DataVersion), entities: count(r.Entities) });
    out.requiredMods = list(md.RequiredMods).filter((m) => typeof m === "string" && m);
  }
  if (out.dataVersion !== null && out.dataVersion <= 0) out.dataVersion = null;
  return out;
}

/** A file's description: Sponge's or Litematica's Metadata Description, or null. */
export function readDescription(value) {
  const r = value?.Schematic ?? value;
  const d = r?.Metadata?.Description;
  return typeof d === "string" && d ? d : null;
}
