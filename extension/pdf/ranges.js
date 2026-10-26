export function parsePageRange(input, total) {
  if (!Number.isInteger(total) || total < 1 || total > 2000) throw new RangeError('Invalid page count');
  if (!String(input).trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  for (const token of String(input).split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(token);
    if (!match) throw new RangeError('Invalid page range');
    const first = Number(match[1]), last = Number(match[2] || first);
    if (first < 1 || last < first || last > total) throw new RangeError('Invalid page range');
    for (let n = first; n <= last; n++) pages.add(n);
  }
  return [...pages].sort((a, b) => a - b);
}

export function exportFilename(name, mode) {
  const base = String(name || '').split(/[\\/]/).at(-1).replace(/\.pdf$/i, '')
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120) || 'document';
  return `${base}.${mode === 'translated' ? 'translated' : 'bilingual'}.pdf`;
}
