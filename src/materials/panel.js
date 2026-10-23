// The Materials group in the panel and the sheet beside it: what the blocks in view take, as placed, as gathered or
// down to raw materials, with what the person already has taken off. The scope is the view's (the layers, the shell
// and the parts shown) unless it is pinned. What the person has, ticked off and broken down by hand is kept per file
// (by its hash) in this browser; the list's settings are kept for every file.
import { countScope, plan, leavesOf, totalsOf, nameOf, packText, parseHave, noteOf, recipeOf, memberOf, paletteItems, blockItems, HOW, SHULKER, INVENTORY } from "./engine.js";
import { iconUrl, resetIcons } from "./icons.js";
import { matId } from "../framed.js";
import { partOf } from "../parts.js";

const PREFS = "blockscope.mats";
const fileKey = (hash) => `blockscope.mats.${hash}`;
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) ?? "null"); return v && typeof v === "object" ? { ...d, ...v } : { ...d }; } catch { return { ...d }; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const PRESET_NAME = { placed: "as placed", gather: "to gather", raw: "raw materials" };
const FLUID_NOTE = { "minecraft:water_bucket": "a bucket per source block, or two buckets and an infinite source", "minecraft:lava_bucket": "a bucket per source block" };
const HIGHLIGHT_MAX = 60000;

/**
 * host: { $ (by id), file() ({ schem, hash, name } or null), scope() ({ lo, hi, hidden, chips }), meta(), parts(),
 * worldY(y), highlight(cells or null), soloPart(name), singleLayer(fileY), status(text, kind), download(blob, name) }.
 */
export function createMaterials(host) {
  const { $ } = host;
  const prefs = load(PREFS, { preset: "gather", units: "stacks", compact: false, hideDone: false, group: "none", tab: "list", sheet: false });
  let fs = { have: {}, done: {}, open: {}, pick: {} }, fsKey = null;
  let book = null, has = () => true, lookup = has, readTexture = null, bookState = "none";   // none | loading | ready | missing
  let pinned = null, result = null, timer = 0, partCache = { schem: null, meta: null, names: null, idx: null }, framedCache = { schem: null, cells: [] };
  const persist = () => { save(PREFS, prefs); if (fsKey) save(fsKey, fs); };
  // the rollup in effect: as placed until the recipes have arrived
  const rollup = () => (book ? prefs.preset : "placed");

  // ---- working it out -----------------------------------------------------------------------------------------------
  function groupFn(schem) {
    if (prefs.group === "layer") return { of: (i) => Math.floor(i / schem.perLayer), order: (a, b) => a - b, label: (y) => `y ${host.worldY(y)}` };
    if (prefs.group !== "part") return null;
    const meta = host.meta(); if (!meta) return null;
    if (partCache.schem !== schem || partCache.meta !== meta) {
      const names = host.parts().map((p) => p.name), at = new Map(names.map((n, i) => [n, i]));
      const idx = new Int16Array(schem.data.length).fill(-1);
      for (let i = 0; i < schem.data.length; i++) { if (schem.air.has(schem.data[i])) continue; const [x, y, z] = schem.cellOf(i); const p = partOf(schem.metaAt(meta, x, y, z)); if (p && at.has(p)) idx[i] = at.get(p); }
      partCache = { schem, meta, names, idx };
    }
    const { names, idx } = partCache, last = names.length;
    return { of: (i) => (idx[i] < 0 ? last : idx[i]), order: (a, b) => a - b, label: (g) => names[g] ?? "no part", partName: (g) => names[g] ?? null };
  }
  function compute() {
    const f = host.file(); if (!f?.schem) { result = null; return; }
    const schem = f.schem, sc = pinned ?? host.scope(), grouping = groupFn(schem);
    if (framedCache.schem !== schem) framedCache = { schem, cells: schem.framedCells() };
    const groups = countScope(schem, { lo: sc.lo, hi: sc.hi, hidden: sc.hidden, has, lookup, groupOf: grouping?.of ?? null, framed: framedCache.cells, matItem: (t) => { const id = matId(t); return id && has(id) ? id : null; } });
    const prefer = new Map(), fluids = new Map(), unknown = new Map(), extraIds = new Set();
    let blocks = 0;
    for (const g of groups.values()) {
      blocks += g.blocks;
      for (const [k, n] of g.placed) prefer.set(k, (prefer.get(k) ?? 0) + n);
      for (const [k, n] of g.fluids) fluids.set(k, (fluids.get(k) ?? 0) + n);
      for (const [k, n] of g.unknown) unknown.set(k, (unknown.get(k) ?? 0) + n);
      for (const e of g.extras) extraIds.add(e.item);
    }
    const opts = { preset: rollup(), open: fs.open, pick: fs.pick, done: fs.done, prefer };
    const demandOf = (g) => [...[...g.placed].map(([item, n]) => ({ item, n, from: item })), ...g.extras];
    // the whole scope at once (the tree, the totals, the panel's top rows), then per group with what the person has
    // handed out in the groups' order: the bottom layer or the first part takes it first
    const all = plan(book, [...groups.values()].flatMap(demandOf), { ...opts, have: fs.have });
    const sections = [];
    if (grouping) {
      const left = { ...fs.have };
      for (const key of [...groups.keys()].sort(grouping.order)) {
        const g = groups.get(key), p = plan(book, demandOf(g), { ...opts, have: left });
        for (const n of p.nodes.values()) if (!fs.done[n.id] && left[n.id]) left[n.id] = Math.max(0, left[n.id] - n.have);
        sections.push({ key, label: grouping.label(key), part: grouping.partName?.(key) ?? null, layer: prefs.group === "layer" ? key : null, blocks: g.blocks, plan: p, leaves: leavesOf(p) });
      }
    } else if (prefs.group === "mod") {
      const byNs = new Map();
      for (const n of leavesOf(all)) { const ns = n.id.startsWith("#") ? "minecraft" : n.id.split(":")[0]; (byNs.get(ns) ?? byNs.set(ns, []).get(ns)).push(n); }
      for (const ns of [...byNs.keys()].sort((a, b) => (a === "minecraft" ? -1 : b === "minecraft" ? 1 : a < b ? -1 : 1))) sections.push({ key: ns, label: ns === "minecraft" ? "Minecraft" : ns, plan: all, leaves: byNs.get(ns), blocks: null });
    } else sections.push({ key: "all", label: null, plan: all, leaves: leavesOf(all), blocks });
    const leaves = leavesOf(all);
    result = { schem, scope: sc, groups, sections, all, leaves, fluids, unknown, blocks, prefer, extraIds, totals: totalsOf(leaves), grossTotals: totalsOf(leaves, "gross"), grouping };
  }
  const recompute = () => { compute(); render(); };
  const soon = () => { clearTimeout(timer); timer = setTimeout(recompute, 120); };

  // ---- the panel's group ------------------------------------------------------------------------------------------
  function renderGroup() {
    const r = result, sum = $("matsSum"), top = $("matsTop");
    if (!r) { sum.textContent = ""; top.innerHTML = `<p class="empty">Open a schematic to see what it takes.</p>`; $("matsGrpScope").textContent = ""; return; }
    const t = r.totals, got = r.grossTotals.items - t.items;
    sum.textContent = r.leaves.length ? `${fmt(t.items)} · ${t.kinds} kinds${got ? ` · ${fmt(got)} in hand` : ""}` : "nothing";
    $("matsGrpScope").innerHTML = chipsHtml();
    top.innerHTML = r.leaves.length ? r.leaves.slice(0, 6).map((n) => `<div class="mmini" data-id="${esc(n.id)}" data-g="all" title="${esc(nameOf(n.id, book))}: ${fmt(n.net)} to get${n.have ? ` (${fmt(n.have)} in hand)` : ""}"><img class="ic" alt="" data-ic="${esc(n.id)}"><span class="nm">${esc(nameOf(n.id, book))}</span><span class="c">${fmt(n.net)}</span><span class="pk">${esc(packText(n.net, n.id, { units: "stacks" }))}</span></div>`).join("") +
      (r.leaves.length > 6 ? `<div class="mmini more" data-more="1"><span></span><span class="nm">${r.leaves.length - 6} more kinds…</span><span></span><span></span></div>` : "")
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
    const id = n.id, name = nameOf(id, book), real = id.startsWith("#") ? memberOf(book, id, result.prefer) : id;
    const recipe = real && recipeOf(book, real, fs.pick), canBreak = !!recipe && bookState === "ready";
    const ns = id.startsWith("#") || id.startsWith("minecraft:") ? "" : id.split(":")[0];
    const note = noteOf(book, id, n, { preset: rollup() });
    const done = !!fs.done[id], short = n.have > 0 && n.net > 0;
    const how = n.broken && recipe ? `<span class="via">${esc(viaText(recipe, n))}</span>` : "";
    const pick = tree && n.broken && (book?.recipes?.[real]?.length ?? 0) > 1 ? recipeSelect(real) : "";
    const tg = (tree || !n.broken) && canBreak ? `<button class="tg" data-tg="${esc(id)}" title="${n.broken ? `Get ${esc(name)} as it is instead of making it` : `Make ${esc(name)}: list what it is made of instead`}">${n.broken ? "&#9662;" : "&#9656;"}</button>` : `<span class="tg"></span>`;
    const haveVal = fs.have[id] ? fmt(fs.have[id]) : "";
    return `<div class="mrow${done ? " done" : ""}${n.broken ? " made" : ""}" data-id="${esc(id)}" data-g="${esc(String(group))}" style="--d:${depth}">` +
      `${tg}<img class="ic" alt="" data-ic="${esc(id)}">` +
      `<span class="nm" title="${esc(`${name}${ns ? ` (${ns})` : ""}${real && real !== id ? `, as ${nameOf(real, book)}` : ""}: ${fmt(n.gross)} needed in all${n.have ? `, ${fmt(n.have)} in hand` : ""}${n.spare ? `, ${fmt(n.spare)} spare from whole crafts` : ""}`)}">${esc(name)}${ns ? `<span class="ns">${esc(ns)}</span>` : ""}${forQty !== null ? `<span class="for">${fmt(forQty)} for this</span>` : ""}${how}${pick}${!n.broken && note ? `<span class="note">${esc(note)}</span>` : ""}</span>` +
      `<span class="need${short ? " short" : ""}">${done ? "✓" : fmt(n.net)}</span>` +
      `<input class="have" data-have="${esc(id)}" value="${haveVal}" placeholder="–" inputmode="text" autocomplete="off" spellcheck="false" aria-label="have of ${esc(name)}"${done ? " disabled" : ""}>` +
      `<span class="pk">${esc(packText(done ? n.gross : n.net, id, { units: prefs.units, compact: prefs.compact, book }))}</span>` +
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

  function renderSheet() {
    const r = result, list = $("matsList");
    for (const [id, v] of [["matsPreset", prefs.preset], ["matsUnits", prefs.units]]) for (const b of $(id).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === v));
    for (const b of $("matsPreset2").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === prefs.preset));
    for (const b of $("matsPreset").querySelectorAll("button, [data-v]")) if (b.dataset.v !== "placed") b.disabled = bookState !== "ready";
    for (const b of $("matsPreset2").querySelectorAll("button")) if (b.dataset.v !== "placed") b.disabled = bookState !== "ready";
    $("matsCompact").setAttribute("aria-pressed", String(prefs.compact)); $("matsHideDone").setAttribute("aria-pressed", String(prefs.hideDone));
    $("matsTabList").setAttribute("aria-pressed", String(prefs.tab === "list")); $("matsTabTree").setAttribute("aria-pressed", String(prefs.tab === "tree"));
    $("matsPin").setAttribute("aria-pressed", String(!!pinned));
    $("matsGroup").value = prefs.group; $("matsGroup").disabled = prefs.tab === "tree";
    $("matsGroup").querySelector('[value="part"]').disabled = !host.meta() || !host.parts().length;
    $("matsScope").innerHTML = chipsHtml();
    $("matsNote").textContent = bookState === "ready" ? "" : bookState === "loading" ? "reading the recipes…" : bookState === "missing" ? "no recipes in this pack: rebuild it (File, Resource pack) for Gather and Raw" : "recipes come with the pack";
    if (!r) { list.innerHTML = `<p class="empty">Open a schematic to see what it takes.</p>`; $("matsTotals").textContent = ""; return; }
    const t = r.totals, g = r.grossTotals, got = g.items - t.items;
    $("matsTotals").innerHTML = `<span><b>${fmt(r.blocks)}</b> blocks</span><span><b>${fmt(t.items)}</b> ${got ? "to get" : "items"} · <b>${t.kinds}</b> kinds</span><span><b>${fmt(t.stacks)}</b> stacks</span><span title="${SHULKER} stacks a box"><b>${t.shulkers.toFixed(1)}</b> shulker boxes</span><span title="${INVENTORY} slots an inventory"><b>${t.trips.toFixed(1)}</b> inventories</span>${got ? `<span class="ok"><b>${fmt(got)}</b> of ${fmt(g.items)} in hand</span>` : ""}`;
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
          const act = s.part ? `<button class="act" data-solo="${esc(s.part)}" title="Show only this part in the view">solo</button>` : s.layer !== null ? `<button class="act" data-layer="${s.layer}" title="Show only this layer in the view">single</button>` : "";
          const tt = totalsOf(s.leaves);
          html += `<div class="msec"><span class="t">${esc(s.label)}</span><span class="c">${s.blocks !== null ? `${fmt(s.blocks)} blocks · ` : ""}${fmt(tt.items)} items</span>${act}</div>`;
        }
        if (!rows.length) { if (s.label === null) html += `<p class="empty">${q ? "Nothing matches." : prefs.hideDone ? "You have everything on this list." : "No blocks in view."}</p>`; continue; }
        html += HEAD + rows.map((n) => rowHtml(n, { group: s.key })).join("");
      }
      if (r.fluids.size) html += `<div class="msec"><span class="t">Fluids</span><span class="c">not in the totals</span></div>` + [...r.fluids].map(([id, n]) => `<div class="mrow plain"><span class="tg"></span><img class="ic" alt="" data-ic="${esc(id)}"><span class="nm">${esc(nameOf(id, book).replace(/ Bucket$/, ""))} source blocks<span class="note">${esc(FLUID_NOTE[id] ?? "")}</span></span><span class="need">${fmt(n)}</span><span></span><span class="pk"></span><span></span></div>`).join("");
      if (r.unknown.size) html += `<div class="msec warn"><span class="t">No item found</span><span class="c">not in the totals</span></div>` + [...r.unknown].sort((a, b) => b[1] - a[1]).map(([id, n]) => `<div class="mrow plain"><span class="tg"></span><span class="ic"></span><span class="nm mono" title="No item places this block, as far as the list can tell">${esc(id)}</span><span class="need">${fmt(n)}</span><span></span><span class="pk"></span><span></span></div>`).join("");
    }
    list.innerHTML = html;
    fillIcons(list);
  }
  function treeHtml(q) {
    const r = result, p = r.all, out = [];
    // a root is what the blocks are placed from (and a sign's dye or wax); its ingredients follow it while it is made
    const roots = [...p.nodes.values()].filter((n) => r.prefer.has(n.id) || r.extraIds.has(n.id)).sort((a, b) => b.gross - a.gross);
    // "for this": what this branch alone takes (its own whole crafts), where the row's Need is the item's total
    const walk = (n, depth, forQty, path, qty) => {
      out.push(rowHtml(n, { depth, forQty, tree: true }));
      if (!n.broken || !n.crafts || depth > 8 || qty <= 0) return;
      const crafts = Math.ceil(qty / n.recipe[1]);
      for (const [k, c] of n.recipe[2]) { const child = p.nodes.get(k); if (child && !path.has(k)) walk(child, depth + 1, crafts * c, new Set([...path, k]), crafts * c); }
    };
    for (const n of roots) if (!q || subtreeMatches(n, q, p, new Set())) walk(n, 0, null, new Set([n.id]), n.net);
    return out.length ? HEAD + out.join("") : `<p class="empty">${q ? "Nothing matches." : "No blocks in view."}</p>`;
  }
  function subtreeMatches(n, q, p, seen) {
    if (nameOf(n.id, book).toLowerCase().includes(q)) return true;
    if (!n.broken || seen.has(n.id)) return false; seen.add(n.id);
    return n.recipe[2].some(([k]) => { const c = p.nodes.get(k); return c && subtreeMatches(c, q, p, seen); });
  }
  function fillIcons(root) {
    for (const img of root.querySelectorAll("img[data-ic]")) {
      const id = img.dataset.ic, real = id.startsWith("#") ? memberOf(book, id, result?.prefer) : id;
      const spec = real && book?.items?.[real]?.[1];
      iconUrl(real ?? id, spec, readTexture).then((u) => { if (u) img.src = u; else img.classList.add("none"); });
    }
  }
  function render() { renderGroup(); if (prefs.sheet) renderSheet(); }

  // ---- hovering: the blocks a row stands for light up; a made item says what uses it -------------------------------
  function cellsFor(id, groupKey) {
    const r = result; if (!r) return [];
    const roots = r.all.roots.get(id) ?? new Set([id]);
    const items = paletteItems(r.schem, lookup), want = new Set();
    items.forEach((it, p) => { if (it?.items?.some(([k]) => roots.has(k))) want.add(p); else if (it?.fluid && it.fluid === id) want.add(p); });
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
    const list = [...uses].sort((a, b) => b[1] - a[1]);
    tip.innerHTML = `<b>${esc(nameOf(id, book))}</b> · ${fmt(result.all.nodes.get(id)?.gross ?? 0)} go into<div class="u">${list.slice(0, 10).map(([k, q]) => `<span>${fmt(q)}</span><span>${esc(nameOf(k, book))}</span>`).join("")}${list.length > 10 ? `<span></span><span class="dim">and ${list.length - 10} more</span>` : ""}</div>`;
    tip.classList.add("on");
    const box = $("mats").getBoundingClientRect(), rr = row.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(rr.left - box.left + 150, box.width - tip.offsetWidth - 8))}px`;
    const below = rr.bottom - box.top + 4;
    tip.style.top = `${below + tip.offsetHeight > box.height - 8 ? rr.top - box.top - tip.offsetHeight - 4 : below}px`;
  }
  function onLeave(ev) { for (const el of ev.currentTarget.querySelectorAll("[data-hover]")) delete el.dataset.hover; host.highlight(null); $("matsTip").classList.remove("on"); }

  // ---- input ---------------------------------------------------------------------------------------------------------
  function setHave(id, text) {
    const n = parseHave(text, id, book);
    if (n === null) { host.status(`"${text}": a number, or 2s (stacks), 1sb (shulker boxes), 3b (blocks)`, "err"); return false; }
    if (n) fs.have[id] = n; else delete fs.have[id];
    persist(); recompute(); return true;
  }
  function wire() {
    for (const el of [$("matsList"), $("matsTop")]) { el.addEventListener("mouseover", onOver); el.addEventListener("mouseleave", onLeave); }
    $("matsTop").addEventListener("click", () => setSheet(true));
    $("matsList").addEventListener("click", (ev) => {
      const tg = ev.target.closest("[data-tg]");
      if (tg) { const id = tg.dataset.tg, node = result?.all.nodes.get(id); fs.open[id] = !(node?.broken ?? false); persist(); recompute(); return; }
      const solo = ev.target.closest("[data-solo]"); if (solo) { host.soloPart(solo.dataset.solo); return; }
      const ly = ev.target.closest("[data-layer]"); if (ly) host.singleLayer(Number(ly.dataset.layer));
    });
    $("matsList").addEventListener("change", (ev) => {
      const h = ev.target.closest("[data-have]"); if (h) { if (!setHave(h.dataset.have, h.value)) h.value = fs.have[h.dataset.have] ? fmt(fs.have[h.dataset.have]) : ""; return; }
      const d = ev.target.closest("[data-done]"); if (d) { if (d.checked) fs.done[d.dataset.done] = true; else delete fs.done[d.dataset.done]; persist(); recompute(); return; }
      const pk = ev.target.closest("[data-pick]"); if (pk) { fs.pick[pk.dataset.pick] = Number(pk.value); persist(); recompute(); }
    });
    $("matsList").addEventListener("keydown", (ev) => {
      if (!ev.target.matches("[data-have]")) return;
      if (ev.key === "Enter") {
        // the next row's box (Shift: the one before), found again after the change has redrawn the list
        ev.preventDefault();
        const all = [...$("matsList").querySelectorAll("input.have:not([disabled])")], next = all[all.indexOf(ev.target) + (ev.shiftKey ? -1 : 1)];
        const key = next ? [next.dataset.have, next.closest("[data-g]")?.dataset.g] : null;
        ev.target.blur();
        if (key) { const el = [...$("matsList").querySelectorAll("input.have")].find((x) => x.dataset.have === key[0] && x.closest("[data-g]")?.dataset.g === key[1]); el?.focus(); el?.select(); }
      }
      if (ev.key === "Escape") { ev.target.value = fs.have[ev.target.dataset.have] ? fmt(fs.have[ev.target.dataset.have]) : ""; ev.target.blur(); }
      ev.stopPropagation();
    });
    const seg = (id, key) => $(id).addEventListener("click", (ev) => { const b = ev.target.closest("button[data-v]"); if (!b || b.disabled) return; prefs[key] = b.dataset.v; persist(); recompute(); });
    seg("matsPreset", "preset"); seg("matsPreset2", "preset"); seg("matsUnits", "units");
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
      fs = { have: {}, done: {}, open: {}, pick: {} }; persist(); recompute(); host.status("cleared what you have, ticked and chose for this file");
    };
    $("matsCopy").onclick = async () => { try { await navigator.clipboard.writeText(exportText()); host.status("materials list copied"); } catch { host.status("could not copy the list", "err"); } };
    $("matsMd").onclick = () => host.download(new Blob([exportMarkdown()], { type: "text/markdown" }), `${stem()}-materials.md`);
    $("matsCsv").onclick = () => host.download(new Blob([exportCsv()], { type: "text/csv" }), `${stem()}-materials.csv`);
    $("matsJson").onclick = () => host.download(new Blob([JSON.stringify(exportJson(), null, 2)], { type: "application/json" }), `${stem()}-materials.json`);
  }
  const snapshot = (sc) => ({ lo: sc.lo, hi: sc.hi, hidden: new Set(sc.hidden), chips: sc.chips });
  function setSheet(on) {
    prefs.sheet = on; persist();
    $("mats").hidden = !on; $("matsOpen").setAttribute("aria-pressed", String(on));
    if (on) { if (!result) compute(); renderSheet(); } else { host.highlight(null); $("matsTip").classList.remove("on"); }
  }

  // ---- export --------------------------------------------------------------------------------------------------------
  const stem = () => (host.file()?.name ?? "schematic").replace(/\.[^.]+$/, "");
  const scopeText = () => (pinned ?? host.scope()).chips.join(", ");
  function exportRows() {
    const r = result; if (!r) return [];
    return r.sections.flatMap((s) => s.leaves.map((n) => ({ group: s.label, id: n.id, name: nameOf(n.id, book), need: n.net, have: n.have, total: n.gross, packed: packText(n.net, n.id, { units: prefs.units, compact: prefs.compact, book }), note: noteOf(book, n.id, n, { preset: rollup() }) })));
  }
  const title = () => `${host.file()?.name ?? "schematic"}: ${PRESET_NAME[rollup()]}, ${scopeText()}`;
  function exportText() {
    const rows = exportRows(), w = Math.max(4, ...rows.map((x) => x.packed.length));
    let g = null; const out = [title(), ""];
    for (const x of rows) { if (x.group !== g && x.group !== null) { out.push("", x.group); g = x.group; } out.push(`${x.packed.padStart(w)}  ${x.name}${x.note ? `  (${x.note})` : ""}`); }
    const t = result?.totals; if (t) out.push("", `${fmt(t.items)} items, ${t.kinds} kinds, ${fmt(t.stacks)} stacks, ${t.shulkers.toFixed(1)} shulker boxes`);
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
      fluids: Object.fromEntries(result?.fluids ?? []), unknown: Object.fromEntries(result?.unknown ?? []) };
  }

  wire();
  $("mats").hidden = !prefs.sheet; $("matsOpen").setAttribute("aria-pressed", String(prefs.sheet));

  return {
    /** A new file: its own have values, unpinned. */
    fileChanged() {
      const f = host.file(); fsKey = f?.hash ? fileKey(f.hash) : null;
      fs = fsKey ? load(fsKey, { have: {}, done: {}, open: {}, pick: {} }) : { have: {}, done: {}, open: {}, pick: {} };
      pinned = null; partCache = { schem: null }; recompute();
    },
    /** The layers, shell or parts changed. */
    scopeChanged() { if (!pinned) soon(); else renderGroup(); },
    /** The recipe book (prepareBook's) and a reader for the pack's textures; state: loading, ready or missing. */
    setBook(b, reader, state = b ? "ready" : "missing") {
      if (b !== book) resetIcons();
      book = b; readTexture = reader; bookState = state;
      has = b ? (id) => id in b.items : () => true;
      lookup = b ? { has, from: (id) => b.blocks?.[id] ?? null } : has;
      recompute();
    },
    toggleSheet() { setSheet(!prefs.sheet); },
    isOpen: () => prefs.sheet,
    close() { if (prefs.sheet) { setSheet(false); return true; } return false; },
    /** The hover tooltip's line for a block (its palette key): the item it is placed from, how many in view. */
    describeKey(key) {
      const it = key ? blockItems(key, lookup) : null;
      if (!it) return "";
      if (it.fluid) return `${nameOf(it.fluid, book)} (fluid, not counted)`;
      if (it.unknown) return "no item found for it";
      return it.items.map(([k, n]) => `${n > 1 ? `${n} × ` : ""}${nameOf(k, book)}${result?.prefer.has(k) ? ` · ${fmt(result.prefer.get(k))} in view` : ""}`).join(" + ");
    },
    /** For agents and tests: the list as it shows, or with another rollup; setHave(id, "2s"). */
    list({ preset, group } = {}) {
      const keep = { preset: prefs.preset, group: prefs.group };
      if (preset) prefs.preset = preset; if (group) prefs.group = group;
      compute(); const out = exportJson();
      Object.assign(prefs, keep); compute(); render();
      return out;
    },
    setHave,
    state: () => ({ prefs: { ...prefs }, have: { ...fs.have }, done: { ...fs.done }, open: { ...fs.open }, pick: { ...fs.pick }, pinned: !!pinned, book: bookState }),
  };
}
