// Blockscope: a schematic viewer with nothing behind it but static files. The schematic is read and prepared in the
// page (schematic.js: layers, shell, parts, signs, framed drawers), the resource pack is built in the page from
// Mojang's and Modrinth's own downloads (pack/), and @craftlabs/schematic-renderer draws it.
import { SchematicRenderer } from "@craftlabs/schematic-renderer";
import * as THREE from "three";
import JSZip from "jszip";
import { analyzeFolder, analyzePackZip, detectPackZip, fromFileList } from "@craftlabs/packrat";
import { Schematic } from "./schematic.js";
import { cornersOf, fillWithoutOffset, fitInto } from "./view.js";
import { classify, typesOf, familiesOf, firstKinds, codeGroups, HiddenCells, KINDS, KIND_BIT, KIND_ORDER, REDSTONE_REASONS, kindsOfMask } from "./kinds.js";
import { partOf, partsOf } from "./parts.js";
import { framedRealId } from "./framed.js";
import { decoratedRealId, DYES } from "./decorated.js";
import { buildPaintings } from "./paintings.js";
import { collectPoints, frameView, applyView, viewState, restoreView as restoreCamera, sizeFor, encodeGif } from "./buildgif.js";
import { buildPack, packName, wantedNamespaces, PACK_PREFIX } from "./pack/build.js";
import { noModsSource, droppedSource, fileSource } from "./pack/sources.js";
import { REDSTONE_TWEAKS, extraPackBlob } from "./pack/extras.js";
import { tidyRendererPacks, switchPack, keepBaseLowest, packManager } from "./pack/packs.js";
import { clear as clearStore, usage, get as storeGet, put as storePut } from "./pack/store.js";
import { resolvePlan, loadPlan, DEFAULT_PLAN, SCHEMATIC_EXT } from "./plans.js";
import { createMaterials } from "./materials/panel.js";
import { esc } from "./html.js";
import { prepareBook } from "./materials/engine.js";
import { BOOK_FILE } from "./materials/book.js";
import { stepTarget, filledLayers } from "./layers.js";

const $ = (id) => document.getElementById(id);
// Anything that breaks the page shows in the status line, not only in the console.
addEventListener("error", (ev) => { const el = $("status"); if (el) { el.textContent = `error: ${ev.message} (${(ev.filename || "").split("/").pop()}:${ev.lineno})`; el.className = "err"; } });
addEventListener("unhandledrejection", (ev) => { const el = $("status"); if (el) { el.textContent = `error: ${ev.reason?.message ?? ev.reason}`; el.className = "err"; } });
const typing = (ev) => ["INPUT", "TEXTAREA", "SELECT"].includes(ev.target?.tagName);
const params = new URLSearchParams(location.search);
// The status line: dim once the file is rendered, green while something loads, red for an error.
const status = (text, kind = "") => { const el = $("status"); el.textContent = text; el.title = text; el.className = kind; if (kind === "err") failWaiters(text); };
// Agents and scripts (AGENTS.md): every drawn file, once its view has settled, counts in `settled`, so
// blockscope.ready() can wait for one; an error before the first one fails the wait instead of leaving it hanging.
const renders = { settled: 0, waiters: [], timer: 0, failed: null };
// ?agent=1 in development: the pack download goes ahead without the prompt (an agent cannot click it). Never in a build.
const AGENT = import.meta.env.DEV && /^(1|on|yes|true)$/i.test(params.get("agent") ?? "");
const SCHEM_ID = "blockscope";   // the renderer's name for the loaded file (one at a time)

// ---- the loaded file ------------------------------------------------------------------------------------------------
// file: { name, url (a plan file's; null for one opened from disk), param (what ?schem= says), schem (Schematic),
// paintings, paintingsBase }. info: its size, offset, roof, shell counts and parts, as the panel reads them. meta:
// the metadata in use (a BlockMeta), the file's own (BlockInfo), else a Litematica
// file's regions as parts; metaFrom says which, in words.
let file = null, meta = null, metaFrom = "";
let schemName = "";
const ROOF_HIDE_COVER = 0.6;
const info = { width: 0, height: 0, length: 0, offset: [0, 0, 0], shell: { roof: 0, wall: 0, floor: 0 }, roofCover: 0, parts: [] };
const shell = { roof: true, wall: true, floor: true };   // shown?
let shellCells = new Map();   // block index -> roof | wall | floor
const roofHiddenByDefault = () => info.roofCover >= ROOF_HIDE_COVER;
const roofOff = () => !shell.roof;
const hiddenParts = () => Object.keys(shell).filter((p) => !shell[p]);
// Parts: the file's logical pieces from its metadata, each shown or hidden. ?part=a,b opens with only those parts
// shown, ?hidePart=a,b with those hidden.
const hiddenPartSet = new Set();
// Kinds and types (kinds.js), the Blocks group's two lists: filters beside the parts. A cell is drawn when its part is
// shown, none of its kinds is hidden (with kinds picked by solo: when it is of one of them) and its type is shown. The
// shell kinds (roof, walls, floor) are the View group's toggles: `shell` holds them for both. ?kind=a,b shows only
// those kinds, ?hideKind=a,b hides them; ?type=id,… and ?hideType=id,… the same for types.
let blocks = { kinds: null, types: null, families: [], familyOf: new Map() };   // classify(), typesOf() and familiesOf() of the file
const hiddenKinds = new Set(), onlyKinds = new Set(), hiddenTypes = new Set();
const SHELL_KEYS = ["roof", "wall", "floor"];
const maskOf = (keys) => { let m = 0; for (const k of keys) m |= KIND_BIT[k] ?? 0; return m; };
const shellHiddenMask = () => maskOf(SHELL_KEYS.filter((k) => !shell[k]));
/** Whether a kind's blocks are drawn, as far as the kinds go. */
const kindShown = (k) => (onlyKinds.size ? onlyKinds.has(k) : !hiddenKinds.has(k)) && (!(k in shell) || shell[k]);
const kindName = (k) => KINDS.find((x) => x.key === k)?.name ?? k;
const kindCount = (k) => blocks.kinds?.counts[KINDS.findIndex((x) => x.key === k)] ?? 0;
const typeOf = (id) => blocks.types?.types.find((t) => t.id === id) ?? null;
// a type as a link spells it: the id, or the name without "minecraft:"
const typeId = (s) => (String(s).includes(":") ? String(s) : `minecraft:${s}`);
// whether a cell (world coordinates) is hidden, for the overlays the page draws itself (paintings hang on a block)
const cellHidden = (x, y, z) => {
  if (!file) return false;
  const [ox, oy, oz] = info.offset, fx = x - ox, fy = y - oy, fz = z - oz;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= info.width || fy >= info.height || fz >= info.length) return false;
  return hiddenCells().has(file.schem.index(fx, fy, fz));
};
/** What hides what, as a key for the caches below. */
const filterKey = () => [hiddenParts(), [...hiddenPartSet].sort(), [...hiddenKinds].sort(), [...onlyKinds].sort(), [...hiddenTypes].sort()].map((l) => l.join(",")).join("|");
let flagsCache = { file: null, key: null, flags: null, cells: null };
/** Which cell groups are hidden now (one byte a group of cellGroupsNow's table): a hidden part, kind or type. */
function groupFlagsNow() {
  const key = filterKey();
  if (flagsCache.file === file && flagsCache.key === key) return flagsCache.flags;
  const c = codedNow(), partHidden = new Uint8Array(info.parts.length + 1);
  info.parts.forEach((p, i) => { if (hiddenPartSet.has(p.name)) partHidden[i + 1] = 1; });
  const typeHidden = typeHiddenFlags(), hid = maskOf(hiddenKinds) | shellHiddenMask(), only = maskOf(onlyKinds);
  const flags = new Uint8Array(c.size);
  for (let g = 1; g < c.size; g++) {
    const k = c.kinds[g];
    if (partHidden[c.part[g]] || k & hid || (only && !(k & only)) || (c.typed && typeHidden[c.type[g]])) flags[g] = 1;
  }
  flagsCache = { file, key, flags, cells: null };
  return flags;
}
/** Each type's hidden flag, by type index + 1. */
function typeHiddenFlags() {
  const types = blocks.types?.types ?? [], out = new Uint8Array(types.length + 1);
  types.forEach((t, i) => { if (hiddenTypes.has(t.id)) out[i + 1] = 1; });
  return out;
}
/** Whether a type is hidden that the cell groups do not tell apart (a file of too many combinations): the file the
 *  renderer gets then leaves it out. */
const typesOutsideGroups = () => hiddenTypes.size > 0 && !codedNow().typed;
/** The block indices hidden: the hidden shell, parts, kinds and types, as a lookup by cell group (not a list, so a
 *  million hidden terrain blocks cost nothing to name). */
function hiddenCells() {
  groupFlagsNow();
  if (flagsCache.cells) return flagsCache.cells;
  const c = codedNow(), s = file.schem;
  let extra = null;
  if (typesOutsideGroups()) { const th = typeHiddenFlags(), of = blocks.types.ofPalette; extra = (i) => th[of[s.data[i]]] === 1; }
  return (flagsCache.cells = new HiddenCells(c.groups, flagsCache.flags, extra));
}
/** What hides a cell (file index), in words ("roof", "part Aisle 1", "kind terrain", "type stone"); null when drawn. */
function hiddenWhy(i) {
  if (!file || !hiddenCells().has(i)) return null;
  const c = codedNow(), g = c.groups[i], k = c.kinds[g];
  const sh = SHELL_KEYS.find((r) => k & KIND_BIT[r] && !shell[r]); if (sh) return sh;
  const pn = info.parts[c.part[g] - 1]?.name; if (pn && hiddenPartSet.has(pn)) return `part ${pn}`;
  const hk = [...hiddenKinds].find((x) => k & KIND_BIT[x]); if (hk) return `kind ${kindName(hk).toLowerCase()}`;
  if (onlyKinds.size && !(k & maskOf(onlyKinds))) return `only ${[...onlyKinds].map((x) => kindName(x).toLowerCase()).join(", ")} shown`;
  const t = blocks.types.types[blocks.types.ofPalette[file.schem.data[i]] - 1];
  return t && hiddenTypes.has(t.id) ? `type ${t.name}` : "hidden";
}
// the cells of each cell group, worked out once per file (a counting sort of cellGroupsNow)
let groupCellsCache = { file: null, lists: null };
function groupCellsNow() {
  if (groupCellsCache.file === file) return groupCellsCache.lists;
  const groups = cellGroupsNow(), counts = new Uint32Array(65537);
  for (const g of groups) counts[g + 1]++;
  for (let g = 1; g <= 65536; g++) counts[g] += counts[g - 1];   // counts[g]: where group g's cells start
  const all = new Int32Array(groups.length), fill = counts.slice(0, 65536);
  for (let i = 0; i < groups.length; i++) all[fill[groups[i]]++] = i;
  const lists = new Map();
  for (let g = 0; g < 65536; g++) if (counts[g + 1] > counts[g]) lists.set(g, all.subarray(counts[g], counts[g + 1]));
  groupCellsCache = { file, lists };
  return lists;
}
// what the page knows about a cell (file coordinates "x,y,z"): the sign there, the painting hanging on that wall block
const signAt = new Map(), paintingAt = new Map();

