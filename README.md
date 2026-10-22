# Blockscope

A schematic viewer that is a static page: it reads a Minecraft schematic (`.schem`, `.schematic`, `.litematic`,
structure `.nbt`), builds a resource pack for it in your browser from Mojang's and Modrinth's own downloads, and
draws it with [`@craftlabs/schematic-renderer`](https://github.com/craftlabs-nexus/schematic-renderer), so modded
blocks show with their own textures. Nothing is uploaded and no server does any work: the host serves files.

It grew out of the storage plan viewer of the Gaming Grudge server (CraftLabs), and draws that plan's files by
default: the storage hall, the engine room and their test fixtures, with the generator's metadata (what each block
is for), parts and paintings.

## What it does

- **The pack.** Before the first jar is downloaded the page says what it will fetch and how much (the storage hall:
  87 MB the first time), then fetches the Minecraft client jar from Mojang (the version manifest, the version's JSON, the jar; sha1 checked) and the jars of the mods the
  schematic uses from Modrinth, through [Packrat](https://github.com/craftlabs-nexus/packrat): the Gaming Grudge
  packwiz pack by default (`analyzePackwiz`, `buildPlan`, then `fetchRows` with every listed hash checked). Only the
  mods whose namespaces the schematic uses are fetched: a jar's namespaces are learned once and remembered, and a
  namespace no remembered jar has is looked for in the jars whose slug, file name or title matches it. The merged
  pack (the client's block assets, the mods' assets as they are, chest models and the framed drawers' composites
  generated in the page) is kept by the renderer in IndexedDB under a name that hashes everything that went into
  it, so a second visit renders without a download; the jars are kept too, so another schematic needs at most the
  jars it adds. **Your own pack** instead: drop a launcher instance or mods folder, a Modrinth `.mrpack` or a
  CurseForge zip, or pick one in the File group. A plain resource-pack `.zip` dropped on the page goes on top.
- **The file.** Layer slicing, the roof, walls and floor toggles, hiding parts, the sign text and the per-layer counts
  of the build animation are all worked out in the page from the file in memory (`src/schematic.js`), which also
  renames framed drawers per material set so their composite models apply. A `.litematic`, `.schematic` or `.nbt` is
  converted to a Sponge schematic by the renderer's WASM (Nucleation) first.
- **The view.** View (fit to the fronts, perspective or isometric, Shot, Build, the shell toggles), Layers (all,
  single, below, above, a slider), Parts (from the plan's metadata: hover to light one up, hide, solo, fly to it),
  Block (click to pin: id, state, position, a sign's text, a painting, the metadata), Redstone (`?sim=on`: the
  renderer's simulator), File (open, copy link, the pack). Hover shows a tooltip. The link follows the view: the file,
  the shell, the hidden parts, the layer and the camera. Build downloads an animated GIF of the build going up a
  layer at a time. `?` lists the mouse and keyboard controls.

## Running it

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # the NBT codec and the schematic preparation (node --test)
npm run build      # the static site in dist/
```

Node 20 or later. The dev server also serves a plan folder read-only at `/plans/` (schematics, `.meta.json`,
`.paintings.json`, painting images), so `?schem=storage-hall.schem` opens a file from it; a bare name is also looked
for in its `fixtures/` and `framing-options/` subfolders. The folder is `BLOCKSCOPE_PLANS` (in the environment or a
`.env.local`), by default `../../server/storage-plan`, the storage plan of the server repository checked out beside
the folder that holds this one. Without it, open or drop a file.

## Parameters

| Parameter | Effect |
|---|---|
| `?schem=<path or URL>` | a plan file under the plans base (`VITE_PLANS_BASE`, default `/plans/`) or a URL on an allowed origin (the page's own, `https://gg.craftlabs.nexus`, `VITE_ALLOWED_ORIGINS`) |
| `?hide=roof,wall,floor`, `?roof=on`, `?roof=off` | the shell parts hidden at first (the roof starts hidden when it covers most of the footprint) |
| `?part=a,b`, `?hidePart=a,b` | only those parts, or those parts hidden (names as the Parts list spells them) |
| `?layer=below,N`, `?minY=M&maxY=N` | a layer mode at file layer N, or a layer range (N exclusive, negative from the top) |
| `?cam=px,py,pz,tx,ty,tz` | the camera and its pivot, world coordinates |
| `?sim=on` | the redstone simulator |
| `?pick=off` | no block picking (the renderer's) |

Build settings: `VITE_PLANS_BASE`, `VITE_ALLOWED_ORIGINS` (comma separated), `VITE_DEFAULT_PLAN` (the file opened
without `?schem=`; empty for none).

## Files

| File | Purpose |
|---|---|
| `index.html`, `src/main.js` | the page |
| `src/schematic.js`, `src/nbt.js` | the schematic in memory: NBT in the browser, info, shell, parts, signs, layer counts, the file the renderer gets |
| `src/parts.js`, `src/framed.js` | the plan's parts and shell from its metadata; framed drawers' ids per material set |
| `src/plans.js` | plan files: the schematic, its metadata and paintings |
| `src/paintings.js`, `src/buildgif.js` | the paintings overlay; the build animation's framing and GIF encoding |
| `src/pack/` | the pack: sources (packwiz or a dropped pack), the Mojang client jar, the build and the generated models, the page's IndexedDB, the renderer's stored packs |
| `vite.config.mjs` | the dev server (the plans route, cross-origin isolation headers) |
| `public/_headers` | the same headers for Cloudflare Pages |

## Where the game's files come from

The site serves none of the game's or the mods' assets. Your browser downloads the Minecraft client jar from
Mojang's servers, as a launcher does, and the mod jars from Modrinth by the hashes the pack lists, and keeps them
in its own storage (File, Resource pack, Forget downloads clears it). The Modrinth API is called on your action:
one batched lookup of the pack's file hashes.

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.

## License

AGPL-3.0-only (`LICENSE`): Blockscope includes the renderer, which is AGPL-3.0, in the same program. Source: this
repository, [the renderer](https://github.com/craftlabs-nexus/schematic-renderer) and
[Packrat](https://github.com/craftlabs-nexus/packrat) (MIT).
