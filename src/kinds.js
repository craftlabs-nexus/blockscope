// Kinds and types: two more ways to pick blocks out besides parts. A type is a block's id with its state left out
// (every oak stairs, whichever way it faces). A kind is a family of blocks that belong together in a build: its
// redstone, its lighting, its storage, its terrain, the roof. A block can be of several kinds (a hopper is storage and
// redstone) or of none. Most kinds go by the id alone; two look at the neighbours too. Redstone takes the plain blocks
// its components stand on, point into, watch, read, push or feed. Trees take the logs that touch their leaves.
// Both look one step out, with no signal followed.

/** A name made of the words of an id: `(^|:|_)word(_|$)`, so "rail" is not "railing". */
const words = (list) => new RegExp(`(^|[:_])(${list})(?=$|_)`);
const MODDED = /^(?!minecraft:)/;
const modded = (t) => (id) => MODDED.test(id) && (typeof t === "function" ? t(id) : t.test(id));
const either = (...tests) => (id) => tests.some((t) => (typeof t === "function" ? t(id) : t.test(id)));

const REDSTONE_CORE = /^minecraft:(redstone_wire|repeater|comparator|observer|redstone_(wall_)?torch|redstone_block|lever|.*_button|.*_pressure_plate|tripwire(_hook)?|daylight_detector|target|note_block|(sticky_)?piston|piston_head|moving_piston|dispenser|dropper|hopper|powered_rail|detector_rail|activator_rail|redstone_lamp|tnt|trapped_chest|iron_door|iron_trapdoor|(calibrated_)?sculk_sensor|sculk_shrieker|.*copper_bulb|crafter|.*lightning_rod)$/;
const STORAGE = /^minecraft:(chest|trapped_chest|ender_chest|.*copper_chest|barrel|.*shulker_box|hopper|dropper|dispenser|(blast_)?furnace|smoker|brewing_stand|chiseled_bookshelf|decorated_pot)$/;
// a tree's crown: leaves, and a nether fungus's wart blocks and a huge mushroom's caps
const LEAVES = either(/^(?!minecraft:potted_).*(_leaves|_sapling|_blossoms)$/, /^minecraft:(mangrove_roots|muddy_mangrove_roots|mangrove_propagule|(flowering_)?azalea|nether_wart_block|warped_wart_block|(brown|red)_mushroom_block)$/);
// the wood a tree is made of: a tree's when it touches its leaves or another such log
// (the bamboo plant is a plant: a grove under a jungle tree is no tree)
const LOG = /_log$|_wood$|_hyphae$|^minecraft:stripped_|^minecraft:(crimson_stem|warped_stem|mushroom_stem|bamboo_block)$|^(?!minecraft:).*_stem$/;
// shaped blocks are building, never terrain
const SHAPED = /stairs|slab|_wall$|bricks?|tiles?|fence|button|pressure_plate|polished|smooth|chiseled|cut_/;

/**
 * The kinds, in the order of their bits (a cell's kinds are a 16-bit mask). `ids` tells the members by id; the shell
 * kinds come from the shell (metadata, or the roofed box's outside), Trees and Redstone add neighbours as said above.
 */
