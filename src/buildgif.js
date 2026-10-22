// The build animation's two pieces that do not depend on the page's state: framing a fixed view so the finished build
// fills the image, and encoding the frames as one GIF. main.js (captureBuild) drives the layers.
import * as THREE from "three";
import GIF from "gif.js.optimized";
import gifWorkerUrl from "gif.js.optimized/dist/gif.worker.js?url";

/** Every vertex of the visible meshes under `root` (world coordinates, flat xyz), skipping the subtree `skip`;
 *  duplicates (to an eighth of a block) are dropped, so a big build stays a few ten thousand points. */
export function collectPoints(root, skip) {
  root.updateMatrixWorld(true);
  const seen = new Set(), out = [], v = new THREE.Vector3(), m = new THREE.Matrix4();
  const add = () => {
    const key = (Math.round(v.x * 8) + 8192) * 268435456 + (Math.round(v.y * 8) + 8192) * 16384 + (Math.round(v.z * 8) + 8192);
    if (seen.has(key)) return;
    seen.add(key); out.push(v.x, v.y, v.z);
  };
  const visible = (o) => { for (let p = o; p; p = p.parent) { if (p === skip || !p.visible) return false; if (p === root) return true; } return true; };
  root.traverse((o) => {
    if (!o.isMesh || !visible(o)) return;
    const pos = o.geometry?.attributes?.position; if (!pos) return;
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m); m.premultiply(o.matrixWorld);
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); add(); }
      }
    } else for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); add(); }
  });
  return Float64Array.from(out);
}

/**
 * The camera that shows `points` (collectPoints) from the direction `quaternion` gives (the view when Build was
 * pressed: the renderer refits the camera after every load), centered and as large as the image allows with `margin`
 * (a share of the image height) on every side, and the image aspect that makes the build touch the margin on all
 * four sides. `cam` gives the kind of camera and its field of view: perspective keeps the field of view and finds the
 * distance; orthographic keeps the camera behind everything and sizes the frustum. Returns what applyView needs.
 */
export function frameView(cam, quaternion, points, margin = 0.02) {
  const q = quaternion.clone();
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q), f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const n = points.length / 3, px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2];
    px[i] = x * r.x + y * r.y + z * r.z; py[i] = x * u.x + y * u.y + z * u.z; pz[i] = x * f.x + y * f.y + z * f.z;
    if (pz[i] < zmin) zmin = pz[i]; if (pz[i] > zmax) zmax = pz[i];
  }
  const span = (a) => { let lo = Infinity, hi = -Infinity; for (const x of a) { if (x < lo) lo = x; if (x > hi) hi = x; } return [lo, hi]; };
  const [xlo, xhi] = span(px), [ylo, yhi] = span(py);
  const depth = zmax - zmin, size = Math.max(xhi - xlo, yhi - ylo, depth, 1);
  let ex, ey, ez, halfW, halfH;
  if (cam.isOrthographicCamera) {
    ex = (xlo + xhi) / 2; ey = (ylo + yhi) / 2; ez = zmin - size;
    halfH = (yhi - ylo) / 2 / (1 - 2 * margin);
    halfW = (xhi - xlo) / 2 + 2 * margin * halfH;
  } else {
    const T = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    // for the camera at depth z: the lateral position that centers the build, and the half extents (tan of the angle)
    const centered = (z) => {
      let x = (xlo + xhi) / 2, y = (ylo + yhi) / 2, hx = 0, hy = 0;
      for (let it = 0; it < 12; it++) {
        let ul = Infinity, uh = -Infinity, vl = Infinity, vh = -Infinity;
        for (let i = 0; i < n; i++) {
          const d = pz[i] - z, a = (px[i] - x) / d, b = (py[i] - y) / d;
          if (a < ul) ul = a; if (a > uh) uh = a; if (b < vl) vl = b; if (b > vh) vh = b;
        }
        hx = (uh - ul) / 2; hy = (vh - vl) / 2;
        const zc = (zmin + zmax) / 2 - z;
        x += ((ul + uh) / 2) * zc; y += ((vl + vh) / 2) * zc;
        if (Math.abs(ul + uh) < 1e-6 && Math.abs(vl + vh) < 1e-6) break;
      }
      return { x, y, hx, hy };
    };
    // the half height the build may take, then the depth that gives it (the build shrinks as the camera backs off)
    const want = T * (1 - 2 * margin);
    let near = zmin - Math.max(0.5, cam.near * 2), far = zmin - size * 60;
    for (let it = 0; it < 48; it++) { const mid = (near + far) / 2; if (centered(mid).hy > want) near = mid; else far = mid; }
    ez = far; const c = centered(ez); ex = c.x; ey = c.y;
    halfH = T; halfW = c.hx + 2 * margin * T;
  }
  const position = r.clone().multiplyScalar(ex).addScaledVector(u, ey).addScaledVector(f, ez);
  const target = position.clone().addScaledVector(f, (zmin + zmax) / 2 - ez);
  return { quaternion: q, position, target, aspect: halfW / halfH, ortho: cam.isOrthographicCamera ? { halfW, halfH } : null, far: zmax - ez + size };
}