/** Makes `f` the loaded file: reads its info, shell and parts and resets the controls (the URL's on the first load). */
function setFile(f, { fromUrl = false } = {}) {
  file = f; schemName = f.name;
  pinned.cell = null;   // the last file's pin (a link's ?at= pins in the new one once it is drawn)
  // the last file's build may not have shown layers (an instanced or greedy build); this one gets its chance
  loaded.live = loaded.canFilter;
  const own = f.schem.metaSource === "file" ? f.schem.meta : null;
  meta = own ?? f.schem.meta ?? null;
  metaFrom = own ? "the file's own metadata" : f.schem.metaSource === "regions" ? "the Litematica file's regions" : "";
  $("partsGrp").querySelector("summary").title = `The file's parts, from ${metaFrom || "its metadata"}: hover to light one up, click the eye to hide it, solo to see it alone, click the name to fly to it`;
  $("schemName").textContent = schemName;
  $("schemName").title = (f.url ? f.url.href : `${schemName} (opened from disk; stays in this page)`) + (f.schem.description ? `\n${f.schem.description}` : "");
  document.title = `${schemName} · Blockscope`;
  // a link can bring back only a file that was opened from a link (?schem=), not one from disk; dimmed (not disabled,
  // so its tooltip still shows and a click says why)
  $("copyLink").setAttribute("aria-disabled", String(!f.param));
  $("copyLink").title = f.param ? "Copy a link to this view: file, camera, layers and hidden parts"
    : "A file opened from disk cannot be linked: a link could not bring it back";
  showDownloads(f);
  const s = f.schem, { counts, parts, roofCover } = s.shellOf(meta);
  shellCells = parts; rowCells.clear(); frontCache = { name: null, dir: null };
  Object.assign(info, s.info(), { shell: counts, roofCover, meta: meta !== null, parts: meta ? partsOf(meta, own ? s.partOrder : null) : [] });
  blocks = { kinds: classify(s, { shellCells, meta }), types: typesOf(s) };
  blocks.families = familiesOf(blocks.types.types);
  blocks.familyOf = new Map(blocks.families.flatMap((fam) => fam.members.map((id) => [id, fam])));
  openFamilies.clear(); blockSel = []; kindGroupCache = null;
  // the pack source for this file (its own mod list, unless the visitor gave their own pack)
  const before = source; pickSource(); if (source !== before) { packReport = null; renderPackInfo(); }
  signAt.clear(); for (const sg of s.signs) signAt.set(`${sg.x},${sg.y},${sg.z}`, sg);
  // the shell and the parts: from the link on the first load, else the defaults (the roof hidden when it covers most
  // of the footprint)
  Object.assign(shell, { roof: true, wall: true, floor: true });
  hiddenPartSet.clear(); hiddenKinds.clear(); onlyKinds.clear(); hiddenTypes.clear(); typesAll = false;
  layer.mode = "all"; layer.cur = Math.max(0, info.height - 2);
  if (fromUrl) {
    if (params.get("hide") !== null) { for (const p of params.get("hide").split(",")) if (p in shell) shell[p] = false; }
    else if (params.get("roof") === "off") shell.roof = false;
    else if (params.get("roof") !== "on") shell.roof = !roofHiddenByDefault();
    const names = info.parts.map((p) => p.name);
    if (params.get("part") !== null) { const keep = new Set(params.get("part").split(",")); for (const n of names) if (!keep.has(n)) hiddenPartSet.add(n); }
    if (params.get("hidePart") !== null) for (const n of params.get("hidePart").split(",")) if (names.includes(n)) hiddenPartSet.add(n);
    // kinds and types (the shell's kinds are the shell toggles: ?hideKind=roof is ?hide=roof)
    for (const k of (params.get("kind") ?? "").split(",")) if (k in KIND_BIT) { onlyKinds.add(k); if (k in shell) shell[k] = true; }
    for (const k of (params.get("hideKind") ?? "").split(",")) if (k in shell) shell[k] = false; else if (k in KIND_BIT) hiddenKinds.add(k);
    const ids = blocks.types.types.map((t) => t.id);
    if (params.get("type") !== null) { const keep = new Set(params.get("type").split(",").map(typeId)); for (const id of ids) if (!keep.has(id)) hiddenTypes.add(id); }
    for (const id of (params.get("hideType") ?? "").split(",").filter(Boolean).map(typeId)) if (ids.includes(id)) hiddenTypes.add(id);
    const ul = (params.get("layer") ?? "").match(/^(single|below|above),(-?\d+)$/);
    if (ul) { layer.mode = ul[1]; layer.cur = Number(ul[2]); }
    const c = (params.get("cam") ?? "").split(",").map(Number);
    if (c.length === 6 && c.every(Number.isFinite)) { savedView.on = true; savedView.pos.set(c[0], c[1], c[2]); savedView.target.set(c[3], c[4], c[5]); savedView.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(savedView.pos, savedView.target, new THREE.Vector3(0, 1, 0))); userMoved = true; }
    // ?view=top,<quarter>,<zoom>: the top view, entered once the file is drawn
    const vt = (params.get("view") ?? "").match(/^top(?:,([0-3]))?(?:,(\d*\.?\d+))?$/);
    topView.wanted = vt ? { q: Number(vt[1] ?? 0), zoom: vt[2] ? Number(vt[2]) : undefined } : null;
    // ?minY=M&maxY=N (N exclusive, negative from the top) opens with only those file layers
    const minY = params.get("minY"), maxY = params.get("maxY");
    if (!ul && (minY !== null || maxY !== null)) {
      let hi = maxY === null ? info.height : Number(maxY); if (hi < 0) hi = info.height + hi;
      layer.mode = minY !== null && Number(minY) > 0 ? "above" : "below"; layer.cur = layer.mode === "above" ? Number(minY) : Math.max(0, hi - 1);
    }
    // ?at=x,y,z (world coordinates): the block pinned once the file is drawn
    const at = (params.get("at") ?? "").split(",").map((s) => (s.trim() === "" ? NaN : Number(s)));
    pinned.wanted = at.length === 3 && at.every(Number.isInteger) ? at : null;
    // ?focus=x,y,z (world coordinates) or ?focus=<part>: the camera flies there once the file is drawn
    const fo = (params.get("focus") ?? "").trim(), fb = fo.match(/^(-?\d+),(-?\d+),(-?\d+)$/);
    focusWanted = fb ? { block: fb.slice(1).map(Number) } : fo ? { part: fo } : null;
    // ?digits=on / ?digits=off: signal digits set to that once the file is drawn (none: the visitor's own choice)
    digitsWanted = /^(on|off)$/.test(params.get("digits") ?? "") ? params.get("digits") === "on" : null;
  } else { shell.roof = !roofHiddenByDefault(); savedView.on = false; userMoved = false; pinned.wanted = null; focusWanted = null; }
  applyLayers(); showShellState(); renderParts(); renderBlocks(); showBlock(null);
  mats.fileChanged();
}
/** Reads a schematic file's bytes into the page's file record. */
async function readFile(rec) {
  status(`reading ${rec.name}…`, "busy");
  const schem = await Schematic.load(rec.bytes, rec.name);
  // the file's hash: what the materials list keeps the person's have values under
  let hash = null;
  try { hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", rec.bytes))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join(""); } catch {}
  return { ...rec, schem, hash };
}

// The renderer builds block (x, y, z) of the file as a cube centered at local (x, y, z) (its edges fall on half
// integers), and places the schematic group so the *loaded* blocks' tight bounds are centered on the world origin.
// Overlays therefore put a block's center at (x, y, z) in the group, and the group is pinned to the centering the full
// file gets, so a sliced reload (a layer view) does not move the model under the camera.
const cellCenter = (x, y, z) => [x, y, z];
const group = () => renderer?.sceneManager?.scene?.getObjectByName(SCHEM_ID);
function pinGroup() {
  const g = group(); if (!g || !info.width) return;
  g.position.x = -(info.width - 1) / 2; g.position.z = -(info.length - 1) / 2; g.updateMatrixWorld?.(true);
}
const layer = { mode: "all", cur: 0, lo: 0, hi: 0 }; // modes: all (the roof toggle applies), single, below, above
// the build animation (captureBuild) while it runs; `after` is its result line, shown once the view from before is back
const capture = { on: false, stop: false, rendered: null, after: null };
// The top view (enterTop): on, the quarter the top of the screen faces (0 north, 1 east, 2 south, 3 west), the heading
// as drawn (radians, unbounded, so a turn animates the short way), the turn in flight, the camera to go back to, the
// orbit settings it replaced, whether the block grid shows, and what a link asked for on the first load.
const topView = { on: false, q: 0, heading: 0, anim: null, prev: "perspective", saved: null, grid: true, wanted: null };
try { topView.grid = localStorage.getItem("top.grid") !== "0"; } catch {}
const simOn = params.get("sim") === "on";
// The renderer holds the whole file, every cell labeled with its part and shell role (a cell group: cellGroupsNow),
// and draws the layers and groups asked for (showCells: no reload, a few ms to a few tens), so a change of layers,
// parts or shell keeps the file; only another file loads. `live` is false where the renderer cannot (one without
// showCells, or a build without layer runs): the file it gets then carries only what is drawn, the rest as air.
// cut: the file the renderer has leaves out what is hidden; pending: a load on its way (the renderer still holds the
// last file until it is in); canFilter: false once the renderer is found to have no showCells (an older one), so a
// file is then loaded cut from the start
const loaded = { file: null, hidden: null, live: true, cut: false, pending: null, canFilter: true };
const schematicObject = () => renderer?.schematicManager?.getSchematic?.(SCHEM_ID) ?? renderer?.schematicManager?.getFirstSchematic?.();
/** The layers drawn as the renderer takes them (minY..maxY-1), null for all. */
const rangeNow = () => (layer.mode === "all" ? null : { minY: layer.lo, maxY: layer.hi + 1 });
// each cell's group: the place of its (part, kinds, type) in the table of the combinations the file has (kinds.js
// codeGroups), worked out once per file
let groupsCache = { file: null, coded: null };
function codedNow() {
  if (groupsCache.file !== file) {
    const s = file.schem, part = s.partIndex(meta, info.parts.map((p) => p.name));
    groupsCache = { file, coded: codeGroups(s, part, blocks.kinds.mask, blocks.types.ofPalette) };
  }
  return groupsCache.coded;
}
const cellGroupsNow = () => codedNow().groups;
/** The cell groups hidden now. */
function hiddenGroupsNow() { const f = groupFlagsNow(), out = []; for (let g = 1; g < f.length; g++) if (f[g]) out.push(g); return out; }
/** Whether the renderer can show what is asked for from the file it holds. */
const canShowNow = (so) => loaded.live && !loaded.cut && !!so?.showCells && loaded.file === file && !typesOutsideGroups();
/** The file as the renderer gets it now: all of it, or (not live) the hidden cells as air and the layer range. */
function renderBytes() {
  const cutNow = !loaded.live || typesOutsideGroups(), hidden = hiddenCells();
  loaded.pending = { file, hidden, cut: cutNow };
  const cut = cutNow ? { hidden, ...(rangeNow() ?? {}) } : {};
  return file.schem.render(cut).then((u8) => u8.buffer);
}
/** What the renderer takes with a file: the cell groups and what to show, when it can. */
const loadProps = () => (loaded.live && !typesOutsideGroups() ? { layerRange: rangeNow(), cellGroups: cellGroupsNow(), hiddenGroups: hiddenGroupsNow() } : {});
// the layers that hold a block once the hidden shell and parts are air (the layer steps skip the rest)
let filledCache = { file: null, hidden: null, ys: [] };
function filledNow() {
  const hidden = hiddenCells();
  if (filledCache.file !== file || filledCache.hidden !== hidden) filledCache = { file, hidden, ys: filledLayers(file.schem.layerCounts(hidden)) };
  return filledCache.ys;
}
const worldY = (y) => info.offset[1] + y;
const topLayer = () => (roofOff() ? info.height - 2 : info.height - 1);
// the layer range on screen (file layers), whatever the mode
const shownRange = () => (layer.mode === "all" ? [0, Math.max(0, topLayer())] : [layer.lo, layer.hi]);
function applyLayers() {
  const top = info.height - 1;
  layer.cur = Math.max(0, Math.min(top, layer.cur));
  if (layer.mode === "single") { layer.lo = layer.hi = layer.cur; }
  else if (layer.mode === "below") { layer.lo = 0; layer.hi = layer.cur; }
  else if (layer.mode === "above") { layer.lo = layer.cur; layer.hi = top; }
  const all = layer.mode === "all";
  const [lo, hi] = shownRange();
  const sl = $("layerSlider"); sl.max = String(Math.max(0, top)); sl.value = String(all ? Math.max(0, topLayer()) : layer.cur); sl.disabled = info.height <= 1;
  sl.title = all ? "Drag to look at one layer and everything below it" : `Layer ${layer.cur} of the file: world y ${worldY(layer.cur)}; drag, or step with the arrows`;
  const y = $("layerY"); y.textContent = all ? "all" : `y ${worldY(layer.cur)}`; y.classList.toggle("dim", all);
  $("layerRange").textContent = info.height ? `y ${worldY(lo)}..${worldY(hi)} · ${hi - lo + 1} of ${info.height}` : "—";
  const off = hiddenParts(), words = [off.length ? `no ${off.join(", ")}` : "", ...blockWords()].filter(Boolean).join(" · ");
  $("layerHidden").textContent = words;
  $("layerSum").textContent = info.height ? (all ? (words ? `all, ${words}` : "all") : `${layer.mode} y ${worldY(layer.cur)}`) : "";
  for (const m of ["All", "Single", "Below", "Above"]) $(`layer${m}`).setAttribute("aria-pressed", String(layer.mode === m.toLowerCase()));
  if (!capture.on) mats.scopeChanged();
}

// ---- materials (materials/): the list counts what the view shows: the layers drawn (every layer in "all", the
// roof then being hidden cells like the walls and floor), less the hidden shell and parts
const mats = createMaterials({
  $,
  file: () => file,
  meta: () => meta,
  parts: () => info.parts,
  worldY,
  scope() {
    const all = layer.mode === "all", lo = all ? 0 : layer.lo, hi = all ? Math.max(0, info.height - 1) : layer.hi;
    const chips = [all ? "all layers" : lo === hi ? `y ${worldY(lo)}` : `y ${worldY(lo)}..${worldY(hi)}`, ...hiddenParts().map((p) => `no ${p}`), ...blockWords()];
    if (hiddenPartSet.size) chips.push(`${info.parts.length - hiddenPartSet.size} of ${info.parts.length} parts`);
    return { lo, hi, hidden: file ? hiddenCells() : new Set(), chips };
  },
  highlight: (cells) => showMatCells(cells),
  soloPart: (name) => soloPart(name),
  singleLayer(y) { layer.mode = "single"; layer.cur = y; reloadLayers(`layer ${y}`); },
  status: (t, k) => status(t, k),
  download: (blob, name) => download(blob, name),
  iconsChanged: () => renderBlocks(),
  kindGroups,
  soloKind: (key) => soloKind(key),
});
// the materials list's groups by kind: each block in the first of its kinds (kinds.js KIND_ORDER), once per file
let kindGroupCache = null;
function kindGroups() {
  if (!file || !blocks.kinds?.shown) return null;
  if (kindGroupCache?.file !== file) kindGroupCache = { file, idx: firstKinds(blocks.kinds.mask) };
  const { idx } = kindGroupCache;
  return { of: (i) => idx[i], label: (g) => (KIND_ORDER[g] ? kindName(KIND_ORDER[g]) : "No kind"), kindKey: (g) => KIND_ORDER[g] ?? null };
}
/** What the Blocks group hides, in words: "only redstone", "no terrain, trees", "3 types hidden". */
function blockWords() {
  const out = [], lower = (k) => kindName(k).toLowerCase();
  if (onlyKinds.size) out.push(`only ${[...onlyKinds].map(lower).join(", ")}`);
  else if (hiddenKinds.size) out.push(`no ${[...hiddenKinds].map(lower).join(", ")}`);
  const st = soloedType(), sf = st ? null : soloedFamily();
  if (st) out.push(`only ${typeOf(st)?.name ?? st}`);
  else if (sf) out.push(`only the ${blocks.families.find((f) => f.key === sf).name}`);
  else if (hiddenTypes.size) out.push(`${hiddenTypes.size} type${hiddenTypes.size === 1 ? "" : "s"} hidden`);
  return out;
}
// the recipe book rides in the pack (pack/build.js writes it): read once per pack, with the pack's textures for icons
let packZipCache = { name: null, zip: null }, bookPack = null;
async function packZip(name) {
  if (packZipCache.name === name) return packZipCache.zip;
  const p = packManager(renderer)?.getEnabledPacksWithBlobs?.().find((x) => x.name === name); if (!p) return null;
  const zip = JSZip.loadAsync(p.blob);
  packZipCache = { name, zip };
  return zip;
}
async function loadBook() {
  if (!renderer || bookPack === currentPack) return;
  const name = currentPack; bookPack = name;
  // every step checks the pack is still the one shown: a slow read of the last pack's book never lands on this one
  const set = (...a) => { if (name === currentPack) mats.setBook(...a); };
  try {
    const zip = await packZip(name); if (!zip) { if (bookPack === name) bookPack = null; return; }
    const f = zip.file(BOOK_FILE);
    if (!f) { set(null, null, "missing"); return; }
    set(null, null, "loading");
    const book = prepareBook(JSON.parse(await f.async("string")));
    set(book, (path) => zip.file(path)?.async("blob") ?? Promise.resolve(null));
  } catch (e) { console.warn("[blockscope] the recipe book", e); set(null, null, "missing"); }
}
// the blocks a materials row stands for, lit up in the view (amber, so they read apart from a part's blue)
const matMat = new THREE.MeshBasicMaterial({ color: 0xf0c36d, transparent: true, opacity: 0.42, depthWrite: false });
let matGhost = null;
function showMatCells(cells) {
  if (matGhost) { markGroup.remove(matGhost); matGhost.geometry.dispose(); matGhost = null; }
  if (cells?.length && group()) { attachMarks(); matGhost = cellsMesh(cells, matMat); markGroup.add(matGhost); }
  redraw();
}

// The renderer only warns (console) about blocks it has no blockstate for; collect those so they show in the HUD.
const unknown = new Map();
const origWarn = console.warn.bind(console);
console.warn = (...a) => {
  const m = String(a[0] ?? "").match(/^(?:Block state definition for (.+?) not found\.|No blockstate definition found for (.+)|Cubane: No parts rendered for (\S+) .*)$/);
  if (m) { const id = m[1] ?? m[2] ?? `${m[3]} (model resolves to nothing)`; unknown.set(id, (unknown.get(id) ?? 0) + 1); renderUnknown(); return; }
  origWarn(...a);
};
// The count is out of the way when it is 0 (a dim badge in the File group) and a warning chip beside the status
// line when it is not; the chip opens the list.
function renderUnknown() {
  $("unknown").textContent = unknown.size ? [...unknown.keys()].sort().join("\n") : "(none)";
  const n = $("unknownCount"); n.textContent = String(unknown.size); n.classList.toggle("warn", unknown.size > 0);
  const chip = $("unknownChip"); chip.textContent = `${unknown.size} undrawn`; chip.classList.toggle("on", unknown.size > 0);
  $("fileSum").textContent = unknown.size ? `${unknown.size} undrawn` : "";
}
$("unknownChip").onclick = () => { $("fileGrp").open = true; $("unknownDetails").open = true; $("unknownDetails").scrollIntoView({ block: "nearest" }); };

// Immersive Paintings (entities, not in the file): planes from the plan's paintings JSON (paintings.js).
function buildOverlayPaintings() {
  const [lo, hi] = shownRange();
  const placed = buildPaintings({ group: group(), paintings: file?.paintings ?? [], base: file?.paintingsBase, offset: info.offset, lo, hi, redraw, isHidden: cellHidden });
  paintingAt.clear();
  const [ox, oy, oz] = info.offset;
  for (const { painting, cells } of placed) for (const [x, y, z] of cells) paintingAt.set(`${x - ox},${y - oy},${z - oz}`, painting);
  redraw();
}
// The renderer only draws when something it knows about changes; our own meshes need to ask for a frame.
const redraw = () => { try { renderer?.renderManager?.requestRender?.(); } catch {} };

// The page's own marks in the view, in the schematic group (file coordinates): a thin outline on the block under the
// cursor, a brighter one on the pinned block, and a translucent ghost of a part while its row is hovered. The group
// is re-attached after every load.
const markGroup = new THREE.Group(); markGroup.name = "blockscope_marks";
// a mark: a translucent box with its edges drawn, since a bare 1px line is lost against the textures
const outlineOf = (color, size, fill) => {
  const o = new THREE.Group(); o.visible = false; o.renderOrder = 10;
  o.add(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fill, depthWrite: false })));
  o.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })));
  return o;
};
let hoverBox = null, pinBox = null;
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x6fb3ff, transparent: true, opacity: 0.38, depthWrite: false });
let ghost = null;   // the hovered part's InstancedMesh
// The renderer strips and disposes the old group's children when it loads a file, our outlines among them, so they
// are rebuilt whenever they are missing.
function attachMarks() {
  const g = group(); if (g && markGroup.parent !== g) g.add(markGroup);
  if (!hoverBox || hoverBox.parent !== markGroup) { const keep = { h: hoverBox?.visible, hp: hoverBox?.position.clone(), p: pinBox?.visible, pp: pinBox?.position.clone() };
    hoverBox = outlineOf(0xffffff, 1.03, 0.16); pinBox = outlineOf(0x6fb3ff, 1.07, 0.3); markGroup.add(hoverBox, pinBox);
    if (keep.h) { hoverBox.visible = true; hoverBox.position.copy(keep.hp); } if (keep.p) { pinBox.visible = true; pinBox.position.copy(keep.pp); } }
}
// the pinned block's file cell, so the mark survives a reload; `wanted` is a link's ?at= (world), pinned once drawn
const pinned = { cell: null, wanted: null };
let focusWanted = null;   // a link's ?focus= ({ block: [x, y, z] } world, or { part }), applied once the view settles
let digitsWanted = null;   // a link's ?digits= (true or false), applied once the file is drawn
function placeBox(which, cell) { attachMarks(); const box = which === "pin" ? pinBox : hoverBox; if (!box) return; if (!cell) { box.visible = false; } else { box.position.set(...cellCenter(cell.x, cell.y, cell.z)); box.visible = true; } redraw(); }
// A row's cells (a part, a kind or a type: { axis: "part" | "kind" | "type", key }) as file indices, from the cell
// groups' lists (groupCellsNow: worked out once per file), once per row and file.
const rowCells = new Map();
function cellsOfRow(row) {
  const id = `${row.axis}:${row.key}`;
  if (rowCells.has(id)) return rowCells.get(id);
  const c = codedNow(), lists = groupCellsNow();
  let out = null, test = () => false;
  if (row.axis === "family") {
    const fam = blocks.families.find((x) => x.key === row.key), lists = (fam?.members ?? []).map((id) => cellsOfRow({ axis: "type", key: id }));
    out = new Int32Array(lists.reduce((n, l) => n + l.length, 0)); let o = 0; for (const l of lists) { out.set(l, o); o += l.length; }
  } else if (row.axis === "part") { const at = info.parts.findIndex((p) => p.name === row.key) + 1; if (at > 0) test = (g) => c.part[g] === at; }
  else if (row.axis === "kind") { const bit = KIND_BIT[row.key] ?? 0; test = (g) => (c.kinds[g] & bit) !== 0; }
  else {
    const t = (blocks.types?.types.findIndex((x) => x.id === row.key) ?? -1) + 1;
    if (t && c.typed) test = (g) => c.type[g] === t;
    else if (t) { const of = blocks.types.ofPalette, d = file.schem.data, idx = []; for (let i = 0; i < d.length; i++) if (of[d[i]] === t) idx.push(i); out = Int32Array.from(idx); }
  }
  if (!out) {
    const parts = []; let n = 0;
    for (let g = 1; g < c.size; g++) if (test(g)) { const l = lists.get(g); if (l) { parts.push(l); n += l.length; } }
    out = new Int32Array(n); let o = 0; for (const l of parts) { out.set(l, o); o += l.length; }
  }
  rowCells.set(id, out); return out;
}
/** A row's cells in the layers drawn, less the hidden shell (a row's own shell kind still shows, and a hidden part,
 *  kind or type too: lighting it up is what the hover is for). */
function shownCellsOfRow(row) {
  const [lo, hi] = shownRange(), per = file.schem.perLayer, c = codedNow();
  const sh = shellHiddenMask() & ~(row.axis === "kind" ? KIND_BIT[row.key] ?? 0 : 0), out = [];
  for (const i of cellsOfRow(row)) { const y = Math.floor(i / per); if (y >= lo && y <= hi && !(c.kinds[c.groups[i]] & sh)) out.push(i); }
  return out;
}
// past this many blocks a row lights up every few of them (the terrain: a million boxes would stall the page)
const GHOST_MAX = 60000;
function showGhost(row) {
  hideGhost();
  if (!row || !file) return;
  let cells = shownCellsOfRow(row);
  if (!cells.length) return;
  if (cells.length > GHOST_MAX) { const step = Math.ceil(cells.length / GHOST_MAX); cells = cells.filter((_, j) => j % step === 0); }
  ghost = cellsMesh(cells.map((i) => file.schem.cellOf(i)), ghostMat);
  markGroup.add(ghost); redraw();
}
/** A translucent box on each of `cells` (file coordinates), one instanced mesh: a part's ghost, a material's blocks. */
function cellsMesh(cells, material) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.04, 1.04, 1.04), material, cells.length), m = new THREE.Matrix4();
  cells.forEach(([x, y, z], i) => { m.makeTranslation(...cellCenter(x, y, z)); mesh.setMatrixAt(i, m); });
  mesh.instanceMatrix.needsUpdate = true; mesh.renderOrder = 9;
  return mesh;
}
function hideGhost() { if (ghost) { markGroup.remove(ghost); ghost.geometry.dispose(); ghost = null; redraw(); } }

