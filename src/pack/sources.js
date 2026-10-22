// Where the mod jars come from: the default mods (a packwiz pack on gg.craftlabs.nexus, the files on Modrinth) by
// default, or a pack the visitor drops (a launcher folder, an .mrpack, a CurseForge zip), read by Packrat. A source
// says which Minecraft version it is for, gives an id that changes when its files do (part of the merged pack's
// name), and analyzes itself into Packrat's entries when a pack has to be built.
import { analyzePackwiz } from "@craftlabs/packrat";
import { get, put } from "./store.js";

export const DEFAULT_PACK = "https://gg.craftlabs.nexus/pack/pack.toml";
export const DEFAULT_MINECRAFT = "26.2";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256Text = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/**
 * A packwiz pack by its pack.toml URL. Its id is the index's hash, read from pack.toml (one small request). Its name is
 * the pack's own unless `fixedName` gives the one to show.
 */
export function packwizSource(url, label, { fixedName = null } = {}) {
  let head = null;
  const readHead = async (signal) => {
    if (head) return head;
    const r = await fetch(url, { signal, cache: "no-cache" });
    if (!r.ok) throw new Error(`${r.status} for ${url}`);
    const text = await r.text();
    const indexHash = text.match(/\[index\][^[]*?\bhash\s*=\s*"([0-9a-fA-F]+)"/)?.[1] ?? (await sha256Text(text));
    const minecraft = text.match(/\[versions\][^[]*?\bminecraft\s*=\s*"([^"]+)"/)?.[1] ?? DEFAULT_MINECRAFT;
    const name = fixedName ?? text.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? label;
    return (head = { indexHash: indexHash.toLowerCase(), minecraft, name });
  };
  return {
    kind: "packwiz", url, label,
    async describe(signal) { const h = await readHead(signal); return { id: `packwiz:${h.indexHash}`, minecraft: h.minecraft, name: h.name }; },
    // The metafiles (one .pw.toml per mod) are kept in IndexedDB under the index's hash: an unchanged pack is read
    // with two requests instead of a few hundred.
    async analyze(signal) {
      const { indexHash } = await readHead(signal);
      const cachedFetch = async (input, init) => {
        const u = String(input);
        if (!/\.pw\.toml$/.test(u)) return fetch(u, init);
        const key = `pw:${indexHash}:${u}`, have = await get("meta", key);
        if (typeof have === "string") return new Response(have, { status: 200 });
        const r = await fetch(u, init);
        if (r.ok) { const text = await r.text(); await put("meta", key, text); return new Response(text, { status: 200 }); }
        return r;
      };
      return analyzePackwiz(url, { signal, fetch: cachedFetch });
    },
  };
}
export const defaultSource = () => packwizSource(DEFAULT_PACK, "Default mods", { fixedName: "Default mods" });

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
