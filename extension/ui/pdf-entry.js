// Missing tab metadata is not evidence of a PDF: internal and blank tabs can
// hide the same fields as local files. Offer a manual chooser behind help.
export function pdfPopupState(tab, readerURL, fileAccess) {
  const reader = !!tab?.url?.startsWith(readerURL);
  let looksPDF = false;
  try { looksPDF = /\.pdf$/i.test(new URL(tab?.url).pathname); } catch { /* hidden URL */ }
  const restricted = !tab?.id || (!reader && !/^https?:\/\//.test(tab.url || ''));
  return { reader, restricted, check: !!tab?.id && !reader && (restricted || looksPDF),
    localHelp: !!tab?.id && !reader && restricted && !tab?.url && !fileAccess };
}