export const KINDS = [
  { key: "redstone", name: "Redstone", tip: "dust, repeaters, comparators, observers, pistons, hoppers, levers and the like, and the blocks they stand on, point into, watch, read, push or feed (one step; no signal is followed)",
    ids: either(REDSTONE_CORE, modded(/redstone|(^|[:_])(relay|gearshift|comparator)(?=$|_)/)) },
  { key: "lighting", name: "Lighting", tip: "torches, lanterns, lamps, candles, glowstone, sea lanterns, froglights, end rods",
    ids: either(/^minecraft:((soul_|copper_)?(wall_)?torch|.*lantern|glowstone|shroomlight|end_rod|.*candle(_cake)?|(soul_)?campfire|.*froglight|glow_lichen|beacon|redstone_lamp|.*copper_bulb)$/,
      modded(/(^|[:_])(lamps?|lights?(?!_(gray|grey|blue|oak|wood|planks))|lanterns?|candles?|torch(es)?|chandeliers?|sconces?)(?=$|_)/)) },
  { key: "storage", name: "Storage", tip: "chests, barrels, shulker boxes, hoppers, furnaces, drawers and crates",
    ids: either(STORAGE, /^storagedrawers:/, modded(words("drawers?|chests?|barrels?|crates?|storage"))) },
  { key: "stations", name: "Stations", tip: "crafting tables, furnaces, anvils, stonecutters, looms, lecterns, cauldrons, composters and other blocks you work at",
    ids: either(/^minecraft:(crafting_table|.*anvil|stonecutter|loom|smithing_table|grindstone|enchanting_table|cartography_table|fletching_table|lectern|jukebox|composter|bell|(.*_)?cauldron|beehive|bee_nest|respawn_anchor|lodestone|(blast_)?furnace|smoker|brewing_stand|crafter)$/,
      // a modded table is furniture and a pot holds a plant: the work blocks are named for their work
      modded(either(words("crafting_table|work_?bench|stations?|stoves?|cooking_pot|ovens?|sinks?|infusers?|waystones?|cutting_board|anvils?|altars?|presses?|mills?"), /:(crafting|enchanting|alchemy|brewing|sawmill|smithing)_/))) },
  { key: "trees", name: "Trees", tip: "leaves and saplings, and the logs that touch the leaves (or such a log)", ids: LEAVES },
  { key: "plants", name: "Plants", tip: "grass, flowers, ferns, vines, crops, mushrooms, cactus, sugar cane, kelp, coral",
    ids: either(/^minecraft:(short_grass|grass|tall_grass|(short|tall)_dry_grass|fern|large_fern|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower(_crop)?|pitcher_(plant|crop)|sunflower|lilac|rose_bush|peony|.*_petals|wildflowers|leaf_litter|vine|.*_vines(_plant)?|(pale_)?moss_carpet|.*_mushroom|.*_fungus|(crimson|warped|hanging)_roots|sugar_cane|cactus(_flower)?|bamboo(_sapling)?|kelp(_plant)?|(tall_)?seagrass|lily_pad|sweet_berry_bush|(.*_)?bush|wheat|carrots|potatoes|beetroots|(attached_)?(melon|pumpkin)_stem|cocoa|nether_wart|spore_blossom|(big|small)_dripleaf(_stem)?|.*_coral(_wall)?(_fan)?|.*_flower)$/,
      modded(/(^|[:_])(grass(?!_block)|ferns?|flowers?|cattails?|reeds?|clover|cosmos|fronds?|litter)(?=$|_)/)) },
  { key: "water", name: "Water", tip: "water, lava and bubble columns (not waterlogged blocks)", ids: /^minecraft:(water|lava|bubble_column|water_cauldron|lava_cauldron)$/ },
  { key: "terrain", name: "Terrain", tip: "the ground as the world makes it: stone, dirt, grass blocks, sand, gravel, ores, snow and ice (never a shaped block: bricks, stairs, slabs, walls)",
    ids: (id) => !SHAPED.test(id) && (/^minecraft:(stone|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|.*nylium|dirt_path|mud|packed_mud|clay|sand|red_sand|gravel|sandstone|red_sandstone|deepslate|cobbled_deepslate|tuff|calcite|andesite|diorite|granite|.*_ore|netherrack|basalt|blackstone|soul_sand|soul_soil|end_stone|obsidian|bedrock|(pale_)?moss_block|snow|snow_block|ice|packed_ice|blue_ice|.*dripstone.*|magma_block|cobblestone|mossy_cobblestone|suspicious_(sand|gravel))$/.test(id)
      || modded(/_sand$|_moss_block$|_soil$|_stone$|_nylium$|^mcwpaths:.*_path_block$/)(id)) },
  { key: "glass", name: "Glass", tip: "glass blocks and panes, and windows", ids: /glass|window/ },
  { key: "fences", name: "Fences & walls", tip: "fences, walls, iron bars, chains and railings",
    ids: either(/_fence$|_wall$|^minecraft:(.*_bars|.*chain)$|^mcwfences:/, modded(/railing|(^|[:_])fences?(?=$|_)/)) },
  { key: "openings", name: "Openings", tip: "doors, trapdoors and gates", ids: either(/_door$|_trapdoor$|_fence_gate$|^mcwdoors:/, modded(words("doors?|gates?"))) },
  { key: "signs", name: "Signs", tip: "signs, hanging signs and banners", ids: either(/_sign$|_banner$/, modded(words("signs?|banners?|labels?"))) },
  { key: "rails", name: "Rails", tip: "rails of every kind", ids: either(/^minecraft:(rail|powered_rail|detector_rail|activator_rail)$/, modded(words("rails?"))) },
  { key: "roof", name: "Roof", tip: "the roof (the file's metadata, or a roofed box's top layer)", shell: "roof" },
  { key: "wall", name: "Walls", tip: "the outer walls (the file's metadata, or a roofed box's sides)", shell: "wall" },
  { key: "floor", name: "Floor", tip: "the floor (the file's metadata, or a roofed box's bottom layer)", shell: "floor" },
];
// a cell's kinds are 16 bits (a Uint16Array, and 16 bits of a cell group's key in codeGroups)
if (KINDS.length > 16) throw new Error(`kinds.js: ${KINDS.length} kinds do not fit a 16-bit mask`);
export const KIND_BIT = Object.fromEntries(KINDS.map((k, i) => [k.key, 1 << i]));
const RED = KIND_BIT.redstone, TREES = KIND_BIT.trees, STORAGE_BIT = KIND_BIT.storage;

