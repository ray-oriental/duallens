// Original DualLens overlapping lens symbol; built with namespace-safe DOM APIs.
export function lensIcon(monochrome = false) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [cx, cy, color, alpha] of [[9, 9, '#4263eb', '.72'], [15, 15, '#20c997', '1']]) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '7');
    c.setAttribute('fill', monochrome ? 'currentColor' : color); c.setAttribute('fill-opacity', alpha);
    svg.append(c);
  }
  return svg;
}
