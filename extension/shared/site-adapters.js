// Original, DOM-only site hints. No website APIs, private rules or generated CSS class names.
export function pixivNovelDocument(doc) {
  return /(^|\.)pixiv\.net$/.test(doc.location?.hostname || '') && doc.location?.pathname === '/novel/show.php';
}

export function novelRoots(doc) {
  if (!pixivNovelDocument(doc)) return [];
  // text-count is the public reader's line marker; data-novel-content is an explicit reader hint.
  const roots=[...doc.querySelectorAll(':has(> span.text-count),[data-novel-content]')];
  return roots.filter(root=>!roots.some(other=>other!==root&&other.contains(root)));
}

export function novelBody(el) {
  return el.matches('[data-novel-content]') ||
    (pixivNovelDocument(el.ownerDocument) && el.matches(':has(> span.text-count)'));
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
import { identifierText, linkIdentifier } from './identifiers.js';

export function protectedElement(el) {
  const text=el.textContent.trim();
  if (!text) return false;
  if ((!el.childElementCount && identifierText(text)) || (el.localName==='a' && (identifierText(text)||linkIdentifier(text,el.getAttribute('href'),el.baseURI)))) return true;
  const host=el.ownerDocument.location?.hostname||'';
  if (host==='github.com' && el.closest('.topic-tag,[role="treeitem"],a[href*="/milestone/"],.react-directory-filename-column,.react-directory-row-name-cell,.commit-author,.author,.user-mention,a[href*="?author="],a[aria-label^="commits by "],[data-hovercard-type="user"],[data-hovercard-type="organization"],[itemprop="author"],[itemprop="name"],#repository-container-header .AppHeader-context,[data-testid="repos-header-breadcrumb"],[data-testid="anchor-button"],[data-testid="branch-picker-repo-header"],.branch-select-menu,.branch-name,[data-hotkey="w"]')) return true;
  if(/(^|\.)reddit\.com$/.test(host)&&el.closest('.author,a[href^="/user/"],a[href^="/u/"]')) return true;
  return !!el.closest('.sig,.sig-name,.sig-param,.post-tag,.s-tag,.subreddit,[data-testid="subreddit-name"],.hnuser,[rel="author"],[itemprop="author"],[class*="AuthorName"]');
}