/** Why a block is Redstone (classify's `reason`, by code: 1 a component itself, more a neighbour of one). */
export const REDSTONE_REASONS = [null, "a component", "holds a component", "powered by a component", "watched by an observer", "read by a comparator", "pushed by a piston", "fed by a hopper or dropper", "worked by a component"];
const R = { core: 1, holds: 2, powered: 3, watched: 4, read: 5, pushed: 6, fed: 7, worked: 8 };

// what the neighbour rules ask of a block
const NOT_SOLID = /glass|slab|stairs|fence|_wall$|pane|door|leaves|torch|sign|banner|button|lever|rail|carpet|pressure_plate|flower|grass(?!_block)|fern|water|lava|ladder|vine|chain|bars|lantern|candle|pot$|potted_|head$|skull$|_bed$|scaffolding|^minecraft:snow$|cobweb|sapling|mushroom$|coral|kelp|seagrass|bush|petals|roots|dripleaf|plant|tripwire|redstone_wire|repeater|comparator|chest$|cauldron|lectern|campfire|anvil|bell$|cake|composter|brewing_stand|enchanting_table|grindstone|stonecutter|end_rod|conduit|_shelf$/;
// what a piston breaks rather than moves (it ends the line it pushes)
const BREAKS = /torch|flower|grass(?!_block)|fern|sapling|mushroom$|vine|carpet|ladder|lever|button|redstone_wire|repeater|comparator|pressure_plate|tripwire|_bed$|door|cake|candle|lantern|cobweb|^minecraft:snow$|bush|seagrass|kelp|coral|dripleaf|petals|roots|potted_|flower_pot|^minecraft:(pumpkin|melon|carved_pumpkin|jack_o_lantern)$/;
const READABLE = /jukebox|lectern|cake|composter|beehive|bee_nest|cauldron|respawn_anchor|end_portal_frame|chiseled_bookshelf|drawer|crafter/;
const IMMOVABLE = /obsidian|bedrock|respawn_anchor|reinforced_deepslate|end_portal|end_gateway|spawner|enchanting_table|beacon|jukebox|lectern|_sign$|_banner$|bell$|conduit|barrier|command_block|structure_block|jigsaw|_head$|_skull$/;
const WORKED = /_door$|_trapdoor$|_fence_gate$|note_block$|bell$|tnt$|redstone_lamp$|copper_bulb$|dispenser$|dropper$|piston$/;
// the components that give power (the one hop goes from these): not a hopper, a lamp, a door or a piston, which take it
const POWERS = /:(redstone_wire|repeater|comparator|observer|redstone_(wall_)?torch|redstone_block|lever|.*_button|.*_pressure_plate|tripwire_hook|daylight_detector|target|(calibrated_)?sculk_sensor|detector_rail|trapped_chest|.*lightning_rod)$/;
const DIRS = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const SIDES = ["north", "south", "east", "west"];
const SIX = Object.values(DIRS);

