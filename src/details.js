// The Schematic group of the panel: what the loaded file is, at a glance. Its size, how full it is, how many kinds of
// block it uses and from which mods, the game version it was saved in, its format, and what the file says about itself
// (name, author, description, dates), with its world position, entities and size on disk.

// Java Edition releases and their data versions (minecraft.wiki, "Data version"), oldest first. A file saved by a
// snapshot or pre-release has a number between two releases: it is named for the release it led up to.
const RELEASES = [
  ["1.9", 169], ["1.9.1", 175], ["1.9.2", 176], ["1.9.3", 183], ["1.9.4", 184], ["1.10", 510], ["1.10.1", 511],
  ["1.10.2", 512], ["1.11", 819], ["1.11.1", 921], ["1.11.2", 922], ["1.12", 1139], ["1.12.1", 1241], ["1.12.2", 1343],
  ["1.13", 1519], ["1.13.1", 1628], ["1.13.2", 1631], ["1.14", 1952], ["1.14.1", 1957], ["1.14.2", 1963],
  ["1.14.3", 1968], ["1.14.4", 1976], ["1.15", 2225], ["1.15.1", 2227], ["1.15.2", 2230], ["1.16", 2566],
  ["1.16.1", 2567], ["1.16.2", 2578], ["1.16.3", 2580], ["1.16.4", 2584], ["1.16.5", 2586], ["1.17", 2724],
  ["1.17.1", 2730], ["1.18", 2860], ["1.18.1", 2865], ["1.18.2", 2975], ["1.19", 3105], ["1.19.1", 3117],
  ["1.19.2", 3120], ["1.19.3", 3218], ["1.19.4", 3337], ["1.20", 3463], ["1.20.1", 3465], ["1.20.2", 3578],
  ["1.20.3", 3698], ["1.20.4", 3700], ["1.20.5", 3837], ["1.20.6", 3839], ["1.21", 3953], ["1.21.1", 3955],
  ["1.21.2", 4080], ["1.21.3", 4082], ["1.21.4", 4189], ["1.21.5", 4325], ["1.21.6", 4435], ["1.21.7", 4438],
  ["1.21.8", 4440], ["1.21.9", 4554], ["1.21.10", 4556], ["1.21.11", 4671], ["26.1", 4786], ["26.1.1", 4788],
  ["26.1.2", 4790], ["26.2", 4903], ["26.3", 5023],
];

/** The game version a data version stands for: "1.21.1", "a 1.21.5 snapshot", "newer than 26.3", or null. */
export function gameVersion(dataVersion) {
  const dv = Number(dataVersion);
  if (!Number.isFinite(dv) || dv <= 0) return null;
  const exact = RELEASES.find(([, n]) => n === dv);
  if (exact) return exact[0];
  const next = RELEASES.find(([, n]) => n > dv);
  if (!next) return `newer than ${RELEASES.at(-1)[0]}`;
  return next === RELEASES[0] ? `older than ${next[0]}` : `a ${next[0]} snapshot`;
}

