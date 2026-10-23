import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// For development and for checking a build (`vite preview`): /plans/<name> serves the plan files of a local folder
// (BLOCKSCOPE_PLANS, in the environment or .env.local; none by default), read-only: schematics, their .meta.json and .paintings.json, and the painting images. A bare name is also looked for in its fixtures/ and
// framing-options/ subfolders, as the plan's own viewer did. The deployed site has no such route: there the plans
// are static files (VITE_PLANS_BASE).
const PLAN_FILE = /\.(schem|schematic|litematic|nbt|json|png|webp)$/i;
const TYPES = { ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
function servePlans(root) {
  return {
    name: "blockscope-plans",
    configureServer(server) { attach(server); },
    configurePreviewServer(server) { attach(server); },
  };
  function attach(server) {
    if (!root) { server.config.logger.info("[blockscope] /plans/ is off: set BLOCKSCOPE_PLANS (environment or .env.local) to serve a folder of plan files"); return; }
    if (!fs.existsSync(root)) { server.config.logger.warn(`[blockscope] no plan folder at ${root}: /plans/ is off (BLOCKSCOPE_PLANS)`); return; }
    server.config.logger.info(`[blockscope] /plans/ serves ${root} (read-only)`);
    server.middlewares.use((req, res, next) => {
      const url = decodeURIComponent((req.url ?? "").split("?")[0]);
      if (!url.startsWith("/plans/")) return next();
      if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; res.end("read-only"); return; }
      const rel = path.normalize(url.slice("/plans/".length));
      if (rel.startsWith("..") || path.isAbsolute(rel) || !PLAN_FILE.test(rel)) { res.statusCode = 404; res.end("not a plan file"); return; }
      const file = [root, path.join(root, "fixtures"), path.join(root, "framing-options")].map((d) => path.join(d, rel)).find((f) => f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile());
      if (!file) { res.statusCode = 404; res.end(`${rel} not found`); return; }
      res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "HEAD") { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
  }
}

// The renderer can use SharedArrayBuffer for its worker pool when the page is cross-origin isolated (it falls back to
// copying without). The built site sends the same headers (public/_headers).
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

// `npm run dev:local` (BLOCKSCOPE_LINK set): the renderer and Packrat from the checkouts beside this one instead of
// node_modules, so a change there shows here without publishing. Packrat is served from its TypeScript source; the
// renderer from its dist/, which its `npm run build:watch` keeps current (its source needs its own Vite plugins).
// One three.js and one Nucleation still: the renderer's bare imports resolve from this project.
function linkedLibs(env) {
  if (!env.BLOCKSCOPE_LINK) return null;
  const renderer = path.resolve(HERE, env.BLOCKSCOPE_RENDERER ?? "../schematic-renderer");
  const packrat = path.resolve(HERE, env.BLOCKSCOPE_PACKRAT ?? "../packrat");
  const rendererEntry = path.join(renderer, "dist", "schematic-renderer.es.js");
  const packratEntry = path.join(packrat, "src", "index.ts");
  for (const f of [rendererEntry, packratEntry]) if (!fs.existsSync(f)) throw new Error(`[blockscope] BLOCKSCOPE_LINK: ${f} is missing`);
  console.info(`[blockscope] linked: renderer ${renderer} (dist), packrat ${packrat} (src)`);
  return {
    resolve: {
      alias: [
        { find: /^@craftlabs\/schematic-renderer$/, replacement: rendererEntry },
        { find: /^@craftlabs\/packrat$/, replacement: packratEntry },
      ],
      dedupe: ["three", "nucleation"],
    },
    fsAllow: [searchForWorkspaceRoot(HERE), renderer, packrat],
    // Its own pre-bundled dependencies (Packrat's zod and smol-toml from its checkout, not the published Packrat):
    // sharing node_modules/.vite with `npm run dev` let either one rewrite the other's, and the page then asked for
    // files the cache no longer had (504) and never started.
    cacheDir: path.join(HERE, "node_modules", ".vite-linked"),
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, HERE, ""), ...process.env };
  const plans = env.BLOCKSCOPE_PLANS ? path.resolve(HERE, env.BLOCKSCOPE_PLANS) : null;
  const linked = linkedLibs(env);
  return {
    plugins: [servePlans(plans)],
    ...(linked && { resolve: linked.resolve, cacheDir: linked.cacheDir }),
    // One three.js for the page's meshes and the renderer's scene, and the renderer's WASM where it expects it:
    // pre-bundling would move the renderer into .vite/deps, where its import.meta.url-relative nucleation_bg.wasm
    // does not exist.
    optimizeDeps: { exclude: ["three", "@craftlabs/schematic-renderer", "nucleation"] },
    server: { port: 5180, strictPort: true, headers: ISOLATION, ...(linked && { fs: { allow: linked.fsAllow } }) },
    preview: { port: 5181, strictPort: true, headers: ISOLATION },
    build: { target: "es2022", chunkSizeWarningLimit: 4000 },
    worker: { format: "es" },
  };
});
