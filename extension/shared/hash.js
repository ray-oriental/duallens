// SHA-256 via Web Crypto; works in Node 20+ and in the extension service worker.

export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}
