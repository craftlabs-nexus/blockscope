#!/usr/bin/env node
// Shares schematics through the site: uploads them to the R2 bucket behind https://files.craftlabs.nexus and prints
// a Blockscope link that opens one. The files never go in this repository, and deleting one takes it down for good.
//
//   node scripts/share.mjs <file> [<file> ...]        (npm run share -- <file>)
//       uploads each file and, unless --only, the same design's .schem and .litematic beside it (a .nbt goes when it is
//       named), its name.meta.json if there is one (the parts, for a file that carries no metadata of its own), and
//       its name.paintings.json with the images it names: the page's Download row offers whichever schematics are
//       there. The bucket is the site's plans base, so the link names the file alone (?schem=name.schem)
//   node scripts/share.mjs --delete <name> [...]      removes name (with its extension), or every format of it
//   --dir <folder>                                    puts the files under that folder in the bucket
//
// Needs wrangler signed in to the Cloudflare account (`npx wrangler login`); it runs through npx in a temporary
// folder, so a project's node_modules for another OS (a Windows checkout under WSL) does not get in the way. Windows
// paths (C:\...) work under WSL too. SHARE_BUCKET, SHARE_FILES_BASE and SHARE_SITE override the defaults below.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BUCKET = process.env.SHARE_BUCKET ?? "blockscope-files";
const FILES_BASE = (process.env.SHARE_FILES_BASE ?? "https://files.craftlabs.nexus").replace(/\/+$/, "");
const SITE = (process.env.SHARE_SITE ?? "https://blockscope.craftlabs.nexus").replace(/\/+$/, "");
const WRANGLER = "wrangler@4.152.0";
const FORMATS = [".schem", ".litematic"];   // shared beside a file named; --delete without an extension takes these and .nbt
const SCHEMATIC = /\.(schem|schematic|litematic|nbt)$/i;

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const option = (name) => { const i = args.indexOf(name); if (i < 0) return null; const [, v] = args.splice(i, 2); return v ?? null; };
const remove = flag("--delete"), only = flag("--only"), dir = (option("--dir") ?? "").replace(/^\/+|\/+$/g, "");
if (!args.length || flag("--help") || flag("-h")) {
  console.log("usage: node scripts/share.mjs [--only] [--dir <folder>] <file> ...\n       node scripts/share.mjs --delete [--dir <folder>] <name> ...");
  process.exit(args.length ? 0 : 1);
}

/** A Windows path (C:\..., C:/...) as WSL sees it, when this runs on Linux. */
function localPath(p) {
  const m = process.platform !== "win32" && p.match(/^([A-Za-z]):[\\/](.*)$/);
  return path.resolve(m ? `/mnt/${m[1].toLowerCase()}/${m[2].replaceAll("\\", "/")}` : p);
}
const keyOf = (name) => (dir ? `${dir}/${name}` : name);
const urlOf = (key) => `${FILES_BASE}/${key.split("/").map(encodeURIComponent).join("/")}`;
// the bucket is the site's plans base (VITE_PLANS_BASE in .env.production), so a link names the file alone
const viewerLink = (key) => `${SITE}/?schem=${key.split("/").map(encodeURIComponent).join("/")}`;
const TYPES = { ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };

function wrangler(...rest) {
  const r = spawnSync("npx", ["--yes", WRANGLER, ...rest], {
    cwd: os.tmpdir(), encoding: "utf8", shell: process.platform === "win32",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

if (remove) {
  for (const name of args) {
    const names = path.extname(name) ? [name] : [...FORMATS, ".nbt", ".meta.json", ".paintings.json"].map((e) => name + e);
    for (const n of names) {
      const r = wrangler("r2", "object", "delete", `${BUCKET}/${keyOf(n)}`, "--remote");
      console.log(r.ok ? `deleted ${keyOf(n)}` : `${keyOf(n)}: ${r.out.split("\n").pop()}`);
    }
  }
  process.exit(0);
}

// the files to upload: each one given, and its siblings in the other formats
const files = new Map();   // local path -> bucket key
for (const arg of args) {
  const file = localPath(arg);
  if (!fs.existsSync(file)) { console.error(`no such file: ${arg}`); process.exit(1); }
  if (!SCHEMATIC.test(file)) { console.error(`not a schematic (.schem, .schematic, .litematic, .nbt): ${arg}`); process.exit(1); }
  files.set(file, keyOf(path.basename(file)));
  if (only) continue;
  const stem = file.replace(/\.[^.]+$/, "");
  for (const ext of [...FORMATS, ".meta.json"]) if (fs.existsSync(stem + ext)) files.set(stem + ext, keyOf(path.basename(stem + ext)));
  // the paintings and their images, at the same places relative to the JSON as beside the file
  const paintings = `${stem}.paintings.json`;
  if (fs.existsSync(paintings)) {
    files.set(paintings, keyOf(path.basename(paintings)));
    for (const p of JSON.parse(fs.readFileSync(paintings, "utf8")).paintings ?? []) {
      if (!p.img || /^[a-z]+:|^\/|\.\./i.test(p.img)) continue;   // only images beside it (no URL, no ..)
      const img = path.join(path.dirname(file), p.img);
      if (fs.existsSync(img)) files.set(img, keyOf(p.img.replaceAll("\\", "/")));
      else console.error(`warning: ${p.img} (a painting in ${path.basename(paintings)}) is missing`);
    }
  }
}

let failed = false;
for (const [file, key] of files) {
  process.stdout.write(`uploading ${key} (${fs.statSync(file).size} bytes)… `);
  const type = TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
  const r = wrangler("r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--remote",
    "--content-type", type, "--cache-control", "public, max-age=300");
  if (!r.ok) { failed = true; console.log(`failed\n${r.out}`); continue; }
  // read it back from the public address, as the page will
  const head = await fetch(urlOf(key), { method: "HEAD" }).catch(() => null);
  console.log(head?.ok ? "done" : head ? `uploaded, but ${urlOf(key)} answered ${head.status}`
    : `uploaded; ${urlOf(key)} could not be reached from here (DNS still catching up?)`);
}
if (failed) process.exit(1);

const schematics = [...files.values()].filter((k) => SCHEMATIC.test(k));
const open = schematics.find((k) => k.endsWith(".schem")) ?? schematics[0];
console.log(`\nopen in Blockscope (Download offers ${schematics.map((k) => path.extname(k)).join(", ")}):\n  ${viewerLink(open)}`);
console.log(`\nthe files:\n${[...files.values()].map((k) => `  ${urlOf(k)}`).join("\n")}`);