const FORMATS = { sponge: "Sponge", litematic: "Litematica", structure: "structure .nbt" };
const LOADERS = { fabric: "Fabric", neoforge: "NeoForge", forge: "Forge", quilt: "Quilt" };
const AIR = /^minecraft:(cave_|void_)?air$/;
const baseId = (key) => key.replace(/\[.*$/, "");
const n = (v) => Number(v).toLocaleString("en-US");
const plural = (k, one, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/** A byte count as people read it: 812 B, 14.2 KB, 3.1 MB. */
export function byteText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** A time (ms since 1970) as a local date and time, to the minute: 2026-10-23 14:05. */
export function dateText(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms), p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The file's format as a label: "Sponge v3", "Litematica v6", "structure .nbt", "MCEdit .schematic, converted". */
function formatText(schem) {
  const v = schem.fileInfo?.formatVersion;
  if (schem.format === "converted") {
    const ext = /\.([a-z0-9]+)$/i.exec(schem.name ?? "")?.[1]?.toLowerCase();
    return ext === "schematic" ? "MCEdit .schematic, converted" : `${ext ? `.${ext}` : "a format"} read by Nucleation`;
  }
  const name = FORMATS[schem.format] ?? schem.format;
  return v && schem.format !== "structure" ? `${name} v${v}` : name;
}

/**
 * What the Schematic group shows for a loaded file (a Schematic, schematic.js): { summary (its size, for the heading),
 * rows: [{ key, value, cls, title }] in the order shown, the rows with nothing to say left out, data: the same as plain
 * values, for blockscope.state() }.
 */
export function schematicDetails(schem) {
  const W = schem.width, H = schem.height, L = schem.length, volume = W * H * L;
  // each palette entry's cells, once over the file
  const used = new Uint32Array(schem.keys.length + 1);
  for (let i = 0; i < schem.data.length && i < volume; i++) used[schem.data[i]]++;
  let blocks = 0; const states = [], ids = new Set(), namespaces = new Map();
  schem.keys.forEach((key, p) => {
    if (!key || !used[p] || schem.air.has(p) || AIR.test(baseId(key))) return;
    blocks += used[p]; states.push(key);
    const id = baseId(key); ids.add(id);
    const ns = id.includes(":") ? id.split(":")[0] : "minecraft";
    if (ns !== "minecraft") namespaces.set(ns, (namespaces.get(ns) ?? 0) + used[p]);
  });
  const fi = schem.fileInfo ?? {};
  const mods = [...namespaces].sort((a, b) => b[1] - a[1]).map(([ns]) => ns);
  const game = gameVersion(fi.dataVersion);
  const named = schem.mods?.minecraft ?? null;   // the mod list's own Minecraft version, where the file has one
  const offset = schem.offset ?? [0, 0, 0];
  const data = {
    size: [W, H, L], volume, blocks, types: ids.size, states: states.length, mods,
    game: named ?? game, dataVersion: fi.dataVersion ?? null, format: formatText(schem),
    name: fi.name ?? null, author: fi.author ?? null, description: fi.description ?? schem.description ?? null,
    created: fi.created ?? null, modified: fi.modified ?? null, origin: [...offset],
    blockEntities: schem.entities?.length ?? 0, entities: fi.entities ?? 0, bytes: schem.byteSize ?? null,
    loader: schem.mods?.loader ?? null, requiredMods: fi.requiredMods ?? [],
  };

  const rows = [];
  const row = (key, value, cls = "", title = "") => { if (value !== null && value !== undefined && value !== "") rows.push({ key, value, cls, title }); };
  row("size", `${n(W)} × ${n(H)} × ${n(L)}`, "mono", `width (x) × height (y) × length (z), in blocks: ${n(volume)} cells`);
  row("blocks", volume ? `${n(blocks)} of ${n(volume)} (${Math.round((blocks / volume) * 100)}%)` : "0", "",
    "blocks that are not air, of the cells in the box (how full the box is)");
  row("types", `${plural(ids.size, "type")}, ${plural(states.length, "state")}`, "",
    "kinds of block (oak stairs, stone…), and the block states they come in (facing, half, waterlogged…)");
  // the three with the most blocks, the rest counted (all of them in the tooltip)
  const SHOWN = 3, more = mods.length - SHOWN;
  row("mods", mods.length ? `${mods.length}: ${mods.slice(0, SHOWN).join(", ")}${more > 0 ? ` +${more} more` : ""}` : "none, vanilla blocks only", "",
    mods.length ? `the namespaces of the blocks used, most blocks first:\n${mods.join(", ")}` : "every block is the game's own");
  if (data.requiredMods.length) row("needs", data.requiredMods.join(", "), "dim", "the mods the file says it needs (its RequiredMods)");
  const loaderName = LOADERS[String(data.loader).toLowerCase()] ?? data.loader;
  // the loader draws nothing (the mod list names its jars outright): only a tooltip, for setting the build up in game
  const loader = data.loader ? `${loaderName}${schem.mods?.loaderVersion ? ` ${schem.mods.loaderVersion}` : ""}` : "";
  const dvTitle = fi.dataVersion ? `saved with data version ${fi.dataVersion}${named && game && named !== game ? ` (${game}); the mod list names ${named}` : ""}` : "";
  row("game", data.game ? `Minecraft ${data.game}` : null, "", [dvTitle, loader ? `its mods are for ${loader}` : ""].filter(Boolean).join("; "));
  row("format", data.format + (data.bytes !== null ? `, ${byteText(data.bytes)}` : ""), "dim");
  if (data.name && data.name !== String(schem.name ?? "").replace(/\.[a-z0-9]+$/i, "")) row("name", data.name);
  row("author", data.author);
  row("about", data.description, "scroll");
  row("created", dateText(data.created), "mono dim");
  if (data.modified && data.modified !== data.created) row("modified", dateText(data.modified), "mono dim");
  if (offset.some((v) => v !== 0)) row("origin", offset.join(", "), "mono dim", "the world position of the box's corner (its lowest x, y and z)");
  const ents = [data.blockEntities ? plural(data.blockEntities, "block entity", "block entities") : null, data.entities ? plural(data.entities, "entity", "entities") : null].filter(Boolean);
  row("entities", ents.join(", ") || null, "dim", "block entities: chests, signs, banners and other blocks with data of their own; entities: mobs, item frames, paintings, armor stands");
  return { summary: `${W} × ${H} × ${L}`, rows, data };
}
