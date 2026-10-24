// The resource pack for one schematic, built in the browser: the Minecraft client jar's block assets, the assets of
// the mods whose namespaces the schematic uses (from the pack source, through Packrat: the plan, then fetchRows with
// every listed hash checked), the chest models and the schematic's framed drawers (generated.js) and the models of the
// blocks the game draws with block-entity renderers (entities.js), merged into one
// zip the renderer loads. The renderer keeps that zip in its own database under the pack's name; the name is a hash
// of everything that goes into it (packName), so an unchanged schematic and source never build twice.
//
// Which jar has which namespace is not in any pack file. A jar is scanned once (its assets/<ns>/blockstates/ count
// per namespace) and remembered by its hash; a namespace no remembered jar covers is looked for in the jars whose
// slug, file name or title matches it (storagedrawers -> StorageDrawers-fabric-26.2.0.1.jar), best match first, so
// only those are downloaded. A dropped pack's jars are local and cost nothing to scan.
import JSZip from "jszip";
import { buildPlan, fetchRows, getVersionsFromHashes } from "@craftlabs/packrat";
import { get, put, getFile, putFile, entryKey } from "./store.js";
import { clientJar, clientRecord, hasClient } from "./mojang.js";
import { fetchWithProgress } from "./download.js";
import { addChests, addFramed } from "./generated.js";
import { addEntityBlocks } from "./entities.js";
import { sha256Text } from "./sources.js";
import { buildBook, BOOK_FILE } from "../materials/book.js";

/** Bump when what the builder writes changes, so every cached pack is rebuilt. */
export const GENERATOR = 6;   // 2: the materials list's recipe book and the item textures; 4: chests mapped as the game maps them; 5: banners, heads, shulker boxes, pots, conduit, statues, portals; 6: the recipe book's crops, machines and sets
export const PACK_PREFIX = "blockscope:";
const MODRINTH_UA = "craftlabs-nexus/blockscope/0.1 (https://github.com/craftlabs-nexus/blockscope)";
// what of the client jar goes in: the block assets and the textures block models and the renderer read (entity
// textures for chests and signs' old layout, colormaps for tints, the font for sign text, item textures for the materials
// list's icons)
const VANILLA_KEEP = ["blockstates/", "models/block/", "textures/block/", "textures/item/", "textures/entity/", "textures/colormap/", "textures/font/", "textures/misc/", "textures/particle/", "textures/environment/"];
const MOD_ASSET = /^assets\/([a-z0-9_.-]+)\/(blockstates|models|textures)\/(.+)$/;

/** The namespaces a schematic needs a jar for: its blocks' and its framed drawers' materials'. */
export function wantedNamespaces(schematic) {
  const ns = new Set(schematic.namespaces());
  for (const c of schematic.framedCombos()) for (const t of [c.side, c.trim, c.front]) if (t && t.includes("-")) ns.add(t.split("-")[0]);
  ns.delete("minecraft"); ns.delete("blockscope");
  return [...ns].sort();
}

/** The pack's name for a schematic and a source: the renderer finds a pack it already holds by it. */
export async function packName(schematic, source) {
  const d = await source.describe();
  const key = { g: GENERATOR, src: d.id, mc: d.minecraft, ns: wantedNamespaces(schematic), framed: schematic.framedCombos().map((c) => c.id).sort(), decorated: schematic.decoratedCombos().map((c) => c.id).sort() };
  return `${PACK_PREFIX}${(await sha256Text(JSON.stringify(key))).slice(0, 24)}`;
}