const baseId = (key) => key.replace(/\[.*$/, "");
const propsOf = (key) => { const m = /\[(.*)\]$/.exec(key); return m ? Object.fromEntries(m[1].split(",").map((kv) => kv.split("="))) : {}; };

/** The kinds bits of a block id by id alone (Trees' logs and the shell are added by `classify`). */
export function kindsOfId(id) {
  let m = 0;
  KINDS.forEach((k, b) => { if (k.ids && (typeof k.ids === "function" ? k.ids(id) : k.ids.test(id))) m |= 1 << b; });
  return m;
}

/**
 * Each cell's kinds, in one pass over the file: `{ mask: Uint16Array (KINDS bits a cell), reason: Uint8Array
 * (REDSTONE_REASONS code a cell), counts: [cells of each kind], nonAir, listed: [kind keys worth a row], shown }`.
 * `shellCells`: Map of cell index -> "roof" | "wall" | "floor" (Schematic.shellOf). `meta` (a BlockMeta over the
 * file's box, optional): a record's `kind` (a key or a list of keys) adds those kinds to its cells.
 */
export function classify(schem, { shellCells = new Map(), meta = null } = {}) {
  const { width: W, length: L, keys, data } = schem, layer = W * L, n = data.length;
  const P = keys.length, base = new Uint16Array(P), isAir = new Uint8Array(P), isLog = new Uint8Array(P), isLeaf = new Uint8Array(P);
  const solid = new Uint8Array(P), readable = new Uint8Array(P), immovable = new Uint8Array(P), worked = new Uint8Array(P), breaks = new Uint8Array(P), props = new Array(P), ids = new Array(P);
  keys.forEach((k, p) => {
    if (!k || schem.air.has(p)) { isAir[p] = 1; return; }
    const id = baseId(k); ids[p] = id; props[p] = propsOf(k);
    base[p] = kindsOfId(id);
    isLeaf[p] = base[p] & TREES ? 1 : 0;
    isLog[p] = LOG.test(id) ? 1 : 0;
    solid[p] = !NOT_SOLID.test(id) && !(base[p] & RED) ? 1 : 0;
    readable[p] = base[p] & STORAGE_BIT || READABLE.test(id) ? 1 : 0;
    immovable[p] = base[p] & STORAGE_BIT || IMMOVABLE.test(id) ? 1 : 0;
    worked[p] = WORKED.test(id) ? 1 : 0;
    breaks[p] = BREAKS.test(id) ? 1 : 0;
  });
  // a neighbour's index, or -1 off the box
  const step = (i, [dx, dy, dz], k = 1) => {
    const x = (i % W) + dx * k, z = (Math.floor(i / W) % L) + dz * k, y = Math.floor(i / layer) + dy * k;
    return x < 0 || z < 0 || y < 0 || x >= W || z >= L || y >= schem.height ? -1 : (y * L + z) * W + x;
  };

  const mask = new Uint16Array(n), reason = new Uint8Array(n), core = [];
  // the game version the file was saved by (1.16 is data version 2566); a file that does not say is taken as newer
  const dataVersion = Number(schem.root?.DataVersion?.v ?? schem.root?.DataVersion ?? 0), oldWire = dataVersion > 0 && dataVersion < 2566;
  let logs = 0, nonAir = 0;
  for (let i = 0; i < n; i++) {
    const p = data[i]; if (isAir[p]) continue;
    nonAir++;
    const m = base[p]; mask[i] = m;
    if (m & RED) { reason[i] = R.core; core.push(i); }
    if (isLog[p]) logs++;
  }

  // Trees: the logs that touch leaves, and the trunk under them: from those, down through upright logs only. A trunk
  // stands; a hedge against a log cabin takes the logs it touches, not the cabin's frame along its lying logs.
  if (logs) {
    const queue = new Int32Array(logs); let head = 0, tail = 0;
    const upright = (p) => !props[p]?.axis || props[p].axis === "y";
    const take = (j, standing) => { if (j >= 0 && isLog[data[j]] && !(mask[j] & TREES) && (!standing || upright(data[j]))) { mask[j] |= TREES; queue[tail++] = j; } };
    for (let i = 0; i < n; i++) if (isLeaf[data[i]]) for (const d of SIX) take(step(i, d), false);
    while (head < tail) { const i = queue[head++]; if (upright(data[i])) take(step(i, DIRS.down), true); }
  }

  // Redstone: the neighbours of its components
  const pull = (j, why) => { if (j < 0 || isAir[data[j]] || mask[j] & RED) return; mask[j] |= RED; reason[j] = why; };
  const pullIf = (j, test, why) => { if (j >= 0 && test[data[j]]) pull(j, why); };
  const back = (d) => d.map((v) => -v);
  for (const i of core) {
    const p = data[i], id = ids[p], pr = props[p], f = DIRS[pr.facing];
    const below = step(i, DIRS.down), above = step(i, DIRS.up);
    if (/:(redstone_wire|repeater|comparator|redstone_torch|.*_pressure_plate|powered_rail|detector_rail|activator_rail)$/.test(id)) pull(below, R.holds);
    if (/_button$|:lever$/.test(id)) pull(pr.face === "floor" ? below : pr.face === "ceiling" ? above : f ? step(i, back(f)) : -1, R.holds);
    if (/:(redstone_wall_torch|tripwire_hook)$/.test(id) && f) pull(step(i, back(f)), R.holds);
    if (/:redstone_(wall_)?torch$/.test(id)) pullIf(above, solid, R.powered);
    if (/:redstone_wire$/.test(id)) {
      // a wire with no side connected: before 1.16 that was a cross (it powered all four sides), since then a dot that
      // powers only what it stands on (an unconnected cross is written with every side "side")
      const cross = oldWire && SIDES.every((s) => !pr[s] || pr[s] === "none");
      for (const s of SIDES) if (cross || pr[s] === "side" || pr[s] === "up") pullIf(step(i, DIRS[s]), solid, R.powered);
    }
    if (/:(repeater|comparator)$/.test(id) && f) pullIf(step(i, back(f)), solid, R.powered);   // the output: opposite its facing
    if (/:comparator$/.test(id) && f) {
      const behind = step(i, f), further = step(i, f, 2);   // the input side: its facing
      if (behind >= 0 && readable[data[behind]]) pull(behind, R.read);
      else if (behind >= 0 && solid[data[behind]] && further >= 0 && readable[data[further]]) { pull(behind, R.read); pull(further, R.read); }
    }
    if (/:observer$/.test(id) && f) { pull(step(i, f), R.watched); pullIf(step(i, back(f)), solid, R.powered); }
    // a retracted piston pushes the line in front of it; an extended one has pushed it, and a sticky one pulls back the
    // block stuck to its head. A block a piston breaks (a plant, a torch) is moved out of the way and ends the line.
    if (/:(sticky_)?piston$/.test(id) && f && pr.extended !== "true") {
      for (let k = 1, moved = 0; k <= 13 && moved < 12; k++) {
        const j = step(i, f, k); if (j < 0 || isAir[data[j]]) break;
        if (immovable[data[j]]) break;
        pull(j, R.pushed); moved++;
        if (breaks[data[j]]) break;
      }
    }
    if (/:sticky_piston$/.test(id) && f && pr.extended === "true") { const j = step(i, f, 2); if (j >= 0 && !immovable[data[j]] && !breaks[data[j]]) pull(j, R.pushed); }
    if (/:hopper$/.test(id)) { if (f) pullIf(step(i, f), readable, R.fed); pullIf(above, readable, R.fed); }
    if (/:dropper$/.test(id) && f) pullIf(step(i, f), readable, R.fed);   // a dispenser throws items out, a dropper puts them in
  }
  // one hop: doors, lamps, note blocks and the like beside a component that gives power; a door's other half with it
  for (const i of core) {
    if (!POWERS.test(ids[data[i]])) continue;
    for (const d of SIX) {
      const j = step(i, d); if (j < 0 || !worked[data[j]] || mask[j] & RED) continue;
      pull(j, R.worked);
      if (/_door$/.test(ids[data[j]])) for (const v of [DIRS.up, DIRS.down]) { const k = step(j, v); if (k >= 0 && ids[data[k]] === ids[data[j]]) pull(k, R.worked); }
    }
  }

  // the shell, and kinds the metadata names
  for (const [i, role] of shellCells) if (KIND_BIT[role]) mask[i] |= KIND_BIT[role];
  // (over the file's cells, whatever box the metadata covers: a record's kinds worked out once)
  if (meta?.records?.some((m) => m?.kind)) {
    const recordAt = schem.recordReader(meta), bits = new Map();
    for (let i = 0; i < n; i++) {
      const m = recordAt(i); if (!m?.kind) continue;
      let b = bits.get(m); if (b === undefined) bits.set(m, (b = [m.kind].flat().reduce((a, k) => a | (KIND_BIT[k] ?? 0), 0)));
      mask[i] |= b;
    }
  }

  const counts = new Array(KINDS.length).fill(0);
  for (let i = 0; i < n; i++) { let m = mask[i]; while (m) { const b = 31 - Math.clz32(m); counts[b]++; m &= ~(1 << b); } }
  const { listed, shown } = kindsShown(counts, nonAir);
  return { mask, reason, counts, nonAir, listed, shown };
}

// When kinds can tell a file's blocks apart: not in a handful of blocks, nor when nearly everything is one kind.
export const KINDS_MIN_BLOCKS = 64, KINDS_MIN_SECOND = 8;
/** Which kinds get a row (two cells or more), and whether the Kinds list shows at all: a file of 64 blocks or more,
 *  with two kinds listed, the second largest of 8 cells or more. */
export function kindsShown(counts, nonAir) {
  const listed = KINDS.filter((k, b) => counts[b] >= 2).map((k) => k.key);
  const sizes = listed.map((k) => counts[KINDS.findIndex((x) => x.key === k)]).sort((a, b) => b - a);
  return { listed, shown: nonAir >= KINDS_MIN_BLOCKS && listed.length >= 2 && sizes[1] >= KINDS_MIN_SECOND };
}

/** The kinds a mask holds, as keys. */
export const kindsOfMask = (m) => KINDS.filter((k, b) => m & (1 << b)).map((k) => k.key);

/**
 * The file's types (block ids, the state left out), most blocks first: `{ types: [{ id, name, mod, count }],
 * ofPalette: Uint16Array (a palette index's type index + 1; 0 for air) }`.
 */
export function typesOf(schem) {
  const { keys, data } = schem, perPalette = new Float64Array(keys.length);
  for (let i = 0; i < data.length; i++) perPalette[data[i]]++;
  const byId = new Map();
  keys.forEach((k, p) => {
    if (!k || schem.air.has(p) || !perPalette[p]) return;
    const id = baseId(k), t = byId.get(id) ?? { id, name: id.replace(/^[^:]*:/, "").replace(/_/g, " "), mod: id.includes(":") && !id.startsWith("minecraft:") ? id.split(":")[0] : null, count: 0, palette: [] };
    t.count += perPalette[p]; t.palette.push(p); byId.set(id, t);
  });
  const types = [...byId.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const ofPalette = new Uint16Array(keys.length);
  types.forEach((t, i) => { for (const p of t.palette) ofPalette[p] = i + 1; delete t.palette; });
  return { types, ofPalette };
}

/**
 * Each cell's group as the renderer takes it, one 16-bit number a cell: the place of the cell's (part, kinds, type) in
 * a table of the combinations the file has, so hiding a part, a kind or a type is hiding the groups that hold it, with
 * no new mesh. `part`: each cell's part (its place in the Parts list + 1, 0 for none); `mask`: each cell's kinds
 * (classify); `ofPalette`: each palette index's type + 1 (typesOf). Air is group 0. Returns `{ groups, part, kinds,
 * type, size, typed }`, the table's columns by group. Past `limit` combinations the type is left out of the code
 * (`typed` false): hiding a type then needs the file loaded again without it.
 */
export function codeGroups(schem, part, mask, ofPalette, limit = 65535) {
  const n = schem.data.length, data = schem.data, groups = new Uint16Array(n);
  const air = new Uint8Array(schem.keys.length); for (const p of schem.air) air[p] = 1;
  const code = (withType) => {
    const index = new Map(), tPart = [0], tKinds = [0], tType = [0];
    let lastKey = -1, lastG = 0;
    for (let i = 0; i < n; i++) {
      const p = data[i]; if (air[p] || !schem.keys[p]) { groups[i] = 0; continue; }
      const t = withType ? ofPalette[p] : 0, key = (part[i] * 65536 + mask[i]) * 65536 + t;
      if (key !== lastKey) {
        let g = index.get(key);
        if (g === undefined) {
          g = tPart.length; if (g > limit) return null;
          index.set(key, g); tPart.push(part[i]); tKinds.push(mask[i]); tType.push(t);
        }
        lastKey = key; lastG = g;
      }
      groups[i] = lastG;
    }
    return { groups, part: Uint16Array.from(tPart), kinds: Uint16Array.from(tKinds), type: Uint16Array.from(tType), size: tPart.length };
  };
  const typed = code(true);
  if (typed) return { ...typed, typed: true };
  const untyped = code(false);
  if (untyped) return { ...untyped, typed: false };
  // more parts × kinds than the code holds: not a file anyone has made; the parts are left out too, and past that
  // (it cannot be: 16 bits of kinds) every block shares one group, so nothing can be hidden but nothing breaks
  part = new Uint16Array(n);
  const kindsOnly = code(false);
  if (kindsOnly) return { ...kindsOnly, typed: false };
  groups.fill(0);
  return { groups, part: new Uint16Array(1), kinds: new Uint16Array(1), type: new Uint16Array(1), size: 1, typed: false };
}

/**
 * The cells hidden, as a lookup a cell at a time rather than a list: a cell is hidden when its group is (`flags`, one
 * byte a group), or when `extra(i)` says so (a type hidden in a file whose groups leave types out). It answers `has`
 * as the Set of cell indices it stands for would.
 */
export class HiddenCells {
  constructor(groups, flags, extra = null) { this.groups = groups; this.flags = flags; this.extra = extra; }
  has(i) { return this.flags[this.groups[i]] === 1 || (this.extra !== null && this.extra(i)); }
}

// The materials list grouped by kind: each block counts once, in the first of its kinds in this order (what a block
// is for before what it is part of: a sea lantern in the roof is lighting, a stone floor is the floor, not terrain).
export const KIND_ORDER = ["redstone", "storage", "stations", "lighting", "signs", "openings", "rails", "glass", "fences", "water", "plants", "trees", "roof", "wall", "floor", "terrain"];
/** Each cell's first kind in KIND_ORDER, as its place there (KIND_ORDER.length for a block of no kind). */
export function firstKinds(mask) {
  const bits = KIND_ORDER.map((k) => KIND_BIT[k]), none = KIND_ORDER.length, byMask = new Map();
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i];
    let g = byMask.get(m);
    if (g === undefined) { g = bits.findIndex((b) => m & b); if (g < 0) g = none; byMask.set(m, g); }
    out[i] = g;
  }
  return out;
}

