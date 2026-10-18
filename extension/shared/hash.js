// SHA-256 as lowercase hex. Web Crypto when available; a pure-JS fallback otherwise, because
// `crypto.subtle` only exists in secure contexts and the userscript also runs on plain-HTTP pages.

export async function sha256Digest(bytes) {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const constants = [], state = [];
  for (let n = 2; constants.length < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (state.length < 8) state.push((Math.sqrt(n) % 1 * 0x100000000) | 0);
    constants.push((Math.cbrt(n) % 1 * 0x100000000) | 0);
  }
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer), words = new Int32Array(64);
  view.setUint32(data.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(data.length - 4, bytes.length * 8);
  const rotate = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = i < 16 ? view.getInt32(offset + i * 4) : words[i - 16] +
        (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + words[i - 7] +
        (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
        ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0;
      const u = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
        ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t) | 0; d = c; c = b; b = a; a = (t + u) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((x, i) => { state[i] = (state[i] + x) | 0; });
  }
  return state.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(str) {
  return sha256Digest(new TextEncoder().encode(String(str)));
}
