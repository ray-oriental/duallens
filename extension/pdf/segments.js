// Original coordinate segmentation. PDF coordinates are unscaled, bottom-up.
// Return paragraphs {text,x,y,width,height,lines}; lines have the same geometry.
// Complex/rotated/RTL layouts are conservatively isolated, not reconstructed.
export function segmentTextItems(items = []) {
  const rows = [];
  const isolated = [];
  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite) ||
        !Number.isFinite(item.width) || item.width < 0) continue;
    const height = Math.abs(item.height) || Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
    if (!Number.isFinite(height) || height <= 0) continue;
    const line = { text: item.str.replace(/\s+/g, ' '), x: t[4], y: t[5], width: item.width, height };
    if (item.dir === 'rtl' || Math.abs(t[1]) > .01 || Math.abs(t[2]) > .01) {
      isolated.push({ ...line, text: line.text.trim(), lines: [line] });
    } else rows.push(line);
  }
  rows.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of rows) {
    const line = lines.at(-1);
    const gap = line ? item.x - (line.x + line.width) : Infinity;
    if (line && Math.abs(item.y - line.y) <= Math.min(item.height, line.height) * .35 &&
        gap >= -item.height && gap <= item.height * 2 && Math.abs(line.height - item.height) < item.height * .3) {
      const separator = gap > item.height * .12 && !/\s$/.test(line.text) &&
        !/^\s|^[,.;:!?)]/.test(item.text) ? ' ' : '';
      line.text += separator + item.text;
      line.width = Math.max(line.width, item.x + item.width - line.x);
    } else lines.push({ ...item });
  }
  // Separate non-overlapping horizontal bands (columns). A full-width heading
  // may bridge columns; ambiguous reading order deliberately remains row-major.
  const columns = [];
  for (const line of lines) {
    let col = columns.find(c => Math.min(c.right, line.x + line.width) - Math.max(c.left, line.x) > 0);
    if (!col) columns.push(col = { left: line.x, right: line.x + line.width, lines: [] });
    col.left = Math.min(col.left, line.x); col.right = Math.max(col.right, line.x + line.width);
    col.lines.push(line);
  }
  columns.sort((a, b) => a.left - b.left);
  const paragraphs = [];
  for (const col of columns) {
    let paragraph;
    let previous;
    for (const line of col.lines) {
      line.text = line.text.trim();
      const h = Math.max(line.height, previous?.height || 0);
      const newParagraph = !previous || previous.y - line.y > h * 2.4 || previous.y <= line.y ||
        Math.abs(line.x - previous.x) > h * 1.2 || col.right - (previous.x + previous.width) > 130 ||
        Math.abs(line.height - previous.height) > h * .3;
      if (newParagraph) {
        paragraph = { ...line, lines: [line] };
        paragraphs.push(paragraph);
      } else {
        paragraph.text += ' ' + line.text;
        const right = Math.max(paragraph.x + paragraph.width, line.x + line.width);
        paragraph.x = Math.min(paragraph.x, line.x);
        paragraph.width = right - paragraph.x;
        paragraph.height = paragraph.y - line.y + line.height;
        paragraph.lines.push(line);
      }
      previous = line;
    }
  }
  // Without columns, preserve vertical position of isolated items too.
  if (columns.length <= 1) return [...paragraphs, ...isolated].sort((a, b) => b.y - a.y || a.x - b.x);
  return [...paragraphs, ...isolated];
}
