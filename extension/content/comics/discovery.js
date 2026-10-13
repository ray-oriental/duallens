export function imageURL(value, base) {
  try {
    const u = new URL(value, base);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}

export function sourceFor(img, base) {
  const candidates = [img.currentSrc, ...['data-src', 'data-original', 'data-lazy-src', 'src'].map((k) => img.getAttribute(k))];
  for (const c of candidates) if (c && imageURL(c, base)) return imageURL(c, base);
  const srcset = img.getAttribute('srcset') || '';
  return imageURL(srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop(), base);
}

export function discoverImages(doc, { onlyImg = false, canvasRecords = [], max = 8 } = {}) {
  const win = doc.defaultView;
  const visible = [], next = [];
  const records = new Map(canvasRecords.map((r) => [r.element, r]));
  const nodes = onlyImg ? doc.querySelectorAll('img') : doc.querySelectorAll('img,canvas,body *');
  let scanned = 0;
  for (const element of nodes) {
    if (++scanned > 6000) break;
    if (element.closest('dl-ui,dl-comic,[translate="no"],.notranslate,[aria-hidden="true"]')) continue;
    const r = element.getBoundingClientRect();
    if (r.width < 280 || r.height < 280 || r.bottom < 0 || r.right < 0 || r.left > win.innerWidth || r.top > win.innerHeight * 2) continue;
    const style = win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    let url = '', slices;
    if (element.tagName === 'IMG') url = sourceFor(element, doc.baseURI);
    else if (element.tagName === 'CANVAS') {
      slices = records.get(element)?.slices;
      if (slices?.length) url = imageURL(slices[0].url, doc.baseURI);
    } else {
      const match = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage);
      if (match) url = imageURL(match[1], doc.baseURI);
    }
    if (!url) continue;
    const candidate = { element, url, slices, width: element.naturalWidth || element.width || r.width,
      height: element.naturalHeight || element.height || r.height, top: r.top };
    (r.top < win.innerHeight ? visible : next).push(candidate);
  }
  return [...visible.sort((a,b) => a.top-b.top).slice(0,max), ...next.sort((a,b) => a.top-b.top).slice(0,1)];
}
