// The Materials group in the panel and the sheet beside it: what the blocks in view take, as placed, as gathered or
// down to raw materials, with what the person already has taken off. The scope is the view's (the layers, the shell
// and the parts shown) unless it is pinned. What the person has, ticked off and broken down by hand is kept per file
// (by its hash) in this browser; the list's settings are kept for every file.
import { countScope, planGroups, totalsOf, nameOf, altText, packText, parseHave, noteOf, recipeOf, paletteItems, blockItems, lookupOf, wouldLoop, fmt, HOW, SHULKER, INVENTORY } from "./engine.js";
import { iconUrl, resetIcons } from "./icons.js";
import { matId } from "../framed.js";
import { partOf } from "../parts.js";
import { esc } from "../html.js";

const PREFS = "blockscope.mats";
const fileKey = (hash) => `blockscope.mats.${hash}`;
const EMPTY = () => ({ have: {}, done: {}, open: {}, pick: {} });
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) ?? "null"); return v && typeof v === "object" ? { ...d, ...v } : { ...d }; } catch { return { ...d }; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const PRESET_NAME = { placed: "as placed", gather: "to gather", raw: "raw materials" };
const FLUID_NOTE = { "minecraft:water_bucket": "a bucket per source block, or two buckets and an infinite source", "minecraft:lava_bucket": "a bucket per source block" };
const HIGHLIGHT_MAX = 60000;

/**
 * host: { $ (by id), file() ({ schem, hash, name } or null), scope() ({ lo, hi, hidden, chips }), meta(), parts(),
 * worldY(y), highlight(cells or null), soloPart(name), singleLayer(fileY), status(text, kind), download(blob, name),
 * iconsChanged() (the recipe book arrived: icons can be drawn), kindGroups() ({ of(i), label(g), kindKey(g) }: each
 * block's first kind, or null where kinds are not listed), soloKind(key) }.
 */
export function createMaterials(host) {
  const { $ } = host;
  const prefs = load(PREFS, { preset: "gather", units: "stacks", compact: false, hideDone: false, group: "none", tab: "list", sheet: false });
  let fs = EMPTY(), fsKey = null;
  let book = null, lookup = null, readTexture = null, bookState = "none";   // none | loading | ready | missing
  let pinned = null, result = null, timer = 0, stale = false;
  let partCache = { schem: null }, framedCache = { schem: null, cells: [] };
  const persist = () => { save(PREFS, prefs); if (fsKey) save(fsKey, fs); };
  // the rollup in effect: as placed until the recipes have arrived
  const rollup = () => (book ? prefs.preset : "placed");

  // ---- working it out -----------------------------------------------------------------------------------------------
  function groupFn(schem) {
    if (prefs.group === "layer") return { of: (i) => Math.floor(i / schem.perLayer), label: (y) => `y ${host.worldY(y)}` };
    // each block in the first of its kinds (the page's: kinds.js firstKinds)
    if (prefs.group === "kind") return host.kindGroups?.() ?? null;
    if (prefs.group !== "part") return null;
    const meta = host.meta(); if (!meta) return null;
    if (partCache.schem !== schem || partCache.meta !== meta) {
      const names = host.parts().map((p) => p.name), at = new Map(names.map((n, i) => [n, i]));
      const idx = new Int16Array(schem.data.length).fill(-1);
      const recordAt = schem.recordReader(meta);
      for (let i = 0; i < schem.data.length; i++) { if (schem.air.has(schem.data[i])) continue; const p = partOf(recordAt(i)); if (p && at.has(p)) idx[i] = at.get(p); }
      partCache = { schem, meta, names, idx };
    }
    const { names, idx } = partCache, last = names.length;
    return { of: (i) => (idx[i] < 0 ? last : idx[i]), label: (g) => names[g] ?? "no part", partName: (g) => names[g] ?? null };
  }
  function compute() {
    const f = host.file(); if (!f?.schem) { result = null; return; }
    const schem = f.schem, sc = pinned ?? host.scope(), grouping = groupFn(schem);
    if (framedCache.schem !== schem) framedCache = { schem, cells: schem.framedCells() };
    const groups = countScope(schem, { lo: sc.lo, hi: sc.hi, hidden: sc.hidden, lookup, groupOf: grouping?.of ?? null, framed: framedCache.cells, matItem: (t) => { const id = matId(t); return id && (!book || id in book.items) ? id : null; } });
    const prefer = new Map(), fluids = new Map(), unknown = new Map(), extraIds = new Set();
    let blocks = 0, wet = 0;
    for (const g of groups.values()) {
      blocks += g.blocks; wet += g.wet;
      for (const [k, n] of g.placed) prefer.set(k, (prefer.get(k) ?? 0) + n);
      for (const [k, n] of g.fluids) fluids.set(k, (fluids.get(k) ?? 0) + n);
      for (const [k, n] of g.unknown) unknown.set(k, (unknown.get(k) ?? 0) + n);
      for (const e of g.extras) extraIds.add(e.item);
    }
    const demandOf = (g) => [...[...g.placed].map(([item, n]) => ({ item, n, from: item })), ...g.extras];
    // in groups, in their order (the bottom layer, the first part takes what the person has first); the whole scope
    // at once for the tree and the hover
    const keys = grouping ? [...groups.keys()].sort((a, b) => a - b) : [...groups.keys()];
    const planned = planGroups(book, keys.map((key) => ({ key, demand: demandOf(groups.get(key)) })), { preset: rollup(), open: fs.open, pick: fs.pick, done: fs.done, have: fs.have, prefer });
    let sections;
    if (grouping) sections = planned.sections.map((s) => ({ ...s, label: grouping.label(s.key), part: grouping.partName?.(s.key) ?? null, kind: grouping.kindKey?.(s.key) ?? null, layer: prefs.group === "layer" ? s.key : null, blocks: groups.get(s.key).blocks }));
    else if (prefs.group === "mod") {
      const byNs = new Map();
      for (const n of planned.sections[0]?.leaves ?? []) { const ns = n.id.split(":")[0]; (byNs.get(ns) ?? byNs.set(ns, []).get(ns)).push(n); }
      sections = [...byNs.keys()].sort((a, b) => (a === "minecraft" ? -1 : b === "minecraft" ? 1 : a < b ? -1 : 1)).map((ns) => ({ key: ns, label: ns === "minecraft" ? "Minecraft" : ns, leaves: byNs.get(ns), blocks: null }));
    } else sections = [{ key: "all", label: null, leaves: planned.sections[0]?.leaves ?? [], blocks }];
    // every item once, summed over the groups (the panel's top rows)
    const merged = new Map();
    for (const n of planned.sections.flatMap((s) => s.leaves)) { let m = merged.get(n.id); if (!m) merged.set(n.id, (m = { ...n, net: 0, have: 0, gross: 0 })); m.net += n.net; m.have += n.have; m.gross += n.gross; }
    result = { schem, scope: sc, sections, all: planned.all, leaves: [...merged.values()].sort((a, b) => b.net - a.net || b.gross - a.gross), fluids, wet, unknown, blocks, prefer, extraIds, totals: planned.totals, grossTotals: planned.gross, grouping };
  }
  // a redraw while the person is typing in a Have box waits for them to leave it, so a layer change or the recipes
  // arriving never throw away what they typed
  const typingHave = () => document.activeElement?.matches?.("#matsList input.have") ?? false;
  function recompute() { compute(); render(); }
  const soon = () => { clearTimeout(timer); timer = setTimeout(recompute, 120); };

  // ---- the panel's group ------------------------------------------------------------------------------------------
  function renderControls() {
    // both rollup strips (the group's and the sheet's) show the rollup in effect; Gather and Raw wait for the recipes
    for (const id of ["matsPreset", "matsPreset2"]) for (const b of $(id).querySelectorAll("button[data-v]")) {
      b.setAttribute("aria-pressed", String(b.dataset.v === rollup()));
      b.disabled = b.dataset.v !== "placed" && bookState !== "ready";
      b.title = b.disabled ? `${b.dataset.v === "gather" ? "Gather" : "Raw"} needs the recipes, which come with the pack${bookState === "missing" ? ": rebuild it (File, Resource pack)" : ""}` : b.dataset.title ?? b.title;
    }
    for (const b of $("matsUnits").querySelectorAll("button[data-v]")) b.setAttribute("aria-pressed", String(b.dataset.v === prefs.units));
    $("matsCompact").setAttribute("aria-pressed", String(prefs.compact)); $("matsHideDone").setAttribute("aria-pressed", String(prefs.hideDone));
    $("matsTabList").setAttribute("aria-pressed", String(prefs.tab === "list")); $("matsTabTree").setAttribute("aria-pressed", String(prefs.tab === "tree"));
    $("matsPin").setAttribute("aria-pressed", String(!!pinned));
    $("matsOpen").setAttribute("aria-pressed", String(prefs.sheet));
    $("matsGroup").value = prefs.group; $("matsGroup").disabled = prefs.tab === "tree";
    $("matsGroup").querySelector('[value="part"]').disabled = !host.meta() || !host.parts().length;
    $("matsGroup").querySelector('[value="kind"]').disabled = !host.kindGroups?.();
    $("matsNote").textContent = bookState === "ready" ? "" : bookState === "loading" ? "reading the recipes…" : bookState === "missing" ? "no recipes in this pack: rebuild it (File, Resource pack) for Gather and Raw" : "the recipes come with the pack";
  }
  function renderGroup() {
    const r = result, sum = $("matsSum"), top = $("matsTop");
    if (!r) { sum.textContent = ""; top.innerHTML = `<p class="empty">Open a schematic to see what it takes.</p>`; $("matsGrpScope").textContent = ""; return; }
    const t = r.totals, got = r.grossTotals.items - t.items, firsts = r.leaves;
    sum.textContent = r.leaves.length ? `${fmt(t.items)} · ${t.kinds} different${got ? ` · ${fmt(got)} in hand` : ""}` : "nothing";
    $("matsGrpScope").innerHTML = chipsHtml();
    top.innerHTML = firsts.length ? firsts.slice(0, 6).map((n) => `<div class="mmini" data-id="${esc(n.id)}" data-g="all" title="${esc(nameOf(n.id, book))}: ${fmt(n.net)} to get${n.have ? ` (${fmt(n.have)} in hand)` : ""}"><img class="ic" alt="" data-ic="${esc(n.id)}"><span class="nm">${esc(nameOf(n.id, book))}</span><span class="c">${fmt(n.net)}</span><span class="pk">${esc(packText(n.net, n.id, { units: "stacks" }))}</span></div>`).join("") +
      (firsts.length > 6 ? `<div class="mmini more" data-more="1"><span></span><span class="nm">${firsts.length - 6} more items…</span><span></span><span></span></div>` : "")
      : `<p class="empty">No blocks in view.</p>`;
    fillIcons(top);
  }
  function chipsHtml() {
    const sc = pinned ?? host.scope();
    return [pinned ? `<span class="chip on" title="The list keeps counting this scope while you move the view; click Pin again to follow the view">pinned</span>` : "", ...sc.chips.map((c) => `<span class="chip">${esc(c)}</span>`)].join("");
  }

  // ---- the sheet ----------------------------------------------------------------------------------------------------
  const HEAD = `<div class="mh"><span></span><span></span><span>Item</span><span class="r" title="Still to get: needed less what you have">Need</span><span class="r hv" title="What you have: a number, or 2s (stacks), 1sb (shulker boxes), 3b (9-to-1 blocks)">Have</span><span class="r pk">Packed</span><span title="Ticked: you have all of it">✓</span></div>`;
  function rowHtml(n, { group = "all", depth = 0, forQty = null, tree = false } = {}) {
    const id = n.id, name = nameOf(id, book);
    const recipe = recipeOf(book, id, fs.pick), canBreak = !!recipe && bookState === "ready";
    const ns = id.startsWith("minecraft:") ? "" : id.split(":")[0];
    const note = noteOf(book, id, n, { preset: rollup() }), alt = altText(book, n);
    const done = !!fs.done[id], short = n.have > 0 && n.net > 0;
    const how = n.broken && recipe ? `<span class="via">${esc(viaText(recipe, n))}</span>` : "";
    const pick = tree && n.broken && (book?.recipes?.[id]?.length ?? 0) > 1 ? recipeSelect(id) : "";
    const tg = (tree || !n.broken) && canBreak ? `<button class="tg" data-tg="${esc(id)}" title="${n.broken ? `Get ${esc(name)} as it is instead of making it` : `Make ${esc(name)}: list what it is made of instead`}">${n.broken ? "&#9662;" : "&#9656;"}</button>` : `<span class="tg"></span>`;
    const haveVal = fs.have[id] ? fmt(fs.have[id]) : "";
    const packed = packText(done ? n.gross : n.net, id, { units: prefs.units, compact: prefs.compact, book });
    return `<div class="mrow${done ? " done" : ""}${n.broken ? " made" : ""}" data-id="${esc(id)}" data-g="${esc(String(group))}" style="--d:${depth}">` +
      `${tg}<img class="ic" alt="" data-ic="${esc(id)}">` +
      `<span class="nm" title="${esc(`${name}${ns ? ` (${ns})` : ""}${alt ? `, ${alt}` : ""}: ${fmt(n.gross)} needed in all${n.have ? `, ${fmt(n.have)} in hand` : ""}${n.spare ? `, ${fmt(n.spare)} spare from whole crafts` : ""}`)}">${esc(name)}${ns ? `<span class="ns">${esc(ns)}</span>` : ""}${forQty !== null ? `<span class="for">${fmt(forQty)} for this</span>` : ""}${how}${pick}${alt && !n.broken ? `<span class="via">${esc(alt)}</span>` : ""}${!n.broken && note ? `<span class="note">${esc(note)}</span>` : ""}</span>` +
      `<span class="need${short ? " short" : ""}">${done ? "✓" : fmt(n.net)}</span>` +
      `<input class="have" data-have="${esc(id)}" value="${haveVal}" placeholder="–" inputmode="text" autocomplete="off" spellcheck="false" aria-label="have of ${esc(name)}"${done ? " disabled" : ""}>` +
      `<span class="pk" title="${esc(packed)}">${esc(packed)}</span>` +
      `<input type="checkbox" class="got" data-done="${esc(id)}" aria-label="have all of ${esc(name)}"${done ? " checked" : ""}></div>`;
  }
  function viaText(recipe, n) {
    const [how, y] = recipe;
    return `${HOW[how] ?? how}${n.crafts ? `, ${fmt(n.crafts)} ${n.crafts === 1 ? "time" : "times"}${y > 1 ? ` (${y} each)` : ""}` : ""}`;
  }
  function recipeSelect(id) {
    const list = book.recipes[id], cur = fs.pick[id] ?? book.best[id];
    return `<select class="rc" data-pick="${esc(id)}" title="Which recipe">${list.map((r, i) => `<option value="${i}"${i === cur ? " selected" : ""}>${esc(`${HOW[r[0]] ?? r[0]}: ${r[2].map(([k, c]) => `${c > 1 ? `${c} ` : ""}${nameOf(k, book)}`).join(" + ")}${r[1] > 1 ? ` → ${r[1]}` : ""}`)}</option>`).join("")}</select>`;
  }
  const show = (n, q) => (!q || nameOf(n.id, book).toLowerCase().includes(q) || n.id.includes(q)) && !(prefs.hideDone && (fs.done[n.id] || n.net === 0));
  const plainRow = (icon, name, n, note = "", cls = "") => `<div class="mrow plain"><span class="tg"></span>${icon}<span class="nm${cls}">${esc(name)}${note ? `<span class="note">${esc(note)}</span>` : ""}</span><span class="need">${fmt(n)}</span><span></span><span class="pk"></span><span></span></div>`;

  function renderSheet() {
    const r = result, list = $("matsList");
    $("matsScope").innerHTML = chipsHtml();
    if (!r) { list.innerHTML = `<p class="empty">Open a schematic to see what it takes.</p>`; $("matsTotals").textContent = ""; return; }
    const t = r.totals, g = r.grossTotals, got = g.items - t.items;
    $("matsTotals").innerHTML = `<span><b>${fmt(r.blocks)}</b> blocks</span><span><b>${fmt(t.items)}</b> ${got ? "to get" : "items"} · <b>${t.kinds}</b> different</span><span><b>${fmt(t.stacks)}</b> stacks</span><span title="${SHULKER} stacks a box"><b>${t.shulkers.toFixed(1)}</b> shulker boxes</span><span title="${INVENTORY} slots an inventory"><b>${t.trips.toFixed(1)}</b> inventories</span>${got ? `<span class="ok"><b>${fmt(got)}</b> of ${fmt(g.items)} in hand</span>` : ""}`;
    const q = $("matsFilter").value.trim().toLowerCase();
    let html = "";
    if (prefs.tab === "tree") html = treeHtml(q);
    else {
      // as placed, what no block is placed from (a sign's dye, glow ink and wax, a framed drawer's materials) is a
      // section of its own, so the list above it reads as the blocks themselves
      const placedOnly = rollup() === "placed" && !r.grouping && prefs.group !== "mod";
      const sections = placedOnly && r.sections[0].leaves.some((n) => !r.prefer.has(n.id)) ? [{ ...r.sections[0], label: "To place", leaves: r.sections[0].leaves.filter((n) => r.prefer.has(n.id)) }, { key: "all", label: "Also needed: not placed", blocks: null, leaves: r.sections[0].leaves.filter((n) => !r.prefer.has(n.id)), extra: true }] : r.sections;
      for (const s of sections) {
        if (s.extra && !s.leaves.length) continue;
        const rows = s.leaves.filter((n) => show(n, q));
        if (s.label !== null) {
          const act = s.part ? `<button class="act" data-solo="${esc(s.part)}" title="Show only this part in the view">solo</button>` : s.kind ? `<button class="act" data-kind="${esc(s.kind)}" title="Show only this kind in the view">solo</button>` : s.layer !== null && s.layer !== undefined ? `<button class="act" data-layer="${s.layer}" title="Show only this layer in the view">single</button>` : "";
          html += `<div class="msec"><span class="t">${esc(s.label)}</span><span class="c">${s.blocks !== null ? `${fmt(s.blocks)} blocks · ` : ""}${fmt(totalsOf(s.leaves).items)} items</span>${act}</div>`;
        }
        if (!rows.length) { if (s.label === null) html += `<p class="empty">${q ? "Nothing matches." : prefs.hideDone ? "You have everything on this list." : "No blocks in view."}</p>`; continue; }
        html += HEAD + rows.map((n) => rowHtml(n, { group: s.key })).join("");
      }
      if (r.fluids.size || r.wet) {
        html += `<div class="msec"><span class="t">Fluids</span><span class="c">not in the totals</span></div>` +
          [...r.fluids].map(([id, n]) => plainRow(`<img class="ic" alt="" data-ic="${esc(id)}">`, `${nameOf(id, book).replace(/ Bucket$/, "")} source blocks`, n, FLUID_NOTE[id] ?? "")).join("") +
          (r.wet ? plainRow(`<img class="ic" alt="" data-ic="minecraft:water_bucket">`, "Waterlogged blocks", r.wet, "a water bucket each, or water placed into them") : "");
      }
      if (r.unknown.size) html += `<div class="msec warn"><span class="t">No item found</span><span class="c">not in the totals</span></div>` + [...r.unknown].sort((a, b) => b[1] - a[1]).map(([id, n]) => plainRow(`<span class="ic"></span>`, id, n, "", " mono")).join("");
    }
    list.innerHTML = html;
    fillIcons(list);
  }
  function treeHtml(q) {
    const r = result, p = r.all, out = [];
    // a root is what the blocks are placed from (and a sign's dye or wax); its ingredients follow it while it is made
    const roots = [...p.nodes.values()].filter((n) => r.prefer.has(n.id) || r.extraIds.has(n.id)).sort((a, b) => b.gross - a.gross);
    // "for this": what this branch alone takes (its own whole crafts), where the row's Need is the item's total
    const walk = (n, depth, forQty, seen, qty) => {
      out.push(rowHtml(n, { depth, forQty, tree: true }));
      if (!n.broken || !n.crafts || depth > 8 || qty <= 0) return;
      const crafts = Math.ceil(qty / n.recipe[1]);
      for (const [k, c] of n.recipe[2]) { const child = p.nodes.get(childId(k, p)); if (child && !seen.has(child.id)) walk(child, depth + 1, crafts * c, new Set([...seen, child.id]), crafts * c); }
    };
    for (const n of roots) if (!q || subtreeMatches(n, q, p, new Set())) walk(n, 0, null, new Set([n.id]), n.net);
    return out.length ? HEAD + out.join("") : `<p class="empty">${q ? "Nothing matches." : "No blocks in view."}</p>`;
  }
  // a recipe's ingredient as the plan counts it: a set (any planks) is the member standing in for it
  const childId = (k, p) => (k.startsWith("#") ? [...p.nodes.values()].find((x) => x.anyOf?.includes(k))?.id ?? k : k);
  function subtreeMatches(n, q, p, seen) {
    if (nameOf(n.id, book).toLowerCase().includes(q)) return true;
    if (!n.broken || seen.has(n.id)) return false; seen.add(n.id);
    return n.recipe[2].some(([k]) => { const c = p.nodes.get(childId(k, p)); return c && subtreeMatches(c, q, p, seen); });
  }
  function fillIcons(root) {
    for (const img of root.querySelectorAll("img[data-ic]")) {
      const id = img.dataset.ic;
      iconUrl(id, book?.items?.[id]?.[1], readTexture).then((u) => { if (u) img.src = u; });
    }
  }
  function render() {
    renderControls(); renderGroup();
    if (!prefs.sheet) return;
    if (typingHave()) { stale = true; return; }
    stale = false; renderSheet();
  }

  // ---- hovering: the blocks a row stands for light up; a made item says what uses it -------------------------------
  function cellsFor(id, groupKey) {
    const r = result; if (!r) return [];
    const roots = r.all.roots.get(id) ?? new Set([id]);
    const want = new Set();
    paletteItems(r.schem, lookup).forEach((it, p) => { if (it?.items?.some(([k]) => roots.has(k)) || it?.fluid === id) want.add(p); });
    if (!want.size) return [];
    const s = r.schem, sc = r.scope, per = s.perLayer, start = sc.lo * per, end = Math.min(s.height, sc.hi + 1) * per;
    const g = groupKey !== "all" && r.grouping && prefs.tab === "list" ? Number(groupKey) : null;
    const out = [];
    for (let i = start; i < end && out.length < HIGHLIGHT_MAX; i++) {
      if (!want.has(s.data[i]) || sc.hidden.has(i)) continue;
      if (g !== null && !Number.isNaN(g) && r.grouping.of(i) !== g) continue;
      out.push(s.cellOf(i));
    }
    return out;
  }
  function onOver(ev) {
    const row = ev.target.closest("[data-id]"); if (!row || row.dataset.hover === "1") return;
    for (const el of ev.currentTarget.querySelectorAll("[data-hover]")) delete el.dataset.hover;
    row.dataset.hover = "1";
    const id = row.dataset.id; host.highlight(cellsFor(id, row.dataset.g));
    const tip = $("matsTip"), uses = result?.all.uses.get(id);
    if (!uses?.size || !ev.currentTarget.closest("#mats")) { tip.classList.remove("on"); return; }
    // what the item goes into, and how many of it the blocks take as they are
    const list = [...uses].sort((a, b) => b[1] - a[1]), placed = result.prefer.get(id) ?? 0;
    const lines = [...(placed ? [[placed, "placed as they are"]] : []), ...list.slice(0, 10).map(([k, q]) => [q, nameOf(k, book)])];
    tip.innerHTML = `<b>${esc(nameOf(id, book))}</b> · ${fmt(result.all.nodes.get(id)?.gross ?? 0)} in all<div class="u">${lines.map(([q, t]) => `<span>${fmt(q)}</span><span>${esc(t)}</span>`).join("")}${list.length > 10 ? `<span></span><span class="dim">and ${list.length - 10} more</span>` : ""}</div>`;
    tip.classList.add("on");
    const box = $("mats").getBoundingClientRect(), rr = row.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(rr.left - box.left + 150, box.width - tip.offsetWidth - 8))}px`;
    const below = rr.bottom - box.top + 4;
    tip.style.top = `${below + tip.offsetHeight > box.height - 8 ? rr.top - box.top - tip.offsetHeight - 4 : below}px`;
  }
  function onLeave(ev) { for (const el of ev.currentTarget.querySelectorAll("[data-hover]")) delete el.dataset.hover; host.highlight(null); $("matsTip").classList.remove("on"); }

  // ---- input ---------------------------------------------------------------------------------------------------------
  // A control in a row is found again after a redraw by what it is for (its item and group), so the keyboard keeps
  // its place when a tick, a recipe or a ▸ redraws the list.
  const KEYS = ["have", "done", "pick", "tg"];
  function focusKey(el) { const k = el && KEYS.find((x) => el.dataset?.[x] !== undefined); return k ? [k, el.dataset[k], el.closest("[data-g]")?.dataset.g] : null; }
  function refocus(key) {
    if (!key) return;
    const [k, id, g] = key, el = [...$("matsList").querySelectorAll(`[data-${k}]`)].find((x) => x.dataset[k] === id && x.closest("[data-g]")?.dataset.g === g);
    el?.focus(); if (k === "have") el?.select?.();
  }
  const keepFocus = (fn) => { const key = focusKey(document.activeElement); fn(); refocus(key); };
  function setHave(id, text) {
    const n = parseHave(text, id, book);
    if (n === null) { host.status(`"${text}": a number, or 2s (stacks), 1sb (shulker boxes)${book?.packs?.[id] ? ", 3b (blocks)" : ""}`, "err"); return false; }
    if (n) fs.have[id] = n; else delete fs.have[id];
    persist(); recompute(); return true;
  }
  function wire() {
    for (const el of [$("matsList"), $("matsTop")]) { el.addEventListener("mouseover", onOver); el.addEventListener("mouseleave", onLeave); }
    $("matsTop").addEventListener("click", () => setSheet(true));
    // a redraw held back while a Have box had the keyboard happens once it lets go
    $("matsList").addEventListener("focusout", () => setTimeout(() => { if (stale && !typingHave()) { stale = false; keepFocus(renderSheet); } }));
    $("matsList").addEventListener("click", (ev) => {
      const tg = ev.target.closest("[data-tg]");
      if (tg) { const id = tg.dataset.tg, node = result?.all.nodes.get(id); fs.open[id] = !(node?.broken ?? false); persist(); keepFocus(recompute); return; }
      const solo = ev.target.closest("[data-solo]"); if (solo) { host.soloPart(solo.dataset.solo); return; }
      const sk = ev.target.closest("[data-kind]"); if (sk) { host.soloKind(sk.dataset.kind); return; }
      const ly = ev.target.closest("[data-layer]"); if (ly) host.singleLayer(Number(ly.dataset.layer));
    });
    $("matsList").addEventListener("change", (ev) => {
      const h = ev.target.closest("[data-have]"); if (h) { if (!setHave(h.dataset.have, h.value)) h.value = fs.have[h.dataset.have] ? fmt(fs.have[h.dataset.have]) : ""; return; }
      const d = ev.target.closest("[data-done]"); if (d) { if (d.checked) fs.done[d.dataset.done] = true; else delete fs.done[d.dataset.done]; persist(); keepFocus(recompute); return; }
      const pk = ev.target.closest("[data-pick]");
      if (pk) {
        const id = pk.dataset.pick, i = Number(pk.value);
        if (wouldLoop(book, id, i, fs.pick)) { host.status(`that recipe for ${nameOf(id, book)} needs ${nameOf(id, book)} itself on the way: kept the one before`, "err"); pk.value = String(fs.pick[id] ?? book.best[id]); return; }
        fs.pick[id] = i; persist(); keepFocus(recompute);
      }
    });
    $("matsList").addEventListener("keydown", (ev) => {
      if (!ev.target.matches("[data-have]")) return;
      if (ev.key === "Enter") {
        // the next row's box (Shift: the one before), found again after the change has redrawn the list
        ev.preventDefault();
        const all = [...$("matsList").querySelectorAll("input.have:not([disabled])")], next = all[all.indexOf(ev.target) + (ev.shiftKey ? -1 : 1)];
        const key = focusKey(next);
        ev.target.blur();
        if (stale) { stale = false; renderSheet(); }
        refocus(key);
      }
      if (ev.key === "Escape") { ev.target.value = fs.have[ev.target.dataset.have] ? fmt(fs.have[ev.target.dataset.have]) : ""; ev.target.blur(); }
      ev.stopPropagation();
    });
    const seg = (id, key) => $(id).addEventListener("click", (ev) => { const b = ev.target.closest("button[data-v]"); if (!b || b.disabled) return; prefs[key] = b.dataset.v; persist(); recompute(); });
    seg("matsPreset", "preset"); seg("matsPreset2", "preset"); seg("matsUnits", "units");
    for (const id of ["matsPreset", "matsPreset2"]) for (const b of $(id).querySelectorAll("button[data-v]")) b.dataset.title = b.title;
    $("matsCompact").onclick = () => { prefs.compact = !prefs.compact; persist(); render(); };
    $("matsHideDone").onclick = () => { prefs.hideDone = !prefs.hideDone; persist(); render(); };
    $("matsGroup").onchange = (ev) => { prefs.group = ev.target.value; persist(); recompute(); };
    $("matsTabList").onclick = () => { prefs.tab = "list"; persist(); recompute(); };
    $("matsTabTree").onclick = () => { prefs.tab = "tree"; persist(); recompute(); };
    $("matsFilter").oninput = () => renderSheet();
    $("matsFilter").onkeydown = (ev) => { if (ev.key === "Escape") { ev.target.value = ""; renderSheet(); ev.target.blur(); } ev.stopPropagation(); };
    $("matsPin").onclick = () => { pinned = pinned ? null : snapshot(host.scope()); recompute(); };
    $("matsOpen").onclick = () => setSheet(!prefs.sheet);
    $("matsClose").onclick = () => setSheet(false);
    $("matsReset").onclick = () => {
      const b = $("matsReset");
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Clear: sure?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Clear"; }, 3000); return; }
      b.dataset.armed = ""; b.textContent = "Clear";
      fs = EMPTY(); persist(); recompute(); host.status("cleared what you have, ticked and chose for this file");
    };
    $("matsCopy").onclick = async () => { try { await navigator.clipboard.writeText(exportText()); host.status("materials list copied"); } catch { host.status("could not copy the list", "err"); } };
    $("matsMd").onclick = () => host.download(new Blob([exportMarkdown()], { type: "text/markdown" }), `${stem()}-materials.md`);
    $("matsCsv").onclick = () => host.download(new Blob([exportCsv()], { type: "text/csv" }), `${stem()}-materials.csv`);
    $("matsJson").onclick = () => host.download(new Blob([JSON.stringify(exportJson(), null, 2)], { type: "application/json" }), `${stem()}-materials.json`);
  }
  // the page hands over a new hidden-cells object whenever what is hidden changes, so pinning keeps it as it is
  const snapshot = (sc) => ({ lo: sc.lo, hi: sc.hi, hidden: sc.hidden, chips: sc.chips });
  function setSheet(on) {
    prefs.sheet = on; persist();
    $("mats").hidden = !on;
    if (on) { if (!result) compute(); render(); } else { renderControls(); host.highlight(null); $("matsTip").classList.remove("on"); }
  }

  // ---- export --------------------------------------------------------------------------------------------------------
  const stem = () => (host.file()?.name ?? "schematic").replace(/\.[^.]+$/, "");
  const scopeText = () => (pinned ?? host.scope()).chips.join(", ");
  function exportRows() {
    const r = result; if (!r) return [];
    return r.sections.flatMap((s) => s.leaves.map((n) => ({ group: s.label, id: n.id, name: nameOf(n.id, book), need: n.net, have: n.have, total: n.gross, packed: packText(n.net, n.id, { units: prefs.units, compact: prefs.compact, book }), note: [altText(book, n), noteOf(book, n.id, n, { preset: rollup() })].filter(Boolean).join("; ") || null })));
  }
  const title = () => `${host.file()?.name ?? "schematic"}: ${PRESET_NAME[rollup()]}, ${scopeText()}`;
  function exportText() {
    const rows = exportRows(), w = Math.max(4, ...rows.map((x) => x.packed.length));
    let g = null; const out = [title(), ""];
    for (const x of rows) { if (x.group !== g && x.group !== null) { out.push("", x.group); g = x.group; } out.push(`${x.packed.padStart(w)}  ${x.name}${x.note ? `  (${x.note})` : ""}`); }
    const t = result?.totals; if (t) out.push("", `${fmt(t.items)} items, ${t.kinds} different items, ${fmt(t.stacks)} stacks, ${t.shulkers.toFixed(1)} shulker boxes`);
    return out.join("\n");
  }
  function exportMarkdown() {
    const rows = exportRows(), grouped = rows.some((x) => x.group !== null);
    const head = `| ${grouped ? "Group | " : ""}Item | Need | Have | Total | Packed |\n|${grouped ? "---|" : ""}---|---:|---:|---:|---|`;
    return `# ${title()}\n\n${head}\n${rows.map((x) => `| ${grouped ? `${x.group} | ` : ""}${x.name}${x.note ? ` (${x.note})` : ""} | ${fmt(x.need)} | ${x.have ? fmt(x.have) : ""} | ${fmt(x.total)} | ${x.packed} |`).join("\n")}\n`;
  }
  function exportCsv() {
    const q = (s) => `"${String(s ?? "").replaceAll('"', '""')}"`;
    return ["group,item,id,need,have,total,packed,note", ...exportRows().map((x) => [x.group ?? "", x.name, x.id, x.need, x.have, x.total, x.packed, x.note ?? ""].map((v, i) => (i >= 3 && i <= 5 ? v : q(v))).join(","))].join("\n") + "\n";
  }
  function exportJson() {
    const t = result?.totals;
    return { file: host.file()?.name ?? null, scope: scopeText(), rollup: rollup(), units: prefs.units, totals: t ?? null, items: exportRows(),
      fluids: { ...Object.fromEntries(result?.fluids ?? []), ...(result?.wet ? { waterlogged: result.wet } : {}) }, unknown: Object.fromEntries(result?.unknown ?? []) };
  }

  wire();
  $("mats").hidden = !prefs.sheet;
  renderControls();

  return {
    /** A new file: its own have values, unpinned (and no recount still waiting from the layers it reset). */
    fileChanged() {
      clearTimeout(timer);
      const f = host.file(); fsKey = f?.hash ? fileKey(f.hash) : null;
      fs = fsKey ? load(fsKey, EMPTY()) : EMPTY();
      pinned = null; partCache = { schem: null }; recompute();
    },
    /** The layers, shell or parts changed. */
    scopeChanged() { if (!pinned) soon(); else renderGroup(); },
    /** The recipe book (prepareBook's) and a reader for the pack's textures; state: loading, ready or missing. */
    setBook(b, reader, state = b ? "ready" : "missing") {
      if (b !== book) resetIcons();
      book = b; readTexture = reader; bookState = state; lookup = lookupOf(b);
      recompute(); host.iconsChanged?.();
    },
    /** The icon of the item a block (its id) is placed from, as a data URL, or null (no pack yet, no such item). */
    iconOfBlock(id) {
      const item = blockItems(id, lookup)?.items?.[0]?.[0];
      return item ? iconUrl(item, book?.items?.[item]?.[1], readTexture) : Promise.resolve(null);
    },
    toggleSheet() { setSheet(!prefs.sheet); },
    close() { if (prefs.sheet) { setSheet(false); return true; } return false; },
    /** The hover tooltip's line for a block (its palette key): the item it is placed from, how many in view. */
    describeKey(key) {
      const it = key ? blockItems(key, lookup) : null;
      if (!it) return "";
      if (it.fluid) return `${nameOf(it.fluid, book)} (fluid, not counted)`;
      if (it.unknown) return "no item found for it";
      return it.items.map(([k, n]) => `${n > 1 ? `${n} × ` : ""}${nameOf(k, book)}${result?.prefer.has(k) ? ` · ${fmt(result.prefer.get(k))} in view` : ""}`).join(" + ") + (it.wet ? " · waterlogged" : "");
    },
    /** For agents and tests: the list as it shows, or with another rollup; setHave(id, "2s"). */
    list({ preset, group } = {}) {
      const keep = { preset: prefs.preset, group: prefs.group };
      if (preset) prefs.preset = preset;
      if (group) prefs.group = group;
      compute(); const out = exportJson();
      Object.assign(prefs, keep); recompute();
      return out;
    },
    setHave,
    state: () => ({ prefs: { ...prefs }, have: { ...fs.have }, done: { ...fs.done }, open: { ...fs.open }, pick: { ...fs.pick }, pinned: !!pinned, book: bookState }),
  };
}
