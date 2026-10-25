// Rasterize the same inert DOM layout used by the reader, without SVG/HTML serialization.
// Browser Range geometry supplies actual line breaks, justification and inline atom positions.
export async function paintOverlay(canvas, overlay, factor, signal) {
  await document.fonts.ready;
  const ctx = canvas.getContext('2d'), origin = overlay.getBoundingClientRect();
  const range = document.createRange();
  let slice = performance.now();
  const cooperate = async () => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (performance.now() - slice > 8) { await new Promise(resolve => setTimeout(resolve, 0)); slice = performance.now(); }
  };
  const rect = node => {
    const r = node.getBoundingClientRect();
    return [(r.left - origin.left) * factor, (r.top - origin.top) * factor, r.width * factor, r.height * factor];
  };
  for (const node of overlay.querySelectorAll('.wo>div')) {
    await cooperate(); ctx.fillStyle = node.style.background; ctx.fillRect(...rect(node));
  }
  for (const block of overlay.querySelectorAll('.tb')) {
    const style = getComputedStyle(block), size = parseFloat(style.fontSize) * factor;
    ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    ctx.fillStyle = style.color; ctx.textBaseline = 'alphabetic';
    if (block.hasAttribute('data-overflow')) {
      const r = rect(block); ctx.fillStyle = style.backgroundColor; ctx.fillRect(r[0] - 2 * factor, r[1] - 2 * factor, r[2] + 4 * factor, r[3] + 4 * factor); ctx.fillStyle = style.color;
    }
    const descent = ctx.measureText('Mg').fontBoundingBoxDescent || size * .22;
    for (const child of block.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) {
        if (child instanceof HTMLCanvasElement) ctx.drawImage(child, ...rect(child));
        continue;
      }
      // Paint words at their browser-computed positions; split only where a line wraps.
      let start = 0, end = 0, line = null;
      const flush = () => {
        if (!line || end <= start) return;
        range.setStart(child, start); range.setEnd(child, end);
        const r = range.getBoundingClientRect(), text = child.data.slice(start, end);
        ctx.fillText(text, (r.left - origin.left) * factor, (r.bottom - origin.top) * factor - descent, Math.max(.1, r.width * factor));
      };
      for (const char of child.data) {
        await cooperate();
        const next = end + char.length;
        range.setStart(child, end); range.setEnd(child, next);
        const r = range.getBoundingClientRect();
        if (line && (Math.abs(r.top - line.top) > 1 || /\s/u.test(char))) { flush(); start = end; line = null; }
        if (r.width > 0 && r.height > 0 && !/\s/u.test(char)) line ??= r;
        else { start = next; }
        end = next;
      }
      flush();
    }
  }
}

export async function jpegBytes(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode')), 'image/jpeg', .94));
  return new Uint8Array(await blob.arrayBuffer());
}
