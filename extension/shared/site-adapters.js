// Original, DOM-only site hints. No website APIs, private rules or generated CSS class names.
export function pixivNovelDocument(doc) {
  return /(^|\.)pixiv\.net$/.test(doc.location?.hostname || '') && doc.location?.pathname === '/novel/show.php';
}

export function novelRoots(doc) {
  if (!pixivNovelDocument(doc)) return [];
  // text-count is the public reader's line marker; data-novel-content is an explicit reader hint.
  const roots=[...doc.querySelectorAll('p:has(> span.text-count),[data-novel-content]')];
  return roots.filter(root=>!roots.some(other=>other!==root&&other.contains(root)));
}

export function novelBody(el) {
  return el.matches('[data-novel-content]') ||
    (pixivNovelDocument(el.ownerDocument) && el.matches('p:has(> span.text-count)'));
}

export function artworkImages(doc) {
  if (!/(^|\.)pixiv\.net$/.test(doc.location?.hostname || '') || !/^\/artworks\/\d+/.test(doc.location?.pathname || '')) return null;
  // Keep avatars, recommendation grids and thumbnails out of OCR. Never enumerate unseen pages.
  const id=doc.location.pathname.match(/^\/artworks\/(\d+)/)[1];
  return [...doc.querySelectorAll('img')].filter(img => {
    try { return /(^|\.)pximg\.net$/.test(new URL(img.currentSrc || img.src, doc.baseURI).hostname) &&
      /\/img-(?:original|master)\//.test(new URL(img.currentSrc || img.src, doc.baseURI).pathname) &&
      new RegExp('/'+id+'_p\\d+').test(new URL(img.currentSrc || img.src, doc.baseURI).pathname) &&
      !img.closest('aside,nav,[role="complementary"]'); } catch { return false; }
  });
}
