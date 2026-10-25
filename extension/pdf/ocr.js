// OCR regions use normalized image coordinates. Keep uncertain regions as original pixels.
export function ocrLanguage(source) {
  return /^ja|^jpn/.test(source) ? 'jpn' : /^ko|^kor/.test(source) ? 'kor' : 'eng';
}
export function ocrSegments(regions, width, height, confidence = 65) {
  const blocks = [];
  for (const region of (Array.isArray(regions) ? regions : []).slice(0, 2000)) {
    const r = region?.bbox, text = String(region?.text || '').replace(/\s+/g, ' ').trim().slice(0, 10000);
    if (!r || ![r.x0,r.y0,r.x1,r.y1,region.confidence].every(Number.isFinite) ||
        r.x0 < 0 || r.y0 < 0 || r.x1 > 1 || r.y1 > 1 || r.x1 <= r.x0 || r.y1 <= r.y0 || !text) continue;
    const box = { left: r.x0 * width, top: r.y0 * height, right: r.x1 * width, bottom: r.y1 * height };
    const size = Math.max(2, (box.bottom - box.top) * .85);
    const baseline = box.bottom - size * .12;
    blocks.push({ kind: region.confidence >= confidence ? 'text' : 'other', text, size, pitch: 0,
      confidence: region.confidence, font: '', align: 'start', box, textBox: { ...box }, cover: [{ ...box }],
      parts: [{ type: 'text', text }], lines: [{ ...box, baseline, size, text }] });
  }
  blocks.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  blocks.forEach((block, id) => { block.id = id; });
  return { blocks, bodySize: blocks[0]?.size || 12, width, height };
}
