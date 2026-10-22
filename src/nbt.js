// NBT (big-endian, optionally gzipped) reader and writer, enough for Sponge .schem files, in the browser: gzip through
// DecompressionStream / CompressionStream, numbers through DataView. Values keep their NBT type so a file can be
// written back unchanged: numbers come back as {t, v} wrappers; strings, compounds (plain objects), lists
// ({t: 9, et, v: []}) and typed arrays as themselves.

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
/** The bytes, gunzipped when they are gzip. */
export const gunzip = async (bytes) => (isGzip(bytes) ? pipe(bytes, new DecompressionStream("gzip")) : bytes);
export const gzip = (bytes) => pipe(bytes, new CompressionStream("gzip"));

const utf8 = new TextDecoder(), toUtf8 = new TextEncoder();

/** Parses uncompressed NBT bytes: { name, value }. */
export function parseNbt(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u8 = () => bytes[p++];
  const str = () => { const n = dv.getUint16(p); p += 2; const s = utf8.decode(bytes.subarray(p, p + n)); p += n; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: return { t, v: dv.getInt8(p++) };
      case 2: { const v = dv.getInt16(p); p += 2; return { t, v }; }
      case 3: { const v = dv.getInt32(p); p += 4; return { t, v }; }
      case 4: { const v = dv.getBigInt64(p); p += 8; return { t, v }; }
      case 5: { const v = dv.getFloat32(p); p += 4; return { t, v }; }
      case 6: { const v = dv.getFloat64(p); p += 8; return { t, v }; }
      case 7: { const n = dv.getInt32(p); p += 4; const v = new Int8Array(bytes.slice(p, p + n).buffer); p += n; return v; }
      case 8: return str();
      case 9: { const et = u8(); const n = dv.getInt32(p); p += 4; const v = []; for (let i = 0; i < n; i++) v.push(payload(et)); return { t, et, v }; }
      case 10: { const o = {}; for (;;) { const tt = u8(); if (tt === 0) return o; const k = str(); o[k] = payload(tt); } }
      case 11: { const n = dv.getInt32(p); p += 4; const v = new Int32Array(n); for (let i = 0; i < n; i++) { v[i] = dv.getInt32(p); p += 4; } return v; }
      case 12: { const n = dv.getInt32(p); p += 4; const v = new BigInt64Array(n); for (let i = 0; i < n; i++) { v[i] = dv.getBigInt64(p); p += 8; } return v; }
      default: throw new Error(`bad NBT tag ${t} at offset ${p - 1}`);
    }
  };
  const t = u8();
  const name = str();
  return { name, value: payload(t) };
}

/** Reads NBT bytes, gzipped or not. */
export const readNbt = async (bytes) => parseNbt(await gunzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));

export function typeOf(v) {
  if (typeof v === "string") return 8;
  if (v instanceof Int8Array) return 7;
  if (v instanceof Int32Array) return 11;
  if (v instanceof BigInt64Array) return 12;
  if (v && typeof v === "object" && "t" in v && "v" in v) return v.t;
  if (v && typeof v === "object") return 10;
  throw new Error(`cannot type ${v}`);
}

/** Serializes { name, value } as uncompressed NBT bytes. */
export function encodeNbt({ name, value }) {
  let buf = new Uint8Array(1 << 16), dv = new DataView(buf.buffer), p = 0;
  const room = (n) => {
    if (p + n <= buf.length) return;
    let size = buf.length * 2; while (size < p + n) size *= 2;
    const next = new Uint8Array(size); next.set(buf.subarray(0, p)); buf = next; dv = new DataView(buf.buffer);
  };
  const byte = (v) => { room(1); dv.setInt8(p, v << 24 >> 24); p += 1; };
  const i16 = (v) => { room(2); dv.setInt16(p, v); p += 2; };
  const i32 = (v) => { room(4); dv.setInt32(p, v); p += 4; };
  const i64 = (v) => { room(8); dv.setBigInt64(p, BigInt(v)); p += 8; };
  const str = (s) => { const b = toUtf8.encode(s); i16(b.length); room(b.length); buf.set(b, p); p += b.length; };
  const payload = (v) => {
    switch (typeOf(v)) {
      case 1: return byte(v.v);
      case 2: return i16(v.v);
      case 3: return i32(v.v);
      case 4: return i64(v.v);
      case 5: room(4); dv.setFloat32(p, v.v); p += 4; return;
      case 6: room(8); dv.setFloat64(p, v.v); p += 8; return;
      case 7: i32(v.length); room(v.length); buf.set(new Uint8Array(v.buffer, v.byteOffset, v.length), p); p += v.length; return;
      case 8: return str(v);
      case 9: byte(v.et); i32(v.v.length); for (const x of v.v) payload(x); return;
      case 10: for (const [k, x] of Object.entries(v)) { byte(typeOf(x)); str(k); payload(x); } byte(0); return;
      case 11: i32(v.length); for (const x of v) i32(x); return;
      case 12: i32(v.length); for (const x of v) i64(x); return;
    }
  };
  byte(typeOf(value)); str(name); payload(value);
  return buf.slice(0, p);
}

export const decodeVarints = (bytes) => {
  const out = new Int32Array(bytes.length); let n = 0;
  for (let i = 0; i < bytes.length;) { let v = 0, shift = 0, b; do { b = bytes[i++] & 255; v |= (b & 127) << shift; shift += 7; } while (b & 128); out[n++] = v; }
  return out.slice(0, n);
};
export const encodeVarints = (values) => {
  const out = new Int8Array(values.length * 5); let n = 0;
  for (let v of values) { do { let b = v & 127; v >>>= 7; if (v) b |= 128; out[n++] = b > 127 ? b - 256 : b; } while (v); }
  return out.slice(0, n);
};
