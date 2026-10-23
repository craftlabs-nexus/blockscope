# Blockscope

A schematic viewer that is a static page: it reads a Minecraft schematic (`.schem`, `.schematic`, `.litematic`,
structure `.nbt`), builds a resource pack for it in your browser from Mojang's and Modrinth's own downloads, and
draws it with [`@craftlabs/schematic-renderer`](https://github.com/craftlabs-nexus/schematic-renderer), so modded
blocks show with their own textures. Nothing is uploaded and no server does any work: the host serves files.

It grew out of the CraftLabs storage plan's viewer, and was built around that plan's
files: the storage hall, the engine room and their test fixtures, with the generator's metadata (what each block
is for), parts and paintings. The plan's `gull-rock.schem` is the demo: a lighthouse on a rock in the sea, every floor
a part, a redstone cable up its stair, the keeper's log on its signs and three hidden keys, one for the layer slider,
one for the Roof toggle and one for Inspect.

## What it does

- **The pack.** Before the first jar is downloaded the page says what it will fetch and how much (the storage hall:
  87 MB the first time), then fetches the Minecraft client jar from Mojang (the version manifest, the version's
  JSON, the jar; sha1 checked) and the jars of the mods the schematic uses from Modrinth, through
  [Packrat](https://github.com/craftlabs-nexus/packrat) (`buildPlan`, then `fetchRows` with every listed hash
  checked). The jars come from the schematic's own mod list (below: exactly those jars, by version and hash), which
  says which jar has which block namespace. A file that lists no mods gets Minecraft's own blocks only; its modded
  blocks wait for the visitor's own pack (the page says so), where a jar's namespaces are learned once and
  remembered, and a namespace no remembered jar has is looked for in the jars whose slug, file name or title matches
  it. The merged
  pack (the client's block assets, the mods' assets as they are, chest models and the framed drawers' composites
  generated in the page) is kept by the renderer in IndexedDB under a name that hashes everything that went into
  it, so a second visit renders without a download; the jars are kept too, so another schematic needs at most the
  jars it adds. **Your own pack** instead: drop a launcher instance or mods folder, a Modrinth `.mrpack` or a
  CurseForge zip, or pick one in the File group. A plain resource-pack `.zip` dropped on the page goes on top.