// Families: the types that differ only by a dye colour, a wood or copper's weathering (every concrete, every wooden
// stairs, every copper block), folded into one row of the Types list.
const COLOURS = "white|light_gray|gray|black|brown|red|orange|yellow|lime|green|cyan|light_blue|blue|purple|magenta|pink";
const WOODS = "oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped";
// copper's weathering, waxed or not: a prefix on its own (copper blocks, cut copper, lightning rods, bulbs, chests)
const WEATHERED = /^(waxed_)?(exposed_|weathered_|oxidized_)?/;
const COLOURED = new RegExp(`^(${COLOURS})_(?=.)`), WOODEN = new RegExp(`^(stripped_)?(${WOODS})_(?=.)`);
// the blocks the game dyes in every colour: their colours are a family even where the file has only one of them
const DYED = /^(wool|carpet|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|shulker_box|bed|banner|wall_banner|candle|candle_cake|dye)$/;
// a wood's own parts read plainly ("planks"); anything else made of it is "wooden …"
const WOOD_PARTS = /^(planks|log|wood|leaves|sapling|hyphae|stem|block|mosaic)$/;
// what the nether's crimson and warped name that is no wood: their nylium, fungus, roots and wart
const NOT_WOOD = /^(nylium|fungus|roots|wart_block)$/;
/**
 * A type's family: `{ key, name, by }` (key "namespace:rest"; by "colour", "wood" or "weathering"), or the type on its
 * own (`by` null): the plain member of a family (terracotta, a copper chest) joins it under its own key.
 */