// ---- the resource pack ----------------------------------------------------------------------------------------------
// The pack is built for the loaded file from a source, named after everything that goes into it; the renderer keeps
// it and skips the build when it already holds that name. The source: the visitor's own pack when they gave one
// (chosenSource); else the mods the file lists itself; else none (Minecraft's own blocks: a file that lists no mods
// needs the visitor's pack for its modded blocks).
const NO_MODS = noModsSource();
let chosenSource = null, source = NO_MODS, currentPack = null, packReport = null;
const fileSources = new WeakMap();   // Schematic -> its mod list's source, or null
function fileModsSource(schem) {
  if (!schem?.mods) return null;
  if (!fileSources.has(schem)) fileSources.set(schem, fileSource(schem.mods));
  return fileSources.get(schem);
}
const autoSource = () => fileModsSource(file?.schem) ?? NO_MODS;
const pickSource = () => { source = chosenSource ?? autoSource(); };
const PACK_CONSENT = "blockscope.consent";
let consentWaiter = null;
function askConsent(what) {
  if (AGENT) { console.info("[blockscope] ?agent=1: the download goes ahead without asking (development only)", what); return Promise.resolve(); }
  try { if (localStorage.getItem(PACK_CONSENT) === "1") return Promise.resolve(); } catch {}
  const mb = (n) => (n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
  const parts = [];
  if (what.clientBytes) parts.push(`Minecraft ${what.minecraft}'s client jar from Mojang (${mb(what.clientBytes)})`);
  const from = source.fromFile ? "as the file lists them" : `from the ${what.source} pack`;
  if (what.mods) parts.push(`the jar${what.mods === 1 ? "" : "s"} of the ${what.mods === 1 ? "mod" : `${what.mods} mods`} it uses, ${from}, from Modrinth${what.modBytes ? ` (${mb(what.modBytes)})` : ""}`);
  const total = (what.clientBytes ?? 0) + (what.modBytes ?? 0);
  $("consentText").textContent = `To draw this schematic your browser downloads ${parts.join(" and ")}${total && parts.length > 1 ? `: ${mb(total)} in all` : ""}. Later visits use the copies kept in this browser.`;
  $("consent").hidden = false; $("consentYes").focus();
  return new Promise((resolve, reject) => { consentWaiter = { resolve, reject }; });
}
const closeConsent = () => { $("consent").hidden = true; consentWaiter = null; };
$("consentYes").onclick = () => { try { localStorage.setItem(PACK_CONSENT, "1"); } catch {} const w = consentWaiter; closeConsent(); w?.resolve(); };
$("consentNo").onclick = () => { const w = consentWaiter; closeConsent(); w?.reject(new Error("the download was declined: drop your own pack, or reload to be asked again")); };
const packUi = {
  progress(text, f) { $("packRow").hidden = false; $("packText").textContent = text; $("packText").title = text; const bar = $("packBar"); if (f === undefined || !Number.isFinite(f)) bar.removeAttribute("value"); else bar.value = Math.max(0, Math.min(1, f)); status(`pack: ${text}`, "busy"); },
  consent: askConsent,
};
let packAbort = null;
/** Builds the pack for the loaded file (the renderer's default-pack callback and switchPack call it). */
async function buildPackForFile(name) {
  packAbort?.abort(); packAbort = new AbortController();
  const t0 = performance.now();
  try {
    const { blob, report } = await buildPack({ schematic: file.schem, source, ui: packUi, signal: packAbort.signal });
    report.seconds = Math.round((performance.now() - t0) / 100) / 10; report.name = name;
    packReport = report; renderPackInfo();
    console.log("[blockscope] pack built", report);
    return blob;
  } catch (e) {
    status(`pack: ${e.message}`, "err"); packReport = { error: e.message, name }; renderPackInfo();
    throw e;
  } finally { $("packRow").hidden = true; }
}
/** The report inside the pack the renderer holds (when it was built on an earlier visit). */
async function readPackReport() {
  if (packReport?.name === currentPack) return;
  try {
    const zip = await packZip(currentPack); if (!zip) return;
    const r = JSON.parse((await zip.file("blockscope-report.json")?.async("string")) ?? "null");
    if (r) { packReport = { ...r, name: currentPack, cached: true }; renderPackInfo(); }
  } catch {}
}
function renderPackInfo() {
  const r = packReport, el = $("packInfo");
  const missing = r && !r.error ? r.missing?.length ?? 0 : 0;
  $("packSum").textContent = source.label + (missing ? ` · ${missing} missing` : "");
  // the button back from the visitor's own pack: to the file's mod list when it has one, else to no mods
  const auto = autoSource();
  $("packDefault").textContent = auto.label;
  $("packDefault").title = auto.fromFile ? "Back to the mods this file lists (exactly the jars it was made with)" : "Back to Minecraft's own blocks only (this file lists no mods)";
  $("packDefault").disabled = !chosenSource;
  if (!r) { el.textContent = "not built yet"; return; }
  if (r.error) { el.innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  const mods = r.mods.map((m) => `<li><code>${esc(m.filename)}</code> → ${esc(m.namespaces.join(", ") || "(no blocks)")}</li>`).join("");
  el.innerHTML = `<p>Minecraft ${esc(r.minecraft)} from Mojang + ${r.mods.length} mod${r.mods.length === 1 ? "" : "s"} (${esc(r.source)})${r.size ? `, ${(r.size / 1e6).toFixed(1)} MB` : ""}${r.cached ? " (built on an earlier visit)" : r.seconds ? `, built in ${r.seconds} s, ${(r.downloaded / 1e6).toFixed(1)} MB downloaded` : ""}</p><ul>${mods}</ul>` +
    (r.missing?.length ? (source.none
      ? `<p class="warn">This file lists no mods, so its blocks of ${r.missing.map((n) => `<code>${esc(n)}</code>`).join(", ")} have no textures: give your own pack (a mods folder, a .mrpack or a CurseForge zip).</p>`
      : `<p class="warn">No jar of the pack provides: ${r.missing.map((n) => `<code>${esc(n)}</code>`).join(", ")}</p>`) : "") +
    (r.framed ? `<p>${r.framed} framed drawer material set${r.framed === 1 ? "" : "s"} composited${r.framedMissing?.length ? `; not found: ${r.framedMissing.map(esc).join(", ")}` : ""}</p>` : "") +
    (r.notes?.length ? `<p class="dim">${r.notes.map(esc).join("<br>")}</p>` : "");
}
async function showUsage() { const u = await usage(); $("packUsage").textContent = u.files ? `${u.files} files, ${(u.bytes / 1e6).toFixed(0)} MB kept` : "nothing kept"; }
$("packDetails").addEventListener("toggle", () => { if ($("packDetails").open) { showUsage(); readPackReport(); } });
/** Makes the loaded file's pack current: the renderer's when it holds it, else built. */
async function ensurePack() {
  const name = await packName(file.schem, source);
  if (name === currentPack) return;
  await switchPack(renderer, name, () => buildPackForFile(name));
  currentPack = name; await keepBaseLowest(renderer);
  readPackReport();
}
/** Switches to the visitor's pack (a Packrat analysis) or back to the file's mods or the default ones (null). */
async function useSource(next) {
  chosenSource = next ?? null; pickSource(); packReport = null; currentPack = null; renderPackInfo();
  if (!renderer || !file) return;
  try { await ensurePack(); status(`pack: ${source.label}`); } catch (e) { status(`pack: ${e.message}`, "err"); }
}
async function usePackFiles(localFiles, label) {
  status(`reading ${label}…`, "busy");
  try { const analysis = await analyzeFolder(localFiles); await useSource(droppedSource(analysis, analysis.manifest.name ?? label)); }
  catch (e) { status(`${label}: ${e.message}`, "err"); }
}
async function usePackZip(f) {
  status(`reading ${f.name}…`, "busy");
  try { const analysis = await analyzePackZip(f); await useSource(droppedSource(analysis, analysis.manifest.name ?? f.name)); }
  catch (e) { status(`${f.name}: ${e.message}`, "err"); }
}
for (const id of ["packFolder", "packFolder2"]) $(id).onchange = (ev) => {
  const files = ev.target.files; if (!files?.length) return;
  if (consentWaiter) { const w = consentWaiter; closeConsent(); w.reject(new Error("using your mods folder instead")); }
  usePackFiles(fromFileList(files), files[0].webkitRelativePath.split("/")[0] || "your folder"); ev.target.value = "";
};
$("packFile").onchange = (ev) => { const f = ev.target.files?.[0]; if (f) usePackZip(f); ev.target.value = ""; };
$("packDefault").onclick = () => useSource(null);
$("packForget").onclick = async () => {
  await clearStore("files"); await clearStore("jars"); await clearStore("meta");
  try { localStorage.removeItem(PACK_CONSENT); } catch {}
  const rpm = packManager(renderer);
  if (rpm) for (const p of rpm.getAllPacks().filter((x) => x.name.startsWith(PACK_PREFIX) && x.name !== currentPack)) await rpm.removePack(p.id);
  showUsage(); status("downloads forgotten; the pack in use stays until you reload");
};

// ---- the renderer -------------------------------------------------------------------------------------------------
const canvas = $("canvas");
let renderer = null;
async function startRenderer() {
  currentPack = await packName(file.schem, source);
  await tidyRendererPacks(currentPack);
  status("loading the pack and the schematic…", "busy");
  renderer = new SchematicRenderer(
    canvas,
    { [SCHEM_ID]: () => renderBytes() },
    { [currentPack]: () => buildPackForFile(currentPack) },
    {
      backgroundColor: BG,
      showGrid: true,
      showAxes: false,
      enableDragAndDrop: false,   // the page reads dropped files itself (schematics in memory, packs through Packrat)
      enableGizmos: false,
      // shulker boxes and the lectern's book from the pack's models (pack/entities.js: the boxes' color and facing, the
      // book on the lectern's top), not the renderer's own meshes
      blockEntityModels: { ...Object.fromEntries(["", ...DYES].map((c) => [`minecraft:${c ? `${c}_` : ""}shulker_box`, null])), "minecraft:lectern": null },
      enableInteraction: params.get("pick") !== "off",
      interactionOptions: { enableBlockSelection: params.get("pick") !== "off" },
      simulationOptions: { enableSimulation: simOn },
      enableProgressBar: true,
      progressBarOptions: { theme: "dark" },
      singleSchematicMode: true,
      debugOptions: { enableInspector: false, showOnStartup: false, showUnknownBlocks: true },
      sidebarOptions: { enabled: true, hiddenByDefault: true },
      cameraOptions: { position: [30, 25, 40], useTightBounds: true },
      callbacks: {
        onResourcePackLoaded: () => status("pack loaded, meshing…", "busy"),
        onSchematicLoaded: () => {
          status(`${schemName} parsed, building meshes…`, "busy");
          // the renderer holds the file the load was for now
          if (loaded.pending) { Object.assign(loaded, { file: loaded.pending.file, hidden: loaded.pending.hidden, cut: loaded.pending.cut }); loaded.pending = null; }
          // a whole file: the renderer gets its cell groups, and draws what is asked for now from its first build
          const so = schematicObject();
          if (!so?.showCells || !so?.setCellGroups) loaded.live = loaded.canFilter = false;
          else { so.setCellGroups(cellGroupsNow()); so.showCells(rangeNow(), hiddenGroupsNow()); }
        },
        onSchematicRendered: () => {
          // a build that cannot show some cells (or a renderer without it), or a whole file from before that was
          // found out, while something is hidden: the file is loaded again with only what is drawn
          const so = schematicObject();
          const cutWanted = !!rangeNow() || hiddenGroupsNow().length > 0 || typesOutsideGroups();
          if (loaded.live && !(so?.canShowLayerRange?.() ?? false)) loaded.live = false;
          if (!loaded.live && !loaded.cut && cutWanted) { reloadLayers("what is drawn"); return; }
          status(capture.after ?? `rendered ${schemName}${source.none && wantedNamespaces(file.schem).length ? ": it lists no mods, so its modded blocks need your own pack (File, Resource pack)" : ""}`); capture.after = null; pinGroup(); renderUnknown(); buildOverlayPaintings(); tuneControls(); keepBackground();
          settleSoon();
          attachMarks(); placeBox("pin", pinned.cell);
          if (pinned.wanted) { const w = pinned.wanted; pinned.wanted = null; if (!pinWorld(...w)) status(`?at=${w.join(",")} is outside ${schemName}`, "err"); }
          if (capture.on) { capture.rendered?.(); return; }   // the build animation holds the camera itself
          if (savedView.on) restoreSoon();
          else if (!userMoved) smartFit();
          if (layer.mode === "above" && layer.wantBottomUp) { layer.wantBottomUp = false; lookFromBelow(); }
          if (topView.wanted) { const w = topView.wanted; topView.wanted = null; enterTop({ q: w.q, zoom: w.zoom, target: savedView.on ? savedView.target : null }); }
          else if (topView.on) placeTop();   // the group's height follows the layers drawn: back above it
          updateGrid();
          syncUrl();
          readPackReport();
          loadBook();
          showRedstoneTweaks();
          if (digitsWanted !== null) { const on = digitsWanted; digitsWanted = null; if (on !== !!redstoneTweaksPack()?.enabled) setDigits(on); }
        },
      },
    },
  );
  canvas.schematicRenderer = renderer; // handy in the console
  renderer.eventEmitter?.once?.("schematicRendered", () => keepBaseLowest(renderer).catch(() => {}));
  renderer.eventEmitter.on("simulationSynced", () => { const so = renderer.schematicManager.getFirstSchematic(); so?.rebuildMesh?.(); const sm = renderer.simulationManager; if (sm) simInfo(`tick ${sm.getState().tickCount}`); });
}
/** Opens a file record (a plan file or one from disk): the first starts the renderer, a later one replaces the file
 *  and switches the pack when its mods differ. */
async function openFile(rec, opts = {}) {
  let f;
  try { f = await readFile(rec); } catch (e) { status(`${rec.name}: ${e.message}`, "err"); return; }
  setFile(f, opts);
  if (!renderer) { await startRenderer(); return; }
  try { await ensurePack(); } catch (e) { status(`pack: ${e.message}`, "err"); }
  await reloadLayers(`${schemName}`);
  syncUrl(true);
}

// OrbitControls' damping keeps turning the camera after a drag ends; a view key or button stops that spin first, so
// it does not carry on from the new view (the deltas are three's private fields; every orbit control is cleared)
function stopMomentum() {
  const cm = renderer?.cameraManager; if (!cm?.controls) return;
  for (const c of cm.controls instanceof Map ? cm.controls.values() : Object.values(cm.controls)) {
    c?._sphericalDelta?.set?.(0, 0, 0); c?._panOffset?.set?.(0, 0, 0); if (c && "_scale" in c) c._scale = 1;
  }
}
// Fit looks at the fronts: the side most chests, drawers, barrels, furnaces and wall signs face (their `facing`, as the
// game writes it: the front looks that way). Opposite fronts cancel (an aisle's two rows of chests say nothing about
// which way to stand), drawers count double (a drawer's face is its whole point), signs half. The camera keeps the
// library's fit distance and height and swings round to that side, turned 25° off square so the build still reads
// as 3D; no clear side (a room whose two walls face each other) keeps the library's own view. Worked out once per
// file and set of hidden parts (soloing the drawer wall faces its fronts).
const FACE_DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
let frontCache = { name: null, dir: null };
function frontDirection() {
  const [lo, hi] = shownRange();
  const cacheKey = `${schemName}|${[...hiddenPartSet].sort().join(",")}|${hiddenParts().join(",")}|${lo}-${hi}`;
  if (frontCache.name === cacheKey) return frontCache.dir;
  let dir = null;
  try {
    // the fronts among the blocks drawn (the layers drawn, the hidden shell and parts left out), from the page's copy
    const net = file.schem.fronts(lo, hi, hiddenCells());
    const best = Object.keys(net).map((d) => [d, net[d] - net[OPPOSITE[d]]]).sort((a, b) => b[1] - a[1])[0];
    // clear: the side has at least twice the fronts of the side opposite it, and most of the fronts that do not
    // cancel (the hall: drawers north against a few south, its aisles' east and west chests cancelling)
    const unpaired = Math.abs(net.north - net.south) + Math.abs(net.east - net.west);
    if (best[1] >= 2 && net[best[0]] >= 2 * net[OPPOSITE[best[0]]] && best[1] >= 0.6 * unpaired) dir = best[0];
  } catch (e) { console.warn("[blockscope] could not read the fronts for Fit", e); }
  frontCache = { name: cacheKey, dir };
  return dir;
}
function faceFronts() {
  const dir = frontDirection(), cam = camera(), ctl = controls(); if (!dir || !cam || !ctl?.target) return;
  const off = cam.position.clone().sub(ctl.target), flat = Math.hypot(off.x, off.z); if (!flat) return;
  const [dx, dz] = FACE_DIR[dir], a = (25 * Math.PI) / 180;
  const ux = dx * Math.cos(a) - dz * Math.sin(a), uz = dx * Math.sin(a) + dz * Math.cos(a);
  cam.position.set(ctl.target.x + ux * flat, cam.position.y, ctl.target.z + uz * flat); cam.lookAt(ctl.target); ctl.update?.(); redraw();
}
// The pivot on the middle of what is drawn (the library fits the file's box, which a converted .litematic may hold
// off-center), the camera moved along.
function centerOnDrawn() {
  const cam = camera(), ctl = controls(); if (!cam || !ctl?.target) return;
  const box = drawnBox();
  if (box.isEmpty()) return;
  const d = box.getCenter(new THREE.Vector3()).sub(ctl.target);
  ctl.target.add(d); cam.position.add(d); ctl.update?.(); redraw();
}
// the library's fit, then the fronts; again after the library's own deferred refit, unless the user has moved since
// The fill to keep beside the panel is the library's own, measured once right after its fit: the later passes start
// from a view already backed off, and measuring it again there would back off further every pass. A new fit drops
// the passes an earlier one still has to come.
let fitTimers = [];
function smartFit() {
  for (const t of fitTimers) clearTimeout(t);
  if (topView.on) { topFit(); fitTimers = [setTimeout(() => { if (!userMoved && topView.on) topFit(); }, 150)]; return; }
  try { renderer?.cameraManager.focusOnSchematics(); } catch {}
  let want = null;
  const frame = () => { applyViewOffset(); centerOnDrawn(); faceFronts(); want = fitBeside(want); };
  frame();
  fitTimers = [150, 600].map((t) => setTimeout(() => { if (!userMoved) frame(); }, t));
}
// The panel floats over the left of the canvas. The view's middle is the middle of the area beside it: a view offset
// moves the picture's center there without moving the camera, so the pivot, a fit and a turn all sit in what you can
// see. None while the panel is folded, takes most of the width (a phone), or a picture is being taken.
let bareView = 0;
// The canvas's size and the panel's right edge, measured again only when either is resized or the panel folds (the
// frame loop checks the offset every frame, so a switched camera or a resize gets it; reading layout every frame could
// force one)
let layoutNow = null;
const layoutChanged = () => { layoutNow = null; };
new ResizeObserver(layoutChanged).observe(canvas);
new ResizeObserver(layoutChanged).observe($("hud"));
new MutationObserver(layoutChanged).observe($("hud"), { attributes: true, attributeFilter: ["class"] });
function measureLayout() {
  if (layoutNow) return layoutNow;
  const panel = $("hud"), c = canvas.getBoundingClientRect(), h = panel.getBoundingClientRect(), left = h.right + 10 - c.left;
  const beside = !panel.classList.contains("collapsed") && h.width && left > 0 && left < c.width * 0.5 ? left : 0;
  return (layoutNow = { W: c.width, H: c.height, left: beside });
}
function freeLeft() { return bareView || capture.on ? 0 : measureLayout().left; }
function applyViewOffset() {
  const cam = camera(); if (!cam?.setViewOffset) return;
  const { W, H } = measureLayout(), shift = freeLeft() / 2, v = cam.view;
  if (!shift || !W || !H) { if (v?.enabled) { cam.clearViewOffset(); redraw(); } return; }
  if (v?.enabled && v.fullWidth === W && v.fullHeight === H && v.offsetX === -shift) return;
  cam.setViewOffset(W, H, -shift, 0, W, H); redraw();
}
/** Where the view's middle is on the canvas, in normalized device coordinates (x; y is 0). */
const viewCenterX = () => { const v = camera()?.view; return v?.enabled ? (-2 * v.offsetX) / v.fullWidth : 0; };
/** After the library's fit (which frames the model in the whole canvas): as far out again as it takes for the model
 *  to fill the area beside the panel no more than the library filled the whole canvas (`want`, measured here when
 *  not given). Returns the fill it kept to. */
function fitBeside(want = null) {
  const cam = camera(), ctl = controls(); if (!cam || !ctl?.target) return want;
  const box = drawnBox(); if (box.isEmpty()) return want;
  const corners = cornersOf(box);
  if (want === null) want = fillWithoutOffset(cam, corners);
  if (cam.view?.enabled) { fitInto(cam, ctl.target, corners, viewCenterX(), want); ctl.update?.(); redraw(); }
  return want;
}
const fitView = () => { stopMomentum(); userMoved = false; savedView.on = false; cancelRestores(); smartFit(); syncUrl(); };
$("focus").onclick = fitView;
let userMoved = false;
const controls = () => { const cm = renderer?.cameraManager; if (!cm) return null; return cm.controls instanceof Map ? cm.controls.get(cm.activeControlKey) : cm.controls?.[cm.activeControlKey]; };
const camera = () => renderer?.cameraManager?.activeCamera?._camera;
// the camera and its pivot as the link spells them: six world coordinates, two decimals
const camText = () => { const cam = camera(), ctl = controls(); if (!cam || !ctl?.target) return ""; const f = (n) => Math.round(n * 100) / 100; return [cam.position.x, cam.position.y, cam.position.z, ctl.target.x, ctl.target.y, ctl.target.z].map(f).join(","); };
// Orbiting: three's OrbitControls turn around a target point; after zooming or flying close to a detail the target is
// still the schematic's middle, so a drag swings wildly. Three fixes: the wheel zooms toward the cursor, a double
// click puts the pivot on that block, and before every drag the pivot moves to the first block under the screen
// center (kept at the same distance if nothing is there), so a drag always turns around what is in front of you.
const inMarks = (o) => { for (let p = o; p; p = p.parent) if (p === markGroup) return true; return false; };
const schematicMeshes = () => { const g = group(); const out = []; g?.traverseVisible((o) => { if (o.isMesh && !inMarks(o)) out.push(o); }); return out; };
// the box of what is drawn (world): the meshes' boxes, cut to the layers drawn when the renderer holds them all
function drawnBox() {
  // the renderer holds the whole file: its box of the cells shown (the meshes' boxes hold the hidden ones too)
  const so = schematicObject();
  if (canShowNow(so) && so.getTightWorldBox) return so.getTightWorldBox();
  const box = new THREE.Box3(); for (const m of schematicMeshes()) box.expandByObject(m);
  return box;
}
function hitUnderPointer(ndcX, ndcY) {
  const cam = camera(); if (!cam) return null;
  const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
  const hits = rc.intersectObjects(schematicMeshes(), false);
  const hit = hits[0] ?? null;
  if (hit) hit.rayDir = rc.ray.direction.clone();
  return hit;
}
// The file cell a hit lies in: a sign's from its mesh's name (the renderer names a sign's mesh
// sign_<id>_<x>_<y>_<z>, file coordinates, since a sign's board need not lie in its cell), the cell an overlay mesh
// says (userData), else a hair along the ray past the surface (so a face hit never lands in the air cell), then
// rounded, since the renderer centers block (x, y, z) at local (x, y, z).
const SIGN_MESH = /^sign_.+_(-?\d+)_(-?\d+)_(-?\d+)$/;
function cellOfHit(hit) {
  const g = group(); if (!g || !hit) return null;
  for (let o = hit.object; o && o !== g; o = o.parent) {
    const m = o.name?.match(SIGN_MESH);
    if (m) return new THREE.Vector3(Number(m[1]), Number(m[2]), Number(m[3]));
    if (o.userData?.cell) { const c = o.userData.cell; return new THREE.Vector3(c.x, c.y, c.z); }
    // a painting's plane lies a hair in front of the wall: step into the block behind it, where the hit was
    if (o.userData?.behind) { const [bx, by, bz] = o.userData.behind; return g.worldToLocal(hit.point.clone()).add(new THREE.Vector3(bx, by, bz).multiplyScalar(0.6)).round(); }
  }
  return g.worldToLocal(hit.point.clone().addScaledVector(hit.rayDir, 0.01)).round();
}
const ndcOf = (ev) => { const r = canvas.getBoundingClientRect(); return [((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1]; };
function repivot() {
  const ctl = controls(), cam = camera(); if (!ctl?.target || !cam) return;
  const hit = hitUnderPointer(viewCenterX(), 0);
  if (hit) { ctl.target.copy(hit.point); ctl.update?.(); }
}
// While a button is held on the canvas no deferred view restore may snatch the camera away from the drag. The fly
// keys keep working during a drag (fly while you orbit or look), so Shift, which sinks the camera, must not also turn
// a left drag into a pan as OrbitControls would: its pointerdown sees Shift as up. Ctrl+drag and middle drag pan.
let pointerHeld = 0;
canvas.addEventListener("pointerdown", (ev) => {
  pointerHeld++; cancelRestores(); try { renderer?.cameraManager.stopAnimation(); } catch {} if (ev.button === 0 && !topView.on) repivot(); userMoved = true;
  // any button hides the hover tooltip (the right-drag look below swallows its moves, so the hover handler never would)
  hideTip(); hoverPending = null;
  if (ev.shiftKey) Object.defineProperty(ev, "shiftKey", { value: false }); // the same event object reaches OrbitControls
}, true);
for (const t of ["pointerup", "pointercancel"]) canvas.addEventListener(t, () => { pointerHeld = Math.max(0, pointerHeld - 1); }, true);
// Right drag: turn the view like a first-person look (yaw about the world's up, pitch about the camera's right),
// about the camera's own position. The orbit target is then put back in front of the camera at the same distance,
// so a left drag afterwards orbits around what you are looking at. OrbitControls' own right-button pan is off; the
// middle button and Ctrl+drag pan instead.
const look = { on: false, x: 0, y: 0 };
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 2 || topView.on) return;   // the top view never tilts: there a right drag pans
  look.on = true; look.x = ev.clientX; look.y = ev.clientY; userMoved = true;
  try { canvas.setPointerCapture(ev.pointerId); } catch {}
  ev.stopImmediatePropagation(); ev.preventDefault();
}, true);
canvas.addEventListener("pointermove", (ev) => {
  if (!look.on) return;
  const cam = camera(), ctl = controls(); if (!cam || !ctl?.target) return;
  const dx = ev.clientX - look.x, dy = ev.clientY - look.y; look.x = ev.clientX; look.y = ev.clientY;
  const dist = cam.position.distanceTo(ctl.target);
  const e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");
  e.y -= dx * 0.004; e.x = Math.max(-1.55, Math.min(1.55, e.x - dy * 0.004)); e.z = 0;
  cam.quaternion.setFromEuler(e);
  const d = new THREE.Vector3(); cam.getWorldDirection(d);
  ctl.target.copy(cam.position).addScaledVector(d, dist); ctl.update?.(); redraw();
  ev.stopImmediatePropagation();
}, true);
for (const t of ["pointerup", "pointercancel"]) canvas.addEventListener(t, (ev) => { if (ev.button === 2 || look.on) { look.on = false; ev.stopImmediatePropagation(); } }, true);
function tuneControls() {
  const ctl = controls(); if (!ctl) return;
  ctl.zoomToCursor = true;
  ctl.enablePan = true;
  if (topView.on) {   // the top view: every button pans, one finger pans, nothing turns
    ctl.enableRotate = false;
    if (ctl.mouseButtons) Object.assign(ctl.mouseButtons, { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN });
    if (ctl.touches) ctl.touches.ONE = THREE.TOUCH.PAN;
    return;
  }
  if (ctl.mouseButtons) { ctl.mouseButtons.RIGHT = -1; ctl.mouseButtons.MIDDLE = THREE.MOUSE.PAN; } // right looks around, middle pans
}
canvas.addEventListener("wheel", () => { userMoved = true; cancelRestores(); }, { passive: true });
canvas.addEventListener("dblclick", (ev) => {
  const hit = hitUnderPointer(...ndcOf(ev));
  const ctl = controls(); if (!hit || !ctl?.target) return;
  userMoved = true;
  if (topView.on) { ctl.target.x = hit.point.x; ctl.target.z = hit.point.z; placeTop(); return; }   // centers that block
  ctl.target.copy(hit.point); ctl.update?.();
});
// Look north: keep the distance and height to the pivot, stand south of it.
function lookNorth() {
  stopMomentum();
  if (topView.on) { turnTopTo(Math.round(topView.heading / (2 * Math.PI)) * 2 * Math.PI); return; }   // north up
  const ctl = controls(), cam = camera(); if (!ctl?.target || !cam) return;
  const off = cam.position.clone().sub(ctl.target); const flat = Math.hypot(off.x, off.z) || 1;
  cam.position.set(ctl.target.x, cam.position.y, ctl.target.z + flat); ctl.update?.(); userMoved = true; redraw();
}
$("compass").onclick = lookNorth;
// "Forward" along the ground: the view direction flattened. Looking steeply down (or up) that shrinks to nothing and
// its sign flips at the pole, so the screen's up direction, flattened, is added in: both point the same way on the
// ground, and straight down forward is the top of the screen. Built with the camera's own Vector3 class.
function groundForward(cam) {
  const V = cam.position.constructor, d = new V(), u = new V(0, 1, 0).applyQuaternion(cam.quaternion);
  cam.getWorldDirection(d);
  const s = d.y < 0 ? 1 : -1; // looking up, the screen's top leans back over your head
  const f = new V(d.x + s * u.x, 0, d.z + s * u.z);
  if (f.lengthSq() < 1e-9) f.set(0, 0, -1);
  return f.normalize();
}
// Compass: the rose turns with the camera's heading (north is -z in the file, as in the game). The same frame loop
// notices a moved camera and writes it to the link after a pause.
let camStamp = "";
requestAnimationFrame(function compass() {
  requestAnimationFrame(compass);
  const cam = camera(); if (!cam) return;
  applyViewOffset();   // the panel folded or resized, the window resized, a camera switched
  stepTopTurn(); fadeGrid();
  const d = groundForward(cam);
  const heading = Math.atan2(d.x, -d.z); // 0 = looking north
  if (!Number.isFinite(heading)) return; // the camera has no direction yet while the renderer sets up
  $("compassRose").setAttribute("transform", `rotate(${(-heading * 180) / Math.PI})`);
  // the top view's zoom and quarter go in the link too (an orthographic zoom leaves the camera where it is)
  const stamp = camText() + (topView.on ? `|${cam.zoom}|${topView.q}` : ""); if (stamp && stamp !== camStamp) { camStamp = stamp; if (userMoved) syncUrl(); }
});
// Hover: the block under the cursor gets an outline and a tooltip beside the pointer (none for touch); throttled to
// animation frames. A press or drag with any button hides the tooltip until the pointer moves again with none held.
let hoverPending = null, hoverPos = [0, 0];
canvas.addEventListener("pointermove", (ev) => {
  if (ev.buttons || ev.pointerType === "touch") { if (ev.buttons) hideTip(); return; }
  hoverPos = [ev.clientX, ev.clientY];
  hoverPending = ndcOf(ev);
});
canvas.addEventListener("pointerleave", () => { hideTip(); placeBox("hover", null); });
const tip = $("tip");
function hideTip() { tip.classList.remove("on"); }
function showTip(d) {
  if (!d) { hideTip(); return; }
  tip.querySelector(".id").textContent = d.id.replace(/^minecraft:/, "");
  tip.querySelector(".st").textContent = d.state.length ? d.state.map(([k, v]) => `${k}=${v}`).join("  ") : "";
  tip.querySelector(".pt").textContent = [d.part ? [d.part.item && itemText(d.part.item), d.part.owner, d.part.role].filter(Boolean).join(" · ") : d.extra ? d.extra.kind : "", kindsText(d)].filter(Boolean).join(" · ");
  // the item the block is placed from (the file's own block, so a framed drawer reads as the mod's), and how many
  tip.querySelector(".mt").textContent = d.cell && !d.hidden && file ? mats.describeKey(file.schem.idAt(file.schem.index(d.cell.x, d.cell.y, d.cell.z))) : "";
  tip.querySelector(".pos").textContent = d.pos.replace(/\s+\(file.*$/, "");
  tip.classList.add("on");
  const [x, y] = hoverPos, w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${x + 16 + w > innerWidth ? x - 12 - w : x + 16}px`;
  tip.style.top = `${y + 18 + h > innerHeight ? y - 8 - h : y + 18}px`;
}
requestAnimationFrame(function hoverLoop() {
  requestAnimationFrame(hoverLoop);
  if (!hoverPending) return;
  const [x, y] = hoverPending; hoverPending = null;
  let hit = null;
  try { hit = hitUnderPointer(x, y); } catch { return; }
  if (!hit) { showTip(null); placeBox("hover", null); return; }
  const so = renderer.schematicManager.getFirstSchematic(); const p = cellOfHit(hit);
  if (!so || !p) return;
  placeBox("hover", p);
  showTip(describeBlock(so, p.x, p.y, p.z));
});
// A block as its id, its state as [key, value] pairs, its world position (file position in brackets) and its part
// ({ owner, role, item, code, line } from the meta file, or null).
function describeBlock(so, x, y, z) {
  try {
    const b = so.getSchematicWrapper().get_block_with_properties(x, y, z);
    // a framed drawer or trim is rendered per material set (framed.js): show the mod's block and the materials
    const framed = b ? framedRealId(b.name()) : null;
    // a banner with patterns or a pot with sherds is rendered per design (decorated.js): show the game's block
    const decorated = b && !framed ? decoratedRealId(b.name()) : null;
    let id = framed ? framed.id : decorated ? decorated.id : b ? b.name() : "minecraft:air";
    const matName = (m) => (m ? m.replace(/^[a-z_]+:/, "").replaceAll("_", " ") : "raw (unframed)");
    const frame = framed ? `side ${matName(framed.side)} / trim ${matName(framed.trim)}${framed.kind === "trim" ? "" : ` / front ${matName(framed.front)}`}` : null;
    const state = b ? Object.entries(b.properties()) : [];
    const [ox, oy, oz] = info.offset;
    const part = meta?.at(x + ox, y + oy, z + oz) ?? null;   // the generator keys by world position (file position + offset)
    // a hidden block: the renderer holds it but does not draw it (or, where it cannot, it is air in the file it has);
    // say what hides it. Its kinds, and why it is Redstone when it is so only by a neighbour.
    const ci = file.schem.index(x, y, z), hidden = hiddenWhy(ci);
    if (hidden) id = `${id === "minecraft:air" ? "air" : id} (hidden ${hidden})`;
    const why = REDSTONE_REASONS[blocks.kinds?.reason[ci] ?? 0];
    const kinds = kindsOfMask(blocks.kinds?.mask[ci] ?? 0).map((k) => ({ kind: k, why: k === "redstone" && why !== "a component" ? why : null }));
    // what the file and the page know about it: a sign's text (dye, glow, waxed, back side), a painting on this block;
    // `quote` is the short form a copy carries (the sign's front text, the painting's label)
    const k = `${x},${y},${z}`, s = signAt.get(k), p = paintingAt.get(k);
    const sideText = (t) => `"${t.lines.filter(Boolean).join(" / ") || " "}" in ${t.color.replace("_", " ")}${t.glow ? ", glowing" : ""}`;
    const extra = s && b ? { kind: "sign", quote: s.lines.filter(Boolean).join(" / "), text: `front ${sideText(s)}${s.back ? `; back ${sideText(s.back)}` : "; back empty"}${s.waxed ? "; waxed (no edits)" : ""}` }
      : p ? { kind: "painting", quote: p.label, text: `Immersive Painting "${p.label}", ${p.w}×${p.h} blocks, ${p.img.replace(/^paintings\//, "")}, facing ${({ N: "north", S: "south", E: "east", W: "west" })[p.dir] ?? p.dir}; hangs on this block (placed by hand, not in the file)` } : null;
    return { id, state, pos: `x ${x + ox}  y ${y + oy}  z ${z + oz}  (file ${x},${y},${z})`, part, extra, frame: frame ?? part?.frame ?? null, hidden, kinds, cell: { x, y, z }, world: [x + ox, y + oy, z + oz] };
  } catch (e) { return { id: `could not read the block: ${e.message}`, state: [], pos: "", part: null, extra: null, frame: null, hidden: null, cell: null, world: null }; }
}
// A block as plain text to paste anywhere: the file and where it is (world, then file coordinates), the block in
// Minecraft's id[state] form (valid /setblock syntax), its part and code, its frame, sign or painting, and a link that
// opens the page with it pinned (only for a file opened from a link).
function blockText(d) {
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const [wx, wy, wz] = d.world, { x, y, z } = d.cell;
  const state = d.state.length ? `[${d.state.map(([k, v]) => `${k}=${v}`).join(",")}]` : "";
  const lines = [`${schemName}  x ${wx} y ${wy} z ${wz}  (file ${x},${y},${z})`, d.hidden ? `${d.id.replace(/ \(hidden .*\)$/, "").replace(/^air$/, "minecraft:air")}${state} (hidden: ${d.hidden})` : `${d.id}${state}`];
  const pn = d.part ? partOf(d.part) : null;
  const code = d.part?.code ? `code ${d.part.code}${d.part.line ? `, line ${d.part.line}` : ""}` : null;
  const partLine = [pn && `part ${pn}`, code].filter(Boolean).join(" · ");
  if (partLine) lines.push(partLine);
  if (d.frame) lines.push(`framed ${d.frame}`);
  if (d.extra?.quote) lines.push(`${d.extra.kind} "${clip(d.extra.quote, 40)}"`);
  if (file?.param) { syncUrl(true); lines.push(location.href); }
  return lines.join("\n");
}
/** Copies the pinned block (read again, so a simulated change shows). */
async function copyBlock() {
  const so = renderer?.schematicManager.getFirstSchematic(), c = pinned.cell;
  if (!so || !c) { status("click a block first, then copy it"); return; }
  const d = describeBlock(so, c.x, c.y, c.z); if (!d.cell) { status(d.id, "err"); return; }
  try { await navigator.clipboard.writeText(blockText(d)); status(`copied ${d.id.replace(/^minecraft:/, "")} at ${d.world.join(" ")}`); }
  catch { status("could not copy the block", "err"); }
}
/** Pins a block by world coordinates as a click would (?at=, window.inspectAt); false when it is outside the file. */
function pinWorld(wx, wy, wz) {
  const so = renderer?.schematicManager.getFirstSchematic(); if (!so) return false;
  const [ox, oy, oz] = info.offset, x = wx - ox, y = wy - oy, z = wz - oz;
  if (x < 0 || y < 0 || z < 0 || x >= info.width || y >= info.height || z >= info.length) return false;
  showBlock(describeBlock(so, x, y, z)); return true;
}
const itemText = (s) => (s.includes("/") ? s : s.replace(/minecraft:/g, ""));
// a block's kinds in words: "redstone (holds a component), storage"
const kindsText = (d) => (d.kinds ?? []).map((k) => `${kindName(k.kind).toLowerCase()}${k.why ? ` (${k.why})` : ""}`).join(", ");   // ids without the namespace; a rule list (regexes) as is
// The Block group is a properties list: only the rows that have something to say, the block's id first, its state as
// key/value chips, the position, the sign or painting on it, then the metadata (item, frame, owner, role) and a link
// to its part in the Parts list. Nothing is pinned: a one-line prompt instead.
function showBlock(d) {
  const list = $("props"); list.replaceChildren();
  pinned.cell = d?.cell ?? null; placeBox("pin", pinned.cell); syncUrl();
  $("propsEmpty").style.display = d ? "none" : "";
  $("propsBar").style.display = d?.cell ? "" : "none";
  $("inspectSum").textContent = d ? d.id.replace(/^minecraft:/, "").replace(/\s*\(.*$/, "") : "";
  selectPartRow(d?.part ? partOf(d.part) : null);
  if (!d) return;
  const row = (key, cls, fill) => {
    const k = document.createElement("span"); k.className = "k"; k.textContent = key;
    const v = document.createElement("span"); v.className = `v ${cls}`.trim();
    if (typeof fill === "string") { v.textContent = fill; v.title = fill; } else fill(v);
    list.append(k, v);
  };
  row("block", "mono", d.id);
  if (d.state.length) row("state", "chips", (v) => { v.title = d.state.map(([k, x]) => `${k} ${x}`).join(" · "); for (const [k, x] of d.state) { const chip = document.createElement("span"); chip.className = "kv"; const key = document.createElement("span"); key.className = "kk"; key.textContent = k; chip.append(key, x); v.append(chip); } });
  row("at", "mono dim", d.pos);
  if (d.extra) row(d.extra.kind, "scroll", d.extra.text);
  if (d.part?.item) row("item", "scroll", itemText(d.part.item));
  if (d.frame) row("frame", "dim", `framed ${d.frame}`);
  if (d.part?.owner) row("owner", "dim", d.part.owner);
  if (d.part?.role) row("role", "dim scroll", d.part.role);
  // the part's code and the solver's line, for reading a solution beside it
  if (d.part?.code) row("code", "mono dim", d.part.line ? `${d.part.code}, line ${d.part.line}` : d.part.code);
  const pn = d.part ? partOf(d.part) : null;
  if (pn && info.parts.some((p) => p.name === pn)) row("part", "", (v) => { const a = document.createElement("a"); a.className = "lnk"; a.textContent = pn; a.title = "Show this part in the Parts list"; a.onclick = () => revealPartRow(pn); v.append(a); });
  else if (!d.part && meta) row("part", "dim", meta.count ? "not in the metadata" : "no metadata for this file");
  // its type and kinds, each a link to its row in the Blocks list
  const link = (v, text, title, go) => { const a = document.createElement("a"); a.className = "lnk"; a.textContent = text; a.title = title; a.onclick = go; v.append(a); };
  const ti = d.cell && file ? blocks.types?.ofPalette[file.schem.data[file.schem.index(d.cell.x, d.cell.y, d.cell.z)]] : 0;
  const t = ti ? blocks.types.types[ti - 1] : null;
  if (t && blocks.types.types.length >= 2) row("type", "", (v) => link(v, t.name, "Show this type in the Blocks list", () => revealBlockRow("type", t.id)));
  if (d.kinds?.length) row("kinds", "", (v) => d.kinds.forEach((k, j) => {
    if (j) v.append(" · ");
    const listed = blocks.kinds?.shown && blocks.kinds.listed.includes(k.kind), text = `${kindName(k.kind).toLowerCase()}${k.why ? ` (${k.why})` : ""}`;
    if (listed) link(v, text, "Show this kind in the Blocks list", () => revealBlockRow("kind", k.kind)); else v.append(text);
  }));
}
// Shell toggles: Roof, Walls and Floor reload the schematic with that part turned to air so the inside is visible.
// Each button is a toggle, lit while the part is shown; a part the file does not have is disabled.
const PART_NAMES = { roof: "Roof", wall: "Walls", floor: "Floor" };
function showShellState() {
  for (const p of Object.keys(shell)) {
    const b = $(`shell-${p}`), n = info.shell?.[p] ?? 0;
    b.setAttribute("aria-pressed", String(shell[p]));
    b.disabled = !n;
    const key = p === "roof" ? " (R)" : "";
    b.title = !n ? `${PART_NAMES[p]}: this file has none (no shell metadata, or no ${p} in it)` : shell[p] ? `${PART_NAMES[p]} shown (${n} blocks); click to hide them${key}` : `${PART_NAMES[p]} hidden (${n} blocks); click to show them${key}`;
  }
}
// The Parts list: one row per part (eye, name, count, solo), filtered by the search box. Hovering a row lights the
// part's blocks in the view, clicking the name flies to it, the eye hides or shows it. Solo shows a part alone; solo
// again shows all.
const partRows = new Map();
const soloed = () => { const parts = info.parts; const shown = parts.filter((p) => !hiddenPartSet.has(p.name)); return parts.length > 1 && shown.length === 1 ? shown[0].name : null; };
/** Shows only that part, or every part again when it is the one shown alone (the Parts list's solo, the materials list's). */
function soloPart(name) {
  const solo = soloed() === name;
  hiddenPartSet.clear(); if (!solo) for (const q of info.parts) if (q.name !== name) hiddenPartSet.add(q.name);
  renderParts(); reloadLayers(solo ? "every part" : `only ${name}`);
}
/** One row of the Parts, Kinds or Types list: eye (shown or hidden), name, count, solo. Hovering lights its blocks up
 *  (`ghost`: the row), the name flies to them, the eye hides or shows them, solo shows them alone (again: all). */
function rowEl({ name, sub = "", count, title, hidden, mixed = false, solo, soloTitle, icon = null, fold = null, nested = false, onEye, onSolo, onFly, ghost: row }) {
  const el = document.createElement("div"); el.className = `part${hidden ? " hid" : mixed ? " mixed" : ""}${nested ? " nested" : ""}`; el.title = title;
  const eye = document.createElement("button"); eye.className = "eye"; eye.title = hidden ? `Show ${name}` : `Hide ${name}`;
  const nm = document.createElement("span"); nm.className = "nm";
  // a family's row opens on its caret to its members
  if (fold) { const b = document.createElement("button"); b.className = "fold"; b.textContent = fold.open ? "\u25BE" : "\u25B8"; b.title = fold.open ? "Fold the family" : "Show its types"; b.onclick = (ev) => { ev.stopPropagation(); fold.toggle(); }; nm.append(b); }
  if (icon) { const img = document.createElement("img"); img.className = "ic"; img.alt = ""; icon(img); nm.append(img); }
  nm.append(name);
  if (sub) { const m = document.createElement("span"); m.className = "mod"; m.textContent = ` · ${sub}`; nm.append(m); }
  const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = count.toLocaleString("en-US");
  const only = document.createElement("button"); only.className = "solo"; only.textContent = "solo"; only.setAttribute("aria-pressed", String(solo)); only.title = soloTitle;
  eye.onclick = onEye; only.onclick = onSolo; nm.onclick = onFly;
  el.onmouseenter = () => showGhost(row); el.onmouseleave = hideGhost;
  el.append(eye, nm, cnt, only);
  return el;
}
function renderParts() {
  const list = $("parts"), parts = info.parts;
  $("partsGrp").style.display = parts.length ? "" : "none";
  const shown = parts.length - hiddenPartSet.size;
  $("partsCount").textContent = hiddenPartSet.size ? `${shown} / ${parts.length}` : String(parts.length);
  $("partsAll").disabled = !hiddenPartSet.size;
  const filter = $("partFilter").value.trim().toLowerCase();
  const solo = soloed();
  list.replaceChildren(); partRows.clear();
  for (const p of parts) {
    const hid = hiddenPartSet.has(p.name);
    const el = rowEl({
      name: p.name, count: p.count, hidden: hid, solo: solo === p.name, ghost: { axis: "part", key: p.name },
      title: `${p.name}: ${p.count} blocks, ${hid ? "hidden" : "shown"}. Click the name to fly to it, the eye to ${hid ? "show" : "hide"} it`,
      soloTitle: solo === p.name ? "Show every part again" : `Show only ${p.name}`,
      onEye: () => { if (hiddenPartSet.has(p.name)) hiddenPartSet.delete(p.name); else hiddenPartSet.add(p.name); renderParts(); reloadLayers(`${hiddenPartSet.has(p.name) ? "without" : "with"} ${p.name}`); },
      onSolo: () => soloPart(p.name), onFly: () => flyToPart(p.name),
    });
    if (filter && !p.name.toLowerCase().includes(filter)) el.classList.add("none");
    list.append(el); partRows.set(p.name, el);
  }
}
$("partsAll").onclick = () => { if (!hiddenPartSet.size) return; hiddenPartSet.clear(); renderParts(); reloadLayers("every part"); };
$("partFilter").oninput = renderParts;
$("partFilter").onkeydown = (ev) => { if (ev.key === "Escape") { ev.target.value = ""; renderParts(); ev.target.blur(); } ev.stopPropagation(); };
function selectPartRow(name) { for (const [n, r] of partRows) r.classList.toggle("sel", n === name); }
// The Blocks group: the file's kinds, then its types, in the same rows as Parts. The kinds are left out where they
// cannot split the file (kinds.js kindsShown), the whole group where there is one type; the types list shows the 40
// largest until "show all" or a filter.
const TYPES_SHOWN = 40;
let typesAll = false;
const blockRows = new Map();   // "kind:<key>", "family:<key>" or "type:<id>" -> its row, in the list's order
const blockActs = new Map();   // the same keys -> { eye, solo }: what a row's buttons do, for the keyboard
const openFamilies = new Set();   // the families listed open
let blockSel = [];   // the rows picked: by the arrow keys in the filter (one), or a block's kinds (K)
const soloedKind = () => (onlyKinds.size === 1 ? [...onlyKinds][0] : null);
const soloedType = () => { const t = blocks.types?.types ?? []; return t.length > 1 && hiddenTypes.size === t.length - 1 ? (t.find((x) => !hiddenTypes.has(x.id))?.id ?? null) : null; };
function renderBlocks() {
  const k = blocks.kinds, ty = blocks.types?.types ?? [];
  const showKinds = !!k?.shown, showTypes = ty.length >= 2;
  $("blocksGrp").style.display = showKinds || showTypes ? "" : "none";
  blockRows.clear(); blockActs.clear();
  const filter = $("blockFilter").value.trim().toLowerCase();
  const kindsOff = showKinds ? k.listed.filter((x) => !kindShown(x)).length : 0;
  $("blocksSum").textContent = [showKinds && `${k.listed.length} kinds`, `${ty.length} types`, kindsOff + hiddenTypes.size && `${kindsOff + hiddenTypes.size} hidden`].filter(Boolean).join(" · ");
  $("blocksAll").disabled = !kindsOff && !hiddenTypes.size && !onlyKinds.size;
  // kinds, most blocks first
  const kl = $("kinds"); kl.replaceChildren();
  $("kindsHead").style.display = kl.style.display = showKinds ? "" : "none";
  const soloK = soloedKind();
  if (showKinds) for (const key of [...k.listed].sort((a, b) => kindCount(b) - kindCount(a))) {
    const def = KINDS.find((x) => x.key === key), n = kindCount(key), hid = !kindShown(key), lower = def.name.toLowerCase();
    const el = rowEl({
      name: def.name, count: n, hidden: hid, solo: soloK === key, ghost: { axis: "kind", key },
      title: `${def.name}: ${def.tip}. ${n.toLocaleString("en-US")} blocks, ${hid ? "hidden" : "shown"}${n > GHOST_MAX ? "; hovering lights up every few of them" : ""}`,
      soloTitle: soloK === key ? "Show every kind again" : `Show only ${lower}`,
      onEye: () => toggleKind(key), onSolo: () => soloKind(key), onFly: () => flyToRow({ axis: "kind", key }),
    });
    if (filter && !lower.includes(filter) && !key.includes(filter)) el.classList.add("none");
    kl.append(el); blockRows.set(`kind:${key}`, el); blockActs.set(`kind:${key}`, { eye: () => toggleKind(key), solo: () => soloKind(key) });
  }
  // types: the largest first, the types of a family (every concrete) folded into one row; the first 40 rows until
  // "show all". A filter searches names, ids and mods, and opens the families it finds types in.
  const tl = $("types"); tl.replaceChildren();
  $("typesHead").style.display = tl.style.display = showTypes ? "" : "none";
  const soloT = soloedType(), soloF = soloedFamily();
  const matches = (t) => !filter || t.name.includes(filter) || t.id.includes(filter) || (t.mod ?? "").includes(filter);
  const typeRow = (t, nested) => {
    const hid = hiddenTypes.has(t.id);
    const el = rowEl({
      name: t.name, sub: t.mod ?? "", count: t.count, hidden: hid, solo: soloT === t.id, nested, ghost: { axis: "type", key: t.id },
      icon: (img) => mats.iconOfBlock(t.id).then((u) => { if (u) img.src = u; }),
      title: `${t.id}: ${t.count.toLocaleString("en-US")} blocks, ${hid ? "hidden" : "shown"}. Click the name to fly to them, the eye to ${hid ? "show" : "hide"} them`,
      soloTitle: soloT === t.id ? "Show every type again" : `Show only ${t.name}`,
      onEye: () => toggleType(t.id), onSolo: () => soloType(t.id), onFly: () => flyToRow({ axis: "type", key: t.id }),
    });
    tl.append(el); blockRows.set(`type:${t.id}`, el); blockActs.set(`type:${t.id}`, { eye: () => toggleType(t.id), solo: () => soloType(t.id) });
  };
  let shownRows = 0;
  const entries = typeEntries();
  if (showTypes) for (const e of entries) {
    if (!filter && !typesAll && shownRows >= TYPES_SHOWN) break;
    if (!e.family) { if (matches(e.type)) { typeRow(e.type, false); shownRows++; } continue; }
    const fam = e.family, members = fam.members.map(typeOf);
    const famMatch = matches({ name: fam.name, id: fam.key, mod: fam.mod });
    const listedMembers = filter && !famMatch ? members.filter(matches) : members;
    if (!listedMembers.length) continue;
    const open = filter ? true : openFamilies.has(fam.key), off = fam.members.filter((id) => hiddenTypes.has(id)).length;
    const el = rowEl({
      name: fam.name, sub: `${fam.members.length} types${fam.mod ? ` · ${fam.mod}` : ""}`, count: fam.count,
      hidden: off === fam.members.length, mixed: off > 0 && off < fam.members.length, solo: soloF === fam.key, ghost: { axis: "family", key: fam.key },
      icon: (img) => mats.iconOfBlock(fam.members[0]).then((u) => { if (u) img.src = u; }),
      fold: { open, toggle: () => { if (openFamilies.has(fam.key)) openFamilies.delete(fam.key); else openFamilies.add(fam.key); renderBlocks(); } },
      title: `${fam.name}: ${fam.members.length} types (${members.map((t) => t.name).join(", ")}), ${fam.count.toLocaleString("en-US")} blocks${off ? `, ${off} hidden` : ""}. The caret lists them`,
      soloTitle: soloF === fam.key ? "Show every type again" : `Show only the ${fam.name}`,
      onEye: () => toggleFamily(fam), onSolo: () => soloFamily(fam), onFly: () => flyToRow({ axis: "family", key: fam.key }),
    });
    tl.append(el); blockRows.set(`family:${fam.key}`, el); blockActs.set(`family:${fam.key}`, { eye: () => toggleFamily(fam), solo: () => soloFamily(fam) });
    shownRows++;
    if (open) for (const t of listedMembers) typeRow(t, true);
  }
  const more = $("typesMore");
  more.hidden = !showTypes || filter !== "" || entries.length <= TYPES_SHOWN;
  more.textContent = typesAll ? "show the first 40" : `${Math.min(TYPES_SHOWN, entries.length)} of ${entries.length} rows · show all`;
  // the rows picked with the keyboard or Inspect stay picked
  for (const [key, el] of blockRows) el.classList.toggle("sel", blockSel.includes(key));
}
/** The Types list's rows before a filter: each family once (where its blocks rank), the other types on their own. */
function typeEntries() {
  const out = [], seen = new Set();
  for (const t of blocks.types?.types ?? []) {
    const fam = blocks.familyOf.get(t.id);
    if (!fam) out.push({ type: t, count: t.count });
    else if (!seen.has(fam.key)) { seen.add(fam.key); out.push({ family: fam, count: fam.count }); }
  }
  return out.sort((a, b) => b.count - a.count);
}
const soloedFamily = () => {
  const ty = blocks.types?.types ?? [];
  for (const fam of blocks.families) if (hiddenTypes.size === ty.length - fam.members.length && fam.members.every((id) => !hiddenTypes.has(id))) return fam.key;
  return null;
};
function toggleFamily(fam) {
  const all = fam.members.every((id) => hiddenTypes.has(id));
  for (const id of fam.members) if (all) hiddenTypes.delete(id); else hiddenTypes.add(id);
  return blocksChanged(`${all ? "with" : "without"} the ${fam.name}`);
}
function soloFamily(fam) {
  const solo = soloedFamily() === fam.key, keep = new Set(fam.members);
  hiddenTypes.clear(); if (!solo) for (const t of blocks.types.types) if (!keep.has(t.id)) hiddenTypes.add(t.id);
  return blocksChanged(solo ? "every type" : `only the ${fam.name}`);
}
/** After a kind or type is hidden or shown: the lists, the shell buttons and the view follow. */
function blocksChanged(what) { showShellState(); renderBlocks(); return reloadLayers(what); }
function toggleKind(k) {
  if (onlyKinds.size) { if (onlyKinds.has(k)) onlyKinds.delete(k); else { onlyKinds.add(k); if (k in shell) shell[k] = true; } }
  else if (k in shell) shell[k] = !shell[k];
  else if (hiddenKinds.has(k)) hiddenKinds.delete(k); else hiddenKinds.add(k);
  return blocksChanged(`${kindShown(k) ? "with" : "without"} ${kindName(k).toLowerCase()}`);
}
/** Shows only that kind's blocks (with the other filters standing), or every kind again when it is the one shown. */
function soloKind(k) {
  const solo = soloedKind() === k;
  onlyKinds.clear(); hiddenKinds.clear();
  if (!solo) { onlyKinds.add(k); if (k in shell) shell[k] = true; }
  return blocksChanged(solo ? "every kind" : `only ${kindName(k).toLowerCase()}`);
}
function toggleType(id) {
  if (hiddenTypes.has(id)) hiddenTypes.delete(id); else hiddenTypes.add(id);
  return blocksChanged(`${hiddenTypes.has(id) ? "without" : "with"} ${typeOf(id)?.name ?? id}`);
}
function soloType(id) {
  const solo = soloedType() === id;
  hiddenTypes.clear(); if (!solo) for (const t of blocks.types.types) if (t.id !== id) hiddenTypes.add(t.id);
  return blocksChanged(solo ? "every type" : `only ${typeOf(id)?.name ?? id}`);
}
$("blocksAll").onclick = () => {
  hiddenKinds.clear(); onlyKinds.clear(); hiddenTypes.clear();
  for (const k of SHELL_KEYS) if (blocks.kinds?.shown && blocks.kinds.listed.includes(k)) shell[k] = true;
  blocksChanged("every kind and type");
};
$("blockFilter").oninput = () => { blockSel = []; renderBlocks(); };
// In the filter: the arrows move through the rows listed, Enter hides or shows the row picked (else the first),
// Shift+Enter solos it, Esc clears the filter and leaves it.
$("blockFilter").onkeydown = (ev) => {
  ev.stopPropagation();
  const keys = [...blockRows].filter(([, el]) => !el.classList.contains("none")).map(([key]) => key);
  if (ev.key === "Escape") { ev.target.value = ""; blockSel = []; renderBlocks(); ev.target.blur(); }
  else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault(); if (!keys.length) return;
    const at = keys.indexOf(blockSel[0]), d = ev.key === "ArrowDown" ? 1 : -1;
    blockSel = [keys[at < 0 ? (d > 0 ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, at + d))]];
    for (const [key, el] of blockRows) el.classList.toggle("sel", blockSel.includes(key));
    blockRows.get(blockSel[0])?.scrollIntoView({ block: "nearest" });
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const key = keys.includes(blockSel[0]) ? blockSel[0] : keys[0], act = blockActs.get(key); if (!act) return;
    blockSel = [key]; (ev.shiftKey ? act.solo : act.eye)();
  }
};
$("typesMore").onclick = () => { typesAll = !typesAll; renderBlocks(); };
/** Opens the Blocks group at rows (`[axis, key]` pairs: a kind, a type, a family), picks them and scrolls to the first. */
function revealBlockRows(rows) {
  $("blocksGrp").open = true; $("blockFilter").value = "";
  const entries = typeEntries();
  for (const [axis, key] of rows) {
    const fam = axis === "type" ? blocks.familyOf.get(key) : null;
    if (fam) openFamilies.add(fam.key);
    const at = entries.findIndex((e) => (fam ? e.family === fam : e.type?.id === key || e.family?.key === key));
    if (axis !== "kind" && at >= TYPES_SHOWN) typesAll = true;
  }
  blockSel = rows.map(([axis, key]) => `${axis}:${key}`);
  renderBlocks();
  blockRows.get(blockSel[0])?.scrollIntoView({ block: "nearest" });
}
const revealBlockRow = (axis, key) => revealBlockRows([[axis, key]]);
function revealPartRow(name) { $("partsGrp").open = true; const r = partRows.get(name); if (!r) return; $("partFilter").value = ""; renderParts(); selectPartRow(name); partRows.get(name)?.scrollIntoView({ block: "nearest" }); }
// Fly to a part: aim the orbit pivot at the middle of its blocks and back the camera off along its current direction
// far enough to see the whole part. Returns the box flown to (file cells, inclusive), or null.
function flyToRow(row) {
  let cells = shownCellsOfRow(row); if (!cells.length) cells = cellsOfRow(row); if (!cells.length) return null;
  const s = file.schem, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of cells) { const c = s.cellOf(i); for (let a = 0; a < 3; a++) { if (c[a] < min[a]) min[a] = c[a]; if (c[a] > max[a]) max[a] = c[a]; } }
  return flyToBox(min, max) ? { min, max } : null;
}
const flyToPart = (name) => flyToRow({ axis: "part", key: name });
/** Frames the file cells from `min` to `max` (inclusive) as flyToPart does; false before the renderer is up. */
function flyToBox(min, max) {
  const ctl = controls(), cam = camera(), g = group(); if (!ctl?.target || !cam || !g) return false;
  // a view a reload is still about to put back would undo the flight (as a click cancels it too)
  cancelRestores(); stopMomentum();
  userMoved = true;
  if (topView.on) { topFit(new THREE.Box3(g.localToWorld(new THREE.Vector3(...min).subScalar(0.5)), g.localToWorld(new THREE.Vector3(...max).addScalar(0.5)))); return true; }
  const center = g.localToWorld(new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2));
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) + 1;
  const dir = cam.position.clone().sub(ctl.target).normalize(); if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.6, 0.6).normalize();
  const fov = cam.isPerspectiveCamera ? (cam.fov * Math.PI) / 180 : 1;
  const dist = cam.isPerspectiveCamera ? (size / 2) / Math.tan(fov / 2) * 1.25 + 2 : cam.position.distanceTo(ctl.target);
  ctl.target.copy(center); cam.position.copy(center).addScaledVector(dir, dist); ctl.update?.(); userMoved = true; redraw();
  return true;
}
// The renderer refits its camera to the schematic on every load, so a layer change would throw the view back to the
// overview. The view is saved before the reload and put back once the new meshes are rendered (and again a moment
// later, after the renderer's own deferred fit), unless the user has not moved the camera yet, when the fit is wanted.
// A drag, wheel or fly while the reload is in flight moves the saved view along with it (captured on the next frame,
// so the library's own refit is never what gets saved), so what comes back after the render is the view the user
// left, not the one from before the click.
const savedView = { on: false, pos: new THREE.Vector3(), target: new THREE.Vector3(), quat: new THREE.Quaternion() };
let restoreTimers = [], captureNext = false;
const cancelRestores = () => { for (const t of restoreTimers) clearTimeout(t); restoreTimers = []; };
const noteInput = () => { captureNext = true; };
for (const t of ["pointerdown", "pointermove", "pointerup", "wheel"]) canvas.addEventListener(t, (ev) => { if (t !== "pointermove" || ev.buttons) noteInput(); }, { capture: true, passive: true });
function saveView() {
  const cam = camera(), ctl = controls(); if (!cam || !ctl?.target || !userMoved) { savedView.on = false; return; }
  savedView.on = true; savedView.pos.copy(cam.position); savedView.target.copy(ctl.target); savedView.quat.copy(cam.quaternion);
}
requestAnimationFrame(function captureLoop() { requestAnimationFrame(captureLoop); if (captureNext) { captureNext = false; if (savedView.on) saveView(); } });
function restoreView() {
  if (!savedView.on || pointerHeld) return;
  const cam = camera(), ctl = controls(); if (!cam || !ctl?.target) return;
  // the top view keeps only where it looks on the ground: it stands above the drawn layers, which move with a reload
  if (topView.on) { ctl.target.x = savedView.target.x; ctl.target.z = savedView.target.z; placeTop(); return; }
  cam.position.copy(savedView.pos); ctl.target.copy(savedView.target); cam.quaternion.copy(savedView.quat); ctl.update?.(); redraw();
}
// now, and again after the renderer's own deferred fit
function restoreSoon() { restoreView(); cancelRestores(); restoreTimers = [setTimeout(restoreView, 100), setTimeout(restoreView, 500)]; }
/** Shows the layers, parts and shell asked for now: only the layers changed, the renderer draws others of the file it
 *  has; else the file is loaded again (the camera kept). */