// --- which jar provides which namespace ----------------------------------------------------------------------------
const norm = (s) => String(s ?? "").toLowerCase().replace(/\.(jar|pw\.toml)$/, "").replace(/[^a-z0-9]/g, "");
/** How well a row's names match a namespace: 0 not at all; exact slug or mod id > a name starting with it > containing it. */
function matchScore(row, ns) {
  const n = norm(ns); if (!n) return 0;
  const names = [row.scan?.modId, row.entry.key?.split("/").pop(), row.modrinthProject?.title, row.title, row.entry.filename].map(norm).filter(Boolean);
  let best = 0;
  for (const s of names) best = Math.max(best, s === n ? 3 : s.startsWith(n) ? 2 : s.includes(n) ? 1 : 0);
  return best;
}
async function scanNamespaces(blob) {
  const zip = await JSZip.loadAsync(blob);
  const counts = {};
  for (const name of Object.keys(zip.files)) { const m = name.match(/^assets\/([a-z0-9_.-]+)\/blockstates\/.+\.json$/); if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1; }
  return { counts, zip };
}

/**
 * Builds the pack. `ui` reports and asks: ui.progress(text, fraction?); ui.consent({ clientBytes, mods, modBytes,
 * minecraft, source }) resolves once the visitor agrees to download (rejects if they decline). It is asked before the
 * first jar is downloaded, after the lookups that size the download: Mojang's version record and, for the mods,
 * the pack's files and Modrinth's record of them. Returns { blob, report }.
 */
