// `npm run dev:local`: the dev server with the renderer and Packrat from the checkouts beside this one
// (../schematic-renderer, ../packrat; BLOCKSCOPE_RENDERER, BLOCKSCOPE_PACKRAT to point elsewhere), so a change in
// either shows here without publishing. Packrat's TypeScript source is served as it is (a change reloads at once);
// the renderer is rebuilt by its own `build:watch` and the page reloads when a rebuild has finished writing.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const renderer = path.resolve(HERE, process.env.BLOCKSCOPE_RENDERER ?? "../schematic-renderer");
const packrat = path.resolve(HERE, process.env.BLOCKSCOPE_PACKRAT ?? "../packrat");
const rendererDist = path.join(renderer, "dist");

const ANSI = /\x1b\[[0-9;]*m/g;
const tag = (name, color) => (line) => console.log(`\x1b[${color}m[${name}]\x1b[0m ${line}`);
const say = tag("dev:local", 36);

// Each checkout needs its own node_modules: the first run installs them.
for (const [name, dir] of [["schematic-renderer", renderer], ["packrat", packrat]]) {
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    say(`no ${name} checkout at ${dir} (clone it beside blockscope, or set BLOCKSCOPE_${name === "packrat" ? "PACKRAT" : "RENDERER"})`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    say(`installing ${name}'s dependencies (first run)...`);
    const r = spawnSync("npm", ["install"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

let server = null; // blockscope's Vite server, once it runs
let reload = null; // set with it: reloads the page after a renderer build

// The renderer's watch build, its output trimmed to what changed and whether it built.
const log = tag("renderer", 35);
const watcher = spawn(process.execPath, [path.join(renderer, "node_modules", "vite", "bin", "vite.js"), "build", "--watch", "--mode", "lib-watch"], { cwd: renderer, stdio: ["ignore", "pipe", "pipe"] });
let onBuilt = () => {};
const firstBuild = new Promise((resolve) => { onBuilt = resolve; });
let buffered = "";
function rendererOutput(chunk) {
  buffered += chunk;
  const lines = buffered.split(/\r?\n/);
  buffered = lines.pop();
  for (const raw of lines) {
    const line = raw.replace(ANSI, "").trimEnd();
    // The chunk list and the warnings every build repeats (an outDir outside its root, jszip imported both ways).
    if (!line || /^\.\.\/\.\.\/dist\/|^(transforming|rendering chunks|computing gzip|vite v|watching for file changes|✓ \d+ modules transformed|\[plugin:vite:reporter\]|Use --emptyOutDir)|^\(!\) (outDir|.*dynamically imported)/.test(line.trim())) continue;
    log(line);
    if (/built in [\d.]+m?s/.test(line)) onBuilt(), reload?.();
  }
}
watcher.stdout.setEncoding("utf8").on("data", rendererOutput);
watcher.stderr.setEncoding("utf8").on("data", rendererOutput);
watcher.on("exit", (code) => { say(`the renderer's watch build stopped (${code})`); shutdown(code ?? 1); });

function shutdown(code = 0) {
  watcher.exitCode === null && watcher.kill();
  Promise.resolve(server?.close()).finally(() => process.exit(code));
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// A renderer that was never built has no dist/ to serve: wait for the first build. Otherwise start now and reload
// when the first (and every later) build lands.
if (!fs.existsSync(path.join(rendererDist, "schematic-renderer.es.js"))) {
  say("building the renderer for the first time...");
  await firstBuild;
}

process.env.BLOCKSCOPE_LINK = "1";
process.env.BLOCKSCOPE_RENDERER = renderer;
process.env.BLOCKSCOPE_PACKRAT = packrat;
const { createServer } = await import("vite");
server = await createServer({
  root: HERE,
  configFile: path.join(HERE, "vite.config.mjs"),
  // The renderer's dist/ changes file by file while it is written: it is not watched, and the page reloads once the
  // build says it is done.
  server: { watch: { ignored: [rendererDist.replaceAll("\\", "/") + "/**"] } },
});
reload = () => {
  server.moduleGraph.invalidateAll();
  server.ws.send({ type: "full-reload", path: "*" });
  log("reloaded the page");
};
await server.listen();
server.printUrls();
server.bindCLIShortcuts({ print: true });