async function reloadLayers(what) {
  if (!renderer?.schematicManager || !file) return; // not before the renderer has set itself up
  applyLayers();
  hideGhost(); showMatCells(null);
  const so = schematicObject();
  // a whole file of this one on its way: the renderer shows what is asked for once it is in (onSchematicLoaded)
  if (loaded.pending?.file === file && !loaded.pending.cut && loaded.live && !typesOutsideGroups()) return;
  if (canShowNow(so)) {
    if (await so.showCells(rangeNow(), hiddenGroupsNow())) { layersShown(); return; }
    loaded.live = false;   // this build cannot: the file is loaded with only what is drawn
  }
  unknown.clear();
  saveView();
  status(`reloading ${what}…`, "busy");
  try { await renderer.schematicManager.loadSchematic(SCHEM_ID, await renderBytes(), loadProps()); } catch (e) { loaded.pending = null; status(e.message, "err"); }
  restoreSoon();
}
/** After the renderer shows other cells of the file it has: what the page draws over them follows. */
function layersShown() {
  status(capture.after ?? `rendered ${schemName}`); capture.after = null;
  buildOverlayPaintings(); updateGrid();
  if (!userMoved && !capture.on) smartFit();   // a view not moved yet frames what is drawn, as after a load
  if (topView.on) placeTop();
  if (layer.mode === "above" && layer.wantBottomUp) { layer.wantBottomUp = false; lookFromBelow(); }
  syncUrl(); redraw(); settleSoon();
}
for (const p of Object.keys(shell)) $(`shell-${p}`).onclick = () => {
  shell[p] = !shell[p];
  showShellState(); renderBlocks();
  reloadLayers(shell[p] ? `with the ${p}` : `without the ${p}`);
};
// Layer controls: single / below / above the current layer, stepped with the buttons, the slider, PageUp/PageDown
// or [ and ]. Moving the slider in "all" switches to "below", as stepping does.
const setMode = (mode) => { if (layer.mode === mode) return; if (layer.mode === "all" && mode !== "all") layer.cur = topLayer(); layer.wantBottomUp = mode === "above" && !userMoved; layer.mode = mode; reloadLayers(`layers (${mode})`); };
$("layerSingle").onclick = () => setMode("single");
$("layerBelow").onclick = () => setMode("below");
$("layerAbove").onclick = () => setMode("above");
$("layerAll").onclick = () => setMode("all");
// A step goes to the nearest layer that changes the view (layers.js): layers with no block shown are passed over.
const stepLayer = (d) => {
  const mode = layer.mode === "all" ? "below" : layer.mode, cur = layer.mode === "all" ? topLayer() : layer.cur;
  const to = stepTarget(mode, Math.min(cur, topLayer()), d, filledNow().filter((y) => y <= topLayer()));
  if (to === null) { status(`no layer ${d < 0 ? "below" : "above"} changes the view`); return; }
  layer.mode = mode; layer.cur = to; reloadLayers(`layer ${to}`);
};
$("layerDown").onclick = () => stepLayer(-1);
$("layerUp").onclick = () => stepLayer(1);
{
  // the slider shows the layers while it is dragged: one reload at a time, each for wherever the thumb is when the
  // last one finished (positions passed over in between are skipped, so a fast drag never queues up reloads)
  const sl = $("layerSlider");
  let busy = false;
  const go = async () => {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        const v = Number(sl.value), wasAll = layer.mode === "all";
        if (v === layer.cur && !wasAll) break;
        if (wasAll) layer.mode = "below";
        layer.cur = v;
        // a reload can stall (the renderer pauses in a background tab): after 5 s the slider stops waiting on it
        await Promise.race([reloadLayers(`layer ${v}`), new Promise((r) => setTimeout(r, 5000))]);
      }
    } finally { busy = false; }
  };
  sl.oninput = () => { $("layerY").textContent = `y ${worldY(Number(sl.value))}`; $("layerY").classList.remove("dim"); go(); };
  sl.onchange = go;
}
function lookFromBelow() {
  const ctl = controls(), cam = camera(); if (!ctl?.target || !cam || topView.on) return;
  const t = ctl.target.clone(); const d = cam.position.distanceTo(t);
  cam.position.set(t.x, t.y - d * 0.8, t.z + d * 0.6); ctl.update?.();
}