export async function buildPack({ schematic, source, ui, signal }) {
  const desc = await source.describe(signal);
  const wanted = wantedNamespaces(schematic);
  const report = { source: desc.name, sourceKind: source.kind, minecraft: desc.minecraft, wanted, mods: [], missing: [], notes: [], downloaded: 0 };
  let consented = null;
  const consent = (what) => (consented ??= ui.consent(what));

  const clientCached = await hasClient(desc.minecraft);
  const clientBytes = clientCached ? 0 : (await clientRecord(desc.minecraft, signal)).size;

  // the source's rows, and what each jar is known to provide
  const zips = new Map();   // row key -> JSZip of a jar fetched in this build
  let rows = [];
  // what the jars come from, in words: the file's own list ("The file's mods" is a label, not a pack name), or a pack
  const fromWords = source.fromFile ? "the file's mod list" : `the ${desc.name} pack`;
  if (wanted.length && !source.none) {
    ui.progress(`reading ${fromWords}…`);
    const analysis = await source.analyze(signal);
    const plan = await buildPlan(analysis, {
      skipClientOnly: false, contentStatus: null, modrinth: { userAgent: MODRINTH_UA },
      onProgress: (done, total) => total && ui.progress(`reading the pack's jars: ${done} of ${total}`, done / total),
    });
    report.notes.push(...plan.notes);
    rows = plan.rows.filter((r) => r.entry.origin && r.status.kind !== "unresolvable" && r.entry.side !== "server" && /\.jar$/i.test(r.entry.filename));
  }
  const provides = new Map();   // row key -> { ns: blockstate count }
  // what the source says each jar provides (a file's own mod list), then what this browser learned by scanning
  const told = source.provides?.() ?? new Map();
  for (const r of rows) if (told.has(r.entry.key)) provides.set(r.entry.key, told.get(r.entry.key));
  for (const r of rows) { const k = entryKey(r.entry); const rec = k && (await get("jars", k)); if (rec?.namespaces) provides.set(r.entry.key, rec.namespaces); }
  const covered = () => new Set(wanted.filter((ns) => [...provides.values()].some((c) => c[ns])));

  // fetch rows (from this browser's store when it has them), scan and remember what they provide
  const byUrl = new Map(); for (const r of rows) if (r.entry.origin?.type === "remote") for (const u of [r.entry.origin.url, ...(r.entry.origin.altUrls ?? [])]) byUrl.set(u, r);
  const progress = new Map();
  const fetchSome = async (want, label) => {
    if (!want.length) return;
    // asked once per build, before the first file this browser does not have
    for (const r of want) { const k = entryKey(r.entry); if (r.entry.origin?.type === "remote" && !(k && (await getFile(k)))) { await consent({ clientBytes: 0, mods: want.length, modBytes: 0, source: desc.name, minecraft: desc.minecraft }); break; } }
    const rowsIn = rows.map((r) => ({ ...r, selected: want.includes(r) }));
    const total = want.length;
    const run = fetchRows(rowsIn, {
      download: async (url, filename, { signal: sig, onProgress }) => {
        const r = byUrl.get(url), key = r && entryKey(r.entry);
        const have = key && (await getFile(key));
        if (have) return new File([have], filename);
        const buf = await fetchWithProgress(url, { signal: sig, onProgress: (got, size) => { progress.set(filename, [got, size]); onProgress(size ? (got / size) * 100 : 0); showFetch(label); } });
        report.downloaded += buf.byteLength;
        return new File([buf], filename);
      },
    }, { signal, requireHash: true });
    let done = 0;
    for await (const { row, buffer, sha512 } of run) {
      const blob = new Blob([buffer]);
      const key = entryKey(row.entry) ?? (sha512 && `sha512:${sha512}`);
      if (row.entry.origin?.type === "remote" && key && !(await getFile(key))) await putFile(key, blob, row.entry.filename);
      const { counts, zip } = await scanNamespaces(blob);
      provides.set(row.entry.key, counts); zips.set(row.entry.key, zip);
      if (key) await put("jars", key, { filename: row.entry.filename, namespaces: counts });
      ui.progress(`${label}: ${++done} of ${total}`, done / total);
    }
    for (const f of run.summary.failed) report.notes.push(`${f.filename}: ${f.error}`);
  };
  const showFetch = (label) => {
    let got = 0, size = 0; for (const [g, s] of progress.values()) { got += g; size += s; }
    ui.progress(`${label}: ${(got / 1e6).toFixed(1)}${size ? ` of ${(size / 1e6).toFixed(1)}` : ""} MB`, size ? got / size : undefined);
  };

  // find the namespaces nobody is known to provide: name matches first (a few rounds, the next best each time),
  // then, for a dropped pack, every local jar
  const tried = new Set([...provides.keys()]);
  const pickRound = () => {
    const pick = new Set();
    for (const ns of wanted.filter((n) => !covered().has(n))) {
      const best = rows.filter((r) => !tried.has(r.entry.key)).map((r) => [r, matchScore(r, ns)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1] || a[0].entry.filename.length - b[0].entry.filename.length)[0];
      if (best) pick.add(best[0]);
    }
    return [...pick];
  };
  // per namespace the jar with the most blockstates in it (an addon may ship a few of its parent's)
  const bestRows = () => {
    const out = new Map();
    for (const ns of wanted) {
      let best = null, n = 0;
      for (const r of rows) { const c = provides.get(r.entry.key)?.[ns] ?? 0; if (c > n) { n = c; best = r; } }
      if (best) out.set(ns, best);
    }
    return out;
  };

  // the visitor hears what the first download will be before it starts: the client jar and the jars this build
  // expects to fetch (the known providers and the first name matches), sized by Modrinth's record of the files
  const firstPick = pickRound();
  {
    const expected = [...new Set([...bestRows().values(), ...firstPick])];
    const toDownload = [];
    for (const r of expected) { const k = entryKey(r.entry); if (r.entry.origin?.type === "remote" && !(k && (await getFile(k)))) toDownload.push(r); }
    let modBytes = 0;
    const hashes = toDownload.map((r) => r.entry.sha512).filter(Boolean);
    if (hashes.length) {
      try {
        const res = (await getVersionsFromHashes(hashes, "sha512", { userAgent: MODRINTH_UA })) ?? {};
        for (const h of hashes) for (const f of res[h]?.files ?? []) if (f.hashes?.sha512 === h) modBytes += f.size ?? 0;
      } catch (e) { report.notes.push(`Modrinth's file sizes: ${e.message}`); }
    }
    if (clientBytes || toDownload.length) await consent({ clientBytes, mods: toDownload.length, modBytes, minecraft: desc.minecraft, source: desc.name });
  }
  for (let round = 0; round < 4; round++) {
    const pick = round === 0 ? firstPick : pickRound();
    if (!pick.length) break;
    for (const r of pick) tried.add(r.entry.key);
    await fetchSome(pick, "finding the mods");
  }
  {
    const missing = wanted.filter((ns) => !covered().has(ns));
    const locals = rows.filter((r) => r.entry.origin?.type === "local" && !tried.has(r.entry.key));
    if (missing.length && locals.length) { for (const r of locals) tried.add(r.entry.key); await fetchSome(locals, "looking through your jars"); }
  }

  const best = bestRows(), chosen = new Set(best.values());
  for (const ns of wanted) if (!best.has(ns)) report.missing.push(ns);
  await fetchSome([...chosen].filter((r) => !zips.has(r.entry.key)), "fetching the mods");

  // the client jar
  ui.progress(`Minecraft ${desc.minecraft} client…`);
  const client = await clientJar(desc.minecraft, { signal, onProgress: (got, size) => ui.progress(`Minecraft ${desc.minecraft} client from Mojang: ${(got / 1e6).toFixed(1)} of ${(size / 1e6).toFixed(1)} MB`, size ? got / size : undefined) });
  if (!clientCached) report.downloaded += client.size;

  // merge
  ui.progress("merging the pack…");
  const out = new JSZip(), have = new Set();
  const add = (name, data) => { if (!have.has(name)) { have.add(name); out.file(name, data); } };
  const clientZip = await JSZip.loadAsync(client);
  let vanilla = 0;
  for (const [name, entry] of Object.entries(clientZip.files)) {
    if (entry.dir || !name.startsWith("assets/minecraft/")) continue;
    if (!VANILLA_KEEP.some((k) => name.startsWith(`assets/minecraft/${k}`))) continue;
    add(name, entry.async("uint8array")); vanilla++;
  }
  for (const r of rows) {
    if (!chosen.has(r)) continue;
    const zip = zips.get(r.entry.key); if (!zip) { report.notes.push(`${r.entry.filename}: not fetched`); continue; }
    const nss = new Set(); let files = 0;
    for (const [name, entry] of Object.entries(zip.files)) {
      const m = !entry.dir && name.match(MOD_ASSET); if (!m) continue;
      if (m[2] === "textures" && m[3].startsWith("gui/")) continue;
      // a mod's minecraft-namespace files never replace vanilla's (add keeps the first)
      add(name, entry.async("uint8array")); files++;
      if (m[2] === "blockstates" && m[1] !== "minecraft") nss.add(m[1]);
    }
    report.mods.push({ title: r.title, filename: r.entry.filename, namespaces: [...nss].sort(), files });
  }
  const chests = await addChests(out, clientZip);
  const framed = await addFramed(out, schematic.framedCombos());
  const entityBlocks = await addEntityBlocks(out, clientZip, schematic.decoratedCombos());
  const pv = JSON.parse((await clientZip.file("version.json")?.async("string")) ?? "{}").pack_version;
  out.file("pack.mcmeta", JSON.stringify({ pack: { pack_format: pv?.resource_major ?? pv?.resource ?? 1, description: `Blockscope: Minecraft ${desc.minecraft} + ${report.mods.length} mods from ${fromWords}` } }, null, 2));
  Object.assign(report, { vanillaFiles: vanilla, chests, framed: framed.made, framedMissing: framed.missing, entityBlocks: entityBlocks.made, entityTexturesMissing: entityBlocks.missing });
  // the materials list's recipe book, from the same jars (materials/book.js)
  ui.progress("reading the recipes…");
  try {
    const book = await buildBook([clientZip, ...rows.filter((r) => chosen.has(r)).map((r) => zips.get(r.entry.key)).filter(Boolean)], { onProgress: (t) => ui.progress(t) });
    out.file(BOOK_FILE, JSON.stringify(book), { compression: "DEFLATE" });
    report.book = { items: Object.keys(book.items).length, recipes: Object.keys(book.recipes).length };
  } catch (e) { report.notes.push(`the recipes for the materials list: ${e.message}`); }
  out.file("blockscope-report.json", JSON.stringify(report, null, 2));
  const blob = await out.generateAsync({ type: "blob", compression: "STORE" }, (m) => ui.progress(`writing the pack: ${Math.round(m.percent)}%`, m.percent / 100));
  report.size = blob.size;
  return { blob, report };
}
