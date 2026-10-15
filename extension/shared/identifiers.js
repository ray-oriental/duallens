// Public identifiers are source data, not translatable prose.
export function identifierText(text) {
  const s=text.trim();
  return /^(?:MIT|Apache|BSD|ISC|MPL|GPL|LGPL|AGPL)(?: license)?(?:[- ]?[\d.]+)?(?: license)?$/i.test(s) ||
    /^(?:TypeScript|JavaScript|Python|Rust|Ruby|Java|C\+\+|C#|HTML|CSS|PHP|Swift|Kotlin|Shell|Jupyter Notebook)$/i.test(s) ||
    (!/\s/.test(s) && (/[./_-]/.test(s) || /^v\d+$/i.test(s) || /[a-z][A-Z]/.test(s) || /^[a-f\d]{7,40}$/i.test(s) || /^[\w$]+\([^)]*\)$/.test(s) || /^<\/?[a-z][\w-]*>$/i.test(s)));
}
export function linkIdentifier(text,href,base) {
  try {
    const u=new URL(href,base),last=decodeURIComponent(u.pathname.replace(/\/+$/,'').split('/').pop());
    const clean=s=>s.trim().replace(/^@/,'').toLowerCase();
    return !!last && clean(text)===clean(last);
  } catch { return false; }
}
