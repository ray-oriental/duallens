import { pdfURL } from '../background/pdf.js';

export const MAX_PDF_BYTES = 64 * 1024 * 1024;
export function checkPDFBytes(data) {
  if (!data.byteLength || data.byteLength > MAX_PDF_BYTES) throw new Error('PDF 文件必须小于 64 MiB。');
  const header = new TextDecoder('latin1').decode(data.subarray(0, 1024));
  if (!header.includes('%PDF-')) throw new Error('文件不是有效的 PDF。');
  return data;
}
export async function readPDFURL(value, { fetchImpl = fetch, fileAccess = async () => false } = {}) {
  const url = pdfURL(value);
  if (!url) throw new Error('仅支持 HTTP(S) 或本地 file:// PDF，不接受带账号密码的 URL。');
  if (new URL(url).protocol === 'file:' && !await fileAccess()) {
    throw new Error('请在扩展详情页开启“允许访问文件网址”，或用上方“选择本地 PDF”。');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let reader;
  try {
    const r = await fetchImpl(url, { credentials: 'omit', redirect: 'error', signal: ctrl.signal });
    if (!r.ok) throw new Error('无法读取 PDF；需要登录或重定向的文档请先下载，再选择本地文件。');
    if (Number(r.headers.get('content-length')) > MAX_PDF_BYTES) throw new Error('PDF 文件必须小于 64 MiB。');
    if (!r.body) return checkPDFBytes(new Uint8Array(await r.arrayBuffer()));
    reader = r.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_PDF_BYTES) throw new Error('PDF 文件必须小于 64 MiB。');
      chunks.push(chunk);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return checkPDFBytes(data);
  } finally { clearTimeout(timer); ctrl.abort(); await reader?.cancel().catch(() => {}); }
}