export function familyOf(id) {
  const [ns, path] = id.includes(":") ? id.split(":") : ["minecraft", id];
  const own = { key: `${ns}:${path}`, name: path.replace(/_/g, " "), by: null };
  const weathered = path.replace(WEATHERED, "");
  if (/copper|lightning_rod/.test(weathered)) {
    // the copper block's own id keeps "_block", its weathered ones drop it (exposed_copper)
    const rest = weathered === "copper_block" ? "copper" : weathered;
    return { key: `${ns}:${rest}`, name: rest.replace(/_/g, " "), by: weathered === path ? null : "weathering" };
  }
  const c = COLOURED.exec(path);
  if (c) { const rest = path.slice(c[0].length); return { key: `${ns}:${rest}`, name: rest.replace(/_/g, " "), by: "colour", dyed: DYED.test(rest) }; }
  const w = WOODEN.exec(path);
  if (w) {
    const stripped = w[1] ?? "", rest = path.slice(w[0].length);
    if (NOT_WOOD.test(rest)) return own;
    const name = WOOD_PARTS.test(rest) ? `${stripped}${rest}` : `wooden ${stripped}${rest}`;
    return { key: `${ns}:${name.replace(/ /g, "_")}`, name: name.replace(/_/g, " "), by: "wood" };
  }
  return own;
}
/**
 * The families of `types` (typesOf's, most blocks first) with two members or more, most blocks first:
 * `[{ key, name, mod, count, members: [type ids] }]`; a type in none is left out. A colour family needs two colours
 * of the block, or a block the game dyes (so red sand does not fold into sand, nor red nether bricks into nether bricks).
 */
export function familiesOf(types) {
  const by = new Map();
  for (const t of types) {
    const f = familyOf(t.id); let e = by.get(f.key);
    if (!e) by.set(f.key, (e = { key: f.key, name: f.name, mod: t.mod, count: 0, members: [], colours: 0, other: 0, dyed: false }));
    e.count += t.count; e.members.push(t.id);
    if (f.by === "colour") { e.colours++; e.dyed ||= f.dyed; } else if (f.by) e.other++;
  }
  return [...by.values()]
    .filter((e) => e.members.length >= 2 && (e.other >= 1 || e.colours >= 2 || (e.colours >= 1 && e.dyed)))
    .map(({ colours, other, dyed, ...e }) => e)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
