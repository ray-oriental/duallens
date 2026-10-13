// Original geometric baseline. Coordinates are always normalized to the source image.
export function cleanText(text, lang = 'eng') {
  let s = String(text || '').normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b\ufeff]/g, '').trim();
  s = s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, lang === 'jpn_vert' ? '' : ' ');
  if (lang === 'jpn_vert') s = s.replace(/[ \t]/g, '');
  return /[\p{L}\p{N}]/u.test(s) ? s.slice(0, 4000) : '';
}

export function cleanRegions(regions, lang) {
  return (regions || []).slice(0, 200).map((r) => ({ ...r, text: cleanText(r.text, lang) })).filter((r) =>
    r.text && Number(r.confidence) >= 30 && ['x0', 'y0', 'x1', 'y1'].every((k) => Number.isFinite(r.bbox?.[k])) &&
    r.bbox.x0 >= 0 && r.bbox.y0 >= 0 && r.bbox.x1 <= 1 && r.bbox.y1 <= 1 && r.bbox.x1 > r.bbox.x0 && r.bbox.y1 > r.bbox.y0);
}

export function readingOrder(regions, { lang = 'eng', width = 1, height = 1 } = {}) {
  const rtl = lang.startsWith('jpn');
  const webtoon = height / width > 2.5;
  let uncertain = false;
  const groups = new Map();
  // Explicit panel IDs, when a future detector supplies them, take precedence over line bands.
  for (const r of regions) {
    const key = r.panel ?? 'page';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const geometric = (items) => {
    const heights = items.map((r) => r.bbox.y1 - r.bbox.y0).sort((a, b) => a - b);
    const tolerance = Math.max(0.005, (heights[Math.floor(heights.length / 2)] || 0.02) * 0.65);
    const sorted = [...items].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    if (webtoon) return sorted.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    const bands = [];
    for (const r of sorted) {
      let band = bands.find((b) => Math.abs(b.y - r.bbox.y0) <= tolerance);
      if (!band) { band = { y: r.bbox.y0, items: [] }; bands.push(band); }
      if (band.items.some((a) => Math.min(a.bbox.x1, r.bbox.x1) > Math.max(a.bbox.x0, r.bbox.x0))) uncertain = true;
      band.items.push(r);
    }
    return bands.flatMap((b) => b.items.sort((a, c) => rtl ? c.bbox.x1 - a.bbox.x1 : a.bbox.x0 - c.bbox.x0));
  };
  const panels = [...groups.values()].map((items) => ({ items, bbox: {
    x0: Math.min(...items.map((r) => r.bbox.x0)), x1: Math.max(...items.map((r) => r.bbox.x1)),
    y0: Math.min(...items.map((r) => r.bbox.y0)), y1: Math.max(...items.map((r) => r.bbox.y1)),
  } }));
  const ordered = geometric(panels).flatMap((p) => geometric(p.items));
  // Without panel detection this is a heuristic, never an assurance about artistic intent.
  uncertain ||= regions.length > 1 && groups.size === 1;
  return { regions: ordered, uncertain };
}