- **The file.** Layer slicing, the roof, walls and floor toggles, hiding parts, the sign text and the per-layer counts
  of the build animation are all worked out in the page from the file in memory (`src/schematic.js`), which also
  renames framed drawers per material set so their composite models apply. A file is read by what it holds, not its
  name: a Sponge `.schem` as it is; a `.litematic` and a structure `.nbt` are turned into one in the page
  (`src/formats.js`; a Litematica file's regions are merged at their positions, a structure void or air never erasing
  another region's block); anything else, an MCEdit `.schematic`, by the renderer's WASM (Nucleation). The parts, the
  shell and what each block is for come from the generator's metadata: the file's own when it carries some (below),
  else a `<name>.meta.json` (opened or dropped with a file from disk; a plan file opened by its address finds it
  beside itself), else a Litematica file's regions as its parts. The Parts group's tooltip says which.
- **The view.** View (fit to the fronts, perspective, isometric or top: a flat plan straight down, every block the
  same size, drag pans, Q / E turn it a quarter, a block grid; Shot, Build, the shell toggles), Layers (all,
  single, below, above, a slider), Parts (from the metadata or a Litematica file's regions: hover to light one up,
  hide, solo, fly to it), Block (click to pin: id, state, position, a sign's text, a painting, the metadata), Redstone
  (signal digits: [Redstone Tweaks](https://modrinth.com/resourcepack/redstonetweaksresourcepack), MIT, fetched from
  Modrinth once and added on top of the pack, showing dust strength, repeater delays and comparator modes; `?sim=on`:
  the renderer's simulator), File (open, copy link, the pack). Hover shows a tooltip. The link follows the view: the
  file, the shell, the hidden parts, the layer and the camera; it can name only a file opened by its address, so Copy
  link is dimmed for a file from disk. Build downloads an animated GIF of the build going up a layer at a time. A
  resource pack dropped on the page, like Redstone Tweaks, goes above the built pack and wins over it. `?` lists the
  mouse and keyboard controls.
- **Materials.** What the blocks in view take (`src/materials/`): the layers drawn, less the hidden shell and parts,
  unless the list is pinned. The panel's group shows the biggest items; List (<kbd>M</kbd>) opens the sheet. A block
  counts as the item it is placed from (a wall sign is a sign, dust is redstone, a door or bed is one item, a double
  slab two, a water cauldron a cauldron and a bucket, a crop its seed from the block's loot table); water and lava
  sources and blocks with no item found are listed apart, never in the totals; a sign adds its dye, glow ink and wax,
  a framed drawer its three materials and one framing table. **Placed** lists those items, **Gather** breaks crafted
  ones down to what a person goes and gets (ingots, dyes, planks, stone, smelted things), **Raw** down to what is
  mined, grown or dropped. The recipes are the jars' own: the pack builder reads the client jar's and the mods'
  recipes, tags, names and item models while it builds the pack and writes them into it as
  `blockscope-materials.json` (`src/materials/book.js`), so they always match the pack; Fabric's conventional `c:`
  tags, which no fetched jar defines, fall back to the vanilla items they stand for. One recipe per item is chosen by
  cost (the stonecutter over the table, the table over the furnace); what a person gathers rather than makes
  (cobblestone, andesite, logs, ingots) is never broken down. **Have**: a number, or `2s`, `1sb`, `3b` (stacks,
  shulker boxes, 9-to-1 blocks), on any row, including a step in the middle of a recipe in the Tree tab (two iron
  blocks in hand for four anvils: 90 fewer ingots); a tick means all of it. Demand flows down the recipes in dependency
  order and each craft is rounded up to whole crafts, the spare kept. ▸ on a row makes that item from its ingredients
  and ▾ gets it as it is, whatever the rollup. Units: items, stacks or shulker boxes, and 9×9 for ingots and the like
  as blocks; the totals give stacks, shulker boxes and inventories. Group by part (with solo), by layer (bottom first,
  what you have handed to the lowest layers first) or by mod. Hovering a row lights its blocks up in the view and says
  what a made item goes into; hovering a block names its item and how many are in view. Have values, ticks and choices
  are kept per file (by its hash) in this browser; Copy, `.md`, `.csv` and `.json` export the list.

## Running it

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # the NBT codec, the formats and the schematic preparation (node --test)
npm run build      # the static site in dist/
```

Node 20 or later. The dev server can also serve a folder of plan files read-only at `/plans/` (schematics,
`.meta.json`, `.paintings.json`, painting images): set `BLOCKSCOPE_PLANS` to it, in the environment or a `.env.local`
(git ignores it), and `?schem=<name>` opens a file from it; a bare name is also looked for in its `fixtures/` and
`framing-options/` subfolders. `VITE_DEFAULT_PLAN` there names the file opened without `?schem=`. Without a folder,
open or drop a file.

```bash
# .env.local
BLOCKSCOPE_PLANS=../path/to/plans
VITE_DEFAULT_PLAN=some-file.schem
```

### With the renderer and Packrat checked out beside it

To change the renderer or Packrat and see it here without publishing, check them out beside this folder
(`../schematic-renderer`, `../packrat`; `BLOCKSCOPE_RENDERER`, `BLOCKSCOPE_PACKRAT` to point elsewhere) and run:

```bash
npm run dev:local  # http://localhost:5180, the first run installs both checkouts' dependencies
```

Packrat's TypeScript source is served as it is, so a change there reloads the page at once. The renderer is rebuilt
by its own `npm run build:watch` (the ES build with source maps, about 7 s) and the page reloads when the build is
done. `package.json` is untouched: `npm run dev`, `npm run build` and the deployed site use the published packages.
`BLOCKSCOPE_LINK=1 npm run build` builds the site against the checkouts (the renderer's `dist/` as last built).

## Parameters

| Parameter | Effect |
|---|---|
| `?schem=<path or URL>` | a plan file under the plans base (`VITE_PLANS_BASE`, default `/plans/`) or a URL on an allowed origin (the page's own, `https://gg.craftlabs.nexus`, `VITE_ALLOWED_ORIGINS`) |
| `?hide=roof,wall,floor`, `?roof=on`, `?roof=off` | the shell parts hidden at first (the roof starts hidden when it covers most of the footprint) |
| `?part=a,b`, `?hidePart=a,b` | only those parts, or those parts hidden (names as the Parts list spells them) |
| `?layer=below,N`, `?minY=M&maxY=N` | a layer mode at file layer N, or a layer range (N exclusive, negative from the top) |
| `?cam=px,py,pz,tx,ty,tz` | the camera and its pivot, world coordinates |
| `?at=x,y,z` | the block pinned in the Block panel, world coordinates (the address bar follows the pin; Copy in the Block panel, or <kbd>C</kbd>, copies it with this link) |
| `?focus=x,y,z`, `?focus=<part>` | the camera flies to that block (world coordinates; it is pinned) or part once the file is drawn |
| `?schem=https://files.craftlabs.nexus/<name>` | a shared file (`npm run share`, below) |
| `?agent=1` | development only: the pack is downloaded without the consent prompt, for agents (`AGENTS.md`) |
| `?sim=on` | the redstone simulator |
| `?pick=off` | no block picking (the renderer's) |

Build settings: `VITE_PLANS_BASE`, `VITE_ALLOWED_ORIGINS` (comma separated), `VITE_DEFAULT_PLAN` (the file opened
without `?schem=`; none unless set, and `gull-rock.schem` in a production build, from `.env.production`).

## Block metadata in the file

A schematic may carry its generator's metadata, so it needs no file beside it: a `BlockInfo` compound in a Sponge
file's `Metadata` (the format's place for an application's data), or at the root of a Litematica or structure file
(the game and Litematica ignore it). Version 1:

| Key | Type | Meaning |
|---|---|---|
| `Version` | int | 1 |
| `Origin` | int array | the world position of the file's cell 0, 0, 0 (x, y, z); a `.litematic` or `.nbt` takes it as its offset, so a cell has one position in every format |
| `Size` | int array | the box `Cells` counts in: width, height, length |
| `Records` | list of compounds | the distinct entries, each a compound of strings and lists of strings: `owner`, `role`, `item`, `part`, `shell` (roof, wall, floor), `ids`, ... |
| `Cells` | int array | one int per cell of the box, in the order (y × length + z) × width + x: 0 for a cell without an entry, else 1 + its index in `Records` |
| `Parts` | list of strings | optional: the parts in the order the Parts list shows them |

`part` names the part a block belongs to (else the `owner` before its first `:`), `shell` the shell part, and every
field is shown when the block is clicked. The CraftLabs storage plan's writer (`storage-plan/schemlib.mjs` in its
server repository) writes it into all three formats; the storage hall's 4,538 cells take 1,188 records, about 48 KB
of the file gzipped. The page leaves it out of the file the renderer gets.

## Mods in the file

A schematic may also name the mods its blocks need, so the page fetches exactly those jars: a `Mods` compound beside
`BlockInfo` (in a Sponge file's `Metadata`, at the root of the other formats). Version 1:

| Key | Type | Meaning |
|---|---|---|
| `Version` | int | 1 |
| `Minecraft` | string | the Minecraft version, for the client jar (`26.2`) |
| `Loader`, `LoaderVersion` | strings | optional: the mod loader (`fabric`) and its version |
| `List` | list of compounds | per mod: `Name`, `ModId`, `Project` and `VersionId` (Modrinth's), `File`, `Url`, `Size`, `Sha512`, `Sha1`, and `Namespaces` (list of strings: the namespaces of the file's blocks this jar provides) |

The page builds from the list (a namespace it does not cover is reported as missing); a pack the visitor dropped
wins. There is no other default: a file without a list needs the visitor's pack for its modded blocks. Since a file is anyone's, only an entry whose `Url` is on Modrinth's CDN
(`https://cdn.modrinth.com/data/<project>/versions/<version>/<file>`) and that has a `Sha512` is used, and every jar
is checked against its hash. The download prompt names the jars "as the file lists them". A Sponge file also carries
Sponge's own `RequiredMods` (the mod ids) and a `Description`, which shows in the file name's tooltip. The storage
plan's writer pins the jars from its pack (`storage-plan/pack-mods.json`); the hall lists 13 mods.

## Deploying (Cloudflare Workers, static assets)

The site is static: a Worker with static assets and no script (`wrangler.jsonc`, `assets.directory` `./dist`).
Cloudflare's Git integration (Workers Builds) builds and deploys it from this repository: branch `master`, build
command `npm run build`, deploy command `npx wrangler deploy`, preview command the default (`npx wrangler preview`)
for other branches; no build variables (`.node-version` pins Node 24; Node 20 or later works). `public/_headers` sets the
cross-origin isolation headers, and a path that is no file answers 404. Check a build locally with `npm run build`
then `npx wrangler dev` (or `npx wrangler deploy --dry-run`). The site's own plan files are in `public/plans/`
(served at `/plans/`): the Gull Rock lighthouse, `gull-rock.schem` with its paintings, copied from the storage plan,
which the site opens by default (`.env.production`); `?schem=` opens any other file there or on an allowed origin.

## Sharing a file

Schematics to share live outside this repository, in the R2 bucket `blockscope-files` behind
`https://files.craftlabs.nexus` (an allowed origin; the bucket's CORS rules are `scripts/r2-cors.json`):

```bash
npm run share -- C:\path	o\design.litematic   # uploads it with design.schem (and design.meta.json) beside it
npm run share -- --delete design                 # takes every format of it down
```

It prints the link to send, `https://blockscope.craftlabs.nexus/?schem=https://files.craftlabs.nexus/design.schem`.
The page's File group has a Download row for a file opened by its address: the file, and the same design's
`.schem`, `.litematic` or `.nbt` beside it. The script needs wrangler signed in to the Cloudflare account
(`npx wrangler login`, or run it where wrangler already is, such as WSL: `node scripts/share.mjs <file>`); `--dir`
puts files under a folder, `--only` leaves the other formats out.

## Files

| File | Purpose |
|---|---|
| `index.html`, `src/main.js` | the page |
| `src/schematic.js`, `src/nbt.js` | the schematic in memory: NBT in the browser, info, shell, parts, signs, layer counts, the file the renderer gets |
| `src/formats.js` | Litematica and structure files turned into Sponge ones, and the block metadata, mod list and description a file carries |
| `src/parts.js`, `src/framed.js` | the plan's parts and shell from its metadata; framed drawers' ids per material set |
| `src/plans.js` | plan files: the schematic, its metadata and paintings |
| `src/paintings.js`, `src/buildgif.js` | the paintings overlay; the build animation's framing and GIF encoding |
| `src/materials/` | the materials list: the recipe book read from the jars (`book.js`), blocks to items, counting and rolling up (`engine.js`, no DOM), item icons from the pack's textures (`icons.js`), the group and the sheet (`panel.js`) |
| `src/pack/` | the pack: sources (packwiz or a dropped pack), the Mojang client jar, the build and the generated models, the page's IndexedDB, the renderer's stored packs |
| `vite.config.mjs` | the dev server (the plans route, cross-origin isolation headers, the checkouts with `BLOCKSCOPE_LINK`) |
| `scripts/dev-local.mjs` | `npm run dev:local`: the renderer's watch build and the dev server against the checkouts beside this one |
| `scripts/share.mjs`, `scripts/r2-cors.json` | `npm run share`: a schematic up to (or down from) the files bucket, and the bucket's CORS rules |
| `public/_headers` | the same headers for Cloudflare Pages |
| `public/plans/`, `.env.production` | the site's own plan files (the Gull Rock lighthouse and its paintings) and the file it opens by default |

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