// Click to inspect: raycast the click, look the cell up in the schematic (name and state) and pin it in the Block
// group with its world coordinates and metadata.
let downAt = null;
canvas.addEventListener("pointerdown", (ev) => { downAt = [ev.clientX, ev.clientY]; }, true);
canvas.addEventListener("click", (ev) => {
  ev.stopImmediatePropagation(); // the renderer's own click (a highlight box on a cell one off from ours) stays out
  if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5) return; // a drag is not a click
  const so = renderer?.schematicManager.getFirstSchematic(); const p = cellOfHit(hitUnderPointer(...ndcOf(ev)));
  if (!so || !p) { showBlock(null); return; }
  showBlock(describeBlock(so, p.x, p.y, p.z));
  const sm = renderer.simulationManager;
  if (sm?.isSimulationActive()) sm.interactWithBlock(p.x, p.y, p.z).then((w) => { if (w) { so.schematicWrapper = w; so.rebuildMesh?.(); } }).catch(() => {});
}, true);
// Signal digits: the Redstone Tweaks resource pack (MIT, from Modrinth) on top of the built pack, drawing the signal
// strength on dust, the delay on repeaters and the mode on comparators. It is on while the renderer holds that pack
// (the renderer keeps packs between visits, so the choice is remembered); the zip is fetched once and kept. Off is
// the default: the game's own look, and no extra download for a build that is not about redstone. The link carries
// ?digits=on while it is on, and a link's ?digits= sets it.
// a pack added on top: the lowest priority number, which wins in the renderer (one rebuild, no reordering after)
const topPriority = (rpm) => Math.min(0, ...rpm.getAllPacks().map((p) => p.priority)) - 1;
const redstoneTweaksPack = () => packManager(renderer)?.getAllPacks?.().find((p) => p.name === REDSTONE_TWEAKS.name) ?? null;
function showRedstoneTweaks() { $("rtToggle").setAttribute("aria-pressed", String(!!redstoneTweaksPack()?.enabled)); }
$("rtToggle").onclick = () => setDigits(!redstoneTweaksPack());
async function setDigits(on) {
  const rpm = packManager(renderer); if (!rpm) { status("open a schematic first", "err"); return; }
  const have = redstoneTweaksPack();
  if (on === !!have) { showRedstoneTweaks(); return; }
  try {
    if (have) { status("signal digits off…", "busy"); await rpm.removePack(have.id); status("signal digits off"); }
    else {
      status("fetching Redstone Tweaks from Modrinth…", "busy");
      await rpm.loadPackFromBlob(await extraPackBlob(REDSTONE_TWEAKS), REDSTONE_TWEAKS.name, { priority: topPriority(rpm) });
      await keepBaseLowest(renderer);
      status("signal digits on (Redstone Tweaks): signal strength on dust, repeater delays, comparator modes");
    }
  } catch (e) { status(`signal digits: ${e.message}`, "err"); }
  showRedstoneTweaks(); syncUrl();
}
// Redstone simulation: the renderer bundles Nucleation's simulator (MCHPRS redpiler). Simulate compiles the loaded
// schematic; clicking a lever then toggles it in the simulation, Tick advances one tick, Run ticks at 20/s. The dust
// is the renderer's own, tinted by its power, rebuilt after every sync.
const simInfo = (t) => { const el = $("simInfo"); el.textContent = t || "—"; el.title = t ?? ""; $("simSum").textContent = simOn ? t : "off"; };
simInfo(simOn ? "not compiled" : "off; open the page with ?sim=on");
$("simStart").onclick = async () => {
  const sm = renderer?.simulationManager, so = renderer?.schematicManager.getFirstSchematic();
  if (!sm || !so) { simInfo("open the page with ?sim=on first"); return; }
  simInfo("compiling…");
  const ok = await sm.initializeSimulation(so.getSchematicWrapper(), { syncMode: "synced", optimize: false });
  simInfo(ok ? "ready: click a lever, then Tick or Run" : "failed (see console)");
};
$("simTick").onclick = () => { const sm = renderer?.simulationManager; if (!sm?.isSimulationActive()) { simInfo("press Simulate first"); return; } sm.tick(1); simInfo(`tick ${sm.getState().tickCount}`); };
$("simRun").onclick = () => {
  const sm = renderer?.simulationManager; if (!sm?.isSimulationActive()) { simInfo("press Simulate first"); return; }
  const running = !sm.getState().autoTickEnabled;
  if (running) sm.startAutoTick(); else sm.stopAutoTick();
  $("simRun").textContent = running ? "Pause" : "Run"; $("simRun").setAttribute("aria-pressed", String(running));
};
// Camera presets as a segmented pair, the active one pressed.
const BG = 0x1a1d22;
const keepBackground = () => { const sc = renderer?.sceneManager?.scene; if (sc) sc.background = new THREE.Color(BG); try { renderer?.renderManager?.renderer?.setClearColor(BG, 1); } catch {} redraw(); };
let camPreset = "perspective";   // the renderer's camera: perspective or isometric (the top view uses the isometric one)
function showCamButtons() {
  $("persp").setAttribute("aria-pressed", String(!topView.on && camPreset === "perspective"));
  $("iso").setAttribute("aria-pressed", String(!topView.on && camPreset === "isometric"));
  $("top").setAttribute("aria-pressed", String(topView.on));
  $("grid").hidden = !topView.on; $("grid").setAttribute("aria-pressed", String(topView.grid));
}
const setCamera = (preset) => {
  stopMomentum();
  leaveTop();
  renderer?.cameraManager.switchCameraPreset(preset); camPreset = preset;
  keepBackground(); setTimeout(keepBackground, 50); setTimeout(keepBackground, 400);
  setTimeout(tuneControls, 0);
  showCamButtons(); syncUrl();
};
$("iso").onclick = () => setCamera("isometric");
$("persp").onclick = () => setCamera("perspective");
$("top").onclick = () => toggleTop();

