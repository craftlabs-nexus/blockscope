# Blockscope for agents

How an agent (Claude Code, a Playwright script, any tool that drives a browser) opens a schematic in the local viewer,
waits for it, frames a block or a part and takes a picture of it. What the viewer is and does: `README.md`.

## 1. The dev server

```bash
npm run dev:local   # the renderer and Packrat from local checkouts (README, "Running it")
npm run dev         # or: the published packages
```

Both serve http://localhost:5180 (the port is fixed). If it answers already, a server is running: use it rather than
starting another. The dev server serves a folder of schematics read-only at `/plans/` (`BLOCKSCOPE_PLANS`, README,
"Running it"): `?schem=<file>` opens a file from it. List that folder to see what there is to open; without one,
nothing opens by name.

With `dev:local`, a change in the renderer reloads the page when its rebuild is done (about 10 s): wait for `ready()`
again after editing the renderer.

## 2. Open a file

```
http://localhost:5180/?agent=1&schem=<file>.schem
```

`?agent=1` lets the page download the Minecraft client jar (Mojang) and the mod jars the file lists (Modrinth)
without the consent prompt an agent cannot click. It works only on the dev server, never in a build, and it does not
record consent, so a person opening the page is still asked. The first time in a browser profile this is 40 to 90 MB
and up to a few minutes; the jars and the built pack are then kept in that profile's IndexedDB. A fresh profile
(Playwright's default) downloads again every run: reuse a persistent profile when you can.

Keep the tab visible (in front). The renderer draws on animation frames, so a hidden or background tab draws nothing,
and `blockscope.screenshot()` waits until the tab is shown.

## 3. Wait, then look

Everything is on `window.blockscope`. Coordinates are **world coordinates** (as in the game, F3, `/setblock` and a
file's block metadata) unless noted.

```js
const state = await blockscope.ready();      // the first render, settled; rejects if the file cannot be read
const parts = blockscope.parts();             // [{ name, blocks, hidden }]
const { total, blocks } = blockscope.findBlocks("lever");   // blocks: [{ at: [x, y, z], block: "minecraft:lever[face=wall,…]", part }]
await blockscope.focusPart(parts[0].name);    // flies to it: { part, blocks, from: [x, y, z], to: [x, y, z] }
await blockscope.focusPart(parts[0].name, { solo: true, highlight: true });   // hide every other part; tint it blue
await blockscope.focusBlock(...blocks[0].at); // flies to it (3 blocks around it), pins it; returns what Inspect shows
await blockscope.focusBlock(...blocks[0].at, { radius: 6, pin: false });
await blockscope.focusKind("redstone", { solo: true, highlight: true });   // only the redstone, framed, lit up
await blockscope.focusType("minecraft:chest");   // flies to the chests ("chest" works too)
const png = await blockscope.screenshot(1600, 1000);   // the canvas only (no panel), a PNG data URL
blockscope.state();                           // file, status, size, origin, hidden parts, layers, pinned, camera, pack
```

| Call | What it does |
|---|---|
| `ready(timeout = 300000)` | resolves with `state()` once the first file is drawn and the view has settled (at once if it has); rejects when the file cannot be read or after `timeout` ms, with the status line in the message |
| `nextRender(timeout = 120000)` | resolves after the next render settles (after you change layers or parts yourself) |
| `state()` | `file`, `status` and `error` (the status line, red or not), `size` (blocks: x, y, z), `origin` (the world position of the file's corner cell; a cell's world position is origin + file position), `parts`, `hiddenParts`, `kinds` (`only`: the kinds picked by solo, `hidden`), `hiddenTypes`, `layers` (`mode`, `fileY`: the file layers drawn), `pinned`, `camera` (the renderer's scene coordinates, not world), `pack`, `unknownBlocks` (blocks drawn without a model), `url` |
| `parts()` | the parts in the Parts list's order (from the file's metadata, or a Litematica file's regions) |
| `kinds()`, `types()` | the Blocks lists: `[{ kind, name, blocks, hidden }]` (the kinds the file lists), `[{ id, name, mod, blocks, hidden }]` (most blocks first) |
| `focusKind(kind, { solo, highlight })`, `focusType(id, { solo, highlight })` | as `focusPart`, for a kind (`redstone`, `terrain`, …) or a type; returns `{ kind or type, blocks, from, to }` |
| `findBlocks(query, { limit = 200 })` | blocks whose `id[state]` contains `query` (or matches it, a `RegExp`), first `limit` in file order, and how many in all |
| `focusPart(name, { solo, highlight })` | shows the part if it was hidden (`solo`: and hides the others), flies to it and selects its row; an unknown name throws with the list of parts |
| `focusBlock(x, y, z, { radius = 3, pin = true })` | flies to the block with `radius` blocks around it in view and pins it as a click would; returns `{ id, state, part, kinds (with why a block is redstone), extra (a sign's text, a painting), world, … }`; outside the file it throws |
| `describe(x, y, z)` | what Inspect shows for a block, by **file** position |
| `screenshot(w, h)` | a PNG data URL of the canvas alone at that size |
| `shot([x, y, z], [tx, ty, tz], w, h)` | places the camera (file positions, y from the bottom layer) and returns a screenshot |
| `fit()` | the overview again |
| `materials.list({ preset, group })` | the materials list of what the view shows (README, "Materials"), as the sheet's JSON export: `{ file, scope, rollup, totals, items: [{ group, id, name, need, have, total, packed, note }], fluids, unknown }`; `preset` `placed`, `gather` or `raw`, `group` `none`, `part`, `layer`, `kind` or `mod`; the recipes arrive with the pack a moment after `ready()` (`materials.state().book` is `"ready"`) |
| `materials.setHave(id, "2s")`, `materials.state()` | what the person has of an item (a number, `2s`, `1sb`, `3b`); the list's settings and this file's have values |

A block can be framed and still not show: above the layers drawn, in a hidden part, kind or type, or in the roof the
page hides by default. `focusBlock` returns `hidden` for that (for example `"roof"` or `"kind terrain"`); open the page
with `?roof=on`, `?layer=…` or without `?part=`, `?kind=` and `?type=`.

## 4. The same from a link

A link can do it on load, without script (`ready()` resolves after it is applied):

| Parameter | Effect |
|---|---|
| `?focus=x,y,z` | fly to that block and pin it (world coordinates) |
| `?focus=<part>` | fly to that part (its name as the Parts list spells it) |
| `?part=a,b`, `?hidePart=a,b` | only those parts, or those hidden |
| `?kind=a,b`, `?hideKind=a,b` | only those kinds, or those hidden (`redstone`, `terrain`, `roof`, …: README, "Parameters") |
| `?type=a,b`, `?hideType=a,b` | only those types, or those hidden (block ids) |
| `?at=x,y,z` | pin that block, the camera left where it is |
| `?layer=below,N`, `?layer=single,N` | layers up to N, or only N (file layers, from 0) |
| `?roof=on`, `?hide=roof,wall,floor` | the shell shown or hidden |
| `?view=top` | the flat top view; `?view=top,Q,ZOOM` turns it Q quarters and zooms |
| `?digits=on` | signal digits: signal strength on dust, repeater delays, comparator modes (a 1 MB pack from Modrinth) |
| `?pick=off`, `?sim=on` | no block picking; the redstone simulator |

For example, one part alone, framed: `?agent=1&schem=<file>&part=<part>&focus=<part>`.

## When it goes wrong

- **The status line says it**: `blockscope.state().status`, and `error: true` when it is red. The console has the
  pack's report (`[blockscope] pack built`).
- **Stuck at "starting…" and nothing in the console**: a module failed to load; in the browser,
  `performance.getEntriesByType("resource").filter((e) => e.responseStatus >= 400)` names it. A 504 on
  `node_modules/.vite*/deps/…` means Vite's dependency cache moved under the server: restart `npm run dev:local` (or
  `npm run dev`).
- **`ready()` times out**: a first download on a slow line (raise the timeout), or the pack failed (the status line).
- **The camera is not where you put it**: a view not moved yet is framed again after a change of layers, parts or
  shell (as after a load), and opening a file frames the new one; wait for `nextRender()` (or use `focusPart`, which
  waits itself), then move it.
