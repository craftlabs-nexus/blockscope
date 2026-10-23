// Where the mod jars come from: a pack the visitor drops (a launcher folder, an .mrpack, a CurseForge zip, read by
// Packrat); else the mods the schematic file lists itself (its Mods compound). A file that lists none gets Minecraft's
// own blocks only, and its modded blocks wait for the visitor's pack. A source says which Minecraft version it is for,
// gives an id that changes when its files do (part of the merged pack's name), and analyzes itself into Packrat's
// entries when a pack has to be built.

// the version for a file that does not name one (its client jar)
export const DEFAULT_MINECRAFT = "26.2";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256Text = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** No mods: the client jar's blocks only, for a file that lists no mods. `none` tells the build to fetch no jars. */
export function noModsSource(minecraft = DEFAULT_MINECRAFT) {
  return {
    kind: "none", label: "No mods", none: true,
    async describe() { return { id: "none", minecraft, name: "No mods" }; },
    async analyze() { return { manifest: { kind: "mrpack", name: "No mods", minecraftVersion: minecraft }, entries: [], notes: [] }; },
  };
}

// A file's own mod list (formats.js readMods) may name jars only on Modrinth's CDN, over https, each with its sha512:
// a file is anyone's, and this is what lets it make the browser download something
const MODRINTH_CDN = /^https:\/\/cdn\.modrinth\.com\/data\/[A-Za-z0-9]+\/versions\/[A-Za-z0-9]+\/[^/?#]+$/;

/**
 * The mods a schematic file lists (its Mods compound), as a pack source: exactly those jars, by URL and hash, for the
 * Minecraft version the file names. Entries off Modrinth's CDN are dropped. `provides()` gives each entry's
 * namespaces, so the build fetches only the jars the file's blocks use, with no guessing. null when the file lists
 * no usable jar.
 */
export function fileSource(mods, label = "The file's mods") {
  const usable = (mods?.list ?? []).filter((m) => MODRINTH_CDN.test(m.url));
  if (!usable.length && !mods?.minecraft) return null;
  const entries = usable.map((m) => ({
    key: m.url, filename: m.file, side: "both", sha512: m.sha512, ...(m.sha1 ? { sha1: m.sha1 } : {}),
    origin: { type: "remote", url: m.url, ...(m.size ? { size: m.size } : {}) },
    ...(m.project || m.versionId ? { modrinth: { ...(m.project ? { projectId: m.project } : {}), ...(m.versionId ? { versionId: m.versionId } : {}) } } : {}),
  }));
  const minecraft = mods.minecraft ?? DEFAULT_MINECRAFT;
  let desc = null;
  return {
    kind: "file", label, fromFile: true,
    async describe() {
      if (desc) return desc;
      const list = usable.map((m) => `${m.file}:${m.sha512}`).sort().join("\n");
      return (desc = { id: `file:${(await sha256Text(`${minecraft}\n${list}`)).slice(0, 32)}`, minecraft, name: label });
    },
    async analyze() {
      return { manifest: { kind: "mrpack", name: label, minecraftVersion: minecraft, ...(mods.loader ? { loader: { id: mods.loader, version: mods.loaderVersion ?? undefined } } : {}) }, entries, notes: [] };
    },
    /** entry key -> { namespace: 1 } for each namespace the file says the jar provides */
    provides() { return new Map(usable.map((m) => [m.url, Object.fromEntries(m.namespaces.map((n) => [n, 1]))])); },
    /** the namespaces the list covers */
    covers() { return new Set(usable.flatMap((m) => m.namespaces)); },
  };
}

/** A pack the visitor dropped, already analyzed by Packrat. Its id is the hash of its entries. */
export function droppedSource(analysis, label) {
  let desc = null;
  return {
    kind: analysis.manifest.kind, label,
    async describe() {
      if (desc) return desc;
      const list = analysis.entries.map((e) => [e.filename, e.sha512 ?? e.sha256 ?? e.sha1 ?? e.origin?.file?.size ?? ""].join(":")).sort().join("\n");
      return (desc = { id: `${analysis.manifest.kind}:${(await sha256Text(list)).slice(0, 32)}`, minecraft: analysis.manifest.minecraftVersion ?? DEFAULT_MINECRAFT, name: analysis.manifest.name ?? label });
    },
    async analyze() { return analysis; },
  };
}