// The top view: a plan of the drawn layers, straight down through the renderer's isometric camera, which is
// orthographic, so every block is the same size wherever it is on screen. Three's OrbitControls still pan and zoom
// (zoom toward the cursor), but turning is off and their polar and distance limits are opened so the camera may sit at
// the pole. The camera stands a hair off the vertical, toward the bottom of the screen: three's lookAt needs that
// sliver to know which way the screen's top faces, so it is what holds the compass direction (Q / E turn it a
// quarter, N puts north up). Meanwhile the renderer's refit on every load is off (preserveCameraOnUpdate), so a layer
// change keeps the plan where it was; the camera is put back above the drawn blocks instead, as their height moves.
const QUARTER = Math.PI / 2;
function enterTop({ q, zoom, target } = {}) {
  const cm = renderer?.cameraManager; if (!cm || topView.on) return;
  stopMomentum(); cancelRestores();
  // the plan faces the way the view did, to the nearest quarter
  if (q === undefined) { const cur = camera(), f = cur ? groundForward(cur) : null; q = f ? ((Math.round(Math.atan2(f.x, -f.z) / QUARTER) % 4) + 4) % 4 : 0; }
  topView.prev = camPreset;
  if (camPreset !== "isometric") { cm.switchCameraPreset("isometric"); camPreset = "isometric"; }
  const ctl = controls(), cam = camera(); if (!ctl?.target || !cam) return;
  topView.saved = { minPolarAngle: ctl.minPolarAngle, maxPolarAngle: ctl.maxPolarAngle, minDistance: ctl.minDistance, maxDistance: ctl.maxDistance,
    enableRotate: ctl.enableRotate, buttons: { ...ctl.mouseButtons }, one: ctl.touches?.ONE, far: cam.far };
  Object.assign(ctl, { minPolarAngle: 0, maxPolarAngle: Math.PI, minDistance: 0, maxDistance: Infinity });
  cm.cameraOptions.preserveCameraOnUpdate = true;
  Object.assign(topView, { on: true, q, heading: q * QUARTER, anim: null });
  tuneControls();
  if (target) { ctl.target.copy(target); if (zoom > 0) cam.zoom = zoom; placeTop(); } else topFit();
  userMoved = true;
  keepBackground(); setTimeout(keepBackground, 50);
  updateGrid(); showCamButtons(); syncUrl();
}
function leaveTop() {
  if (!topView.on) return;
  const ctl = controls(), cam = camera(), s = topView.saved;
  Object.assign(topView, { on: false, anim: null });
  if (renderer) renderer.cameraManager.cameraOptions.preserveCameraOnUpdate = false;
  if (ctl && s) {
    Object.assign(ctl, { minPolarAngle: s.minPolarAngle, maxPolarAngle: s.maxPolarAngle, minDistance: s.minDistance, maxDistance: s.maxDistance, enableRotate: s.enableRotate });
    if (ctl.mouseButtons) Object.assign(ctl.mouseButtons, s.buttons);
    if (ctl.touches && s.one !== undefined) ctl.touches.ONE = s.one;
  }
  // the renderer's isometric fit sizes the frustum for no zoom
  if (cam) { if (s) cam.far = s.far; cam.zoom = 1; cam.updateProjectionMatrix(); }
  updateGrid();
}
const toggleTop = () => { if (topView.on) setCamera(topView.prev); else enterTop(); };
// Stands the camera above the pivot, over the top of the whole file (so no layer is ever behind it), facing the heading.
function placeTop() {
  const cam = camera(), ctl = controls(), g = group(); if (!cam || !ctl?.target || !topView.on) return;
  const topY = g ? g.localToWorld(new THREE.Vector3(0, info.height + 0.5, 0)).y : ctl.target.y;
  const H = Math.max(40, info.height + 40), off = H * 1e-4;
  const fx = Math.sin(topView.heading), fz = -Math.cos(topView.heading);   // the screen's top, on the ground
  ctl.target.y = topY;
  cam.position.set(ctl.target.x - fx * off, topY + H, ctl.target.z - fz * off);
  cam.far = Math.max(topView.saved?.far ?? 1000, H + info.height + 50); cam.updateProjectionMatrix();
  cam.lookAt(ctl.target); ctl.update?.(); redraw();
}
// Centers the plan on `box` (world; the drawn blocks by default) and zooms so its footprint fills the view.
function topFit(box = null) {
  const cam = camera(), ctl = controls(); if (!cam || !ctl?.target || !topView.on) return;
  if (!box) box = drawnBox();
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const odd = topView.q % 2 === 1;   // east or west up: the file's x runs up the screen
    const w = Math.max(1, odd ? s.z : s.x), h = Math.max(1, odd ? s.x : s.z);
    ctl.target.x = c.x; ctl.target.z = c.z;
    applyViewOffset();
    const across = 1 - viewCenterX();   // the share of the width beside the panel
    cam.zoom = Math.min(((cam.right - cam.left) * across) / (w * 1.1), (cam.top - cam.bottom) / (h * 1.1));
  }
  placeTop();
}
// A turn: the heading eases to `to` over a fifth of a second (the compass loop steps it).
function turnTopTo(to) {
  if (!topView.on) return;
  topView.q = ((Math.round(to / QUARTER) % 4) + 4) % 4;
  topView.anim = { from: topView.heading, to, t0: performance.now() };
  userMoved = true;
}
const turnTop = (d) => turnTopTo((topView.anim?.to ?? topView.heading) + d * QUARTER);
function stepTopTurn() {
  const a = topView.anim; if (!a || !topView.on) return;
  const t = Math.min(1, (performance.now() - a.t0) / 200), e = t * t * (3 - 2 * t);
  topView.heading = a.from + (a.to - a.from) * e;
  if (t === 1) topView.anim = null;
  placeTop();
}
// The block grid: lines on the block edges over the file's footprint, just above the top layer drawn, always in front
// (seen straight down an orthographic camera, lines at any height fall on the edges of every layer). In the marks
// group, so the renderer's reload strips it (rebuilt after every render) and the build animation leaves it out. It
// fades out when a block is under 6 pixels, where it would only grey the plan.
const gridMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false });
let gridLines = null;
function updateGrid() {
  if (gridLines) { gridLines.parent?.remove(gridLines); gridLines.geometry.dispose(); gridLines = null; }
  if (topView.on && topView.grid && info.width && group()) {
    attachMarks();
    const y = shownRange()[1] + 0.52, w = info.width, l = info.length, pts = [];
    for (let x = 0; x <= w; x++) pts.push(x - 0.5, y, -0.5, x - 0.5, y, l - 0.5);
    for (let z = 0; z <= l; z++) pts.push(-0.5, y, z - 0.5, w - 0.5, y, z - 0.5);
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    gridLines = new THREE.LineSegments(geo, gridMat); gridLines.renderOrder = 8; gridLines.raycast = () => {};
    markGroup.add(gridLines); fadeGrid(true);
  }
  redraw();
}
function fadeGrid(force = false) {
  const cam = camera(); if (!gridLines || !cam?.isOrthographicCamera) return;
  const px = (canvas.clientHeight * cam.zoom) / (cam.top - cam.bottom);   // pixels per block
  const show = px >= 6;
  if (force || gridLines.visible !== show) { gridLines.visible = show; redraw(); }
}
const setGrid = (on) => { topView.grid = on; try { localStorage.setItem("top.grid", on ? "1" : "0"); } catch {} updateGrid(); showCamButtons(); };
$("grid").onclick = () => setGrid(!topView.grid);
// The panel collapses to its header (file name, status, compass) with the arrow or H; each group folds on its own;
// both are remembered in this browser. The Redstone group opens when the page runs the simulator.
const hud = $("hud"), hudToggle = $("hudToggle");
const setCollapsed = (c) => { hud.classList.toggle("collapsed", c); hudToggle.setAttribute("aria-expanded", String(!c)); try { localStorage.setItem("hud.collapsed", c ? "1" : "0"); } catch {} };
try { if (localStorage.getItem("hud.collapsed") === "1") setCollapsed(true); } catch {}
hudToggle.onclick = () => setCollapsed(!hud.classList.contains("collapsed"));
for (const grp of document.querySelectorAll("details.grp")) {
  try { const v = localStorage.getItem(`hud.open.${grp.id}`); if (v !== null) grp.open = v === "1"; } catch {}
  grp.addEventListener("toggle", () => { try { localStorage.setItem(`hud.open.${grp.id}`, grp.open ? "1" : "0"); } catch {} });
}
if (simOn) $("simGrp").open = true;
// Help sheet: the mouse and keyboard reference, with ? or the button.
const help = $("help");
const setHelp = (on) => help.classList.toggle("on", on);
$("helpBtn").onclick = () => setHelp(!help.classList.contains("on"));
$("helpClose").onclick = () => setHelp(false);
// About sheet: the licence, the sources and where the game's assets come from, from the footer.
const about = $("about");
const setAbout = (on) => { about.classList.toggle("on", on); $("aboutBtn").setAttribute("aria-expanded", String(on)); };
$("aboutBtn").onclick = () => setAbout(!about.classList.contains("on"));
$("aboutClose").onclick = () => setAbout(false);
// Shot and Build hand the visitor a download.
function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const stem = () => schemName.replace(/\.[^.]+$/, "");
/** A render of the view as a PNG Blob (also the console's and the test harness's way in). */
// the canvas alone: the picture centered on the whole canvas, not beside the panel
async function screenshot(width = 1600, height = 1000) {
  bareView++; applyViewOffset();
  try { return await renderer.takeScreenshot({ format: "image/png", width, height }); } finally { bareView--; applyViewOffset(); }
}
window.saveScreenshot = async (name = `${stem()}.png`, width = 1600, height = 1000) => { download(await screenshot(width, height), name); status(`saved ${name}`); };
$("shot").onclick = () => saveScreenshot();
// The build animation (Build): an animated GIF of the schematic going up a layer at a time from the bottom, each frame
// that layer and everything below it, with the parts and the shell (roof, walls, floor) shown now. The camera is the
// view's direction now, fixed for every frame and placed so the finished build fills the image (whose aspect is the
// build's own outline from there, `margin` of the height on each side), so the frames line up. A layer that adds no
// block, once the hidden parts are air, adds no frame. Downloaded as <name>-build.gif; the layer mode and the camera
// from before come back. Click again to stop. Settings: window.buildGif (delay per layer and hold on the last frame
// in ms, the longer side in pixels, margin, settle: how long the paintings get after each load).
window.buildGif = { delay: 350, hold: 2500, size: 1200, margin: 0.02, settle: 700, download: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// how much is drawn now (the schematic and the page's overlays, not the marks): a layer that leaves it unchanged drew
// nothing new. A mesh drawn in groups counts the indices its groups take (the renderer draws a range of layers by
// pointing them at it), any other its vertices.
const drawnAmount = (g) => (g?.groups?.length && g.index ? g.groups.reduce((n, gr) => n + gr.count, 0) : (g?.attributes?.position?.count ?? 0));
const drawnVertices = () => { let n = 0; group()?.traverseVisible((o) => { if (o.isMesh && !inMarks(o)) n += drawnAmount(o.geometry) * (o.isInstancedMesh ? o.count : 1); }); return n; };
async function loadBelow(y) {
  layer.mode = "below"; layer.cur = y; applyLayers();
  // the renderer draws the layers of the file it has: no reload, only the paintings to place again
  const so = schematicObject();
  if (canShowNow(so) && (await so.showCells(rangeNow(), hiddenGroupsNow()))) {
    buildOverlayPaintings();
    await sleep(Math.min(window.buildGif.settle, 120));
    return;
  }
  unknown.clear();
  const rendered = new Promise((r) => { capture.rendered = r; });
  await renderer.schematicManager.loadSchematic(SCHEM_ID, await renderBytes(), loadProps());
  await Promise.race([rendered, sleep(60000)]);
  capture.rendered = null;
  await sleep(window.buildGif.settle);
}
let lastGif = null;
async function captureBuild() {
  if (capture.on) { capture.stop = true; status("stopping the build animation…", "busy"); return null; }
  const cam = camera(), ctl = controls();
  if (!renderer?.schematicManager || !info.height || !cam) return null;
  const opt = window.buildGif, btn = $("buildGif");
  const before = { mode: layer.mode, cur: layer.cur, view: viewState(cam, ctl) };
  capture.on = true; capture.stop = false;
  stopMomentum(); cancelRestores(); hideGhost(); hideTip(); markGroup.visible = false;
  btn.textContent = "Stop"; btn.setAttribute("aria-pressed", "true");
  let saved = null, result = null;
  try {
    const counts = file.schem.layerCounts(hiddenCells());
    const ys = counts.map((c, y) => (c > 0 ? y : -1)).filter((y) => y >= 0);
    if (!ys.length) throw new Error("nothing to build: every block is hidden");
    status("build animation: framing the finished build…", "busy");
    await loadBelow(ys[ys.length - 1]);
    const points = collectPoints(group(), markGroup);
    if (!points.length) throw new Error("nothing is drawn to frame");
    const view = frameView(cam, before.view.quaternion, points, opt.margin);
    const [width, height] = sizeFor(view.aspect, opt.size);
    const pngs = [], delays = [];
    let drawn = -1;
    for (const [i, y] of ys.entries()) {
      if (capture.stop) throw new Error("stopped");
      status(`build animation: layer ${i + 1} of ${ys.length} (y ${worldY(y)})…`, "busy");
      await loadBelow(y);
      const n = drawnVertices(); if (n === drawn) continue; drawn = n;
      applyView(cam, ctl, view); redraw();
      pngs.push(await renderer.takeScreenshot({ format: "image/png", width, height }));
      delays.push(opt.delay);
    }
    delays[delays.length - 1] = opt.hold;
    const gif = await encodeGif(pngs, delays, (p) => status(`build animation: encoding ${pngs.length} frames, ${Math.round(p * 100)}%…`, "busy"));
    const name = `${stem()}-build.gif`;
    lastGif = gif;
    if (opt.download) download(gif, name);
    result = { name, frames: pngs.length, width, height, bytes: gif.size };
    saved = `${name}: ${pngs.length} frames, ${width}×${height}, ${(gif.size / 1e6).toFixed(1)} MB`;
  } catch (e) { status(`build animation: ${e.message}`, "err"); console.error(e); }
  finally {
    capture.on = false; capture.rendered = null; markGroup.visible = true;
    btn.textContent = "Build"; btn.setAttribute("aria-pressed", "false");
    restoreCamera(cam, ctl, before.view);
    layer.mode = before.mode; layer.cur = before.cur;
    capture.after = saved;
    await reloadLayers("the view from before the build animation");
  }
  return result;
}
$("buildGif").onclick = () => captureBuild();

// ---- opening files --------------------------------------------------------------------------------------------------
// A schematic opened or dropped stays in the page (nothing is uploaded); the link then names no file, since a reload
// cannot bring it back. Its generator's metadata (parts, shell, owner, role, item) is read from the file itself when
// it carries some (BlockInfo). A resource-pack zip goes on top of the merged pack; a modpack (a folder,
// an .mrpack, a CurseForge or mods zip) becomes the source of the mod jars.
async function openLocal(f) {
  const rec = { name: f.name, url: null, param: null, bytes: new Uint8Array(await f.arrayBuffer()), paintings: [], paintingsBase: null };
  // the dev server keeps the last file from disk in this browser's IndexedDB, so a reload opens it again (?local=)
  if (import.meta.env.DEV) storePut("meta", DEV_LOCAL_KEY, { name: rec.name, bytes: rec.bytes });
  await openFile(rec);
}
// On the dev server only: the last file opened from disk, kept in the browser (never sent anywhere), and the address
// names it (?local=<file name>) so a reload, which would otherwise open the default plan, opens it again with the
// rest of the link (layers, parts, camera). A build has neither.
const DEV_LOCAL_KEY = "dev:local-file";
async function reopenLocal(name) {
  const kept = await storeGet("meta", DEV_LOCAL_KEY);
  if (kept?.name !== name) return false;
  await openFile({ name: kept.name, url: null, param: null, bytes: kept.bytes, paintings: [], paintingsBase: null }, { fromUrl: true });
  return true;
}
$("file").onchange = (ev) => {
  const files = [...(ev.target.files ?? [])], schem = files.find((x) => SCHEMATIC_EXT.test(x.name));
  if (schem) openLocal(schem); else if (files.length) status("pick a schematic (.schem, .schematic, .litematic, .nbt)", "err");
  ev.target.value = "";
};
async function isResourcePack(f) {
  try {
    const zip = await JSZip.loadAsync(f);
    return !!zip.file("pack.mcmeta") && Object.keys(zip.files).some((n) => n.startsWith("assets/")) && !zip.file("modrinth.index.json") && !zip.file("manifest.json");
  } catch { return false; }
}
async function addResourcePack(f) {
  const rpm = packManager(renderer); if (!rpm) { status("open a schematic first, then drop the resource pack", "err"); return; }
  status(`adding ${f.name}…`, "busy");
  try { await rpm.loadPackFromBlob(f, f.name, { priority: topPriority(rpm) }); await keepBaseLowest(renderer); status(`${f.name} on top of the pack (the renderer's sidebar, Ctrl+\\, lists and removes packs)`); }
  catch (e) { status(`${f.name}: ${e.message}`, "err"); }
}
// a dropped folder's files with their paths (what Packrat's folder reader takes)
async function folderFiles(entry) {
  const out = [];
  const walk = async (e) => {
    if (e.isFile) { const f = await new Promise((res, rej) => e.file(res, rej)); out.push({ relativePath: e.fullPath.replace(/^\/+/, ""), file: f }); return; }
    const reader = e.createReader();
    for (;;) { const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); if (!batch.length) break; for (const c of batch) await walk(c); }
  };
  await walk(entry);
  return out;
}
let dragDepth = 0;
addEventListener("dragenter", (ev) => { if (!ev.dataTransfer?.types?.includes("Files")) return; dragDepth++; $("dropHint").hidden = false; });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropHint").hidden = true; } });
addEventListener("dragover", (ev) => { if (ev.dataTransfer?.types?.includes("Files")) ev.preventDefault(); });
addEventListener("drop", async (ev) => {
  ev.preventDefault(); dragDepth = 0; $("dropHint").hidden = true;
  const items = [...(ev.dataTransfer?.items ?? [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  const dir = items.find((e) => e.isDirectory);
  if (dir) { usePackFiles(await folderFiles(dir), dir.name); return; }
  const files = [...(ev.dataTransfer?.files ?? [])];
  const schem = files.find((f) => SCHEMATIC_EXT.test(f.name));
  const jars = files.filter((f) => /\.jar$/i.test(f.name));
  for (const f of files.filter((x) => /\.(zip|mrpack)$/i.test(x.name))) {
    if (/\.zip$/i.test(f.name) && (await isResourcePack(f))) await addResourcePack(f);
    else if (/\.mrpack$/i.test(f.name) || (await detectPackZip(f))) await usePackZip(f);
    else status(`${f.name}: neither a resource pack nor a modpack`, "err");
  }
  if (jars.length) await usePackFiles(jars.map((f) => ({ relativePath: `mods/${f.name}`, file: f })), `${jars.length} dropped jar${jars.length === 1 ? "" : "s"}`);
  if (schem) await openLocal(schem);
});

// The link: the address bar follows the view (file, shell, hidden parts, layer mode and the camera once it has been
// moved), written a moment after a change, so a reload or a copied link opens the same view.
let urlTimer = null;
function syncUrl(now = false) {
  clearTimeout(urlTimer);
  const write = () => {
    if (!file) return;
    const u = new URL(location.href), q = u.searchParams;
    // a file from disk cannot be linked: the link then opens the default plan
    if (file.param) q.set("schem", file.param); else q.delete("schem");
    // the dev server reopens the last file from disk by name (reopenLocal)
    if (import.meta.env.DEV && !file.param) q.set("local", file.name); else q.delete("local");
    for (const k of ["minY", "maxY"]) q.delete(k);
    // only what differs from the first load: the hall's roof is hidden by default, so that needs no parameter
    const off = hiddenParts().filter((p) => !(p === "roof" && roofHiddenByDefault())); if (off.length) q.set("hide", off.join(",")); else q.delete("hide");
    if (shell.roof && roofHiddenByDefault()) q.set("roof", "on"); else q.delete("roof");
    // a soloed part is the short form, ?part=name; otherwise the hidden ones are listed
    const solo = soloed(); q.delete("part"); q.delete("hidePart");
    if (solo) q.set("part", solo); else if (hiddenPartSet.size) q.set("hidePart", [...hiddenPartSet].join(","));
    // kinds picked, or hidden; types shown or hidden, whichever list is shorter
    for (const k of ["kind", "hideKind", "type", "hideType"]) q.delete(k);
    if (onlyKinds.size) q.set("kind", [...onlyKinds].join(",")); else if (hiddenKinds.size) q.set("hideKind", [...hiddenKinds].join(","));
    if (hiddenTypes.size) {
      const short = (id) => id.replace(/^minecraft:/, ""), shown = blocks.types.types.filter((t) => !hiddenTypes.has(t.id)).map((t) => short(t.id));
      if (shown.length < hiddenTypes.size) q.set("type", shown.join(",")); else q.set("hideType", [...hiddenTypes].map(short).join(","));
    }
    if (layer.mode !== "all") q.set("layer", `${layer.mode},${layer.cur}`); else q.delete("layer");
    const c = userMoved ? camText() : ""; if (c) q.set("cam", c); else q.delete("cam");
    if (topView.on) q.set("view", `top,${topView.q},${Math.round((camera()?.zoom ?? 1) * 1000) / 1000}`); else q.delete("view");
    // signal digits: in the link while on (a link's own ?digits= stays until it is applied)
    if (redstoneTweaksPack()?.enabled) q.set("digits", "on"); else if (digitsWanted === null) q.delete("digits");
    // the pinned block, world coordinates (a link's ?at= stays until the file is drawn and it is pinned)
    const pc = pinned.cell, [ox, oy, oz] = info.offset;
    if (pc) q.set("at", `${pc.x + ox},${pc.y + oy},${pc.z + oz}`); else if (!pinned.wanted) q.delete("at");
    // commas as themselves (?at=1,2,3, not 1%2C2%2C3): legal in a query and readable in a pasted link
    const s = u.toString().replace(/%2C/gi, ",").replace(/%3A/gi, ":"); if (s !== location.href) history.replaceState(null, "", s);
  };
  if (now) write(); else urlTimer = setTimeout(write, 400);
}
$("copyBlock").onclick = copyBlock;
// Download: a file opened from its address as it is hosted, and the same design in the other formats beside it (a
// share puts the .schem and the .litematic side by side; scripts/share.mjs), each found with a HEAD request and
// fetched only when clicked. A file from disk has none: the visitor has it.
const DOWNLOAD_FORMATS = [".schem", ".litematic", ".nbt"];
let downloadsFor = null;
async function showDownloads(f) {
  const row = $("dlBar"), list = $("dlFormats");
  downloadsFor = f; row.hidden = true; list.replaceChildren();
  if (!f.url) return;
  const href = f.url.href.split(/[?#]/)[0], own = (href.match(/\.[a-z]+$/i)?.[0] ?? "").toLowerCase();
  const stemUrl = own ? href.slice(0, -own.length) : href;
  const found = await Promise.all([own, ...DOWNLOAD_FORMATS.filter((e) => e !== own)].map(async (ext) => {
    if (ext === own) return { ext, url: href, bytes: f.bytes };
    try {
      const r = await fetch(stemUrl + ext, { method: "HEAD" });
      // a host that answers a missing path with the page itself is not a schematic
      return r.ok && !/text\/html/i.test(r.headers.get("content-type") ?? "") ? { ext, url: stemUrl + ext } : null;
    } catch { return null; }
  }));
  if (downloadsFor !== f) return;   // another file was opened meanwhile
  for (const d of found.filter((x) => x && x.ext)) {
    const name = decodeURIComponent(d.url.split("/").pop());
    const b = document.createElement("button"); b.textContent = d.ext; b.title = `Download ${name}`;
    b.onclick = async () => {
      try {
        const blob = d.bytes ? new Blob([d.bytes]) : await (await fetch(d.url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r; })).blob();
        download(blob, name); status(`downloaded ${name}`);
      } catch (e) { status(`${name}: ${e.message}`, "err"); }
    };
    list.append(b);
  }
  row.hidden = !list.children.length;
}
$("copyLink").onclick = async () => {
  if (!file?.param) { status("a file opened from disk cannot be linked: a link could not bring it back"); return; }
  syncUrl(true);
  try { await navigator.clipboard.writeText(location.href); status("link copied"); }
  catch { status("could not copy; the address bar has the link", "err"); }
};
// Keyboard shortcuts (the tooltips name them): F fit, N north, P / I / T camera (Q / E turn the top view, G its grid),
// R roof, 1-4 layer modes, PgUp / PgDn and
// [ ] step a layer, Esc unpins or closes help, H folds the panel, ? opens help. Nothing fires while typing in a box.
addEventListener("keydown", (ev) => {
  if (typing(ev) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key, c = ev.code;
  // Esc closes the About sheet even while the first-visit consent sheet is up (it can be read before agreeing)
  if (k === "Escape" && about.classList.contains("on")) { setAbout(false); ev.preventDefault(); return; }
  if (!$("consent").hidden) return;
  // every shortcut below stops the camera's leftover spin (Esc and help too: a key press means "hold still")
  if (!/^[wasdeqWASDEQ ]$/.test(k) && k !== "Shift") stopMomentum();
  if (k === "PageDown" || k === "[" || c === "BracketLeft") stepLayer(-1);
  else if (k === "PageUp" || k === "]" || c === "BracketRight") stepLayer(1);
  else if (k === "f" || k === "F") fitView();
  else if (k === "n" || k === "N") lookNorth();
  else if (k === "p" || k === "P") setCamera("perspective");
  else if (k === "i" || k === "I") setCamera("isometric");
  else if (k === "t" || k === "T") toggleTop();
  else if (k === "g" || k === "G") setGrid(!topView.grid);
  else if (topView.on && (k === "q" || k === "Q" || k === "e" || k === "E")) { if (!ev.repeat) turnTop(k === "e" || k === "E" ? 1 : -1); }
  else if (k === "r" || k === "R") { if (!$("shell-roof").disabled) $("shell-roof").click(); }
  else if (k === "1") setMode("all"); else if (k === "2") setMode("single"); else if (k === "3") setMode("below"); else if (k === "4") setMode("above");
  else if (k === "h" || k === "H") setCollapsed(!hud.classList.contains("collapsed"));
  else if (k === "c" || k === "C") copyBlock();
  else if (k === "m" || k === "M") mats.toggleSheet();
  else if (k === "?" || (c === "Slash" && ev.shiftKey)) setHelp(!help.classList.contains("on"));
  else if (k === "/") { if ($("blocksGrp").style.display !== "none") { $("blocksGrp").open = true; $("blockFilter").focus(); } }
  else if (k === "x" || k === "X" || k === "k" || k === "K") pinnedBlockKey(k.toLowerCase(), ev.shiftKey);
  else if (k === "Escape") { if (about.classList.contains("on")) setAbout(false); else if (help.classList.contains("on")) setHelp(false); else if (!mats.close()) showBlock(null); }
  else return;
  ev.preventDefault();
});
// WASD fly: W/S along the view direction (kept horizontal), A/D strafe, Space/E up, Shift/Q down; the orbit target
// moves with the camera so dragging still orbits around what is in front of you; the keys work during a drag too
// (orbit or right-drag look while strafing). window.flySpeed = blocks per second.
window.flySpeed = 12;
const keys = new Set();
addEventListener("keydown", (ev) => { if (typing(ev) || ev.ctrlKey || ev.metaKey || !$("consent").hidden) return; keys.add(ev.code); if (ev.code === "Space") ev.preventDefault(); });
addEventListener("keyup", (ev) => keys.delete(ev.code));
addEventListener("blur", () => keys.clear());
let flyLast = performance.now();
(function fly(now) {
  requestAnimationFrame(fly);
  const dt = Math.min(0.1, (now - flyLast) / 1000); flyLast = now;
  if (!renderer || !keys.size) return;
  const cm = renderer.cameraManager, cam = cm.activeCamera?._camera; if (!cam) return;
  const ctl = cm.controls instanceof Map ? cm.controls.get(cm.activeControlKey) : cm.controls?.[cm.activeControlKey];
  const V = cam.position.constructor;
  const fwd = groundForward(cam);
  const right = new V().crossVectors(fwd, new V(0, 1, 0));
  const k = (c) => (keys.has(c) ? 1 : 0);
  // the top view slides the plan (up and down mean nothing there; Q and E turn it), at a speed that suits the zoom:
  // three fifths of the screen's height a second
  const top = topView.on && cam.isOrthographicCamera;
  const move = new V()
    .addScaledVector(fwd, k("KeyW") - k("KeyS"))
    .addScaledVector(right, k("KeyD") - k("KeyA"))
    .add(new V(0, top ? 0 : k("Space") + k("KeyE") - k("ShiftLeft") - k("ShiftRight") - k("KeyQ"), 0));
  if (move.lengthSq() === 0) return;
  const speed = top ? Math.max(4, (0.6 * (cam.top - cam.bottom)) / cam.zoom) : window.flySpeed;
  move.normalize().multiplyScalar(speed * dt);
  cam.position.add(move);
  if (ctl?.target) { ctl.target.add(move); ctl.update?.(); }
  userMoved = true; noteInput();
})(flyLast);

// ---- agents (AGENTS.md) ---------------------------------------------------------------------------------------------
// A render settles 700 ms later, once the renderer's own deferred refits (and restoreSoon's) are over, so a camera
// moved then stays where it is put. A link's ?focus= is applied at that point, then blockscope.ready() and nextRender()
// resolve with the page's state.
function settleSoon() {
  clearTimeout(renders.timer);
  renders.timer = setTimeout(() => {
    renders.settled++;
    if (focusWanted) {
      const w = focusWanted; focusWanted = null;
      try { if (w.block) focusBlockNow(...w.block); else focusPartNow(w.part); } catch (e) { status(`?focus=${w.block ? w.block.join(",") : w.part}: ${e.message}`, "err"); }
    }
    const state = agentState();
    for (const w of renders.waiters.splice(0)) w.resolve(state);
  }, 700);
}
// An error before the renderer exists (the file could not be read) ends the wait for the first render; later ones
// (a pack that fails, say) show in the state, and a wait that outlasts them times out with the status line.
function failWaiters(text) {
  if (renders.settled || renderer) return;
  renders.failed = text;   // for a ready() that comes after it
  for (const w of renders.waiters.splice(0)) w.reject(new Error(text));
}
function waitSettle(timeout) {
  return new Promise((resolve, reject) => {
    const w = { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } };
    const t = setTimeout(() => { renders.waiters.splice(renders.waiters.indexOf(w) >>> 0, 1); reject(new Error(`no render within ${timeout} ms; status: ${$("status").textContent}`)); }, timeout);
    renders.waiters.push(w);
  });
}
/** The first render, settled (at once when it already has); the first visit's pack download can take minutes. */
const ready = (timeout = 300000) => (renders.settled ? Promise.resolve(agentState())
  : renders.failed && !renderer ? Promise.reject(new Error(renders.failed)) : waitSettle(timeout));
const toWorld = ([x, y, z]) => [x + info.offset[0], y + info.offset[1], z + info.offset[2]];
/** What the page shows, in world coordinates: the file, its size and origin (the world position of file cell 0,0,0),
 *  the parts hidden, the layers drawn, the pinned block, the camera, the pack and the status line. */
function agentState() {
  const cam = camera(), ctl = controls(), r = (v) => (v ? [v.x, v.y, v.z].map((n) => Math.round(n * 100) / 100) : null);
  return {
    file: schemName || null, status: $("status").textContent, error: $("status").className === "err", agent: AGENT,
    size: [info.width, info.height, info.length], origin: [...info.offset],
    parts: info.parts.length, hiddenParts: [...hiddenPartSet], layers: { mode: layer.mode, fileY: shownRange() },
    kinds: { only: [...onlyKinds], hidden: [...hiddenKinds, ...SHELL_KEYS.filter((k) => !shell[k])] }, hiddenTypes: [...hiddenTypes],
    pinned: pinned.cell ? toWorld([pinned.cell.x, pinned.cell.y, pinned.cell.z]) : null,
    camera: cam ? { position: r(cam.position), target: r(ctl?.target), view: topView.on ? "top" : camPreset } : null,
    pack: currentPack, unknownBlocks: unknown.size, url: location.href,
  };
}
const partList = () => info.parts.map((p) => ({ name: p.name, blocks: p.count, hidden: hiddenPartSet.has(p.name) }));
function findPart(name) {
  const n = String(name), p = info.parts.find((q) => q.name === n) ?? info.parts.find((q) => q.name.toLowerCase() === n.toLowerCase());
  if (p) return p;
  const names = info.parts.map((q) => q.name);
  throw new Error(`${schemName} has no part "${n}"; ${names.length ? `its parts: ${names.slice(0, 40).join(", ")}${names.length > 40 ? ", …" : ""}` : "it has no parts (no metadata)"}`);
}
function focusPartNow(name, { highlight = false } = {}) {
  const p = findPart(name), box = flyToPart(p.name);
  if (!box) throw new Error(`part ${p.name} has no blocks to fly to`);
  revealPartRow(p.name); if (highlight) showGhost({ axis: "part", key: p.name });
  return { part: p.name, blocks: p.count, from: toWorld(box.min), to: toWorld(box.max) };
}
/** Flies to a part (shown first if it was hidden; `solo` hides every other part), lights it up when asked. */
async function focusPart(name, { solo = false, highlight = false } = {}) {
  await ready();
  const p = findPart(name);
  const want = solo ? info.parts.filter((q) => q.name !== p.name).map((q) => q.name) : [...hiddenPartSet].filter((n) => n !== p.name);
  if (want.length !== hiddenPartSet.size || want.some((n) => !hiddenPartSet.has(n))) {
    hiddenPartSet.clear(); for (const n of want) hiddenPartSet.add(n); renderParts();
    // both: the reload sets its view-restore timers after it returns, and the flight below cancels them
    const settled = waitSettle(120000);
    await reloadLayers(solo ? `only ${p.name}` : `with ${p.name}`);
    await settled;
  }
  return focusPartNow(p.name, { highlight });
}
const kindList = () => (blocks.kinds?.listed ?? []).map((k) => ({ kind: k, name: kindName(k), blocks: kindCount(k), hidden: !kindShown(k) }));
const typeList = () => (blocks.types?.types ?? []).map((t) => ({ id: t.id, name: t.name, mod: t.mod, blocks: t.count, hidden: hiddenTypes.has(t.id) }));
/** Flies to a row's blocks (a kind or a type), selects its row and lights it up when asked. */
function focusRowNow(row, label, highlight) {
  const box = flyToRow(row); if (!box) throw new Error(`${label} has no blocks to fly to`);
  revealBlockRow(row.axis, row.key); if (highlight) showGhost(row);
  return { [row.axis]: row.key, blocks: cellsOfRow(row).length, from: toWorld(box.min), to: toWorld(box.max) };
}
/** Flies to a kind's blocks (shown first if hidden; `solo`: only that kind), lights them up when asked. */
async function focusKind(key, { solo = false, highlight = false } = {}) {
  await ready();
  const k = String(key).toLowerCase(), def = KINDS.find((x) => x.key === k || x.name.toLowerCase() === k);
  if (!def || !kindCount(def.key)) throw new Error(`${schemName} has no blocks of kind "${key}"; its kinds: ${kindList().map((x) => x.kind).join(", ") || "none"}`);
  if (solo ? soloedKind() !== def.key : !kindShown(def.key)) { const settled = waitSettle(120000); await (solo ? soloKind(def.key) : toggleKind(def.key)); await settled; }
  return focusRowNow({ axis: "kind", key: def.key }, def.name, highlight);
}
/** Flies to a type's blocks (an id; "stone" is minecraft:stone), as focusKind. */
async function focusType(id, { solo = false, highlight = false } = {}) {
  await ready();
  const t = typeOf(typeId(id));
  if (!t) throw new Error(`${schemName} has no ${typeId(id)}; its types, most blocks first: ${typeList().slice(0, 30).map((x) => x.id).join(", ")}`);
  if (solo ? soloedType() !== t.id : hiddenTypes.has(t.id)) { const settled = waitSettle(120000); await (solo ? soloType(t.id) : toggleType(t.id)); await settled; }
  return focusRowNow({ axis: "type", key: t.id }, t.id, highlight);
}
/** X hides the pinned block's type (Shift+X shows it alone, again: every type); K picks its kinds in the Blocks list. */
function pinnedBlockKey(key, shift) {
  const c = pinned.cell;
  if (!c || !file) { status(`click a block first, then ${key.toUpperCase()} ${key === "x" ? "hides its type" : "shows its kinds"}`); return; }
  const i = file.schem.index(c.x, c.y, c.z), t = blocks.types.types[blocks.types.ofPalette[file.schem.data[i]] - 1];
  if (key === "x") { if (!t) return; if (shift) soloType(t.id); else toggleType(t.id); return; }
  const ks = kindsOfMask(blocks.kinds.mask[i]).filter((x) => blocks.kinds.shown && blocks.kinds.listed.includes(x));
  if (!ks.length) { status(`${t?.name ?? "this block"} is of no kind listed here`); return; }
  revealBlockRows(ks.map((x) => ["kind", x]));
}
function focusBlockNow(wx, wy, wz, { radius = 3, pin = true } = {}) {
  const [ox, oy, oz] = info.offset, c = [wx - ox, wy - oy, wz - oz];
  if (![wx, wy, wz].every(Number.isInteger) || c.some((v, i) => v < 0 || v >= [info.width, info.height, info.length][i])) {
    throw new Error(`${wx},${wy},${wz} is outside ${schemName} (world ${info.offset.join(",")} to ${toWorld([info.width - 1, info.height - 1, info.length - 1]).join(",")})`);
  }
  flyToBox(c.map((v) => v - radius), c.map((v) => v + radius));
  if (pin) pinWorld(wx, wy, wz);
  const so = renderer.schematicManager.getFirstSchematic();
  return so ? describeBlock(so, ...c) : null;
}
/** Flies to a block (world coordinates), `radius` blocks of it around it, and pins it as a click would. */
const focusBlock = async (x, y, z, opts) => { await ready(); return focusBlockNow(x, y, z, opts); };
/** The blocks whose id[state] contains `query` (or matches it, a RegExp), in world coordinates, with their part. */
function findBlocks(query, { limit = 200 } = {}) {
  const s = file?.schem; if (!s) return { total: 0, blocks: [] };
  const test = query instanceof RegExp ? (k) => query.test(k) : (k) => k.includes(String(query));
  const want = new Set(); s.keys.forEach((k, i) => { if (k && test(k)) want.add(i); });
  const blocks = []; let total = 0;
  for (let i = 0; i < s.data.length; i++) {
    if (!want.has(s.data[i])) continue;
    total++; if (blocks.length >= limit) continue;
    const [x, y, z] = s.cellOf(i), m = s.metaAt(meta, x, y, z);
    blocks.push({ at: toWorld([x, y, z]), block: s.keys[s.data[i]], part: m ? partOf(m) : null });
  }
  return { total, blocks };
}

// ---- console and test helpers ---------------------------------------------------------------------------------------
const blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
// shot([x,y,z], [tx,ty,tz]) places the orbit camera (file block coordinates: x, z as in the file, y from the bottom
// layer) and returns a PNG data URL; inspectAt(x, y, z) (world coordinates) pins a block as a click would.
window.blockscope = {
  get renderer() { return renderer; }, get file() { return file; }, get packReport() { return packReport; }, get currentPack() { return currentPack; },
  unknown: () => [...unknown.keys()],
  status: () => $("status").textContent,
  screenshot: async (w, h) => blobToDataUrl(await screenshot(w, h)),
  async shot(pos, target, width = 1600, height = 1000) {
    const cam = camera(), ctl = controls(), g = group(); const o = g ? g.position : { x: 0, y: 0, z: 0 };
    const w = (p) => [p[0] + o.x, p[1] + o.y, p[2] + o.z];
    const [px, py, pz] = w(pos), [tx, ty, tz] = w(target);
    if (ctl?.target) { ctl.target.set(tx, ty, tz); cam.position.set(px, py, pz); ctl.update?.(); } else { cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); }
    cam.updateProjectionMatrix(); userMoved = true;
    await sleep(300);
    return blobToDataUrl(await screenshot(width, height));
  },
  fit: fitView,
  describe: (x, y, z) => { const so = renderer?.schematicManager.getFirstSchematic(); return so ? describeBlock(so, x, y, z) : null; },
  pick: (ndcX, ndcY) => {
    const so = renderer?.schematicManager.getFirstSchematic(), hit = hitUnderPointer(ndcX, ndcY), p = cellOfHit(hit);
    const names = []; for (let o = hit?.object; o && o !== group(); o = o.parent) if (o.name) names.push(o.name);
    return so && p ? { ...describeBlock(so, p.x, p.y, p.z), hitMesh: names.join(" < ") } : null;
  },
  async captureBuild(opts = {}) { Object.assign(window.buildGif, { download: false }, opts); const r = await captureBuild(); return r && { ...r, dataUrl: await blobToDataUrl(lastGif) }; },
  hitUnderPointer, schematicMeshes, controls, camera,
  // for agents (AGENTS.md): wait for a render, read the state, find and frame blocks and parts
  ready, nextRender: (timeout = 120000) => waitSettle(timeout), state: agentState, parts: partList, findBlocks, focusPart, focusBlock,
  kinds: kindList, types: typeList, focusKind, focusType,
  // the materials list (AGENTS.md): list({ preset, group }) as the sheet's JSON export, setHave(item, "2s"), state()
  materials: { list: (o) => mats.list(o), setHave: (id, v) => mats.setHave(id, String(v)), state: () => mats.state(), toggle: () => mats.toggleSheet() },
};
window.inspectAt = pinWorld;

// ---- start ----------------------------------------------------------------------------------------------------------
showShellState(); renderParts(); renderBlocks(); renderPackInfo();
{
  const param = params.get("schem") ?? DEFAULT_PLAN;
  const local = import.meta.env.DEV && !params.get("schem") ? params.get("local") : null;
  let url = null;
  try { url = param ? resolvePlan(param) : null; } catch (e) { status(e.message, "err"); }
  if (local && (await reopenLocal(local))) { /* the file from disk, again */ }
  else if (url) {
    status(`loading ${param}…`, "busy");
    try { await openFile({ ...(await loadPlan(url)), param }, { fromUrl: true }); }
    catch (e) { status(`${e.message}; open or drop a schematic`, "err"); }
  } else if (!param) status("open or drop a schematic (.schem, .schematic, .litematic, .nbt)");
}