/** What applyView changes, to put back afterwards. */
export function viewState(cam, ctl) {
  return { position: cam.position.clone(), quaternion: cam.quaternion.clone(), target: ctl?.target?.clone() ?? null, far: cam.far, zoom: cam.zoom, ortho: cam.isOrthographicCamera ? [cam.left, cam.right, cam.top, cam.bottom] : null };
}
export function restoreView(cam, ctl, s) {
  cam.position.copy(s.position); cam.quaternion.copy(s.quaternion); cam.far = s.far; cam.zoom = s.zoom;
  if (s.ortho) [cam.left, cam.right, cam.top, cam.bottom] = s.ortho;
  cam.updateProjectionMatrix();
  if (ctl?.target && s.target) { ctl.target.copy(s.target); ctl.update?.(); }
}
/** Puts the camera where frameView said (again before every frame: the renderer refits after a load). */
export function applyView(cam, ctl, view) {
  cam.position.copy(view.position); cam.quaternion.copy(view.quaternion);
  if (view.far > cam.far) cam.far = view.far;
  if (view.ortho) { cam.zoom = 1; cam.left = -view.ortho.halfW; cam.right = view.ortho.halfW; cam.top = view.ortho.halfH; cam.bottom = -view.ortho.halfH; }
  cam.updateProjectionMatrix();
  if (ctl?.target) { ctl.target.copy(view.target); ctl.update?.(); cam.quaternion.copy(view.quaternion); }
  cam.updateMatrixWorld(true);
}

/** The image size for an aspect, its longer side `longest` pixels. */
export const sizeFor = (aspect, longest) => (aspect >= 1 ? [longest, Math.max(1, Math.round(longest / aspect))] : [Math.max(1, Math.round(longest * aspect)), longest]);

const encode = (frames, delays, width, height, palette, onProgress) => new Promise((resolve, reject) => {
  const gif = new GIF({ workers: 2, quality: 4, dither: false, width, height, workerScript: gifWorkerUrl, repeat: 0, globalPalette: palette });
  frames.forEach((c, i) => gif.addFrame(c, { delay: delays[i], copy: true }));
  gif.on("progress", (p) => onProgress?.(p));
  gif.on("finished", (blob) => resolve({ blob, palette: gif.options.globalPalette }));
  gif.on("abort", () => reject(new Error("GIF encoding aborted")));
  gif.render();
});

/** One GIF from PNG blobs of the same size, one delay (ms) each, looping. One palette for every frame, taken from the
 *  last frame (the finished build: the early frames are mostly background), so unchanged blocks keep their colors. */
export async function encodeGif(pngs, delays, onProgress) {
  const frames = [];
  for (const b of pngs) {
    const bmp = await createImageBitmap(b);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0); bmp.close?.();
    frames.push(c.getContext("2d"));
  }
  const { width, height } = frames[0].canvas;
  const { palette } = await encode([frames[frames.length - 1]], [delays[delays.length - 1]], width, height, true);
  const { blob } = await encode(frames, delays, width, height, palette, onProgress);
  return blob;
}
