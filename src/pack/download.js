// A fetch that reports its progress (the response's length, or the size the caller knows) and returns the bytes.
export async function fetchWithProgress(url, { signal, total, onProgress } = {}) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  const size = Number(r.headers.get("content-length")) || total || 0;
  if (!r.body || !onProgress) return r.arrayBuffer();
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    onProgress(got, size);
  }
  const out = new Uint8Array(got); let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out.buffer;
}
